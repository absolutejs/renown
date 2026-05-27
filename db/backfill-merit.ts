// One-shot merit backfill — iterate every github-verified player, fetch the
// 4 GH-native signals, recompute merit_score, grant achievements. Same logic
// as the merit-refresh cron, just with no batch cap and a per-row console log
// so the operator can watch progress.
//
// Skips players already synced in the last 24h (rerun is safe + cheap). Pass
// --force to re-sync everyone regardless. Substance is NOT classified here —
// that's a separate ingestion path (substance-refresh cron) because each
// commit needs an additional API call. Run db/backfill-substance.ts for that.
//
//   bun run db/backfill-merit.ts            # respects 24h sync cooldown
//   bun run db/backfill-merit.ts --force    # re-sync every verified player
//   GITHUB_TOKEN=... bun run db/backfill-merit.ts   # higher rate-limit
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { computeMeritScore, fetchCrossRepoPrsCount, fetchPackageDownloads, fetchPrCounts, fetchPrReviewsCount, meritAchievementsToGrant } from "../web/src/backend/merit.ts";
import { db } from "./index.ts";
import { players } from "./schema.ts";

const force = process.argv.includes("--force");

const SLEEP_MS = 250;     // gentle pacing — GitHub Search caps at 30/min unauth, 10/min for /search/commits
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
const where = force
  ? and(eq(players.githubVerified, true), isNotNull(players.githubLogin))
  : and(
      eq(players.githubVerified, true),
      isNotNull(players.githubLogin),
      or(sql`${players.lastMeritSyncAt} IS NULL`, lt(players.lastMeritSyncAt, cutoff)),
    );

const due = await db.select().from(players).where(where);
console.log(`merit backfill: ${due.length} player(s) to sync${force ? " (forced)" : ""}`);

// Grant counter for the summary line — we don't dedupe achievement grants
// here (grantAchievements is idempotent server-side so re-runs are free; this
// script bypasses that and writes directly to keep the DB ops in-process).
let totalGranted = 0, failed = 0;

for (let i = 0; i < due.length; i++) {
  const p = due[i]!;
  const login = p.githubLogin!;
  try {
    const [reviews, crossRepo, prCounts, downloads] = await Promise.all([
      fetchPrReviewsCount(login),
      fetchCrossRepoPrsCount(login),
      fetchPrCounts(login),
      fetchPackageDownloads(login),
    ]);
    const meritScore = computeMeritScore({
      prReviewsCount: reviews, crossRepoPrsCount: crossRepo,
      prsAuthoredCount: prCounts.authored, prsMergedCount: prCounts.merged,
      packageDownloads: downloads,
      substanceScore: p.substanceScore, substanceSampleSize: p.substanceSampleSize,
    });
    await db.update(players).set({
      prReviewsCount: reviews,
      crossRepoPrsCount: crossRepo,
      prsAuthoredCount: prCounts.authored,
      prsMergedCount: prCounts.merged,
      packageDownloads: downloads,
      meritScore,
      lastMeritSyncAt: new Date(),
    }).where(eq(players.id, p.id));
    const grantIds = meritAchievementsToGrant({
      prReviewsCount: reviews, crossRepoPrsCount: crossRepo, prsMergedCount: prCounts.merged,
      packageDownloads: downloads, substanceScore: p.substanceScore, substanceSampleSize: p.substanceSampleSize,
    });
    // Direct grant — onConflictDoNothing keeps re-runs idempotent. drizzle's
    // sql interpolation expands JS arrays into separate params (bad for our
    // unnest call here), so pass an array-literal text instead.
    if (grantIds.length > 0) {
      const arrayLiteral = `{${grantIds.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",")}}`;
      await db.execute(sql`
        INSERT INTO player_achievements (player_id, achievement_id, unlocked_at)
        SELECT ${p.id}, achievement_id, now()
        FROM unnest(${arrayLiteral}::text[]) AS achievement_id
        ON CONFLICT DO NOTHING
      `);
      // Bump unlock counts on the catalog rows (rarity recompute is its own script).
      await db.execute(sql`UPDATE achievements SET unlock_count = unlock_count + 1 WHERE id = ANY(${arrayLiteral}::text[])`);
      totalGranted += grantIds.length;
    }
    console.log(`  [${i + 1}/${due.length}] @${login}  merit=${meritScore}  reviews=${reviews} crossRepo=${crossRepo} merged=${prCounts.merged}/${prCounts.authored} dls=${downloads.toLocaleString()}  +${grantIds.length} tier(s)`);
  } catch (e) {
    failed++;
    console.error(`  [${i + 1}/${due.length}] @${login}  FAILED: ${(e as Error).message}`);
  }
  if (i < due.length - 1) await sleep(SLEEP_MS);
}

console.log(`\n✓ merit backfill complete: ${due.length - failed} synced, ${failed} failed, ${totalGranted} tier-grant events recorded`);
process.exit(0);
