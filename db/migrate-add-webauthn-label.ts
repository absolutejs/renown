// Adds label text column to webauthn_credentials. Default "Hardware key" so existing
// rows have a sensible name in the management UI; PATCH /api/account/webauthn/
// credentials/:id { label } lets the user rename.
//
//   bun run db/migrate-add-webauthn-label.ts
import { sql } from "./index.ts";

await sql`alter table webauthn_credentials add column if not exists label text not null default 'Hardware key'`;
console.log("✓ webauthn_credentials.label column ensured");
