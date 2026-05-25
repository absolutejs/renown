// Renown — PROCEDURAL achievements (≥10,000). Combinatorial families across many
// axes. Performance: the catalog (for the DB + lookups) is built once and memoized;
// runtime unlocking NEVER scans 10k — each family computes the ids a player currently
// qualifies for directly from a counter (sorted thresholds + early break), and an
// `unlocked` Set gives O(1) membership. Sets also dedupe ids during generation.
import { type State, bestStreak, distinctLangs, level } from "../state.ts";
import type { Tier, Vis } from "./curated.ts";

export interface Def { id: string; name: string; desc: string; cat: string; tier: Tier; vis: Vis; generated: true }

const range = (a: number, b: number, step: number) => { const o: number[] = []; for (let n = a; n <= b; n += step) o.push(n); return o; };
const k = (n: number) => n >= 1e6 ? `${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(n % 1e3 ? 1 : 0)}k` : `${n}`;
const RANKS = ["Novice", "Apprentice", "Adept", "Journeyman", "Expert", "Veteran", "Master", "Grandmaster", "Legend", "Mythic", "Ascended", "Eternal"];
const TIERS: Tier[] = ["bronze", "bronze", "silver", "silver", "gold", "gold", "platinum", "platinum", "mythic", "mythic", "mythic", "mythic"];
const band = (i: number, tot: number) => Math.min(11, Math.floor((i / tot) * 12));

interface Fam { gen(): Def[]; qualified(s: State): string[] }
const fams: Fam[] = [];

// ascending-threshold family: O(thresholds) gen, O(crossed) qualify (early break)
function thresh(prefix: string, cat: string, label: string, metric: string, ths: number[], value: (s: State) => number, vis: Vis = "shown") {
  fams.push({
    gen: () => ths.map((n, i) => ({ id: `${prefix}:${n}`, name: `${RANKS[band(i, ths.length)]} ${label} (${k(n)})`, desc: `Reach ${k(n)} ${metric}`, cat, tier: TIERS[band(i, ths.length)], vis, generated: true as const })),
    qualified: (s) => { const v = value(s); const out: string[] = []; for (const n of ths) { if (v >= n) out.push(`${prefix}:${n}`); else break; } return out; },
  });
}

// core progression families
thresh("level", "Levels", "Ascendant", "levels", range(1, 1000, 1), level);
thresh("xp", "XP", "Renowned", "lifetime XP", range(1000, 1_000_000, 1000), s => s.lifetimeXp);
thresh("commits", "Commits", "Committer", "commits", range(25, 50000, 25), s => s.commits);
thresh("lines", "Craft", "Author", "lines", range(500, 500000, 500), s => s.linesAdded);
thresh("streak", "Streak", "Devotee", "day streak", range(1, 730, 1), bestStreak);
thresh("active", "Activity", "Grinder", "active hours", range(1, 1000, 1), s => s.stats.activeSec / 3600);
thresh("oss", "OpenSource", "Contributor", "open-source commits", range(5, 1000, 5), s => s.ossCommits);
thresh("ext", "OpenSource", "Samaritan", "external commits", range(5, 500, 5), s => s.extCommits);
thresh("boss", "Boss", "Slayer", "bosses survived", range(1, 500, 1), s => s.bossesSurvived);
thresh("sessions", "Activity", "Regular", "sessions", range(10, 5000, 10), s => s.stats.sessionCount);
thresh("adays", "Streak", "Present", "active days", range(1, 1000, 1), s => Object.keys(s.stats.daily).length);
thresh("bday", "XP", "Burst", "XP in a day", range(100, 50000, 100), s => s.best.xpInDay);
thresh("projects", "Projects", "Juggler", "projects", range(1, 200, 1), s => Object.keys(s.projects).length);
thresh("projxp", "Projects", "Magnum", "XP in one project", range(500, 100000, 500), s => Math.max(0, ...Object.values(s.projects).map(p => p.xp)));
thresh("stars", "Prestige", "Stargazer", "stars on a touched repo", [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000], s => s.topStars, "hidden");
thresh("poly", "Polyglot", "Polyglot", "languages", range(2, 32, 1), distinctLangs, "hidden");

