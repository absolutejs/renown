// Outbound webhook delivery log — one row per ATTEMPT. Lets ops query failed
// deliveries (where status_code is null or status_code >= 400) and replay manually.
//
//   bun run db/migrate-add-webhook-deliveries.ts
import { sql } from "./index.ts";

await sql`
  create table if not exists webhook_deliveries (
    id text primary key,
    event_kind text not null,
    url text not null,
    payload jsonb not null,
    attempt integer not null,
    status_code integer,
    attempted_at timestamp not null default now(),
    last_error text
  )
`;
await sql`create index if not exists webhook_deliveries_failed_at on webhook_deliveries(attempted_at desc) where status_code is null or status_code >= 400`;
console.log("✓ webhook_deliveries table + failed-attempt index ensured");
