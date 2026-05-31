// Adds the social graph: follows (follower → followee). Powers /rivals (your circle's board +
// activity feed) and the Follow button on profiles. Idempotent.
import { sql } from "./index.ts";

await sql`create table if not exists follows (
  follower_id text not null references players(id) on delete cascade,
  followee_id text not null references players(id) on delete cascade,
  created_at timestamp not null default now(),
  primary key (follower_id, followee_id)
)`;
await sql`create index if not exists follows_follower_idx on follows (follower_id)`;
await sql`create index if not exists follows_followee_idx on follows (followee_id)`;
console.log("✓ follows table ensured");
