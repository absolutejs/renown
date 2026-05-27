// Scheduled background tasks. Currently just the attestation-expiry sweep — runs
// hourly and demotes verified-with-past-expiresAt attestations to public claims. The
// per-/api/verify sweep keeps active players current; this catches the players who
// never re-sync (so a stale verified badge gets demoted in a timely way regardless).
//
// Single instance, in-process — matches the rest of sync.ts. When we cluster, this
// moves to a leader-elected job (or @elysiajs/cron's clustered mode if it lands).

import { cron } from "@elysiajs/cron";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { players } from "../../../../db/schema.ts";
import { buildStaleAttestationDigest, deliverWebhook } from "../attestation.ts";
import { computeMeritScore, fetchCrossRepoPrsCount, fetchPackageDownloads, fetchPrCounts, fetchPrReviewsCount, meritAchievementsToGrant } from "../merit.ts";
import { aggregateSubstance, fetchRecentCommits } from "../substance.ts";
import { gameDb, grantAchievements, hub } from "../sync.ts";

const sweepExpiredAttestations = async (): Promise<number> => {
  // jsonb update path: build the demoted attestation (drop .verified + .expiresAt,
  // keep everything else) and write it back per matching row. Doing it in one SQL
  // statement with `(ai_attestation - 'verified' - 'expiresAt')` works but loses the
  // explicit row count + isn't much cheaper at our scale — readable wins.
  const rows = await gameDb.select().from(players).where(
    and(
      eq(players.isAi, true),
      sql`(${players.aiAttestation} ->> 'verified')::boolean = true`,
      sql`(${players.aiAttestation} ->> 'expiresAt') < ${new Date().toISOString()}`,
    ),
  );
  for (const row of rows) {
    const a = row.aiAttestation as { provider?: string; claimedAt?: string; evidenceUrl?: string; webauthnVerified?: boolean } | null;
    if (!a) continue;
    const demoted = { provider: a.provider, claimedAt: a.claimedAt, ...(a.evidenceUrl ? { evidenceUrl: a.evidenceUrl } : {}), ...(a.webauthnVerified ? { webauthnVerified: true } : {}) };
    await gameDb.update(players).set({ aiAttestation: demoted as typeof players.$inferInsert["aiAttestation"] }).where(eq(players.id, row.id));
  }
  return rows.length;
};

// Weekly digest of attestations expiring soon. POST to RENOWN_DIGEST_WEBHOOK if set;
// admin can also pull the same data from /api/admin/expiring-attestations on demand.
// Honest scope: actual email sending is operator-owned (wire the webhook to whatever
// service you use — Resend / SendGrid / Postmark / a Slack channel / a Discord bot /
// IFTTT). Mondays 09:00 UTC because the bulk of contributors check their inbox
// Monday morning regardless of timezone.
const DIGEST_WITHIN_DAYS = 30;
const postDigestIfConfigured = async () => {
  const url = process.env.RENOWN_DIGEST_WEBHOOK;
  if (!url) return;
  const entries = await buildStaleAttestationDigest(DIGEST_WITHIN_DAYS);
  if (entries.length === 0) return;   // nothing to remind anyone about
  await deliverWebhook(url, "attestation.expiring-digest", {
    event: "attestation.expiring-digest",
    withinDays: DIGEST_WITHIN_DAYS,
    generatedAt: new Date().toISOString(),
    entries,
  });
};

