import { describe, expect, test } from "bun:test";
import { presentGithubAccounts } from "../web/src/backend/auth/githubAccountPresentation.ts";

const ledger = (githubLogin: string, verifiedScore: number, attributionScore: number) => ({
  githubLogin,
  githubVerified: true,
  verifiedScore,
  attributionScore,
  attributionQuery: `author:${githubLogin}`,
  lastAttributionSyncAt: new Date("2026-07-14T12:00:00Z"),
  verifiedAt: new Date("2026-07-14T12:00:00Z"),
  verifiedSkillXp: { typescript: verifiedScore },
  prReviewsCount: 4,
  crossRepoPrsCount: 2,
  prsMergedCount: 3,
  packageDownloads: 100,
  substanceScore: 7.5,
  lastMeritSyncAt: new Date("2026-07-14T12:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

describe("presentGithubAccounts", () => {
  test("keeps each GitHub's score, skills, sync state, and role distinct", () => {
    const accounts = presentGithubAccounts({
      profileLogin: "public-dev",
      primaryIdentityId: "github-work",
      identities: [
        { id: "github-personal", provider_subject: "101", metadata: { login: "public-dev", name: "Alex Personal", avatar_url: "personal.png" }, created_at: new Date("2025-01-01T00:00:00Z") },
        { id: "github-work", provider_subject: "202", metadata: { login: "work-dev", name: "Alex Work", avatar_url: "work.png" }, created_at: new Date("2025-02-01T00:00:00Z") },
      ],
      ledgerAccounts: [ledger("public-dev", 7000, 1000), ledger("work-dev", 3000, 500)],
    });

    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      login: "public-dev",
      displayName: "Alex Personal",
      verifiedScore: 7000,
      baseScore: 6000,
      verifiedSkillXp: { typescript: 7000 },
      isProfilePrimary: true,
      isLoginPrimary: false,
      loginLinked: true,
    });
    expect(accounts[1]).toMatchObject({
      login: "work-dev",
      displayName: "Alex Work",
      verifiedScore: 3000,
      baseScore: 2500,
      isProfilePrimary: false,
      isLoginPrimary: true,
      loginLinked: true,
    });
  });

  test("includes score-ledger accounts that are not web login identities", () => {
    const accounts = presentGithubAccounts({
      profileLogin: "public-dev",
      primaryIdentityId: null,
      identities: [],
      ledgerAccounts: [ledger("public-dev", 7000, 1000), ledger("cli-only", 900, 100)],
    });

    expect(accounts.map(({ login }) => login)).toEqual(["public-dev", "cli-only"]);
    expect(accounts[1]).toMatchObject({
      login: "cli-only",
      loginLinked: false,
      verifiedScore: 900,
      baseScore: 800,
      accountName: "@cli-only",
    });
  });
});
