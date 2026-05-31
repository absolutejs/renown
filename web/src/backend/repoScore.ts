// Server-side per-repo scoring from the GitHub API — the path that lets CI populate a repo's
// /project leaderboard without a local checkout. It reuses the EXACT craft formula from
// core/craftScore.ts (substance × craft × project-importance), just fed GitHub commit data
// instead of `git show --numstat`, so a contributor's CI-computed XP matches what the local
// CLI would score. The server uses its own GitHub token; nothing is trusted from the caller.
//
// commits = exact (search/commits total_count, one call). xp/lines = the K most-recent commits
// scored — a monotonic FLOOR, since the board upsert keeps the greatest value, so this can only
// ever raise a contributor's standing (e.g. first-time contributors get put on the board), never
// regress what the local CLI already submitted.
import { scoreCommitData } from "../../../core/craftScore.ts";

const GH = "https://api.github.com";
const headers = (token?: string): Record<string, string> => ({
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "renown",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});
// Commit search needs the cloak-preview media type.
const searchHeaders = (token?: string) => ({ ...headers(token), accept: "application/vnd.github.cloak-preview+json" });

export type RepoImportance = { stars: number; oss: boolean; owner: string; private: boolean; fork: boolean };
export type RepoScore = { commits: number; lines: number; xp: number; stars: number; oss: boolean };

export const fetchRepoImportance = async (owner: string, repo: string, token = process.env.GITHUB_TOKEN): Promise<RepoImportance | null> => {
  try {
    const r = await fetch(`${GH}/repos/${owner}/${repo}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { stargazers_count?: number; private?: boolean; fork?: boolean; license?: { key?: string } | null; owner?: { login?: string } };
    const priv = !!j.private;
    return { stars: j.stargazers_count ?? 0, oss: !priv && !!j.license?.key, owner: j.owner?.login ?? owner, private: priv, fork: !!j.fork };
  } catch { return null; }
};

// Exact count of (login)'s commits in (owner/repo) — one search call (total_count).
const fetchCommitCount = async (owner: string, repo: string, login: string, token?: string): Promise<number> => {
  try {
    const q = `repo:${owner}/${repo} author:${login}`;
    const r = await fetch(`${GH}/search/commits?q=${encodeURIComponent(q)}&per_page=1`, { headers: searchHeaders(token), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return 0;
    return ((await r.json()) as { total_count?: number }).total_count ?? 0;
  } catch { return 0; }
};

// Most-recent commit SHAs by (login) in the repo, merges excluded (like the local scorer).
const fetchAuthorShas = async (owner: string, repo: string, login: string, cap: number, token?: string): Promise<string[]> => {
  try {
    const r = await fetch(`${GH}/repos/${owner}/${repo}/commits?author=${encodeURIComponent(login)}&per_page=${Math.min(100, cap)}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return [];
    const j = (await r.json()) as Array<{ sha?: string; parents?: unknown[] }>;
    return j.filter((c) => (c.parents?.length ?? 0) < 2).map((c) => c.sha).filter((s): s is string => !!s).slice(0, cap);
  } catch { return []; }
};

// Per-commit detail: subject + per-file {path, additions} for the substance formula.
const fetchCommitFiles = async (owner: string, repo: string, sha: string, token?: string): Promise<{ subject: string; files: { path: string; additions: number }[] } | null> => {
  try {
    const r = await fetch(`${GH}/repos/${owner}/${repo}/commits/${sha}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { commit?: { message?: string }; files?: Array<{ filename?: string; additions?: number }> };
    const files = (j.files ?? []).map((f) => ({ path: f.filename ?? "", additions: f.additions ?? 0 })).filter((f) => f.path);
    return { subject: (j.commit?.message ?? "").split("\n")[0], files };
  } catch { return null; }
};

// Score (login)'s contribution to (owner/repo). Returns null if there's nothing creditable.
export const scoreRepoForLogin = async (
  owner: string, repo: string, login: string,
  opts?: { token?: string; sample?: number; importance?: RepoImportance | null },
): Promise<RepoScore | null> => {
  const token = opts?.token ?? process.env.GITHUB_TOKEN;
  const sample = Math.max(1, Math.min(50, opts?.sample ?? 30));
  const meta = opts?.importance !== undefined ? opts.importance : await fetchRepoImportance(owner, repo, token);
  const commits = await fetchCommitCount(owner, repo, login, token);
  const shas = await fetchAuthorShas(owner, repo, login, sample, token);
  if (commits === 0 && shas.length === 0) return null;

  // Fetch commit details concurrently (5 in flight), then score in SHA order so the
  // diminishing-returns / near-duplicate state is deterministic.
  const byS = new Map<string, { subject: string; files: { path: string; additions: number }[] }>();
  const queue = shas.slice();
  const worker = async () => {
    while (queue.length > 0) {
      const sha = queue.shift();
      if (!sha) continue;
      const d = await fetchCommitFiles(owner, repo, sha, token);
      if (d) byS.set(sha, d);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);

  const importance = meta ? { stars: meta.stars, oss: meta.oss, owner: meta.owner } : null;
  let xp = 0, lines = 0;
  const recentFps: string[] = [];
  for (const sha of shas) {
    const d = byS.get(sha);
    if (!d) continue;
    const scored = scoreCommitData({ subject: d.subject, files: d.files, meta: importance, myOwners: [], recentFps, craftXpToday: xp });
    recentFps.unshift(scored.fp); if (recentFps.length > 40) recentFps.pop();
    xp += scored.xp; lines += scored.lines;
  }
  return { commits: Math.max(commits, shas.length), lines, xp, stars: meta?.stars ?? 0, oss: !!meta?.oss };
};
