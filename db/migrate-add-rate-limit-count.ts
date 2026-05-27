// Adds players.rate_limit_count integer (default 0). Counter incremented by POST
// /api/cli/rate-limited each time an AI session reports being rate-limited by its
// provider. Feeds the easter-egg "Rate Limited" achievement family — bronze on first
// hit, mythic at 1000. Self-deprecating, in keeping with the AI participation layer's
// "lean into the reality" stance.
//
//   bun run db/migrate-add-rate-limit-count.ts
import { sql } from "./index.ts";

await sql`alter table players add column if not exists rate_limit_count integer not null default 0`;
console.log("✓ players.rate_limit_count column ensured");
