import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, writeJson } from "../core/localStore.ts";
import { mergeProgress, type ProgressSnapshot } from "../core/progress.ts";
import { hydrateState } from "../core/runtime.ts";

const homes: string[] = [];
const home = () => { const h = mkdtempSync(join(tmpdir(), "renown-recovery-")); homes.push(h); mkdirSync(join(h, ".renown")); return h; };
afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }); });
const cli = async (h: string, ...args: string[]) => {
  const p = Bun.spawn([process.execPath, "run", "cli/api.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, HOME: h, XDG_CONFIG_HOME: join(h, ".config"), RENOWN_NO_SELF_UPDATE: "1", RENOWN_ENDPOINT: "http://127.0.0.1:1/api" },
    stdout: "pipe", stderr: "pipe",
  });
  return { code: await p.exited, stderr: await new Response(p.stderr).text() };
};

describe("progress loss regressions", () => {
  test("invalid saves are preserved byte for byte; even statusline refuses a reset", async () => {
    const h = home(), path = join(h, ".renown/state.json");
    const broken = '{"v":3,"skillXp":';
    writeFileSync(path, broken);
    const result = await cli(h, "statusline");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("left untouched");
    expect(readFileSync(path, "utf8")).toBe(broken);
  });

  test("simultaneous agent starts preserve every increment and read-only HUD calls do not overwrite them", async () => {
    const h = home();
    expect((await cli(h, "statusline")).code).toBe(0);
    const operations = Array.from({ length: 20 }, (_, i) => cli(h, ...(i % 2 ? ["agent", "codex", "--quiet"] : ["statusline"])));
    const results = await Promise.all(operations);
    expect(results.filter(r => r.code !== 0)).toEqual([]);
    const path = join(h, ".renown/state.json");
    const s = readJson<{ skillXp: Record<string, number>; agentUses: Record<string, number> }>(path)!;
    expect(s.agentUses.codex).toBe(10);
    expect(s.skillXp["agent-codex"]).toBe(2500);
    const before = statSync(path).mtimeMs;
    expect((await cli(h, "hud")).code).toBe(0);
    expect(statSync(path).mtimeMs).toBe(before);
  }, 20000);

  test("mismatched config/save identities fail without reassigning progress", async () => {
    const h = home();
    writeFileSync(join(h, ".renown/config.json"), JSON.stringify({ playerId: "a" }));
    const path = join(h, ".renown/state.json");
    writeFileSync(path, JSON.stringify({ v: 3, playerId: "b", skillXp: { shipping: 10000 } }));
    expect((await cli(h, "agent", "codex", "--quiet")).code).not.toBe(0);
    expect(readJson<{ playerId: string }>(path)?.playerId).toBe("b");
  });

  test("commit backlogs resume past fifty and already-recovered commits are not awarded again", async () => {
    const h = home(), repo = join(h, "repo"); mkdirSync(repo);
    const env = { ...process.env, HOME: h, GIT_CONFIG_GLOBAL: "/dev/null", RENOWN_ENDPOINT: "http://127.0.0.1:1/api" };
    const git = (...args: string[]) => {
      const p = Bun.spawnSync(["git", "-c", "user.name=Recovery test", "-c", "user.email=recovery@example.test", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-C", repo, ...args], { env, stdout: "pipe", stderr: "pipe" });
      if (p.exitCode !== 0) throw new Error(p.stderr.toString());
      return p.stdout.toString().trim();
    };
    git("init", "-q");
    writeFileSync(join(repo, "example.ts"), "export const value = 0;\n"); git("add", "."); git("commit", "-qm", "initial");
    const base = git("rev-parse", "HEAD");
    for (let i = 1; i <= 55; i++) {
      writeFileSync(join(repo, "example.ts"), `export const value = ${i};\n`);
      git("add", "."); git("commit", "-qm", `feat: update example ${i}`);
    }
    const statePath = join(h, ".renown/state.json");
    writeFileSync(join(h, ".renown/config.json"), JSON.stringify({ playerId: "test", playerName: "test", myEmails: ["recovery@example.test"], myOwners: [] }));
    writeFileSync(statePath, JSON.stringify(hydrateState({ v: 3, playerId: "test", repoHeads: { [repo]: base } })));
    const reconcile = async () => {
      const p = Bun.spawn([process.execPath, "run", "cli/index.ts", "commit", repo], { cwd: join(import.meta.dir, ".."), env, stdout: "ignore", stderr: "pipe" });
      expect(await p.exited).toBe(0);
      return JSON.parse(readFileSync(statePath, "utf8"));
    };
    const first = await reconcile(); expect(first.commits).toBe(50); expect(first.repoHeads[repo]).not.toBe(git("rev-parse", "HEAD"));
    const second = await reconcile(); expect(second.commits).toBe(55); expect(second.repoHeads[repo]).toBe(git("rev-parse", "HEAD"));
    // Simulate restoring an earlier checkpoint while keeping the recovered commit ledger.
    second.repoHeads[repo] = base; writeFileSync(statePath, JSON.stringify(second));
    expect((await reconcile()).commits).toBe(55);
    expect((await reconcile()).commits).toBe(55);
  }, 20000);

  test("saves keep a previous-write and daily backup, and refuse to discard a missing save's backup", () => {
    const h = home(), path = join(h, ".renown/state.json");
    writeJson(path, { xp: 100 }); writeJson(path, { xp: 120 }); writeJson(path, { xp: 140 });
    expect(readJson(`${path}.bak`)).toEqual({ xp: 120 });
    expect(readJson(join(h, ".renown/save-history", `state.json.${new Date().toISOString().slice(0, 10)}.json`))).toEqual({ xp: 100 });
    rmSync(path);
    expect(() => readJson(path)).toThrow("refusing to reset");
  });

  test("sparse and reordered cloud submissions union skills, unlocks and projects without doubling XP", () => {
    const rich: ProgressSnapshot = { id: "a", name: "alex", xp: 247471, skillXp: { shipping: 90000 }, unlocked: ["a"], projects: [{ key: "owner/repo", xp: 500, commits: 3 }] };
    const sparse: ProgressSnapshot = { id: "a", name: "player", xp: 0, skillXp: { "agent-codex": 250 }, unlocked: ["b"], projects: [] };
    const result = mergeProgress(rich, sparse);
    expect(result.name).toBe("alex");
    expect(result.xp).toBe(247471);
    expect(result.skillXp).toEqual({ shipping: 90000, "agent-codex": 250 });
    expect(result.unlocked).toEqual(["a", "b"]);
    expect(result.projects).toHaveLength(1);
    expect(mergeProgress(result, sparse)).toEqual(result);
    expect(() => mergeProgress(rich, { ...sparse, id: "b" })).toThrow();
  });
});
