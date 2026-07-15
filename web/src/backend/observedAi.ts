import { and, eq, sql } from "drizzle-orm";
import { attributionCommits, playerAccounts, players } from "../../../db/schema.ts";
import { fetchAttributionShas } from "./attribution.ts";
import { rollupPlayerFromAccounts } from "./playerAccounts.ts";
import { gameDb } from "./sync.ts";

// Refresh a reserved, unclaimed AI from public co-author evidence. This deliberately does not
// confer GitHub ownership: github_verified remains false until the pinned account completes OAuth.
export const syncObservedAiAttribution = async (playerId: string, login: string, query: string, token = process.env.GITHUB_TOKEN) => {
  const [player, account] = await Promise.all([
    gameDb.select({ isAi: players.isAi, claimStatus: players.claimStatus, reservedGithubId: players.reservedGithubId })
      .from(players).where(eq(players.id, playerId)).limit(1).then((rows) => rows[0]),
    gameDb.select().from(playerAccounts).where(and(eq(playerAccounts.playerId, playerId), sql`lower(${playerAccounts.githubLogin}) = ${login.toLowerCase()}`)).limit(1).then((rows) => rows[0]),
  ]);
  if (!player?.isAi || player.claimStatus !== "unclaimed" || player.reservedGithubId == null || !account) {
    throw new Error("observed AI refresh requires an unclaimed reserved persona");
  }

  const candidates = await fetchAttributionShas(query, 1000, token);
  const inserted = candidates.length > 0
    ? await gameDb.insert(attributionCommits).values(candidates.map((sha) => ({ playerId, githubLogin: login, sha })))
      .onConflictDoNothing().returning({ sha: attributionCommits.sha })
    : [];
  const delta = inserted.length;
  if (delta > 0) {
    await gameDb.update(playerAccounts).set({
      attributionScore: Number(account.attributionScore) + delta,
      verifiedScore: Number(account.verifiedScore) + delta,
      lastAttributionSyncAt: new Date(), attributionLedgerInitialized: true,
    }).where(and(eq(playerAccounts.playerId, playerId), sql`lower(${playerAccounts.githubLogin}) = ${login.toLowerCase()}`));
    await rollupPlayerFromAccounts(playerId);
  } else {
    await gameDb.update(playerAccounts).set({ lastAttributionSyncAt: new Date(), attributionLedgerInitialized: true })
      .where(and(eq(playerAccounts.playerId, playerId), sql`lower(${playerAccounts.githubLogin}) = ${login.toLowerCase()}`));
  }
  return { discovered: candidates.length, added: delta };
};
