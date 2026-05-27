// Commit substance classifier — the "is this commit real work?" half of merit.
// Counts a player's recent attributed commits, classifies each by semantic
// substance (0..1), and writes the mean back to players.substance_score. Mean
// + sample-size go into the merit_score roll-up via merit.ts.
//
// Two classifiers ship in the same module:
//   1. classifyCommitHeuristic — keyword/conventional-commits pattern matcher.
//      Pure, fast, deterministic, no external deps. Default.
//   2. classifyCommitRAG       — uses @absolutejs/rag's embedding provider to
//      compute cosine similarity to a hand-labeled reference set. Higher
//      quality on ambiguous cases (creative commit messages, non-English) but
//      requires an API key + embedding model. Opt-in via env:
//        RENOWN_EMBEDDING_PROVIDER  = "openai" | "gemini" | "ollama" | ...
//        RENOWN_EMBEDDING_API_KEY   = the provider's key
//        RENOWN_EMBEDDING_MODEL     = "text-embedding-3-small" (or your default)
//
// classifyCommit picks whichever is configured. RAG failures fall back to
// heuristic so the substance pipeline never blocks merit on a flaky embedding
// API.
//
// Storage policy: no per-commit table in v1. We store only the aggregate
// (players.substance_score + .substance_sample_size). Re-classifying the same
// SHA later is cheap (one keyword pass) so caching wasn't worth the schema
// overhead. If RAG becomes the default and embedding costs become an issue,
// add a (player_id, sha) → score table here and key the cache off it.

const GH = "https://api.github.com";

// ---------------------------------------------------------------------------
// Reference labels for the heuristic — ordered by specificity (first match wins).
// Patterns match against the commit's *subject* line (first line of message).
// Scores are calibrated against the team's intuition: a typo fix is ~5%, a
// breaking feature is ~90%. Numbers can be tuned freely; the roll-up averages
// them anyway so absolute calibration matters less than relative ordering.
type RefLabel = { pattern: RegExp; score: number; reason: string };

// Pass 1 — conventional-commit prefixes. Match on the SUBJECT line only
// (matching the full body produces false positives from incidental keywords
// like "formatting" appearing in a feature commit's body explanation).
// Highest-confidence patterns first; first match wins.
const CONVENTIONAL_PREFIX_LABELS: RefLabel[] = [
  { pattern: /^(\w+)?!:|BREAKING\s+CHANGE/i,                                       score: 0.90, reason: "breaking change" },
  { pattern: /^(feat|feature)(\([^)]+\))?:/i,                                      score: 0.75, reason: "feature" },
  { pattern: /^(perf|performance)(\([^)]+\))?:/i,                                  score: 0.70, reason: "perf" },
  { pattern: /^(fix|bugfix|hotfix)(\([^)]+\))?:/i,                                 score: 0.65, reason: "bug fix" },
  { pattern: /^(refactor|cleanup)(\([^)]+\))?:/i,                                  score: 0.50, reason: "refactor" },
  { pattern: /^(test|tests|spec)(\([^)]+\))?:/i,                                   score: 0.45, reason: "tests" },
  { pattern: /^style(\([^)]+\))?:/i,                                                score: 0.30, reason: "style" },
  { pattern: /^(docs?|documentation)(\([^)]+\))?:/i,                               score: 0.20, reason: "documentation" },
  { pattern: /^(ci)(\([^)]+\))?:/i,                                                 score: 0.25, reason: "ci" },
  { pattern: /^(build)(\([^)]+\))?:\s*(bump|update|upgrade)/i,                     score: 0.10, reason: "build: dep update" },
  { pattern: /^(build)(\([^)]+\))?:/i,                                              score: 0.30, reason: "build" },
  { pattern: /^(chore)(\([^)]+\))?:\s*(bump|update|upgrade|format|prettier|lint)/i, score: 0.10, reason: "chore: maintenance" },
  { pattern: /^(chore)(\([^)]+\))?:/i,                                              score: 0.25, reason: "chore" },
  { pattern: /^revert\s+/i,                                                          score: 0.30, reason: "revert" },
  { pattern: /^merge\s+(branch|pull request|remote-tracking)/i,                     score: 0.15, reason: "merge commit" },
];

