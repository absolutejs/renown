import { describe, expect, test } from "bun:test";
import { CATALOG, addCollectible, byId, rollDrop, renderCollection, type Owned } from "../core/collectibles.ts";

const seq = (...vals: number[]) => { let i = 0; return () => vals[i++] ?? 0; };
const WEDNESDAY_JUNE = new Date(2026, 5, 10);   // no calendar events
const OCT = new Date(2026, 9, 15);              // Hacktoberfest active

describe("collectibles catalog", () => {
  test("every id is unique", () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
  });
  test("has a healthy spread of rarities", () => {
    for (const r of ["common", "uncommon", "rare", "epic", "legendary", "event"]) {
      expect(CATALOG.filter((c) => c.rarity === r).length).toBeGreaterThan(0);
    }
  });
});

describe("drop rolls", () => {
  test("no drop when the chance roll misses", () => {
    expect(rollDrop(1000, true, {}, WEDNESDAY_JUNE, seq(0.99))).toBeNull();
  });
  test("a common drop on a hit", () => {
    const drop = rollDrop(1000, true, {}, WEDNESDAY_JUNE, seq(0.1, 0.0, 0.0));
    expect(drop?.rarity).toBe("common");
  });
  test("high roll lands a legendary", () => {
    const drop = rollDrop(1000, true, {}, WEDNESDAY_JUNE, seq(0.1, 0.999999, 0.0));
    expect(drop?.rarity).toBe("legendary");
  });
  test("event-exclusive loot only drops during its event", () => {
    const drop = rollDrop(1000, true, {}, OCT, seq(0.1, 0.1, 0.0));
    expect(drop?.rarity).toBe("event");
    expect(drop?.event).toBe("hacktoberfest");
    // off-season: the same rolls never yield an event item
    const off = rollDrop(1000, true, {}, WEDNESDAY_JUNE, seq(0.1, 0.1, 0.0));
    expect(off?.rarity).not.toBe("event");
  });
});

describe("inventory", () => {
  test("addCollectible flags first acquisition, then counts dupes", () => {
    const owned: Owned = {};
    const duck = byId("ducky")!;
    expect(addCollectible(owned, duck)).toBe(true);
    expect(addCollectible(owned, duck)).toBe(false);
    expect(owned.ducky.count).toBe(2);
  });
  test("renderCollection shows progress and owned items", () => {
    const sheet = renderCollection({ ducky: { at: 0, count: 3 } }).replace(/\x1b\[[0-9;]*m/g, "");
    expect(sheet).toContain("Collection");
    expect(sheet).toContain("Rubber Duck");
    expect(sheet).toContain("×3");
  });
});
