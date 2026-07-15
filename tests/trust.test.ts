import { describe, expect, test } from "bun:test";
import type { CraftResult } from "../core/craft.ts";
import { genuineness, isOwnable, rewardValue } from "../core/trust.ts";

const craft = (over: Partial<CraftResult>): CraftResult => ({
  xp: 100, lines: 10, oss: false, ext: false, stars: 0, langs: [], paths: [],
  hasTests: false, subject: "x", committedAt: 0, breakdown: [], repoVisibility: "unknown", ...over
});

describe("anti-gaming / genuineness", () => {
  test("private or local-only work confers no ownership (no matter the fake XP)", () => {
    expect(genuineness(craft({}))).toBe(0);
    expect(isOwnable(craft({}))).toBe(false);
    expect(rewardValue(craft({ xp: 9999 }))).toBe(0);
  });

  test("public original work is accountable enough to be ownable", () => {
    expect(isOwnable(craft({ repoPublic: true }))).toBe(true);
  });

  test("externally-validated work (OSS + others' repo + stars) scores highest", () => {
    const solo = genuineness(craft({ repoPublic: true }));
    const validated = genuineness(craft({ oss: true, ext: true, stars: 1200 }));
    expect(validated).toBeGreaterThan(solo);
    expect(validated).toBeCloseTo(1, 1);
  });

  test("reward value = effort × validation, never raw XP", () => {
    expect(rewardValue(craft({ xp: 100, oss: true }))).toBe(50);   // genuineness 0.5
    expect(rewardValue(craft({ xp: 100 }))).toBe(0);               // unvalidated → 0
  });
});
