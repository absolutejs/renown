// Leaderboard client — global + per-project. Carries per-project stats so the server
// ranks "best contributors to <repo>", not just global XP. Set config.leaderboardEndpoint
// to go live (POST /submit, GET /top, GET /top?project=owner/name); solo fallback else.
import type { State } from "./state.ts";
import { type Config, RDIR } from "./runtime.ts";
import { levelInfo } from "./state.ts";
import { topProjects } from "./stats.ts";
import { readFileSync, writeFileSync } from "node:fs";

const CACHE = `${RDIR}/leaderboard.json`;
export interface ProjEntry { key: string; name: string; xp: number; commits: number; lines: number; stars: number; oss: boolean; you?: boolean }
export interface Entry { id?: string; name: string; level: number; xp: number; streak: number; oss: number; ach: number; active?: number; projects?: ProjEntry[]; unlocked?: string[]; commits?: number; lines?: number; you?: boolean }
export const selfEntry = (s: State): Entry => ({
  id: s.playerId, name: s.name, level: levelInfo(s.xp).level, xp: s.lifetimeXp, streak: s.best.streak,
  oss: s.ossCommits, ach: Object.keys(s.achievements).length, active: s.stats.activeSec | 0,
  projects: topProjects(s, 5).map(p => ({ key: p.k, name: p.name, xp: p.xp, commits: p.commits, lines: p.lines, stars: p.stars, oss: p.oss })),
  unlocked: Object.keys(s.achievements),   // for global rarity % on the server
});
const base = (cfg: Config) => cfg.leaderboardEndpoint.replace(/\/$/, "");
export async function submit(s: State, cfg: Config) {
  if (!cfg.leaderboardEndpoint) return;
  try { await fetch(`${base(cfg)}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selfEntry(s)), signal: AbortSignal.timeout(4000) }); } catch {}
}
export async function fetchBoard(s: State, cfg: Config): Promise<{ entries: Entry[]; live: boolean }> {
  if (cfg.leaderboardEndpoint) {
    try { const r = await fetch(`${base(cfg)}/top?n=20`, { signal: AbortSignal.timeout(4000) }); const j = (await r.json()) as Entry[]; writeFileSync(CACHE, JSON.stringify(j)); return { entries: mark(j, s), live: true }; }
    catch { try { return { entries: mark(JSON.parse(readFileSync(CACHE, "utf8")), s), live: false }; } catch {} }
  }
  return { entries: [selfEntry(s)], live: false };
}
export async function fetchProjectBoard(s: State, cfg: Config, key: string): Promise<{ entries: ProjEntry[]; live: boolean }> {
  if (cfg.leaderboardEndpoint) {
    try { const r = await fetch(`${base(cfg)}/top?project=${encodeURIComponent(key)}&n=20`, { signal: AbortSignal.timeout(4000) }); const j = (await r.json()) as ProjEntry[]; return { entries: j.map(e => ({ ...e, you: e.name === s.name })).sort((a, b) => b.xp - a.xp), live: true }; } catch {}
  }
  const p = s.projects[key];
  return { entries: p ? [{ key, name: s.name, xp: p.xp, commits: p.commits, lines: p.lines, stars: p.stars, oss: p.oss, you: true }] : [], live: false };
}
const mark = (arr: Entry[], s: State) => arr.map(e => ({ ...e, you: e.id === s.playerId })).sort((a, b) => b.xp - a.xp);
