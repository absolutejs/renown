// Shared per-repo loader — same data served by GET /api/project/:owner/:repo, the public
// /project/:owner/:repo SSR page, the README badge, and the project OG card. One source of
// truth so they can't drift (mirrors profile.ts). Returns null for a repo nobody on renown
// has contributed to (caller decides: soft-200 "not on renown yet" page vs 404 for badge/og).
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { players, playerProjects, projects } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { gameDb } from "./sync.ts";

export type ProjectData = Awaited<ReturnType<typeof loadProject>>;
export type ProjectSort = "xp" | "commits" | "lines";
const SORT_COL = { xp: playerProjects.xp, commits: playerProjects.commits, lines: playerProjects.lines } as const;
const VERIFIED_COL = { xp: playerProjects.verifiedXp, commits: playerProjects.verifiedCommits, lines: playerProjects.verifiedLines } as const;
export const normalizeProjectSort = (v: unknown): ProjectSort => (v === "commits" || v === "lines" ? v : "xp");

export const loadProject = async (key: string, sort: ProjectSort = "xp") => {
  const k = key.toLowerCase();
  const proj = (await gameDb.select().from(projects).where(sql`lower(${projects.key}) = ${k}`).limit(1))[0];
  if (!proj) return null;

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
    .orderBy(desc(VERIFIED_COL[sort]), desc(SORT_COL[sort])).limit(50);

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
    ? and(eq(players.githubVerified, true), gte(playerProjects.updatedAt, new Date(Date.now() - WEEK_MS)))
    : eq(players.githubVerified, true);
  // Effective XP = the verified (GitHub-scored) value when present, else self-reported — the same
  // verified-preferred rule the /project board uses, so trending reflects trustworthy renown.
  const effXpSum = sql<number>`coalesce(sum(case when ${playerProjects.verifiedXp} > 0 then ${playerProjects.verifiedXp} else ${playerProjects.xp} end), 0)`;
  const devCount = sql`count(distinct ${playerProjects.playerId})`;
  const agg = await gameDb.select({
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
  if (agg.length === 0) return [];

  // Top contributor (login + pet seed) per repo, for the card's pet + "top @x" caption.
  const keys = agg.map((r) => r.key);
  const contribs = await gameDb.select({
    key: playerProjects.projectKey, login: players.githubLogin, avatarSeed: players.avatarSeed,
  }).from(playerProjects).innerJoin(players, eq(players.id, playerProjects.playerId))
    .where(and(inArray(playerProjects.projectKey, keys), eq(players.githubVerified, true)))
    .orderBy(desc(playerProjects.xp));
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

// One-line OG/share description: "12 devs · 48k XP · top @alexkahndev".
export const projectShareSnippet = (p: NonNullable<ProjectData>): string => {
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : String(n));
  const bits = [`${p.totals.devs} dev${p.totals.devs === 1 ? "" : "s"}`];
  if (p.totals.xp > 0) bits.push(`${fmt(p.totals.xp)} XP`);
  if (p.topContributor) bits.push(`top @${p.topContributor.login}`);
  return bits.join(" · ");
};
