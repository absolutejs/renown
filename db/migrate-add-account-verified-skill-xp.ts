// Per-account verified skill XP — so a multi-github player's /top?skill standing is the SUM of
// their skill XP across ALL linked githubs, not just whichever one synced last.
//
// Today players.verified_skill_xp is recomputed by /api/verify for the synced github and
// max-merged onto the player (a no-migration interim that stops clobbering but doesn't sum across
// accounts). With this column, /api/verify writes the synced github's recompute to ITS
// player_accounts row, and rollupPlayerFromAccounts sums per skill into players.verified_skill_xp
// (mirroring how verified_score / the merit signals already roll up). Single-github players are
// unaffected (one account → the sum is just that account).
//
// Additive + idempotent; maintainer-run (ALTER on the shared DB):
//   bun run db/migrate-add-account-verified-skill-xp.ts
import { sql } from "./index.ts";

await sql`alter table player_accounts add column if not exists verified_skill_xp jsonb not null default '{}'::jsonb`;

console.log("✓ player_accounts.verified_skill_xp column ensured");
