// Renown core state shape + infinite leveling. (Engine logic — craft/stats/etc. —
// migrates here next; this is the type foundation the achievement system builds on.)

export interface Boss { name: string; emoji: string; gb: number; count: number; legend?: boolean; lastSeen?: number }
export interface Quest { id: string; desc: string; goal: number; prog: number; xp: number; done: boolean }
export type RepoVisibility = "public" | "private" | "unknown";
export interface ProjStat { name: string; commits: number; lines: number; xp: number; first: number; last: number; stars: number; oss: boolean; ext: boolean; visibility?: RepoVisibility; activeSec: number; langs: Record<string, number> }
export interface LangStat { commits: number; lines: number; xp: number }
export interface DayStat { a: number; xp: number; c: number; l: number }
export interface Stats {
  firstSeen: number; lastSeen: number; lastActivity: number;
  activeSec: number; sessionCount: number; longestSec: number;
  curStart: number; curSec: number; anchorXp: number; anchorCommits: number;
  hourActive: number[]; dowActive: number[]; commitHour: number[]; commitDow: number[];
  daily: Record<string, DayStat>; sessions: { s: number; e: number; sec: number; xp: number; c: number }[];
}
export interface State {
  v: number; name: string; playerId: string; createdAt: number;
  xp: number; lifetimeXp: number; streak: number; lastActiveDay: string;
  commits: number; linesAdded: number; bossesSurvived: number; secondsHealthy: number;
  ossCommits: number; extCommits: number; starsTouched: number; topStars: number;
  langs: Record<string, number>; hours: Record<string, number>; days: Record<string, number>;
  skillXp: Record<string, number>;
  agentUses?: Record<string, number>;
  agentLastUsedAt?: Record<string, number>;
  collectibles: Record<string, { at: number; count: number }>;
  wild: string[];                 // seeds of procedurally-generated wild creatures found
  companion?: string;             // seed of the wild creature you've adopted as your pet

  achievements: Record<string, number>; bestiary: Record<string, Boss>;
  questDay: string; quests: Quest[]; repoHeads: Record<string, string>;
  recentFp: string[]; craftDay: string; craftXpToday: number; maxMem: number;
  lastTick: number; lastLogScanTs: number; lastBossTs: number;
  best: { xpInDay: number; level: number; streak: number };
  stats: Stats; projects: Record<string, ProjStat>; langsDeep: Record<string, LangStat>;
  flash?: { msg: string; until: number } | null;
}

// ---------- infinite leveling ----------
export function need(level: number) { return Math.round(80 + (level - 1) * 45 + Math.pow(level, 1.6)); }
export function levelInfo(xp: number) {
  let level = 1, rem = xp;
  while (rem >= need(level)) { rem -= need(level); level++; }
  const n = need(level);
  return { level, into: Math.floor(rem), need: n, pct: Math.floor((rem / n) * 100) };
}
export const level = (s: State) => levelInfo(s.xp).level;

const CLASSES = ["Hello-World Hatchling", "Script Kiddie", "Code Apprentice", "Journeyman Dev", "Bug Whisperer", "Senior Engineer", "Stack Sorcerer", "Staff Engineer", "Refactor Ranger", "Principal Engineer", "Systems Architect", "Type Tamer", "Distinguished Engineer", "Heap Sherpa", "Kernel Whisperer", "Fellow", "Code Sage", "Grandmaster Hacker", "Mythic Committer", "Ascended Dev", "Demigod of Bytes", "RAM Deity", "The Singularity"];
const ROMAN: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
export function roman(n: number) { let s = ""; for (const [v, sym] of ROMAN) while (n >= v) { s += sym; n -= v; } return s || "I"; }
export function titleFor(lvl: number): string {
  const band = Math.floor((lvl - 1) / 5), prestige = Math.floor(band / CLASSES.length);
  const base = CLASSES[Math.min(band, CLASSES.length - 1)];
  return prestige > 0 ? `${CLASSES[band % CLASSES.length]} ${roman(prestige + 1)}` : base;
}

// ---------- accessors used by achievement checks ----------
export const distinctLangs = (s: State) => Object.keys(s.langs).length;
export const distinctHours = (s: State) => Object.keys(s.hours).length;
export const distinctDays = (s: State) => Object.keys(s.days).length;
export const nightCommits = (s: State) => (s.hours[0] ?? 0) + (s.hours[1] ?? 0) + (s.hours[2] ?? 0) + (s.hours[3] ?? 0);
export const projectCount = (s: State) => Object.keys(s.projects).length;
export const ossProjectCount = (s: State) => Object.values(s.projects).filter(p => p.oss).length;
export const bestStreak = (s: State) => s.best?.streak ?? s.streak;
