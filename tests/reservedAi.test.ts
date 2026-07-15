import { describe, expect, test } from "bun:test";
import { isPublicParticipant, reservedAiClaimMatches, reservedAiForLogin } from "../web/src/backend/reservedAi.ts";

describe("reserved AI identity claims", () => {
  test("pins Claude and Codex to immutable GitHub numeric IDs", () => {
    expect(reservedAiForLogin("CLAUDE")?.githubId).toBe(81_847);
    expect(reservedAiForLogin("codex")?.githubId).toBe(267_193_182);
    expect(reservedAiClaimMatches("claude", 81_847)).toBe(true);
    expect(reservedAiClaimMatches("codex", "267193182")).toBe(true);
  });

  test("rejects usernames, missing subjects, and lookalike account IDs", () => {
    expect(reservedAiClaimMatches("claude", "claude")).toBe(false);
    expect(reservedAiClaimMatches("claude", null)).toBe(false);
    expect(reservedAiClaimMatches("codex", 267_193_183)).toBe(false);
    expect(reservedAiClaimMatches("ordinary-user", null)).toBe(true);
  });

  test("makes reserved unclaimed AIs public without claiming GitHub ownership", () => {
    expect(isPublicParticipant({ githubVerified: false, isAi: true, claimStatus: "unclaimed", reservedGithubId: 81_847 })).toBe(true);
    expect(isPublicParticipant({ githubVerified: false, isAi: true, claimStatus: "unclaimed", reservedGithubId: null })).toBe(false);
    expect(isPublicParticipant({ githubVerified: false, isAi: true, claimStatus: "claimed", reservedGithubId: 81_847 })).toBe(false);
    expect(isPublicParticipant({ githubVerified: true, isAi: false, claimStatus: "claimed", reservedGithubId: null })).toBe(true);
  });
});
