// One-shot merit backfill — iterate every github ACCOUNT on a verified player, fetch the
// 4 GH-native signals into that account's row, then roll each touched player's merit up
// across all its githubs. Same logic as the merit-refresh cron, just with no batch cap and a
// per-row console log. Multi-github aware (each linked github is synced + summed).
//
// Skips accounts already synced in the last 24h (rerun is safe + cheap). Pass --force to
// re-sync everyone. Substance is NOT classified here — run db/backfill-substance.ts.
//
//   bun run db/backfill-merit.ts            # respects 24h sync cooldown
//   bun run db/backfill-merit.ts --force    # re-sync every github account
//   GITHUB_TOKEN=... bun run db/backfill-merit.ts   # higher rate-limit
import { and, eq, lt, or, sql } from "drizzle-orm";
import { fetchCrossRepoPrsCount, fetchPackageDownloads, fetchPrCounts, fetchPrReviewsCount, meritAchievementsToGrant } from "../web/src/backend/merit.ts";
import { rollupPlayerFromAccounts } from "../web/src/backend/playerAccounts.ts";
import { db } from "./index.ts";
import { players, playerAccounts } from "./schema.ts";

const force = process.argv.includes("--force");
const SLEEP_MS = 250;     // gentle pacing — GitHub Search caps at 30/min unauth
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
const base = and(eq(players.githubVerified, true), eq(playerAccounts.githubVerified, true));
const where = force ? base : and(base, or(sql`${playerAccounts.lastMeritSyncAt} IS NULL`, lt(playerAccounts.lastMeritSyncAt, cutoff)));
const due = await db.select({ playerId: playerAccounts.playerId, login: playerAccounts.githubLogin })
  .from(playerAccounts).innerJoin(players, eq(players.id, playerAccounts.playerId)).where(where);
console.log(`merit backfill: ${due.length} github account(s) to sync${force ? " (forced)" : ""}`);

let failed = 0;
const touched = new Set<string>();
for (let i = 0; i < due.length; i++) {
  const a = due[i]!;
  const login = a.login;
  try {
    const [reviews, crossRepo, prCounts, downloads] = await Promise.all([
      fetchPrReviewsCount(login), fetchCrossRepoPrsCount(login), fetchPrCounts(login), fetchPackageDownloads(login),
    ]);
    await db.update(playerAccounts).set({
      prReviewsCount: reviews, crossRepoPrsCount: crossRepo,
      prsAuthoredCount: prCounts.authored, prsMergedCount: prCounts.merged,
      packageDownloads: downloads, lastMeritSyncAt: new Date(),
    }).where(and(eq(playerAccounts.playerId, a.playerId), eq(playerAccounts.githubLogin, login)));
    touched.add(a.playerId);
    console.log(`  [${i + 1}/${due.length}] @${login}  reviews=${reviews} crossRepo=${crossRepo} merged=${prCounts.merged}/${prCounts.authored} dls=${downloads.toLocaleString()}`);
  } catch (e) {
    failed++;
    console.error(`  [${i + 1}/${due.length}] @${login}  FAILED: ${(e as Error).message}`);
  }
  if (i < due.length - 1) await sleep(SLEEP_MS);
}

// Roll each touched player up across its accounts, then grant tiers off the AGGREGATE merit.
let totalGranted = 0;
for (const pid of touched) {
  const rolled = await rollupPlayerFromAccounts(pid);
  const grantIds = meritAchievementsToGrant({
    prReviewsCount: rolled?.prReviewsCount ?? 0, crossRepoPrsCount: rolled?.crossRepoPrsCount ?? 0,
    prsMergedCount: rolled?.prsMergedCount ?? 0, packageDownloads: rolled?.packageDownloads ?? 0,
    substanceScore: rolled?.substanceScore ?? 0, substanceSampleSize: rolled?.substanceSampleSize ?? 0,
  });
  if (grantIds.length === 0) continue;
  // Grant via direct SQL; RETURNING tells us which were actually new so unlock_count isn't inflated.
  const arrayLiteral = `{${grantIds.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",")}}`;
  const inserted = await db.execute<{ achievement_id: string }>(sql`
    INSERT INTO player_achievements (player_id, achievement_id, unlocked_at)
    SELECT ${pid}, achievement_id, now() FROM unnest(${arrayLiteral}::text[]) AS achievement_id
    ON CONFLICT DO NOTHING RETURNING achievement_id`);
  const newIds = inserted.rows ?? [];
  if (newIds.length > 0) {
    const lit = `{${newIds.map((r) => `"${r.achievement_id.replace(/"/g, '\\"')}"`).join(",")}}`;
    await db.execute(sql`UPDATE achievements SET unlock_count = unlock_count + 1 WHERE id = ANY(${lit}::text[])`);
    totalGranted += newIds.length;
  }
}

console.log(`\n✓ merit backfill complete: ${due.length - failed} account(s) synced across ${touched.size} player(s), ${failed} failed, ${totalGranted} tier-grant events`);
process.exit(0);
