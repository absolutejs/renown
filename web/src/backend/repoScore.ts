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
export type RepoImportance = { stars: number; oss: boolean; owner: string; private: boolean; fork: boolean };
export type RepoScore = { commits: number; lines: number; xp: number; stars: number; oss: boolean };

// /submit may arrive every few seconds. Visibility must be server-confirmed, but doing five
// GitHub calls per heartbeat would exhaust the API budget. Keep the privacy-sensitive answer
// briefly cached; a public→private transition is rechecked within this window (and the next
// sync then deletes the shared board). Failures are never cached as public.
const REPO_META_TTL_MS = 5 * 60 * 1000;
const repoMetaCache = new Map<string, { value: RepoImportance; expiresAt: number }>();

export const fetchRepoImportance = async (owner: string, repo: string, token = process.env.GITHUB_TOKEN): Promise<RepoImportance | null> => {
  const key = `${owner}/${repo}`.toLowerCase();
  const cached = repoMetaCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const r = await fetch(`${GH}/repos/${owner}/${repo}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { stargazers_count?: number; private?: boolean; fork?: boolean; license?: { key?: string } | null; owner?: { login?: string } };
    if (typeof j.private !== "boolean") return null;
    const priv = j.private;
    const value = { stars: j.stargazers_count ?? 0, oss: !priv && !!j.license?.key, owner: j.owner?.login ?? owner, private: priv, fork: !!j.fork };
    repoMetaCache.set(key, { value, expiresAt: Date.now() + REPO_META_TTL_MS });
    return value;
  } catch { return null; }
};

// Most-recent commit SHAs by (login) in the repo (merges excluded), via the CORE commits API —
// NOT search/commits, whose 30-req/min budget is far scarcer. `fetchN` (≤100) sets how many we
// list for the count floor; we score only the first `sample` of them.
const fetchAuthorShas = async (owner: string, repo: string, login: string, fetchN: number, token?: string): Promise<string[]> => {
  try {
    const r = await fetch(`${GH}/repos/${owner}/${repo}/commits?author=${encodeURIComponent(login)}&per_page=${Math.min(100, fetchN)}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return [];
    const j = (await r.json()) as Array<{ sha?: string; parents?: unknown[] }>;
    return j.filter((c) => (c.parents?.length ?? 0) < 2).map((c) => c.sha).filter((s): s is string => !!s);
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

// Score a known set of attributed SHAs. This is the AI/co-author counterpart to the normal
// author-list path below: discovery comes from GitHub commit search, but commit contents are
// still fetched and passed through the exact same craft formula.
export const scoreRepoShas = async (
  owner: string, repo: string, attributedShas: string[],
  opts?: { token?: string; sample?: number; importance?: RepoImportance | null; commitCount?: number },
): Promise<RepoScore | null> => {
  const token = opts?.token ?? process.env.GITHUB_TOKEN;
  const sample = Math.max(1, Math.min(30, opts?.sample ?? 20));
  const uniqueShas = [...new Set(attributedShas)].filter(Boolean);
  if (uniqueShas.length === 0) return null;
  const meta = opts?.importance !== undefined ? opts.importance : await fetchRepoImportance(owner, repo, token);
  if (!meta || meta.private) return null;
  const shas = uniqueShas.slice(0, sample);

  const byS = new Map<string, { subject: string; files: { path: string; additions: number }[] }>();
  const queue = shas.slice();
  const worker = async () => {
    while (queue.length > 0) {
      const sha = queue.shift();
      if (!sha) continue;
      const detail = await fetchCommitFiles(owner, repo, sha, token);
      if (detail) byS.set(sha, detail);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);

  const importance = { stars: meta.stars, oss: meta.oss, owner: meta.owner };
  let xp = 0, lines = 0;
  const recentFps: string[] = [];
  for (const sha of shas) {
    const detail = byS.get(sha);
    if (!detail) continue;
    const scored = scoreCommitData({ subject: detail.subject, files: detail.files, meta: importance, myOwners: [], recentFps, craftXpToday: xp });
    recentFps.unshift(scored.fp); if (recentFps.length > 40) recentFps.pop();
    xp += scored.xp; lines += scored.lines;
  }
  return { commits: Math.max(uniqueShas.length, opts?.commitCount ?? 0), lines, xp, stars: meta.stars, oss: meta.oss };
};

// Score (login)'s contribution to (owner/repo). Returns null if there's nothing creditable.
export const scoreRepoForLogin = async (
  owner: string, repo: string, login: string,
  opts?: { token?: string; sample?: number; importance?: RepoImportance | null },
): Promise<RepoScore | null> => {
  const token = opts?.token ?? process.env.GITHUB_TOKEN;
  const sample = Math.max(1, Math.min(30, opts?.sample ?? 20));
  const meta = opts?.importance !== undefined ? opts.importance : await fetchRepoImportance(owner, repo, token);
  // List up to 100 author commits in ONE core-API call → commit-count floor; score only the
  // first `sample` of them (each = one more core call). No Search-API call at all.
  const allShas = await fetchAuthorShas(owner, repo, login, 100, token);
  if (allShas.length === 0) return null;
  return scoreRepoShas(owner, repo, allShas, { token, sample, importance: meta, commitCount: allShas.length });
};
