// Adds the per-player "since your last visit" marker. Players without a row get their first
// baseline on their next signed-in visit, so there is nothing to backfill.
//
//   bun --env-file=web/.env db/migrate-add-player-visits.ts
import { sql } from "./index.ts";

await sql`
  create table if not exists player_visits (
    player_id text primary key references players(id) on delete cascade,
    last_visit_at timestamp not null default now(),
    snapshot jsonb not null
  )
`;

console.log("✓ player_visits ensured");
