// Preserve every player's highest historically verified total. Before the all-time invariant,
// a re-sync could lower score when entries fell out of GitHub's rolling public-events window.
// We cannot reconstruct the historical split across GitHubs, so any proven gap is assigned to
// the public-profile account, just like other legacy provenance in the multi-account migration.
// Additive and idempotent: once account totals reach the historical peak, reruns change nothing.
import { sql } from "./index.ts";

const restored = await sql`
  with historical as (
    select p.id as player_id,
      greatest(p.verified_score, coalesce(max(s.verified_score), 0))::bigint as peak
    from players p
    left join player_attribution_snapshots s on s.player_id = p.id
    group by p.id, p.verified_score
  ), account_totals as (
    select player_id, sum(verified_score)::bigint as total
    from player_accounts group by player_id
  ), target_accounts as (
    select distinct on (pa.player_id) pa.player_id, pa.github_login
    from player_accounts pa
    join players p on p.id = pa.player_id
    order by pa.player_id,
      (lower(pa.github_login) = lower(coalesce(p.github_login, ''))) desc,
      pa.created_at asc
  ), deficits as (
    select h.player_id, t.github_login, h.peak - coalesce(a.total, 0) as amount
    from historical h
    join target_accounts t on t.player_id = h.player_id
    left join account_totals a on a.player_id = h.player_id
    where h.peak > coalesce(a.total, 0)
  )
  update player_accounts pa
  set verified_score = pa.verified_score + d.amount
  from deficits d
  where pa.player_id = d.player_id and pa.github_login = d.github_login
  returning pa.player_id, pa.github_login, d.amount
` as { player_id: string; github_login: string; amount: string }[];

await sql`
  update players p set verified_score = totals.score
  from (
    select player_id, sum(verified_score)::bigint as score
    from player_accounts group by player_id
  ) totals
  where p.id = totals.player_id and p.verified_score <> totals.score
`;

console.log(`✓ restored all-time verified-score floors for ${restored.length} player(s)`);
for (const row of restored) console.log(`  ${row.player_id} via @${row.github_login}: +${row.amount}`);
