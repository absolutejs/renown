// Admin auth realm — credentials login against the `admins` table, sets a separate signed
// cookie (`renown_admin`), and exposes admin-only endpoints (list/manage users + tiers).
//
// Hard-separated from the user realm: a regular user session DOES NOT grant admin authority,
// and an admin session DOES NOT grant user authority. Admin endpoints check `requireAdmin`.
import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { Elysia, t } from "elysia";
import { players } from "../../../../db/schema.ts";
import { schema, SchemaType } from "../../../db/schema";
import { gameDb } from "../sync.ts";
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
      // Mirror onto the player row by github login (if linked) so the leaderboard badge follows.
      const gh = (await db.select().from(schema.authIdentities).where(and(eq(schema.authIdentities.user_sub, target.sub), eq(schema.authIdentities.auth_provider, "github"))))[0];
      const login = (gh?.metadata as { login?: string } | undefined)?.login;
      if (login) await gameDb.update(players).set({ tier }).where(eq(players.githubLogin, login));
      console.log(`[renown:admin] ${admin.email} → set tier=${tier} for user ${target.email ?? target.sub}`);
      return { ok: true, sub: target.sub, tier };
    }, { body: t.Object({ tier: t.String() }) });

export { requireAdmin };
// Silence unused-import warnings for the helpers consumers can reach for.
void [ne];
