// Shared "your week" loader — one source of truth for the GET /api/recap/:login JSON, the
// public /recap/:login share page, and its OG card (mirrors profile.ts / project.ts so they
// can't drift). Aggregates a player's last N days: renown earned (attribution delta — the same
// metric the weekly leaderboard ranks by), verified-score delta, and achievements unlocked.
// Read-only by login; safe to serve publicly. Returns null for an unknown login.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { achievements, playerAchievements, playerAttributionSnapshots, players } from "../../../db/schema.ts";
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
  if (!p || !p.githubVerified) return null;   // public surface — gate like profile/org/project

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
    // Historical rows may predate the all-time invariant. A recap is an earnings surface, not
    // an accounting correction surface, so it never presents a negative value as work earned.
    verifiedDelta: Math.max(0, Number(p.verifiedScore) - Number(baseVer)),
    currentScore: Number(p.verifiedScore),
    totalLevel: p.totalLevel,
    petsCount: p.petsCount,
    rarestPetSeed: p.rarestPetSeed,
    newAchievements,
    snapshots: snaps.length,
  };
};

// Weekly digest — every player who EARNED renown (positive 7-day attribution delta) in the
// window, with their weekly gain + achievements unlocked + a link to their recap card. Powers the
// opt-in weekly-recap webhook (cronPlugin) and the /api/recap-digest preview. The webhook's
// delivery format (email / Slack / Discord) is operator-owned, same as the attestation digest —
// this just builds the data. `origin` (optional) makes the recap links fully-qualified.
export type WeeklyDigest = Awaited<ReturnType<typeof buildWeeklyDigest>>;
export const buildWeeklyDigest = async (origin?: string, days = 7, limit = 200) => {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const weeklyDelta = sql<number>`(${players.attributionScore} - coalesce((select ${playerAttributionSnapshots.attributionScore} from ${playerAttributionSnapshots} where ${playerAttributionSnapshots.playerId} = ${players.id} and ${playerAttributionSnapshots.snapshotDate} >= ${cutoffDate} order by ${playerAttributionSnapshots.snapshotDate} asc limit 1), ${players.attributionScore}))`;
  const rows = await gameDb.select({ id: players.id, login: players.githubLogin, score: players.verifiedScore, totalLevel: players.totalLevel, weekXp: weeklyDelta })
    .from(players).where(and(eq(players.githubVerified, true), sql`${players.githubLogin} is not null`))
    .orderBy(desc(weeklyDelta)).limit(limit);
  const active = rows.filter((r) => Number(r.weekXp) > 0);
  if (active.length === 0) return { weekOf: cutoffDate, players: [] as Array<{ login: string; weekXp: number; score: number; totalLevel: number; newAchievements: number; recapUrl?: string }> };

  // New achievements per active player in the window (one grouped query, filtered to the set).
  const achRows = await gameDb.select({ playerId: playerAchievements.playerId, n: sql<number>`count(*)::int` })
    .from(playerAchievements)
    .where(and(inArray(playerAchievements.playerId, active.map((r) => r.id)), sql`${playerAchievements.unlockedAt} >= ${cutoff}`))
    .groupBy(playerAchievements.playerId);
  const achMap = new Map(achRows.map((r) => [r.playerId, r.n]));
  const base = origin?.replace(/\/$/, "");
  return {
    weekOf: cutoffDate,
    players: active.map((r) => ({
      login: r.login as string, weekXp: Number(r.weekXp), score: Number(r.score), totalLevel: r.totalLevel,
      newAchievements: achMap.get(r.id) ?? 0,
      ...(base ? { recapUrl: `${base}/recap/${encodeURIComponent(r.login as string)}` } : {}),
    })),
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
