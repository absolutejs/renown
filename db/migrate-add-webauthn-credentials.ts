// WebAuthn credentials per player. Hardware key / passkey / platform authenticator.
// Used by the self-key attestation path: a verified WebAuthn assertion signed by a
// registered credential stamps attestation.webauthnVerified=true (sibling to the
// provider-JWT .verified flag — different trust source).
//
//   bun run db/migrate-add-webauthn-credentials.ts
import { sql } from "./index.ts";

await sql`
  create table if not exists webauthn_credentials (
    id text primary key,
    player_id text not null references players(id) on delete cascade,
    credential_id text not null unique,
    public_key text not null,
    counter integer not null default 0,
    transports jsonb not null default '[]'::jsonb,
    created_at timestamp not null default now(),
    last_used_at timestamp
  )
`;
await sql`create index if not exists webauthn_credentials_player on webauthn_credentials(player_id)`;
console.log("✓ webauthn_credentials table + per-player index ensured");
