// Reconcile a SPLIT local identity: fold a SOURCE player's game state into a TARGET player.
// Happens when a local install's config.playerId is regenerated AFTER state.json was created —
// the game data (skills/level/projects/achievements) accumulates on the old id while github
// verification + pets land on the new (config) id, so the verified player is hollow and the
// per-repo boards (verified-only) come up empty.
//
// Moves project contributions + achievements onto the target, adopts the richer skill ledger /
// level / oss / xp (greatest), then deletes the source. The target keeps its github_login,
// verification, wild pets, and verified_score. Idempotent on the moves.
//
//   bun run db/merge-player.ts <sourceId> <targetId>
import { sql } from "./index.ts";

const [src, tgt] = process.argv.slice(2);
if (!src || !tgt) { console.error("usage: bun run db/merge-player.ts <sourceId> <targetId>"); process.exit(1); }
if (src === tgt) { console.error("source and target are the same"); process.exit(1); }

const show = async (id: string) => (await sql`select id, github_login, github_verified, total_level, (select count(*)::int from player_projects pp where pp.player_id=p.id) projects, (select count(*)::int from player_achievements pa where pa.player_id=p.id) achievements from players p where id=${id}`)[0];
const s = await show(src), t = await show(tgt);
if (!s) { console.error(`source ${src} not found`); process.exit(1); }
if (!t) { console.error(`target ${tgt} not found`); process.exit(1); }
console.log("before:", JSON.stringify(s), "\n        ", JSON.stringify(t));

// Adopt the richer game state (the higher-level player's skill ledger wins; numeric maxima).
await sql`
  update players t set
    skill_xp    = case when t.total_level >= s.total_level then t.skill_xp else s.skill_xp end,
    total_level = greatest(t.total_level, s.total_level),
    oss_commits = greatest(t.oss_commits, s.oss_commits),
    xp          = greatest(t.xp, s.xp),
    achievements = greatest(t.achievements, s.achievements),
    updated_at  = now()
  from players s where t.id = ${tgt} and s.id = ${src}`;

// Move project contributions (greatest XP wins on conflict).
await sql`
  insert into player_projects (player_id, project_key, xp, commits, lines, updated_at)
    select ${tgt}, project_key, xp, commits, lines, now() from player_projects where player_id = ${src}
  on conflict (player_id, project_key) do update set
    xp = greatest(player_projects.xp, excluded.xp), commits = excluded.commits, lines = excluded.lines, updated_at = now()`;

// Move unlocked achievements (idempotent).
await sql`
  insert into player_achievements (player_id, achievement_id, unlocked_at)
    select ${tgt}, achievement_id, unlocked_at from player_achievements where player_id = ${src}
  on conflict do nothing`;

// Delete the source (FK cascade clears its remaining child rows).
await sql`delete from players where id = ${src}`;

const after = await show(tgt);
console.log("after :", JSON.stringify(after));
console.log(`✓ merged ${src} → ${tgt}`);
process.exit(0);
