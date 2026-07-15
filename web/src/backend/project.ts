// Shared per-repo loader — same data served by GET /api/project/:owner/:repo, the public
// /project/:owner/:repo SSR page, the README badge, and the project OG card. One source of
// truth so they can't drift (mirrors profile.ts). Returns null for a repo nobody on renown
// has contributed to (caller decides: soft-200 "not on renown yet" page vs 404 for badge/og).
import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { players, playerProjects, projects } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { fetchAttributedRepositories } from "./attribution.ts";
import { fetchRepoImportance, scoreRepoShas } from "./repoScore.ts";
import { resolvePlayerByGithubLogin } from "./resolvePlayer.ts";
import { gameDb } from "./sync.ts";

export type ProjectData = Awaited<ReturnType<typeof loadProject>>;
export type ProjectSort = "xp" | "commits" | "lines";
const SORT_COL = { xp: playerProjects.xp, commits: playerProjects.commits, lines: playerProjects.lines } as const;
const VERIFIED_COL = { xp: playerProjects.verifiedXp, commits: playerProjects.verifiedCommits, lines: playerProjects.verifiedLines } as const;
export const normalizeProjectSort = (v: unknown): ProjectSort => (v === "commits" || v === "lines" ? v : "xp");

// Revalidate on read as well as ingest. Otherwise a once-public repository that is later made
// private could remain discoverable forever if its contributors stop syncing. The GitHub lookup
// is shared/cached briefly in repoScore.ts; private deletes the board, lookup failure fails closed.
export const confirmProjectPublic = async (key: string): Promise<boolean> => {
  const stored = (await gameDb.select({ visibility: projects.visibility }).from(projects).where(sql`lower(${projects.key}) = ${key.toLowerCase()}`).limit(1))[0];
  if (stored?.visibility !== "public") return false;
  const [owner, ...rest] = key.split("/");
  const repo = rest.join("/");
  const meta = owner && repo ? await fetchRepoImportance(owner, repo) : null;
  if (!meta) {
    await gameDb.update(projects).set({ visibility: "unknown" }).where(sql`lower(${projects.key}) = ${key.toLowerCase()}`);
    return false;
  }
  if (meta.private) {
    await gameDb.delete(projects).where(sql`lower(${projects.key}) = ${key.toLowerCase()}`);
    return false;
  }
  await gameDb.update(projects).set({ visibility: "public", stars: meta.stars, oss: meta.oss }).where(sql`lower(${projects.key}) = ${key.toLowerCase()}`);
  return true;
};

export const loadProject = async (key: string, sort: ProjectSort = "xp") => {
  const k = key.toLowerCase();
  const proj = (await gameDb.select().from(projects).where(sql`lower(${projects.key}) = ${k}`).limit(1))[0];
  if (!proj || proj.visibility !== "public") return null;
  if (!(await confirmProjectPublic(proj.key))) return null;

  // Contributors to THIS repo. Ranked VERIFIED-FIRST: by the chosen metric's GitHub-scored
  // (verified_*) column, then self-reported as a fallback — so a CI-verified contributor always
  // outranks a self-reported /submit, no matter how inflated the self-report. Verified players only.
  const rows = await gameDb.select({
    login: players.githubLogin, handle: players.handle, avatarSeed: players.avatarSeed,
    isAi: players.isAi, tier: players.tier,
    xp: playerProjects.xp, commits: playerProjects.commits, lines: playerProjects.lines,
    vXp: playerProjects.verifiedXp, vCommits: playerProjects.verifiedCommits, vLines: playerProjects.verifiedLines,
  }).from(playerProjects).innerJoin(players, eq(players.id, playerProjects.playerId))
    .where(and(sql`lower(${playerProjects.projectKey}) = ${k}`, eq(players.githubVerified, true)))
    // Verified bucket first (keyed on verifiedXp, exactly like the `verified` flag below — so the
    // flag and the ranking can never disagree even when sort=commits/lines), then the chosen
    // metric's verified column, then self-reported.
    .orderBy(desc(sql`(${playerProjects.verifiedXp} > 0)`), desc(VERIFIED_COL[sort]), desc(SORT_COL[sort])).limit(50);

  // Effective per-contributor numbers: prefer the verified (GitHub-scored) values; fall back to
  // self-reported for contributors a CI sync hasn't covered yet. `verified` flags which is which.
  const eff = (r: typeof rows[number]) => {
    const verified = Number(r.vXp) > 0;
    return {
      verified,
      xp: verified ? Number(r.vXp) : Number(r.xp),
      commits: verified ? r.vCommits : r.commits,
      lines: verified ? Number(r.vLines) : Number(r.lines),
    };
  };
  // Ranked list = contributors with a github login (so each row links to a real profile);
  // totals count every verified contributor (incl. login-less rows) so the headcount is honest.
  const contributors = rows.filter((r) => r.login).map((r) => {
    const e = eff(r);
    return { login: r.login!, handle: r.handle, avatarSeed: r.avatarSeed, isAi: r.isAi, tier: normalizeTier(r.tier), ...e };
  });
  const [owner, ...rest] = proj.key.split("/");
  const repo = rest.join("/") || proj.key;
  const totals = {
    devs: rows.length,
    verifiedDevs: rows.filter((r) => Number(r.vXp) > 0).length,
    xp: rows.reduce((s, r) => s + eff(r).xp, 0),
    commits: rows.reduce((s, r) => s + eff(r).commits, 0),
    lines: rows.reduce((s, r) => s + eff(r).lines, 0),
  };
  return {
    key: proj.key, owner, repo, name: proj.name, stars: proj.stars, oss: proj.oss, sort,
    contributors, topContributor: contributors[0] ?? null, totals,
  };
};

