// Add actor_kind + actor_sub columns to ai_attestation_events. Nullable: legacy
// rows stay null; new rows always stamp at least the kind. Lets the dashboard +
// profile timeline answer "who did this?" for every event.
//
//   bun run db/migrate-add-attestation-actor.ts
import { sql } from "./index.ts";

await sql`alter table ai_attestation_events add column if not exists actor_kind text`;
await sql`alter table ai_attestation_events add column if not exists actor_sub text`;
console.log("✓ ai_attestation_events.actor_kind + actor_sub columns ensured");
