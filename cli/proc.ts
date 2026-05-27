// Tiny spawn shim — exports a sync `runSync` and an async `run` that work identically
// under Bun, Node, Deno, or any runtime that implements node:child_process. The CLI
// uses these instead of Bun.spawn/Bun.spawnSync so the bundled-for-Node distribution
// (dist/cli.mjs) runs without Bun installed.
//
// Returns parsed stdout/stderr strings + exit code. stdio defaults to capturing both
// streams; pass { inheritStderr: true } to let the child write to the terminal
// directly (used by tool-wrap mode so the tool's output streams through live).

import { spawn, spawnSync } from "node:child_process";

export type RunResult = { stdout: string; stderr: string; exitCode: number };

export const runSync = (argv: string[]): RunResult => {
  const r = spawnSync(argv[0]!, argv.slice(1), { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 0 };
};

export const run = (argv: string[], opts: { inheritStdout?: boolean; inheritStderr?: boolean } = {}): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: ["ignore", opts.inheritStdout ? "inherit" : "pipe", opts.inheritStderr ? "inherit" : "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (!opts.inheritStdout) child.stdout?.on("data", (b: Buffer) => { stdout += b.toString(); });
    if (!opts.inheritStderr) child.stderr?.on("data", (b: Buffer) => { stderr += b.toString(); });
    child.on("error", (err) => resolve({ stdout, stderr: stderr + String(err), exitCode: 1 }));
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
  });
