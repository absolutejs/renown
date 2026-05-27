// Append-only audit log of ai_attestation state changes. /api/account/ai-attestation
// (and the CLI variant) write one row per claim / verify / clear. /api/profile/:login
// joins this in so the trail is public-readable for transparency.
//
//   bun run db/migrate-add-ai-attestation-events.ts
import { sql } from "./index.ts";

await sql`
  create table if not exists ai_attestation_events (
    id text primary key,
    player_id text not null references players(id) on delete cascade,
    at timestamp not null default now(),
    kind text not null,
    provider text,
    evidence_url text,
    verified boolean not null default false
  )
`;
await sql`create index if not exists ai_attestation_events_player_at on ai_attestation_events(player_id, at desc)`;
console.log("✓ ai_attestation_events table + index ensured");
