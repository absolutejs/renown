// Shared "your week" loader — one source of truth for the GET /api/recap/:login JSON, the
// public /recap/:login share page, and its OG card (mirrors profile.ts / project.ts so they
// can't drift). Aggregates a player's last N days: renown earned (attribution delta — the same
// metric the weekly leaderboard ranks by), verified-score delta, and achievements unlocked.
// Read-only by login; safe to serve publicly. Returns null for an unknown login.
import { and, desc, eq, sql } from "drizzle-orm";
import { achievements, playerAchievements, playerAttributionSnapshots } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { resolvePlayerByGithubLogin } from "./resolvePlayer.ts";
import { gameDb } from "./sync.ts";

export type RecapData = Awaited<ReturnType<typeof loadRecap>>;

export const loadRecap = async (login: string, days = 7) => {
  const d = Math.max(1, Math.min(90, days));
  const cutoffMs = Date.now() - d * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
  const cutoff = new Date(cutoffMs);
  const p = await resolvePlayerByGithubLogin(login);
  if (!p) return null;

  // Baseline = earliest snapshot in the window; the live row is the comparand. No snapshots
  // (brand-new / quiet week) → baseline = current → delta 0, which is honest.
  const snaps = await gameDb.select().from(playerAttributionSnapshots)
    .where(and(eq(playerAttributionSnapshots.playerId, p.id), sql`${playerAttributionSnapshots.snapshotDate} >= ${cutoffDate}`))
    .orderBy(playerAttributionSnapshots.snapshotDate);
  const baseAttr = snaps[0]?.attributionScore ?? p.attributionScore;
  const baseVer = snaps[0]?.verifiedScore ?? p.verifiedScore;
  const achRows = await gameDb
    .select({ id: achievements.id, name: achievements.name, tier: achievements.tier, category: achievements.category, at: playerAchievements.unlockedAt })
    .from(playerAchievements)
    .innerJoin(achievements, eq(achievements.id, playerAchievements.achievementId))
    .where(and(eq(playerAchievements.playerId, p.id), sql`${playerAchievements.unlockedAt} >= ${cutoff}`))
    .orderBy(desc(playerAchievements.unlockedAt));
  // Serialize `at` to ISO so SSR props and the JSON API agree on `string` (Date would only
  // survive the JSON hop, not direct SSR prop passing).
  const newAchievements = achRows.map((a) => ({ ...a, at: a.at ? new Date(a.at).toISOString() : null }));

  return {
    login: p.githubLogin ?? login, handle: p.handle, avatarSeed: p.avatarSeed, tier: normalizeTier(p.tier), isAi: p.isAi,
    windowDays: d,
    attributionDelta: Number(p.attributionScore) - Number(baseAttr),
    verifiedDelta: Number(p.verifiedScore) - Number(baseVer),
    currentScore: Number(p.verifiedScore),
    totalLevel: p.totalLevel,
    petsCount: p.petsCount,
    rarestPetSeed: p.rarestPetSeed,
    newAchievements,
    snapshots: snaps.length,
  };
};

// One-line share/OG description: "earned 1.2k renown · 3 achievements this week".
export const recapShareSnippet = (r: NonNullable<RecapData>): string => {
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));
  const bits: string[] = [];
  if (r.attributionDelta > 0) bits.push(`earned ${fmt(r.attributionDelta)} renown`);
  if (r.newAchievements.length > 0) bits.push(`${r.newAchievements.length} achievement${r.newAchievements.length === 1 ? "" : "s"}`);
  if (bits.length === 0) bits.push(`${fmt(r.currentScore)} renown · total level ${r.totalLevel}`);
  return `${bits.join(" · ")} this week`;
};
