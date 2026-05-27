// Account endpoints for the multi-login model. Everything here is session-protected: a
// signed-in renown user can see the logins attached to their account, choose a primary,
// unlink one, and accept/decline a pending merge (when a login they tried to add already
// belonged to another account). Linking a NEW login happens via the OAuth flow itself
// (visit /oauth2/<provider>/authorization while signed in -> resolveAuthIntent links it).
import { type AuthSessionStore, protectRoutePlugin } from "@absolutejs/auth";
import { desc, eq } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { Elysia } from "elysia";
import { achievements as achievementsTable, playerAchievements, players } from "../../../../db/schema.ts";
import { authIdentities, SchemaType, User } from "../../../db/schema";
import { defaultAuthorQuery, resolveProvider } from "../aiProviders.ts";
import { gameDb, grantAchievements, hub } from "../sync.ts";
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

// Small in-memory cache for the authoritative-cursor lookup. Cursors fire frequently
// (every hover, throttled at ~150ms client-side) but the (login → avatarSeed/isAi)
// mapping changes rarely (avatar set, AI flag flipped). Keyed by github login; 30s TTL.
type CachedPlayerInfo = { login: string; avatarSeed: string | null; isAi: boolean };
const PLAYER_INFO_TTL_MS = 30_000;
const playerInfoCache = new Map<string, { value: CachedPlayerInfo; expiresAt: number }>();
const getCachedPlayerInfo = async (login: string): Promise<CachedPlayerInfo | null> => {
  const now = Date.now();
  const hit = playerInfoCache.get(login);
  if (hit && hit.expiresAt > now) return hit.value;
  const rows = await gameDb.select().from(players).where(eq(players.githubLogin, login));
  const p = rows[0];
  if (!p) { playerInfoCache.delete(login); return null; }
  const value: CachedPlayerInfo = { login: p.githubLogin ?? login, avatarSeed: p.avatarSeed, isAi: !!p.isAi };
  playerInfoCache.set(login, { value, expiresAt: now + PLAYER_INFO_TTL_MS });
  return value;
};

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
      // Server-authoritative AI marker. Set by migration OR by a self-posted attestation
      // (POST /api/account/ai-attestation). Surfaces a badge in the UI but never gates
      // scoring/pets/achievements. Cache invalidates on update; for now, this is set
      // rarely enough that the 30s cursor cache freshness is fine.
      isAi: !!player?.isAi,
      aiAttestation: (player as { aiAttestation?: { provider: string; claimedAt: string; evidenceUrl?: string; verified?: boolean } | null } | undefined)?.aiAttestation ?? null,
      // Earned achievements — same join shape as /api/profile/:login so the panel
      // component can render from either endpoint with no client-side massaging.
      achievements: player
        ? await gameDb
            .select({ id: achievementsTable.id, name: achievementsTable.name, description: achievementsTable.description, tier: achievementsTable.tier, category: achievementsTable.category, unlockCount: achievementsTable.unlockCount })
            .from(playerAchievements)
            .innerJoin(achievementsTable, eq(achievementsTable.id, playerAchievements.achievementId))
            .where(eq(playerAchievements.playerId, player.id))
            .orderBy(desc(achievementsTable.tier))
        : [],
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
    // Authoritative ghost-cursor: same fan-out as /api/cursor, but the label, avatarSeed,
    // and isAi flag are looked up server-side from the player row (by the session's github
    // login). The client only contributes sid/rowId/board — no way to spoof another user's
    // handle or pretend to be (or not to be) an AI. Players who haven't linked GitHub yet
    // fall through to the anonymous path.
    //
    // The per-cursor player lookup is cached for 30s (cursors fire frequently; the player
    // row changes rarely) so we don't beat up Neon during normal hover.
    .post("/cursor", ({ body, protectRoute }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { sid?: string; rowId?: string | null; board?: string };
        const sid = String(b.sid ?? "").slice(0, 40);
        if (!sid) return { ok: false };
        // Resolve github login + player row (cached). authIdentities is the source of truth
        // for which login owns this auth session.
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login ?? null;
        const playerInfo = ghLogin ? await getCachedPlayerInfo(ghLogin) : null;
        hub.publish("cursors", {
          sid,
          rowId: typeof b.rowId === "string" ? b.rowId.slice(0, 60) : null,
          board: typeof b.board === "string" ? b.board.slice(0, 20) : null,
          label: playerInfo?.login ?? null,
          avatarSeed: playerInfo?.avatarSeed ?? null,
          isAi: playerInfo?.isAi ?? false,
          at: Date.now(),
        });
        return { ok: true };
      }),
    )
    // Self-claimed AI attestation. POST { provider, evidenceUrl? } → sets is_ai = true and
    // stores the claim. v1 is a public-claim model: anyone signed in can mark their
    // account as AI by naming a provider and (recommended) pointing at a public page where
    // the claim is verifiable. The data is publicly visible (badge tooltip), so a false
    // claim is auditable. The schema is ready for cryptographic provider-signed JWTs
    // later — the endpoint shape just adds a `jwt` field then and verifies it server-side
    // against a trusted public-key registry.
    //
    // De-attest by POSTing { provider: null }: clears the attestation and is_ai (the row
    // can still be re-marked by admin/migration; this only undoes the self-claim).
    .post("/ai-attestation", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { provider?: string | null; evidenceUrl?: string; attestationJwt?: string };
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        // Resolve the player row early — needed for both clear and claim paths so we can
        // restore the right default attribution_query on clear / fire achievement grants
        // on claim. One round-trip either way.
        const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin));
        const player = playerRows[0];
        if (!player) return status("Not Found", "player not found");

        // Clear path: provider null/empty → strip attestation + is_ai, AND restore the
        // human default attribution_query (otherwise a player who attested then cleared
        // would be stuck with the co-author query producing zero hits). Reset
        // last_attribution_sync_at so the next /verify backfills from author:<login>.
        if (!b.provider) {
          await gameDb.update(players).set({
            aiAttestation: null,
            isAi: false,
            attributionQuery: defaultAuthorQuery(ghLogin),
            lastAttributionSyncAt: null,
          }).where(eq(players.id, player.id));
          playerInfoCache.delete(ghLogin);
          return { ok: true, ...(await accountPayload(db, user.sub)) };
        }

        // Claim path. Provider is resolved against the known registry — known providers
        // get auto-filled coauthorQuery (so attestation also onboards their attribution
        // tracking), unknown providers are still accepted in v1's public-claim model but
        // the player keeps their existing attribution_query (admin can edit later).
        const providerRaw = String(b.provider).slice(0, 40).trim();
        if (!providerRaw) return status("Bad Request", "provider required");
        const resolved = resolveProvider(providerRaw);
        const evidenceUrl = typeof b.evidenceUrl === "string" ? b.evidenceUrl.slice(0, 400).trim() : undefined;
        if (evidenceUrl && !/^https:\/\//.test(evidenceUrl)) return status("Bad Request", "evidenceUrl must be https://");

        // JWT verification (optional, v1 has no real provider verifiers). If provided AND
        // the registry entry has a verifier AND it returns true → verified = true.
        // Otherwise verified stays false (public claim).
        let verified = false;
        if (b.attestationJwt && resolved?.config.verifyJwt) {
          try { verified = await resolved.config.verifyJwt(b.attestationJwt, ghLogin); }
          catch { verified = false; }
        }

        const attestation = {
          provider: resolved?.id ?? providerRaw,
          claimedAt: new Date().toISOString(),
          ...(evidenceUrl ? { evidenceUrl } : {}),
          ...(verified ? { verified: true } : {}),
        };
        // Side-effect on attribution_query only for known providers (auto-fill) — leaves
        // unknown providers' existing query alone. Reset lastAttributionSyncAt so the
        // next /verify backfills from createdAt with the new query.
        const update: Partial<typeof players.$inferInsert> = { aiAttestation: attestation, isAi: true };
        if (resolved) {
          update.attributionQuery = resolved.config.coauthorQuery;
          update.lastAttributionSyncAt = null;
        }
        await gameDb.update(players).set(update).where(eq(players.id, player.id));
        playerInfoCache.delete(ghLogin);

        // Instant grant: ai-revealed (always on attestation), ai-attested (we just stored
        // one), and ai-verified (only if JWT verified). /api/verify also grants these on
        // its next pass; this just makes the achievements show up right away.
        await grantAchievements(player.id, [
          "ai-revealed",
          "ai-attested",
          ...(verified ? ["ai-verified"] : []),
        ]);
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
        const rows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
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
