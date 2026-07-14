// Weekly quests — a directed loop on top of passive scoring. Five goals refresh each ISO week;
// progress is measured against the player's verified signals ("delta" goals use a per-week
// baseline captured on first view; "threshold" goals check an absolute value). Completing a quest
// issues a serialized quest pet into the player's collection — a non-score reward that respects the
// verified-renown model (no fabricated score). Completion is idempotent (completed_at guard), so
// any load (yours or a visitor's) settles to the same correct state.
import { and, eq, sql } from "drizzle-orm";
import { players, questProgress, wildSeedSources } from "../../../db/schema.ts";
import { issuePetCopies } from "./petIssuance.ts";
import { gameDb } from "./sync.ts";

type Mode = "delta" | "threshold";
type QuestDef = { id: string; name: string; desc: string; icon: string; mode: Mode; signal: keyof SignalRow; target: number };
type SignalRow = { attributionScore: number; prReviewsCount: number; crossRepoPrsCount: number; prsMergedCount: number; petsCount: number; streak: number; ossCommits: number; totalLevel: number };

// The pool. Five are drawn per ISO week (deterministically — see selectQuests), so quests rotate
// week to week instead of being static. Signals are verified player columns.
const POOL: QuestDef[] = [
  { id: "weekly-renown", name: "On the climb", desc: "Earn 100 renown this week.", icon: "📈", mode: "delta", signal: "attributionScore", target: 100 },
  { id: "weekly-renown-big", name: "Big week", desc: "Earn 500 renown this week.", icon: "🚀", mode: "delta", signal: "attributionScore", target: 500 },
  { id: "weekly-reviews", name: "Good neighbor", desc: "Review 2 PRs this week.", icon: "👀", mode: "delta", signal: "prReviewsCount", target: 2 },
  { id: "weekly-reviews-many", name: "Pillar of the community", desc: "Review 5 PRs this week.", icon: "🛟", mode: "delta", signal: "prReviewsCount", target: 5 },
  { id: "weekly-crossrepo", name: "Cross-pollinator", desc: "Land a cross-repo PR this week.", icon: "🌐", mode: "delta", signal: "crossRepoPrsCount", target: 1 },
  { id: "weekly-shipper", name: "Shipper", desc: "Merge 2 PRs this week.", icon: "📦", mode: "delta", signal: "prsMergedCount", target: 2 },
  { id: "weekly-oss", name: "Open source", desc: "Land 5 OSS commits this week.", icon: "🌱", mode: "delta", signal: "ossCommits", target: 5 },
  { id: "weekly-pets", name: "Hatchery", desc: "Hatch 2 new pets this week.", icon: "🥚", mode: "delta", signal: "petsCount", target: 2 },
  { id: "weekly-pets-many", name: "Menagerie", desc: "Hatch 5 new pets this week.", icon: "🐣", mode: "delta", signal: "petsCount", target: 5 },
  { id: "weekly-level", name: "Ascendant", desc: "Gain 2 total levels this week.", icon: "⬆️", mode: "delta", signal: "totalLevel", target: 2 },
  { id: "weekly-streak", name: "Showing up", desc: "Hold a 3-day streak.", icon: "🔥", mode: "threshold", signal: "streak", target: 3 },
  { id: "weekly-streak-long", name: "Locked in", desc: "Hold a 7-day streak.", icon: "🔒", mode: "threshold", signal: "streak", target: 7 },
];

// Deterministic 32-bit string hash → a stable weekly ordering. Same week always yields the same
// five quests for everyone; a new week reshuffles. No persistence needed.
const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const selectQuests = (weekKey: string): QuestDef[] =>
  [...POOL].sort((a, b) => hash(`${weekKey}:${a.id}`) - hash(`${weekKey}:${b.id}`)).slice(0, 5);

export type QuestView = { id: string; name: string; desc: string; icon: string; progress: number; target: number; pct: number; completed: boolean; rewardSeed: string | null };
export type Quests = { login: string; handle: string; weekKey: string; quests: QuestView[]; completedCount: number };

// ISO-8601 week key "YYYY-Www" (Thursday-based, matching the rest of the app's weekly cadence).
export const isoWeekKey = (d: Date): string => {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

export const loadQuests = async (login: string): Promise<Quests | null> => {
  const p = (await gameDb.select().from(players).where(eq(players.githubLogin, login)).limit(1))[0];
  if (!p) return null;
  const weekKey = isoWeekKey(new Date());
  const rows = await gameDb.select().from(questProgress).where(and(eq(questProgress.playerId, p.id), eq(questProgress.weekKey, weekKey)));
  const byId = new Map(rows.map((r) => [r.questId, r]));
  const sig = (k: keyof SignalRow): number => Number((p as unknown as SignalRow)[k] ?? 0);

  const newWild: string[] = Array.isArray(p.wild) ? [...(p.wild as string[])] : [];
  let wildChanged = false;
  const out: QuestView[] = [];

  for (const q of selectQuests(weekKey)) {
    const current = sig(q.signal);
    const row = byId.get(q.id);
    // Lazy baseline: first time we see this quest this week, anchor it. Threshold goals anchor 0.
    let baseline = row ? Number(row.baseline) : (q.mode === "delta" ? current : 0);
    if (!row) {
      await gameDb.insert(questProgress).values({ playerId: p.id, weekKey, questId: q.id, baseline, completedAt: null }).onConflictDoNothing();
    }
    const progress = q.mode === "delta" ? Math.max(0, current - baseline) : current;
    const completed = progress >= q.target;
    const wasCompleted = !!row?.completedAt;
    const rewardProvenance = `quest:${login}:${weekKey}:${q.id}`;   // stable, public provenance
    if (completed && !wasCompleted) {
      await gameDb.update(questProgress).set({ completedAt: new Date() }).where(and(eq(questProgress.playerId, p.id), eq(questProgress.weekKey, weekKey), eq(questProgress.questId, q.id)));
    }
    // Resolve both newly-completed and previously-completed quests through the same idempotent
    // issuer. The reward link is the owned copy seed, which carries its serial/total.
    const issued = completed || wasCompleted
      ? (await issuePetCopies({ playerId: p.id, githubLogin: p.githubLogin ?? login, provenanceSeeds: [rewardProvenance] }))[0]
      : null;
    const rewardSeed = issued?.seed ?? null;
    if (rewardSeed && !newWild.includes(rewardSeed)) { newWild.unshift(rewardSeed); wildChanged = true; }
    out.push({ id: q.id, name: q.name, desc: q.desc, icon: q.icon, progress, target: q.target, pct: Math.min(100, Math.round((progress / q.target) * 100)), completed, rewardSeed });
  }

  if (wildChanged) {
    const capped = newWild.slice(0, 100);   // match /verify's wild cap so the two write paths agree
    const [{ total = 0 } = { total: 0 }] = await gameDb.select({ total: sql<number>`count(*)::int` })
      .from(wildSeedSources).where(eq(wildSeedSources.playerId, p.id));
    await gameDb.update(players).set({ wild: capped, petsCount: total }).where(eq(players.id, p.id));
  }

  return { login, handle: p.handle, weekKey, quests: out, completedCount: out.filter((q) => q.completed).length };
};
