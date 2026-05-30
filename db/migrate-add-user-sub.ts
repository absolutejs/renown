// Multi-GitHub support — stage 1 migration. Anchors each game `players` row to the auth
// `users.sub` so a user's multiple linked GitHub accounts all resolve to one aggregate player,
// and adds the provenance ledger (`player_accounts`) + per-seed source map (`wild_seed_sources`).
// Idempotent + re-runnable. See web/src/backend/resolvePlayer.ts for the lookup primitive.
//
//   bun run db/migrate-add-user-sub.ts
import { sql } from "./index.ts";

// 1) players.user_sub — nullable FK→users.sub (legacy/CLI-only players stay null).
await sql`alter table players add column if not exists user_sub text`;

// 2) provenance ledger — one row per (player, github_login).
await sql`create table if not exists player_accounts (
  player_id text not null references players(id) on delete cascade,
  github_login text not null,
  attribution_query text,
  last_attribution_sync_at timestamp,
  verified_score bigint not null default 0,
  attribution_score bigint not null default 0,
  verified_at timestamp,
  pr_reviews_count integer not null default 0,
  cross_repo_prs_count integer not null default 0,
  prs_authored_count integer not null default 0,
  prs_merged_count integer not null default 0,
  package_downloads bigint not null default 0,
  substance_score real not null default 0,
  substance_sample_size integer not null default 0,
  last_merit_sync_at timestamp,
  github_verified boolean not null default false,
  created_at timestamp not null default now(),
  primary key (player_id, github_login)
)`;

// 3) per-seed → github provenance.
await sql`create table if not exists wild_seed_sources (
  player_id text not null references players(id) on delete cascade,
  pet_seed text not null,
  github_login text not null,
  primary key (player_id, pet_seed)
)`;

// Constraints/indexes: a github belongs to exactly one player; one aggregate player per user.
await sql`create unique index if not exists player_accounts_github_login_uniq on player_accounts (github_login)`;
await sql`create index if not exists player_accounts_player_id_idx on player_accounts (player_id)`;
await sql`create unique index if not exists players_user_sub_uniq on players (user_sub) where user_sub is not null`;
await sql`create index if not exists wild_seed_sources_player_id_idx on wild_seed_sources (player_id)`;
console.log("✓ user_sub column, player_accounts, wild_seed_sources ensured");

// 4) Backfill players.user_sub from the auth layer: match a player's github_login to a github
//    auth identity (case-insensitive on metadata.login, falling back to provider_subject).
const linked = await sql`
  update players p set user_sub = ai.user_sub
  from auth_identities ai
  where ai.auth_provider = 'github'
    and lower(coalesce(ai.metadata->>'login', ai.provider_subject)) = lower(p.github_login)
    and p.user_sub is null
  returning p.id` as { id: string }[];
console.log(`✓ backfilled user_sub for ${linked.length} player(s) with a github auth identity`);

// 5) Detect multi-player-per-user collisions (a user who already minted >1 player). For the
//    current data this is empty; if it ever fires, leave them split for the merge-request flow
//    (stage 4) rather than auto-folding here. The partial unique index above would also reject
//    a bad backfill, so surface it loudly.
const dupes = await sql`
  select user_sub, count(*)::int as n from players
  where user_sub is not null group by user_sub having count(*) > 1` as { user_sub: string; n: number }[];
if (dupes.length > 0) {
  console.warn(`⚠ ${dupes.length} user(s) map to multiple players — queue a merge (stage 4), not auto-folded:`);
  for (const d of dupes) console.warn(`    ${d.user_sub}: ${d.n} players`);
}

// 6) Seed player_accounts from each player's primary github_login (copy its current per-github
//    scoring columns). Secondary githubs are attached at link time (CLI/web), starting at 0.
const accts = await sql`
  insert into player_accounts (player_id, github_login, attribution_query, last_attribution_sync_at,
    verified_score, attribution_score, verified_at, pr_reviews_count, cross_repo_prs_count,
    prs_authored_count, prs_merged_count, package_downloads, substance_score, substance_sample_size,
    last_merit_sync_at, github_verified, created_at)
  select id, github_login, attribution_query, last_attribution_sync_at,
    verified_score, attribution_score, verified_at, pr_reviews_count, cross_repo_prs_count,
    prs_authored_count, prs_merged_count, package_downloads, substance_score, substance_sample_size,
    last_merit_sync_at, github_verified, now()
  from players where github_login is not null
  on conflict (player_id, github_login) do nothing
  returning player_id` as { player_id: string }[];
console.log(`✓ seeded ${accts.length} player_accounts row(s)`);

// 7) Seed wild_seed_sources: every existing wild seed maps to the player's primary github_login
//    (we can't retroactively know which github earned a legacy seed; primary is the honest default).
const sources = await sql`
  insert into wild_seed_sources (player_id, pet_seed, github_login)
  select p.id, seed, p.github_login
  from players p, jsonb_array_elements_text(p.wild) as seed
  where p.github_login is not null and jsonb_array_length(p.wild) > 0
  on conflict (player_id, pet_seed) do nothing
  returning player_id` as { player_id: string }[];
console.log(`✓ seeded ${sources.length} wild_seed_sources row(s)`);

console.log("✓ multi-github stage-1 migration complete");
