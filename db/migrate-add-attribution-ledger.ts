// Makes co-author attribution idempotent by recording each credited commit SHA. Existing scores
// are treated as the historical baseline: their ledgers start on the next full UTC day, avoiding
// a one-time replay of commits already included by the old day-window counter.
//
//   bun --env-file=web/.env db/migrate-add-attribution-ledger.ts
import { sql } from "./index.ts";

await sql`alter table player_accounts add column if not exists attribution_ledger_started_on text`;
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

const tomorrow = new Date(Date.UTC(
  new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1,
)).toISOString().slice(0, 10);
await sql`
  update player_accounts
  set attribution_ledger_started_on = ${tomorrow}
  where attribution_ledger_started_on is null
`;
console.log(`✓ attribution SHA ledger ensured; existing accounts begin incremental tracking on ${tomorrow}`);
