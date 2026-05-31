// "Rivals" = the people you follow. loadRivals(login) returns that dev's circle as a mini-board
// (the people they follow + themselves, ranked by the default-board metric) plus an activity feed
// (recent achievement unlocks among the people they follow). Following is public, so this is both
// the personal /rivals surface and a "dev's circle" discovery surface. Shared by the public
// /api/rivals/:login route and the home-page Rivals view.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { achievements, follows, playerAchievements, players } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { resolvePlayerByGithubLogin } from "./resolvePlayer.ts";
import { gameDb } from "./sync.ts";

export type RivalRow = { login: string | null; handle: string; score: number; tier: string; isAi: boolean; totalLevel: number; ach: number; petsCount: number; avatarSeed: string | null; verified: boolean; you: boolean };
export type RivalFeedItem = { unlockedAt: string; achievement: { id: string; name: string; tier: string }; player: { login: string | null; handle: string; isAi: boolean } };
export type Rivals = { login: string; handle: string; following: number; board: RivalRow[]; feed: RivalFeedItem[] };

export const getFollowingLogins = async (playerId: string): Promise<string[]> => {
  const rows = await gameDb.select({ login: players.githubLogin })
    .from(follows).innerJoin(players, eq(players.id, follows.followeeId))
    .where(eq(follows.followerId, playerId));
  return rows.map((r) => r.login).filter((l): l is string => !!l);
};

export const loadRivals = async (login: string): Promise<Rivals | null> => {
  const me = await resolvePlayerByGithubLogin(login);
  if (!me) return null;
  const followeeRows = await gameDb.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, me.id));
  const followeeIds = followeeRows.map((r) => r.id);
  const boardIds = [me.id, ...followeeIds];

  const combined = sql<number>`${players.verifiedScore} + ${players.meritScore}`;
  const rows = await gameDb.select().from(players).where(inArray(players.id, boardIds)).orderBy(desc(combined)).limit(50);
  const board: RivalRow[] = rows.map((p) => ({
    login: p.githubLogin, handle: p.handle, score: Number(p.verifiedScore) + Number(p.meritScore),
    tier: normalizeTier(p.tier), isAi: p.isAi, totalLevel: p.totalLevel, ach: p.achievements, petsCount: p.petsCount,
    avatarSeed: p.avatarSeed, verified: p.githubVerified, you: p.id === me.id,
  }));

  let feed: RivalFeedItem[] = [];
  if (followeeIds.length > 0) {
    const f = await gameDb.select({
      unlockedAt: playerAchievements.unlockedAt, achId: achievements.id, achName: achievements.name, achTier: achievements.tier,
      login: players.githubLogin, handle: players.handle, isAi: players.isAi,
    })
      .from(playerAchievements)
      .innerJoin(achievements, eq(achievements.id, playerAchievements.achievementId))
      .innerJoin(players, eq(players.id, playerAchievements.playerId))
      .where(and(inArray(playerAchievements.playerId, followeeIds), eq(achievements.visibility, "shown")))
      .orderBy(desc(playerAchievements.unlockedAt)).limit(20);
    feed = f.map((r) => ({
      unlockedAt: typeof r.unlockedAt === "string" ? r.unlockedAt : new Date(r.unlockedAt).toISOString(),
      achievement: { id: r.achId, name: r.achName, tier: r.achTier },
      player: { login: r.login, handle: r.handle, isAi: r.isAi },
    }));
  }

  return { login, handle: me.handle, following: followeeIds.length, board, feed };
};