// Pass 2 — keyword-only patterns. Subject-only. Triggered when no
// conventional prefix matched. These look for hints in plain-English subjects
// ("Fix typo in README", "Bump dependencies").
const KEYWORD_LABELS: RefLabel[] = [
  { pattern: /\btypo\b|spelling\s+(fix|correction)/i,                              score: 0.05, reason: "typo fix" },
  { pattern: /^bump\s|version\s+bump|^update\s+(version|deps|dependenc)/i,         score: 0.05, reason: "version/deps bump" },
  { pattern: /^(prettier|format|formatting|lint)\b/i,                              score: 0.10, reason: "formatting" },
  { pattern: /\b(renovate|dependabot)\b/i,                                          score: 0.10, reason: "automated dep bot" },
  { pattern: /^(README|changelog)/i,                                                score: 0.20, reason: "documentation" },
  { pattern: /^(perf|optimi[sz]e|speed\s*up)/i,                                    score: 0.65, reason: "perf" },
  { pattern: /^(fix|resolve|close)\s|resolves?\s+#|closes?\s+#/i,                  score: 0.60, reason: "bug fix" },
  { pattern: /^(add|implement|introduce)\s|new\s+(feature|module|page|endpoint)/i, score: 0.65, reason: "feature add" },
  { pattern: /^(remove|delete|drop)\s/i,                                            score: 0.45, reason: "removal" },
];

// Heuristic classifier — no embeddings, runs anywhere. Churn (lines changed)
// nudges the score: tiny diffs of any kind get a small penalty (the commit
// message might be aspirational), large diffs of any kind get a small boost.
export const classifyCommitHeuristic = (
  message: string,
  additions: number,
  deletions: number,
): { score: number; reason: string } => {
  const subject = (message ?? "").split("\n")[0] ?? "";
  const churn = (additions ?? 0) + (deletions ?? 0);
  const churnFactor = churn === 0 ? 0.5 : churn < 3 ? 0.75 : churn > 200 ? 1.15 : 1;
  for (const ref of CONVENTIONAL_PREFIX_LABELS) {
    if (ref.pattern.test(subject)) {
      return { score: Math.max(0, Math.min(1, ref.score * churnFactor)), reason: ref.reason };
    }
  }
  for (const ref of KEYWORD_LABELS) {
    if (ref.pattern.test(subject)) {
      return { score: Math.max(0, Math.min(1, ref.score * churnFactor)), reason: ref.reason };
    }
  }
  // No subject match — score by churn alone.
  if (churn === 0) return { score: 0.05, reason: "empty diff" };
  if (churn < 5)   return { score: 0.25, reason: "tiny unclassified" };
  if (churn < 50)  return { score: 0.45, reason: "small unclassified" };
  if (churn < 300) return { score: 0.55, reason: "medium unclassified" };
  return { score: 0.65, reason: "large unclassified" };
};

// ---------------------------------------------------------------------------
// RAG classifier — wraps @absolutejs/rag's embedding provider. Reference set
// is the same labels above but expressed as exemplar messages; we cache the
// embedded references for the lifetime of the process so each commit only
// pays one embedding call.
type Vector = number[];
type Reference = { exemplar: string; score: number; reason: string };
// Hand-curated reference set spanning the substance ladder. Multiple exemplars
// per score bucket so cosine-K-NN has more anchor points and is less brittle to
// any single exemplar's phrasing. Scores are calibrated against developer
// intuition: typo ~5%, breaking change ~90%. Each exemplar carries the same
// `reason` string the heuristic classifier returns, so explanation strings stay
// stable across the two classifiers.
const REFERENCES: Reference[] = [
  // ── 0.05 bucket: deps bumps, typo fixes, version bumps ─────────────────
  { exemplar: "chore: bump @types/node to 20.10.0",                                       score: 0.05, reason: "version/deps bump" },
  { exemplar: "bump react from 18.2 to 18.3",                                              score: 0.05, reason: "version/deps bump" },
  { exemplar: "Bump @typescript-eslint/parser from 6.7 to 6.8",                            score: 0.05, reason: "version/deps bump" },
  { exemplar: "Update version to 1.2.4",                                                   score: 0.05, reason: "version/deps bump" },
  { exemplar: "Fix typo in README contributor guide",                                      score: 0.05, reason: "typo fix" },
  { exemplar: "fix: typo (their → there) in onboarding email",                             score: 0.05, reason: "typo fix" },
  { exemplar: "Correct misspelling in JSDoc",                                              score: 0.05, reason: "typo fix" },

  // ── 0.10 bucket: formatting, dependency bots, build-tooling tweaks ─────
  { exemplar: "chore: format files with prettier",                                         score: 0.10, reason: "formatting" },
  { exemplar: "style: run prettier on src/",                                                score: 0.10, reason: "formatting" },
  { exemplar: "chore(lint): apply biome auto-fixes",                                       score: 0.10, reason: "formatting" },
  { exemplar: "Bump dependencies to latest minor",                                          score: 0.10, reason: "deps update" },
  { exemplar: "build(deps-dev): bump @vitest/coverage-v8 from 1.1 to 1.2",                 score: 0.10, reason: "deps update" },
  { exemplar: "Update package-lock.json after npm audit fix",                              score: 0.10, reason: "deps update" },
  { exemplar: "chore: rename .eslintrc.cjs to eslint.config.js",                           score: 0.10, reason: "build config tweak" },

  // ── 0.15-0.20 bucket: merges, docs ─────────────────────────────────────
  { exemplar: "Merge pull request #1234 from foo/bar",                                     score: 0.15, reason: "merge commit" },
  { exemplar: "Merge branch 'main' into feature/cache-layer",                              score: 0.15, reason: "merge commit" },
  { exemplar: "Merge remote-tracking branch 'origin/main' into HEAD",                      score: 0.15, reason: "merge commit" },
  { exemplar: "docs(api): document the new /events endpoint",                              score: 0.20, reason: "documentation" },
  { exemplar: "docs: explain how to configure rate limits",                                score: 0.20, reason: "documentation" },
  { exemplar: "README: add quickstart section + screenshot",                               score: 0.20, reason: "documentation" },
  { exemplar: "changelog: 1.4.0 — new aggregation API + bug fixes",                        score: 0.20, reason: "documentation" },
  { exemplar: "docs(contributing): clarify commit message convention",                     score: 0.20, reason: "documentation" },

  // ── 0.25-0.30 bucket: CI tweaks, chore: maintenance, reverts ───────────
  { exemplar: "ci: cache pnpm store between jobs",                                         score: 0.25, reason: "ci" },
  { exemplar: "ci(release): publish on tag push instead of merge",                         score: 0.25, reason: "ci" },
  { exemplar: "chore: rotate API keys after credentials leak",                             score: 0.30, reason: "chore: maintenance" },
  { exemplar: "Revert \"feat: add experimental cache layer\"",                             score: 0.30, reason: "revert" },
  { exemplar: "Revert \"perf: parallelize image resize pipeline\"",                        score: 0.30, reason: "revert" },

  // ── 0.45-0.50 bucket: refactor, tests ──────────────────────────────────
  { exemplar: "refactor(scheduler): extract priority queue into its own module",           score: 0.50, reason: "refactor" },
  { exemplar: "refactor: replace switch with strategy object",                             score: 0.50, reason: "refactor" },
  { exemplar: "cleanup: drop deprecated v1 endpoints",                                      score: 0.50, reason: "refactor" },
  { exemplar: "refactor(db): use prepared statements throughout query layer",              score: 0.50, reason: "refactor" },
  { exemplar: "test(auth): cover token-refresh edge cases",                                score: 0.45, reason: "tests" },
  { exemplar: "test: add property-based tests for rate-limiter",                           score: 0.45, reason: "tests" },
  { exemplar: "tests: increase coverage on session expiry paths to 95%",                   score: 0.45, reason: "tests" },

  // ── 0.65 bucket: bug fixes ─────────────────────────────────────────────
  { exemplar: "fix(billing): retry idempotently on 5xx from Stripe",                       score: 0.65, reason: "bug fix" },
  { exemplar: "fix: race condition on concurrent session-refresh",                         score: 0.65, reason: "bug fix" },
  { exemplar: "fix(query-cache): invalidate stale entries on schema migration",            score: 0.65, reason: "bug fix" },
  { exemplar: "bugfix: handle empty result set in pagination cursor",                      score: 0.65, reason: "bug fix" },
  { exemplar: "fix: prevent infinite loop when retry-after header is malformed",           score: 0.65, reason: "bug fix" },
  { exemplar: "hotfix: 5xx on /api/v2/users after schema change (resolves #4421)",         score: 0.65, reason: "bug fix" },

  // ── 0.70 bucket: perf ──────────────────────────────────────────────────
  { exemplar: "perf(parser): O(n²) → O(n log n) on large inputs",                          score: 0.70, reason: "perf" },
  { exemplar: "perf: cache compiled regex; 35% faster on validation hot path",             score: 0.70, reason: "perf" },
  { exemplar: "optimize: batch jsonb_set updates; reduces lock contention by 8x",          score: 0.70, reason: "perf" },
  { exemplar: "perf(stream): switch to backpressure-aware writer (40% less RSS)",          score: 0.70, reason: "perf" },

  // ── 0.75 bucket: features ──────────────────────────────────────────────
  { exemplar: "feat(streaming): add backpressure support to the writer",                   score: 0.75, reason: "feature" },
  { exemplar: "feat: implement WebAuthn passkey login",                                    score: 0.75, reason: "feature" },
  { exemplar: "feat(api): add /export endpoint with progressive JSON streaming",           score: 0.75, reason: "feature" },
  { exemplar: "feat(billing): SCA-compliant 3DS challenge flow",                           score: 0.75, reason: "feature" },
  { exemplar: "feat: introduce new aggregation primitive (rolling window)",                score: 0.75, reason: "feature" },
  { exemplar: "Add support for OIDC discovery + dynamic client registration",              score: 0.75, reason: "feature" },

  // ── 0.90 bucket: breaking changes / major releases ─────────────────────
  { exemplar: "feat!: drop Node 16 support; default to native fetch (BREAKING CHANGE)",    score: 0.90, reason: "breaking change" },
  { exemplar: "BREAKING CHANGE: rename `subscribe()` → `attach()` to match RxJS semantics", score: 0.90, reason: "breaking change" },
  { exemplar: "v2.0.0 — new plugin system; deprecates the v1 hooks API",                    score: 0.90, reason: "breaking change" },
  { exemplar: "feat(api)!: switch default response shape from snake_case to camelCase",    score: 0.90, reason: "breaking change" },
];

// Cosine similarity for two equal-length vectors. The embedding provider always
// returns same-dim vectors so length-check is for sanity only.
const cosine = (a: Vector, b: Vector): number => {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

// Lazy provider + reference-embedding cache. Returned function is null when
// the embedding provider can't be loaded or configured — caller falls back to
// heuristic.
type ClassifyFn = (message: string) => Promise<{ score: number; reason: string }>;
let ragClassifierPromise: Promise<ClassifyFn | null> | null = null;

const loadRagClassifier = async (): Promise<ClassifyFn | null> => {
  const providerKind = process.env.RENOWN_EMBEDDING_PROVIDER;
  const apiKey = process.env.RENOWN_EMBEDDING_API_KEY;
  const model = process.env.RENOWN_EMBEDDING_MODEL;
  if (!providerKind || !apiKey) return null;
  try {
    // Dynamic import keeps @absolutejs/rag an OPTIONAL dependency — runtime
    // only loads it when an embedding provider is actually configured. If rag
    // isn't installed, the import throws and we fall back to heuristic.
    const rag = await import("@absolutejs/rag" as string) as {
      openaiEmbeddings?: (c: { apiKey: string; defaultModel?: string; dimensions?: number }) => { embed: (i: { text: string; model?: string; signal?: AbortSignal }) => Promise<{ embedding: number[] }> };
      geminiEmbeddings?: (c: { apiKey: string; defaultModel?: string }) => { embed: (i: { text: string; model?: string; signal?: AbortSignal }) => Promise<{ embedding: number[] }> };
      ollamaEmbeddings?: (c: { baseUrl?: string; defaultModel?: string }) => { embed: (i: { text: string; model?: string; signal?: AbortSignal }) => Promise<{ embedding: number[] }> };
    };
    const provider = providerKind === "openai" && rag.openaiEmbeddings
      ? rag.openaiEmbeddings({ apiKey, defaultModel: model ?? "text-embedding-3-small" })
      : providerKind === "gemini" && rag.geminiEmbeddings
      ? rag.geminiEmbeddings({ apiKey, defaultModel: model ?? "text-embedding-004" })
      : providerKind === "ollama" && rag.ollamaEmbeddings
      ? rag.ollamaEmbeddings({ defaultModel: model ?? "nomic-embed-text" })
      : null;
    if (!provider) return null;
    // Embed the reference set once. If even this fails, give up and let the
    // heuristic carry the load.
    const refEmbeddings: { ref: Reference; vec: Vector }[] = [];
    for (const ref of REFERENCES) {
      const out = await provider.embed({ text: ref.exemplar });
      refEmbeddings.push({ ref, vec: out.embedding });
    }
    // Return a closure that embeds the message and finds K-NN by cosine sim.
    return async (message: string) => {
      const subject = (message ?? "").split("\n")[0]?.slice(0, 400) ?? "";
      if (!subject) return { score: 0.1, reason: "empty message" };
      try {
        const out = await provider.embed({ text: subject, signal: AbortSignal.timeout(10_000) });
        const ranked = refEmbeddings
          .map(({ ref, vec }) => ({ ref, sim: cosine(out.embedding, vec) }))
          .sort((a, b) => b.sim - a.sim)
          .slice(0, 3);
        // Weighted mean of the top-3 by similarity. The "reason" comes from
        // the single nearest reference so the rationale stays explainable.
        const weights = ranked.map((r) => Math.max(0, r.sim));
        const wsum = weights.reduce((s, w) => s + w, 0);
        if (wsum === 0) return { score: 0.5, reason: "no semantic match" };
        const score = ranked.reduce((s, r, i) => s + r.ref.score * weights[i]!, 0) / wsum;
        return { score, reason: ranked[0]!.ref.reason };
      } catch {
        // Embed failure on a single message — defer to heuristic, don't break the batch.
        return classifyCommitHeuristic(message, 0, 0);
      }
    };
  } catch {
    return null;
  }
};

// Public classifier — picks RAG when available, heuristic otherwise.
export const classifyCommit = async (
  message: string,
  additions: number,
  deletions: number,
): Promise<{ score: number; reason: string }> => {
  if (!ragClassifierPromise) ragClassifierPromise = loadRagClassifier();
  const rag = await ragClassifierPromise;
  if (rag) return rag(message);
  return classifyCommitHeuristic(message, additions, deletions);
};

// ---------------------------------------------------------------------------
// Commit fetching — uses GitHub commit-search to get N recent SHAs that
// match the player's attribution query, then per-SHA fetches for stats.
// Returns rich rows (sha, repo, message, additions, deletions) ready to
// classify. Soft-capped; per-call budget defaults to 30 commits.
const ghHeaders = (token?: string): Record<string, string> => ({
  accept: "application/vnd.github.cloak-preview+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "renown",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

export type FetchedCommit = { sha: string; repo: string; message: string; additions: number; deletions: number };

export const fetchRecentCommits = async (
  attributionQuery: string,
  max = 30,
  token = process.env.GITHUB_TOKEN,
): Promise<FetchedCommit[]> => {
  if (!attributionQuery || max <= 0) return [];
  const per_page = Math.min(100, max);
  try {
    const searchR = await fetch(`${GH}/search/commits?q=${encodeURIComponent(attributionQuery)}&sort=committer-date&order=desc&per_page=${per_page}`, {
      headers: ghHeaders(token), signal: AbortSignal.timeout(15_000),
    });
    if (!searchR.ok) return [];
    type SearchItem = { sha?: string; commit?: { message?: string }; repository?: { full_name?: string } };
    const searchJ = (await searchR.json()) as { items?: SearchItem[] };
    const items = (searchJ.items ?? []).slice(0, max);
    // Per-SHA fetch for stats (additions/deletions aren't in the search result).
    // Concurrency-limited: 5 in flight so we don't burn rate-limit budget too
    // fast. Failed individual fetches are dropped (rather than fabricated).
    const results: FetchedCommit[] = [];
    const queue = items.slice();
    const worker = async () => {
      while (queue.length > 0) {
        const it = queue.shift();
        if (!it?.sha || !it.repository?.full_name) continue;
        try {
          const r = await fetch(`${GH}/repos/${it.repository.full_name}/commits/${it.sha}`, {
            headers: ghHeaders(token), signal: AbortSignal.timeout(15_000),
          });
          if (!r.ok) continue;
          const j = (await r.json()) as { stats?: { additions?: number; deletions?: number }; commit?: { message?: string } };
          results.push({
            sha: it.sha,
            repo: it.repository.full_name,
            message: j.commit?.message ?? it.commit?.message ?? "",
            additions: j.stats?.additions ?? 0,
            deletions: j.stats?.deletions ?? 0,
          });
        } catch { /* drop */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);
    return results;
  } catch { return []; }
};

// ---------------------------------------------------------------------------
// Aggregator — classify a batch, return mean substance + sample size + per-
// commit detail. Caller writes the aggregate back to the player row.
export const aggregateSubstance = async (
  commits: FetchedCommit[],
): Promise<{ mean: number; sampleSize: number; detail: (FetchedCommit & { score: number; reason: string })[] }> => {
  const detail: (FetchedCommit & { score: number; reason: string })[] = [];
  for (const c of commits) {
    const { score, reason } = await classifyCommit(c.message, c.additions, c.deletions);
    detail.push({ ...c, score, reason });
  }
  const sampleSize = detail.length;
  const mean = sampleSize === 0 ? 0 : detail.reduce((s, d) => s + d.score, 0) / sampleSize;
  return { mean, sampleSize, detail };
};
