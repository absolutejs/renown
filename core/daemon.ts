// Renown daemon — `renown watch`. Editor-agnostic activity tracking: a filesystem
// watcher over your git repos' source dirs (NOT node_modules) detects edits from ANY
// editor, and a periodic engine tick scores new commits, samples memory bosses, evals
// achievements, and submits. No editor plugin required.
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, watch } from "node:fs";
import { join } from "node:path";
import { C, WATCHED, loadConfig } from "./runtime.ts";
import { runEvent } from "./event.ts";

const SKIP = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", "vendor", ".svelte-kit", "out", ".cache", "target"]);
const TICK_MS = 30_000;
const ACTIVE_WINDOW = 5 * 60_000;     // only accrue active time while you're actually editing
let lastActivity = 0;

function discoverRepos(roots: string[]): string[] {
  const repos = new Set<string>();
  try { if (existsSync(WATCHED)) for (const l of readFileSync(WATCHED, "utf8").split("\n")) if (l.trim()) repos.add(l.trim()); } catch {}
  for (const root of roots) {
    try {
      const out = Bun.spawnSync(["find", root, "-maxdepth", "4", "-type", "d", "-name", "node_modules", "-prune", "-o", "-type", "d", "-name", ".git", "-print"], { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "";
      for (const g of out.split("\n")) if (g.trim()) repos.add(g.trim().replace(/\/\.git$/, ""));
    } catch {}
  }
  return [...repos].slice(0, 60);
}
function watchRepo(repo: string, onEdit: () => void) {
  try {
    for (const e of readdirSync(repo, { withFileTypes: true })) {
      if (e.isDirectory() && !SKIP.has(e.name)) { try { watch(join(repo, e.name), { recursive: true }, onEdit); } catch {} }
    }
    try { watch(repo, { recursive: false }, onEdit); } catch {}   // top-level files (commits touch .git, ignored)
  } catch {}
}

export async function runDaemon() {
  const cfg = loadConfig();
  const repos = discoverRepos(cfg.codeRoots ?? [process.env.HOME ?? ""]);
  // focus on the most-recently-active repos (by .git/HEAD mtime) — bounds both inotify
  // usage and per-tick git/gh work on machines with many repos.
  const recency = (r: string) => { try { return statSync(join(r, ".git", "HEAD")).mtimeMs; } catch { return 0; } };
  const watched = [...repos].sort((a, b) => recency(b) - recency(a)).slice(0, 12);
  try { const have = new Set(existsSync(WATCHED) ? readFileSync(WATCHED, "utf8").split("\n") : []); const add = watched.filter(r => !have.has(r)); if (add.length) appendFileSync(WATCHED, add.map(r => r + "\n").join("")); } catch {}
  const onEdit = () => { lastActivity = Date.now(); };
  for (const r of watched) watchRepo(r, onEdit);
  lastActivity = Date.now();
  console.error(`${C.b}${C.cyn}⚔ renown watch${C.r} — watching the ${C.b}${watched.length}${C.r} most active of ${C.b}${repos.length}${C.r} repos found (editor-agnostic). Ctrl-C to stop.`);
  const loop = async () => { if (Date.now() - lastActivity < ACTIVE_WINDOW) { try { await runEvent("tick"); } catch {} } };
  await loop();
  setInterval(loop, TICK_MS);
}
