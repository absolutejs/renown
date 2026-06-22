// Renown API. Reads hit Neon directly (cheap selects); the write path (/submit) goes
// through the write-behind cache + reactive hub in ../sync.ts so we never hammer Neon
// on the per-tick hot path. Skill levels are computed from the shared core/skills.ts.
import { createNeonAccessTokenStore, hasScopes, resolveApiPrincipal } from "@absolutejs/auth";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { generate } from "../../../../core/procgen.ts";
import { SKILLS, levelForXp, skillProgress, totalLevel } from "../../../../core/skills.ts";
import { achievements, aiAttestationEvents, playerAccounts, playerAchievements, playerAttributionSnapshots, playerProjects, players, projects, wildSeedSources } from "../../../../db/schema.ts";
import { resolvePlayerByGithubLogin } from "../resolvePlayer.ts";
import { fetchRepoImportance, scoreRepoForLogin } from "../repoScore.ts";
import { computeVerifiedSkillXp } from "../skillScore.ts";
import { buildWeeklyDigest, loadRecap } from "../recap.ts";
import { rollupPlayerFromAccounts } from "../playerAccounts.ts";
import { authIdentities, users } from "../../../db/schema.ts";
import { applyAttestation, buildStaleAttestationDigest } from "../attestation.ts";
import { fetchAttributionShas, searchAttributions } from "../attribution.ts";
import { fetchCrossRepoPrsCount, fetchPackageDownloads, fetchPrCounts, fetchPrReviewsCount, MERIT, meritAchievementsToGrant } from "../merit.ts";
import { loadProfile } from "../profile.ts";
import { loadProject, loadTopProjects, normalizeProjectSort, normalizeProjectWindow } from "../project.ts";
import { loadOrg } from "../org.ts";
import { loadAchievement } from "../achievement.ts";
import { loadRivals } from "../rivals.ts";
import { loadVersus } from "../versus.ts";
import { getPushPublicKey, isPushConfigured, notifyNewcomerToBoard } from "../push.ts";
import { getPlayerPetLookAssignmentsForRows, setPetLookAssignmentsForSeeds } from "../petLooks.ts";
import { resolvePetLookId } from "../../../../core/petLooks.ts";
import { QUIRKS } from "../quirks.ts";
import { aggregateSubstance, fetchRecentCommits } from "../substance.ts";

// Deterministic ISO-week index → quirk id rotation so the "quirk of the week" is the
// same for every viewer in the same week, and cycles through the whole registry over
// time. ~52 weeks per year × however many quirks; with 29 quirks each gets featured
// ~1.8× per year. Plenty of variety; predictable enough to be referenceable.
const isoWeekIndex = (d: Date = new Date()): number => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};
import { REVERIFY_COOLDOWN_MS, normalizeTier } from "../billing/tiers";
import { gameDb, grantAchievements, hub, playerCache, submitPlayer, type PlayerSnapshot } from "../sync.ts";
import { verifyGithub } from "../verify.ts";
import { clientIp } from "../rateLimit.ts";
import { matchInflightCarrier } from "../inflightNetworks.ts";

const TOP_MAX = 100, ACH_MAX = 2000;
// Don't re-score the same (player, repo) from CI more than once per window — bounds GitHub API
// spend when a repo gets many pushes in quick succession.
const CI_REPO_COOLDOWN_MS = 10 * 60_000;

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

