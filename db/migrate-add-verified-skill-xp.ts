// Adds a server-verified skill-XP ledger so the /top?skill=<id> board can rank GitHub-scored
// skill XP instead of self-reported players.skill_xp (the last spoofable-and-ranked surface — see
// docs/trust-model.md). verified_skill_xp is recomputed server-side by running the SAME skill
// routing (core/skills.ts awardCraft) over the player's GitHub commits, so it can't be forged via
// /api/submit. Additive + idempotent; the existing self-reported skill_xp stays as advisory.
//
// NOT auto-run — it's an ALTER on the shared Neon DB, so it's the maintainer's call:
//   bun run db/migrate-add-verified-skill-xp.ts
import { sql } from "./index.ts";

await sql`alter table players add column if not exists verified_skill_xp jsonb not null default '{}'::jsonb`;

console.log("✓ players.verified_skill_xp column ensured");
