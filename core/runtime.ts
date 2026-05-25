// Renown runtime — local save/config + helpers. State lives in ~/.renown (editor-
// agnostic; not tied to Claude Code). XP is earned by the craft engine + quests;
// achievements are badges (the 10k catalog) recorded with their unlock date.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type Boss, type Quest, type State, type Stats, levelInfo } from "./state.ts";
import { MAX_TOTAL_LEVEL, SKILLS, fmtBig, maxedCount, skillProgress, topSkills, totalLevel } from "./skills.ts";

export const HOME = process.env.HOME ?? "/home/alexkahn";
export const RDIR = `${HOME}/.renown`;
export const STATE = `${RDIR}/state.json`;
export const CONFIG = `${RDIR}/config.json`;
export const HUD = `${RDIR}/hud.txt`;
export const WATCHED = `${RDIR}/watched.txt`;
export const STATE_V = 3;

export const C = {
  r: "\x1b[0m", b: "\x1b[1m", dim: "\x1b[2m", it: "\x1b[3m", inv: "\x1b[7m",
  red: "\x1b[91m", grn: "\x1b[92m", yel: "\x1b[93m", blu: "\x1b[94m",
  mag: "\x1b[95m", cyn: "\x1b[96m", gry: "\x1b[90m", wht: "\x1b[97m", orange: "\x1b[38;5;208m", gold: "\x1b[38;5;220m",
};
export const paint = (s: string, c: string) => `${c}${s}${C.r}`;
export const strip = (x: string) => x.replace(/\x1b\[[0-9;]*m/g, "");
export const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

export interface Config { playerName: string; playerId: string; myEmails: string[]; myOwners: string[]; leaderboardEndpoint: string; bossLogDir: string; codeRoots: string[] }
const uuid = () => "xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
const sh = (cmd: string[]) => { try { return (Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "").trim(); } catch { return ""; } };
export function loadConfig(): Config {
  try { return { bossLogDir: `${HOME}/.claude/mem-tools/logs`, leaderboardEndpoint: "", codeRoots: [HOME], ...JSON.parse(readFileSync(CONFIG, "utf8")) }; }
  catch {
    const login = sh(["gh", "api", "user", "-q", ".login"]) || sh(["git", "config", "--global", "user.name"]) || "player";
    const email = sh(["git", "config", "--global", "user.email"]);
    const orgs = sh(["gh", "api", "user/orgs", "-q", ".[].login"]).split("\n").filter(Boolean);
    const cfg: Config = { playerName: login, playerId: uuid(), myEmails: [email].filter(Boolean), myOwners: [login, ...orgs], leaderboardEndpoint: "", bossLogDir: `${HOME}/.claude/mem-tools/logs`, codeRoots: [HOME] };
    try { mkdirSync(RDIR, { recursive: true }); writeFileSync(CONFIG, JSON.stringify(cfg, null, 2)); } catch {}
    return cfg;
  }
}

export function bossFor(comm: string): { key: string; name: string; emoji: string } {
  const c = (comm || "").toLowerCase();
  if (c.includes("tsc")) return { key: "tsc", name: "Type Dragon", emoji: "🐉" };
  if (c.includes("ugrep") || c.includes("grep")) return { key: "ugrep", name: "Regex Hydra", emoji: "🐍" };
  if (c.includes("chrom") || c.includes("headless")) return { key: "chromium", name: "Browser Swarm", emoji: "🕷️" };
  if (c.includes("claude")) return { key: "claude", name: "Cloned Legion", emoji: "🤖" };
  if (c.includes("bun")) return { key: "bun", name: "Bun Bunny", emoji: "🐰" };
  if (c.includes("node")) return { key: "node", name: "Node Golem", emoji: "🗿" };
  if (c.includes("esbuild") || c.includes("vite") || c.includes("webpack")) return { key: "esbuild", name: "Build Wraith", emoji: "🔨" };
  return { key: "ram", name: "RAM Wraith", emoji: "👻" };
}

const QUEST_POOL: Omit<Quest, "prog" | "done">[] = [
  { id: "earn150", desc: "Earn 150 XP from real work", goal: 150, xp: 50 },
  { id: "oss1", desc: "Land an open-source contribution", goal: 1, xp: 80 },
  { id: "lines200", desc: "Ship 200 lines of real code", goal: 200, xp: 50 },
  { id: "tests", desc: "Commit alongside tests", goal: 1, xp: 45 },
  { id: "slayboss", desc: "Survive a memory boss", goal: 1, xp: 40 },
  { id: "earlybird", desc: "Be coding before noon", goal: 1, xp: 20 },
  { id: "marathon", desc: "Stay active 20 healthy minutes", goal: 1200, xp: 45 },
  { id: "polyglot", desc: "Touch 3 different languages", goal: 3, xp: 55 },
];
export function ensureDailyQuests(s: State) {
  const day = new Date().toISOString().slice(0, 10);
  if (s.questDay === day && s.quests?.length) return;
  const seed = hash(day + s.name);
  const idx = [...new Set([seed % QUEST_POOL.length, (seed >> 8) % QUEST_POOL.length, (seed >> 16) % QUEST_POOL.length])];
  while (idx.length < 3) idx.push((idx[idx.length - 1] + 1) % QUEST_POOL.length);
  s.questDay = day;
  s.quests = idx.slice(0, 3).map(i => ({ ...QUEST_POOL[i], prog: 0, done: false }));
}

export function emptyStats(): Stats {
  const now = Date.now();
  return { firstSeen: now, lastSeen: now, lastActivity: 0, activeSec: 0, sessionCount: 0, longestSec: 0, curStart: 0, curSec: 0, anchorXp: 0, anchorCommits: 0, hourActive: Array(24).fill(0), dowActive: Array(7).fill(0), commitHour: Array(24).fill(0), commitDow: Array(7).fill(0), daily: {}, sessions: [] };
}
export function ensureStats(s: State) {
  if (!s.stats) s.stats = emptyStats();
  for (const k of ["hourActive", "commitHour"] as const) if (!Array.isArray(s.stats[k]) || s.stats[k].length !== 24) s.stats[k] = Array(24).fill(0);
  for (const k of ["dowActive", "commitDow"] as const) if (!Array.isArray(s.stats[k]) || s.stats[k].length !== 7) s.stats[k] = Array(7).fill(0);
  s.stats.daily ??= {}; s.stats.sessions ??= []; s.projects ??= {}; s.langsDeep ??= {};
  s.lastBossTs ??= 0;
}

export function freshState(): State {
  const cfg = loadConfig(), now = Date.now();
  const s: State = {
    v: STATE_V, name: cfg.playerName, playerId: cfg.playerId, createdAt: now,
    xp: 0, lifetimeXp: 0, streak: 1, lastActiveDay: new Date().toISOString().slice(0, 10),
    commits: 0, linesAdded: 0, bossesSurvived: 0, secondsHealthy: 0, ossCommits: 0, extCommits: 0, starsTouched: 0, topStars: 0,
    langs: {}, hours: {}, days: {}, skillXp: {}, achievements: {}, bestiary: {},
    questDay: "", quests: [], repoHeads: {}, recentFp: [], craftDay: "", craftXpToday: 0, maxMem: 0,
    lastTick: 0, lastLogScanTs: 0, lastBossTs: 0, best: { xpInDay: 0, level: 1, streak: 1 },
    stats: emptyStats(), projects: {}, langsDeep: {},
  };
  ensureDailyQuests(s);
  return s;
}
// Skills migrate in without a version bump: existing saves keep their progress and the
// lifetime grind seeds the headline Shipping skill once, so nobody starts from scratch.
export function ensureSkills(s: State) {
  s.skillXp ??= {};
  if (s.skillXp.shipping === undefined && s.lifetimeXp > 0) s.skillXp.shipping = s.lifetimeXp;
}
export function loadState(): State {
  try { const s = JSON.parse(readFileSync(STATE, "utf8")) as State; if (s.v !== STATE_V) throw 0; ensureStats(s); ensureSkills(s); ensureDailyQuests(s); return s; }
  catch { mkdirSync(RDIR, { recursive: true }); const s = freshState(); saveState(s); return s; }
}
export function saveState(s: State) { try { mkdirSync(RDIR, { recursive: true }); const t = `${STATE}.tmp`; writeFileSync(t, JSON.stringify(s)); renameSync(t, STATE); } catch {} }

export function memPct(): number { try { const t = readFileSync("/proc/meminfo", "utf8"); const kB = (k: string) => Number(t.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? 0); const tot = kB("MemTotal"); return tot ? Math.round((1 - kB("MemAvailable") / tot) * 100) : 0; } catch { return 0; } }
export function availG(): number { try { const t = readFileSync("/proc/meminfo", "utf8"); return Number(t.match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? 0) / 1048576; } catch { return 0; } }
export function bar(pct: number, width = 16, col = C.grn) { const f = Math.max(0, Math.min(width, Math.round((pct / 100) * width))); return paint("▓".repeat(f), col) + paint("░".repeat(width - f), C.gry); }

// award updates the global renown total (s.xp/lifetimeXp = the absurd lifetime score);
// per-skill level-up celebrations are emitted where commits are routed (see event.ts).
export function award(s: State, xp: number, why: string): string[] {
  s.xp += xp; s.lifetimeXp += xp;
  const t = new Date().toISOString().slice(0, 10);
  if (s.craftDay !== t) { s.craftDay = t; s.craftXpToday = 0; }
  s.craftXpToday += xp; s.best.xpInDay = Math.max(s.best.xpInDay, s.craftXpToday);
  s.best.level = Math.max(s.best.level, levelInfo(s.xp).level);
  return [`${C.yel}⚡ +${xp} XP${C.r} ${C.dim}(${why})${C.r}`];
}
export function renderHud(s: State): string {
  const skx = s.skillXp ?? {};
  const total = totalLevel(skx);
  const top = topSkills(skx, 1)[0];
  const tp = skillProgress(top.xp);
  // base HUD only; celebrations are drained separately by the status line (see celebrate.ts)
  return `${C.b}${C.mag}Lvl${total}${C.r} ${bar(tp.pct, 8)} ${C.dim}${tp.pct}%${C.r} ${top.def.icon} ${C.b}${top.def.name} ${top.level}${C.r}`;
}

// A one-line "welcome back" for session start (streak lives here now, not the status line).
export function renderGreet(s: State): string {
  const skx = s.skillXp ?? {};
  const top = topSkills(skx, 1)[0];
  const today = s.craftDay === new Date().toISOString().slice(0, 10) ? s.craftXpToday : 0;
  const streak = `${C.orange}🔥 ${s.streak}-day streak${C.r}`;
  const lvl = `${C.mag}Lvl ${totalLevel(skx)}${C.r}`;
  const best = `top ${top.def.icon} ${top.def.name} ${top.level}`;
  const xp = today > 0 ? ` ${C.dim}·${C.r} ${C.yel}+${today} XP today${C.r}` : "";
  return `${streak} ${C.dim}·${C.r} ${lvl} ${C.dim}·${C.r} ${best}${xp}`;
}

// Full skill sheet for `renown skills` — every discipline, highest first.
export function renderSkillList(s: State): string {
  const skx = s.skillXp ?? {};
  const rows = SKILLS.map((sk) => { const xp = skx[sk.id] ?? 0; const pr = skillProgress(xp); return { sk, xp, lvl: pr.level, pct: pr.pct }; })
    .sort((a, b) => b.lvl - a.lvl || b.xp - a.xp);
  const head = `${C.b}${C.mag}Total Level ${totalLevel(skx)}${C.r}${C.dim}/${MAX_TOTAL_LEVEL}${C.r}  ${C.gold}${maxedCount(skx)} maxed${C.r}  ${C.dim}${SKILLS.length} skills${C.r}`;
  // fixed-width columns (level · bar · %) lead so they align; emoji+name trail freely.
  const lines = rows.map(({ sk, xp, lvl, pct }) => {
    const lc = lvl >= 99 ? C.gold : lvl >= 50 ? C.grn : lvl >= 20 ? C.yel : C.r;
    return `  ${lc}Lv${String(lvl).padStart(2)}${C.r} ${bar(pct, 10)} ${C.dim}${String(pct).padStart(3)}%${C.r} ${sk.icon} ${sk.name} ${C.dim}${fmtBig(xp)}xp${C.r}`;
  });
  return [head, ...lines].join("\n");
}

export function listSpikeBosses(dir: string): { comm: string; gb: number; ts: number }[] {
  const out: { comm: string; gb: number; ts: number }[] = [];
  for (const f of [`${dir}/metrics.log`, `${dir}/metrics.log.1`]) {
    try { for (const m of readFileSync(f, "utf8").matchAll(/# ALERT (\S+) usedPct=\d+ hog=(\S+) (\d+)MB/g)) out.push({ ts: Date.parse(m[1]) || 0, comm: m[2], gb: Number(m[3]) / 1024 }); } catch {}
  }
  return out;
}
export function hasEmergencyKill(dir: string, sinceTs: number): boolean {
  for (const f of [`${dir}/metrics.log`, `${dir}/metrics.log.1`]) {
    try { for (const m of readFileSync(f, "utf8").matchAll(/# EMERGENCY-KILL (\S+)/g)) if ((Date.parse(m[1]) || 0) > sinceTs) return true; } catch {}
  }
  return false;
}
export type { Boss, State };
