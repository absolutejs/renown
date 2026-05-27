// Per-user push preference object on players. Default '{}' so an absent field reads
// as "opted in" (the publish-time checks treat undefined as true). Cheaper than a
// row-per-event table and idiomatic for renown's jsonb-leaning schema.
//
//   bun run db/migrate-add-push-prefs.ts
import { sql } from "./index.ts";

await sql`alter table players add column if not exists push_prefs jsonb not null default '{}'::jsonb`;
console.log("✓ players.push_prefs column ensured (default empty object → all events opted in)");
