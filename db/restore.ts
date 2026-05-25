// Renown restore — idempotently re-imports a backup (default backups/latest.json) and
// recomputes achievement unlock_counts from the restored unlocks. Safe to run repeatedly:
// upserts (no dupes, no clobber-to-older where it matters). Run db:seed FIRST so the
// achievement catalog exists (player_achievements references it).
//   bun run db:restore [path/to/backup.json]
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, sql as neon } from "./index.ts";
import { playerAchievements, playerProjects, players, projects } from "./schema.ts";

const file = process.argv[2] ?? `${import.meta.dir}/../backups/latest.json`;
const d = JSON.parse(readFileSync(file, "utf8"));
const chunk = <T>(a: T[], n = 500) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const date = (v: unknown) => (v ? new Date(v as string) : new Date());

console.log(`restoring ${file} (from ${d.at})…`);

for (const c of chunk(d.players ?? [])) if (c.length) {
  await db.insert(players).values(c.map((r: any) => ({ ...r, createdAt: date(r.createdAt), updatedAt: date(r.updatedAt) })))
    .onConflictDoUpdate({ target: players.id, set: { handle: sql`excluded.handle`, githubLogin: sql`excluded.github_login`, level: sql`excluded.level`, xp: sql`excluded.xp`, streak: sql`excluded.streak`, activeSec: sql`excluded.active_sec`, achievements: sql`excluded.achievements`, ossCommits: sql`excluded.oss_commits`, updatedAt: sql`excluded.updated_at` } });
}
for (const c of chunk(d.projects ?? [])) if (c.length) {
  await db.insert(projects).values(c).onConflictDoUpdate({ target: projects.key, set: { name: sql`excluded.name`, stars: sql`excluded.stars`, oss: sql`excluded.oss` } });
}
for (const c of chunk(d.playerProjects ?? [])) if (c.length) {
  await db.insert(playerProjects).values(c.map((r: any) => ({ ...r, updatedAt: date(r.updatedAt) })))
    .onConflictDoUpdate({ target: [playerProjects.playerId, playerProjects.projectKey], set: { xp: sql`excluded.xp`, commits: sql`excluded.commits`, lines: sql`excluded.lines`, updatedAt: sql`excluded.updated_at` } });
}
for (const c of chunk(d.playerAchievements ?? [])) if (c.length) {
  await db.insert(playerAchievements).values(c.map((r: any) => ({ ...r, unlockedAt: date(r.unlockedAt) }))).onConflictDoNothing();
}

// recompute rarity counts from the restored unlocks (idempotent, exact)
await neon`update achievements set unlock_count = (select count(*)::int from player_achievements pa where pa.achievement_id = achievements.id)`;

console.log(`✓ restored: players=${(d.players ?? []).length} projects=${(d.projects ?? []).length} playerProjects=${(d.playerProjects ?? []).length} playerAchievements=${(d.playerAchievements ?? []).length}; unlock_counts recomputed`);