export type ProjectWindow = "week" | "all";
export const normalizeProjectWindow = (v: unknown): ProjectWindow => (v === "week" ? "week" : "all");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Trending repos for the home page's discovery surface — every repo anyone on renown
// contributes to, each carrying its top contributor's pet so the home page advertises the
// /project boards. Mirrors loadProject's "verified players only" rule so headcounts/totals
// stay consistent.
//   window="all"  → ranked by all-time total verified XP (the craft signal the board uses).
//   window="week" → only repos with contributor activity (player_projects.updatedAt) in the
//                    last 7 days, ranked by how many contributors are active there this week
//                    (XP as tiebreak) — i.e. where renown is actively being earned right now.
export const loadTopProjects = async (limit = 12, window: ProjectWindow = "all") => {
  const recent = window === "week";
  const where = recent
    ? and(eq(players.githubVerified, true), eq(projects.visibility, "public"), gte(playerProjects.updatedAt, new Date(Date.now() - WEEK_MS)))
    : and(eq(players.githubVerified, true), eq(projects.visibility, "public"));
  // Effective XP = the verified (GitHub-scored) value when present, else self-reported — the same
  // verified-preferred rule the /project board uses, so trending reflects trustworthy renown.
  const effXpSum = sql<number>`coalesce(sum(case when ${playerProjects.verifiedXp} > 0 then ${playerProjects.verifiedXp} else ${playerProjects.xp} end), 0)`;
  const devCount = sql`count(distinct ${playerProjects.playerId})`;
  const candidates = await gameDb.select({
    key: playerProjects.projectKey, name: projects.name, stars: projects.stars, oss: projects.oss,
    devs: sql<number>`count(distinct ${playerProjects.playerId})::int`,
    xp: effXpSum,
    commits: sql<number>`coalesce(sum(case when ${playerProjects.verifiedCommits} > 0 then ${playerProjects.verifiedCommits} else ${playerProjects.commits} end), 0)::int`,
  }).from(playerProjects)
    .innerJoin(projects, eq(projects.key, playerProjects.projectKey))
    .innerJoin(players, eq(players.id, playerProjects.playerId))
    .where(where)
    .groupBy(playerProjects.projectKey, projects.name, projects.stars, projects.oss)
    .orderBy(...(recent ? [desc(devCount), desc(effXpSum)] : [desc(effXpSum)]))
    .limit(limit);
  const checks = await Promise.all(candidates.map((r) => confirmProjectPublic(r.key)));
  const agg = candidates.filter((_, i) => checks[i]);
  if (agg.length === 0) return [];

  // Top contributor (login + pet seed) per repo, for the card's pet + "top @x" caption.
  const keys = agg.map((r) => r.key);
  const contribs = await gameDb.select({
    key: playerProjects.projectKey, login: players.githubLogin, avatarSeed: players.avatarSeed,
  }).from(playerProjects).innerJoin(players, eq(players.id, playerProjects.playerId))
    .where(and(inArray(playerProjects.projectKey, keys), eq(players.githubVerified, true)))
    // verified-preferred (matches the board's #1), so the card's pet/top-@ isn't a self-reported inflator.
    .orderBy(desc(sql`case when ${playerProjects.verifiedXp} > 0 then ${playerProjects.verifiedXp} else ${playerProjects.xp} end`));
  const topByKey = new Map<string, { login: string | null; avatarSeed: string | null }>();
  for (const c of contribs) if (!topByKey.has(c.key)) topByKey.set(c.key, { login: c.login, avatarSeed: c.avatarSeed });

  return agg.map((r) => {
    const [owner, ...rest] = r.key.split("/");
    const top = topByKey.get(r.key);
    return {
      key: r.key, owner, repo: rest.join("/") || r.key, name: r.name,
      stars: r.stars, oss: r.oss, devs: Number(r.devs), xp: Number(r.xp), commits: Number(r.commits),
      topLogin: top?.login ?? null, topSeed: top?.avatarSeed ?? null,
    };
  });
};

