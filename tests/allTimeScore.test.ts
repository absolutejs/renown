import { describe, expect, test } from "bun:test";
import { advanceAllTimeVerifiedScore } from "../web/src/backend/allTimeScore.ts";

describe("all-time verified score", () => {
  test("does not erase verified work when GitHub's rolling event window shrinks", () => {
    expect(advanceAllTimeVerifiedScore({
      currentVerifiedScore: 9_000,
      currentAttributionScore: 1_000,
      recomputedBaseScore: 6_500,
    })).toMatchObject({ allTimeBaseScore: 8_000, attributionScore: 1_000, verifiedScore: 9_000 });
  });

  test("adds new base highs and cumulative attribution", () => {
    expect(advanceAllTimeVerifiedScore({
      currentVerifiedScore: 9_000,
      currentAttributionScore: 1_000,
      recomputedBaseScore: 8_250,
      nextAttributionScore: 1_125,
    })).toMatchObject({ allTimeBaseScore: 8_250, attributionScore: 1_125, verifiedScore: 9_375 });
  });
});
