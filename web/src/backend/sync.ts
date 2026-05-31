// Renown sync layer — keeps Neon off the hot path. Submissions land in an in-memory
// write-behind cache (@absolutejs/sync) and persist to Neon COALESCED: a burst of
// per-tick submits for one player collapses into a single durable write per window,
// instead of a fistful of upserts every heartbeat. A reactive hub pushes "something
// changed" to subscribed browsers over SSE, so the UI never polls.
//
// Single instance → in-memory cache + hub is all we need. To fan changes across
// multiple server instances later, add a Redis cluster bus (engine.connectCluster);
// the rest of this file is unchanged.
import { neon } from "@neondatabase/serverless";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { createReactiveHub, createWriteBehindCache } from "@absolutejs/sync";
import { achievements, playerAchievements, playerProjects, players, projects } from "../../../db/schema.ts";

export const gameDb = drizzle(neon(process.env.DATABASE_URL!));
export const hub = createReactiveHub();

export type ProjectSnapshot = { key: string; name?: string; xp?: number; commits?: number; lines?: number; stars?: number; oss?: boolean };
export type PlayerSnapshot = {
  id: string; name?: string; level?: number; xp?: number; streak?: number; oss?: number; ach?: number;
  active?: number; totalLevel?: number; skillXp?: Record<string, number>; projects?: ProjectSnapshot[]; unlocked?: string[];
};

const COALESCE_MS = 4000;
const MAX_HANDLE = 40;
const MAX_UNLOCKS = 12000;

// Anti-cheat clamps — /api/submit is an unauthenticated self-report, so bound every numeric to a
// plausible ceiling before it touches the DB. This kills the trivial "set xp to MAX_INT" attack
// and bounds per-project xp to what the craft engine could ever award for the claimed commits.
// It does NOT make these fields rank-trustworthy — see docs/trust-model.md for what's
// server-verified (ranks) vs self-reported (these fields, advisory).
const PER_COMMIT_XP_CAP = 300;   // mirrors core/craftScore.ts's hard per-commit cap
const clampInt = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
const sanitizeSkillXp = (m: Record<string, number> | undefined) =>
  Object.fromEntries(Object.entries(m ?? {}).slice(0, 500).map(([k, v]) => [String(k).slice(0, 64), clampInt(v, 100_000_000)]));

// the real Neon write — runs in the background, coalesced to once per player per window
const persistPlayer = async (id: string, e: PlayerSnapshot) => {
  await gameDb.insert(players).values({
    id, handle: String(e.name || "anon").slice(0, MAX_HANDLE), level: clampInt(e.level, 100_000), xp: clampInt(e.xp, 5_000_000_000),
    streak: clampInt(e.streak, 100_000), activeSec: clampInt(e.active, 4_000_000_000), achievements: clampInt(e.ach, 50_000), ossCommits: clampInt(e.oss, 5_000_000),
    totalLevel: clampInt(e.totalLevel, 1_000_000), skillXp: sanitizeSkillXp(e.skillXp), updatedAt: new Date()
  }).onConflictDoUpdate({
    target: players.id,
    set: {
      handle: sql`excluded.handle`, level: sql`excluded.level`, xp: sql`greatest(${players.xp}, excluded.xp)`,
      streak: sql`excluded.streak`, activeSec: sql`excluded.active_sec`, achievements: sql`excluded.achievements`,
      ossCommits: sql`excluded.oss_commits`, totalLevel: sql`excluded.total_level`, skillXp: sql`excluded.skill_xp`, updatedAt: sql`now()`
    }
  });
  for (const p of Array.isArray(e.projects) ? e.projects : []) {
    if (!p?.key) continue;
    const commits = clampInt(p.commits, 500_000);
    const lines = clampInt(p.lines, 100_000_000);
    // Bound submitted xp to what the craft engine could ever award for the claimed commits.
    const xp = Math.min(clampInt(p.xp, 2_000_000_000), commits * PER_COMMIT_XP_CAP);
    await gameDb.insert(projects).values({ key: p.key, name: p.name || p.key, stars: clampInt(p.stars, 5_000_000), oss: !!p.oss })
      .onConflictDoUpdate({ target: projects.key, set: { name: sql`excluded.name`, stars: sql`greatest(${projects.stars}, excluded.stars)`, oss: sql`${projects.oss} or excluded.oss` } });
    // Monotonic on all three (matches /api/ci/repo-sync) — a submit can raise a board stat but
    // never lower it, so neither a buggy resubmit nor a malicious one can regress real numbers.
    await gameDb.insert(playerProjects).values({ playerId: id, projectKey: p.key, xp, commits, lines, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [playerProjects.playerId, playerProjects.projectKey], set: { xp: sql`greatest(${playerProjects.xp}, excluded.xp)`, commits: sql`greatest(${playerProjects.commits}, excluded.commits)`, lines: sql`greatest(${playerProjects.lines}, excluded.lines)`, updatedAt: sql`now()` } });
  }
  const unlocked = (Array.isArray(e.unlocked) ? e.unlocked : []).filter((x): x is string => typeof x === "string").slice(0, MAX_UNLOCKS);
  if (unlocked.length) {
    const valid = await gameDb.select({ id: achievements.id }).from(achievements).where(inArray(achievements.id, unlocked));
    if (valid.length) {
      const ins = await gameDb.insert(playerAchievements).values(valid.map((v) => ({ playerId: id, achievementId: v.id }))).onConflictDoNothing().returning({ id: playerAchievements.achievementId });
      // Only a github-VERIFIED player may move the PUBLIC rarity counter (unlock_count), so a
      // throwaway/unverified account mass-claiming achievement ids can't distort the rarity %
      // everyone sees. The player still gets their unlocks recorded either way.
      if (ins.length) {
        const v = (await gameDb.select({ ok: players.githubVerified }).from(players).where(eq(players.id, id)).limit(1))[0];
        if (v?.ok) await gameDb.update(achievements).set({ unlockCount: sql`${achievements.unlockCount} + 1` }).where(inArray(achievements.id, ins.map((r) => r.id)));
      }
    }
  }
};

