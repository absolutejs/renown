// Performance indexes for the per-repo / org boards. The only index on player_projects is the
// composite PK (player_id, project_key) — wrong leading column for the board queries, which all
// filter on project_key (and lower()/split_part() of it), forcing sequential scans on every
// /project page, README badge, board.svg, OG card, and /org page. These functional indexes make
// those lookups index-scans. Additive + idempotent; safe to run anytime.
//
// NOT auto-run — CREATE INDEX on the shared Neon DB is the maintainer's call:
//   bun run db/migrate-add-player-projects-indexes.ts
// (Add CONCURRENTLY by hand if the table is large and you can't take a brief write lock.)
import { sql } from "./index.ts";

await sql`create index if not exists player_projects_key_lower_idx on player_projects (lower(project_key))`;
await sql`create index if not exists player_projects_owner_idx on player_projects (lower(split_part(project_key, '/', 1)))`;

console.log("✓ player_projects board indexes ensured (lower(project_key), owner)");
