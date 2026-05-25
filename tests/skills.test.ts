import { describe, expect, test } from "bun:test";
import type { CraftResult } from "../core/craft.ts";
import {
  applyGains,
  awardCraft,
  fmtBig,
  levelForXp,
  MAX_LEVEL,
  SKILLS,
  skillProgress,
  totalLevel,
  virtualLevelForXp,
  xpForLevel
} from "../core/skills.ts";

const craft = (over: Partial<CraftResult>): CraftResult => ({
  xp: 100, lines: 10, oss: false, ext: false, stars: 0,
  langs: ["TypeScript"], hasTests: false, subject: "add feature",
  committedAt: 0, breakdown: [], ...over
});

describe("skills xp curve (OSRS-style)", () => {
  test("is strictly increasing and exponential toward the cap", () => {
    for (let lvl = 2; lvl <= MAX_LEVEL; lvl++) {
      expect(xpForLevel(lvl)).toBeGreaterThan(xpForLevel(lvl - 1));
    }
    // late levels cost far more than early ones (the grind)
    const earlyStep = xpForLevel(11) - xpForLevel(10);
    const lateStep = xpForLevel(99) - xpForLevel(98);
    expect(lateStep).toBeGreaterThan(earlyStep * 50);
  });

  test("level lookups respect boundaries and cap at 99", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(xpForLevel(2))).toBe(2);
    expect(levelForXp(xpForLevel(2) - 1)).toBe(1);
    expect(levelForXp(xpForLevel(50))).toBe(50);
    expect(levelForXp(1e12)).toBe(MAX_LEVEL);
  });

  test("progress is 0% at a fresh level and 100% at the cap", () => {
    const fresh = skillProgress(0);
    expect(fresh.level).toBe(1);
    expect(fresh.pct).toBe(0);
    expect(skillProgress(1e12)).toEqual({ level: MAX_LEVEL, into: 0, need: 0, pct: 100 });
  });
});

describe("craft routing", () => {
  test("a plain single-language commit trains only Shipping", () => {
    expect(awardCraft(craft({ xp: 40 }))).toEqual({ shipping: 40 });
  });

  test("an open-source, tested, multi-language fix trains many skills at once", () => {
    const gains = awardCraft(
      craft({ xp: 100, lines: 250, oss: true, ext: true, stars: 1200, langs: ["TypeScript", "CSS"], hasTests: true, subject: "fix: handle null id" })
    );
    expect(gains.shipping).toBe(100);
    expect(gains.testing).toBe(100);
    expect(gains.opensource).toBe(100);
    expect(gains.foreign).toBe(100);
    expect(gains.debugging).toBe(100);
    expect(gains.architecture).toBe(100);
    expect(gains.polyglot).toBe(50);
    expect(gains.stargazing).toBeGreaterThan(0);
    expect(gains.refactoring ?? 0).toBe(0);
  });
});

describe("ledger + totals", () => {
  test("applyGains records level-ups", () => {
    const ledger: Record<string, number> = {};
    const ups = applyGains(ledger, { shipping: xpForLevel(2) + 1 });
    expect(ups).toHaveLength(1);
    expect(ups[0]).toMatchObject({ id: "shipping", from: 1, to: 2 });
  });

  test("a fresh account sits at total level = number of skills", () => {
    expect(totalLevel({})).toBe(SKILLS.length);
  });
});

describe("authentic OSRS curve + virtual levels", () => {
  test("level 99 costs the real OSRS 13,034,431 xp", () => {
    expect(xpForLevel(99)).toBe(13034431);
  });

  test("virtual levels extend past 99 and stay BigInt-safe at absurd xp", () => {
    expect(virtualLevelForXp(0)).toBe(1);
    expect(virtualLevelForXp(xpForLevel(99))).toBe(99);
    expect(virtualLevelForXp(50_000_000)).toBeGreaterThan(99);
    // does not throw or saturate at the edge of safe integers, and stays monotonic
    const huge = virtualLevelForXp(Number.MAX_SAFE_INTEGER);
    expect(huge).toBeGreaterThan(virtualLevelForXp(1e12));
  });
});

describe("absurd-number formatting", () => {
  test("names magnitudes, then falls back to scientific", () => {
    expect(fmtBig(999)).toBe("999");
    expect(fmtBig(1234)).toBe("1.23K");
    expect(fmtBig(1_500_000)).toBe("1.50M");
    expect(fmtBig(1.234e9)).toBe("1.23B");
    expect(fmtBig(1e30)).toBe("1.00No");
    expect(fmtBig(1e70)).toMatch(/e70$/);
  });
});
