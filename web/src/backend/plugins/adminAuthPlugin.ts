// Admin auth realm — credentials login against the `admins` table, sets a separate signed
// cookie (`renown_admin`), and exposes admin-only endpoints (list/manage users + tiers).
//
// Hard-separated from the user realm: a regular user session DOES NOT grant admin authority,
// and an admin session DOES NOT grant user authority. Admin endpoints check `requireAdmin`.
import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { Elysia, t } from "elysia";
import { aiAttestationEvents, onchainTransferOutbox, players, stripeWebhookEvents, walletAccounts, walletReservations, webhookDeliveries } from "../../../../db/schema.ts";
import { schema } from "../../../db/schema";
import type { SchemaType } from "../../../db/schema";
import { applyAttestation, buildStaleAttestationDigest, deliverWebhook } from "../attestation.ts";
import { gameDb } from "../sync.ts";
import { resolvePlayerByUserSub } from "../resolvePlayer.ts";
import { adminCookieAttrs, adminCookieName, issueAdminToken, verifyAdminToken } from "../admin/adminCookie";
import { isTier, normalizeTier, type Tier } from "../billing/tiers";

type Deps = { db: NeonHttpDatabase<SchemaType> };

const readCookie = (header: string | null, name: string): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
};

const requireAdmin = async (db: NeonHttpDatabase<SchemaType>, request: Request) => {
  const tok = readCookie(request.headers.get("cookie"), adminCookieName);
  const claim = verifyAdminToken(tok);
  if (!claim) return null;
  const rows = await db.select().from(schema.admins).where(eq(schema.admins.sub, claim.sub));
  return rows[0] ?? null;
};

