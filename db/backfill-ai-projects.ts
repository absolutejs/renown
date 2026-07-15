// One-shot/operator companion to the recurring ai-participant-refresh cron. Discovers public
// repositories from each verified AI account's co-author attribution query and seeds its public
// repository associations. Safe to rerun: all writes are monotonic upserts and private repos are
// rejected before persistence.
//
//   bun --env-file=web/.env db/backfill-ai-projects.ts
import { and, eq, isNotNull } from "drizzle-orm";
import { playerAccounts, players } from "./schema.ts";
import { syncAttributedProjects } from "../web/src/backend/project.ts";
import { gameDb } from "../web/src/backend/sync.ts";

const accounts = await gameDb.select({
  playerId: playerAccounts.playerId,
  login: playerAccounts.githubLogin,
  attributionQuery: playerAccounts.attributionQuery,
}).from(playerAccounts).innerJoin(players, eq(players.id, playerAccounts.playerId)).where(and(
  eq(players.isAi, true),
  eq(players.githubVerified, true),
  eq(playerAccounts.githubVerified, true),
  isNotNull(playerAccounts.attributionQuery),
));

for (const account of accounts) {
  const result = await syncAttributedProjects(account.playerId, account.attributionQuery!, {
    maxCommits: 200, maxRepos: 15, samplePerRepo: 1,
    offset: Math.max(0, Number.parseInt(process.env.AI_REPO_OFFSET ?? "0", 10) || 0),
  });
  console.log(`@${account.login}: synced ${result.synced}/${result.discovered} public attributed repos (${result.skippedPrivate} private/unavailable skipped)`);
}

console.log(`AI repository backfill complete (${accounts.length} account${accounts.length === 1 ? "" : "s"})`);
