// Craft engine — turns a commit into EARNED xp by substance and importance, not raw
// count. Cheese (lockfiles, dist, minified, generated, reformat, tiny/duplicate) ≈ 0.
// Open-source × big bonus; GitHub stars tier it (log scale); others' repos worth more.
// Only commits YOU authored count. gh lookups cached (~/.renown/repometa.json, 24h).
import { $ } from "bun";
import type { State } from "./state.ts";
import { type Config, RDIR, hash } from "./runtime.ts";
import { readFileSync, writeFileSync } from "node:fs";

const META = `${RDIR}/repometa.json`;
const DAY = 86400000;

interface RepoMeta { owner: string; name: string; stars: number; oss: boolean; private: boolean; fork: boolean; fetchedAt: number }
const loadMeta = (): Record<string, RepoMeta> => { try { return JSON.parse(readFileSync(META, "utf8")); } catch { return {}; } };
const saveMeta = (m: Record<string, RepoMeta>) => { try { writeFileSync(META, JSON.stringify(m)); } catch {} };

async function parseRemote(repo: string): Promise<{ owner: string; name: string } | null> {
  const url = (await $`git -C ${repo} remote get-url origin`.text().catch(() => "")).trim();
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  return m ? { owner: m[1], name: m[2] } : null;
}
export async function repoMeta(repo: string): Promise<RepoMeta | null> {
  const r = await parseRemote(repo); if (!r) return null;
  const key = `${r.owner}/${r.name}`, cache = loadMeta();
  if (cache[key] && Date.now() - cache[key].fetchedAt < DAY) return cache[key];
  let stars = 0, priv = false, fork = false, oss = false;
  const jq = "{stars:.stargazers_count,private:.private,fork:.fork,license:(.license.key//null)}";
  const out = await $`gh api repos/${r.owner}/${r.name} --jq ${jq}`.text().catch(() => "");
  try { const j = JSON.parse(out); stars = j.stars || 0; priv = !!j.private; fork = !!j.fork; oss = !priv && !!j.license; } catch {}
  const meta: RepoMeta = { owner: r.owner, name: r.name, stars, oss, private: priv, fork, fetchedAt: Date.now() };
  cache[key] = meta; saveMeta(cache); return meta;
}

const LANG: Record<string, string> = { ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", rs: "Rust", go: "Go", py: "Python", rb: "Ruby", java: "Java", kt: "Kotlin", swift: "Swift", c: "C", h: "C", cc: "C++", cpp: "C++", hpp: "C++", cs: "C#", php: "PHP", ex: "Elixir", exs: "Elixir", hs: "Haskell", scala: "Scala", clj: "Clojure", zig: "Zig", lua: "Lua", dart: "Dart", sql: "SQL", svelte: "Svelte", vue: "Vue", astro: "Astro", css: "CSS", scss: "CSS", sass: "CSS", less: "CSS", html: "HTML", sh: "Shell", bash: "Shell", nix: "Nix" };
function classify(path: string) {
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

export interface CraftResult { xp: number; lines: number; oss: boolean; ext: boolean; stars: number; langs: string[]; paths: string[]; hasTests: boolean; subject: string; committedAt: number; breakdown: string[] }

export async function scoreCommit(s: State, cfg: Config, repo: string, sha: string): Promise<CraftResult | null> {
  const raw = await $`git -C ${repo} show --no-color --no-renames --format=%ae%x00%P%x00%ct%x00%s --numstat ${sha}`.text().catch(() => "");
  if (!raw) return null;
  const [head, ...rest] = raw.split("\n");
  const [ae, parents, ctStr, subject] = head.split("\0");
  const committedAt = (Number(ctStr) || 0) * 1000;
  if ((parents || "").trim().split(/\s+/).filter(Boolean).length > 1) return null;
  if (cfg.myEmails.length && !cfg.myEmails.includes((ae || "").trim())) return null;

  let sub = 0, srcFiles = 0, lines = 0; const langs = new Set<string>(); const paths: string[] = []; let hasTests = false, hasDocs = false;
  for (const line of rest) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/); if (!m) continue;
    const add = m[1] === "-" ? 0 : Number(m[1]); const cl = classify(m[3]);
    sub += cl.weight * add; if (cl.weight >= 0.5) lines += add;
    if (cl.lang) langs.add(cl.lang); if (cl.test) hasTests = true; if (cl.docs) hasDocs = true;
    if (cl.weight >= 0.8) srcFiles++;
    if (!cl.generated) paths.push(m[3]);   // real changed files (skip lockfiles/dist) for skill routing
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
  const fp = String(hash(rest.map(l => l.split("\t").pop()).sort().join("|") + "@" + Math.round(sub)));
  if (s.recentFp.includes(fp)) { dup = 0.35; breakdown.push("near-duplicate ×0.35"); }
  s.recentFp = [fp, ...s.recentFp.filter(x => x !== fp)].slice(0, 40);
  const meta = await repoMeta(repo); let proj = 1; const ext = !!meta && !cfg.myOwners.includes(meta.owner);
  if (meta) {
    if (meta.oss) { proj *= 2; breakdown.push("open-source ×2"); }
    if (meta.stars > 0) { const sm = 1 + Math.log10(meta.stars + 1) * 0.4; proj *= sm; breakdown.push(`${meta.stars}★ ×${sm.toFixed(2)}`); }
    if (ext) { proj *= 1.6; breakdown.push("others' project ×1.6"); }
  }
  proj = Math.min(proj, 8);
  const diminish = 1 / (1 + s.craftXpToday / 600);
  let xp = sub * craft * dup * proj * diminish;
  if (sub < 4) xp = Math.min(xp, 2);
  xp = Math.min(Math.round(xp), 300);
  return { xp, lines, oss: !!meta?.oss, ext, stars: meta?.stars ?? 0, langs: [...langs], paths, hasTests, subject: subj, committedAt, breakdown };
}
