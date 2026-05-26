// Account endpoints for the multi-login model. Everything here is session-protected: a
// signed-in renown user can see the logins attached to their account, choose a primary,
// unlink one, and accept/decline a pending merge (when a login they tried to add already
// belonged to another account). Linking a NEW login happens via the OAuth flow itself
// (visit /oauth2/<provider>/authorization while signed in -> resolveAuthIntent links it).
import { type AuthSessionStore, protectRoutePlugin } from "@absolutejs/auth";
import { eq } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { Elysia } from "elysia";
import { players } from "../../../../db/schema.ts";
import { SchemaType, User } from "../../../db/schema";
import { gameDb } from "../sync.ts";
import {
  deleteDBAuthIdentityMergeRequest,
  getDBUser,
  listDBAuthIdentitiesByUser,
  listDBAuthIdentityMergeRequestsByTarget,
  mergeUserAccounts,
  removeDBAuthIdentity,
  setPrimaryAuthIdentity,
} from "../handlers/userHandlers";

type Deps = { authSessionStore: AuthSessionStore<User>; db: NeonHttpDatabase<SchemaType> };

// The whole account picture in one shape: who you are + every login + any pending merges.
const accountPayload = async (db: NeonHttpDatabase<SchemaType>, userSub: string) => {
  const [user, identities, mergeRequests] = await Promise.all([
    getDBUser({ db, userSub }),
    listDBAuthIdentitiesByUser({ db, userSub }),
    listDBAuthIdentityMergeRequestsByTarget({ db, targetUserSub: userSub }),
  ]);
  const primaryId = user?.primary_auth_identity_id ?? null;
  // GitHub link status — the player row (by github_login) holds the authoritative score, last
  // verified timestamp, total level. Surfacing it here drives the Sync card in the UI.
  const ghIdentity = identities.find((i) => i.auth_provider === "github");
  const ghLogin = (ghIdentity?.metadata as { login?: string } | undefined)?.login ?? ghIdentity?.provider_subject ?? null;
  const player = ghLogin
    ? (await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin)))[0] ?? null
    : null;
  return {
    sub: userSub,
    billing: {
      tier: user?.tier ?? "free",
      status: user?.subscription_status ?? null,
      currentPeriodEnd: user?.current_period_end ?? null,
      hasCustomer: Boolean(user?.stripe_customer_id),
    },
    github: ghLogin ? {
      login: ghLogin,
      verified: Boolean(player?.githubVerified),
      verifiedScore: player?.verifiedScore ?? 0,
      // Split: base recompute vs accumulated attribution (Co-Authored-By windowed credit).
      baseScore: Number(player?.verifiedScore ?? 0) - Number(player?.attributionScore ?? 0),
      attributionScore: player?.attributionScore ?? 0,
      attributionQuery: player?.attributionQuery ?? null,
      lastAttributionSyncAt: player?.lastAttributionSyncAt ?? null,
      verifiedAt: player?.verifiedAt ?? null,
      totalLevel: player?.totalLevel ?? 0,
      playerId: player?.id ?? null,
      // Pet seeds (real commit SHAs) — each renders as a deterministic procgen creature.
      wild: Array.isArray(player?.wild) ? (player!.wild as string[]) : [],
      avatarSeed: player?.avatarSeed ?? null,
      showcaseSeeds: Array.isArray(player?.showcaseSeeds) ? (player!.showcaseSeeds as string[]) : [],
      petsCount: player?.petsCount ?? 0,
      rarestPetScore: player?.rarestPetScore ?? 0,
      biggestPetSize: player?.biggestPetSize ?? 0,
    } : null,
    identities: identities.map((i) => ({
      id: i.id,
      provider: i.auth_provider,
      subject: i.provider_subject,
      isPrimary: i.id === primaryId,
      linkedAt: i.created_at,
    })),
    mergeRequests: mergeRequests
      .filter((m) => m.status === "pending")
      .map((m) => ({ id: m.id, provider: m.conflicting_auth_provider, subject: m.conflicting_provider_subject })),
  };
};

export const authApiPlugin = ({ authSessionStore, db }: Deps) =>
  new Elysia({ prefix: "/api/account" })
    .use(protectRoutePlugin<User>({ authSessionStore }))
    // Everything attached to my account.
    .get("/", ({ protectRoute }) => protectRoute((user) => accountPayload(db, user.sub)))
    // Choose which login is the canonical/primary one (drives the user's display name/email).
    .post("/identities/:id/primary", ({ params, protectRoute, status }) =>
      protectRoute(async (user) => {
        try { await setPrimaryAuthIdentity({ db, identityId: params.id, userSub: user.sub }); }
        catch (e) { return status("Not Found", e instanceof Error ? e.message : "identity not found"); }
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    )
    // Unlink a login (cannot remove the last one or the current primary).
    .delete("/identities/:id", ({ params, protectRoute, status }) =>
      protectRoute(async (user) => {
        const payload = await accountPayload(db, user.sub);
        const target = payload.identities.find((i) => i.id === params.id);
        if (!target) return status("Not Found", "identity not found");
        if (payload.identities.length <= 1) return status("Bad Request", "cannot remove your last login");
        if (target.isPrimary) return status("Bad Request", "set another login as primary first");
        await removeDBAuthIdentity({ db, id: target.id });
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    )
    // Accept a pending merge: fold the other account's logins (and its renown-linked grants) into mine.
    .post("/merge-requests/:id/merge", ({ params, protectRoute, status }) =>
      protectRoute(async (user) => {
        try { await mergeUserAccounts({ db, mergeRequestId: params.id, targetUserSub: user.sub }); }
        catch (e) { return status("Bad Request", e instanceof Error ? e.message : "merge failed"); }
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    )
    // Decline / dismiss a pending merge.
    .delete("/merge-requests/:id", ({ params, protectRoute, status }) =>
      protectRoute(async (user) => {
        const payload = await accountPayload(db, user.sub);
        if (!payload.mergeRequests.find((m) => m.id === params.id)) return status("Not Found", "merge request not found");
        await deleteDBAuthIdentityMergeRequest({ db, id: params.id });
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    )
    // Pick which pet is your avatar (shown on your profile + leaderboard hover, etc). Must be
    // a seed you actually own (i.e., present in your wild). Idempotent.
    .post("/avatar", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const seed = (body as { seed?: string })?.seed;
        if (!seed) return status("Bad Request", "seed required");
        // Resolve the player row by github_login (via auth_identities).
        const rows = await db.select().from(schema.authIdentities).where(eq(schema.authIdentities.user_sub, user.sub));
        const ghLogin = (rows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin));
        const p = playerRows[0];
        if (!p) return status("Not Found", "player not found");
        const wild = Array.isArray(p.wild) ? (p.wild as string[]) : [];
        if (!wild.includes(seed)) return status("Bad Request", "you don't own that pet");
        await gameDb.update(players).set({ avatarSeed: seed }).where(eq(players.id, p.id));
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    );
