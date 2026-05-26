// Renown API. Reads hit Neon directly (cheap selects); the write path (/submit) goes
// through the write-behind cache + reactive hub in ../sync.ts so we never hammer Neon
// on the per-tick hot path. Skill levels are computed from the shared core/skills.ts.
import { createNeonAccessTokenStore, hasScopes, resolveApiPrincipal } from "@absolutejs/auth";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { SKILLS, levelForXp, skillProgress, totalLevel } from "../../../../core/skills.ts";
import { achievements, playerProjects, players } from "../../../../db/schema.ts";
import { searchAttributions } from "../attribution.ts";
import { REVERIFY_COOLDOWN_MS, normalizeTier } from "../billing/tiers";
import { gameDb, playerCache, submitPlayer, type PlayerSnapshot } from "../sync.ts";
import { verifyGithub } from "../verify.ts";

const TOP_MAX = 100, ACH_MAX = 2000;

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
      // THE authoritative leaderboard: only GitHub-verified players, ranked by the
      // server-recomputed verifiedScore — client-submitted xp NEVER affects the ranking.
      const rows = await gameDb.select().from(players).where(eq(players.githubVerified, true)).orderBy(desc(players.verifiedScore)).limit(n);
      return rows.map((p) => ({ id: p.id, name: p.handle, login: p.githubLogin, verified: true, score: p.verifiedScore, tier: normalizeTier(p.tier), totalLevel: p.totalLevel, level: p.level, xp: p.xp, streak: p.streak, oss: p.ossCommits, ach: p.achievements, active: p.activeSec }));
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
      if (row.attributionQuery) {
        const since = row.lastAttributionSyncAt ?? row.createdAt;
        attrDelta = await searchAttributions(row.attributionQuery, since);
      }
      const attributionScore = Number(row.attributionScore) + attrDelta;
      const score = v.score + attributionScore;
      await gameDb.update(players).set({
        attributionScore, lastAttributionSyncAt: row.attributionQuery ? new Date() : row.lastAttributionSyncAt,
        verifiedAt: new Date(), verifiedScore: score,
      }).where(eq(players.id, row.id));
      return { ok: true, score, baseScore: v.score, attributionScore, attributionDelta: attrDelta, totalStars: v.totalStars, publicRepos: v.publicRepos, extContribs: v.extContribs, accountAgeDays: v.accountAgeDays };
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
      await gameDb.insert(players).values({ id: playerId, handle, githubLogin: login, githubVerified: true })
        .onConflictDoUpdate({ target: players.id, set: { githubLogin: login, githubVerified: true } });
      await gameDb.delete(players).where(and(eq(players.githubLogin, login), ne(players.id, playerId)));  // one verified row per login
      const v = await verifyGithub(login);
      if (v) await gameDb.update(players).set({ verifiedScore: v.score, verifiedAt: new Date() }).where(eq(players.id, playerId));
      return { ok: true, login, verifiedScore: v?.score ?? 0 };
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