export const adminAuthPlugin = ({ db }: Deps) =>
  new Elysia({ name: "renown-admin-auth" })
    // Credentials login for admins. Argon2id via Bun.password (built-in). Issues the signed cookie.
    .post("/admin/login", async ({ body, set }) => {
      const email = body.email.trim().toLowerCase();
      const rows = await db.select().from(schema.admins).where(eq(schema.admins.email, email));
      const admin = rows[0];
      // Constant-ish failure path — same response shape and no email-exists oracle.
      if (!admin || !(await Bun.password.verify(body.password, admin.password_hash))) {
        set.status = 401;
        return { error: "invalid credentials" };
      }
      await db.update(schema.admins).set({ last_login_at: new Date() }).where(eq(schema.admins.sub, admin.sub));
      set.headers["set-cookie"] = `${adminCookieName}=${issueAdminToken(admin.sub)}; ${adminCookieAttrs}`;
      return { ok: true, admin: { sub: admin.sub, email: admin.email, name: admin.name } };
    }, { body: t.Object({ email: t.String({ format: "email" }), password: t.String({ minLength: 8 }) }) })
    // Logout — clear the cookie.
    .delete("/admin/logout", ({ set }) => {
      set.headers["set-cookie"] = `${adminCookieName}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`;
      return { ok: true };
    })
    // Who am I (admin) — used by the portal to detect signed-in state.
    .get("/api/admin/me", async ({ request, set }) => {
      const admin = await requireAdmin(db, request);
      if (!admin) { set.status = 401; return { error: "not admin" }; }
      return { sub: admin.sub, email: admin.email, name: admin.name, last_login_at: admin.last_login_at };
    })
    // List users (with billing + linked-login summary) for the admin table.
    .get("/api/admin/users", async ({ query, request, set }) => {
      const admin = await requireAdmin(db, request);
      if (!admin) { set.status = 401; return { error: "not admin" }; }
      const q = (typeof query.q === "string" ? query.q : "").trim();
      const rows = q
        ? await db.select().from(schema.users).where(or(ilike(schema.users.email, `%${q}%`), ilike(schema.users.first_name, `%${q}%`), ilike(schema.users.last_name, `%${q}%`))).limit(200)
        : await db.select().from(schema.users).orderBy(desc(schema.users.created_at)).limit(200);
      const subs = rows.map(r => r.sub);
      const idents = subs.length ? await db.select().from(schema.authIdentities) : [];
      const byUser = new Map<string, string[]>();
      for (const i of idents) {
        if (!subs.includes(i.user_sub)) continue;
        if (!byUser.has(i.user_sub)) byUser.set(i.user_sub, []);
        byUser.get(i.user_sub)!.push(i.auth_provider);
      }
      return rows.map(u => ({
        sub: u.sub, email: u.email, name: [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
        tier: normalizeTier(u.tier), status: u.subscription_status,
        hasCustomer: Boolean(u.stripe_customer_id),
        currentPeriodEnd: u.current_period_end,
        identities: byUser.get(u.sub) ?? [],
        created_at: u.created_at,
      }));
    })
    // Manually grant or revoke a tier (admin override, audited via last_login_at + status).
    .post("/api/admin/users/:sub/tier", async ({ params, body, request, set }) => {
      const admin = await requireAdmin(db, request);
      if (!admin) { set.status = 401; return { error: "not admin" }; }
      if (!isTier(body.tier)) { set.status = 400; return { error: "invalid tier" }; }
      const target = (await db.select().from(schema.users).where(eq(schema.users.sub, params.sub)))[0];
      if (!target) { set.status = 404; return { error: "user not found" }; }
      const tier = body.tier as Tier;
      await db.update(schema.users).set({ tier, subscription_status: tier === "free" ? null : "admin_granted" })
        .where(eq(schema.users.sub, target.sub));
      // Mirror onto the user's canonical player so the leaderboard badge follows.
      const pl = await resolvePlayerByUserSub(target.sub);
      if (pl) await gameDb.update(players).set({ tier }).where(eq(players.id, pl.id));
      console.log(`[renown:admin] ${admin.email} → set tier=${tier} for user ${target.email ?? target.sub}`);
      return { ok: true, sub: target.sub, tier };
    }, { body: t.Object({ tier: t.String() }) })
    // Replay a failed webhook delivery. Reads the original event_kind + payload from
    // the row and re-runs the retry-and-log pipeline against the current configured
    // webhook URL (RENOWN_ATTESTATION_WEBHOOK) — i.e. respects any URL change the
    // operator made since the original failed attempt. Adds new rows to the delivery
    // log so the trail of replay attempts is itself auditable.
    // Stale-attestation digest — every verified attestation expiring within
    // ?withinDays= (default 30). Admin-only; the cron also calls the same builder
    // and POSTs the digest to RENOWN_DIGEST_WEBHOOK so an operator can wire it to
    // email/Slack/whatever. Honest scope: actually delivering the email is
    // operator-owned; we surface the data.
    .get("/api/admin/expiring-attestations", async ({ query, request, set }) => {
      const admin = await requireAdmin(db, request);
      if (!admin) { set.status = 401; return { error: "not admin" }; }
      const days = Math.max(1, Math.min(365, Number(query.withinDays ?? 30)));
      return buildStaleAttestationDigest(days);
    })
    // Admin attestations dashboard — paginated read of ai_attestation_events across
    // all players. Filters: ?provider= / ?kind= (claimed|verified|cleared) /
    // ?verified=true|false / ?login= / ?after=<iso> / ?before=<iso>. Joins to players
    // for the login so the UI doesn't have to do a second round-trip. Page size
    // capped at 200; default 50.
    .get("/api/admin/attestations", async ({ query, request, set }) => {
      const admin = await requireAdmin(db, request);
      if (!admin) { set.status = 401; return { error: "not admin" }; }
      const limit = Math.min(200, Math.max(1, Number(query.n ?? 50)));
      const conds = [];
      if (typeof query.provider === "string" && query.provider) conds.push(eq(aiAttestationEvents.provider, query.provider));
      if (typeof query.kind === "string" && query.kind) conds.push(eq(aiAttestationEvents.kind, query.kind));
      if (query.verified === "true") conds.push(eq(aiAttestationEvents.verified, true));
      if (query.verified === "false") conds.push(eq(aiAttestationEvents.verified, false));
      if (typeof query.actorKind === "string" && query.actorKind) conds.push(eq(aiAttestationEvents.actorKind, query.actorKind));
      if (typeof query.after === "string" && query.after) conds.push(sql`${aiAttestationEvents.at} >= ${query.after}`);
      if (typeof query.before === "string" && query.before) conds.push(sql`${aiAttestationEvents.at} <= ${query.before}`);
      if (typeof query.login === "string" && query.login) conds.push(eq(players.githubLogin, query.login));
      const rows = await gameDb.select({
        id: aiAttestationEvents.id,
        at: aiAttestationEvents.at,
        kind: aiAttestationEvents.kind,
        provider: aiAttestationEvents.provider,
        evidenceUrl: aiAttestationEvents.evidenceUrl,
        verified: aiAttestationEvents.verified,
        actorKind: aiAttestationEvents.actorKind,
        actorSub: aiAttestationEvents.actorSub,
        playerId: aiAttestationEvents.playerId,
        login: players.githubLogin,
        handle: players.handle,
      })
        .from(aiAttestationEvents)
        .innerJoin(players, eq(players.id, aiAttestationEvents.playerId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(aiAttestationEvents.at))
        .limit(limit);
      // Resolve actor_sub → admin email / user login. Separate DB (auth vs game) so we
      // can't join in one SQL; gather the unique subs by actor kind, batch-lookup,
      // attach. Cheap (one row per unique actor) and ergonomic — the dashboard reads
      // "admin · alex@example.com" instead of just "admin".
      const adminSubs = [...new Set(rows.filter((r) => r.actorKind === "admin" && r.actorSub).map((r) => r.actorSub!))];
      const userSubs = [...new Set(rows.filter((r) => r.actorKind === "user" && r.actorSub).map((r) => r.actorSub!))];
      const adminEmails = new Map<string, string>();
      const userLogins = new Map<string, string>();
      if (adminSubs.length > 0) {
        const aRows = await db.select({ sub: schema.admins.sub, email: schema.admins.email }).from(schema.admins).where(inArray(schema.admins.sub, adminSubs));
        for (const a of aRows) adminEmails.set(a.sub, a.email);
      }
      if (userSubs.length > 0) {
        // User's GitHub login lives on auth_identities (provider=github → metadata.login).
        const iRows = await db.select({ userSub: schema.authIdentities.user_sub, metadata: schema.authIdentities.metadata, provider: schema.authIdentities.auth_provider }).from(schema.authIdentities).where(and(inArray(schema.authIdentities.user_sub, userSubs), eq(schema.authIdentities.auth_provider, "github")));
        for (const i of iRows) {
          const login = (i.metadata as { login?: string } | null)?.login;
          if (login) userLogins.set(i.userSub, login);
        }
      }
      return rows.map((r) => ({
        ...r,
        actorEmail: r.actorKind === "admin" && r.actorSub ? adminEmails.get(r.actorSub) ?? null : null,
        actorLogin: r.actorKind === "user" && r.actorSub ? userLogins.get(r.actorSub) ?? null : null,
      }));
    })
    // Admin force-clear of an attestation. Calls the shared applyAttestation with
    // kind="clear", which strips is_ai + the attestation jsonb + restores the
    // human-default attribution_query AND writes a "cleared" audit-log row. The admin
    // intent is captured in the console.log; the actor isn't currently stamped into
    // ai_attestation_events (could be a follow-up — add an actor column). Useful for
    // moderating bad-faith claims or recovering an account whose key the user lost.
    .post("/api/admin/attestations/:login/clear", async ({ params, request, set }) => {
      const admin = await requireAdmin(db, request);
      if (!admin) { set.status = 401; return { error: "not admin" }; }
      const result = await applyAttestation(params.login, { kind: "clear" }, { kind: "admin", sub: admin.sub });
      if (!result.ok) { set.status = 400; return { error: result.error }; }
      console.log(`[renown:admin] ${admin.email} → force-cleared attestation for @${params.login}`);
      return { ok: true };
    })
    // Read the recent attempt rows from webhook_deliveries for the dead-letter UI.
    // Default to "all"; filters narrow by event kind + outcome. failed=true returns
    // only network errors + non-2xx codes (the ones an operator might want to replay).
    .get("/api/admin/webhook-deliveries", async ({ query, request, set }) => {
      const admin = await requireAdmin(db, request);
      if (!admin) { set.status = 401; return { error: "not admin" }; }
      const limit = Math.min(200, Math.max(1, Number(query.n ?? 50)));
      const conds = [];
      if (typeof query.eventKind === "string" && query.eventKind) conds.push(eq(webhookDeliveries.eventKind, query.eventKind));
      if (query.failed === "true") conds.push(sql`(${webhookDeliveries.statusCode} is null or ${webhookDeliveries.statusCode} >= 400)`);
      const rows = await gameDb.select().from(webhookDeliveries)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(webhookDeliveries.attemptedAt))
        .limit(limit);
      return rows;
    })
    // Bulk replay — accepts an array of delivery ids and re-runs the retry-and-log
    // loop against the current configured webhook URL for each. Detached: returns
    // immediately, attempts log new rows. Caps at 200 ids per call to keep a runaway
    // request from holding the connection.
    .post("/api/admin/webhook-deliveries/replay-bulk", async ({ body, request, set }) => {
      const admin = await requireAdmin(db, request);
      if (!admin) { set.status = 401; return { error: "not admin" }; }
      const url = process.env.RENOWN_ATTESTATION_WEBHOOK;
      if (!url) { set.status = 400; return { error: "RENOWN_ATTESTATION_WEBHOOK not configured" }; }
      const ids = ((body ?? {}) as { ids?: string[] }).ids ?? [];
      if (!Array.isArray(ids) || ids.length === 0) { set.status = 400; return { error: "ids array required" }; }
      const capped = ids.slice(0, 200);
      const rows = await gameDb.select().from(webhookDeliveries).where(inArray(webhookDeliveries.id, capped));
      for (const row of rows) {
        void deliverWebhook(url, row.eventKind, row.payload as Record<string, unknown>);
      }
      console.log(`[renown:admin] ${admin.email} → bulk replay of ${rows.length} delivery row(s)`);
      return { ok: true, replaying: rows.length };
    })
    .post("/api/admin/webhook-deliveries/:id/replay", async ({ params, request, set }) => {
      const admin = await requireAdmin(db, request);
      if (!admin) { set.status = 401; return { error: "not admin" }; }
      const url = process.env.RENOWN_ATTESTATION_WEBHOOK;
      if (!url) { set.status = 400; return { error: "RENOWN_ATTESTATION_WEBHOOK not configured" }; }
      const row = (await gameDb.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, params.id)))[0];
      if (!row) { set.status = 404; return { error: "delivery not found" }; }
      // Detach — replay can take ~20s of backoff; return immediately, log results.
      void deliverWebhook(url, row.eventKind, row.payload as Record<string, unknown>);
      console.log(`[renown:admin] ${admin.email} → replay delivery ${row.id} (${row.eventKind})`);
      return { ok: true, replaying: row.id, eventKind: row.eventKind };
    })
    .get("/api/admin/marketplace/health", async ({ request, set }) => {
      const admin = await requireAdmin(db, request); if (!admin) { set.status = 401; return { error: "not admin" }; }
      const [imbalance, failedEvents, reservations, frozen, chainOutbox] = await Promise.all([
        gameDb.execute(sql`select count(*)::int count from wallet_accounts a where a.balance_cents <> coalesce((select sum(e.amount_cents)::int from wallet_entries e where e.account_id=a.id),0)`),
        gameDb.select().from(stripeWebhookEvents).where(eq(stripeWebhookEvents.status, "failed")).orderBy(desc(stripeWebhookEvents.receivedAt)).limit(25),
        gameDb.select({ count: sql<number>`count(*)::int`, amountCents: sql<number>`coalesce(sum(${walletReservations.amountCents}),0)::int` }).from(walletReservations).where(eq(walletReservations.status, "active")),
        gameDb.select({ id: walletAccounts.id, playerId: walletAccounts.playerId, balanceCents: walletAccounts.balanceCents, reservedCents: walletAccounts.reservedCents, login: players.githubLogin, handle: players.handle })
          .from(walletAccounts).leftJoin(players, eq(players.id, walletAccounts.playerId)).where(eq(walletAccounts.status, "frozen")),
        gameDb.select({ status: onchainTransferOutbox.status, count: sql<number>`count(*)::int` }).from(onchainTransferOutbox).groupBy(onchainTransferOutbox.status),
      ]);
      return { imbalanceCount: Number((imbalance.rows[0] as { count?: number } | undefined)?.count ?? 0), failedStripeEvents: failedEvents, activeReservations: reservations[0] ?? { count: 0, amountCents: 0 }, frozenWallets: frozen,
        chainOutbox: Object.fromEntries(chainOutbox.map((row) => [row.status, row.count])) };
    })
    .post("/api/admin/marketplace/wallets/:playerId/status", async ({ params, body, request, set }) => {
      const admin = await requireAdmin(db, request); if (!admin) { set.status = 401; return { error: "not admin" }; }
      const status = (body as { status?: unknown } | null)?.status; if (status !== "active" && status !== "frozen") { set.status = 400; return { error: "status must be active or frozen" }; }
      const rows = await gameDb.update(walletAccounts).set({ status }).where(eq(walletAccounts.playerId, params.playerId)).returning({ id: walletAccounts.id });
      if (!rows.length) { set.status = 404; return { error: "wallet not found" }; }
      console.log(`[renown:admin] ${admin.email} → wallet ${rows[0].id} status=${status}`); return { ok: true, status };
    });

export { requireAdmin };
// Silence unused-import warnings for the helpers consumers can reach for.
void [ne];
