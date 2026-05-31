// Pure craft-scoring core — NO Bun, NO fs, NO git. The single source of truth for how a commit
// becomes EARNED xp (substance × craft × project-importance, never raw count). Shared by:
//   • the local CLI (core/craft.ts) — feeds it `git show --numstat` data, and
//   • the server (web/src/backend/repoScore.ts) — feeds it GitHub commit-API data,
// so the XP formula can't drift between "what your machine scores" and "what CI scores".
//
// Keep this file dependency-free so the web backend can import it without pulling in Bun.

const LANG: Record<string, string> = { ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", rs: "Rust", go: "Go", py: "Python", rb: "Ruby", java: "Java", kt: "Kotlin", swift: "Swift", c: "C", h: "C", cc: "C++", cpp: "C++", hpp: "C++", cs: "C#", php: "PHP", ex: "Elixir", exs: "Elixir", hs: "Haskell", scala: "Scala", clj: "Clojure", zig: "Zig", lua: "Lua", dart: "Dart", sql: "SQL", svelte: "Svelte", vue: "Vue", astro: "Astro", css: "CSS", scss: "CSS", sass: "CSS", less: "CSS", html: "HTML", sh: "Shell", bash: "Shell", nix: "Nix" };

export function classify(path: string) {
  const p = path.toLowerCase();
  if (/(^|\/)(dist|build|out|vendor|node_modules|\.next|\.svelte-kit|coverage|generated)\//.test(p) || /\.(min\.(js|css)|map|snap)$/.test(p) || /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|cargo\.lock|go\.sum|poetry\.lock)$/.test(p)) return { weight: 0.05, generated: true };
  if (/(\.|\/)(test|spec)\.|__tests__|(^|\/)(tests?|e2e|__mocks__)\//.test(p)) return { weight: 1, test: true, lang: LANG[p.split(".").pop() || ""] };
  if (/\.(md|mdx|rst|txt)$/.test(p)) return { weight: 0.5, docs: true };
  const ext = p.split(".").pop() || "";
  if (LANG[ext]) return { weight: 1, lang: LANG[ext] };
  if (/\.(json|ya?ml|toml|ini|env|xml|conf)$/.test(p)) return { weight: 0.4 };
  return { weight: 0.5 };
}

const JUNK = /^(wip|\.+|update|fixes?|asdf|stuff|temp|tmp|test|x+|foo|bar|changes?|misc|minor|cleanup|format|prettier|lint)$/i;
const CONV = /^(feat|fix|refactor|perf|test|docs|build|ci|style|revert)(\(.+\))?!?:/i;
// FNV-1a (mirrors core/runtime.ts `hash`) so near-duplicate fingerprints match the local engine.
const fnv1a = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

export type CommitFile = { path: string; additions: number };
export type RepoImportance = { stars: number; oss: boolean; owner: string };
export type ScoreInput = {
  subject: string;
  files: CommitFile[];          // every changed file (incl. generated); classify() weights them
  meta: RepoImportance | null;  // repo stars/oss/owner for the importance multiplier
  myOwners?: string[];          // owners you control → not "external" (×1.6 only applies to others')
  recentFps?: string[];         // fingerprints already seen this batch → near-duplicate ×0.35
  craftXpToday?: number;        // xp already earned today → diminishing returns
};
export type ScoredCommit = { xp: number; lines: number; oss: boolean; ext: boolean; stars: number; langs: string[]; paths: string[]; hasTests: boolean; subject: string; breakdown: string[]; fp: string; sub: number };

// Score one commit from already-fetched data. Identical math to core/craft.ts's scoreCommit,
// just decoupled from how the file list was obtained (git numstat vs GitHub API).
export function scoreCommitData(input: ScoreInput): ScoredCommit {
  const { subject, files, meta, myOwners = [], recentFps = [], craftXpToday = 0 } = input;
  let sub = 0, srcFiles = 0, lines = 0;
  const langs = new Set<string>(); const paths: string[] = [];
  let hasTests = false, hasDocs = false;
  for (const f of files) {
    const add = Number.isFinite(f.additions) ? f.additions : 0;
    const cl = classify(f.path);
    sub += cl.weight * add; if (cl.weight >= 0.5) lines += add;
    if (cl.lang) langs.add(cl.lang); if (cl.test) hasTests = true; if (cl.docs) hasDocs = true;
    if (cl.weight >= 0.8) srcFiles++;
    if (!cl.generated) paths.push(f.path);
  }
  const breakdown = [`substance ${sub.toFixed(0)}`];
  let craft = 1;
  if (hasTests) { craft += 0.25; breakdown.push("tests +25%"); }
  if (hasDocs) { craft += 0.1; breakdown.push("docs +10%"); }
  const div = Math.min(4, srcFiles); if (div >= 2) { craft += 0.05 * div; breakdown.push(`${srcFiles} files +${5 * div}%`); }
  const subj = (subject || "").trim();
  if (CONV.test(subj)) { craft += 0.1; breakdown.push("clean message +10%"); }
  else if (JUNK.test(subj) || subj.length < 6) { craft *= 0.6; breakdown.push("low-effort message ×0.6"); }
  let dup = 1;
  const fp = String(fnv1a(files.map((f) => f.path).sort().join("|") + "@" + Math.round(sub)));
  if (recentFps.includes(fp)) { dup = 0.35; breakdown.push("near-duplicate ×0.35"); }
  let proj = 1; const ext = !!meta && !myOwners.includes(meta.owner);
  if (meta) {
    if (meta.oss) { proj *= 2; breakdown.push("open-source ×2"); }
    if (meta.stars > 0) { const sm = 1 + Math.log10(meta.stars + 1) * 0.4; proj *= sm; breakdown.push(`${meta.stars}★ ×${sm.toFixed(2)}`); }
    if (ext) { proj *= 1.6; breakdown.push("others' project ×1.6"); }
  }
  proj = Math.min(proj, 8);
  const diminish = 1 / (1 + craftXpToday / 600);
  let xp = sub * craft * dup * proj * diminish;
  if (sub < 4) xp = Math.min(xp, 2);
  xp = Math.min(Math.round(xp), 300);
  return { xp, lines, oss: !!meta?.oss, ext, stars: meta?.stars ?? 0, langs: [...langs], paths, hasTests, subject: subj, breakdown, fp, sub };
}
