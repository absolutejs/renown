// Shared profile loader — same data shape served by GET /api/profile/:login
// and pre-fetched by the /profile/:login SSR page handler so OpenGraph / title
// tags can vary per profile (sharers see the right preview). One source of
// truth so JSON-API consumers and page-renderers can't drift.
//
// Returns null when the login isn't a verified player (caller decides whether
// to 404 or render an empty state).
import { and, desc, eq, sql } from "drizzle-orm";
import { achievements, aiAttestationEvents, follows, playerAchievements, playerProjects, players, projects } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { getPlayerPetLookAssignments, type PetLookAssignments } from "./petLooks.ts";
import { resolvePlayerByGithubLogin } from "./resolvePlayer.ts";
import { gameDb } from "./sync.ts";

export type ProfileData = Awaited<ReturnType<typeof loadProfile>>;

export const loadProfile = async (login: string) => {
  // Resolve across all of a user's linked githubs (any of them → the one aggregate player).
  const p = await resolvePlayerByGithubLogin(login);
  if (!p || !p.githubVerified) return null;

  const ach = await gameDb
    .select({ id: achievements.id, name: achievements.name, description: achievements.description, tier: achievements.tier, category: achievements.category, unlockCount: achievements.unlockCount })
    .from(playerAchievements)
    .innerJoin(achievements, eq(achievements.id, playerAchievements.achievementId))
    .where(eq(playerAchievements.playerId, p.id))
    .orderBy(desc(achievements.tier));

  const attestationEvents = await gameDb
    .select({ id: aiAttestationEvents.id, at: aiAttestationEvents.at, kind: aiAttestationEvents.kind, provider: aiAttestationEvents.provider, evidenceUrl: aiAttestationEvents.evidenceUrl, verified: aiAttestationEvents.verified, actorKind: aiAttestationEvents.actorKind })
    .from(aiAttestationEvents)
    .where(eq(aiAttestationEvents.playerId, p.id))
    .orderBy(desc(aiAttestationEvents.at))
    .limit(30);

  // Top repos this player has renown on — links the profile back to the per-repo boards so
  // discovery flows both ways (badge → board → profile → their other repos → …).
  // Verified-preferred (consistent with the /project board + trending): rank + show the
  // GitHub-scored verified_xp when present, else self-reported, with a `verified` flag.
  const topProjectRows = await gameDb
    .select({ key: playerProjects.projectKey, xp: playerProjects.xp, commits: playerProjects.commits, vXp: playerProjects.verifiedXp, vCommits: playerProjects.verifiedCommits, stars: projects.stars, oss: projects.oss })
    .from(playerProjects).innerJoin(projects, eq(projects.key, playerProjects.projectKey))
    .where(and(eq(playerProjects.playerId, p.id), eq(projects.visibility, "public"))).orderBy(desc(playerProjects.verifiedXp), desc(playerProjects.xp)).limit(6);
  const topProjects = topProjectRows.map((r) => {
    const verified = Number(r.vXp) > 0;
    return { key: r.key, stars: r.stars, oss: r.oss, verified, xp: verified ? Number(r.vXp) : Number(r.xp), commits: verified ? r.vCommits : r.commits };
  });

  const wild = Array.isArray(p.wild) ? p.wild : [];
  const petLookAssignments: PetLookAssignments = wild.length > 0 && p.id
    ? await getPlayerPetLookAssignments(p.id, wild)
    : {};

  // Social-graph counts (followers / following) — social proof on the profile.
  const [followerRows, followingRows] = await Promise.all([
    gameDb.select({ c: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followeeId, p.id)),
    gameDb.select({ c: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, p.id)),
  ]);

  return {
    login: p.githubLogin!,
    handle: p.handle,
    followers: followerRows[0]?.c ?? 0,
    following: followingRows[0]?.c ?? 0,
    tier: normalizeTier(p.tier),
    isAi: p.isAi,
    aiAttestation: p.aiAttestation,
    // Score = headline number (base + attribution + merit) — matches /api/top sort.
    score: Number(p.verifiedScore) + Number(p.meritScore),
    baseScore: Number(p.verifiedScore),
    meritScore: Number(p.meritScore),
    totalLevel: p.totalLevel,
    petsCount: p.petsCount,
    rarestPetScore: p.rarestPetScore,
    rarestPetSeed: p.rarestPetSeed,
    biggestPetSize: p.biggestPetSize,
    biggestPetSeed: p.biggestPetSeed,
    avatarSeed: p.avatarSeed,
    activePetLookId: p.activePetLookId,
    petLookAssignments,
    showcaseSeeds: Array.isArray(p.showcaseSeeds) ? p.showcaseSeeds : [],
    rateLimitCount: p.rateLimitCount,
    quirks: p.quirks ?? {},
    merit: {
      score: Number(p.meritScore),
      reviews: p.prReviewsCount,
      crossRepo: p.crossRepoPrsCount,
      authored: p.prsAuthoredCount,
      merged: p.prsMergedCount,
      mergeRatio: p.prsAuthoredCount > 0 ? p.prsMergedCount / p.prsAuthoredCount : 0,
      downloads: Number(p.packageDownloads),
      substanceScore: p.substanceScore,
      substanceSampleSize: p.substanceSampleSize,
      lastSyncAt: p.lastMeritSyncAt ? p.lastMeritSyncAt.toISOString() : null,
    },
    achievements: ach,
    attestationEvents,
    topProjects,
  };
};

// Short human-readable description used for OG/Twitter cards and the search
// snippet. Picks the most striking signal — e.g. "1.2M monthly downloads · 78
// cross-repo PRs · 85 reviews" — so a shared link tells the recipient at a
// glance what makes this player notable. Falls back to a generic line for
// brand-new players with no merit yet.
export const profileShareSnippet = (p: NonNullable<ProfileData>): string => {
  const bits: string[] = [];
  if (p.merit.downloads >= 1_000) {
    bits.push(p.merit.downloads >= 1_000_000 ? `${(p.merit.downloads / 1_000_000).toFixed(1)}M DLs/mo` : `${(p.merit.downloads / 1_000).toFixed(0)}k DLs/mo`);
  }
  if (p.merit.crossRepo > 0) bits.push(`${p.merit.crossRepo.toLocaleString()} cross-repo PRs`);
  if (p.merit.reviews > 0) bits.push(`${p.merit.reviews.toLocaleString()} reviews`);
  if (p.merit.merged > 0 && bits.length < 3) bits.push(`${p.merit.merged.toLocaleString()} PRs merged`);
  if (p.merit.substanceSampleSize >= 10 && bits.length < 3) bits.push(`${Math.round(p.merit.substanceScore * 100)}% substance`);
  if (p.petsCount > 0 && bits.length < 3) bits.push(`${p.petsCount} pet cards`);
  if (bits.length === 0) return "Earning renown for real dev work.";
  return bits.slice(0, 3).join(" · ");
};