export type ProjectDirectorySort = "xp" | "devs" | "stars" | "commits";
export const normalizeProjectDirectorySort = (v: unknown): ProjectDirectorySort =>
  v === "devs" || v === "stars" || v === "commits" ? v : "xp";

// Searchable, paged repository directory. The optional contributor filter powers the
// "View all repos" link on a profile without pretending that a GitHub owner search is the
// same thing as the repos someone actually contributed to.
export const loadProjectDirectory = async ({
  query = "", contributor = "", sort = "xp", page = 1, limit = 24,
}: {
  query?: string; contributor?: string; sort?: ProjectDirectorySort; page?: number; limit?: number;
} = {}) => {
  const q = query.trim().slice(0, 100);
  const login = contributor.trim().toLowerCase().slice(0, 100);
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeLimit = Math.min(48, Math.max(1, Math.floor(limit) || 24));
  const contributorPlayer = login ? await resolvePlayerByGithubLogin(login) : null;

  // A named contributor who is not a verified Renown player has no public repo list.
  if (login && (!contributorPlayer || !contributorPlayer.githubVerified)) {
    return { repos: [], query: q, contributor: login, contributorFound: false, sort, page: safePage, hasMore: false };
  }

  const contributorKeys = contributorPlayer
    ? (await gameDb.select({ key: playerProjects.projectKey }).from(playerProjects).where(eq(playerProjects.playerId, contributorPlayer.id))).map((r) => r.key)
    : null;
  if (contributorKeys?.length === 0) {
    return { repos: [], query: q, contributor: login, contributorFound: true, sort, page: safePage, hasMore: false };
  }

  const escapedQuery = q.replace(/[\\%_]/g, "\\$&");
  const search = q ? or(ilike(projects.key, `%${escapedQuery}%`), ilike(projects.name, `%${escapedQuery}%`)) : undefined;
  const where = and(
    eq(players.githubVerified, true),
    eq(projects.visibility, "public"),
    search,
    contributorKeys ? inArray(playerProjects.projectKey, contributorKeys) : undefined,
  );
  const effXpSum = sql<number>`coalesce(sum(case when ${playerProjects.verifiedXp} > 0 then ${playerProjects.verifiedXp} else ${playerProjects.xp} end), 0)`;
  const commitSum = sql<number>`coalesce(sum(case when ${playerProjects.verifiedCommits} > 0 then ${playerProjects.verifiedCommits} else ${playerProjects.commits} end), 0)`;
  const devCount = sql<number>`count(distinct ${playerProjects.playerId})`;
  const order = sort === "devs" ? desc(devCount) : sort === "stars" ? desc(projects.stars) : sort === "commits" ? desc(commitSum) : desc(effXpSum);

  // Fetch one extra row to derive pagination without a separate count query that could leak
  // stale repository identity through search-result counts. Every returned identity is then
  // revalidated against GitHub, matching the privacy boundary used by project/profile pages.
  const candidates = await gameDb.select({
    key: playerProjects.projectKey, name: projects.name, stars: projects.stars, oss: projects.oss,
    devs: sql<number>`count(distinct ${playerProjects.playerId})::int`, xp: effXpSum,
    commits: sql<number>`${commitSum}::int`,
  }).from(playerProjects)
    .innerJoin(projects, eq(projects.key, playerProjects.projectKey))
    .innerJoin(players, eq(players.id, playerProjects.playerId))
    .where(where)
    .groupBy(playerProjects.projectKey, projects.name, projects.stars, projects.oss)
    .orderBy(order, desc(effXpSum), playerProjects.projectKey)
    .limit(safeLimit + 1)
    .offset((safePage - 1) * safeLimit);

  const checks = await Promise.all(candidates.map((r) => confirmProjectPublic(r.key)));
  const publicRows = candidates.filter((_, i) => checks[i]);
  const hasMore = candidates.length > safeLimit;
  const repos = publicRows.slice(0, safeLimit).map((r) => {
    const [owner, ...rest] = r.key.split("/");
    return { ...r, owner, repo: rest.join("/") || r.key, devs: Number(r.devs), xp: Number(r.xp), commits: Number(r.commits) };
  });
  return { repos, query: q, contributor: login, contributorFound: true, sort, page: safePage, hasMore };
};

