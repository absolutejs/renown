// Renown API. Reads hit Neon directly (cheap selects); the write path (/submit) goes
// through the write-behind cache + reactive hub in ../sync.ts so we never hammer Neon
// on the per-tick hot path. Skill levels are computed from the shared core/skills.ts.
import { createNeonAccessTokenStore, hasScopes, resolveApiPrincipal } from "@absolutejs/auth";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { generate } from "../../../../core/procgen.ts";
import { SKILLS, levelForXp, skillProgress, totalLevel } from "../../../../core/skills.ts";
import { achievements, aiAttestationEvents, playerAchievements, playerAttributionSnapshots, playerProjects, players } from "../../../../db/schema.ts";
import { applyAttestation } from "../attestation.ts";
import { fetchAttributionShas, searchAttributions } from "../attribution.ts";
import { getPushPublicKey, isPushConfigured } from "../push.ts";
import { REVERIFY_COOLDOWN_MS, normalizeTier } from "../billing/tiers";
import { gameDb, grantAchievements, hub, playerCache, submitPlayer, type PlayerSnapshot } from "../sync.ts";
import { verifyGithub } from "../verify.ts";

const TOP_MAX = 100, ACH_MAX = 2000;

// In-process tracker for the current weekly AI leader (login → most recent broadcast).
// Single-instance assumption already holds for the rest of sync.ts (in-memory hub +
// write-behind cache); when this app scales horizontally, both this and the hub move
// to Redis cluster pub/sub together. /api/verify recomputes after each successful sync
// and only publishes when the login changes — silent ticks don't spam the SSE topic.
let weeklyAiLeaderLogin: string | null = null;
const recomputeWeeklyAiLeader = async () => {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const weeklyOrder = sql<number>`(${players.attributionScore} - coalesce((select ${playerAttributionSnapshots.attributionScore} from ${playerAttributionSnapshots} where ${playerAttributionSnapshots.playerId} = ${players.id} and ${playerAttributionSnapshots.snapshotDate} >= ${cutoff} order by ${playerAttributionSnapshots.snapshotDate} asc limit 1), ${players.attributionScore}))`;
  const rows = await gameDb.select().from(players)
    .where(and(eq(players.githubVerified, true), eq(players.isAi, true)))
    .orderBy(desc(weeklyOrder))
    .limit(1);
  const top = rows[0];
  if (!top?.githubLogin) return;
  if (top.githubLogin === weeklyAiLeaderLogin) return;
  weeklyAiLeaderLogin = top.githubLogin;
  hub.publish("weekly-ai-leader", {
    login: top.githubLogin,
    verifiedScore: top.verifiedScore,
    isAi: true,
    aiAttestation: top.aiAttestation,
    avatarSeed: top.avatarSeed,
  });
};

type ApiDeps = { accessTokenStore: ReturnType<typeof createNeonAccessTokenStore> };

