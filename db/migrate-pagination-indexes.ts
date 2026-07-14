// Keyset-pagination support for account achievements and the chronological pet feed.
// Additive + idempotent; safe to run against an existing database.
import { sql } from "./index.ts";

await sql`alter table wild_seed_sources add column if not exists earned_at timestamp`;
await sql`
  update wild_seed_sources as source
  set earned_at = coalesce(
    (select assignment.assigned_at from pet_look_assignments as assignment
      where assignment.player_id = source.player_id and assignment.pet_seed = source.pet_seed),
    player.verified_at,
    now()
  )
  from players as player
  where player.id = source.player_id and source.earned_at is null
`;
await sql`alter table wild_seed_sources alter column earned_at set default now()`;
await sql`alter table wild_seed_sources alter column earned_at set not null`;
await sql`create index if not exists wild_seed_sources_recent_idx on wild_seed_sources (earned_at, pet_seed)`;
await sql`create index if not exists player_achievements_history_idx on player_achievements (player_id, unlocked_at, achievement_id)`;

console.log("✓ pagination columns/indexes ensured (achievement history, recent pets)");
