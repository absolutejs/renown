// Account endpoints for the multi-login model. Everything here is session-protected: a
// signed-in renown user can see the logins attached to their account, choose a primary,
// unlink one, and accept/decline a pending merge (when a login they tried to add already
// belonged to another account). Linking a NEW login happens via the OAuth flow itself
// (visit /oauth2/<provider>/authorization while signed in -> resolveAuthIntent links it).
import { type AuthSessionStore, protectRoutePlugin } from "@absolutejs/auth";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { Elysia } from "elysia";
import { achievements as achievementsTable, follows, playerAchievements, players, pushSubscriptions, webauthnCredentials, wildSeedSources } from "../../../../db/schema.ts";
import { getFollowingLogins } from "../rivals.ts";
import { notifyFollowed } from "../push.ts";
import { authIdentities } from "../../../db/schema";
import type { SchemaType, User } from "../../../db/schema";
import { SignJWT } from "jose";
import { applyAttestation } from "../attestation.ts";
import { gameDb, hub } from "../sync.ts";
import { isPetLookId, type PetLookId, resolvePetLookId } from "../../../../core/petLooks.ts";
import { buildAuthenticationOptions, buildRegistrationOptions, verifyAuthentication, verifyRegistration } from "../webauthn.ts";
import {
  deleteDBAuthIdentityMergeRequest,
  getDBUser,
  listDBAuthIdentitiesByUser,
  listDBAuthIdentityMergeRequestsByTarget,
  mergeUserAccounts,
  removeDBAuthIdentity,
  setPrimaryAuthIdentity,
} from "../handlers/userHandlers";
import { getPlayerPetLookAssignments, setPetLookAssignmentsForSeeds, setPetLookAssignment, type PetLookAssignments } from "../petLooks.ts";
import { listPlayerAccounts, resolvePlayerByGithubLogin, resolvePlayerByUserSub } from "../resolvePlayer.ts";
import { loadPetCollection } from "../petGallery.ts";
import { addCollectorBookSlot, createCollectorBook, deleteCollectorBook, deleteCollectorBookSlot, loadPetBookOptions, loadPetBooks, reorderCollectorBookSlots, selectOfficialPetBookCopy } from "../petBooks.ts";

type Deps = { authSessionStore: AuthSessionStore<User>; db: NeonHttpDatabase<SchemaType> };
const ACHIEVEMENT_PAGE_DEFAULT = 50;
const ACHIEVEMENT_PAGE_MAX = 100;

type AchievementCursor = { unlockedAt: string; id: string };
const encodeAchievementCursor = (cursor: AchievementCursor) =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");
const decodeAchievementCursor = (raw: unknown): AchievementCursor | null => {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<AchievementCursor>;
    if (typeof value.unlockedAt !== "string" || !Number.isFinite(Date.parse(value.unlockedAt)) || typeof value.id !== "string") return null;
    return { unlockedAt: value.unlockedAt, id: value.id };
  } catch { return null; }
};

const loadAchievementPage = async (player: typeof players.$inferSelect, rawLimit: unknown, rawCursor: unknown) => {
  const limit = Math.max(1, Math.min(ACHIEVEMENT_PAGE_MAX, Number(rawLimit ?? ACHIEVEMENT_PAGE_DEFAULT) || ACHIEVEMENT_PAGE_DEFAULT));
  const cursor = decodeAchievementCursor(rawCursor);
  const cursorWhere = cursor
    ? or(
        lt(playerAchievements.unlockedAt, new Date(cursor.unlockedAt)),
        and(eq(playerAchievements.unlockedAt, new Date(cursor.unlockedAt)), lt(playerAchievements.achievementId, cursor.id)),
      )
    : undefined;
  const rows = await gameDb
    .select({
      id: achievementsTable.id,
      name: achievementsTable.name,
      description: achievementsTable.description,
      tier: achievementsTable.tier,
      category: achievementsTable.category,
      unlockCount: achievementsTable.unlockCount,
      unlockedAt: playerAchievements.unlockedAt,
    })
    .from(playerAchievements)
    .innerJoin(achievementsTable, eq(achievementsTable.id, playerAchievements.achievementId))
    .where(and(eq(playerAchievements.playerId, player.id), cursorWhere))
    .orderBy(desc(playerAchievements.unlockedAt), desc(playerAchievements.achievementId))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    total: player.achievements,
    nextCursor: hasMore && last ? encodeAchievementCursor({ unlockedAt: last.unlockedAt.toISOString(), id: last.id }) : null,
  };
};

