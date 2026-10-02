// "Since your last visit": everything a signed-in player earned while they were away — XP and
// levels from their editor hooks, verified score from GitHub, new pets, and new achievements.
// Pets and achievements are read by their own earned timestamps; numeric deltas compare against
// the snapshot taken when the player last dismissed the recap. Opening the site also refreshes
// their linked GitHub accounts in the background, so nothing depends on a manual sync.
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { achievements, playerAchievements, playerVisits, players, wildSeedSources } from "../../../db/schema.ts";
import { resolvePetLookId } from "../../../core/petLooks.ts";
import { syncGithubAccount } from "./githubSync.ts";
import { getPlayerPetLookAssignments } from "./petLooks.ts";
import { listPlayerAccounts } from "./resolvePlayer.ts";
import { gameDb } from "./sync.ts";

const RECAP_ITEM_LIMIT = 30;
// A player's first recap (no marker yet) covers the past week instead of their whole history.
const FIRST_VISIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Player = typeof players.$inferSelect;
type VisitSnapshot = typeof playerVisits.$inferSelect["snapshot"];

const currentSnapshot = async (player: Player): Promise<VisitSnapshot> => {
  const [{ total = 0 } = { total: 0 }] = await gameDb.select({ total: sql<number>`count(*)::int` })
    .from(wildSeedSources).where(eq(wildSeedSources.playerId, player.id));
  return {
    xp: Number(player.xp), totalLevel: player.totalLevel, verifiedScore: Number(player.verifiedScore),
    meritScore: Number(player.meritScore), petsCount: total,
  };
};

export const loadVisitRecap = async (player: Player) => {
  const [visit] = await gameDb.select().from(playerVisits).where(eq(playerVisits.playerId, player.id)).limit(1);
  const since = visit?.lastVisitAt ?? new Date(Date.now() - FIRST_VISIT_WINDOW_MS);
  const current = await currentSnapshot(player);
  const petWhere = and(eq(wildSeedSources.playerId, player.id), gt(wildSeedSources.earnedAt, since));
  const achievementWhere = and(eq(playerAchievements.playerId, player.id), gt(playerAchievements.unlockedAt, since));
  const [petRows, [{ petTotal = 0 } = { petTotal: 0 }], achievementRows, [{ achievementTotal = 0 } = { achievementTotal: 0 }]] = await Promise.all([
    gameDb.select({
      seed: wildSeedSources.petSeed, name: wildSeedSources.name, tier: wildSeedSources.tier, githubLogin: wildSeedSources.githubLogin,
      serialNumber: wildSeedSources.serialNumber, printRun: wildSeedSources.printRun, earnedAt: wildSeedSources.earnedAt,
    }).from(wildSeedSources).where(petWhere).orderBy(asc(wildSeedSources.earnedAt), asc(wildSeedSources.petSeed)).limit(RECAP_ITEM_LIMIT),
    gameDb.select({ petTotal: sql<number>`count(*)::int` }).from(wildSeedSources).where(petWhere),
    gameDb.select({
      id: achievements.id, name: achievements.name, description: achievements.description, tier: achievements.tier,
      unlockedAt: playerAchievements.unlockedAt,
    }).from(playerAchievements).innerJoin(achievements, eq(achievements.id, playerAchievements.achievementId))
      .where(achievementWhere).orderBy(asc(playerAchievements.unlockedAt), asc(playerAchievements.achievementId)).limit(RECAP_ITEM_LIMIT),
    gameDb.select({ achievementTotal: sql<number>`count(*)::int` }).from(playerAchievements).where(achievementWhere),
  ]);
  const looks = await getPlayerPetLookAssignments(player.id, petRows.map((pet) => pet.seed));
  const before = visit?.snapshot ?? null;
  const gained = before ? {
    xp: Math.max(0, current.xp - before.xp),
    totalLevel: Math.max(0, current.totalLevel - before.totalLevel),
    verifiedScore: Math.max(0, current.verifiedScore - before.verifiedScore),
    meritScore: Math.max(0, current.meritScore - before.meritScore),
  } : null;
  const isEmpty = petTotal === 0 && achievementTotal === 0 && (!gained || Object.values(gained).every((value) => value === 0));
  return {
    since: since.toISOString(),
    firstVisit: !visit,
    isEmpty,
    gained,
    pets: petRows.map((pet) => ({ ...pet, lookId: resolvePetLookId(looks[pet.seed], player.activePetLookId) })),
    petTotal,
    achievements: achievementRows,
    achievementTotal,
  };
};

export type VisitRecap = Awaited<ReturnType<typeof loadVisitRecap>>;

// Move the marker to now: the player has seen everything up to this moment.
export const acknowledgeVisit = async (player: Player) => {
  const snapshot = await currentSnapshot(player);
  const lastVisitAt = new Date();
  await gameDb.insert(playerVisits).values({ playerId: player.id, lastVisitAt, snapshot })
    .onConflictDoUpdate({ target: playerVisits.playerId, set: { lastVisitAt, snapshot } });
};

// GitHub OAuth user tokens (classic OAuth app `gho_`, GitHub App `ghu_`). A Google-backed
// session token must never be sent to GitHub.
const isGithubUserToken = (token: string | undefined) => !!token && /^gh[ou]_/.test(token);

// Refresh every verified GitHub account on this player without blocking the page. The signed-in
// player's own OAuth token spends their personal GitHub budget instead of the shared server one.
// Each finished sync publishes `player:<id>`, so open pages refetch the recap as results land.
export const refreshPlayerGithubAccounts = async (playerId: string, sessionToken?: string) => {
  const token = isGithubUserToken(sessionToken) ? sessionToken : undefined;
  const logins = (await listPlayerAccounts(playerId)).filter((account) => account.githubVerified).map((account) => account.githubLogin);
  for (const login of logins) {
    void syncGithubAccount(login, token)
      .then((result) => { if ("error" in result) console.warn(`[renown:visit] @${login} not refreshed: ${result.error}`); })
      .catch((error) => console.error(`[renown:visit] @${login} refresh failed`, error));
  }
  return logins;
};
