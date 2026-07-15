// Privacy boundary for repository-derived surfaces.
//
// Legacy rows cannot be assumed public. Even `oss=true` is historical metadata: a repository
// may have been public and licensed when observed, then made private later. Every legacy row
// therefore remains unknown and hidden until the cleanup verifies its current GitHub state.
import { sql } from "./index.ts";

await sql`alter table projects add column if not exists visibility text not null default 'unknown'`;
await sql`create index if not exists projects_public_key_idx on projects (key) where visibility = 'public'`;

console.log("✓ project visibility added; every legacy repository fails closed as unknown");
