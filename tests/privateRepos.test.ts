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

  test("fetches only the requested GitHub page", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/user")) return new Response(JSON.stringify({ login: "alex" }), { status: 200, headers: { "x-oauth-scopes": "repo" } });
      return new Response(JSON.stringify([
        { full_name: "org/third", name: "third", private: true },
        { full_name: "org/fourth", name: "fourth", private: true },
      ]), { status: 200 });
    }) as typeof fetch;
    const result = await loadAccessiblePrivateRepos("token", ["alex"], { page: 2, perPage: 2 });
    expect(result).toEqual(expect.objectContaining({ page: 2, hasMore: true }));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("per_page=2&page=2");
  });

  test("uses GitHub's server search without putting the term in a public page request", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/user")) return new Response(JSON.stringify({ login: "alex" }), { status: 200, headers: { "x-oauth-scopes": "repo" } });
      return new Response(JSON.stringify({ total_count: 5, items: [{ full_name: "org/secret", name: "secret", private: true }] }), { status: 200 });
    }) as typeof fetch;
    const result = await loadAccessiblePrivateRepos("token", ["alex"], { page: 2, perPage: 2, query: "secret" });
    expect(result).toEqual(expect.objectContaining({ page: 2, hasMore: true, query: "secret" }));
    expect(calls[1]).toContain("/search/repositories?");
    expect(decodeURIComponent(calls[1]!)).toContain("secret in:name is:private");
  });
});
