import { expect, test } from "bun:test";
import { CURATED, curatedCount, evalAll, info, totalCount } from "../core/achievements/index.ts";
import { catalog } from "../core/achievements/generated.ts";
import type { State } from "../core/state.ts";

function fakeState(over: Partial<State> = {}): State {
  return {
    v: 2, name: "t", playerId: "t", createdAt: 0, xp: 60000, lifetimeXp: 60000, streak: 12, lastActiveDay: "",
    commits: 800, linesAdded: 45000, bossesSurvived: 14, secondsHealthy: 0, ossCommits: 30, extCommits: 12, starsTouched: 0, topStars: 1500,
    langs: { TypeScript: 600, CSS: 120, Rust: 40 }, hours: { 3: 5, 9: 50, 14: 80, 23: 20 }, days: { 0: 5, 1: 20, 2: 30, 3: 25, 4: 22, 5: 18, 6: 8 },
    achievements: {}, bestiary: { tsc: { name: "", emoji: "", gb: 12.5, count: 3 }, ugrep: { name: "", emoji: "", gb: 10.8, count: 1 } },
    questDay: "", quests: [], repoHeads: {}, recentFp: [], craftDay: "", craftXpToday: 0, maxMem: 96, lastTick: 0, lastLogScanTs: 0,
    best: { xpInDay: 800, level: 1, streak: 30 },
    stats: { firstSeen: 0, lastSeen: 0, lastActivity: 0, activeSec: 200000, sessionCount: 220, longestSec: 9000, curStart: 0, curSec: 0, anchorXp: 0, anchorCommits: 0, hourActive: Array(24).fill(0), dowActive: Array(7).fill(0), commitHour: Array(24).fill(0), commitDow: Array(7).fill(0), daily: Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["d" + i, { a: 1, xp: 1, c: 1, l: 1 }])), sessions: [] },
    projects: { "a/b": { name: "b", commits: 300, lines: 20000, xp: 8000, first: 0, last: 0, stars: 1500, oss: true, ext: false, activeSec: 0, langs: {} } },
    langsDeep: { TypeScript: { commits: 600, lines: 30000, xp: 40000 }, CSS: { commits: 120, lines: 8000, xp: 2000 }, Rust: { commits: 40, lines: 4000, xp: 5000 } },
    ...over,
  } as State;
}

test("at least 250 curated achievements", () => expect(curatedCount()).toBeGreaterThanOrEqual(250));
test("over 10,000 total achievements", () => expect(totalCount()).toBeGreaterThan(10000));
test("all achievement ids are unique", () => {
  const ids = [...CURATED.map(a => a.id), ...catalog().map(d => d.id)];
  expect(new Set(ids).size).toBe(ids.length);
});
test("evalAll unlocks, then is idempotent", () => {
  const s = fakeState(), have = new Set<string>();
  const first = evalAll(s, have);
  expect(first.length).toBeGreaterThan(0);
  for (const id of first) have.add(id);
  expect(evalAll(s, have).length).toBe(0);
});
test("evalAll stays fast at scale (<2ms each)", () => {
  const s = fakeState(), have = new Set(evalAll(s, new Set<string>()));
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) evalAll(s, have);
  expect((performance.now() - t0) / 200).toBeLessThan(2);
});
test("info() resolves curated + generated, undefined otherwise", () => {
  expect(info("first-blood")?.generated).toBe(false);
  expect(info("level:50")?.generated).toBe(true);
  expect(info("nope:nope")).toBeUndefined();
});
