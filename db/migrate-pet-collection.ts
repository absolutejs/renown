// Searchable, sortable pet-inventory metadata. Additive and idempotent.
// The fields are deterministic derivatives of pet_seed, so backfilling is safe.
import { generate } from "../core/procgen.ts";
import { sql } from "./index.ts";

await sql`alter table wild_seed_sources add column if not exists name text not null default ''`;
await sql`alter table wild_seed_sources add column if not exists tier text not null default 'Common'`;
await sql`alter table wild_seed_sources add column if not exists rarity_score real not null default 0`;
await sql`alter table wild_seed_sources add column if not exists size integer not null default 0`;
await sql`alter table wild_seed_sources add column if not exists species text not null default ''`;
await sql`alter table wild_seed_sources add column if not exists aura text not null default 'none'`;
await sql`alter table wild_seed_sources add column if not exists one_of_one boolean not null default false`;

const rows = await sql`
  select player_id, pet_seed from wild_seed_sources where name = '' or species = ''
` as { player_id: string; pet_seed: string }[];
for (let offset = 0; offset < rows.length; offset += 25) {
  await Promise.all(rows.slice(offset, offset + 25).map((row) => {
    const pet = generate(row.pet_seed);
    return sql`
      update wild_seed_sources set
        name = ${pet.name}, tier = ${pet.tier}, rarity_score = ${pet.score},
        size = ${pet.sizeN}, species = ${pet.traits.species}, aura = ${pet.traits.aura},
        one_of_one = ${pet.oneOfOne}
      where player_id = ${row.player_id} and pet_seed = ${row.pet_seed}
    `;
  }));
}

await sql`create index if not exists wild_seed_sources_owner_recent_idx on wild_seed_sources (player_id, earned_at, pet_seed)`;
await sql`create index if not exists wild_seed_sources_owner_rarity_idx on wild_seed_sources (player_id, rarity_score, pet_seed)`;
await sql`create index if not exists wild_seed_sources_owner_size_idx on wild_seed_sources (player_id, size, pet_seed)`;
await sql`create index if not exists wild_seed_sources_tier_recent_idx on wild_seed_sources (tier, earned_at, pet_seed)`;
await sql`create index if not exists wild_seed_sources_species_recent_idx on wild_seed_sources (species, earned_at, pet_seed)`;

console.log(`✓ searchable pet collection metadata ensured (${rows.length} backfilled)`);
