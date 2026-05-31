// Adds weekly quest progress tracking. Per (player, ISO-week, quest): baseline signal at first
// view + completion timestamp. Idempotent.
import { sql } from "./index.ts";

await sql`create table if not exists quest_progress (
  player_id text not null references players(id) on delete cascade,
  week_key text not null,
  quest_id text not null,
  baseline bigint not null default 0,
  completed_at timestamp,
  primary key (player_id, week_key, quest_id)
)`;
console.log("✓ quest_progress table ensured");
