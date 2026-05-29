// Introduces deterministic pet look assignment persistence.
// - players.active_pet_look_id: default cosmetic for future pet grants
// - pet_look_assignments: explicit per-player/per-seed look binding to preserve history
// - backfill: existing owned pets default to legacy for continuity
import { sql } from "./index.ts";

await sql`alter table players add column if not exists active_pet_look_id text not null default 'legacy'`;
await sql`create table if not exists pet_look_assignments (
  player_id text not null references players(id) on delete cascade,
  pet_seed text not null,
  look_id text not null,
  assigned_at timestamp not null default now(),
  primary key (player_id, pet_seed)
)`;

await sql`create index if not exists pet_look_assignments_player_id_idx on pet_look_assignments (player_id)`;
console.log("✓ pet look tables and columns ensured");

const rows = await sql`select id, wild from players where jsonb_array_length(wild) > 0 and wild is not null` as { id: string; wild: string[] }[];
console.log(`backfilling ${rows.length} player(s) with legacy look assignments…`);

let inserted = 0;
for (const row of rows) {
  const seeds = Array.isArray(row.wild) ? row.wild : [];
  if (seeds.length === 0) continue;
  for (const seed of seeds) {
    await sql`insert into pet_look_assignments (player_id, pet_seed, look_id)
      values (${row.id}, ${seed}, 'legacy')
      on conflict (player_id, pet_seed) do nothing`;
    inserted++;
  }
}

console.log(`✓ backfilled ${inserted} pet-look assignment rows`);