// Per-process guard so we don't re-run the mile-high grant (a select + insert) on every
// heartbeat submit. grantAchievements is idempotent (onConflictDoNothing), so the only
// cost of a cleared set after restart is one no-op grant per in-flight player. Single-
// instance assumption matches the rest of this file (see sync.ts hub/cache note).
const mileHighGranted = new Set<string>();

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
        // Verified-first: rank by GitHub-scored verified_skill_xp, self-reported as fallback, and
        // verified players only — so a forged /submit skill_xp can't top the board.
        const vExpr = sql<number>`coalesce((${players.verifiedSkillXp} ->> ${skill})::int, 0)`;
        const sExpr = sql<number>`coalesce((${players.skillXp} ->> ${skill})::int, 0)`;
        const rows = await gameDb.select({ id: players.id, name: players.handle, v: vExpr, s: sExpr })
          .from(players).where(eq(players.githubVerified, true)).orderBy(desc(vExpr), desc(sExpr)).limit(n);
        return rows.map((r) => {
          const verified = Number(r.v) > 0;
          const xp = verified ? Number(r.v) : Number(r.s);
          return { id: r.id, name: r.name, skill, xp, level: levelForXp(xp), verified };
        });
      }
      if (query.project) {
        // Verified-first: rank by GitHub-scored verified_xp, then self-reported as fallback, and
        // surface the verified numbers when present so a forged /submit can't top the board.
        const rows = await gameDb.select({ name: players.handle, xp: playerProjects.xp, commits: playerProjects.commits, lines: playerProjects.lines, vXp: playerProjects.verifiedXp, vCommits: playerProjects.verifiedCommits, vLines: playerProjects.verifiedLines })
          .from(playerProjects).innerJoin(players, eq(players.id, playerProjects.playerId))
          .where(eq(playerProjects.projectKey, String(query.project))).orderBy(desc(playerProjects.verifiedXp), desc(playerProjects.xp)).limit(n);
        return rows.map((r) => {
          const verified = Number(r.vXp) > 0;
          return { key: query.project, name: r.name, verified, xp: verified ? Number(r.vXp) : Number(r.xp), commits: verified ? r.vCommits : r.commits, lines: verified ? Number(r.vLines) : Number(r.lines) };
        });
      }
      // Boarded leaderboards: same player pool (github_verified), different sort. Same formula
      // for everyone, no special carve-outs — just a different axis of "best."
      const board = String(query.board ?? "score");
      // Cope leaderboards — board=quirk:<name> orders by players.quirks[name]::int.
      // Validates the name against the registry so a typo doesn't silently fall back
      // to verified_score; returns the verified board if the quirk doesn't exist.
      const quirkPrefix = "quirk:";
      const quirkName = board.startsWith(quirkPrefix) ? board.slice(quirkPrefix.length) : null;
      const quirkOrder = quirkName && QUIRKS[quirkName]
        ? sql<number>`coalesce((${players.quirks} ->> ${quirkName})::int, 0)`
        : null;
      // Merit boards — per-dimension sort. board=merit shows the rolled-up merit_score
      // alone; board=merit:<dim> shows a per-signal board (reviewers, contributors, …).
      // Default "score" board (below) sorts by verified_score + merit_score so the
      // headline leaderboard reflects merit, not just base + attribution.
      const meritPrefix = "merit:";
      const meritDim = board === "merit" ? "merit" : board.startsWith(meritPrefix) ? board.slice(meritPrefix.length) : null;
      // Columns are heterogeneous (bigint / integer / real / etc.) so widen via
      // a plain object indexed by string. Drizzle's desc() accepts any column.
      const meritColMap: Record<string, typeof players.verifiedScore> = {
        merit: players.meritScore as unknown as typeof players.verifiedScore,
        reviews: players.prReviewsCount as unknown as typeof players.verifiedScore,
        crossRepo: players.crossRepoPrsCount as unknown as typeof players.verifiedScore,
        shipper: players.prsMergedCount as unknown as typeof players.verifiedScore,
        downloads: players.packageDownloads as unknown as typeof players.verifiedScore,
        substance: players.substanceScore as unknown as typeof players.verifiedScore,
      };
      const meritOrder = meritDim ? meritColMap[meritDim] : null;
      // Skill boards — board=skill:<id> ranks by that skill's XP (verified-first, self-reported
      // fallback), dynamic like quirk: boards. Polyglot ranks by breadth: distinct skills logged.
      const skillPrefix = "skill:";
      const skillId = board.startsWith(skillPrefix) ? board.slice(skillPrefix.length) : null;
      const skillOrder = skillId
        ? sql<number>`coalesce((${players.verifiedSkillXp} ->> ${skillId})::int, (${players.skillXp} ->> ${skillId})::int, 0)`
        : null;
      // "Generalist" board (board=breadth): distinct skills a player has logged XP in. Named
      // breadth, not polyglot, because there's already a "polyglot" SKILL (language breadth).
      const breadthOrder = sql<number>`(select count(*) from jsonb_each_text(${players.skillXp}) je where je.value::numeric > 0)`;
      const orderCol = quirkOrder ?? meritOrder ?? skillOrder ?? (
        board === "pets-count" ? players.petsCount
        : board === "rarest-pet" ? players.rarestPetScore
        : board === "biggest-pet" ? players.biggestPetSize
        : board === "rate-limited" ? players.rateLimitCount
        : board === "achievements" ? players.achievements
        : board === "breadth" ? breadthOrder
        : sql<number>`${players.verifiedScore} + ${players.meritScore}`   // default "score" board: base + attribution + merit
      );
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
      // ?window=week → past-7-day gain; ?window=season → gain since the 1st of the month (same
      // attribution-snapshot baseline trick, just a different cutoff). Returned as weekXp either way.
      const window = String(query.window ?? "all");
      if ((window === "week" || window === "season") && (board === "score" || query.board === undefined)) {
        const cutoff = window === "season"
          ? `${new Date().toISOString().slice(0, 7)}-01`
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        // Subquery: per-player earliest snapshot's attribution_score in the last 7d.
        // Drizzle SQL builder keeps this typed; the inner select is parameterized.
        const weeklyOrder = sql<number>`(${players.attributionScore} - coalesce((select ${playerAttributionSnapshots.attributionScore} from ${playerAttributionSnapshots} where ${playerAttributionSnapshots.playerId} = ${players.id} and ${playerAttributionSnapshots.snapshotDate} >= ${cutoff} order by ${playerAttributionSnapshots.snapshotDate} asc limit 1), ${players.attributionScore}))`;
        const rows = await gameDb.select({ ...getTableColumns(players), weekXp: weeklyOrder }).from(players).where(where).orderBy(desc(weeklyOrder)).limit(n);
        const petLookAssignmentsByPlayer = await getPlayerPetLookAssignmentsForRows(rows);
        return rows.map((p) => {
          const assignments = petLookAssignmentsByPlayer.get(p.id) ?? {};
          return { id: p.id, name: p.handle, login: p.githubLogin, verified: true, score: Number(p.verifiedScore) + Number(p.meritScore), weekXp: Math.max(0, Number(p.weekXp)), baseScore: p.verifiedScore, meritScore: p.meritScore, tier: normalizeTier(p.tier), isAi: p.isAi, aiAttestation: p.aiAttestation, totalLevel: p.totalLevel, level: p.level, xp: p.xp, streak: p.streak, oss: p.ossCommits, ach: p.achievements, active: p.activeSec, petsCount: p.petsCount, rarestPetScore: p.rarestPetScore, rarestPetSeed: p.rarestPetSeed, biggestPetSize: p.biggestPetSize, biggestPetSeed: p.biggestPetSeed, avatarSeed: p.avatarSeed, rateLimitCount: p.rateLimitCount, quirks: p.quirks, prReviewsCount: p.prReviewsCount, crossRepoPrsCount: p.crossRepoPrsCount, prsMergedCount: p.prsMergedCount, packageDownloads: p.packageDownloads, substanceScore: p.substanceScore, skillXp: p.skillXp ?? {}, distinctSkills: Object.values((p.skillXp as Record<string, number>) ?? {}).filter((v) => Number(v) > 0).length, activePetLookId: p.activePetLookId, petLookAssignments: assignments };
        });
      }
      const rows = await gameDb.select().from(players).where(where).orderBy(desc(orderCol)).limit(n);
      const petLookAssignmentsByPlayer = await getPlayerPetLookAssignmentsForRows(rows);
      return rows.map((p) => {
        const assignments = petLookAssignmentsByPlayer.get(p.id) ?? {};
          return { id: p.id, name: p.handle, login: p.githubLogin, verified: true, score: Number(p.verifiedScore) + Number(p.meritScore), baseScore: p.verifiedScore, meritScore: p.meritScore, tier: normalizeTier(p.tier), isAi: p.isAi, aiAttestation: p.aiAttestation, totalLevel: p.totalLevel, level: p.level, xp: p.xp, streak: p.streak, oss: p.ossCommits, ach: p.achievements, active: p.activeSec, petsCount: p.petsCount, rarestPetScore: p.rarestPetScore, rarestPetSeed: p.rarestPetSeed, biggestPetSize: p.biggestPetSize, biggestPetSeed: p.biggestPetSeed, avatarSeed: p.avatarSeed, rateLimitCount: p.rateLimitCount, quirks: p.quirks, prReviewsCount: p.prReviewsCount, crossRepoPrsCount: p.crossRepoPrsCount, prsMergedCount: p.prsMergedCount, packageDownloads: p.packageDownloads, substanceScore: p.substanceScore, skillXp: p.skillXp ?? {}, distinctSkills: Object.values((p.skillXp as Record<string, number>) ?? {}).filter((v) => Number(v) > 0).length, activePetLookId: p.activePetLookId, petLookAssignments: assignments };
      });
    })
    // Trending repos — the home page's discovery surface. Ranks every repo someone on renown
    // contributes to by total verified XP, each linking to its /project board. Closes the
    // discovery loop: profiles → repos → boards → more profiles.
    .get("/projects/top", async ({ query }) => {
      const n = Math.min(24, Math.max(1, Number(query.n ?? 12)));
      return loadTopProjects(n, normalizeProjectWindow(query.window));
    })
    // A whole org's renown — its repos + top contributors across them. Shared loader (../org.ts).
    .get("/org/:owner", async ({ params }) => {
      const data = await loadOrg(params.owner);
      return data ?? { error: "not found" };
    })
    // One achievement's public share data — catalog + live rarity + recent earners (../achievement.ts).
    .get("/achievement/:id", async ({ params }) => {
      const data = await loadAchievement(params.id);
      return data ?? { error: "not found" };
    })
    // A dev's "rivals" circle — the people they follow + themselves as a mini-board, plus the
    // recent-unlock activity feed among the people they follow. Public (following isn't secret);
    // powers the home Rivals view and a circle-discovery surface. (../rivals.ts)
    .get("/rivals/:login", async ({ params }) => {
      const data = await loadRivals(String(params.login ?? "").toLowerCase());
      return data ?? { error: "not found" };
    })
    // Head-to-head comparison of two devs across every renown dimension, with a verdict. (../versus.ts)
    .get("/vs/:a/:b", async ({ params }) =>
      loadVersus(String(params.a ?? "").toLowerCase(), String(params.b ?? "").toLowerCase()))
    // CI per-repo board sync — powers `renown ci-sync` (the GitHub Action). Given { repo, logins },
    // scores each LINKED contributor's commits in that repo from the GitHub API (the shared craft
    // formula, server's own token) and upserts player_projects. Monotonic: keeps the greatest of
    // (existing, computed) for xp/commits/lines, so CI only ever adds contributors / raises stats,
    // never regresses what the local CLI submitted. Unlinked logins no-op; a per-(player,repo)
    // cooldown bounds GitHub API spend across rapid pushes. No client-supplied scores are trusted.
    .post("/ci/repo-sync", async ({ body }) => {
      const b = (body ?? {}) as { repo?: string; logins?: unknown };
      const m = String(b.repo ?? "").trim().match(/^([^/\s]+)\/([^/\s]+)$/);
      if (!m) return { error: "repo required as owner/name" };
      const [, owner, repo] = m;
      const key = `${owner}/${repo}`, keyLc = key.toLowerCase();
      const logins = Array.isArray(b.logins)
        ? Array.from(new Set(b.logins.map((l) => String(l).trim().toLowerCase()).filter(Boolean))).slice(0, 8)
        : [];
      if (logins.length === 0) return { error: "logins required" };
      const importance = await fetchRepoImportance(owner, repo);   // fetched once for the whole repo
      const results: Array<{ login: string; status: string; xp?: number; commits?: number; lines?: number }> = [];
      for (const login of logins) {
        const player = await resolvePlayerByGithubLogin(login);
        if (!player?.githubVerified) { results.push({ login, status: "unlinked" }); continue; }
        const existing = (await gameDb.select().from(playerProjects).where(and(eq(playerProjects.playerId, player.id), sql`lower(${playerProjects.projectKey}) = ${keyLc}`)).limit(1))[0];
        if (existing && Date.now() - new Date(existing.updatedAt).getTime() < CI_REPO_COOLDOWN_MS) {
          results.push({ login, status: "throttled", xp: Number(existing.verifiedXp || existing.xp), commits: existing.verifiedCommits || existing.commits, lines: Number(existing.verifiedLines || existing.lines) });
          continue;
        }
        const sc = await scoreRepoForLogin(owner, repo, login, { importance });
        if (!sc || sc.commits === 0) { results.push({ login, status: "no-commits" }); continue; }
        await gameDb.insert(projects).values({ key, name: repo, stars: sc.stars, oss: sc.oss })
          .onConflictDoUpdate({ target: projects.key, set: { stars: sql`greatest(${projects.stars}, excluded.stars)`, oss: sql`${projects.oss} or excluded.oss` } });
        // Writes the VERIFIED columns (GitHub-scored, the rank source) monotonically. Also seeds
        // the self-reported columns on first insert so a CI-only contributor still has xp/commits/
        // lines, but never lowers a self-reported value a player already submitted.
        await gameDb.insert(playerProjects).values({ playerId: player.id, projectKey: key, xp: sc.xp, commits: sc.commits, lines: sc.lines, verifiedXp: sc.xp, verifiedCommits: sc.commits, verifiedLines: sc.lines, updatedAt: new Date() })
          .onConflictDoUpdate({ target: [playerProjects.playerId, playerProjects.projectKey], set: { verifiedXp: sql`greatest(${playerProjects.verifiedXp}, excluded.verified_xp)`, verifiedCommits: sql`greatest(${playerProjects.verifiedCommits}, excluded.verified_commits)`, verifiedLines: sql`greatest(${playerProjects.verifiedLines}, excluded.verified_lines)`, updatedAt: sql`now()` } });
        results.push({ login, status: "scored", xp: sc.xp, commits: sc.commits, lines: sc.lines });
      }
      return { ok: true, repo: key, results };
    })
    // Public profile by github login — what others see (avatar, showcase, stats). No PII; just
    // the same public facts already on the leaderboard, plus the curated 3D showcase.
    .get("/profile/:login", async ({ params }) => {
      // Profile data is loaded via the shared loader in ../profile.ts so the
      // /api/profile/:login JSON consumer and the /profile/:login SSR page
      // handler can't drift on what "a profile" is.
      const profile = await loadProfile(params.login);
      if (!profile) return { error: "not found" };
      return profile;
    })
    // Per-repo leaderboard JSON — shared loader (../project.ts), same data the public
    // /project/:owner/:repo page, README badge, and OG card use.
    .get("/project/:owner/:repo", async ({ params, query }) => {
      const data = await loadProject(`${params.owner}/${params.repo}`, normalizeProjectSort(query.sort));
      if (!data) return { error: "not found" };
      return data;
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
      const row = await resolvePlayerByGithubLogin(login);
      if (!row?.githubVerified) return { error: "login ownership not verified (OAuth required)" };
      // Per-account: /verify syncs the github it was called with. That github's own attribution
      // window + score live on its player_accounts row; the player's headline numbers are rolled
      // up across all the user's githubs at the end.
      const acct = (await gameDb.select().from(playerAccounts).where(and(eq(playerAccounts.playerId, row.id), sql`lower(${playerAccounts.githubLogin}) = ${login.toLowerCase()}`)).limit(1))[0];
      const acctQuery = acct?.attributionQuery ?? row.attributionQuery;
      // Refresh cooldown by tier — measured on the synced account's own last verify.
      const cooldown = REVERIFY_COOLDOWN_MS[normalizeTier(row.tier)];
      const acctVerifiedAt = acct?.verifiedAt ?? row.verifiedAt;
      if (acctVerifiedAt && Date.now() - new Date(acctVerifiedAt).getTime() < cooldown) {
        const baseScoreCached = Number(row.verifiedScore) - Number(row.attributionScore);
        return { ok: true, score: row.verifiedScore, baseScore: baseScoreCached, attributionScore: row.attributionScore, attributionDelta: 0, throttled: true, tier: normalizeTier(row.tier) };
      }
      const v = await verifyGithub(login);
      if (!v) return { error: "github verification failed" };
      // Attribution: count NEW commits since max(account_created, account's last sync). The
      // window cap guarantees a resync never double-counts; a long absence backfills correctly.
      let attrDelta = 0;
      let newShas: string[] = [];
      if (acctQuery) {
        const since = acct?.lastAttributionSyncAt ?? row.createdAt;
        attrDelta = await searchAttributions(acctQuery, since);
      // Pet seeds: pull up to 30 fresh SHAs from this window. Each = a unique procgen 1/1.
      if (attrDelta > 0) newShas = await fetchAttributionShas(acctQuery, since, 30);
      }
      // This github's own verified score (base + its attribution); rolls up to the player below.
      const acctAttribution = Number(acct?.attributionScore ?? 0) + attrDelta;
      const acctScore = v.score + acctAttribution;
      // Append new SHAs to the player's wild; cap at the 100 newest so it doesn't grow forever.
      const wild: string[] = Array.isArray(row.wild) ? row.wild : [];
      const mergedWild = Array.from(new Set([...newShas, ...wild])).slice(0, 100);
      const newLookId = resolvePetLookId(row.activePetLookId);
      const newPetSeeds = newShas.slice(0, 6);
      const newPetLooks = Object.fromEntries(newPetSeeds.map((seed) => [seed, newLookId]));
      await setPetLookAssignmentsForSeeds(row.id, newPetSeeds, newLookId);
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
      // Server-verified skill XP — recompute from this github's recent commits using the SAME
      // routing the local engine uses, so /top?skill ranks GitHub-scored skill XP, not /submit's.
      // GUARD: this costs a Search-API call + ~25 commit fetches, so only recompute when there's
      // NEW attribution this sync (attrDelta > 0) or the player has no verified skill XP yet.
      // A no-op CI re-sync (attrDelta 0) skips it — keeping the scarce Search-API budget for real
      // activity. (We're already past the per-tier reverify cooldown here.)
      // Recompute is written to THIS github's account row (overwrite — it's the full recompute for
      // this github, so re-verifying doesn't double-count); rollupPlayerFromAccounts then SUMS
      // per skill across the player's githubs into players.verified_skill_xp. Gate on new attribution
      // (or an account with no skill XP yet) so a no-op CI re-sync skips the ~25-call recompute.
      const acctHasSkill = Object.keys((acct?.verifiedSkillXp as Record<string, number> | null) ?? {}).length > 0;
      const recomputedSkillXp = (attrDelta > 0 || !acctHasSkill) ? await computeVerifiedSkillXp(login).catch((): Record<string, number> => ({})) : null;
      await gameDb.update(players).set({
        avatarSeed: currentAvatar, biggestPetSeed, biggestPetSize,
        petsCount: mergedWild.length, rarestPetScore, rarestPetSeed,
        showcaseSeeds: showcase, verifiedAt: new Date(), wild: mergedWild,
      }).where(eq(players.id, row.id));   // verified_skill_xp is rolled up from accounts below
      // Write THIS github's account row (its score + attribution + sync cursor), tag any new pet
      // seeds with the github that earned them, then roll the player's headline score/attribution
      // up across all the user's linked githubs.
      await gameDb.update(playerAccounts).set({
        verifiedScore: acctScore, attributionScore: acctAttribution, verifiedAt: new Date(),
        lastAttributionSyncAt: acctQuery ? new Date() : acct?.lastAttributionSyncAt ?? null,
        ...(recomputedSkillXp ? { verifiedSkillXp: recomputedSkillXp } : {}),
      }).where(and(eq(playerAccounts.playerId, row.id), sql`lower(${playerAccounts.githubLogin}) = ${login.toLowerCase()}`));
      if (newShas.length > 0) await gameDb.insert(wildSeedSources).values(newShas.map((s) => ({ playerId: row.id, petSeed: s, githubLogin: login }))).onConflictDoNothing();
      const agg = await rollupPlayerFromAccounts(row.id);
      const aggAttribution = agg?.attributionScore ?? acctAttribution;
      const aggScore = agg?.verifiedScore ?? acctScore;
      // Newcomer-to-board push: did this rollup push the player into the top 10? (default-board
      // metric = verified_score + merit_score; merit is unchanged by this verify). No-ops without
      // VAPID and unless the score actually rose into the top N.
      void notifyNewcomerToBoard(row.id, Number(row.verifiedScore) + Number(row.meritScore), Number(aggScore) + Number(row.meritScore));
      // Lazy daily snapshot — one row per (player, calendar day). onConflictDoNothing
      // means we only write the FIRST verify of a day; subsequent verifies don't
      // overwrite it (so the day's baseline stays the day's first reading, and weekly
      // deltas are derived from a consistent series). No cron, no schedule drift.
      const today = new Date().toISOString().slice(0, 10);
      await gameDb.insert(playerAttributionSnapshots)
        .values({ playerId: row.id, snapshotDate: today, attributionScore: aggAttribution, verifiedScore: aggScore })
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
        aggAttribution >= 1     && "better-together",
        aggAttribution >= 100   && "symbiote-100",
        aggAttribution >= 1000  && "symbiote-1k",
        aggAttribution >= 10000 && "cohabit-10k",
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
      return { ok: true, score: aggScore, baseScore: v.score, attributionScore: aggAttribution, attributionDelta: attrDelta, newPets: newShas.length, newPetSeeds, newPetLooks, totalPets: mergedWild.length, rarestPetScore, biggestPetSize, totalStars: v.totalStars, publicRepos: v.publicRepos, extContribs: v.extContribs, accountAgeDays: v.accountAgeDays };
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
      const gh = await r.json() as { login?: string; id?: number };
      const login = gh.login;
      if (!login) return { error: "could not read github login" };
      const subject = gh.id != null ? String(gh.id) : login;   // github numeric id (matches web OAuth); fallback to login
      const handle = login.slice(0, 40);
      const attributionQuery = `author:${login}`;

      // Does this github already map to a player? And what player does this install anchor to?
      const existing = await resolvePlayerByGithubLogin(login);
      const anchor = (await gameDb.select().from(players).where(eq(players.id, playerId)).limit(1))[0] ?? null;

      // If this github already belongs to a DIFFERENT, populated player → don't steal it; the
      // human confirms a merge from the web (stage 4 / auth merge-request flow).
      if (existing && existing.id !== playerId && (Number(existing.verifiedScore) > 0 || (Array.isArray(existing.wild) && existing.wild.length > 0))) {
        return { needsMerge: true, login, otherPlayerId: existing.id, message: "this GitHub is already on another renown account — confirm a merge from the web settings page" };
      }

      // Canonical player = the one this github already maps to, else the local-anchored player,
      // else a fresh row keyed by the local playerId (first-ever link for this install).
      const canonical = existing ?? anchor;
      if (!canonical) {
        await gameDb.insert(players).values({ id: playerId, handle, githubLogin: login, githubVerified: true, attributionQuery })
          .onConflictDoUpdate({ target: players.id, set: { githubLogin: login, githubVerified: true } });
      } else {
        // Don't clobber the primary github_login of an existing player — a 2nd github is secondary.
        await gameDb.update(players).set(canonical.githubLogin ? { githubVerified: true } : { githubVerified: true, githubLogin: login }).where(eq(players.id, canonical.id));
      }
      const playerRow = (await gameDb.select().from(players).where(eq(players.id, canonical?.id ?? playerId)).limit(1))[0]!;
      const isPrimary = !playerRow.githubLogin || playerRow.githubLogin.toLowerCase() === login.toLowerCase();

      // Auth scaffolding so a SECOND github can later attach to the same user. Create the auth
      // user on first link; then every `renown link` from a new github adds its identity here.
      let userSub = playerRow.userSub ?? null;
      if (!userSub) {
        userSub = crypto.randomUUID();
        await gameDb.insert(users).values({ sub: userSub }).onConflictDoNothing();
        await gameDb.update(players).set({ userSub }).where(eq(players.id, playerRow.id));
      }
      await gameDb.insert(authIdentities).values({ id: `github:${subject}`, auth_provider: "github", provider_subject: subject, user_sub: userSub, metadata: { login } }).onConflictDoNothing();

      // Provenance ledger row for this github (per-account scoring lives here; stage 3 rolls up).
      await gameDb.insert(playerAccounts).values({ playerId: playerRow.id, githubLogin: login, attributionQuery, githubVerified: true })
        .onConflictDoUpdate({ target: [playerAccounts.playerId, playerAccounts.githubLogin], set: { githubVerified: true, attributionQuery } });
      if (isPrimary) await gameDb.execute(sql`UPDATE players SET attribution_query = ${attributionQuery} WHERE id = ${playerRow.id} AND attribution_query IS NULL AND is_ai = false`);

      // Verify this github's base score → its per-account row (verified_score = base + this
      // account's own attribution credit, so re-linking the primary never drops its attribution),
      // then roll the player's headline columns up across all accounts.
      const v = await verifyGithub(login);
      if (v) {
        const acct = (await gameDb.select({ attributionScore: playerAccounts.attributionScore }).from(playerAccounts).where(and(eq(playerAccounts.playerId, playerRow.id), eq(playerAccounts.githubLogin, login))).limit(1))[0];
        await gameDb.update(playerAccounts).set({ verifiedScore: v.score + Number(acct?.attributionScore ?? 0), verifiedAt: new Date() }).where(and(eq(playerAccounts.playerId, playerRow.id), eq(playerAccounts.githubLogin, login)));
      }
      const rolled = await rollupPlayerFromAccounts(playerRow.id);
      return { ok: true, login, primary: isPrimary, verifiedScore: rolled?.verifiedScore ?? v?.score ?? 0, playerId: playerRow.id };
    })
    // Generic easter-egg quirk bumper. POST { token, name, count? } increments
    // players.quirks[name] by count, then auto-grants any newly-crossed threshold
    // achievement from the registry in quirks.ts. Hub broadcast lets site-wide
    // listeners (sad-trombone audio, future toasts) react. Unknown quirk names are
    // rejected so a typo can't pollute the jsonb. 200 entries per call max.
    .post("/cli/quirk", async ({ body }) => {
      const b = (body ?? {}) as { token?: string; name?: string; count?: number };
      const token = String(b.token ?? "");
      const name = String(b.name ?? "");
      if (!token || !name) return { error: "token + name required" };
      const def = QUIRKS[name];
      if (!def) return { error: `unknown quirk "${name}". Known: ${Object.keys(QUIRKS).join(", ")}` };
      const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "renown", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!r?.ok) return { error: "invalid or expired github token" };
      const login = (await r.json() as { login?: string }).login;
      if (!login) return { error: "could not read github login" };
      const inc = Math.max(1, Math.min(200, Number(b.count ?? 1)));
      // Atomic increment of the jsonb path. coalesce handles the first-bump case
      // where the key isn't present yet (default to 0 then add).
      const target = await resolvePlayerByGithubLogin(login);
      if (!target) return { error: "player not found — link first via /api/cli/link" };
      const rows = await gameDb.update(players)
        .set({ quirks: sql`jsonb_set(${players.quirks}, ${`{${name}}`}, to_jsonb(coalesce((${players.quirks} ->> ${name})::int, 0) + ${inc}))` })
        .where(eq(players.id, target.id))
        .returning({ id: players.id, quirks: players.quirks });
      const row = rows[0];
      if (!row) return { error: "player not found — link first via /api/cli/link" };
      const total = Number((row.quirks as Record<string, number>)[name] ?? 0);
      // Grant every threshold the new total satisfies. Achievements are
      // onConflictDoNothing so re-fires are free.
      const grantIds = def.tiers.filter((t) => total >= t.threshold).map((t) => t.achievementId);
      const granted = await grantAchievements(row.id, grantIds);
      // Hub broadcast for site-wide reactivity (sad-trombone audio etc.).
      hub.publish("quirk", { login, name, total, granted });
      return { ok: true, name, total, granted };
    })
    // CLI rate-limited ping — the AI session reports "I just got 429'd by my
    // provider." Bumps the counter; the threshold-tier achievements (rate-limited-1
    // / -10 / -100 / -1k) auto-grant on cross. Accepts a count (default 1) so a
    // wrapper batching N rate-limit events into one POST does the right thing.
    .post("/cli/rate-limited", async ({ body }) => {
      const b = (body ?? {}) as { token?: string; count?: number };
      const token = String(b.token ?? "");
      if (!token) return { error: "token required" };
      const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "renown", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!r?.ok) return { error: "invalid or expired github token" };
      const login = (await r.json() as { login?: string }).login;
      if (!login) return { error: "could not read github login" };
      const inc = Math.max(1, Math.min(1000, Number(b.count ?? 1)));
      const target = await resolvePlayerByGithubLogin(login);
      if (!target) return { error: "player not found — link first via /api/cli/link" };
      const rows = await gameDb.update(players).set({ rateLimitCount: sql`${players.rateLimitCount} + ${inc}` }).where(eq(players.id, target.id)).returning({ count: players.rateLimitCount, id: players.id });
      const row = rows[0];
      if (!row) return { error: "player not found — link first via /api/cli/link" };
      const total = Number(row.count);
      // Tier ladder: grant whichever achievements the new total newly satisfies.
      // grantAchievements is idempotent (onConflictDoNothing), so re-running is safe.
      const grantIds = [
        total >= 1    && "rate-limited-1",
        total >= 10   && "rate-limited-10",
        total >= 100  && "rate-limited-100",
        total >= 1000 && "rate-limited-1k",
      ].filter((x): x is string => typeof x === "string");
      const granted = await grantAchievements(row.id, grantIds);
      // Site-wide broadcast — every subscribed browser plays a sad trombone and
      // (when sound is on + we're feeling generous) prints a little toast.
      hub.publish("rate-limited", { login, total, granted });
      return { ok: true, total, granted };
    })
    // CLI pets — return the caller's owned pet seeds plus which one is the avatar and which
    // is the rarest, so `renown pet` / `rarest` / `switch` can render and pick locally
    // (tier/score/name are re-derived from the seed by the deterministic generator).
    .post("/cli/pets", async ({ body }) => {
      const token = String((body as { token?: string } | undefined)?.token ?? "");
      if (!token) return { error: "token required" };
      const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "renown", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!r?.ok) return { error: "invalid or expired github token" };
      const login = (await r.json() as { login?: string }).login;
      if (!login) return { error: "could not read github login" };
      const row = await resolvePlayerByGithubLogin(login);   // resolves across all the user's linked githubs
      if (!row) return { error: "player not found — link first via `renown link`" };
      const wild = Array.isArray(row.wild) ? (row.wild as string[]) : [];
      // Provenance: which linked github earned each seed (for "from @login" in the CLI listing).
      const srcRows = await gameDb.select({ petSeed: wildSeedSources.petSeed, githubLogin: wildSeedSources.githubLogin }).from(wildSeedSources).where(eq(wildSeedSources.playerId, row.id));
      const sources: Record<string, string> = {};
      for (const s of srcRows) sources[s.petSeed] = s.githubLogin;
      return { ok: true, login, wild, avatarSeed: row.avatarSeed, rarestPetSeed: row.rarestPetSeed, petsCount: row.petsCount, sources };
    })
    // CLI avatar — set the caller's avatar (the pet shown on their profile + in `renown pet`)
    // to a seed they own. Mirrors the session-authed /api/account/avatar route. Idempotent.
    .post("/cli/avatar", async ({ body }) => {
      const b = (body ?? {}) as { token?: string; seed?: string };
      const token = String(b.token ?? "");
      const seed = String(b.seed ?? "");
      if (!token) return { error: "token required" };
      if (!seed) return { error: "seed required" };
      const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "renown", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!r?.ok) return { error: "invalid or expired github token" };
      const login = (await r.json() as { login?: string }).login;
      if (!login) return { error: "could not read github login" };
      const row = await resolvePlayerByGithubLogin(login);
      if (!row) return { error: "player not found — link first via `renown link`" };
      const wild = Array.isArray(row.wild) ? (row.wild as string[]) : [];
      if (!wild.includes(seed)) return { error: "you don't own that pet" };
      await gameDb.update(players).set({ avatarSeed: seed }).where(eq(players.id, row.id));
      // (login→avatarSeed) cache lives in authApiPlugin with a 30s TTL — it refreshes on its own.
      return { ok: true, avatarSeed: seed };
    })
    // CLI merit-sync — refreshes all 4 GitHub-native merit signals for the calling
    // login in one shot (PR reviews, cross-repo merged PRs, authored+merged for
    // ratio, npm downloads), recomputes the rolled-up merit_score, grants any
    // newly-crossed tier achievements, hub-publishes for live UI updates. Safe to
    // re-run; signals overwrite (not increment). Costs ≤ 5 HTTP calls upstream.
    .post("/cli/merit-sync", async ({ body }) => {
      const b = (body ?? {}) as { token?: string };
      const token = String(b.token ?? "");
      if (!token) return { error: "token required" };
      const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "renown", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!r?.ok) return { error: "invalid or expired github token" };
      const login = (await r.json() as { login?: string }).login;
      if (!login) return { error: "could not read github login" };
      // Fetch all signals in parallel — they hit separate hosts so no rate-limit
      // collision. Failure of any single signal returns 0 from its fetcher
      // (error-safe), so a partial outage just temporarily zeroes one component.
      const [reviews, crossRepo, prCounts, downloads] = await Promise.all([
        fetchPrReviewsCount(login, token),
        fetchCrossRepoPrsCount(login, token),
        fetchPrCounts(login, token),
        fetchPackageDownloads(login),
      ]);
      // Read current substance_score before recomputing so we don't zero it out
      // on every merit refresh (substance is owned by a separate, slower path —
      // the commit ingestion cron).
      const cur = await resolvePlayerByGithubLogin(login);
      if (!cur) return { error: "player not found — link first via /api/cli/link" };
      // Write the synced signals to THIS github's account row, then roll the player's headline
      // merit columns up across all the user's githubs.
      await gameDb.update(playerAccounts).set({
        prReviewsCount: reviews, crossRepoPrsCount: crossRepo,
        prsAuthoredCount: prCounts.authored, prsMergedCount: prCounts.merged,
        packageDownloads: downloads, lastMeritSyncAt: new Date(),
      }).where(and(eq(playerAccounts.playerId, cur.id), sql`lower(${playerAccounts.githubLogin}) = ${login.toLowerCase()}`));
      const rolled = await rollupPlayerFromAccounts(cur.id);
      const meritScore = rolled?.meritScore ?? 0;
      const grantIds = meritAchievementsToGrant({
        prReviewsCount: rolled?.prReviewsCount ?? 0, crossRepoPrsCount: rolled?.crossRepoPrsCount ?? 0, prsMergedCount: rolled?.prsMergedCount ?? 0,
        packageDownloads: rolled?.packageDownloads ?? 0, substanceScore: rolled?.substanceScore ?? 0, substanceSampleSize: rolled?.substanceSampleSize ?? 0,
      });
      const granted = await grantAchievements(cur.id, grantIds);
      const payload = { login, meritScore, reviews, crossRepo, authored: prCounts.authored, merged: prCounts.merged, downloads, granted };
      hub.publish("merit", payload);
      return { ok: true, ...payload };
    })
    // CLI substance-sync — classifies the player's last N attributed commits by
    // semantic substance (typo vs feature vs refactor vs breaking change), writes
    // the mean to substance_score + sample size to substance_sample_size, then
    // recomputes merit_score so the new substance contribution propagates. Uses
    // the heuristic classifier by default; if RENOWN_EMBEDDING_PROVIDER is set,
    // RAG-based classification via @absolutejs/rag.
    .post("/cli/substance-sync", async ({ body }) => {
      const b = (body ?? {}) as { token?: string; limit?: number };
      const token = String(b.token ?? "");
      if (!token) return { error: "token required" };
      const limit = Math.max(5, Math.min(50, Number(b.limit ?? 30)));
      const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "renown", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!r?.ok) return { error: "invalid or expired github token" };
      const login = (await r.json() as { login?: string }).login;
      if (!login) return { error: "could not read github login" };
      const row = await resolvePlayerByGithubLogin(login);
      if (!row) return { error: "player not found — link first via /api/cli/link" };
      // Classify THIS github's own commits (its account attribution query), write to its account
      // row, then roll the player's substance + merit up across all the user's githubs.
      const acct = (await gameDb.select().from(playerAccounts).where(and(eq(playerAccounts.playerId, row.id), sql`lower(${playerAccounts.githubLogin}) = ${login.toLowerCase()}`)).limit(1))[0];
      const attrQuery = acct?.attributionQuery ?? row.attributionQuery;
      if (!attrQuery) return { error: "no attribution query set — run /api/cli/link first, or set one explicitly" };
      const commits = await fetchRecentCommits(attrQuery, limit, token);
      if (commits.length === 0) return { ok: true, login, substanceScore: row.substanceScore, sampleSize: row.substanceSampleSize, note: "no attributed commits found in the window" };
      const { mean, sampleSize, detail } = await aggregateSubstance(commits);
      await gameDb.update(playerAccounts).set({ substanceScore: mean, substanceSampleSize: sampleSize, lastMeritSyncAt: new Date() })
        .where(and(eq(playerAccounts.playerId, row.id), sql`lower(${playerAccounts.githubLogin}) = ${login.toLowerCase()}`));
      const rolled = await rollupPlayerFromAccounts(row.id);
      const meritScore = rolled?.meritScore ?? 0;
      const grantIds = meritAchievementsToGrant({
        prReviewsCount: rolled?.prReviewsCount ?? 0, crossRepoPrsCount: rolled?.crossRepoPrsCount ?? 0,
        prsMergedCount: rolled?.prsMergedCount ?? 0, packageDownloads: rolled?.packageDownloads ?? 0,
        substanceScore: rolled?.substanceScore ?? 0, substanceSampleSize: rolled?.substanceSampleSize ?? 0,
      });
      const granted = await grantAchievements(row.id, grantIds);
      // Build a small breakdown the CLI/page can show — top reasons + counts
      // so the player can sanity-check what was classified as what.
      const reasons = detail.reduce((m, d) => { m[d.reason] = (m[d.reason] ?? 0) + 1; return m; }, {} as Record<string, number>);
      hub.publish("substance", { login, mean, sampleSize, meritScore, granted });
      return { ok: true, login, substanceScore: mean, sampleSize, meritScore, granted, reasons };
    })
    // Public merit row for a login. Drives the Merit panel on the profile/home
    // page — shows each signal, current sub-counter, next tier threshold, and a
    // hand-curated flavor line from MERIT. Cheap (one select), no auth required.
    .get("/merit/:login", async ({ params }) => {
      const login = String(params.login ?? "").toLowerCase();
      if (!login) return { error: "login required" };
      const row = await resolvePlayerByGithubLogin(login);
      if (!row) return { error: "no merit row yet — run `renown merit-sync` once" };
      // Project each MERIT ladder onto the current value so the UI can render
      // "current / next-threshold / tier" without re-importing the registry.
      const ladders = Object.values(MERIT).map((def) => {
        const sources: Record<typeof def.source, number> = {
          prReviewsCount: row.prReviewsCount, crossRepoPrsCount: row.crossRepoPrsCount,
          prsMergedCount: row.prsMergedCount, packageDownloads: Number(row.packageDownloads),
          substanceScore: row.substanceSampleSize >= 10 ? Math.floor(row.substanceScore * 100) : 0,
        };
        const value = sources[def.source];
        // Tier = highest index whose threshold ≤ value, plus 1 (so 0 if none crossed).
        let tier = 0;
        for (let i = 4; i >= 0; i--) { if (value >= def.thresholds[i]!) { tier = i + 1; break; } }
        const nextThreshold = tier < 5 ? def.thresholds[tier] : null;
        return { id: def.id, label: def.label, flavor: def.flavor, value, tier, nextThreshold };
      });
      const mergeRatio = row.prsAuthoredCount > 0 ? row.prsMergedCount / row.prsAuthoredCount : 0;
      return {
        login,
        meritScore: Number(row.meritScore),
        signals: { reviews: row.prReviewsCount, crossRepo: row.crossRepoPrsCount,
          authored: row.prsAuthoredCount, merged: row.prsMergedCount, mergeRatio,
          downloads: Number(row.packageDownloads),
          substanceScore: row.substanceScore, substanceSampleSize: row.substanceSampleSize },
        ladders,
        lastSyncAt: row.lastMeritSyncAt,
      };
    })
    // Recent unlocks across the whole network — the social-discovery feed. Returns
    // the most recently unlocked achievements with player login + achievement display
    // fields, hidden achievements filtered out so secrets stay secret. Powers the
    // "Live across the network" panel on the home page — visitors see live
    // progression and want to participate. Cheap query (one indexed join), capped at
    // 50; the home page polls every ~10s OR subscribes to the 'unlock' SSE topic.
    .get("/recent-unlocks", async ({ query }) => {
      const limit = Math.min(Number(query.limit ?? 30), 50);
      // Filter: shown-visibility only (hidden/secret stay hidden until the player
      // unlocks them; we don't broadcast someone else's secret unlock). Also exclude
      // players without a github_login (anon submitters) since the feed link target
      // is the profile route.
      const rows = await gameDb.execute(sql`
        SELECT pa.unlocked_at, a.id AS ach_id, a.name AS ach_name, a.tier AS ach_tier, a.category AS ach_category, a.description AS ach_description,
               p.github_login AS login, p.handle AS handle, p.avatar_seed AS avatar_seed, p.is_ai AS is_ai, p.tier AS player_tier
        FROM player_achievements pa
        JOIN achievements a ON a.id = pa.achievement_id
        JOIN players p ON p.id = pa.player_id
        WHERE a.visibility = 'shown'
          AND p.github_login IS NOT NULL
          AND p.github_verified = true
        ORDER BY pa.unlocked_at DESC
        LIMIT ${limit}
      `);
      type Row = { unlocked_at: string | Date; ach_id: string; ach_name: string; ach_tier: string; ach_category: string; ach_description: string; login: string; handle: string; avatar_seed: string | null; is_ai: boolean; player_tier: string };
      const out = (rows.rows as unknown as Row[]).map((r) => ({
        unlockedAt: typeof r.unlocked_at === "string" ? r.unlocked_at : new Date(r.unlocked_at).toISOString(),
        achievement: { id: r.ach_id, name: r.ach_name, tier: r.ach_tier, category: r.ach_category, description: r.ach_description },
        player: { login: r.login, handle: r.handle, avatarSeed: r.avatar_seed, isAi: r.is_ai, tier: normalizeTier(r.player_tier) },
      }));
      return out;
    })
    // Top-N by a specific merit dimension. Powers the per-dimension cope-style
    // leaderboards on the home page ("Top reviewers", "Top maintainers", …).
    .get("/merit/top/:dim", async ({ params, query }) => {
      const dim = String(params.dim ?? "");
      const limit = Math.min(Number(query.limit ?? 25), TOP_MAX);
      const colMap: Record<string, typeof players.verifiedScore> = {
        merit: players.meritScore as unknown as typeof players.verifiedScore,
        reviews: players.prReviewsCount as unknown as typeof players.verifiedScore,
        crossRepo: players.crossRepoPrsCount as unknown as typeof players.verifiedScore,
        shipper: players.prsMergedCount as unknown as typeof players.verifiedScore,
        downloads: players.packageDownloads as unknown as typeof players.verifiedScore,
        substance: players.substanceScore as unknown as typeof players.verifiedScore,
      };
      const col = colMap[dim];
      if (!col) return { error: `unknown dim. try one of: ${Object.keys(colMap).join(", ")}` };
      const rows = await gameDb.select({
        login: players.githubLogin, handle: players.handle, isAi: players.isAi, tier: players.tier,
        value: col,
      }).from(players).where(sql`${col} > 0`).orderBy(desc(col)).limit(limit);
      return { dim, rows: rows.map((r) => ({ ...r, value: Number(r.value) })) };
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
          : { kind: "claim", provider: String(b.provider).slice(0, 40), evidenceUrl: typeof b.evidenceUrl === "string" ? b.evidenceUrl.slice(0, 400) : undefined, attestationJwt: typeof b.attestationJwt === "string" ? b.attestationJwt : undefined },
        { kind: "cli" });
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
    .get("/achievements", async ({ query, set }) => {
      // Rarity drifts slowly + is identical for every viewer → cache it (esp. the compact mode,
      // which full-scans the ~11k-row catalog). The TUI also caches the compact map locally.
      set.headers["cache-control"] = "public, max-age=300";
      const tp = (await gameDb.select({ n: sql<number>`count(*)::int` }).from(players))[0]?.n ?? 0;
      // Compact rarity-only mode: every achievement's rarity % as { id: pct }. Small enough to
      // ship the whole catalog (the TUI caches it), so even RARE badges — which sort below the
      // popularity-capped list below — still get a live %. (The CLI's TUI uses this.)
      if (query.compact) {
        const rows = await gameDb.select({ id: achievements.id, unlocks: achievements.unlockCount }).from(achievements);
        const rarity: Record<string, number> = {};
        for (const r of rows) rarity[r.id] = tp ? +((r.unlocks / tp) * 100).toFixed(1) : 0;
        return { players: tp, rarity };
      }
      const n = Math.min(ACH_MAX, Number(query.n ?? 500));
      const rows = await gameDb.select().from(achievements).orderBy(desc(achievements.unlockCount)).limit(n);
      return { players: tp, achievements: rows.map((r) => ({ id: r.id, name: r.name, tier: r.tier, unlocks: r.unlockCount, rarity: tp ? +((r.unlockCount / tp) * 100).toFixed(1) : 0 })) };
    })
    // Public expiring-soon digest — same shape as the admin endpoint, no auth.
    // Reasoning: the data (login + handle + provider + expiresAt) is already on the
    // public attestation feed; emitting "@claude expires in 3 days" doesn't reveal
    // anything new. Lets the CLI `renown digest-test` preview the payload an operator
    // would wire to their email/Slack/whatever via RENOWN_DIGEST_WEBHOOK.
    .get("/expiring-attestations", async ({ query }) => {
      const days = Math.max(1, Math.min(365, Number(query.withinDays ?? 30)));
      return buildStaleAttestationDigest(days);
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
    // Quirks registry — client-facing list of { id, label, frame } per quirk. Cached
    // for an hour because the registry rarely changes (and requires a deploy when it
    // does). Powers the Quirks dropdown in the cope-leaderboard tab.
    .get("/quirks/list", () => new Response(JSON.stringify(Object.values(QUIRKS).map((q) => ({ id: q.id, label: q.label, frame: q.frame }))), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" } }))
    // Quirk of the week — rotating featured quirk + the player with the highest
    // count for that quirk. Deterministic per ISO week so caches behave; cycles
    // through the whole QUIRKS registry over the year.
    .get("/quirks/featured", async () => {
      const ids = Object.keys(QUIRKS);
      if (ids.length === 0) return { quirk: null, leader: null };
      const week = isoWeekIndex();
      const quirkId = ids[week % ids.length]!;
      const def = QUIRKS[quirkId]!;
      const rows = await gameDb.select({
        login: players.githubLogin,
        avatarSeed: players.avatarSeed,
        count: sql<number>`coalesce((${players.quirks} ->> ${quirkId})::int, 0)`,
      })
        .from(players)
        .where(eq(players.githubVerified, true))
        .orderBy(desc(sql`coalesce((${players.quirks} ->> ${quirkId})::int, 0)`))
        .limit(1);
      const top = rows[0];
      const leader = top && top.count > 0 ? { login: top.login, avatarSeed: top.avatarSeed, count: Number(top.count) } : null;
      return { quirk: { id: def.id, label: def.label, frame: def.frame }, leader, weekIndex: week };
    })
    // Aggregate rate-limit counts per attestation provider. Lets the UI show
    // "anthropic 47k 429s · openai 12k · cursor 3k" — friendly competition for whose
    // model gets throttled the most. Excludes accounts without an attestation since
    // those are public-claim or anonymous.
    .get("/rate-limits/by-provider", async () => {
      const rows = await gameDb.select({
        provider: sql<string>`(${players.aiAttestation} ->> 'provider')`,
        rateLimits: sql<number>`coalesce(sum(${players.rateLimitCount}), 0)::int`,
        players: sql<number>`count(*)::int`,
      })
        .from(players)
        .where(and(eq(players.githubVerified, true), eq(players.isAi, true), sql`${players.aiAttestation} is not null`))
        .groupBy(sql`(${players.aiAttestation} ->> 'provider')`)
        .orderBy(desc(sql`coalesce(sum(${players.rateLimitCount}), 0)`));
      return rows;
    })
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
      // Shared loader (../recap.ts) so this JSON, the /recap/:login share page, and the
      // recap OG card can't drift on what "a week" is.
      const data = await loadRecap(params.login, Number(query.days ?? 7));
      return data ?? { error: "not found" };
    })
    // Preview the weekly recap digest the RENOWN_RECAP_WEBHOOK cron posts (everyone who earned
    // renown this week). Public, read-only — same shape the webhook sends; the CLI/operators can
    // eyeball it before wiring delivery. Recap links use this request's origin.
    .get("/recap-digest", async ({ request, query }) =>
      buildWeeklyDigest(new URL(request.url).origin, Math.max(1, Math.min(90, Number(query.days ?? 7)))))
    // Per-player attribution delta over the past N days (default 7). Used by AccountView's
    // "your growth this week" stat and by anything else that wants a window-relative number
    // without rebuilding the snapshot query. Returns the absolute current attribution_score
    // and the delta (current minus the earliest snapshot in the window).
    .get("/growth/:login", async ({ params, query }) => {
      const days = Math.max(1, Math.min(90, Number(query.days ?? 7)));
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const p = await resolvePlayerByGithubLogin(params.login);
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
    .get("/catalog", async ({ set }) => {
      set.headers["cache-control"] = "public, max-age=300";
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
    .post("/submit", async ({ body, headers, request, server, set }) => {
      // Defense-in-depth: reject oversized payloads up front. A real snapshot (even with
      // the 12k-unlock / 500-skill clamps applied downstream) is well under ~500KB, so a
      // 2MB ceiling never touches legit clients but caps abusive bodies before the write.
      if (Number(headers["content-length"] ?? 0) > 2_000_000) { set.status = 413; return { error: "payload too large" }; }
      const e = body as PlayerSnapshot;
      if (!e?.id) return { error: "bad request" };
      // Open by design — client xp NEVER ranks (only github_verified rows do), so an
      // unauthenticated submit can't game anything. A valid M2M token (renown:submit)
      // just marks the write as first-party-trusted for a caller's own bookkeeping.
      const trusted = hasScopes(await principal(headers.authorization), ["renown:submit"]);
      submitPlayer(e);   // synchronous hot write + live push; Neon persist coalesced behind it
      // Mile High Code Club — server-observed signal (NOT a client field): does this
      // submit's egress IP belong to an in-flight Wi-Fi carrier? If so, you're coding from
      // a plane. Granted off the request's own source IP, so it can't be forged from the
      // payload. The log line captures the exact matched IP/CIDR so we can later tighten
      // the seed (Viasat's full range → just the Fly-Fi egress block) from a real flight.
      if (!mileHighGranted.has(e.id)) {
        const ip = clientIp(request, server ?? null);
        const hit = matchInflightCarrier(ip);
        if (hit) {
          mileHighGranted.add(e.id);
          console.log(`renown: mile-high match player=${e.id} carrier=${hit.carrier.id} ip=${ip} cidr=${hit.cidr}`);
          void grantAchievements(e.id, ["mile-high"]);
        }
      }
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
      const row = await resolvePlayerByGithubLogin(login);
      if (!row?.githubVerified) return { error: "login not github-verified" };
      const v = await verifyGithub(login);
      if (!v) return { error: "github verification failed" };
      await gameDb.update(players).set({ verifiedScore: v.score, verifiedAt: new Date() }).where(eq(players.id, row.id));
      return { ok: true, login, score: v.score };
    });
};