// Populate public repository associations for identities represented by a GitHub commit-search
// query (notably Claude/Codex co-author trailers). Every key is independently checked through
// GitHub before the shared tables are touched; private repository identities are never stored.
export const syncAttributedProjects = async (
  playerId: string, attributionQuery: string,
  opts?: { token?: string; maxCommits?: number; maxRepos?: number; samplePerRepo?: number; since?: Date | string | null },
) => {
  const token = opts?.token ?? process.env.GITHUB_TOKEN;
  const discovered = await fetchAttributedRepositories(attributionQuery, opts?.maxCommits ?? 500, token, opts?.since);
  let synced = 0, skippedPrivate = 0;
  for (const item of discovered.slice(0, Math.max(1, Math.min(1000, opts?.maxRepos ?? 50)))) {
    const [owner, ...parts] = item.key.split("/");
    const repo = parts.join("/");
    if (!owner || !repo) continue;
    const importance = await fetchRepoImportance(owner, repo, token);
    if (!importance || importance.private) { skippedPrivate++; continue; }
    const score = await scoreRepoShas(owner, repo, item.shas, { token, importance, sample: opts?.samplePerRepo ?? 3, commitCount: item.shas.length });
    if (!score) continue;
    const existing = (await gameDb.select({ key: projects.key }).from(projects).where(sql`lower(${projects.key}) = ${item.key.toLowerCase()}`).limit(1))[0];
    const key = existing?.key ?? item.key;
    await gameDb.insert(projects).values({ key, name: repo, stars: score.stars, oss: score.oss, visibility: "public" })
      .onConflictDoUpdate({ target: projects.key, set: { name: repo, stars: sql`greatest(${projects.stars}, excluded.stars)`, oss: sql`${projects.oss} or excluded.oss`, visibility: "public" } });
    await gameDb.insert(playerProjects).values({
      playerId, projectKey: key, xp: score.xp, commits: score.commits, lines: score.lines,
      verifiedXp: score.xp, verifiedCommits: score.commits, verifiedLines: score.lines, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [playerProjects.playerId, playerProjects.projectKey],
      set: {
        xp: sql`greatest(${playerProjects.xp}, excluded.xp)`, commits: sql`greatest(${playerProjects.commits}, excluded.commits)`, lines: sql`greatest(${playerProjects.lines}, excluded.lines)`,
        verifiedXp: sql`greatest(${playerProjects.verifiedXp}, excluded.verified_xp)`, verifiedCommits: sql`greatest(${playerProjects.verifiedCommits}, excluded.verified_commits)`, verifiedLines: sql`greatest(${playerProjects.verifiedLines}, excluded.verified_lines)`, updatedAt: sql`now()`,
      },
    });
    synced++;
  }
  return { discovered: discovered.length, synced, skippedPrivate };
};

// One-line OG/share description: "12 devs · 48k XP · top @alexkahndev".
export const projectShareSnippet = (p: NonNullable<ProjectData>): string => {
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : String(n));
  const bits = [`${p.totals.devs} dev${p.totals.devs === 1 ? "" : "s"}`];
  if (p.totals.xp > 0) bits.push(`${fmt(p.totals.xp)} XP`);
  if (p.topContributor) bits.push(`top @${p.topContributor.login}`);
  return bits.join(" · ");
};