export const cronPlugin = () =>
  new Elysia({ name: "renown-cron" })
    .use(cron({
      name: "attestation-expiry-sweep",
      // Every hour on the hour. Cheap query (single indexed predicate + a per-row
      // update for the matches); even on a busy week we'd be sweeping a handful.
      pattern: "0 * * * *",
      run: async () => {
        try {
          const n = await sweepExpiredAttestations();
          if (n > 0) console.log(`[renown:cron] attestation-expiry-sweep demoted ${n} expired verified attestation(s)`);
        } catch (e) {
          console.error("[renown:cron] attestation-expiry-sweep failed", e);
        }
      },
    }))
    .use(cron({
      name: "attestation-expiring-digest",
      pattern: "0 9 * * 1",   // Mondays 09:00 UTC
      run: async () => {
        try { await postDigestIfConfigured(); }
        catch (e) { console.error("[renown:cron] attestation-expiring-digest failed", e); }
      },
    }))
    .use(cron({
      // Merit refresh — the hard-to-game half of the leaderboard. Runs every 6 hours;
      // picks up to 20 verified players whose merit hasn't been synced in the last
      // 24h (oldest first), refreshes all 4 GH-native signals + recomputes merit_score
      // + grants any newly-crossed tier achievements. Soft-batched so a single tick
      // never spends more than ~100 upstream HTTP calls (5 per player × 20 players).
      // Player-triggered refreshes via POST /api/cli/merit-sync are immediate and
      // independent.
      name: "merit-refresh",
      pattern: "0 */6 * * *",
      run: async () => {
        try {
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const due = await gameDb.select({
            id: players.id, login: players.githubLogin,
            substanceScore: players.substanceScore, substanceSampleSize: players.substanceSampleSize,
            verifiedScore: players.verifiedScore, meritScore: players.meritScore,
          }).from(players).where(and(
            eq(players.githubVerified, true),
            isNotNull(players.githubLogin),
            or(sql`${players.lastMeritSyncAt} IS NULL`, lt(players.lastMeritSyncAt, cutoff)),
          )).orderBy(sql`${players.lastMeritSyncAt} NULLS FIRST`).limit(20);
          for (const p of due) {
            const login = p.login!;   // isNotNull guard above
            try {
              const [reviews, crossRepo, prCounts, downloads] = await Promise.all([
                fetchPrReviewsCount(login), fetchCrossRepoPrsCount(login),
                fetchPrCounts(login), fetchPackageDownloads(login),
              ]);
              const meritScore = computeMeritScore({
                prReviewsCount: reviews, crossRepoPrsCount: crossRepo,
                prsAuthoredCount: prCounts.authored, prsMergedCount: prCounts.merged,
                packageDownloads: downloads,
                substanceScore: p.substanceScore, substanceSampleSize: p.substanceSampleSize,
              });
              await gameDb.update(players).set({
                prReviewsCount: reviews, crossRepoPrsCount: crossRepo,
                prsAuthoredCount: prCounts.authored, prsMergedCount: prCounts.merged,
                packageDownloads: downloads, meritScore, lastMeritSyncAt: new Date(),
              }).where(eq(players.id, p.id));
              const grantIds = meritAchievementsToGrant({
                prReviewsCount: reviews, crossRepoPrsCount: crossRepo, prsMergedCount: prCounts.merged,
                packageDownloads: downloads, substanceScore: p.substanceScore, substanceSampleSize: p.substanceSampleSize,
              });
              const granted = await grantAchievements(p.id, grantIds);
              if (granted.length > 0) hub.publish("merit", { login, meritScore, reviews, crossRepo, authored: prCounts.authored, merged: prCounts.merged, downloads, granted });
            } catch (e) {
              console.error(`[renown:cron] merit-refresh failed for ${login}`, e);
            }
          }
          if (due.length > 0) console.log(`[renown:cron] merit-refresh synced ${due.length} player(s)`);
        } catch (e) {
          console.error("[renown:cron] merit-refresh batch failed", e);
        }
      },
    }))
    .use(cron({
      // Substance refresh — the RAG-or-heuristic classifier from substance.ts.
      // Much more expensive than the merit refresh (one fetch per commit
      // classified), so runs less often + a smaller batch: 5 verified players
      // per tick, daily. Picks players who have an attribution query set and
      // whose last_merit_sync_at is recent (i.e. they're getting other signals
      // refreshed too — a good proxy for "currently active"). Updates
      // substance_score + sample_size + recomputed merit_score in one txn.
      name: "substance-refresh",
      pattern: "30 3 * * *",   // 03:30 UTC daily; offset from the other crons
      run: async () => {
        try {
          const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);   // ran in last 3 days
          const due = await gameDb.select().from(players).where(and(
            eq(players.githubVerified, true),
            isNotNull(players.attributionQuery),
            sql`${players.lastMeritSyncAt} >= ${cutoff}`,
          )).orderBy(sql`${players.substanceSampleSize} ASC NULLS FIRST`).limit(5);
          for (const p of due) {
            try {
              const commits = await fetchRecentCommits(p.attributionQuery!, 30);
              if (commits.length === 0) continue;
              const { mean, sampleSize } = await aggregateSubstance(commits);
              const meritScore = computeMeritScore({
                prReviewsCount: p.prReviewsCount, crossRepoPrsCount: p.crossRepoPrsCount,
                prsAuthoredCount: p.prsAuthoredCount, prsMergedCount: p.prsMergedCount,
                packageDownloads: Number(p.packageDownloads),
                substanceScore: mean, substanceSampleSize: sampleSize,
              });
              await gameDb.update(players).set({
                substanceScore: mean, substanceSampleSize: sampleSize, meritScore,
              }).where(eq(players.id, p.id));
              const grantIds = meritAchievementsToGrant({
                prReviewsCount: p.prReviewsCount, crossRepoPrsCount: p.crossRepoPrsCount,
                prsMergedCount: p.prsMergedCount, packageDownloads: Number(p.packageDownloads),
                substanceScore: mean, substanceSampleSize: sampleSize,
              });
              const granted = await grantAchievements(p.id, grantIds);
              if (granted.length > 0) hub.publish("substance", { login: p.githubLogin, mean, sampleSize, meritScore, granted });
            } catch (e) {
              console.error(`[renown:cron] substance-refresh failed for ${p.githubLogin}`, e);
            }
          }
          if (due.length > 0) console.log(`[renown:cron] substance-refresh classified for ${due.length} player(s)`);
        } catch (e) {
          console.error("[renown:cron] substance-refresh batch failed", e);
        }
      },
    }));
