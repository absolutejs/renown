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
import { players, playerAccounts } from "../../../../db/schema.ts";
import { buildStaleAttestationDigest, deliverWebhook } from "../attestation.ts";
import { buildWeeklyDigest } from "../recap.ts";
import { fetchCrossRepoPrsCount, fetchPackageDownloads, fetchPrCounts, fetchPrReviewsCount, meritAchievementsToGrant } from "../merit.ts";
import { aggregateSubstance, fetchRecentCommits } from "../substance.ts";
import { rollupPlayerFromAccounts } from "../playerAccounts.ts";
import { gameDb, grantAchievements, hub } from "../sync.ts";
import { processOnchainTransferOutbox } from "../onchainOutbox.ts";
import { syncAttributedProjects } from "../project.ts";
import { syncObservedAiAttribution } from "../observedAi.ts";

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

// Weekly "your week on renown" recap digest. POST to RENOWN_RECAP_WEBHOOK if set — every player
// who earned renown this week, with their weekly gain + new achievements + a link to their recap
// card. Like the attestation digest, delivery (email / Slack / Discord) is operator-owned; this
// builds + posts the data. RENOWN_PUBLIC_URL makes the recap links fully-qualified.
const postWeeklyRecapIfConfigured = async () => {
  const url = process.env.RENOWN_RECAP_WEBHOOK;
  if (!url) return;
  const digest = await buildWeeklyDigest(process.env.RENOWN_PUBLIC_URL);
  if (digest.players.length === 0) return;   // quiet week — nobody to nudge
  await deliverWebhook(url, "weekly-recap-digest", {
    event: "weekly-recap-digest",
    generatedAt: new Date().toISOString(),
    weekOf: digest.weekOf,
    players: digest.players,
  });
};

