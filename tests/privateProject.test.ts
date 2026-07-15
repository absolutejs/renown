import { afterEach, describe, expect, test } from "bun:test";
import { createInMemoryLinkedProviderStores, createOAuthLinkedProviderCredentialResolver } from "../web/node_modules/@absolutejs/auth/dist/index.js";
import { persistGithubRepoGrant } from "../web/src/backend/auth/githubRepoGrants.ts";
import { buildPrivateProject, loadPrivateProject, privateActivityXp } from "../web/src/backend/privateProject.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const resolverWithGrant = async () => {
  const stores = createInMemoryLinkedProviderStores();
  await persistGithubRepoGrant({
    ...stores,
    authorization: { accessToken: "private-token", userIdentity: { id: 42, login: "alex" } },
    configuredScopes: ["repo"],
    ownerRef: "user-1",
    tokenResponse: { scope: "repo" },
  });
  return createOAuthLinkedProviderCredentialResolver({
    ...stores,
    providersConfiguration: { github: { credentials: { clientId: "client", clientSecret: "secret", redirectUri: "https://example.test/callback" }, scope: ["repo"] } },
  });
};

describe("grant-scoped private project boards", () => {
  test("builds an ephemeral board without changing the familiar contributor shape", () => {
    const project = buildPrivateProject({
      accounts: [{ login: "alex", handle: "alex", avatarSeed: "pet", isAi: false, tier: "pro" }],
      contributions: [
        { login: "alex", commits: 3, additions: 400, deletions: 20 },
        { login: "bot", commits: 5, additions: 0, deletions: 0 },
      ],
      repo: { full_name: "org/secret", name: "secret", private: true, stargazers_count: 2 },
      sort: "xp",
      viewerLogins: ["alex"],
    });
    expect(privateActivityXp(3, 400)).toBe(450);
    expect(project).toEqual(expect.objectContaining({ key: "org/secret", private: true, ephemeral: true, viewerLogins: ["alex"] }));
    expect(project.contributors[0]).toEqual(expect.objectContaining({ login: "alex", verified: true, xp: 450 }));
    expect(project.contributors[1]).toEqual(expect.objectContaining({ login: "bot", verified: false }));
  });

  test("does not contact GitHub without an active grant belonging to a linked login", async () => {
    const stores = createInMemoryLinkedProviderStores();
    const resolver = await createOAuthLinkedProviderCredentialResolver({
      ...stores,
      providersConfiguration: { github: { credentials: { clientId: "client", clientSecret: "secret", redirectUri: "https://example.test/callback" }, scope: ["repo"] } },
    });
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response(); }) as unknown as typeof fetch;
    const project = await loadPrivateProject({ allowedLogins: ["alex"], credentialResolver: resolver, owner: "org", ownerRef: "user-1", repo: "secret", sort: "xp" });
    expect(project).toBeNull();
    expect(calls).toBe(0);
  });

  test("rechecks exact private-repository access live and returns no persisted rows", async () => {
    const resolver = await resolverWithGrant();
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/repos/org/secret")) return new Response(JSON.stringify({ full_name: "org/secret", name: "secret", private: true, stargazers_count: 4 }), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;
    const project = await loadPrivateProject({ allowedLogins: ["alex"], credentialResolver: resolver, owner: "org", ownerRef: "user-1", repo: "secret", sort: "commits" });
    expect(project).toEqual(expect.objectContaining({ key: "org/secret", private: true, ephemeral: true, sort: "commits" }));
    expect(calls).toEqual([
      "https://api.github.com/repos/org/secret",
      "https://api.github.com/repos/org/secret/stats/contributors",
      "https://api.github.com/repos/org/secret/contributors?anon=0&per_page=100",
    ]);
  });

  test("rejects public or mismatched repository metadata even with a valid token", async () => {
    for (const metadata of [
      { full_name: "org/public", name: "public", private: false },
      { full_name: "other/secret", name: "secret", private: true },
    ]) {
      const resolver = await resolverWithGrant();
      globalThis.fetch = (async () => new Response(JSON.stringify(metadata), { status: 200 })) as unknown as typeof fetch;
      const project = await loadPrivateProject({ allowedLogins: ["alex"], credentialResolver: resolver, owner: "org", ownerRef: "user-1", repo: "secret", sort: "xp" });
      expect(project).toBeNull();
    }
  });
});
