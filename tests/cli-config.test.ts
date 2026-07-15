import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("published CLI identity initialization", () => {
  test("creates the same durable playerId in config and state", async () => {
    const home = mkdtempSync(join(tmpdir(), "renown-cli-"));
    homes.push(home);
    const proc = Bun.spawn([process.execPath, "run", "cli/api.ts", "statusline"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);

    const config = JSON.parse(readFileSync(join(home, ".renown", "config.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(home, ".renown", "state.json"), "utf8"));
    expect(config.playerId).toBeString();
    expect(config.playerId).not.toBe("local");
    expect(state.playerId).toBe(config.playerId);
  });
});
