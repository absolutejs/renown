// Web Push subscription storage — one row per (player, browser endpoint). Endpoints
// are unique per browser install; players can have many. Delivery failures with HTTP
// 410 (Gone) prune the row automatically; explicit unsubscribe deletes by id.
//
//   bun run db/migrate-add-push-subscriptions.ts
import { sql } from "./index.ts";

await sql`
  create table if not exists push_subscriptions (
    id text primary key,
    player_id text not null references players(id) on delete cascade,
    endpoint text not null,
    p256dh text not null,
    auth text not null,
    created_at timestamp not null default now(),
    last_notified_at timestamp
  )
`;
// One subscription per (player, endpoint) — re-subscribing the same browser shouldn't
// create duplicate rows. Bare UNIQUE index, no constraint, so DO NOTHING on conflict
// stays cheap in the resubscribe path.
await sql`create unique index if not exists push_subscriptions_player_endpoint on push_subscriptions(player_id, endpoint)`;
console.log("✓ push_subscriptions table + unique index ensured");
