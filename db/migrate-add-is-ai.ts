// Adds players.is_ai (boolean, default false) and backfills the Claude account.
// AI accounts participate identically to humans — same score, same pets, same achievements,
// same leaderboards. The flag exists purely so a 🤖 badge can be rendered alongside the
// handle, in keeping with the project's "be honest about AI participation" stance.
//
//   bun run db/migrate-add-is-ai.ts
import { sql } from "./index.ts";

await sql`alter table players add column if not exists is_ai boolean not null default false`;
console.log("✓ column ensured");

// Backfill: mark the known AI participants. Add more here as they appear (or do it via
// the admin UI once that exists). github_login is case-sensitive in our schema, so use the
// canonical GitHub spelling.
const aiLogins = ["claude", "codex"];
const result = await sql`update players set is_ai = true where github_login = any(${aiLogins})` as { count?: number } | undefined;
console.log(`✓ marked ${aiLogins.length} AI account(s) (rows touched: ${result?.count ?? "?"})`);
