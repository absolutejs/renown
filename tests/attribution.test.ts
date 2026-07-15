import { afterEach, describe, expect, test } from "bun:test";
import { fetchAttributedRepositories, fetchAttributionShas } from "../web/src/backend/attribution.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("attribution sync windows", () => {
  test("uses the fixed day lower bound supplied by the SHA ledger", async () => {
    let requested = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    await fetchAttributionShas("co-authored-by:bot@example.com", "2026-07-16", 100, "token");
    const query = new URL(requested).searchParams.get("q");
    expect(query).toBe("co-authored-by:bot@example.com committer-date:>=2026-07-16");
  });

  test("repository discovery can use the same incremental cursor", async () => {
    let requested = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    await fetchAttributedRepositories("co-authored-by:bot@example.com", 100, "token", new Date("2026-07-15T01:02:03.000Z"));
    const query = new URL(requested).searchParams.get("q");
    expect(query).toBe("co-authored-by:bot@example.com committer-date:>=2026-07-15");
  });
});