export const apiPlugin = ({ accessTokenStore }: ApiDeps) => {
  // Resolve an M2M principal from a Bearer access token (minted at /oauth2/token via
  // client_credentials). Cheap: only hits the store when a token is actually presented.
  const principal = (authorization?: string) =>
    authorization ? resolveApiPrincipal({ accessTokenStore, authorization }) : Promise.resolve(undefined);

  return new Elysia({ prefix: "/api" })
    .get("/top", async ({ query }) => {
      const n = Math.min(TOP_MAX, Number(query.n ?? 20));
      if (query.skill) {
        const skill = String(query.skill);
        const xpExpr = sql<number>`coalesce((${players.skillXp} ->> ${skill})::int, 0)`;
        const rows = await gameDb.select({ id: players.id, name: players.handle, xp: xpExpr }).from(players).orderBy(desc(xpExpr)).limit(n);
        return rows.map((r) => ({ id: r.id, name: r.name, skill, xp: r.xp, level: levelForXp(r.xp) }));
      }
      if (query.project) {
        const rows = await gameDb.select({ name: players.handle, xp: playerProjects.xp, commits: playerProjects.commits, lines: playerProjects.lines })
          .from(playerProjects).innerJoin(players, eq(players.id, playerProjects.playerId))
          .where(eq(playerProjects.projectKey, String(query.project))).orderBy(desc(playerProjects.xp)).limit(n);
        return rows.map((r) => ({ key: query.project, ...r }));
      }
      // Boarded leaderboards: same player pool (github_verified), different sort. Same formula
      // for everyone, no special carve-outs — just a different axis of "best."
      const board = String(query.board ?? "score");
      const orderCol = board === "pets-count" ? players.petsCount
        : board === "rarest-pet" ? players.rarestPetScore
        : board === "biggest-pet" ? players.biggestPetSize
        : players.verifiedScore;
      // Audience filter — server-side WHERE so the top-N count stays stable per audience.
      // Default "all" merges humans + AI on one board (no filter); "humans" hides AI
      // entries; "ai" shows only AI entries. AI accounts score / earn / rank identically;
      // this is a viewing preference, not a scoring change.
      const audience = String(query.audience ?? "all");
      const aiFilter = audience === "humans" ? eq(players.isAi, false)
        : audience === "ai" ? eq(players.isAi, true)
        : undefined;
      const where = aiFilter ? and(eq(players.githubVerified, true), aiFilter) : eq(players.githubVerified, true);
      // Weekly window — when ?window=week, sort by the past-7-day attribution_score delta
      // (derived from player_attribution_snapshots) instead of the all-time verified score.
      // Falls back to a player's earliest snapshot in the window if no row exactly 7 days
      // ago exists, so brand-new players still rank by their visible activity. Other
      // boards (pets-count/rarest-pet/biggest-pet) ignore window — those are absolute
      // numbers, not rates.
      const window = String(query.window ?? "all");
      if (window === "week" && (board === "score" || query.board === undefined)) {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        // Subquery: per-player earliest snapshot's attribution_score in the last 7d.
        // Drizzle SQL builder keeps this typed; the inner select is parameterized.
        const weeklyOrder = sql<number>`(${players.attributionScore} - coalesce((select ${playerAttributionSnapshots.attributionScore} from ${playerAttributionSnapshots} where ${playerAttributionSnapshots.playerId} = ${players.id} and ${playerAttributionSnapshots.snapshotDate} >= ${cutoff} order by ${playerAttributionSnapshots.snapshotDate} asc limit 1), ${players.attributionScore}))`;
        const rows = await gameDb.select().from(players).where(where).orderBy(desc(weeklyOrder)).limit(n);
        return rows.map((p) => ({ id: p.id, name: p.handle, login: p.githubLogin, verified: true, score: p.verifiedScore, tier: normalizeTier(p.tier), isAi: p.isAi, aiAttestation: p.aiAttestation, totalLevel: p.totalLevel, level: p.level, xp: p.xp, streak: p.streak, oss: p.ossCommits, ach: p.achievements, active: p.activeSec, petsCount: p.petsCount, rarestPetScore: p.rarestPetScore, rarestPetSeed: p.rarestPetSeed, biggestPetSize: p.biggestPetSize, biggestPetSeed: p.biggestPetSeed, avatarSeed: p.avatarSeed }));
      }
      const rows = await gameDb.select().from(players).where(where).orderBy(desc(orderCol)).limit(n);
      return rows.map((p) => ({ id: p.id, name: p.handle, login: p.githubLogin, verified: true, score: p.verifiedScore, tier: normalizeTier(p.tier), isAi: p.isAi, aiAttestation: p.aiAttestation, totalLevel: p.totalLevel, level: p.level, xp: p.xp, streak: p.streak, oss: p.ossCommits, ach: p.achievements, active: p.activeSec, petsCount: p.petsCount, rarestPetScore: p.rarestPetScore, rarestPetSeed: p.rarestPetSeed, biggestPetSize: p.biggestPetSize, biggestPetSeed: p.biggestPetSeed, avatarSeed: p.avatarSeed }));
    })
    // Public profile by github login — what others see (avatar, showcase, stats). No PII; just
    // the same public facts already on the leaderboard, plus the curated 3D showcase.
    .get("/profile/:login", async ({ params }) => {
      const rows = await gameDb.select().from(players).where(and(eq(players.githubLogin, params.login), eq(players.githubVerified, true)));
      const p = rows[0];
      if (!p) return { error: "not found" };
      // Earned achievements — join player_achievements with the catalog so the response
      // includes display fields (name/description/tier/category) ready for the UI panel.
      // No client-side catalog lookup needed; one round-trip is enough.
      const ach = await gameDb
        .select({ id: achievements.id, name: achievements.name, description: achievements.description, tier: achievements.tier, category: achievements.category, unlockCount: achievements.unlockCount })
        .from(playerAchievements)
        .innerJoin(achievements, eq(achievements.id, playerAchievements.achievementId))
        .where(eq(playerAchievements.playerId, p.id))
        .orderBy(desc(achievements.tier));
      return {
        login: p.githubLogin, handle: p.handle, tier: normalizeTier(p.tier),
        isAi: p.isAi, aiAttestation: p.aiAttestation,
        score: p.verifiedScore, totalLevel: p.totalLevel,
        petsCount: p.petsCount,
        rarestPetScore: p.rarestPetScore, rarestPetSeed: p.rarestPetSeed,
        biggestPetSize: p.biggestPetSize, biggestPetSeed: p.biggestPetSeed,
        avatarSeed: p.avatarSeed, showcaseSeeds: Array.isArray(p.showcaseSeeds) ? p.showcaseSeeds : [],
        achievements: ach,
        // Public audit trail of AI attestation events for this player. Append-only,
        // ordered newest-first. Anyone can read it (transparency is the point); the
        // profile modal renders it as a timeline so claims/verifications/clears are
        // auditable without server access.
        attestationEvents: await gameDb
          .select({ id: aiAttestationEvents.id, at: aiAttestationEvents.at, kind: aiAttestationEvents.kind, provider: aiAttestationEvents.provider, evidenceUrl: aiAttestationEvents.evidenceUrl, verified: aiAttestationEvents.verified })
          .from(aiAttestationEvents)
          .where(eq(aiAttestationEvents.playerId, p.id))
          .orderBy(desc(aiAttestationEvents.at))
          .limit(30),
      };
    })
    // Live ghost-cursors on the leaderboard — anonymous path. POST a hover ping, server
    // fans it to anyone subscribed to `cursors`. Deliberately anonymous: the `sid` is a
    // client-generated per-tab UUID (sessionStorage), no auth and no DB persistence. The
    // labeled variant lives under /api/account/cursor (session-protected, server reads
    // the player row for authoritative label/avatarSeed/isAi) so the badge can never be
    // spoofed by sending a different login here.
    .post("/cursor", ({ body }) => {
      const b = (body ?? {}) as { sid?: string; rowId?: string | null; board?: string };
      const sid = String(b.sid ?? "").slice(0, 40);
      if (!sid) return { ok: false };
      hub.publish("cursors", {
        sid,
        rowId: typeof b.rowId === "string" ? b.rowId.slice(0, 60) : null,
        board: typeof b.board === "string" ? b.board.slice(0, 20) : null,
        label: null,
        avatarSeed: null,
        isAi: false,
        at: Date.now(),
      });
      return { ok: true };
    })
    // Recompute a player's authoritative score from GitHub. Safe to call by anyone (it only
    // pulls from GitHub — no client data is trusted) but only stores for an OAuth-verified
    // login, and is throttled. This is how the leaderboard stays real.
    .post("/verify", async ({ body }) => {
      const login = String((body as { login?: string })?.login ?? "");
      if (!login) return { error: "login required" };
      const row = (await gameDb.select().from(players).where(eq(players.githubLogin, login)))[0];
      if (!row?.githubVerified) return { error: "login ownership not verified (OAuth required)" };
      // Refresh cooldown by tier (cost meter — never changes the score, only how often it refreshes).
      const cooldown = REVERIFY_COOLDOWN_MS[normalizeTier(row.tier)];
      const baseScoreCached = Number(row.verifiedScore) - Number(row.attributionScore);
      if (row.verifiedAt && Date.now() - new Date(row.verifiedAt).getTime() < cooldown) {
        return { ok: true, score: row.verifiedScore, baseScore: baseScoreCached, attributionScore: row.attributionScore, attributionDelta: 0, throttled: true, tier: normalizeTier(row.tier) };
      }
      const v = await verifyGithub(login);
      if (!v) return { error: "github verification failed" };
      // Attribution: count NEW commits since max(account_created, last_attribution_sync). The
      // window cap guarantees a resync never double-counts; a long absence backfills correctly.
      let attrDelta = 0;
      let newShas: string[] = [];
      if (row.attributionQuery) {
        const since = row.lastAttributionSyncAt ?? row.createdAt;
        attrDelta = await searchAttributions(row.attributionQuery, since);
        // Pet seeds: pull up to 30 fresh SHAs from this window. Each = a unique procgen 1/1.
        if (attrDelta > 0) newShas = await fetchAttributionShas(row.attributionQuery, since, 30);
      }
      const attributionScore = Number(row.attributionScore) + attrDelta;
      const score = v.score + attributionScore;
      // Append new SHAs to the player's wild; cap at the 100 newest so it doesn't grow forever.
      const wild: string[] = Array.isArray(row.wild) ? row.wild : [];
      const mergedWild = Array.from(new Set([...newShas, ...wild])).slice(0, 100);
      // Recompute denormalized pet aggregates for the leaderboards (cheap pure generate calls).
      const creatures = mergedWild.map((s) => ({ s, c: generate(s) }));
      const sortedByScore = [...creatures].sort((a, b) => b.c.score - a.c.score);
      const rarestPetScore = sortedByScore[0]?.c.score ?? 0;
      const rarestPetSeed = sortedByScore[0]?.s ?? null;
      // Biggest by sizeN (the numeric voxel-driving size). Tie-break by score so the bigger pet
      // shown is also the more interesting one when several share a size cap.
      const sortedBySize = [...creatures].sort((a, b) => b.c.sizeN - a.c.sizeN || b.c.score - a.c.score);
      const biggestPetSize = sortedBySize[0]?.c.sizeN ?? 0;
      const biggestPetSeed = sortedBySize[0]?.s ?? null;
      // Avatar: keep the player's pick if still owned, else default to the rarest.
      const currentAvatar = row.avatarSeed && mergedWild.includes(row.avatarSeed) ? row.avatarSeed : (sortedByScore[0]?.s ?? null);
      // Showcase: tier-gated slot count, defaulted to top-N by score. Honors a player's explicit
      // pick if they've curated one (length-trimmed to current tier slots).
      const slots = normalizeTier(row.tier) === "pro" ? 8 : normalizeTier(row.tier) === "supporter" ? 4 : 2;
      const currentShowcase: string[] = Array.isArray(row.showcaseSeeds) ? row.showcaseSeeds : [];
      const curated = currentShowcase.filter((s) => mergedWild.includes(s)).slice(0, slots);
      const showcase = curated.length > 0 ? curated : sortedByScore.slice(0, slots).map((x) => x.s);
      await gameDb.update(players).set({
        attributionScore, avatarSeed: currentAvatar, biggestPetSeed, biggestPetSize,
        lastAttributionSyncAt: row.attributionQuery ? new Date() : row.lastAttributionSyncAt,
        petsCount: mergedWild.length, rarestPetScore, rarestPetSeed,
        showcaseSeeds: showcase, verifiedAt: new Date(), verifiedScore: score, wild: mergedWild,
      }).where(eq(players.id, row.id));
      // Lazy daily snapshot — one row per (player, calendar day). onConflictDoNothing
      // means we only write the FIRST verify of a day; subsequent verifies don't
      // overwrite it (so the day's baseline stays the day's first reading, and weekly
      // deltas are derived from a consistent series). No cron, no schedule drift.
      const today = new Date().toISOString().slice(0, 10);
      await gameDb.insert(playerAttributionSnapshots)
        .values({ playerId: row.id, snapshotDate: today, attributionScore, verifiedScore: score })
        .onConflictDoNothing();
      // Attestation expiry sweep — if the verified flag is set with an expiresAt in the
      // past, demote it to a public claim (keep .provider/.claimedAt/.evidenceUrl, strip
      // .verified + .expiresAt). The next attestation POST with a fresh signed JWT re-
      // promotes. Cheaper than a separate scheduled job since /api/verify runs
      // per-player on its own cadence.
      {
        const att = (row as { aiAttestation?: { verified?: boolean; expiresAt?: string; provider?: string; claimedAt?: string; evidenceUrl?: string; webauthnVerified?: boolean } | null }).aiAttestation;
        if (att?.verified && att.expiresAt && Date.parse(att.expiresAt) < Date.now()) {
          const demoted = { provider: att.provider, claimedAt: att.claimedAt, ...(att.evidenceUrl ? { evidenceUrl: att.evidenceUrl } : {}), ...(att.webauthnVerified ? { webauthnVerified: true } : {}) };
          await gameDb.update(players).set({ aiAttestation: demoted as typeof players.$inferInsert["aiAttestation"] }).where(eq(players.id, row.id));
          row.aiAttestation = demoted as typeof row.aiAttestation;
        }
      }
      // Server-evaluated co-author + AI-participation achievements. The catalog rows live
      // in core/achievements/curated.ts with check() = false (the CLI's client-side eval
      // never grants them); this is the authoritative path. grantAchievements is in
      // sync.ts so /api/account/ai-attestation can call the same idempotent grant flow.
      const att = (row as { aiAttestation?: { verified?: boolean } | null }).aiAttestation;
      const grantIds = [
        attributionScore >= 1     && "better-together",
        attributionScore >= 100   && "symbiote-100",
        attributionScore >= 1000  && "symbiote-1k",
        attributionScore >= 10000 && "cohabit-10k",
        !!row.isAi                && "ai-revealed",
        !!att                     && "ai-attested",
        !!att?.verified           && "ai-verified",
      ].filter((x): x is string => typeof x === "string");
      await grantAchievements(row.id, grantIds);
      // Update the live AI-of-the-Week tracker. Cheap (one indexed query); only fans
      // out via SSE when the leader login actually changes.
      void recomputeWeeklyAiLeader();
      // Return the newly-minted SHAs so the client can roll the Summon cinematic. Capped
      // small (<= 6) — the cinematic burns ~2s per pet on-screen so dumping 30 at once
      // would be tedious. Anything beyond the cap still lands in `wild` (the player owns
      // every pet they earned this sync), it just doesn't get a screen-takeover entrance.
      return { ok: true, score, baseScore: v.score, attributionScore, attributionDelta: attrDelta, newPets: newShas.length, newPetSeeds: newShas.slice(0, 6), totalPets: mergedWild.length, rarestPetScore, biggestPetSize, totalStars: v.totalStars, publicRepos: v.publicRepos, extContribs: v.extContribs, accountAgeDays: v.accountAgeDays };
    })
    // Browserless CLI link: the CLI presents its existing GitHub OAuth token (gh auth token).
    // We verify it against GitHub (GET /user) — which PROVES the caller owns that login, no
    // redirect — then make the caller's own player row the canonical verified entry (carrying
    // its local progress) and recompute the authoritative score. This links the renown CLI to
    // a verified identity directly. The token is only used to read the login; it isn't stored.
    .post("/cli/link", async ({ body }) => {
      const { playerId, token } = body as { playerId?: string; token?: string };
      if (!playerId || !token) return { error: "playerId + token required" };
      const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "renown", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!r?.ok) return { error: "invalid or expired github token" };
      const login = (await r.json() as { login?: string }).login;
      if (!login) return { error: "could not read github login" };
      const handle = login.slice(0, 40);
      await gameDb.insert(players).values({ id: playerId, handle, githubLogin: login, githubVerified: true, attributionQuery: `author:${login}` })
        .onConflictDoUpdate({ target: players.id, set: { githubLogin: login, githubVerified: true } });
      await gameDb.delete(players).where(and(eq(players.githubLogin, login), ne(players.id, playerId)));  // one verified row per login
      // Backfill default query for an existing pre-attribution row. AI rows are skipped —
      // their query points at a co-author trailer search, not author:<login>, set by
      // migration/admin/attestation rather than the default path here.
      await gameDb.execute(sql`UPDATE players SET attribution_query = ${`author:${login}`} WHERE id = ${playerId} AND attribution_query IS NULL AND is_ai = false`);
      const v = await verifyGithub(login);
      if (v) await gameDb.update(players).set({ verifiedScore: v.score, verifiedAt: new Date() }).where(eq(players.id, playerId));
      return { ok: true, login, verifiedScore: v?.score ?? 0 };
    })
    // CLI ai-attest: same shape as /api/cli/link — caller proves login ownership with a
    // GitHub OAuth token (`gh auth token`), server verifies it against GitHub, then runs
    // the shared applyAttestation flow (same state transitions / achievement grants /
    // audit-log writes as the web /api/account/ai-attestation endpoint). Lets fully-
    // headless AI agents self-onboard without ever opening the web UI.
    .post("/cli/ai-attest", async ({ body }) => {
      const b = (body ?? {}) as { token?: string; provider?: string | null; evidenceUrl?: string; attestationJwt?: string };
      const token = String(b.token ?? "");
      if (!token) return { error: "token required" };
      // Auth: read the login the token belongs to from GitHub. Same pattern as /cli/link.
      const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "renown", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!r?.ok) return { error: "invalid or expired github token" };
      const login = (await r.json() as { login?: string }).login;
      if (!login) return { error: "could not read github login" };
      const result = await applyAttestation(login,
        !b.provider
          ? { kind: "clear" }
          : { kind: "claim", provider: String(b.provider).slice(0, 40), evidenceUrl: typeof b.evidenceUrl === "string" ? b.evidenceUrl.slice(0, 400) : undefined, attestationJwt: typeof b.attestationJwt === "string" ? b.attestationJwt : undefined });
      if (!result.ok) return { error: result.error };
      return result;
    })
    .get("/skills", async ({ query }) => {
      const id = String(query.id ?? "");
      if (!id) return { error: "id required" };
      const snap = playerCache.peek(id) ?? (await playerCache.get(id));   // hot cache first, Neon on miss
      const skx = snap?.skillXp ?? {};
      return {
        id, name: snap?.name ?? null, totalLevel: totalLevel(skx),
        skills: SKILLS.map((sk) => { const xp = skx[sk.id] ?? 0; const pr = skillProgress(xp); return { id: sk.id, name: sk.name, icon: sk.icon, level: pr.level, pct: pr.pct, xp }; })
      };
    })
    .get("/achievements", async ({ query }) => {
      const n = Math.min(ACH_MAX, Number(query.n ?? 500));
      const tp = (await gameDb.select({ n: sql<number>`count(*)::int` }).from(players))[0]?.n ?? 0;
      const rows = await gameDb.select().from(achievements).orderBy(desc(achievements.unlockCount)).limit(n);
      return { players: tp, achievements: rows.map((r) => ({ id: r.id, name: r.name, tier: r.tier, unlocks: r.unlockCount, rarity: tp ? +((r.unlockCount / tp) * 100).toFixed(1) : 0 })) };
    })
    // Public attestation feed — every AI participant on the platform with a current
    // attestation, ordered by most-recently claimed. Anyone (signed-in or not) can browse
    // it. Each entry exposes the same fields the badge tooltip / profile modal already
    // show; nothing private. Cacheable; the underlying state changes only when someone
    // attests/clears.
    .get("/attestations", async ({ query }) => {
      const n = Math.min(100, Number(query.n ?? 30));
      // ?after=<isoTimestamp> → "give me attestations older than this" — incremental
      // pagination for feed readers catching up without re-pulling. The cursor is the
      // claimedAt timestamp from the previous oldest item.
      const after = typeof query.after === "string" ? query.after : null;
      const conds = [eq(players.githubVerified, true), eq(players.isAi, true), sql`${players.aiAttestation} is not null`];
      if (after) conds.push(sql`(${players.aiAttestation} ->> 'claimedAt') < ${after}`);
      const rows = await gameDb.select().from(players)
        .where(and(...conds))
        .orderBy(desc(sql`(${players.aiAttestation} ->> 'claimedAt')`))
        .limit(n);
      return rows.map((p) => ({
        login: p.githubLogin,
        handle: p.handle,
        avatarSeed: p.avatarSeed,
        verifiedScore: p.verifiedScore,
        attestation: p.aiAttestation,   // { provider, claimedAt, evidenceUrl?, verified? }
      }));
    })
    // Push config — client reads this on mount to know whether push is available + to
    // get the VAPID public key for PushManager.subscribe. Public (no auth) because the
    // public key is meant to be shared; without it, the client just doesn't offer push.
    .get("/push-config", () => ({
      configured: isPushConfigured(),
      publicKey: getPushPublicKey(),
    }))
    // Aggregate counts per attestation provider. Lets the UI show "anthropic: 3 verified
    // / 5 claimed" without each viewer doing the grouping themselves. Tiny query (one
    // group-by on the players table); fine to call on every page render.
    .get("/attestations/by-provider", async () => {
      const rows = await gameDb.select({
        provider: sql<string>`(${players.aiAttestation} ->> 'provider')`,
        claimed: sql<number>`count(*)::int`,
        verified: sql<number>`sum(case when (${players.aiAttestation} ->> 'verified') = 'true' then 1 else 0 end)::int`,
      })
        .from(players)
        .where(and(eq(players.githubVerified, true), eq(players.isAi, true), sql`${players.aiAttestation} is not null`))
        .groupBy(sql`(${players.aiAttestation} ->> 'provider')`)
        .orderBy(desc(sql`count(*)`));
      return rows;
    })
    // Subscribable attestation feeds — JSON Feed 1.1 and RSS 2.0. Same data as
    // /api/attestations but in formats a reader/agent can poll. The Content-Type
    // discriminates: JSON Feed clients read application/feed+json; legacy aggregators
    // read application/rss+xml.
    .get("/attestations/feed.json", async ({ headers, query }) => {
      const PAGE = 50;
      const after = typeof query.after === "string" ? query.after : null;
      const conds = [eq(players.githubVerified, true), eq(players.isAi, true), sql`${players.aiAttestation} is not null`];
      if (after) conds.push(sql`(${players.aiAttestation} ->> 'claimedAt') < ${after}`);
      const rows = await gameDb.select().from(players)
        .where(and(...conds))
        .orderBy(desc(sql`(${players.aiAttestation} ->> 'claimedAt')`))
        .limit(PAGE);
      const host = headers["host"] ?? "renown.local";
      const proto = headers["x-forwarded-proto"] ?? "https";
      const base = `${proto}://${host}`;
      const items = rows.map((p) => {
        const a = p.aiAttestation as { provider: string; claimedAt: string; evidenceUrl?: string; verified?: boolean } | null;
        if (!a) return null;
        const url = `${base}/?profile=${encodeURIComponent(p.githubLogin ?? "")}`;
        const title = `@${p.githubLogin} attested as ${a.provider}${a.verified ? " (verified)" : ""}`;
        return {
          id: `attestation:${p.id}:${a.claimedAt}`,
          url,
          external_url: a.evidenceUrl,
          title,
          content_text: `${title} on renown. Evidence: ${a.evidenceUrl ?? "(none)"}.`,
          date_published: a.claimedAt,
          authors: [{ name: `@${p.githubLogin}`, url }],
          tags: ["ai-participant", a.provider, ...(a.verified ? ["verified"] : ["public-claim"])],
        };
      }).filter((x): x is NonNullable<typeof x> => x !== null);
      // next_url advertised when the page came back full — a follow-up read paged from
      // the oldest item's claimedAt gets the next slice. Empty when likely-fully-drained.
      const oldest = items.at(-1);
      const nextUrl = items.length === PAGE && oldest
        ? `${base}/api/attestations/feed.json?after=${encodeURIComponent(oldest.date_published)}`
        : undefined;
      return new Response(JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        title: "Renown — AI participation feed",
        home_page_url: base,
        feed_url: `${base}/api/attestations/feed.json`,
        ...(nextUrl ? { next_url: nextUrl } : {}),
        description: "Every AI participant on renown with a current attestation. Newest first. Cryptographically-verified claims tagged with 'verified'.",
        items,
      }, null, 2), { headers: { "content-type": "application/feed+json; charset=utf-8" } });
    })
    .get("/attestations/feed.xml", async ({ headers, query }) => {
      const PAGE = 50;
      const after = typeof query.after === "string" ? query.after : null;
      const conds = [eq(players.githubVerified, true), eq(players.isAi, true), sql`${players.aiAttestation} is not null`];
      if (after) conds.push(sql`(${players.aiAttestation} ->> 'claimedAt') < ${after}`);
      const rows = await gameDb.select().from(players)
        .where(and(...conds))
        .orderBy(desc(sql`(${players.aiAttestation} ->> 'claimedAt')`))
        .limit(PAGE);
      const host = headers["host"] ?? "renown.local";
      const proto = headers["x-forwarded-proto"] ?? "https";
      const base = `${proto}://${host}`;
      // Minimal XML escaper — covers the entities relevant to handles, provider names,
      // and free-text titles. No user input goes anywhere unescaped.
      const esc = (s: string) => s.replace(/[&<>'"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "'" ? "&apos;" : "&quot;");
      const oldestRow = rows.at(-1);
      const oldestClaimedAt = oldestRow?.aiAttestation ? (oldestRow.aiAttestation as { claimedAt: string }).claimedAt : null;
      const items = rows.map((p) => {
        const a = p.aiAttestation as { provider: string; claimedAt: string; evidenceUrl?: string; verified?: boolean } | null;
        if (!a) return "";
        const url = `${base}/?profile=${encodeURIComponent(p.githubLogin ?? "")}`;
        const title = `@${p.githubLogin} attested as ${a.provider}${a.verified ? " (verified)" : ""}`;
        const desc = `${title} on renown. Evidence: ${a.evidenceUrl ?? "(none)"}.`;
        const pubDate = new Date(a.claimedAt).toUTCString();
        const guid = `attestation:${p.id}:${a.claimedAt}`;
        return `    <item>
      <title>${esc(title)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="false">${esc(guid)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${esc(desc)}</description>${a.evidenceUrl ? `\n      <source url="${esc(a.evidenceUrl)}">evidence</source>` : ""}
    </item>`;
      }).join("\n");
      // Atom <link rel="next"> when the page came back full — feed readers chain reads
      // by appending ?after=<oldest claimedAt> to walk back through history.
      const nextLink = rows.length === PAGE && oldestClaimedAt
        ? `\n    <atom:link href="${esc(base)}/api/attestations/feed.xml?after=${esc(encodeURIComponent(oldestClaimedAt))}" rel="next" type="application/rss+xml" />`
        : "";
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Renown — AI participation feed</title>
    <link>${esc(base)}</link>
    <description>Every AI participant on renown with a current attestation. Newest first. Cryptographically-verified claims tagged with 'verified'.</description>
    <language>en</language>
    <atom:link href="${esc(base)}/api/attestations/feed.xml" rel="self" type="application/rss+xml" />${nextLink}
${items}
  </channel>
</rss>
`;
      return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
    })
    // "Your week" recap — aggregates several signals over the past N days (default 7).
    // Read-only by login; safe to call public. Used by the AccountView RecapCard and
    // could plug into a future weekly digest email. Snapshots fuel the attribution and
    // verified-score deltas; player_achievements.unlocked_at fuels the newly-earned list.
    .get("/recap/:login", async ({ params, query }) => {
      const days = Math.max(1, Math.min(90, Number(query.days ?? 7)));
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
      const cutoff = new Date(cutoffMs);
      const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, params.login));
      const p = playerRows[0];
      if (!p) return { error: "not found" };
      // Earliest snapshot in window (baseline) — current row is the comparand. If the
      // player has no snapshots in the window (brand new account / quiet week), baseline
      // = current → delta = 0, which is honest.
      const snaps = await gameDb.select().from(playerAttributionSnapshots)
        .where(and(eq(playerAttributionSnapshots.playerId, p.id), sql`${playerAttributionSnapshots.snapshotDate} >= ${cutoffDate}`))
        .orderBy(playerAttributionSnapshots.snapshotDate);
      const baseAttr = snaps[0]?.attributionScore ?? p.attributionScore;
      const baseVer = snaps[0]?.verifiedScore ?? p.verifiedScore;
      const newAch = await gameDb
        .select({ id: achievements.id, name: achievements.name, tier: achievements.tier, category: achievements.category, at: playerAchievements.unlockedAt })
        .from(playerAchievements)
        .innerJoin(achievements, eq(achievements.id, playerAchievements.achievementId))
        .where(and(eq(playerAchievements.playerId, p.id), sql`${playerAchievements.unlockedAt} >= ${cutoff}`))
        .orderBy(desc(playerAchievements.unlockedAt));
      return {
        login: p.githubLogin,
        windowDays: days,
        attributionDelta: Number(p.attributionScore) - Number(baseAttr),
        verifiedDelta: Number(p.verifiedScore) - Number(baseVer),
        currentScore: p.verifiedScore,
        totalLevel: p.totalLevel,
        petsCount: p.petsCount,
        newAchievements: newAch,
        snapshots: snaps.length,
      };
    })
    // Per-player attribution delta over the past N days (default 7). Used by AccountView's
    // "your growth this week" stat and by anything else that wants a window-relative number
    // without rebuilding the snapshot query. Returns the absolute current attribution_score
    // and the delta (current minus the earliest snapshot in the window).
    .get("/growth/:login", async ({ params, query }) => {
      const days = Math.max(1, Math.min(90, Number(query.days ?? 7)));
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, params.login));
      const p = playerRows[0];
      if (!p) return { error: "not found" };
      const snaps = await gameDb.select().from(playerAttributionSnapshots)
        .where(and(eq(playerAttributionSnapshots.playerId, p.id), sql`${playerAttributionSnapshots.snapshotDate} >= ${cutoff}`))
        .orderBy(playerAttributionSnapshots.snapshotDate);
      // baseline = earliest snapshot in window (or current if window is empty — means no
      // delta yet, score is fresh). Delta = current - baseline.
      const baseline = snaps[0]?.attributionScore ?? p.attributionScore;
      return {
        login: p.githubLogin,
        windowDays: days,
        current: p.attributionScore,
        baseline,
        delta: Number(p.attributionScore) - Number(baseline),
        snapshots: snaps.length,
      };
    })
    // Curated catalog for the Catalog view. Returns the ~290 curated rows (generated=false)
    // joined with no per-player state — the client computes locked/unlocked against its own
    // earned set from /api/account or /api/profile, so this endpoint stays cacheable across
    // viewers. Generated achievements (10k+) intentionally skipped — render is too heavy
    // for one page; a later iteration can paginate them.
    .get("/catalog", async () => {
      const tp = (await gameDb.select({ n: sql<number>`count(*)::int` }).from(players))[0]?.n ?? 0;
      const rows = await gameDb.select().from(achievements).where(eq(achievements.generated, false)).orderBy(desc(achievements.unlockCount));
      return {
        players: tp,
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          category: r.category,
          tier: r.tier,
          visibility: r.visibility,
          unlockCount: r.unlockCount,
          rarity: tp ? +((r.unlockCount / tp) * 100).toFixed(1) : 0,
        })),
      };
    })
    .post("/submit", async ({ body, headers }) => {
      const e = body as PlayerSnapshot;
      if (!e?.id) return { error: "bad request" };
      // Open by design — client xp NEVER ranks (only github_verified rows do), so an
      // unauthenticated submit can't game anything. A valid M2M token (renown:submit)
      // just marks the write as first-party-trusted for a caller's own bookkeeping.
      const trusted = hasScopes(await principal(headers.authorization), ["renown:submit"]);
      submitPlayer(e);   // synchronous hot write + live push; Neon persist coalesced behind it
      return { ok: true, trusted };
    })
    // Trusted server-to-server recompute (no per-call throttle, unlike /verify). For first-
    // party services / partner backends that hold a renown M2M client; requires a Bearer
    // access token with the renown:verify scope. Still only pulls from GitHub (authoritative).
    .post("/m2m/recompute", async ({ body, headers, set }) => {
      if (!hasScopes(await principal(headers.authorization), ["renown:verify"])) {
        set.status = 401;
        return { error: "missing M2M token with renown:verify scope" };
      }
      const login = String((body as { login?: string })?.login ?? "");
      if (!login) return { error: "login required" };
      const row = (await gameDb.select().from(players).where(eq(players.githubLogin, login)))[0];
      if (!row?.githubVerified) return { error: "login not github-verified" };
      const v = await verifyGithub(login);
      if (!v) return { error: "github verification failed" };
      await gameDb.update(players).set({ verifiedScore: v.score, verifiedAt: new Date() }).where(eq(players.id, row.id));
      return { ok: true, login, score: v.score };
    });
};
