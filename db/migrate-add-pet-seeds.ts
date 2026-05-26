// Adds rarest_pet_seed + biggest_pet_seed text columns to players and backfills them
// from each player's existing wild array (the seeds are deterministic procgen inputs, so
// scoring/sizing them locally matches what the API computes on its next /verify pass).
//
// Idempotent: re-running re-derives the same seeds; ALTER TABLE ... ADD COLUMN IF NOT EXISTS
// makes the schema change a no-op when the columns already exist.
//
//   bun run db/migrate-add-pet-seeds.ts
import { generate } from "../core/procgen.ts";
import { sql } from "./index.ts";

await sql`alter table players add column if not exists rarest_pet_seed text`;
await sql`alter table players add column if not exists biggest_pet_seed text`;
console.log("✓ columns ensured");

const rows = await sql`select id, wild from players where jsonb_array_length(wild) > 0` as { id: string; wild: string[] }[];
console.log(`backfilling ${rows.length} player(s) with pets…`);

let touched = 0;
for (const row of rows) {
  const seeds = Array.isArray(row.wild) ? row.wild : [];
  if (seeds.length === 0) continue;
  const creatures = seeds.map((s) => ({ s, c: generate(s) }));
  const rarest = creatures.reduce((a, b) => (b.c.score > a.c.score ? b : a));
  const biggest = creatures.reduce((a, b) => (b.c.sizeN > a.c.sizeN ? b : a));
  await sql`update players set rarest_pet_seed = ${rarest.s}, biggest_pet_seed = ${biggest.s} where id = ${row.id}`;
  touched++;
}
console.log(`✓ backfilled ${touched} player(s)`);
