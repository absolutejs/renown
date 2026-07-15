// Splits publicly observed AI personas from GitHub ownership. Existing Claude co-author history
// stays on its player, but the legacy auth binding is removed once and ownership becomes
// unclaimed. Codex is created under the same model. Future claims must pass the source-pinned
// immutable GitHub numeric IDs in web/src/backend/reservedAi.ts.
//
//   bun --env-file=web/.env db/migrate-reserved-ai-identities.ts
import { sql } from "./index.ts";

const [claimColumn] = await sql`
  select 1 from information_schema.columns
  where table_name = 'players' and column_name = 'claim_status'
  limit 1
` as { "?column?": number }[];

if (!claimColumn) {
  await sql`alter table players add column claim_status text not null default 'claimed'`;
  await sql`alter table players add column reserved_github_id bigint`;
  await sql`alter table players add column ai_provider text`;

  // One-time correction of the legacy conflation. Delete only the GitHub identity attached to
  // Claude's old user; the credentials user remains intact but no longer owns the AI persona.
  await sql`
    delete from auth_identities
    where auth_provider = 'github'
      and user_sub = (select user_sub from players where id = 'gh:claude')
      and lower(coalesce(metadata->>'login', provider_subject)) = 'claude'
  `;
  await sql`
    update players set user_sub = null, github_verified = false, verified_at = null,
      claim_status = 'unclaimed', reserved_github_id = 81847, ai_provider = 'anthropic',
      is_ai = true, attribution_query = '"Co-authored-by: Claude"',
      verified_score = attribution_score, merit_score = 0,
      pr_reviews_count = 0, cross_repo_prs_count = 0, prs_authored_count = 0,
      prs_merged_count = 0, package_downloads = 0, substance_score = 0,
      substance_sample_size = 0, verified_skill_xp = '{}'::jsonb
    where id = 'gh:claude'
  `;
  await sql`
    update player_accounts set github_verified = false, verified_at = null,
      attribution_query = '"Co-authored-by: Claude"', verified_score = attribution_score,
      pr_reviews_count = 0, cross_repo_prs_count = 0, prs_authored_count = 0,
      prs_merged_count = 0, package_downloads = 0, substance_score = 0,
      substance_sample_size = 0, verified_skill_xp = '{}'::jsonb
    where player_id = 'gh:claude' and lower(github_login) = 'claude'
  `;
}

const conflictingCodex = await sql`
  select id from players where lower(coalesce(github_login, '')) = 'codex' and id <> 'ai:codex' limit 1
` as { id: string }[];
if (conflictingCodex.length > 0) throw new Error(`refusing to reserve @codex; existing player ${conflictingCodex[0]!.id} must be reviewed`);

await sql`
  insert into players (
    id, handle, github_login, github_verified, is_ai, claim_status,
    reserved_github_id, ai_provider, attribution_query
  ) values (
    'gh:claude', 'Claude', 'claude', false, true, 'unclaimed',
    81847, 'anthropic', '"Co-authored-by: Claude"'
  )
  on conflict (id) do update set
    is_ai = true, reserved_github_id = 81847, ai_provider = 'anthropic',
    attribution_query = '"Co-authored-by: Claude"'
`;
await sql`
  insert into player_accounts (
    player_id, github_login, attribution_query, attribution_ledger_initialized, github_verified
  ) values ('gh:claude', 'claude', '"Co-authored-by: Claude"', true, false)
  on conflict (player_id, github_login) do update set
    attribution_query = excluded.attribution_query
`;

await sql`
  insert into players (
    id, handle, github_login, github_verified, is_ai, claim_status,
    reserved_github_id, ai_provider, attribution_query
  ) values (
    'ai:codex', 'Codex', 'codex', false, true, 'unclaimed',
    267193182, 'openai', '"Co-authored-by: Codex"'
  )
  on conflict (id) do update set
    is_ai = true, reserved_github_id = 267193182, ai_provider = 'openai',
    attribution_query = '"Co-authored-by: Codex"'
`;
await sql`
  insert into player_accounts (
    player_id, github_login, attribution_query, attribution_ledger_initialized, github_verified
  ) values ('ai:codex', 'codex', '"Co-authored-by: Codex"', true, false)
  on conflict (player_id, github_login) do update set
    attribution_query = excluded.attribution_query
`;

console.log("✓ reserved AI identities ensured: Claude corrected, Codex available as unclaimed");
