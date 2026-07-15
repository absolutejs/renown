import { and, eq, sql } from "drizzle-orm";
import { playerAccounts, players } from "../../../db/schema.ts";
import { reservedAiClaimMatches, reservedAiForLogin } from "./reservedAi.ts";
import { gameDb } from "./sync.ts";

export const assertReservedAiClaim = async (login: string, githubSubject: string | number | null | undefined) => {
  const reserved = reservedAiForLogin(login);
  if (!reserved) return null;
  if (!reservedAiClaimMatches(login, githubSubject)) {
    throw new Error(`reserved AI @${reserved.login} requires GitHub account id ${reserved.githubId}`);
  }
  const player = (await gameDb.select({
    id: players.id, reservedGithubId: players.reservedGithubId, isAi: players.isAi,
  }).from(players).where(sql`lower(${players.githubLogin}) = ${reserved.login}`).limit(1))[0];
  if (!player?.isAi || Number(player.reservedGithubId) !== reserved.githubId) {
    throw new Error(`reserved AI @${reserved.login} is not configured with its pinned GitHub id`);
  }
  return { reserved, playerId: player.id };
};

export const markReservedAiClaimed = async ({
  playerId, login, githubSubject, userSub,
}: { playerId: string; login: string; githubSubject: string | number; userSub: string | null }) => {
  const claim = await assertReservedAiClaim(login, githubSubject);
  if (!claim || claim.playerId !== playerId) return false;
  await gameDb.update(players).set({
    githubVerified: true, claimStatus: "claimed", ...(userSub ? { userSub } : {}),
  }).where(and(eq(players.id, playerId), eq(players.reservedGithubId, claim.reserved.githubId)));
  await gameDb.update(playerAccounts).set({ githubVerified: true })
    .where(and(eq(playerAccounts.playerId, playerId), sql`lower(${playerAccounts.githubLogin}) = ${claim.reserved.login}`));
  return true;
};
