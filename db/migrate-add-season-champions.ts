// Adds the Hall of Champions store: the finalized top finishers of each past monthly season.
// Populated lazily by loadSeason() once a month rolls over (no cron). Idempotent.
import { sql } from "./index.ts";

await sql`create table if not exists season_champions (
  season text not null,
  rank integer not null,
  player_id text not null references players(id) on delete cascade,
  login text,
  handle text not null,
  gain bigint not null,
  finalized_at timestamp not null default now(),
  primary key (season, rank)
)`;
console.log("✓ season_champions table ensured");
