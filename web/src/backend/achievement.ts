// Shared loader for a single achievement's public share page — /achievement/:id (page + OG card)
// and GET /api/achievement/:id. Turns the catalog + live rarity + recent earners into a shareable
// surface: unlock something rare, share its page. Secret/hidden achievements are redacted (we
// don't reveal someone else's secret). Mirrors profile.ts / project.ts. Null for unknown ids.
import { and, desc, eq, sql } from "drizzle-orm";
import { achievements, playerAchievements, players } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { gameDb } from "./sync.ts";

export type AchievementData = Awaited<ReturnType<typeof loadAchievement>>;

export const loadAchievement = async (id: string) => {
  const a = (await gameDb.select().from(achievements).where(eq(achievements.id, id)).limit(1))[0];
  if (!a) return null;
  const tp = (await gameDb.select({ n: sql<number>`count(*)::int` }).from(players))[0]?.n ?? 0;
  const rarity = tp ? +((a.unlockCount / tp) * 100).toFixed(1) : 0;
  const secret = a.visibility !== "shown";

  // Recent earners — verified players with a login (real profile links; no spoofed claims).
  // Suppressed for secret/hidden achievements so we don't leak who has a secret.
  const earners = secret ? [] : (await gameDb
    .select({ login: players.githubLogin, avatarSeed: players.avatarSeed, isAi: players.isAi, tier: players.tier, at: playerAchievements.unlockedAt })
    .from(playerAchievements).innerJoin(players, eq(players.id, playerAchievements.playerId))
    .where(and(eq(playerAchievements.achievementId, id), eq(players.githubVerified, true), sql`${players.githubLogin} is not null`))
    .orderBy(desc(playerAchievements.unlockedAt)).limit(12))
    .map((e) => ({ login: e.login as string, avatarSeed: e.avatarSeed, isAi: e.isAi, tier: normalizeTier(e.tier), at: e.at ? new Date(e.at).toISOString() : null }));

  return {
    id: a.id,
    name: secret ? "Secret achievement" : a.name,
    description: secret ? "Unlock it to find out what it is." : a.description,
    category: a.category, tier: a.tier, generated: a.generated, secret,
    unlocks: a.unlockCount, players: tp, rarity,
    earners,
  };
};

// One-line share/OG description: '"Live Dangerously" — only 0.2% of players have it'.
export const achievementShareSnippet = (a: NonNullable<AchievementData>): string => {
  const rar = a.unlocks === 0 ? "no one has unlocked it yet" : a.rarity < 1 ? `only ${a.rarity}% of players have it` : `${a.rarity}% of players have it`;
  return a.secret ? `A secret renown achievement — ${rar}.` : `"${a.name}" — ${rar}.`;
};
