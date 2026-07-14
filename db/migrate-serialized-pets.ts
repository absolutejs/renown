// Serialized pet-card engine: subjects → supply-capped printings → owned copies.
// Additive and idempotent. Existing pets keep their seed/visuals and become serial #1
// in a legacy printing; future pulls are issued atomically by issue_pet_copy().
import {
  BUILTIN_CARD_SUBJECTS, CARD_SET, CARD_VARIANTS, builtInCardSubjectSeed,
  cardPrintingId, generate, stableToken, type CardVariant,
} from "../core/procgen.ts";
import { sql } from "./index.ts";

await sql`create table if not exists pet_subjects (
  id text primary key,
  set_id text not null,
  subject_seed text not null unique,
  name text not null,
  created_at timestamp not null default now()
)`;
await sql`create index if not exists pet_subjects_set_idx on pet_subjects (set_id, id)`;

await sql`create table if not exists pet_printings (
  id text primary key,
  subject_id text not null references pet_subjects(id),
  set_id text not null,
  variant text not null,
  print_run integer not null check (print_run > 0),
  issued integer not null default 0 check (issued >= 0 and issued <= print_run),
  created_at timestamp not null default now()
)`;
await sql`create unique index if not exists pet_printings_subject_variant_uniq on pet_printings (subject_id, variant)`;

await sql`alter table wild_seed_sources add column if not exists provenance_seed text`;
await sql`alter table wild_seed_sources add column if not exists printing_id text references pet_printings(id)`;
await sql`alter table wild_seed_sources add column if not exists serial_number integer`;
await sql`alter table wild_seed_sources add column if not exists print_run integer`;
await sql`create unique index if not exists wild_seed_sources_printing_serial_uniq on wild_seed_sources (printing_id, serial_number)`;
await sql`create unique index if not exists wild_seed_sources_player_provenance_uniq on wild_seed_sources (player_id, provenance_seed)`;

// One function call is one PostgreSQL transaction. The advisory lock makes retries for
// the same player/provenance idempotent; the row UPDATE serializes different pulls from
// the same printing. If copy insertion fails, the serial increment rolls back with it.
await sql`create or replace function issue_pet_copy(
  p_player_id text,
  p_github_login text,
  p_provenance_seed text,
  p_subject_id text,
  p_subject_seed text,
  p_subject_name text,
  p_set_id text,
  p_variant text,
  p_printing_id text,
  p_print_run integer,
  p_seed_prefix text,
  p_copy_token text
) returns table (out_pet_seed text, out_serial_number integer, out_print_run integer, out_printing_id text, out_created boolean)
language plpgsql as $$
declare
  v_existing record;
  v_serial integer;
  v_total integer;
  v_pet_seed text;
  v_subject_seed text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_player_id || ':' || p_provenance_seed, 0));

  select w.pet_seed, w.serial_number, w.print_run, w.printing_id
    into v_existing
    from wild_seed_sources w
   where w.player_id = p_player_id and w.provenance_seed = p_provenance_seed
   limit 1;
  if found then
    return query select v_existing.pet_seed::text, v_existing.serial_number::integer, v_existing.print_run::integer, v_existing.printing_id::text, false;
    return;
  end if;

  insert into pet_subjects (id, set_id, subject_seed, name)
  values (p_subject_id, p_set_id, p_subject_seed, p_subject_name)
  on conflict (id) do nothing;
  select s.subject_seed into v_subject_seed from pet_subjects s where s.id = p_subject_id;
  if v_subject_seed is distinct from p_subject_seed then raise exception 'pet subject identity mismatch for %', p_subject_id; end if;

  insert into pet_printings (id, subject_id, set_id, variant, print_run)
  values (p_printing_id, p_subject_id, p_set_id, p_variant, p_print_run)
  on conflict (id) do nothing;
  select p.print_run into v_total from pet_printings p where p.id = p_printing_id;
  if v_total is distinct from p_print_run then raise exception 'immutable print run mismatch for %', p_printing_id; end if;

  update pet_printings p set issued = p.issued + 1
   where p.id = p_printing_id and p.issued < p.print_run
   returning p.issued, p.print_run into v_serial, v_total;
  if not found then return; end if;

  v_pet_seed := p_seed_prefix || ':' || v_serial || ':' || v_total || ':' || p_copy_token;
  insert into wild_seed_sources (
    player_id, pet_seed, github_login, provenance_seed, printing_id, serial_number, print_run
  ) values (
    p_player_id, v_pet_seed, p_github_login, p_provenance_seed, p_printing_id, v_serial, v_total
  );
  return query select v_pet_seed, v_serial, v_total, p_printing_id, true;
end $$`;

// The first real set has a stable pool of recognizable subjects. Future sets can add
// subjects without changing Genesis or any already-issued copy.
for (let i = 0; i < BUILTIN_CARD_SUBJECTS; i++) {
  const subjectSeed = builtInCardSubjectSeed(i);
  const subjectId = `${CARD_SET}:${stableToken(subjectSeed)}`;
  const pet = generate(subjectSeed);
  await sql`insert into pet_subjects (id, set_id, subject_seed, name)
    values (${subjectId}, ${CARD_SET}, ${subjectSeed}, ${pet.name}) on conflict (id) do nothing`;
}

type LegacyRow = { player_id: string; pet_seed: string; github_login: string; tier: string; one_of_one: boolean };
const legacyRows = await sql`select player_id, pet_seed, github_login, tier, one_of_one
  from wild_seed_sources where printing_id is null order by earned_at, player_id, pet_seed` as LegacyRow[];
const variantFor = (row: LegacyRow): CardVariant => {
  if (row.one_of_one) return "one-of-one";
  const tier = String(row.tier || "Common").toLowerCase();
  return tier === "uncommon" || tier === "rare" || tier === "epic" || tier === "legendary" || tier === "mythic" ? tier : "base";
};

for (const row of legacyRows) {
  const setId = "legacy-genesis";
  const subjectSeed = row.pet_seed;
  const subjectId = `${setId}:${stableToken(subjectSeed)}`;
  const variant = variantFor(row);
  const printRun = CARD_VARIANTS[variant].printRun;
  const printingId = cardPrintingId(setId, subjectSeed, variant);
  const name = generate(subjectSeed).name;
  await sql`insert into pet_subjects (id, set_id, subject_seed, name)
    values (${subjectId}, ${setId}, ${subjectSeed}, ${name}) on conflict (id) do nothing`;
  await sql`insert into pet_printings (id, subject_id, set_id, variant, print_run)
    values (${printingId}, ${subjectId}, ${setId}, ${variant}, ${printRun}) on conflict (id) do nothing`;
  await sql`with allocated as (
    update pet_printings set issued = issued + 1
     where id = ${printingId}
       and exists (select 1 from wild_seed_sources where player_id = ${row.player_id} and pet_seed = ${row.pet_seed} and printing_id is null)
     returning issued, print_run
  ) update wild_seed_sources w set
      provenance_seed = coalesce(w.provenance_seed, w.pet_seed),
      printing_id = ${printingId}, serial_number = allocated.issued, print_run = allocated.print_run
    from allocated where w.player_id = ${row.player_id} and w.pet_seed = ${row.pet_seed}`;
}

console.log(`✓ serialized pet engine ensured (${BUILTIN_CARD_SUBJECTS} Genesis subjects, ${legacyRows.length} legacy copies backfilled)`);
