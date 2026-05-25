// Renown backup — dumps the NON-reproducible data (earned progress, unlocks,
// leaderboard standings) to a timestamped JSON + backups/latest.json. The achievement
// CATALOG is reproducible from code (db/seed.ts), so we don't back it up — but
// unlock_count is recomputed from player_achievements on restore. Read-only.
//   bun run db:backup
import { mkdirSync, writeFileSync } from "node:fs";
import { db } from "./index.ts";
import { playerAchievements, playerProjects, players, projects } from "./schema.ts";

const dir = `${import.meta.dir}/../backups`;
mkdirSync(dir, { recursive: true });

const data = {
  v: 1,
  at: new Date().toISOString(),
  players: await db.select().from(players),
  projects: await db.select().from(projects),
  playerProjects: await db.select().from(playerProjects),
  playerAchievements: await db.select().from(playerAchievements),
};

const json = JSON.stringify(data);
const file = `${dir}/renown-${data.at.replace(/[:.]/g, "-")}.json`;
writeFileSync(file, json);
writeFileSync(`${dir}/latest.json`, json);
console.log(`✓ backup → ${file}`);
console.log(`  players=${data.players.length} projects=${data.projects.length} playerProjects=${data.playerProjects.length} playerAchievements=${data.playerAchievements.length}`);
