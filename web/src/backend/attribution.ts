// Attribution discovery for commits where an identity is credited via Co-Authored-By (or another
// commit-search query). GitHub exposes at most 1,000 search results, so callers persist returned
// SHAs to make repeated and overlapping scans idempotent.

const GH = "https://api.github.com";
const ACCEPT = "application/vnd.github.cloak-preview+json";   // commit search preview accept type

const headersFor = (token?: string): Record<string, string> => ({
  accept: ACCEPT, "user-agent": "renown",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

// Fetch up to `max` attributed SHAs (most-recent first) across paged search results.
export const fetchAttributionShas = async (query: string, max = 30, token = process.env.GITHUB_TOKEN): Promise<string[]> => {
  if (!query || max <= 0) return [];
  const capped = Math.min(1000, max);
  const shas: string[] = [];
  for (let page = 1; page <= Math.ceil(capped / 100); page++) {
    const perPage = Math.min(100, capped - shas.length);
    try {
      const r = await fetch(`${GH}/search/commits?q=${encodeURIComponent(query)}&sort=committer-date&order=desc&per_page=${perPage}&page=${page}`, {
        headers: headersFor(token), signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) break;
      const j = (await r.json()) as { items?: { sha?: string }[] };
      const items = j.items ?? [];
      for (const item of items) if (item.sha && !shas.includes(item.sha)) shas.push(item.sha);
      if (items.length < perPage) break;
    } catch { break; }
  }
  return shas.slice(0, capped);
};

// Repository discovery for identities credited through commit-search queries (especially AI
// co-author trailers). GitHub caps commit search at 1,000 results; paging the most recent window
// gives us an honest, monotonic floor and is enough to keep active agent repos discoverable.
export const fetchAttributedRepositories = async (query: string, max = 500, token = process.env.GITHUB_TOKEN) => {
  if (!query || max <= 0) return [] as { key: string; shas: string[] }[];
  const capped = Math.min(1000, max);
  const byRepo = new Map<string, string[]>();
  for (let page = 1; page <= Math.ceil(capped / 100); page++) {
    try {
      const perPage = Math.min(100, capped - (page - 1) * 100);
      const response = await fetch(`${GH}/search/commits?q=${encodeURIComponent(query)}&sort=committer-date&order=desc&per_page=${perPage}&page=${page}`, {
        headers: headersFor(token), signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) break;
      const json = (await response.json()) as { items?: { sha?: string; repository?: { full_name?: string } }[] };
      const items = json.items ?? [];
      for (const item of items) {
        const key = item.repository?.full_name, sha = item.sha;
        if (!key || !sha || !key.includes("/")) continue;
        const shas = byRepo.get(key) ?? [];
        if (!shas.includes(sha)) shas.push(sha);
        byRepo.set(key, shas);
      }
      if (items.length < perPage) break;
    } catch { break; }
  }
  return [...byRepo.entries()].map(([key, shas]) => ({ key, shas })).sort((a, b) => b.shas.length - a.shas.length || a.key.localeCompare(b.key));
};
