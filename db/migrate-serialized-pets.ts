// Serialized pet-card engine: subjects → supply-capped printings → owned copies.
// Additive and idempotent. Existing pets keep their ownership/provenance and become
// closed Founders records; serials are a deterministic shuffle of each fixed run.
import {
  BUILTIN_CARD_SUBJECTS, CARD_RECIPE_VERSION, CARD_SET, CARD_VARIANTS, builtInCardSubjectSeed,
  cardPrintingId, generate, serialPermutation, shuffledSerial, stableToken, type CardVariant,
} from "../core/procgen.ts";
import { sql } from "./index.ts";

await sql`create table if not exists pet_sets (
  id text primary key,
  name text not null,
  description text not null default '',
  subject_count integer not null,
  release_year integer not null,
  cover_style text not null default 'midnight',
  spoiler_mode text not null default 'owned-only',
  ordinal integer not null default 0,
  created_at timestamp not null default now()
)`;
await sql`insert into pet_sets (id, name, description, subject_count, release_year, cover_style, ordinal) values
  ('genesis-2026', 'Genesis 2026', 'Renown’s first public release: 256 hidden subjects, seven parallel finishes, and independently rolled colorways, materials, surface patterns, and mutations.', ${BUILTIN_CARD_SUBJECTS}, 2026, 'holo', 1),
  ('legacy-genesis', 'Founders Archive', 'Closed pre-public originals earned by Renown’s first two collectors. Preserved for provenance and never available in public pulls.', 120, 2026, 'archive', 0)
  on conflict (id) do update set name = excluded.name, description = excluded.description, release_year = excluded.release_year, cover_style = excluded.cover_style, ordinal = excluded.ordinal`;

await sql`create table if not exists pet_subjects (
  id text primary key,
  set_id text not null,
  slot_number integer not null,
  subject_seed text not null unique,
  name text not null,
  created_at timestamp not null default now()
)`;
await sql`alter table pet_subjects add column if not exists slot_number integer`;
await sql`with ranked as (
  select id, row_number() over (partition by set_id order by subject_seed, id)::int slot_number
  from pet_subjects where slot_number is null
) update pet_subjects s set slot_number = ranked.slot_number from ranked where s.id = ranked.id`;
await sql`alter table pet_subjects alter column slot_number set not null`;
await sql`create index if not exists pet_subjects_set_idx on pet_subjects (set_id, id)`;
await sql`create unique index if not exists pet_subjects_set_slot_uniq on pet_subjects (set_id, slot_number)`;

await sql`create table if not exists pet_printings (
  id text primary key,
  subject_id text not null references pet_subjects(id),
  set_id text not null,
  variant text not null,
  print_run integer not null check (print_run > 0),
  issued integer not null default 0 check (issued >= 0 and issued <= print_run),
  serial_offset integer not null default 0,
  serial_step integer not null default 1,
  created_at timestamp not null default now()
)`;
await sql`create unique index if not exists pet_printings_subject_variant_uniq on pet_printings (subject_id, variant)`;
await sql`alter table pet_printings add column if not exists serial_offset integer not null default 0`;
await sql`alter table pet_printings add column if not exists serial_step integer not null default 1`;