// time families (separate hour / day; joint hour×dow lands when the engine stores it)
fams.push({
  gen: () => range(0, 23, 1).map(h => ({ id: `hour:${h}`, name: `The ${String(h).padStart(2, "0")}:00 Hour`, desc: `Commit during the ${h}:00 hour`, cat: "Time", tier: (h < 5 || h >= 22 ? "gold" : "bronze") as Tier, vis: "secret" as Vis, generated: true as const })),
  qualified: (s) => range(0, 23, 1).filter(h => (s.hours[h] ?? 0) > 0).map(h => `hour:${h}`),
});
const DOWN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
fams.push({
  gen: () => range(0, 6, 1).map(d => ({ id: `day:${d}`, name: `${DOWN[d]} Shipper`, desc: `Commit on a ${DOWN[d]}`, cat: "Time", tier: "bronze" as Tier, vis: "secret" as Vis, generated: true as const })),
  qualified: (s) => range(0, 6, 1).filter(d => (s.days[d] ?? 0) > 0).map(d => `day:${d}`),
});

// language families (lang × milestone)
const LANGS = ["TypeScript", "JavaScript", "Rust", "Go", "Python", "Ruby", "Java", "Kotlin", "Swift", "C", "C++", "C#", "PHP", "Elixir", "Haskell", "Scala", "Clojure", "Zig", "Lua", "Dart", "SQL", "Svelte", "Vue", "Astro", "CSS", "HTML", "Shell", "Nix", "OCaml", "Erlang", "Julia", "R"];
const LC = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const LCL = [100, 1000, 5000, 10000, 50000, 100000];
for (const lang of LANGS) {
  fams.push({
    gen: () => LC.map((n, i) => ({ id: `lc:${lang}:${n}`, name: `${lang} ${RANKS[band(i, LC.length)]} (${k(n)})`, desc: `Author ${k(n)} ${lang} commits`, cat: "Languages", tier: TIERS[band(i, LC.length)], vis: (i === 0 ? "secret" : "hidden") as Vis, generated: true as const })),
    qualified: (s) => { const v = s.langs[lang] ?? 0; const o: string[] = []; for (const n of LC) { if (v >= n) o.push(`lc:${lang}:${n}`); else break; } return o; },
  });
  fams.push({
    gen: () => LCL.map((n, i) => ({ id: `ll:${lang}:${n}`, name: `${lang} Wordsmith (${k(n)} lines)`, desc: `Write ${k(n)} lines of ${lang}`, cat: "Languages", tier: TIERS[band(i, LCL.length)], vis: "hidden" as Vis, generated: true as const })),
    qualified: (s) => { const v = s.langsDeep[lang]?.lines ?? 0; const o: string[] = []; for (const n of LCL) { if (v >= n) o.push(`ll:${lang}:${n}`); else break; } return o; },
  });
}

// boss type × GB tiers
const BOSSES: [string, string][] = [["tsc", "Type Dragon"], ["ugrep", "Regex Hydra"], ["chromium", "Browser Swarm"], ["claude", "Cloned Legion"], ["bun", "Bun Bunny"], ["node", "Node Golem"], ["esbuild", "Build Wraith"], ["ram", "RAM Wraith"]];
const GB = [1, 2, 4, 8, 12, 16, 24, 32];
for (const [key, nm] of BOSSES) {
  fams.push({
    gen: () => GB.map((g, i) => ({ id: `bt:${key}:${g}`, name: `Slew a ${g}GB ${nm}`, desc: `Survive a ${g}GB+ ${nm}`, cat: "Boss", tier: TIERS[band(i, GB.length)], vis: "hidden" as Vis, generated: true as const })),
    qualified: (s) => { const v = s.bestiary[key]?.gb ?? 0; const o: string[] = []; for (const g of GB) { if (v >= g) o.push(`bt:${key}:${g}`); else break; } return o; },
  });
}

let _cat: Def[] | null = null, _map: Map<string, Def> | null = null;
export function catalog(): Def[] {
  if (_cat) return _cat;
  const seen = new Set<string>(), out: Def[] = [];
  for (const f of fams) for (const d of f.gen()) if (!seen.has(d.id)) { seen.add(d.id); out.push(d); }
  return (_cat = out);
}
export function genMap(): Map<string, Def> { return _map ??= new Map(catalog().map(d => [d.id, d])); }
export function genCount(): number { return catalog().length; }
export function evalGenerated(s: State, unlocked: Set<string>): string[] {
  const out: string[] = [];
  for (const f of fams) for (const id of f.qualified(s)) if (!unlocked.has(id)) out.push(id);
  return out;
}
