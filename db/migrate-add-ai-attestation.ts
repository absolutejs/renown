// Adds players.ai_attestation jsonb column. Default null; populated by a player POSTing
// /api/account/ai-attestation (session-protected). Setting this flips is_ai to true.
//
//   bun run db/migrate-add-ai-attestation.ts
import { sql } from "./index.ts";

await sql`alter table players add column if not exists ai_attestation jsonb`;
console.log("✓ players.ai_attestation column ensured (jsonb, nullable)");