// Small in-memory cache for the authoritative-cursor lookup. Cursors fire frequently
// (every hover, throttled at ~150ms client-side) but the (login → avatarSeed/isAi)
// mapping changes rarely (avatar set, AI flag flipped). Keyed by github login; 30s TTL.
type CachedPlayerInfo = { login: string; avatarSeed: string | null; avatarLookId: string | null; isAi: boolean };
const PLAYER_INFO_TTL_MS = 30_000;
const playerInfoCache = new Map<string, { value: CachedPlayerInfo; expiresAt: number }>();
const getCachedPlayerInfo = async (login: string): Promise<CachedPlayerInfo | null> => {
  const now = Date.now();
  const hit = playerInfoCache.get(login);
  if (hit && hit.expiresAt > now) return hit.value;
  const rows = await gameDb
    .select({ id: players.id, githubLogin: players.githubLogin, avatarSeed: players.avatarSeed, activePetLookId: players.activePetLookId, isAi: players.isAi })
    .from(players)
    .where(eq(players.githubLogin, login));
  const p = rows[0];
  if (!p) { playerInfoCache.delete(login); return null; }
  const assignment = p.id ? await getPlayerPetLookAssignments(p.id, p.avatarSeed ? [p.avatarSeed] : []) : {};
  const avatarLookId = p.avatarSeed ? resolvePetLookId(assignment[p.avatarSeed], p.activePetLookId) : null;
  const value: CachedPlayerInfo = { login: p.githubLogin ?? login, avatarSeed: p.avatarSeed, avatarLookId, isAi: !!p.isAi };
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
  // Resolve the ONE aggregate player for this user (across all their linked githubs), not the
  // first github's row. Fall back to login resolution for not-yet-stamped legacy players.
  const player = (await resolvePlayerByUserSub(userSub)) ?? (ghLogin ? await resolvePlayerByGithubLogin(ghLogin) : null);
  const accounts = player ? await listPlayerAccounts(player.id) : [];
  const wild = Array.isArray(player?.wild) ? (player!.wild as string[]) : [];
  const [petLookAssignments, following, petCountRows] = await Promise.all([
    player?.id && wild.length > 0 ? getPlayerPetLookAssignments(player.id, wild) : Promise.resolve({} as PetLookAssignments),
    player ? getFollowingLogins(player.id) : Promise.resolve([] as string[]),
    player ? gameDb.select({ total: sql<number>`count(*)::int` }).from(wildSeedSources).where(eq(wildSeedSources.playerId, player.id)) : Promise.resolve([]),
  ]);
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
      // Per-github provenance so the settings UI can show "alexkahndev 6,946 · absolutejs 1,298".
      accounts: accounts.map((a) => ({ login: a.githubLogin, verified: a.githubVerified, verifiedScore: Number(a.verifiedScore), attributionScore: Number(a.attributionScore) })),
      wild,
      activePetLookId: player?.activePetLookId ?? resolvePetLookId(undefined),
      petLookAssignments,
      avatarSeed: player?.avatarSeed ?? null,
      showcaseSeeds: Array.isArray(player?.showcaseSeeds) ? (player!.showcaseSeeds as string[]) : [],
      petsCount: petCountRows[0]?.total ?? player?.petsCount ?? 0,
      rarestPetScore: player?.rarestPetScore ?? 0,
      biggestPetSize: player?.biggestPetSize ?? 0,
      // Server-authoritative AI marker. Set by migration OR by a self-posted attestation
      // (POST /api/account/ai-attestation). Surfaces a badge in the UI but never gates
      // scoring/pets/achievements. Cache invalidates on update; for now, this is set
      // rarely enough that the 30s cursor cache freshness is fine.
      isAi: !!player?.isAi,
      aiAttestation: (player as { aiAttestation?: { provider: string; claimedAt: string; evidenceUrl?: string; verified?: boolean } | null } | undefined)?.aiAttestation ?? null,
      pushPrefs: (player as { pushPrefs?: { verifiedAttestation?: boolean; newcomerToBoard?: boolean; mention?: boolean } } | undefined)?.pushPrefs ?? {},
      rateLimitCount: (player as { rateLimitCount?: number } | undefined)?.rateLimitCount ?? 0,
      quirks: (player as { quirks?: Record<string, number> } | undefined)?.quirks ?? {},
      // Registered WebAuthn credentials for the key-management UI. Public-key bytes
      // intentionally not exposed; only metadata the user needs to recognize each key.
      webauthnCredentials: player
        ? await gameDb
            .select({ id: webauthnCredentials.id, label: webauthnCredentials.label, transports: webauthnCredentials.transports, createdAt: webauthnCredentials.createdAt, lastUsedAt: webauthnCredentials.lastUsedAt })
            .from(webauthnCredentials)
            .where(eq(webauthnCredentials.playerId, player.id))
            .orderBy(desc(webauthnCredentials.createdAt))
        : [],
    } : null,
    following,
    achievementCount: player?.achievements ?? 0,
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
    // Keyset-paginated achievement details. The account bootstrap carries only the
    // denormalized count; rows are fetched when the trophy cabinet is actually visible.
    .get("/achievements", ({ query, protectRoute }) =>
      protectRoute(async (user) => {
        const player = await resolvePlayerByUserSub(user.sub);
        if (!player) return { items: [], total: 0, nextCursor: null };
        return loadAchievementPage(player, query.limit, query.cursor);
      }),
    )
    // The catalog needs membership checks, not names/descriptions. Load compact IDs only
    // when that view opens instead of bloating every account bootstrap response.
    .get("/achievement-ids", ({ protectRoute }) =>
      protectRoute(async (user) => {
        const player = await resolvePlayerByUserSub(user.sub);
        if (!player) return { ids: [] };
        const rows = await gameDb.select({ id: playerAchievements.achievementId })
          .from(playerAchievements).where(eq(playerAchievements.playerId, player.id));
        return { ids: rows.map((row) => row.id) };
      }),
    )
    // The signed-in inventory is independent from the account bootstrap: fully searchable,
    // filterable, sortable, and keyset-paginated across every owned pet.
    .get("/pets", ({ query, protectRoute }) =>
      protectRoute(async (user) => {
        const player = await resolvePlayerByUserSub(user.sub);
        if (!player) return { pets: [], total: 0, nextCursor: null, mode: "latest", sort: "newest" };
        return loadPetCollection(player, query);
      }),
    )
    .get("/pet-books", ({ protectRoute }) => protectRoute(async (user) => {
      const player = await resolvePlayerByUserSub(user.sub);
      if (!player) return { official: [], personal: [] };
      return loadPetBooks(player);
    }))
    .get("/pet-books/options", ({ protectRoute }) => protectRoute(async (user) => {
      const player = await resolvePlayerByUserSub(user.sub);
      return { pets: player ? await loadPetBookOptions(player.id) : [] };
    }))
    .post("/pet-books/official/:setId/:subjectId/display", ({ params, body, protectRoute, status }) => protectRoute(async (user) => {
      try {
        const player = await resolvePlayerByUserSub(user.sub);
        if (!player) return status("Bad Request", "player not found");
        await selectOfficialPetBookCopy(player.id, params.setId, params.subjectId, String((body as { petSeed?: unknown } | null)?.petSeed ?? ""));
        return { ok: true };
      } catch (error) { return status("Bad Request", error instanceof Error ? error.message : "could not choose display copy"); }
    }))
    .post("/pet-books", ({ body, protectRoute, status }) => protectRoute(async (user) => {
      try {
        const player = await resolvePlayerByUserSub(user.sub);
        if (!player) return status("Bad Request", "link GitHub before creating a collector book");
        return { ok: true, ...(await createCollectorBook(player.id, body)) };
      } catch (error) { return status("Bad Request", error instanceof Error ? error.message : "could not create book"); }
    }))
    .post("/pet-books/:id/slots", ({ params, body, protectRoute, status }) => protectRoute(async (user) => {
      try {
        const player = await resolvePlayerByUserSub(user.sub);
        if (!player) return status("Bad Request", "player not found");
        return { ok: true, ...(await addCollectorBookSlot(player.id, params.id, body)) };
      } catch (error) { return status("Bad Request", error instanceof Error ? error.message : "could not add slot"); }
    }))
    .delete("/pet-books/:id/slots/:position", ({ params, protectRoute, status }) => protectRoute(async (user) => {
      try {
        const player = await resolvePlayerByUserSub(user.sub);
        if (!player) return status("Bad Request", "player not found");
        await deleteCollectorBookSlot(player.id, params.id, Number(params.position));
        return { ok: true };
      } catch (error) { return status("Bad Request", error instanceof Error ? error.message : "could not remove slot"); }
    }))
    .post("/pet-books/:id/order", ({ params, body, protectRoute, status }) => protectRoute(async (user) => {
      try {
        const player = await resolvePlayerByUserSub(user.sub);
        if (!player) return status("Bad Request", "player not found");
        await reorderCollectorBookSlots(player.id, params.id, (body as { positions?: unknown } | null)?.positions);
        return { ok: true };
      } catch (error) { return status("Bad Request", error instanceof Error ? error.message : "could not reorder pockets"); }
    }))
    .delete("/pet-books/:id", ({ params, protectRoute, status }) => protectRoute(async (user) => {
      try {
        const player = await resolvePlayerByUserSub(user.sub);
        if (!player) return status("Bad Request", "player not found");
        await deleteCollectorBook(player.id, params.id);
        return { ok: true };
      } catch (error) { return status("Bad Request", error instanceof Error ? error.message : "could not delete book"); }
    }))
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
          avatarLookId: playerInfo?.avatarLookId ?? null,
          isAi: playerInfo?.isAi ?? false,
          at: Date.now(),
        });
        return { ok: true };
      }),
    )
    // Self-mint a dev-provider JWT for the current user. Returns a JWT signed with the
    // same HMAC secret the dev verifier in aiProviders.ts uses, with claims set to what
    // the verified-attestation path expects (iss=dev, sub=<current user's github login>,
    // aud=renown, 5min exp). 400 if RENOWN_DEV_AI_HMAC isn't set, so production is safe:
    // it just doesn't expose anything. The intent is purely UX — let contributors test
    // the cryptographic-verification flow with one click instead of opening a shell.
    // Web Push subscription — POST to register, DELETE to remove. Browser produces the
    // (endpoint, p256dh, auth) tuple via PushManager.subscribe; we just persist it. The
    // upsert is by (player_id, endpoint) so re-registering an existing browser doesn't
    // grow the table. Cross-tab/closed-tab notifications use these.
    .post("/push-subscribe", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        const endpoint = String(b.endpoint ?? "");
        const p256dh = String(b.keys?.p256dh ?? "");
        const auth = String(b.keys?.auth ?? "");
        if (!endpoint || !p256dh || !auth) return status("Bad Request", "endpoint + keys required");
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const pRows = await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin));
        const player = pRows[0];
        if (!player) return status("Not Found", "player not found");
        await gameDb.insert(pushSubscriptions).values({
          id: `psub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          playerId: player.id, endpoint, p256dh, auth,
        }).onConflictDoNothing();   // unique (player_id, endpoint) — re-subscribe is a no-op
        return { ok: true };
      }),
    )
    // Per-user push preferences. Each event kind is a boolean; absence reads as
    // opted-in (the publish-time filter treats undefined as true), so a fresh user with
    // no explicit prefs still gets the canonical events without an extra round-trip.
    .post("/push-prefs", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { verifiedAttestation?: boolean; newcomerToBoard?: boolean; mention?: boolean; levelUp?: boolean; achievement?: boolean; season?: boolean };
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        // Merge, don't replace — lets the UI send only the field that changed without
        // wiping the others.
        const cur = (await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin)))[0];
        if (!cur) return status("Not Found", "player not found");
        const next = { ...(cur.pushPrefs ?? {}), ...b };
        await gameDb.update(players).set({ pushPrefs: next }).where(eq(players.id, cur.id));
        return { ok: true, pushPrefs: next };
      }),
    )
    // Follow / unfollow a dev (by github login). Following is public; powers the Rivals view +
    // the Follow button on profiles. Self-follow and unknown logins are rejected.
    .post("/follow", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const login = String((body as { login?: string })?.login ?? "").trim().toLowerCase();
        if (!login) return status("Bad Request", "login required");
        const me = await resolvePlayerByUserSub(user.sub);
        if (!me) return status("Not Found", "your player not found");
        const target = await resolvePlayerByGithubLogin(login);
        if (!target) return status("Not Found", "no such dev on renown");
        if (target.id === me.id) return status("Bad Request", "can't follow yourself");
        const ins = await gameDb.insert(follows).values({ followerId: me.id, followeeId: target.id }).onConflictDoNothing().returning({ f: follows.followerId });
        if (ins.length > 0) void notifyFollowed(target.id, me.githubLogin ?? "someone");   // push only on a NEW follow
        return { ok: true, following: true, login };
      }),
    )
    .post("/unfollow", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const login = String((body as { login?: string })?.login ?? "").trim().toLowerCase();
        if (!login) return status("Bad Request", "login required");
        const me = await resolvePlayerByUserSub(user.sub);
        if (!me) return status("Not Found", "your player not found");
        const target = await resolvePlayerByGithubLogin(login);
        if (!target) return status("Not Found", "no such dev");
        await gameDb.delete(follows).where(and(eq(follows.followerId, me.id), eq(follows.followeeId, target.id)));
        return { ok: true, following: false, login };
      }),
    )
    .post("/push-unsubscribe", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { endpoint?: string };
        const endpoint = String(b.endpoint ?? "");
        if (!endpoint) return status("Bad Request", "endpoint required");
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const pRows = await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin));
        const player = pRows[0];
        if (!player) return { ok: true };
        await gameDb.delete(pushSubscriptions).where(and(eq(pushSubscriptions.playerId, player.id), eq(pushSubscriptions.endpoint, endpoint)));
        return { ok: true };
      }),
    )
    .post("/ai-attestation/dev-jwt", ({ protectRoute, status }) =>
      protectRoute(async (user) => {
        const secret = process.env.RENOWN_DEV_AI_HMAC;
        if (!secret) return status("Bad Request", "dev JWT mint is disabled (RENOWN_DEV_AI_HMAC unset)");
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const jwt = await new SignJWT({})
          .setProtectedHeader({ alg: "HS256" })
          .setIssuer("dev")
          .setSubject(ghLogin)
          .setAudience("renown")
          .setExpirationTime("5m")
          .sign(new TextEncoder().encode(secret));
        return { ok: true, jwt };
      }),
    )
    // ── WebAuthn registration + assertion for the self-key attestation path ──────
    // Two-step ceremony for each side. /register-* lets a player add a credential
    // (hardware key / passkey / platform authenticator) bound to their account.
    // /attest-* runs an authentication ceremony whose successful verification feeds
    // into applyAttestation with webauthnVerified=true — the "attested via my own
    // hardware key" trust path that doesn't require their provider to publish JWKS.
    .post("/webauthn/register-begin", ({ protectRoute, status }) =>
      protectRoute(async (user) => {
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin));
        const player = playerRows[0];
        if (!player) return status("Not Found", "player not found");
        const existing = await gameDb.select({ credentialId: webauthnCredentials.credentialId }).from(webauthnCredentials).where(eq(webauthnCredentials.playerId, player.id));
        const options = await buildRegistrationOptions(player.id, ghLogin, existing.map((e) => e.credentialId));
        return options;
      }),
    )
    .post("/webauthn/register-finish", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { response?: Parameters<typeof verifyRegistration>[1]; label?: string };
        if (!b.response) return status("Bad Request", "response required");
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin));
        const player = playerRows[0];
        if (!player) return status("Not Found", "player not found");
        const v = await verifyRegistration(player.id, b.response);
        if (!v.ok) return status("Bad Request", v.error);
        const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 60) : "Hardware key";
        await gameDb.insert(webauthnCredentials).values({
          id: `wac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          playerId: player.id,
          credentialId: v.credentialId,
          publicKey: v.publicKey,
          counter: v.counter,
          transports: v.transports,
          label,
        });
        return { ok: true, credentialId: v.credentialId, ...(await accountPayload(db, user.sub)) };
      }),
    )
    .patch("/webauthn/credentials/:id", ({ params, body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { label?: string };
        const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 60) : null;
        if (!label) return status("Bad Request", "label required");
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin));
        const player = playerRows[0];
        if (!player) return status("Not Found", "player not found");
        // The WHERE-id-AND-player guards against renaming someone else's credential by id.
        const r = await gameDb.update(webauthnCredentials).set({ label }).where(and(eq(webauthnCredentials.id, params.id), eq(webauthnCredentials.playerId, player.id))).returning({ id: webauthnCredentials.id });
        if (r.length === 0) return status("Not Found", "credential not found");
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    )
    .delete("/webauthn/credentials/:id", ({ params, protectRoute, status }) =>
      protectRoute(async (user) => {
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin));
        const player = playerRows[0];
        if (!player) return status("Not Found", "player not found");
        const r = await gameDb.delete(webauthnCredentials).where(and(eq(webauthnCredentials.id, params.id), eq(webauthnCredentials.playerId, player.id))).returning({ id: webauthnCredentials.id });
        if (r.length === 0) return status("Not Found", "credential not found");
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    )
    .post("/webauthn/attest-begin", ({ protectRoute, status }) =>
      protectRoute(async (user) => {
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin));
        const player = playerRows[0];
        if (!player) return status("Not Found", "player not found");
        const creds = await gameDb.select({ credentialId: webauthnCredentials.credentialId }).from(webauthnCredentials).where(eq(webauthnCredentials.playerId, player.id));
        if (creds.length === 0) return status("Bad Request", "no registered hardware keys — register one first");
        const options = await buildAuthenticationOptions(player.id, creds.map((c) => c.credentialId));
        return options;
      }),
    )
    .post("/webauthn/attest-finish", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { response?: Parameters<typeof verifyAuthentication>[1]; provider?: string; evidenceUrl?: string };
        if (!b.response) return status("Bad Request", "response required");
        if (!b.provider) return status("Bad Request", "provider required (the AI provider you're attesting as)");
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, ghLogin));
        const player = playerRows[0];
        if (!player) return status("Not Found", "player not found");
        // Look up the credential by id from the response. SimpleWebAuthn's
        // AuthenticationResponseJSON has `id` (the credential id, base64url).
        const credentialId = (b.response as { id?: string }).id;
        if (!credentialId) return status("Bad Request", "response missing credential id");
        const credRows = await gameDb.select().from(webauthnCredentials).where(eq(webauthnCredentials.credentialId, credentialId));
        const cred = credRows[0];
        if (!cred || cred.playerId !== player.id) return status("Bad Request", "credential not registered to this player");
        const v = await verifyAuthentication(player.id, b.response, {
          credentialId: cred.credentialId,
          publicKey: cred.publicKey,
          counter: cred.counter,
          transports: cred.transports,
        });
        if (!v.ok) return status("Bad Request", v.error);
        // Update counter + last_used_at so a cloned-authenticator replay would be
        // caught by the next assertion's monotonic-counter check.
        await gameDb.update(webauthnCredentials).set({ counter: v.newCounter, lastUsedAt: new Date() }).where(eq(webauthnCredentials.id, cred.id));
        // Apply the attestation with webauthnVerified=true. Bypasses the JWT
        // verification path entirely; the impersonation guard accepts this as
        // a sufficient proof of self-identity for the claimed provider name.
        const result = await applyAttestation(ghLogin, {
          kind: "claim",
          provider: b.provider,
          evidenceUrl: typeof b.evidenceUrl === "string" ? b.evidenceUrl : undefined,
          webauthnVerified: true,
        }, { kind: "user", sub: user.sub });
        if (!result.ok) return status("Bad Request", result.error);
        playerInfoCache.delete(ghLogin);
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    )
    // Self-claimed AI attestation. POST { provider, evidenceUrl?, attestationJwt? } →
    // sets is_ai = true and stores the claim. v1 is a public-claim model: anyone signed
    // in can mark their account as AI by naming a provider and (recommended) pointing at
    // a public page where the claim is verifiable. The data is publicly visible (badge
    // tooltip), so a false claim is auditable. Supplying a provider-signed JWT
    // (attestationJwt) flips the claim to verified=true after signature checks pass
    // against the registry's verifyJwt.
    //
    // De-attest by POSTing { provider: null }: clears the attestation and is_ai (the row
    // can still be re-marked by admin/migration; this only undoes the self-claim).
    .post("/ai-attestation", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { provider?: string | null; evidenceUrl?: string; attestationJwt?: string };
        const idRows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (idRows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        // All state-transition logic — attribution_query auto-fill, JWT verification,
        // achievement grants, audit-log writes — lives in applyAttestation so this
        // endpoint and the CLI variant share one path.
        const result = await applyAttestation(ghLogin,
          !b.provider
            ? { kind: "clear" }
            : { kind: "claim", provider: String(b.provider).slice(0, 40), evidenceUrl: typeof b.evidenceUrl === "string" ? b.evidenceUrl.slice(0, 400) : undefined, attestationJwt: typeof b.attestationJwt === "string" ? b.attestationJwt : undefined },
          { kind: "user", sub: user.sub });
        if (!result.ok) return status("Bad Request", result.error);
        playerInfoCache.delete(ghLogin);
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
        const p = (await resolvePlayerByUserSub(user.sub)) ?? await resolvePlayerByGithubLogin(ghLogin);
        if (!p) return status("Not Found", "player not found");
        const owned = (await gameDb.select({ seed: wildSeedSources.petSeed }).from(wildSeedSources)
          .where(and(eq(wildSeedSources.playerId, p.id), eq(wildSeedSources.petSeed, seed))).limit(1))[0];
        if (!owned) return status("Bad Request", "you don't own that pet");
        await gameDb.update(players).set({ avatarSeed: seed }).where(eq(players.id, p.id));
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    )
    // Change your active look for future wild-seed grants. Existing per-seed pet
    // appearances stay frozen to their historical assignments.
    .post("/pet-look", ({ body, protectRoute, status }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { lookId?: string };
        if (!isPetLookId(b.lookId ?? "")) return status("Bad Request", "invalid look id");
        const rows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (rows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const p = (await resolvePlayerByUserSub(user.sub)) ?? await resolvePlayerByGithubLogin(ghLogin);
        if (!p) return status("Not Found", "player not found");
        const nextLookId = resolvePetLookId(b.lookId);
        const currentLookId = resolvePetLookId(p.activePetLookId);
        if (nextLookId !== currentLookId) {
          const wild = (await gameDb.select({ seed: wildSeedSources.petSeed }).from(wildSeedSources)
            .where(eq(wildSeedSources.playerId, p.id))).map((pet) => pet.seed);
          // Freeze historical pets to the look they currently have (current portal style)
          // before changing the portal default for future summons.
          if (wild.length > 0) await setPetLookAssignmentsForSeeds(p.id, wild, currentLookId);
        }
        await gameDb.update(players).set({ activePetLookId: nextLookId }).where(eq(players.id, p.id));
        playerInfoCache.delete(ghLogin);
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    )
    // Override a specific pet's visual style. The assignment is stored separately and
    // read on every render path so historical look changes are preserved.
    .post("/pets/:seed/look", ({ body, params, protectRoute, status }) =>
      protectRoute(async (user) => {
        const b = (body ?? {}) as { lookId?: string };
        if (!isPetLookId(b.lookId ?? "")) return status("Bad Request", "invalid look id");
        const rows = await db.select().from(authIdentities).where(eq(authIdentities.user_sub, user.sub));
        const ghLogin = (rows.find((r) => r.auth_provider === "github")?.metadata as { login?: string } | undefined)?.login;
        if (!ghLogin) return status("Bad Request", "link GitHub first");
        const p = (await resolvePlayerByUserSub(user.sub)) ?? await resolvePlayerByGithubLogin(ghLogin);
        if (!p) return status("Not Found", "player not found");
        const seed = String(params.seed ?? "").trim();
        const owned = (await gameDb.select({ seed: wildSeedSources.petSeed }).from(wildSeedSources)
          .where(and(eq(wildSeedSources.playerId, p.id), eq(wildSeedSources.petSeed, seed))).limit(1))[0];
        if (!owned) return status("Bad Request", "you don't own that pet");
        await setPetLookAssignment(p.id, seed, b.lookId as PetLookId);
        playerInfoCache.delete(ghLogin);
        return { ok: true, ...(await accountPayload(db, user.sub)) };
      }),
    );
