// Makes co-author attribution idempotent by recording each credited commit SHA. Existing scores
// are treated as the historical baseline: their first SHA population has a zero score delta.
// Accounts linked after this migration default initialized=true and can backfill normally.
//
//   bun --env-file=web/.env db/migrate-add-attribution-ledger.ts
import { sql } from "./index.ts";

const [initializedColumn] = await sql`
  select 1 from information_schema.columns
  where table_name = 'player_accounts' and column_name = 'attribution_ledger_initialized'
  limit 1
` as { "?column?": number }[];
if (!initializedColumn) {
  await sql`alter table player_accounts add column attribution_ledger_initialized boolean not null default true`;
  await sql`update player_accounts set attribution_ledger_initialized = false`;
}
await sql`
  create table if not exists attribution_commits (
    player_id text not null references players(id) on delete cascade,
    github_login text not null,
    sha text not null,
    discovered_at timestamp not null default now(),
    primary key (player_id, github_login, sha)
  )
`;
await sql`create index if not exists attribution_commits_account_idx on attribution_commits (player_id, github_login, discovered_at)`;

console.log("✓ attribution SHA ledger ensured; existing accounts will seed an idempotent baseline once");
