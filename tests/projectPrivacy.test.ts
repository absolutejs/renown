import { describe, expect, test } from "bun:test";
import { fetchProjectBoard, selfEntry } from "../core/leaderboard.ts";
import type { State } from "../core/state.ts";
import type { Config } from "../core/runtime.ts";

const project = (visibility: "public" | "private" | "unknown", oss = false) => ({
  name: "repo", commits: 2, lines: 20, xp: 50, first: 1, last: 2,
  stars: 0, oss, ext: false, visibility, activeSec: 0, langs: {},
});
const state = {
  name: "alice", playerId: "alice", xp: 0, lifetimeXp: 100, streak: 1,
  best: { xpInDay: 0, level: 1, streak: 1 }, ossCommits: 0, achievements: {},
  stats: { activeSec: 0 }, skillXp: {},
  projects: {
    "org/public": project("public"),
    "org/private-secret": project("private"),
    "org/unverified-secret": project("unknown"),
  },
} as unknown as State;

describe("repository privacy boundary", () => {
  test("cloud snapshots include only confirmed-public repository identities", () => {
    const snapshot = selfEntry(state);
    expect(snapshot.projects?.map((p) => p.key)).toEqual(["org/public"]);
    expect(JSON.stringify(snapshot)).not.toContain("private-secret");
    expect(JSON.stringify(snapshot)).not.toContain("unverified-secret");
  });

  test("cloud snapshots include every confirmed-public repository, not only the top five", () => {
    const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`org/public-${i}`, project("public")])) as State["projects"];
    const snapshot = selfEntry({ ...state, projects: many } as unknown as State);
    expect(snapshot.projects).toHaveLength(8);
    expect(snapshot.projects?.map((p) => p.key)).toContain("org/public-7");
  });

  test("private boards remain local and never call the configured endpoint", async () => {
    const cfg = { leaderboardEndpoint: "https://should-not-be-contacted.invalid/api" } as Config;
    const board = await fetchProjectBoard(state, cfg, "org/private-secret");
    expect(board.live).toBe(false);
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]?.you).toBe(true);
  });
});
