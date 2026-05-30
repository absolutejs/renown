// Roll a multi-GitHub player's headline columns up from its per-account provenance ledger
// (player_accounts). Each account row holds that github's own verified/attribution/merit/
// substance contribution (mirroring the per-github columns the single-github world wrote to
// `players`); the player's headline numbers are the SUM across accounts so the leaderboard
// ranks one combined identity. See resolvePlayer.ts + db/migrate-add-user-sub.ts.
import { eq } from "drizzle-orm";
import { players, playerAccounts } from "../../../db/schema.ts";
import { computeMeritScore } from "./merit.ts";
import { gameDb } from "./sync.ts";

const minDate = (rows: { [k: string]: unknown }[], key: string): Date | null => {
  const ts = rows.map((r) => r[key]).filter(Boolean).map((d) => new Date(d as string | Date).getTime());
  return ts.length ? new Date(Math.min(...ts)) : null;
};

// Recompute players.<headline> = aggregate over player_accounts, then return the new totals.
// verified_score already includes attribution credit per account (players formula:
// base + attribution), so summing verified_score AND attribution_score stays consistent with
// the single-account world. Substance is sample-size-weighted across accounts.
export const rollupPlayerFromAccounts = async (playerId: string) => {
  const accts = await gameDb.select().from(playerAccounts).where(eq(playerAccounts.playerId, playerId));
  if (accts.length === 0) return null;
  const sum = (key: keyof typeof accts[number]) => accts.reduce((s, a) => s + Number(a[key] ?? 0), 0);
  const substanceSampleSize = sum("substanceSampleSize");
  const substanceScore = substanceSampleSize > 0
    ? accts.reduce((s, a) => s + Number(a.substanceScore) * Number(a.substanceSampleSize), 0) / substanceSampleSize
    : 0;
  const signals = {
    prReviewsCount: sum("prReviewsCount"),
    crossRepoPrsCount: sum("crossRepoPrsCount"),
    prsAuthoredCount: sum("prsAuthoredCount"),
    prsMergedCount: sum("prsMergedCount"),
    packageDownloads: sum("packageDownloads"),
    substanceScore, substanceSampleSize,
  };
  const totals = {
    verifiedScore: sum("verifiedScore"),
    attributionScore: sum("attributionScore"),
    ...signals,
    meritScore: computeMeritScore(signals),
    // honest cooldowns: a re-sync is "due" as soon as the OLDEST account is due.
    lastAttributionSyncAt: minDate(accts, "lastAttributionSyncAt"),
    lastMeritSyncAt: minDate(accts, "lastMeritSyncAt"),
  };
  await gameDb.update(players).set(totals).where(eq(players.id, playerId));
  return totals;
};
