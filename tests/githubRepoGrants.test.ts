import { afterEach, describe, expect, test } from "bun:test";
import { createInMemoryLinkedProviderStores, createOAuthLinkedProviderCredentialResolver } from "../web/node_modules/@absolutejs/auth/dist/index.js";
import { bootstrapGithubRepoGrantFromSession, loadPrivateReposFromGithubGrants, parseGrantedScopes, persistGithubRepoGrant } from "../web/src/backend/auth/githubRepoGrants.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("GitHub repository grants", () => {
  test("parses GitHub's comma-delimited granted scopes", () => {
    expect(parseGrantedScopes("repo, user:email read:user")).toEqual(["repo", "user:email", "read:user"]);
  });

  test("persists and resolves one private-repository grant per GitHub subject", async () => {
    const stores = createInMemoryLinkedProviderStores();
    await persistGithubRepoGrant({
      ...stores,
      authorization: { accessToken: "github-token", userIdentity: { id: 42, login: "alex" } },
      configuredScopes: ["read:user", "repo"],
      ownerRef: "user-1",
      tokenResponse: { scope: "repo, user:email" },
    });
    const grants = await stores.grantStore.listGrantsByOwner("user-1");
    const bindings = await stores.bindingStore.listBindingsByOwner("user-1");
    expect(grants).toEqual([expect.objectContaining({ providerSubject: "42", grantedScopes: ["repo", "user:email"] })]);
    expect(bindings).toEqual([expect.objectContaining({ username: "alex", connectorProvider: "github_repos" })]);

    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).endsWith("/user")) return new Response(JSON.stringify({ login: "alex" }), { status: 200, headers: { "x-oauth-scopes": "repo" } });
      return new Response(JSON.stringify([{ full_name: "org/secret", name: "secret", private: true }]), { status: 200 });
    }) as typeof fetch;
    const resolver = await createOAuthLinkedProviderCredentialResolver({
      ...stores,
      providersConfiguration: { github: { credentials: { clientId: "client", clientSecret: "secret", redirectUri: "https://example.test/callback" }, scope: ["repo"] } },
    });
    const result = await loadPrivateReposFromGithubGrants({ allowedLogins: ["alex"], credentialResolver: resolver, ownerRef: "user-1" });
    expect(result.needsGithubAuth).toBe(false);
    expect(result).toEqual(expect.objectContaining({ total: 1, totalPages: 1, page: 1 }));
    expect(result.repos).toEqual([expect.objectContaining({ key: "org/secret" })]);
  });

  test("imports a verified legacy GitHub session token exactly into grant storage", async () => {
    const stores = createInMemoryLinkedProviderStores();
    globalThis.fetch = (async () => new Response(JSON.stringify({ id: 42, login: "alex" }), { status: 200, headers: { "x-oauth-scopes": "repo, user:email" } })) as unknown as typeof fetch;
    const imported = await bootstrapGithubRepoGrantFromSession({ accessToken: "legacy-token", allowedLogins: ["alex"], ...stores, ownerRef: "user-1" });
    expect(imported).toBe(true);
    expect(await stores.grantStore.listGrantsByOwner("user-1")).toEqual([
      expect.objectContaining({ accessTokenCiphertext: "legacy-token", providerSubject: "42", grantedScopes: ["repo", "user:email"] }),
    ]);
  });
});
