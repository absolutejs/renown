// RuneScape-style multi-skill progression. Every skill levels 1 → 99 on the authentic
// OSRS experience curve (fast early, a brutal slow-burn near the cap), XP keeps accruing
// past 99 for prestige bragging rights, and your TOTAL LEVEL — the sum across every
// skill — is the headline flex (max = 99 × number of skills). Skills are data (SKILLS),
// so adding or retuning a strength is a one-line change. XP is *routed* from the craft
// engine: a single commit can train several skills at once — an open-source test commit
// trains Shipping + Testing + Open Source, RuneScape-style.

import type { CraftResult } from "./craft.ts";

export const MAX_LEVEL = 99;

// XP_SCALE divides the authentic OSRS thresholds so 99 is a long-but-reachable grind for
// real dev work (raw OSRS 99 = 13,034,431 xp, unreachable at ~30-300 xp/commit). The curve
// SHAPE is preserved; only the magnitude is tuned. Bump it down to make 99 rarer.
export const XP_SCALE = 25;

// Authentic OSRS experience table (scaled): xp required to *reach* each level, 1-indexed.
const xpAt: number[] = (() => {
  const table = [0, 0]; // index 0 unused; level 1 = 0 xp
  let points = 0;
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    table[lvl + 1] = Math.floor(Math.floor(points / 4) / XP_SCALE);
  }
  return table;
})();

export const xpForLevel = (lvl: number) => xpAt[Math.max(1, Math.min(MAX_LEVEL, lvl))] ?? 0;

// Level for a given xp (capped at 99; xp past 99 still counts toward total xp / prestige).
export const levelForXp = (xp: number) => {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= xpAt[lvl + 1]) lvl++;
  return lvl;
};

// Progress within the current level: { level, into, need, pct } (pct 0-100; 100 at the cap).
export const skillProgress = (xp: number) => {
  const lvl = levelForXp(xp);
  if (lvl >= MAX_LEVEL) return { level: MAX_LEVEL, into: 0, need: 0, pct: 100 };
  const base = xpAt[lvl], next = xpAt[lvl + 1];
  const into = xp - base, need = next - base;
  return { level: lvl, into, need, pct: Math.floor((into / need) * 100) };
};

// ---------- the strengths (data-driven; tune freely) ----------
export interface SkillDef {
  id: string; name: string; icon: string; blurb: string;
  // xp this skill earns from one scored commit (0 = untrained by that commit).
  route: (c: CraftResult) => number;
}

const subj = (c: CraftResult, re: RegExp) => re.test(c.subject);
const ARCH_LINES = 200;

export const SKILLS: SkillDef[] = [
  { id: "shipping", name: "Shipping", icon: "🚢", blurb: "Substance shipped — the main grind every commit feeds.", route: (c) => c.xp },
  { id: "testing", name: "Testing", icon: "🧪", blurb: "Commits that add or strengthen tests.", route: (c) => (c.hasTests ? c.xp : 0) },
  { id: "opensource", name: "Open Source", icon: "🌍", blurb: "Work in public, open-licensed repos.", route: (c) => (c.oss ? c.xp : 0) },
  { id: "foreign", name: "Foreign Lands", icon: "🧭", blurb: "Contributions to other people's projects.", route: (c) => (c.ext ? c.xp : 0) },
  { id: "stargazing", name: "Stargazing", icon: "⭐", blurb: "Commits to repos the world has starred.", route: (c) => (c.stars > 0 ? Math.round(c.xp * Math.min(1, Math.log10(c.stars + 1) * 0.5)) : 0) },
  { id: "polyglot", name: "Polyglot", icon: "🗣️", blurb: "Breadth — touching many languages at once.", route: (c) => (c.langs.length >= 2 ? Math.round(c.xp * Math.min(1, (c.langs.length - 1) * 0.5)) : 0) },
  { id: "debugging", name: "Debugging", icon: "🐛", blurb: "Fixes, hotfixes and bug hunts.", route: (c) => (subj(c, /\b(fix|fixes|fixed|bug|hotfix|patch|repair|resolve[sd]?)\b/i) ? c.xp : 0) },
  { id: "refactoring", name: "Refactoring", icon: "♻️", blurb: "Cleanups, renames, simplifications, deletions.", route: (c) => (subj(c, /\b(refactor|cleanup|clean ?up|simplif(y|ied)|rename|dedupe?|remove|delete|prune)\b/i) ? c.xp : 0) },
  { id: "documentation", name: "Documentation", icon: "📖", blurb: "Docs, guides and comments that teach.", route: (c) => (subj(c, /\b(docs?|readme|guide|comment|changelog)\b/i) || c.langs.length === 0 ? Math.round(c.xp * 0.8) : 0) },
  { id: "architecture", name: "Architecture", icon: "🏛️", blurb: "Large, cross-cutting structural work.", route: (c) => (c.langs.length >= 2 && c.lines >= ARCH_LINES ? c.xp : 0) }
];

export const SKILL_IDS = SKILLS.map((sk) => sk.id);
export const skillById = (id: string) => SKILLS.find((sk) => sk.id === id);

export type SkillXp = Record<string, number>;

// Route one scored commit into per-skill xp gains (only the skills it actually trains).
export const awardCraft = (c: CraftResult): SkillXp => {
  const gains: SkillXp = {};
  for (const sk of SKILLS) {
    const got = Math.round(sk.route(c));
    if (got > 0) gains[sk.id] = got;
  }
  return gains;
};

// Merge gains into a skill-xp ledger (mutates + returns it), tracking which skills leveled.
export const applyGains = (ledger: SkillXp, gains: SkillXp) => {
  const levelUps: { id: string; from: number; to: number }[] = [];
  for (const id of Object.keys(gains)) {
    const before = levelForXp(ledger[id] ?? 0);
    ledger[id] = (ledger[id] ?? 0) + gains[id];
    const after = levelForXp(ledger[id]);
    if (after > before) levelUps.push({ id, from: before, to: after });
  }
  return levelUps;
};

export const totalLevel = (ledger: SkillXp) => SKILLS.reduce((sum, sk) => sum + levelForXp(ledger[sk.id] ?? 0), 0);
export const totalXp = (ledger: SkillXp) => SKILLS.reduce((sum, sk) => sum + (ledger[sk.id] ?? 0), 0);
export const maxedCount = (ledger: SkillXp) => SKILLS.filter((sk) => levelForXp(ledger[sk.id] ?? 0) >= MAX_LEVEL).length;
export const MAX_TOTAL_LEVEL = MAX_LEVEL * SKILLS.length;

// Highest skill(s) — used by the HUD to show your best strength at a glance.
export const topSkills = (ledger: SkillXp, n = 1) =>
  [...SKILLS]
    .map((sk) => ({ def: sk, xp: ledger[sk.id] ?? 0, level: levelForXp(ledger[sk.id] ?? 0) }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, n);
