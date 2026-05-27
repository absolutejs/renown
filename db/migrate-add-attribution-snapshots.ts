// Adds player_attribution_snapshots (one row per (player, day)) used to compute weekly
// deltas without a separate event store. /api/verify writes today's row lazily on each
// successful re-verify; this migration just creates the table.
//
//   bun run db/migrate-add-attribution-snapshots.ts
import { sql } from "./index.ts";

await sql`
  create table if not exists player_attribution_snapshots (
    player_id text not null references players(id) on delete cascade,
    snapshot_date text not null,
    attribution_score bigint not null,
    verified_score bigint not null,
    created_at timestamp not null default now(),
    primary key (player_id, snapshot_date)
  )
`;
console.log("✓ player_attribution_snapshots table ensured");

// Backfill: write today's snapshot for every verified player so the table isn't empty
// (avoids the first 7 days of "no data" on the weekly endpoints).
const today = new Date().toISOString().slice(0, 10);
const r = await sql`
  insert into player_attribution_snapshots (player_id, snapshot_date, attribution_score, verified_score)
  select id, ${today}, attribution_score, verified_score from players where github_verified = true
  on conflict do nothing
  returning player_id
` as { player_id: string }[];
console.log(`✓ backfilled today's snapshot for ${r.length} player(s)`);
