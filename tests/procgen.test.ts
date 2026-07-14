import { describe, expect, test } from "bun:test";
import { CARD_SET, CARD_VARIANTS, builtInCardSubjectSeed, cardCopyToken, generate, makeRng, parseCardSeed, rollWild, serializedCardSeed, type Tier } from "../core/procgen.ts";

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

describe("serialized card printings", () => {
  const subjectSeed = builtInCardSubjectSeed(7);
  const copy = (serialNumber: number, owner: string) => serializedCardSeed({
    setId: CARD_SET, subjectSeed, variant: "legendary", serialNumber,
    printRun: CARD_VARIANTS.legendary.printRun, copyToken: cardCopyToken(owner, `sha-${serialNumber}`),
  });

  test("every copy carries an immutable serial and total supply", () => {
    const seed = copy(34, "alex");
    const identity = parseCardSeed(seed);
    expect(identity).not.toBeNull();
    expect(identity?.serialNumber).toBe(34);
    expect(identity?.printRun).toBe(500);
    expect(generate(seed).card).toEqual(identity!);
  });

  test("copies in one printing are recognizable siblings with bounded variation", () => {
    const first = generate(copy(1, "alex"));
    const later = generate(copy(34, "sam"));
    expect(first.name).toBe(later.name);
    expect(first.traits).toEqual(later.traits);
    expect(first.card?.printingId).toBe(later.card?.printingId);
    expect(Math.abs(first.sizeN - later.sizeN)).toBeLessThanOrEqual(12);
    expect(first.seed).not.toBe(later.seed);
  });

  test("one-of-one is supply, not a generic uniqueness claim", () => {
    const seed = serializedCardSeed({ setId: CARD_SET, subjectSeed, variant: "one-of-one", serialNumber: 1, printRun: 1, copyToken: "only" });
    const pet = generate(seed);
    expect(pet.oneOfOne).toBe(true);
    expect(pet.card?.serialNumber).toBe(1);
    expect(pet.card?.printRun).toBe(1);
  });

  test("a forged serial or total does not parse as a serialized card", () => {
    expect(parseCardSeed(`card:v1:${CARD_SET}:${encodeURIComponent(subjectSeed)}:legendary:501:500:nope`)).toBeNull();
    expect(parseCardSeed(`card:v1:${CARD_SET}:${encodeURIComponent(subjectSeed)}:legendary:1:999:nope`)).toBeNull();
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

describe("wild drops", () => {
  test("the roll is deterministic per commit (not gameable by re-ticking)", () => {
    const a = rollWild(5000, "owner/repo", "deadbeef");
    const b = rollWild(5000, "owner/repo", "deadbeef");
    expect(a?.seed ?? null).toBe(b?.seed ?? null);
  });
  test("finds are rare and seeded by the commit (provenance)", () => {
    let found = 0;
    for (let i = 0; i < 1000; i++) if (rollWild(100, "r", `sha${i}`)) found++;
    expect(found).toBeLessThan(150);                  // low-xp commits rarely drop
    const hit = rollWild(5000, "acme/app", "c0ffee");
    if (hit) expect(hit.seed).toBe("wild:acme/app:c0ffee");
  });
});
