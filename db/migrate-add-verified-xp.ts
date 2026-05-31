// Adds server-verified per-project columns so the /project board can rank by GitHub-scored XP
// (from POST /api/ci/repo-sync) instead of self-reported /submit XP — closing the last
// spoofable-and-ranked surface (see docs/trust-model.md). Additive + idempotent; existing
// self-reported xp/commits/lines stay as advisory columns.
import { sql } from "./index.ts";

await sql`alter table player_projects add column if not exists verified_xp bigint not null default 0`;
await sql`alter table player_projects add column if not exists verified_commits integer not null default 0`;
await sql`alter table player_projects add column if not exists verified_lines bigint not null default 0`;

console.log("✓ player_projects verified_{xp,commits,lines} columns ensured");
