// Stripe billing for renown — subscription tiers (Free / Supporter / Pro), modeled on
// ~/intent's stripePlugin but adapted from one-time PaymentIntents to hosted Checkout +
// the billing portal + subscription webhooks. See billing/tiers.ts for the no-pay-to-win model.
//
// Runs WITHOUT keys: if STRIPE_SECRET_KEY is unset the plugin still mounts but billing routes
// answer 503 "billing not configured" — so the server boots fine before the Stripe account exists.
import { type AuthSessionStore, protectRoutePlugin } from "@absolutejs/auth";
import { eq } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { Elysia, t } from "elysia";
import { Stripe } from "stripe";
import { players } from "../../../../db/schema.ts";
import { gameDb } from "../sync.ts";
import { schema, SchemaType, User } from "../../../db/schema";
import { isTier, normalizeTier, priceToTier, type Tier, tierToPrice, TIER_INFO } from "../billing/tiers";

type Deps = { authSessionStore: AuthSessionStore<User>; db: NeonHttpDatabase<SchemaType> };

const SECRET = process.env.STRIPE_SECRET_KEY;
const PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY ?? null;
const stripe = SECRET ? new Stripe(SECRET, { apiVersion: "2025-12-15.clover" }) : null;

// The user's GitHub login (so we can mirror their tier onto their public player row for the badge).
const githubLoginFor = async (db: NeonHttpDatabase<SchemaType>, userSub: string) => {
  const rows = await db.select().from(schema.authIdentities).where(eq(schema.authIdentities.user_sub, userSub));
  const gh = rows.find((r) => r.auth_provider === "github");
  return (gh?.metadata as { login?: string } | undefined)?.login ?? gh?.provider_subject ?? null;
};

// Source of truth = users.tier; denormalize to players.tier (by github login) for the leaderboard badge + CLI.
const applyTier = async (db: NeonHttpDatabase<SchemaType>, opts: { userSub: string; tier: Tier; status?: string | null; subscriptionId?: string | null; periodEnd?: Date | null }) => {
  await db.update(schema.users).set({
    current_period_end: opts.periodEnd ?? null,
    stripe_subscription_id: opts.subscriptionId ?? null,
    subscription_status: opts.status ?? null,
    tier: opts.tier,
  }).where(eq(schema.users.sub, opts.userSub));
  const login = await githubLoginFor(db, opts.userSub);
  if (login) await gameDb.update(players).set({ tier: opts.tier }).where(eq(players.githubLogin, login));
};

// Real price amounts, fetched once from Stripe and cached for the process (so the pricing UI
// shows live dollars instead of hardcoded labels — edit the price in the dashboard, it follows).
let amountCache: Record<string, { amount: number | null; currency: string; interval?: string }> | null = null;
const loadAmounts = async () => {
  if (!stripe) return {};
  if (amountCache) return amountCache;
  const out: NonNullable<typeof amountCache> = {};
  for (const [tier, id] of [["supporter", process.env.STRIPE_PRICE_SUPPORTER], ["pro", process.env.STRIPE_PRICE_PRO]] as const) {
    if (!id) continue;
    try {
      const p = await stripe.prices.retrieve(id);
      out[tier] = { amount: p.unit_amount, currency: p.currency, interval: p.recurring?.interval };
    } catch { /* ignore — UI falls back to no amount */ }
  }
  amountCache = out;
  return out;
};

export const stripePlugin = ({ authSessionStore, db }: Deps) =>
  new Elysia({ name: "renown-stripe" })
    .use(protectRoutePlugin<User>({ authSessionStore }))
    // Public: what the client needs to render pricing. Safe with or without keys.
    .get("/stripe/config", async () => ({
      configured: Boolean(stripe),
      publishableKey: PUBLISHABLE,
      tiers: TIER_INFO,
      prices: { supporter: process.env.STRIPE_PRICE_SUPPORTER ?? null, pro: process.env.STRIPE_PRICE_PRO ?? null },
      amounts: await loadAmounts(),
    }))
    // Start a subscription: hosted Stripe Checkout. Requires sign-in.
    .post("/billing/checkout", ({ body, protectRoute, request, status }) =>
      protectRoute(async (user) => {
        if (!stripe) return status("Service Unavailable", "billing not configured");
        const tier = normalizeTier(body.tier);
        const price = tierToPrice(tier);
        if (tier === "free" || !price) return status("Bad Request", "no purchasable price for that tier");
        // Reuse or create the Stripe customer, stamped with the renown account sub.
        let customerId = user.stripe_customer_id;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email ?? undefined,
            metadata: { user_sub: user.sub },
            name: [user.first_name, user.last_name].filter(Boolean).join(" ") || undefined,
          });
          customerId = customer.id;
          await db.update(schema.users).set({ stripe_customer_id: customerId }).where(eq(schema.users.sub, user.sub));
        }
        const origin = new URL(request.url).origin;
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          customer: customerId,
          line_items: [{ price, quantity: 1 }],
          success_url: `${origin}/?billing=success`,
          cancel_url: `${origin}/?billing=cancel`,
          metadata: { user_sub: user.sub, tier },
        });
        return { url: session.url };
      }),
    )
    // Manage / cancel an existing subscription: Stripe billing portal. Requires sign-in.
    .post("/billing/portal", ({ protectRoute, request, status }) =>
      protectRoute(async (user) => {
        if (!stripe) return status("Service Unavailable", "billing not configured");
        if (!user.stripe_customer_id) return status("Bad Request", "no subscription to manage");
        const origin = new URL(request.url).origin;
        const portal = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${origin}/?billing=portal` });
        return { url: portal.url };
      }),
    )
    // Stripe -> us. Raw body + signature verification; the source of truth for tier changes.
    // NOT session-protected (Stripe calls it) and exempt from rate limiting (see rateLimit.ts).
    .post("/webhooks/stripe", async ({ request, status }) => {
      if (!stripe) return status("Service Unavailable", "billing not configured");
      const signature = request.headers.get("stripe-signature") ?? "";
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!signature || !secret) return status("Bad Request", "missing signature/secret");
      let event: Stripe.Event;
      try {
        event = await stripe.webhooks.constructEventAsync(await request.text(), signature, secret);
      } catch (e) {
        console.error("renown: stripe webhook verify failed", e);
        return status("Bad Request", "invalid signature");
      }
      const userForCustomer = async (customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) => {
        const id = typeof customer === "string" ? customer : customer?.id;
        if (!id) return null;
        const rows = await db.select().from(schema.users).where(eq(schema.users.stripe_customer_id, id));
        return rows[0] ?? null;
      };
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const sub = event.data.object;
          const user = await userForCustomer(sub.customer);
          if (!user) break;
          const tier = priceToTier(sub.items.data[0]?.price?.id) ?? "free";
          const active = sub.status === "active" || sub.status === "trialing";
          await applyTier(db, {
            userSub: user.sub,
            tier: active ? tier : "free",
            status: sub.status,
            subscriptionId: sub.id,
            periodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
          });
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object;
          const user = await userForCustomer(sub.customer);
          if (user) await applyTier(db, { userSub: user.sub, tier: "free", status: "canceled", subscriptionId: null, periodEnd: null });
          break;
        }
        default:
          break;
      }
      return status("OK", "ok");
    });

export { isTier };
