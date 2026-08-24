import { describe, expect, test } from "bun:test";
import { hydrateState } from "../core/runtime.ts";

describe("shared local state hydration", () => {
  test("expands the sparse v3 state written by the runtime-agnostic CLI", () => {
    const state = hydrateState({
      v: 3,
      name: "player",
      playerId: "local",
      createdAt: 1,
      xp: 0,
      lifetimeXp: 0,
      streak: 7,
      ossCommits: 0,
      achievements: {},
      skillXp: {},
      agentUses: { claude: 2 },
      agentLastUsedAt: { claude: 1 },
      stats: { activeSec: 10 },
    });

    expect(state.best).toEqual({ xpInDay: 0, level: 1, streak: 7 });
    expect(state.lastActiveDay).toBeString();
    expect(state.quests).toHaveLength(3);
    expect(state.repoHeads).toEqual({});
    expect(state.langs).toEqual({});
    expect(state.maxMem).toBe(0);
    expect(state.stats.activeSec).toBe(10);
    expect(state.stats.hourActive).toHaveLength(24);
    expect(state.agentUses?.claude).toBe(2);
  });

  test("preserves full-engine values and fills partial nested records", () => {
    const state = hydrateState({
      v: 3,
      name: "alex",
      playerId: "real-id",
      createdAt: 1,
      streak: 4,
      best: { xpInDay: 900 },
      stats: { activeSec: 42 },
      projects: { repo: { name: "repo", commits: 1, lines: 2, xp: 3, first: 1, last: 2, stars: 0, oss: false, ext: false, activeSec: 0, langs: {} } },
    });

    expect(state.best).toEqual({ xpInDay: 900, level: 1, streak: 4 });
    expect(state.stats.activeSec).toBe(42);
    expect(state.projects.repo?.xp).toBe(3);
  });
});
