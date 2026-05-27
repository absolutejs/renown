// Adds the "merit" half — per-dimension columns on players for the hard-to-game
// signals (PR reviews given, cross-repo merged PRs, PR shipped count, npm
// package downloads, commit substance), plus the rolled-up merit_score that
// feeds verified_score on the leaderboard. See web/src/backend/merit.ts for
// the per-dimension fetchers and the roll-up formula.
//
//   bun run db/migrate-add-merit.ts
import { sql } from "./index.ts";

await sql`alter table players add column if not exists merit_score bigint not null default 0`;
await sql`alter table players add column if not exists pr_reviews_count integer not null default 0`;
await sql`alter table players add column if not exists cross_repo_prs_count integer not null default 0`;
await sql`alter table players add column if not exists prs_authored_count integer not null default 0`;
await sql`alter table players add column if not exists prs_merged_count integer not null default 0`;
await sql`alter table players add column if not exists package_downloads bigint not null default 0`;
await sql`alter table players add column if not exists substance_score real not null default 0`;
await sql`alter table players add column if not exists substance_sample_size integer not null default 0`;
await sql`alter table players add column if not exists last_merit_sync_at timestamp`;
console.log("✓ players merit columns ensured (merit_score + 7 sub-counters + last_merit_sync_at)");
