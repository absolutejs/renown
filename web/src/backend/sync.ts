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

// the real Neon write — runs in the background, coalesced to once per player per window
const persistPlayer = async (id: string, e: PlayerSnapshot) => {
  await gameDb.insert(players).values({
    id, handle: String(e.name || "anon").slice(0, MAX_HANDLE), level: (e.level ?? 0) | 0, xp: (e.xp ?? 0) | 0,
    streak: (e.streak ?? 0) | 0, activeSec: (e.active ?? 0) | 0, achievements: (e.ach ?? 0) | 0, ossCommits: (e.oss ?? 0) | 0,
    totalLevel: (e.totalLevel ?? 0) | 0, skillXp: e.skillXp ?? {}, updatedAt: new Date()
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
    await gameDb.insert(projects).values({ key: p.key, name: p.name || p.key, stars: (p.stars ?? 0) | 0, oss: !!p.oss })
      .onConflictDoUpdate({ target: projects.key, set: { name: sql`excluded.name`, stars: sql`excluded.stars`, oss: sql`excluded.oss` } });
    await gameDb.insert(playerProjects).values({ playerId: id, projectKey: p.key, xp: (p.xp ?? 0) | 0, commits: (p.commits ?? 0) | 0, lines: (p.lines ?? 0) | 0, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [playerProjects.playerId, playerProjects.projectKey], set: { xp: sql`greatest(${playerProjects.xp}, excluded.xp)`, commits: sql`excluded.commits`, lines: sql`excluded.lines`, updatedAt: sql`now()` } });
  }
  const unlocked = (Array.isArray(e.unlocked) ? e.unlocked : []).filter((x): x is string => typeof x === "string").slice(0, MAX_UNLOCKS);
  if (unlocked.length) {
    const valid = await gameDb.select({ id: achievements.id }).from(achievements).where(inArray(achievements.id, unlocked));
    if (valid.length) {
      const ins = await gameDb.insert(playerAchievements).values(valid.map((v) => ({ playerId: id, achievementId: v.id }))).onConflictDoNothing().returning({ id: playerAchievements.achievementId });
      if (ins.length) await gameDb.update(achievements).set({ unlockCount: sql`${achievements.unlockCount} + 1` }).where(inArray(achievements.id, ins.map((r) => r.id)));
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
