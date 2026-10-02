import { afterEach, expect, test } from "bun:test";
import { isGithubFailure, verifyGithubResult } from "../web/src/backend/verify.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const respondWith = (response: () => Response) => {
  globalThis.fetch = (async () => response()) as unknown as typeof fetch;
};

test("an exhausted GitHub budget is reported as a rate limit with its reset time", async () => {
  respondWith(() => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790922344" } }));
  const result = await verifyGithubResult("octocat");
  expect(isGithubFailure(result)).toBe(true);
  expect(result).toEqual({ reason: "rate_limited", retryAt: 1790922344 * 1000 });
});

test("a missing account is reported as not found", async () => {
  respondWith(() => new Response("{}", { status: 404 }));
  expect(await verifyGithubResult("octocat")).toEqual({ reason: "not_found", retryAt: null });
});

test("a network failure is reported as unavailable", async () => {
  globalThis.fetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  expect(await verifyGithubResult("octocat")).toEqual({ reason: "unavailable", retryAt: null });
});

test("a failure after the user lookup still aborts instead of scoring partial data", async () => {
  let call = 0;
  globalThis.fetch = (async () => {
    call++;
    return call === 1
      ? new Response(JSON.stringify({ created_at: "2015-01-01T00:00:00Z" }), { status: 200 })
      : new Response("{}", { status: 429, headers: { "retry-after": "60" } });
  }) as unknown as typeof fetch;
  const result = await verifyGithubResult("octocat");
  expect(isGithubFailure(result) && result.reason).toBe("rate_limited");
});