export const cronPlugin = () =>
  new Elysia({ name: "renown-cron" })
    .use(cron({
      name: "onchain-transfer-outbox",
      pattern: "* * * * *",
      run: async () => {
        try { const result = await processOnchainTransferOutbox(); if (result.anchored || result.failed) console.log(`[renown:cron] on-chain outbox anchored=${result.anchored} failed=${result.failed}`); }
        catch (e) { console.error("[renown:cron] on-chain transfer outbox failed", e); }
      },
    }))
    .use(cron({
      // AI agents often have no always-on workstation hook. Refresh their normal verified
      // account through the same /api/verify path humans use, then discover repositories from
      // the provider-specific co-author query. Public repo rows only; private results fail closed.
      // Small rotating hourly batches stay within GitHub's unauthenticated API budget.
      name: "ai-participant-refresh",
      pattern: "15 * * * *",
      run: async () => {
        try {
          const cutoff = new Date(Date.now() - 60 * 60 * 1000);
          const due = await gameDb.select({
            playerId: playerAccounts.playerId, login: playerAccounts.githubLogin,
            attributionQuery: playerAccounts.attributionQuery, verifiedAt: playerAccounts.verifiedAt,
            lastAttributionSyncAt: playerAccounts.lastAttributionSyncAt,
            claimStatus: players.claimStatus,
          }).from(playerAccounts).innerJoin(players, eq(players.id, playerAccounts.playerId))
            .where(and(
              eq(players.isAi, true), isNotNull(players.reservedGithubId), isNotNull(playerAccounts.attributionQuery),
              or(
                and(eq(players.claimStatus, "claimed"), eq(players.githubVerified, true), eq(playerAccounts.githubVerified, true),
                  or(sql`${playerAccounts.verifiedAt} IS NULL`, lt(playerAccounts.verifiedAt, cutoff))),
                and(eq(players.claimStatus, "unclaimed"),
                  or(sql`${playerAccounts.lastAttributionSyncAt} IS NULL`, lt(playerAccounts.lastAttributionSyncAt, cutoff))),
              ),
            )).orderBy(sql`${playerAccounts.verifiedAt} NULLS FIRST`).limit(10);
          const base = (process.env.RENOWN_PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`).replace(/\/$/, "");
          for (const account of due) {
            try {
              if (account.claimStatus === "claimed") {
                const response = await fetch(`${base}/api/verify`, {
                  method: "POST", headers: { "content-type": "application/json", "user-agent": "renown-ai-cron" },
                  body: JSON.stringify({ login: account.login }), signal: AbortSignal.timeout(120_000),
                });
                const result = await response.json().catch(() => ({})) as { error?: string };
                if (!response.ok || result.error) throw new Error(result.error || `verify returned ${response.status}`);
              } else {
                await syncObservedAiAttribution(account.playerId, account.login, account.attributionQuery!);
              }
              const projectResult = await syncAttributedProjects(account.playerId, account.attributionQuery!, {
                maxCommits: 200, maxRepos: 15, samplePerRepo: 1,
                offset: Math.floor(Date.now() / (60 * 60 * 1000)) * 15,
              });
              console.log(`[renown:cron] ai-participant-refresh @${account.login} repos=${projectResult.synced}/${projectResult.discovered}`);
            } catch (error) {
              console.error(`[renown:cron] ai-participant-refresh failed for @${account.login}`, error);
            }
          }
        } catch (error) {
          console.error("[renown:cron] ai-participant-refresh batch failed", error);
        }
      },
    }))
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
      name: "weekly-recap-digest",
      pattern: "0 13 * * 1",   // Mondays 13:00 UTC (offset from the attestation digest)
      run: async () => {
        try { await postWeeklyRecapIfConfigured(); }
        catch (e) { console.error("[renown:cron] weekly-recap-digest failed", e); }
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
          // Iterate per-github ACCOUNTS (oldest-synced first) so a multi-github player gets each
          // of its githubs refreshed; roll the touched players up once at the end.
          const due = await gameDb.select({ playerId: playerAccounts.playerId, login: playerAccounts.githubLogin })
            .from(playerAccounts)
            .innerJoin(players, eq(players.id, playerAccounts.playerId))
            .where(and(
              eq(players.githubVerified, true),
              eq(playerAccounts.githubVerified, true),
              or(sql`${playerAccounts.lastMeritSyncAt} IS NULL`, lt(playerAccounts.lastMeritSyncAt, cutoff)),
            )).orderBy(sql`${playerAccounts.lastMeritSyncAt} NULLS FIRST`).limit(20);
          const touched = new Set<string>();
          for (const a of due) {
            const login = a.login;
            try {
              const [reviews, crossRepo, prCounts, downloads] = await Promise.all([
                fetchPrReviewsCount(login), fetchCrossRepoPrsCount(login),
                fetchPrCounts(login), fetchPackageDownloads(login),
              ]);
              await gameDb.update(playerAccounts).set({
                prReviewsCount: reviews, crossRepoPrsCount: crossRepo,
                prsAuthoredCount: prCounts.authored, prsMergedCount: prCounts.merged,
                packageDownloads: downloads, lastMeritSyncAt: new Date(),
              }).where(and(eq(playerAccounts.playerId, a.playerId), eq(playerAccounts.githubLogin, login)));
              touched.add(a.playerId);
            } catch (e) {
              console.error(`[renown:cron] merit-refresh failed for ${login}`, e);
            }
          }
          for (const pid of touched) {
            const rolled = await rollupPlayerFromAccounts(pid);
            const granted = await grantAchievements(pid, meritAchievementsToGrant({
              prReviewsCount: rolled?.prReviewsCount ?? 0, crossRepoPrsCount: rolled?.crossRepoPrsCount ?? 0,
              prsMergedCount: rolled?.prsMergedCount ?? 0, packageDownloads: rolled?.packageDownloads ?? 0,
              substanceScore: rolled?.substanceScore ?? 0, substanceSampleSize: rolled?.substanceSampleSize ?? 0,
            }));
            if (granted.length > 0) hub.publish("merit", { meritScore: rolled?.meritScore ?? 0, granted });
          }
          if (due.length > 0) console.log(`[renown:cron] merit-refresh synced ${due.length} github account(s)`);
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
          const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);   // active in last 3 days
          // Per-github accounts with an attribution query, least-classified first; roll up after.
          const due = await gameDb.select({ playerId: playerAccounts.playerId, login: playerAccounts.githubLogin, attributionQuery: playerAccounts.attributionQuery })
            .from(playerAccounts)
            .innerJoin(players, eq(players.id, playerAccounts.playerId))
            .where(and(
              eq(players.githubVerified, true),
              isNotNull(playerAccounts.attributionQuery),
              sql`${playerAccounts.lastMeritSyncAt} >= ${cutoff}`,
            )).orderBy(sql`${playerAccounts.substanceSampleSize} ASC NULLS FIRST`).limit(5);
          const touched = new Set<string>();
          for (const a of due) {
            try {
              const commits = await fetchRecentCommits(a.attributionQuery!, 30);
              if (commits.length === 0) continue;
              const { mean, sampleSize } = await aggregateSubstance(commits);
              await gameDb.update(playerAccounts).set({ substanceScore: mean, substanceSampleSize: sampleSize, lastMeritSyncAt: new Date() })
                .where(and(eq(playerAccounts.playerId, a.playerId), eq(playerAccounts.githubLogin, a.login)));
              touched.add(a.playerId);
            } catch (e) {
              console.error(`[renown:cron] substance-refresh failed for ${a.login}`, e);
            }
          }
          for (const pid of touched) {
            const rolled = await rollupPlayerFromAccounts(pid);
            const granted = await grantAchievements(pid, meritAchievementsToGrant({
              prReviewsCount: rolled?.prReviewsCount ?? 0, crossRepoPrsCount: rolled?.crossRepoPrsCount ?? 0,
              prsMergedCount: rolled?.prsMergedCount ?? 0, packageDownloads: rolled?.packageDownloads ?? 0,
              substanceScore: rolled?.substanceScore ?? 0, substanceSampleSize: rolled?.substanceSampleSize ?? 0,
            }));
            if (granted.length > 0) hub.publish("substance", { mean: rolled?.substanceScore ?? 0, sampleSize: rolled?.substanceSampleSize ?? 0, meritScore: rolled?.meritScore ?? 0, granted });
          }
          if (due.length > 0) console.log(`[renown:cron] substance-refresh classified ${due.length} github account(s)`);
        } catch (e) {
          console.error("[renown:cron] substance-refresh batch failed", e);
        }
      },
    }));
