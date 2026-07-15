import { afterEach, describe, expect, test } from "bun:test";
import { fetchAttributedRepositories, fetchAttributionShas } from "../web/src/backend/attribution.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("attribution discovery", () => {
  test("returns commit SHAs for the ledger to deduplicate", async () => {
    let requested = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(JSON.stringify({ items: [{ sha: "abc" }, { sha: "abc" }, { sha: "def" }] }), { status: 200 });
    }) as typeof fetch;

    const shas = await fetchAttributionShas("co-authored-by:bot@example.com", 100, "token");
    const query = new URL(requested).searchParams.get("q");
    expect(query).toBe("co-authored-by:bot@example.com");
    expect(shas).toEqual(["abc", "def"]);
  });

  test("repository discovery uses the same current attribution search", async () => {
    let requested = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    await fetchAttributedRepositories("co-authored-by:bot@example.com", 100, "token");
    const query = new URL(requested).searchParams.get("q");
    expect(query).toBe("co-authored-by:bot@example.com");
  });
});
