// Shared per-repo loader — same data served by GET /api/project/:owner/:repo, the public
// /project/:owner/:repo SSR page, the README badge, and the project OG card. One source of
// truth so they can't drift (mirrors profile.ts). Returns null for a repo nobody on renown
// has contributed to (caller decides: soft-200 "not on renown yet" page vs 404 for badge/og).
import { and, desc, eq, sql } from "drizzle-orm";
import { players, playerProjects, projects } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { gameDb } from "./sync.ts";

export type ProjectData = Awaited<ReturnType<typeof loadProject>>;
export type ProjectSort = "xp" | "commits" | "lines";
const SORT_COL = { xp: playerProjects.xp, commits: playerProjects.commits, lines: playerProjects.lines } as const;
export const normalizeProjectSort = (v: unknown): ProjectSort => (v === "commits" || v === "lines" ? v : "xp");

export const loadProject = async (key: string, sort: ProjectSort = "xp") => {
  const k = key.toLowerCase();
  const proj = (await gameDb.select().from(projects).where(sql`lower(${projects.key}) = ${k}`).limit(1))[0];
  if (!proj) return null;

  // Contributors to THIS repo, ranked by the chosen metric (default per-project XP, the craft
  // score). Verified players only.
  const rows = await gameDb.select({
    login: players.githubLogin, handle: players.handle, avatarSeed: players.avatarSeed,
    isAi: players.isAi, tier: players.tier,
    xp: playerProjects.xp, commits: playerProjects.commits, lines: playerProjects.lines,
  }).from(playerProjects).innerJoin(players, eq(players.id, playerProjects.playerId))
    .where(and(sql`lower(${playerProjects.projectKey}) = ${k}`, eq(players.githubVerified, true)))
    .orderBy(desc(SORT_COL[sort])).limit(50);

  // Ranked list = contributors with a github login (so each row links to a real profile);
  // totals count every verified contributor (incl. login-less rows) so the headcount is honest.
  const contributors = rows.filter((r) => r.login).map((r) => ({
    login: r.login!, handle: r.handle, avatarSeed: r.avatarSeed, isAi: r.isAi,
    tier: normalizeTier(r.tier), xp: Number(r.xp), commits: r.commits, lines: Number(r.lines),
  }));
  const [owner, ...rest] = proj.key.split("/");
  const repo = rest.join("/") || proj.key;
  const totals = {
    devs: rows.length,
    xp: rows.reduce((s, r) => s + Number(r.xp), 0),
    commits: rows.reduce((s, r) => s + r.commits, 0),
    lines: rows.reduce((s, r) => s + Number(r.lines), 0),
  };
  return {
    key: proj.key, owner, repo, name: proj.name, stars: proj.stars, oss: proj.oss, sort,
    contributors, topContributor: contributors[0] ?? null, totals,
  };
};

// One-line OG/share description: "12 devs · 48k XP · top @alexkahndev".
export const projectShareSnippet = (p: NonNullable<ProjectData>): string => {
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : String(n));
  const bits = [`${p.totals.devs} dev${p.totals.devs === 1 ? "" : "s"}`];
  if (p.totals.xp > 0) bits.push(`${fmt(p.totals.xp)} XP`);
  if (p.topContributor) bits.push(`top @${p.topContributor.login}`);
  return bits.join(" · ");
};
