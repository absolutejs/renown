// Shared org loader — aggregates a whole GitHub owner's renown: every repo under `owner/*` that
// someone on renown contributes to, the org's top repos, and its top contributors across all of
// them. Same data served by GET /api/org/:owner, the public /org/:owner page, and the org badge
// (mirrors project.ts). Ranks/totals use the verified-preferred rule (GitHub-scored verified_xp
// when present, else self-reported) so the org board is as trustworthy as the per-repo ones.
// Returns null for an owner no one on renown has touched.
import { and, desc, eq, sql } from "drizzle-orm";
import { players, playerProjects, projects } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { confirmProjectPublic } from "./project.ts";
import { gameDb } from "./sync.ts";

export type OrgData = Awaited<ReturnType<typeof loadOrg>>;

// effective xp per (player,repo) row: verified GitHub-scored value when present, else self-reported.
const effXpSum = sql<number>`coalesce(sum(case when ${playerProjects.verifiedXp} > 0 then ${playerProjects.verifiedXp} else ${playerProjects.xp} end), 0)`;
const ownerOf = (o: string) => sql`lower(split_part(${playerProjects.projectKey}, '/', 1)) = ${o}`;

export const loadOrg = async (owner: string) => {
  const o = owner.toLowerCase();
  const base = and(ownerOf(o), eq(players.githubVerified, true), eq(projects.visibility, "public"));

  // Top repos under this owner, ranked by verified-preferred XP.
  const repoCandidates = await gameDb.select({
    key: playerProjects.projectKey, name: projects.name, stars: projects.stars, oss: projects.oss,
    xp: effXpSum,
    devs: sql<number>`count(distinct ${playerProjects.playerId})::int`,
    verifiedDevs: sql<number>`count(distinct case when ${playerProjects.verifiedXp} > 0 then ${playerProjects.playerId} end)::int`,
  }).from(playerProjects)
    .innerJoin(projects, eq(projects.key, playerProjects.projectKey))
    .innerJoin(players, eq(players.id, playerProjects.playerId))
    .where(base)
    .groupBy(playerProjects.projectKey, projects.name, projects.stars, projects.oss)
    .orderBy(desc(effXpSum)).limit(50);
  const repoChecks = await Promise.all(repoCandidates.map((r) => confirmProjectPublic(r.key)));
  const repoRows = repoCandidates.filter((_, i) => repoChecks[i]);
  if (repoRows.length === 0) return null;

  // Top contributors ACROSS the org's repos (sum effective XP per player over all owner/* repos).
  const contribRows = await gameDb.select({
    login: players.githubLogin, avatarSeed: players.avatarSeed, isAi: players.isAi, tier: players.tier,
    xp: effXpSum,
    repos: sql<number>`count(distinct ${playerProjects.projectKey})::int`,
    verified: sql<boolean>`bool_or(${playerProjects.verifiedXp} > 0)`,
  }).from(playerProjects)
    .innerJoin(players, eq(players.id, playerProjects.playerId))
    .innerJoin(projects, eq(projects.key, playerProjects.projectKey))
    .where(and(base, sql`${players.githubLogin} is not null`))
    .groupBy(players.id, players.githubLogin, players.avatarSeed, players.isAi, players.tier)
    .orderBy(desc(effXpSum)).limit(50);

  const repos = repoRows.map((r) => {
    const [, ...rest] = r.key.split("/");
    return { key: r.key, repo: rest.join("/") || r.key, name: r.name, stars: r.stars, oss: r.oss, xp: Number(r.xp), devs: r.devs, verified: r.verifiedDevs > 0 };
  });
  const contributors = contribRows.map((c) => ({
    login: c.login as string, avatarSeed: c.avatarSeed, isAi: c.isAi, tier: normalizeTier(c.tier),
    xp: Number(c.xp), repos: c.repos, verified: !!c.verified,
  }));
  const [ownerCase] = repoRows[0].key.split("/");   // preserve the owner's canonical case
  const totals = {
    repos: repos.length,
    devs: contributors.length,
    xp: repos.reduce((s, r) => s + r.xp, 0),
    verifiedDevs: contributors.filter((c) => c.verified).length,
  };
  return { owner: ownerCase, repos, contributors, topContributor: contributors[0] ?? null, totals };
};

// One-line OG/share description: "8 repos · 12 devs · 48k renown · top @alexkahndev".
export const orgShareSnippet = (g: NonNullable<OrgData>): string => {
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));
  const bits = [`${g.totals.repos} repo${g.totals.repos === 1 ? "" : "s"}`, `${g.totals.devs} dev${g.totals.devs === 1 ? "" : "s"}`];
  if (g.totals.xp > 0) bits.push(`${fmt(g.totals.xp)} renown`);
  if (g.topContributor) bits.push(`top @${g.topContributor.login}`);
  return bits.join(" · ");
};
