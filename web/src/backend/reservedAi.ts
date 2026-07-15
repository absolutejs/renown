import { and, eq, isNotNull, or } from "drizzle-orm";
import { players } from "../../../db/schema.ts";

export type ReservedAiIdentity = {
  login: string;
  githubId: number;
  provider: string;
  attributionQuery: string;
};

// Immutable GitHub numeric IDs are pinned in source and the database. A username match alone is
// never enough to claim a high-value persona because GitHub usernames can be renamed/reassigned.
export const RESERVED_AI_IDENTITIES: Record<string, ReservedAiIdentity> = {
  claude: { login: "claude", githubId: 81_847, provider: "anthropic", attributionQuery: '"Co-authored-by: Claude"' },
  codex: { login: "codex", githubId: 267_193_182, provider: "openai", attributionQuery: '"Co-authored-by: Codex"' },
};

export const reservedAiForLogin = (login: string): ReservedAiIdentity | null =>
  RESERVED_AI_IDENTITIES[login.trim().toLowerCase()] ?? null;

export const reservedAiClaimMatches = (login: string, githubSubject: string | number | null | undefined): boolean => {
  const reserved = reservedAiForLogin(login);
  return !reserved || String(githubSubject ?? "") === String(reserved.githubId);
};

// Public participation includes ownership-verified humans/AIs plus reserved AI personas whose
// work is independently observable but whose GitHub account has not been claimed yet.
export const publicParticipantCondition = () => or(
  eq(players.githubVerified, true),
  and(eq(players.isAi, true), eq(players.claimStatus, "unclaimed"), isNotNull(players.reservedGithubId)),
);

export const isPublicParticipant = (player: Pick<typeof players.$inferSelect, "githubVerified" | "isAi" | "claimStatus" | "reservedGithubId">): boolean =>
  player.githubVerified || (player.isAi && player.claimStatus === "unclaimed" && player.reservedGithubId != null);