await sql`alter table wild_seed_sources add column if not exists provenance_seed text`;
await sql`alter table wild_seed_sources add column if not exists printing_id text references pet_printings(id)`;
await sql`alter table wild_seed_sources add column if not exists serial_number integer`;
await sql`alter table wild_seed_sources add column if not exists print_run integer`;
await sql`alter table wild_seed_sources add column if not exists mint_number integer`;
await sql`alter table wild_seed_sources add column if not exists variant text`;
await sql`alter table wild_seed_sources add column if not exists finish text`;
await sql`alter table wild_seed_sources add column if not exists recipe_version text`;
await sql`alter table wild_seed_sources add column if not exists mutation text`;
await sql`alter table wild_seed_sources add column if not exists colorway text`;
await sql`alter table wild_seed_sources add column if not exists material text`;
await sql`alter table wild_seed_sources add column if not exists copy_pattern text`;
await sql`create unique index if not exists wild_seed_sources_printing_serial_uniq on wild_seed_sources (printing_id, serial_number)`;
await sql`create unique index if not exists wild_seed_sources_player_provenance_uniq on wild_seed_sources (player_id, provenance_seed)`;
await sql`create index if not exists wild_seed_sources_finish_recent_idx on wild_seed_sources (finish, earned_at, pet_seed)`;
await sql`create index if not exists wild_seed_sources_mutation_recent_idx on wild_seed_sources (mutation, earned_at, pet_seed)`;
await sql`create index if not exists wild_seed_sources_material_recent_idx on wild_seed_sources (material, earned_at, pet_seed)`;
await sql`create index if not exists wild_seed_sources_copy_pattern_recent_idx on wild_seed_sources (copy_pattern, earned_at, pet_seed)`;

await sql`create table if not exists collector_books (
  id text primary key,
  player_id text not null references players(id) on delete cascade,
  name text not null,
  description text not null default '',
  visibility text not null default 'private',
  cover_style text not null default 'midnight',
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
)`;
await sql`create index if not exists collector_books_owner_updated_idx on collector_books (player_id, updated_at)`;
await sql`create table if not exists collector_book_slots (
  book_id text not null references collector_books(id) on delete cascade,
  position integer not null check (position > 0),
  target jsonb not null default '{"kind":"freeform","label":"Open slot"}'::jsonb,
  pet_seed text,
  note text not null default '',
  created_at timestamp not null default now(),
  primary key (book_id, position)
)`;
await sql`create unique index if not exists collector_book_slots_book_pet_uniq on collector_book_slots (book_id, pet_seed) where pet_seed is not null`;

// One function call is one PostgreSQL transaction. The advisory lock makes retries for
// the same player/provenance idempotent; the row UPDATE serializes different pulls from
// the same printing. If copy insertion fails, the serial increment rolls back with it.
await sql`drop function if exists issue_pet_copy(text, text, text, text, text, text, text, text, text, integer, text, text)`;
await sql`drop function if exists issue_pet_copy(text, text, text, text, text, text, text, text, text, integer, integer, integer, text, text, text)`;
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
  p_serial_offset integer,
  p_serial_step integer,
  p_finish text,
  p_recipe_version text,
  p_seed_prefix text,
  p_copy_token text
) returns table (out_pet_seed text, out_serial_number integer, out_print_run integer, out_printing_id text, out_created boolean)
language plpgsql as $$
declare
  v_existing record;
  v_serial integer;
  v_mint integer;
  v_total integer;
  v_offset integer;
  v_step integer;
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

  select s.subject_seed into v_subject_seed from pet_subjects s where s.id = p_subject_id;
  if not found then raise exception 'pet subject % is not in the frozen manifest', p_subject_id; end if;
  if v_subject_seed is distinct from p_subject_seed then raise exception 'pet subject identity mismatch for %', p_subject_id; end if;

  insert into pet_printings (id, subject_id, set_id, variant, print_run, serial_offset, serial_step)
  values (p_printing_id, p_subject_id, p_set_id, p_variant, p_print_run, p_serial_offset, p_serial_step)
  on conflict (id) do nothing;
  select p.print_run, p.serial_offset, p.serial_step into v_total, v_offset, v_step from pet_printings p where p.id = p_printing_id;
  if v_total is distinct from p_print_run then raise exception 'immutable print run mismatch for %', p_printing_id; end if;
  if v_offset is distinct from p_serial_offset or v_step is distinct from p_serial_step then raise exception 'immutable serial permutation mismatch for %', p_printing_id; end if;

  update pet_printings p set issued = p.issued + 1
   where p.id = p_printing_id and p.issued < p.print_run
   returning p.issued, p.print_run into v_mint, v_total;
  if not found then return; end if;

  v_serial := (mod(p_serial_offset::bigint + (v_mint::bigint - 1) * p_serial_step::bigint, v_total::bigint) + 1)::integer;
  v_pet_seed := p_seed_prefix || ':' || v_serial || ':' || v_total || ':' || p_copy_token;
  insert into wild_seed_sources (
    player_id, pet_seed, github_login, provenance_seed, printing_id, serial_number, print_run, mint_number, variant, finish, recipe_version
  ) values (
    p_player_id, v_pet_seed, p_github_login, p_provenance_seed, p_printing_id, v_serial, v_total, v_mint, p_variant, p_finish, p_recipe_version
  );
  return query select v_pet_seed, v_serial, v_total, p_printing_id, true;
