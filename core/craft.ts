// Craft engine — turns a commit into EARNED xp by substance and importance, not raw
// count. Cheese (lockfiles, dist, minified, generated, reformat, tiny/duplicate) ≈ 0.
// Open-source × big bonus; GitHub stars tier it (log scale); others' repos worth more.
// Only commits YOU authored count. gh lookups cached (~/.renown/repometa.json, 24h).
import { $ } from "bun";
import type { State } from "./state.ts";
import { type Config, RDIR } from "./runtime.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { scoreCommitData } from "./craftScore.ts";

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

export interface CraftResult { xp: number; lines: number; oss: boolean; ext: boolean; stars: number; langs: string[]; paths: string[]; hasTests: boolean; subject: string; committedAt: number; breakdown: string[]; repoPublic?: boolean }

export async function scoreCommit(s: State, cfg: Config, repo: string, sha: string): Promise<CraftResult | null> {
  const raw = await $`git -C ${repo} show --no-color --no-renames --format=%ae%x00%P%x00%ct%x00%s --numstat ${sha}`.text().catch(() => "");
  if (!raw) return null;
  const [head, ...rest] = raw.split("\n");
  const [ae, parents, ctStr, subject] = head.split("\0");
  const committedAt = (Number(ctStr) || 0) * 1000;
  if ((parents || "").trim().split(/\s+/).filter(Boolean).length > 1) return null;
  if (cfg.myEmails.length && !cfg.myEmails.includes((ae || "").trim())) return null;

  // git numstat → per-file additions (binary files show "-" → 0). The shared scorer in
  // craftScore.ts owns the formula so the server can score GitHub-API data identically.
  const files: { path: string; additions: number }[] = [];
  for (const line of rest) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/); if (!m) continue;
    files.push({ path: m[3], additions: m[1] === "-" ? 0 : Number(m[1]) });
  }
  const meta = await repoMeta(repo);
  const scored = scoreCommitData({
    subject: subject || "",
    files,
    meta: meta ? { stars: meta.stars, oss: meta.oss, owner: meta.owner } : null,
    myOwners: cfg.myOwners,
    recentFps: s.recentFp,
    craftXpToday: s.craftXpToday,
  });
  s.recentFp = [scored.fp, ...s.recentFp.filter((x) => x !== scored.fp)].slice(0, 40);
  return {
    xp: scored.xp, lines: scored.lines, oss: scored.oss, ext: scored.ext, stars: scored.stars,
    langs: scored.langs, paths: scored.paths, hasTests: scored.hasTests, subject: scored.subject,
    committedAt, breakdown: scored.breakdown, repoPublic: !!meta && !meta.private && !meta.fork,
  };
}
