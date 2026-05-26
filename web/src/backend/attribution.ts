// Windowed-incremental attribution credit. Counts commits where the user is credited via
// `Co-Authored-By:` (or any commit-search query) *only* in the window since their last sync —
// so a resync never double-counts, and a long absence backfills. attribution_score never
// decreases; verified_score = base_recompute + attribution_score.
//
// GitHub commit search returns up to 1000 paged results but `total_count` is the true count, so
// one API call per sync is enough to know the delta. A soft cap prevents abuse from contrived
// queries.

const GH = "https://api.github.com";
const ACCEPT = "application/vnd.github.cloak-preview+json";   // commit search preview accept type
const SOFT_CAP_PER_SYNC = 100_000;

const headersFor = (token?: string): Record<string, string> => ({
  accept: ACCEPT, "user-agent": "renown",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

// `since` is inclusive on the committer date (UTC day boundary).
export const searchAttributions = async (query: string, since: Date, token = process.env.GITHUB_TOKEN): Promise<number> => {
  if (!query) return 0;
  const day = since.toISOString().slice(0, 10);
  const q = `${query} committer-date:>=${day}`;
  try {
    const r = await fetch(`${GH}/search/commits?q=${encodeURIComponent(q)}&per_page=1`, {
      headers: headersFor(token),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return 0;
    const j = (await r.json()) as { total_count?: number };
    return Math.min(j.total_count ?? 0, SOFT_CAP_PER_SYNC);
  } catch { return 0; }
};

// Fetch up to `max` SHAs of attributed commits (most-recent first), to seed wild creatures
// (each SHA → a deterministic 1/1 via core/procgen.ts). Single API call (per_page max 100),
// returns just the SHAs we can use as procgen seeds.
export const fetchAttributionShas = async (query: string, since: Date, max = 30, token = process.env.GITHUB_TOKEN): Promise<string[]> => {
  if (!query || max <= 0) return [];
  const day = since.toISOString().slice(0, 10);
  const q = `${query} committer-date:>=${day}`;
  const per_page = Math.min(100, max);
  try {
    const r = await fetch(`${GH}/search/commits?q=${encodeURIComponent(q)}&sort=committer-date&order=desc&per_page=${per_page}`, {
      headers: headersFor(token),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { items?: { sha?: string; repository?: { full_name?: string } }[] };
    return (j.items ?? []).map((it) => it.sha ?? "").filter(Boolean).slice(0, max);
  } catch { return []; }
};
