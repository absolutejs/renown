import { describe, expect, test } from "bun:test";
import { generate, makeRng, type Tier } from "../core/procgen.ts";

describe("procgen determinism (the seed is the asset)", () => {
  test("the same seed always reproduces the exact same creature", () => {
    const a = generate("renown:pet:alex"), b = generate("renown:pet:alex");
    expect(a.traits).toEqual(b.traits);
    expect(a.tier).toBe(b.tier);
    expect(a.name).toBe(b.name);
    expect(a.score).toBe(b.score);
    expect(a.sprite()).toBe(b.sprite());   // even the rendered ASCII is identical
  });
  test("different seeds give different creatures", () => {
    const names = new Set(Array.from({ length: 50 }, (_, i) => generate(`x${i}`).name));
    expect(names.size).toBeGreaterThan(40);
  });
  test("makeRng is a deterministic stream", () => {
    const r1 = makeRng("seed"), r2 = makeRng("seed");
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});

describe("procgen rarity", () => {
  test("tiers are distributed: Common dominant, Mythic genuinely rare", () => {
    const count: Record<string, number> = {};
    const N = 5000;
    for (let i = 0; i < N; i++) count[generate(`d${i}`).tier] = (count[generate(`d${i}`).tier] ?? 0) + 1;
    expect(count.Common).toBeGreaterThan(count.Mythic);
    expect((count.Mythic ?? 0) / N).toBeLessThan(0.05);
    for (const t of ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"] as Tier[]) expect(count[t] ?? 0).toBeGreaterThan(0);
  });
  test("a creature carries a positive rarity score, a rarest trait, and a multi-line sprite", () => {
    const c = generate("inspect-me");
    expect(c.score).toBeGreaterThan(0);
    expect(c.rarestTrait.length).toBeGreaterThan(0);
    expect(c.sprite().split("\n").length).toBeGreaterThan(2);
    expect(typeof c.oneOfOne).toBe("boolean");
  });
});