export const playerCache = createWriteBehindCache<string, PlayerSnapshot>({
  load: async (id) => {
    const row = (await gameDb.select().from(players).where(eq(players.id, id)))[0];
    return row ? { id, name: row.handle, level: row.level, xp: row.xp, streak: row.streak, oss: row.ossCommits, ach: row.achievements, active: row.activeSec, totalLevel: row.totalLevel, skillXp: row.skillXp ?? {} } : undefined;
  },
  persist: persistPlayer,
  debounceMs: COALESCE_MS,
  onPersistError: (error, id) => console.error(`renown: persist failed for ${id}`, error)
});

// hot write + notify subscribers — returns instantly, Neon catches up behind the scenes
export const submitPlayer = (e: PlayerSnapshot) => {
  playerCache.set(e.id, e);
  hub.publish("top");
  hub.publish(`player:${e.id}`);
};

// Idempotent achievement grant. Used by /api/verify (server-evaluated AI/coauthor
// family) and by /api/account/ai-attestation (instant-grant on successful claim).
// Filters to ids that actually exist in the catalog, inserts with onConflictDoNothing
// so reruns are safe, bumps unlockCount only for ids that newly inserted. Returns the
// list of newly granted ids so callers can publish a "you earned X" UI notification.
export const grantAchievements = async (playerId: string, ids: string[]): Promise<string[]> => {
  if (ids.length === 0) return [];
  const valid = await gameDb.select({ id: achievements.id }).from(achievements).where(inArray(achievements.id, ids));
  if (valid.length === 0) return [];
  const inserted = await gameDb.insert(playerAchievements)
    .values(valid.map((v) => ({ playerId, achievementId: v.id })))
    .onConflictDoNothing()
    .returning({ id: playerAchievements.achievementId });
  if (inserted.length === 0) return [];
  await gameDb.update(achievements)
    .set({ unlockCount: sql`${achievements.unlockCount} + 1` })
    .where(inArray(achievements.id, inserted.map((r) => r.id)));
  // Broadcast on the 'unlock' topic so the home-page activity feed live-refreshes
  // (visitors see other players' progression in real time — the social-discovery
  // loop). Payload is just the new IDs + the player id; clients re-fetch
  // /api/recent-unlocks to get the display fields. Re-fetch is cheap (one
  // indexed query, capped at 50 rows).
  hub.publish("unlock", { playerId, ids: inserted.map((r) => r.id), at: new Date().toISOString() });
  return inserted.map((r) => r.id);
};
