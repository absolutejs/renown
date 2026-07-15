import { afterEach, describe, expect, test } from "bun:test";
import { loadAccessiblePrivateRepos } from "../web/src/backend/privateRepos.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("authenticated private repository discovery", () => {
  test("returns only private repositories for the GitHub identity owning the session token", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/user")) return new Response(JSON.stringify({ login: "alex" }), { status: 200, headers: { "x-oauth-scopes": "repo, user:email" } });
      return new Response(JSON.stringify([
        { full_name: "org/secret", name: "secret", private: true, stargazers_count: 2, pushed_at: "2026-07-15T00:00:00Z", permissions: { push: true }, owner: { login: "org" } },
        { full_name: "org/public", name: "public", private: false },
      ]), { status: 200 });
    }) as typeof fetch;

    const result = await loadAccessiblePrivateRepos("token", ["alex"]);
    expect(result.needsGithubAuth).toBe(false);
    expect(result.repos).toEqual([expect.objectContaining({ key: "org/secret", private: true, role: "write" })]);
    expect(calls).toHaveLength(2);
  });

  test("rejects a valid GitHub token belonging to an unlinked login", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ login: "mallory" }), { status: 200 })) as unknown as typeof fetch;
    const result = await loadAccessiblePrivateRepos("token", ["alex"]);
    expect(result.needsGithubAuth).toBe(true);
    expect(result.repos).toEqual([]);
  });
});
