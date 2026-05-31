// Data for the public /achievements discovery index — the catalog counterpart to the /pets
// gallery. Two surfaces: the live network unlock feed (aliveness) and the curated achievement
// catalog grouped by category (browse → each links to its /achievement/:id share page). The ~10k
// generated achievements are excluded from the catalog browse (noise); they still have their own
// pages, reachable from a profile or the unlock feed.
import { and, desc, eq, sql } from "drizzle-orm";
import { achievements, players } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { gameDb } from "./sync.ts";

export type CatalogAch = { id: string; name: string; description: string; tier: string; category: string; unlocks: number; rarity: number };
export type RecentUnlock = {
  unlockedAt: string;
  achievement: { id: string; name: string; tier: string; category: string };
  player: { login: string; handle: string; avatarSeed: string | null; isAi: boolean; tier: string };
};
export type AchievementsIndex = { players: number; recent: RecentUnlock[]; catalog: CatalogAch[] };

export const loadAchievementsIndex = async (): Promise<AchievementsIndex> => {
  const tp = (await gameDb.select({ n: sql<number>`count(*)::int` }).from(players))[0]?.n ?? 0;

  // Curated, publicly-shown catalog (hand-designed; excludes the generated 10k and secret/hidden).
  const catRows = await gameDb.select().from(achievements)
    .where(and(eq(achievements.generated, false), eq(achievements.visibility, "shown")))
    .orderBy(achievements.category, desc(achievements.unlockCount));
  const catalog: CatalogAch[] = catRows.map((r) => ({
    id: r.id, name: r.name, description: r.description, tier: r.tier, category: r.category,
    unlocks: r.unlockCount, rarity: tp ? +((r.unlockCount / tp) * 100).toFixed(1) : 0,
  }));

  // Latest unlocks across the network (verified players, shown achievements only).
  const rows = await gameDb.execute(sql`
    SELECT pa.unlocked_at, a.id AS ach_id, a.name AS ach_name, a.tier AS ach_tier, a.category AS ach_category,
           p.github_login AS login, p.handle AS handle, p.avatar_seed AS avatar_seed, p.is_ai AS is_ai, p.tier AS player_tier
    FROM player_achievements pa
    JOIN achievements a ON a.id = pa.achievement_id
    JOIN players p ON p.id = pa.player_id
    WHERE a.visibility = 'shown' AND p.github_login IS NOT NULL AND p.github_verified = true
    ORDER BY pa.unlocked_at DESC
    LIMIT 24
  `);
  type R = { unlocked_at: string | Date; ach_id: string; ach_name: string; ach_tier: string; ach_category: string; login: string; handle: string; avatar_seed: string | null; is_ai: boolean; player_tier: string };
  const recent: RecentUnlock[] = (rows.rows as unknown as R[]).map((r) => ({
    unlockedAt: typeof r.unlocked_at === "string" ? r.unlocked_at : new Date(r.unlocked_at).toISOString(),
    achievement: { id: r.ach_id, name: r.ach_name, tier: r.ach_tier, category: r.ach_category },
    player: { login: r.login, handle: r.handle, avatarSeed: r.avatar_seed, isAi: r.is_ai, tier: normalizeTier(r.player_tier) },
  }));

  return { players: tp, recent, catalog };
};