end $$`;

// The deploy migrates before the binary swap. Keep the previous 15-argument contract
// alive so the currently running server can still issue v1 copies if compile or smoke
// fails after migration; the new binary calls the versioned overload above.
await sql`create or replace function issue_pet_copy(
  p_player_id text, p_github_login text, p_provenance_seed text,
  p_subject_id text, p_subject_seed text, p_subject_name text,
  p_set_id text, p_variant text, p_printing_id text,
  p_print_run integer, p_serial_offset integer, p_serial_step integer,
  p_finish text, p_seed_prefix text, p_copy_token text
) returns table (out_pet_seed text, out_serial_number integer, out_print_run integer, out_printing_id text, out_created boolean)
language sql as $$
  select * from issue_pet_copy(
    p_player_id, p_github_login, p_provenance_seed,
    p_subject_id, p_subject_seed, p_subject_name,
    p_set_id, p_variant, p_printing_id,
    p_print_run, p_serial_offset, p_serial_step,
    p_finish, 'genesis-v1', p_seed_prefix, p_copy_token
  )
$$`;

// Genesis remains editable until its first public release. This migration expands its
// deterministic manifest without renumbering any of the original 64 subject slots.
for (let i = 0; i < BUILTIN_CARD_SUBJECTS; i++) {
  const subjectSeed = builtInCardSubjectSeed(i);
  const subjectId = `${CARD_SET}:${stableToken(subjectSeed)}`;
  const pet = generate(subjectSeed);
  await sql`insert into pet_subjects (id, set_id, slot_number, subject_seed, name)
    values (${subjectId}, ${CARD_SET}, ${i + 1}, ${subjectSeed}, ${pet.name}) on conflict (id) do nothing`;
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
  const [{ next_slot: nextSlot = 1 } = { next_slot: 1 }] = await sql`select coalesce(max(slot_number), 0)::int + 1 next_slot from pet_subjects where set_id = ${setId}` as { next_slot: number }[];
  await sql`insert into pet_subjects (id, set_id, slot_number, subject_seed, name)
    values (${subjectId}, ${setId}, ${nextSlot}, ${subjectSeed}, ${name}) on conflict (id) do nothing`;
  const permutation = serialPermutation(printingId, printRun);
  await sql`insert into pet_printings (id, subject_id, set_id, variant, print_run, serial_offset, serial_step)
    values (${printingId}, ${subjectId}, ${setId}, ${variant}, ${printRun}, ${permutation.offset}, ${permutation.step}) on conflict (id) do nothing`;
  await sql`with allocated as (
    update pet_printings set issued = issued + 1
     where id = ${printingId}
       and exists (select 1 from wild_seed_sources where player_id = ${row.player_id} and pet_seed = ${row.pet_seed} and printing_id is null)
     returning issued, print_run
  ) update wild_seed_sources w set
      provenance_seed = coalesce(w.provenance_seed, w.pet_seed),
      printing_id = ${printingId}, serial_number = allocated.issued, print_run = allocated.print_run,
      variant = ${variant}, finish = ${CARD_VARIANTS[variant].finish}
    from allocated where w.player_id = ${row.player_id} and w.pet_seed = ${row.pet_seed}`;
}

// Install stable permutations for pre-existing printings, then give every already-earned
// copy its mint ordinal and shuffled serial. We preserve pet_seed so every historical link,
// avatar, showcase and appearance assignment remains valid; the ledger is authoritative.
const printingRows = await sql`select id, print_run from pet_printings` as { id: string; print_run: number }[];
for (const printing of printingRows) {
  const permutation = serialPermutation(printing.id, Number(printing.print_run));
  await sql`update pet_printings set serial_offset = ${permutation.offset}, serial_step = ${permutation.step} where id = ${printing.id}`;
}
const unnumbered = await sql`select player_id, pet_seed, printing_id from wild_seed_sources where mint_number is null and printing_id is not null` as { player_id: string; pet_seed: string; printing_id: string }[];
if (unnumbered.length > 0) {
  await sql`update wild_seed_sources set serial_number = null where mint_number is null and printing_id is not null`;
  await sql`with ranked as (
    select player_id, pet_seed, printing_id,
      row_number() over (partition by printing_id order by earned_at, player_id, pet_seed)::int as mint_number
    from wild_seed_sources where mint_number is null and printing_id is not null
  ) update wild_seed_sources w set mint_number = ranked.mint_number
    from ranked where w.player_id = ranked.player_id and w.pet_seed = ranked.pet_seed`;
  const copies = await sql`select w.player_id, w.pet_seed, w.printing_id, w.mint_number, p.print_run, p.variant
    from wild_seed_sources w join pet_printings p on p.id = w.printing_id where w.serial_number is null` as { player_id: string; pet_seed: string; printing_id: string; mint_number: number; print_run: number; variant: CardVariant }[];
  for (const copy of copies) {
    const serial = shuffledSerial(copy.printing_id, Number(copy.mint_number), Number(copy.print_run));
    const pet = generate(copy.pet_seed);
    const rarityScore = pet.card ? pet.score : +(pet.score - Math.log2(CARD_VARIANTS[copy.variant].probability)).toFixed(2);
    await sql`update wild_seed_sources set serial_number = ${serial}, print_run = ${copy.print_run}, variant = ${copy.variant},
      finish = ${CARD_VARIANTS[copy.variant].finish}, mutation = ${pet.copyTraits?.mutation ?? "Standard"}, colorway = ${pet.copyTraits?.colorway ?? "Original"},
      rarity_score = ${rarityScore}
      where player_id = ${copy.player_id} and pet_seed = ${copy.pet_seed}`;
  }
}

// Materialize the versioned copy recipe after Founders conversion. Existing card:v1
// links retain their exact v1 generation; new card:v2 copies use Genesis v2.
const recipeRows = await sql`select player_id, pet_seed, variant from wild_seed_sources where printing_id is not null` as { player_id: string; pet_seed: string; variant: CardVariant }[];
for (const row of recipeRows) {
  const pet = generate(row.pet_seed);
  await sql`update wild_seed_sources set
    recipe_version = ${pet.card?.recipeVersion ?? "founders-v1"},
    finish = ${CARD_VARIANTS[row.variant]?.finish ?? "Base"},
    mutation = ${pet.copyTraits?.mutation ?? "Standard"}, colorway = ${pet.copyTraits?.colorway ?? "Original"},
    material = ${pet.copyTraits?.material ?? "Standard"}, copy_pattern = ${pet.copyTraits?.copyPattern ?? "None"},
    rarity_score = ${pet.score}
    where player_id = ${row.player_id} and pet_seed = ${row.pet_seed}`;
}

await sql`update pet_sets s set subject_count = counts.total from (
  select set_id, count(*)::int total from pet_subjects group by set_id
) counts where s.id = counts.set_id`;

console.log(`✓ serialized pet engine ensured (${BUILTIN_CARD_SUBJECTS} Genesis subjects, Founders closed to public pulls, recipe ${CARD_RECIPE_VERSION})`);
