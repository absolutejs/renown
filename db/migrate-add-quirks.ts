// Adds players.quirks jsonb (default empty object). One column for every easter-egg
// counter the CLI can bump via /api/cli/quirk. Same pattern as rate_limit_count but
// generalized so adding a new quirk is data, not a migration.
//
//   bun run db/migrate-add-quirks.ts
import { sql } from "./index.ts";

await sql`alter table players add column if not exists quirks jsonb not null default '{}'::jsonb`;
console.log("✓ players.quirks column ensured (default empty object)");
