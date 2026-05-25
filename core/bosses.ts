// Universal memory bosses — NOT tied to any one person's setup. Samples live system
// memory + the biggest process; when memory is under real pressure and a process is
// hogging RAM (tsc, webpack, chrome, a leaky node…), it becomes a boss for whoever is
// running `renown watch`. Throttled so one spike = one boss. Linux (/proc) now; other
// OSes degrade gracefully (no bosses rather than wrong data).
import { readFileSync } from "node:fs";
import type { State } from "./state.ts";
import { bossFor } from "./runtime.ts";

const USED_PCT = 85;       // memory pressure threshold
const MIN_GB = 1;          // a boss must be hogging ≥1GB
const COOLDOWN = 180_000;  // ≤ one boss per 3 min

function usedPct(): number | null {
  try {
    const t = readFileSync("/proc/meminfo", "utf8");
    const kB = (k: string) => Number(t.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? 0);
    const tot = kB("MemTotal"); return tot ? Math.round((1 - kB("MemAvailable") / tot) * 100) : null;
  } catch { return null; }
}
function topProcess(): { rssMB: number; comm: string } | null {
  try {
    const out = Bun.spawnSync(["ps", "-eo", "rss=,comm=", "--sort=-rss"], { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "";
    const m = out.split("\n")[0]?.trim().match(/^(\d+)\s+(.+)$/);
    return m ? { rssMB: Number(m[1]) / 1024, comm: m[2] } : null;
  } catch { return null; }
}

// records at most one boss per call; returns event strings. mutates state.
export function sampleBosses(s: State): string[] {
  const up = usedPct();
  if (up == null || up < USED_PCT) return [];
  if (s.lastBossTs && Date.now() - s.lastBossTs < COOLDOWN) return [];
  const p = topProcess();
  if (!p || p.rssMB < MIN_GB * 1024) return [];
  const i = bossFor(p.comm);
  const e = (s.bestiary[i.key] ??= { name: i.name, emoji: i.emoji, gb: 0, count: 0 });
  const gb = p.rssMB / 1024;
  e.count++; e.gb = Math.max(e.gb, gb); e.lastSeen = Date.now();
  s.bossesSurvived++; s.lastBossTs = Date.now();
  return [`${i.emoji} Survived a ${i.name} (${gb.toFixed(1)}GB at ${up}% memory)`];
}
