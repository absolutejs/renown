// Merit signals — the "real, meritorious dev work" half of renown's pitch. Each
// signal is observably hard to game (someone outside your control had to invite
// the review, accept the PR, install the package). All fetchers are single-call,
// soft-capped, error-safe. None throw — failure returns the last known value 0.
//
// Roll-up policy: merit_score = sum of normalized sub-scores * weight, then floor.
// Weighting is deliberate: cross-repo PRs > reviews given > package downloads >
// merge ratio > substance, because cross-repo PRs are the strongest "real OSS
// contribution" signal (a maintainer who doesn't owe you anything approved your
// work) and substance is the noisiest (depends on classifier quality).
//
// Adding a new merit dimension = drop a MeritDef in MERIT + add a fetcher here +
// a column on the players row + a clause in computeMeritScore. The achievement
// ladder rows derive automatically.

const GH = "https://api.github.com";
const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads";
const SOFT_CAP = 100_000;

const ghHeaders = (token?: string): Record<string, string> => ({
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "renown",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

// --- Signal 1: PR reviews given ---------------------------------------------
// `/search/issues?q=reviewed-by:LOGIN+type:pr` returns total_count of PRs where
// you appear in the reviewers list. Hard to fake at volume — you have to actually
// be added as a reviewer (or self-review, which most repos forbid).
export const fetchPrReviewsCount = async (login: string, token = process.env.GITHUB_TOKEN): Promise<number> => {
  if (!login) return 0;
  const q = `reviewed-by:${login} type:pr`;
  try {
    const r = await fetch(`${GH}/search/issues?q=${encodeURIComponent(q)}&per_page=1`, {
      headers: ghHeaders(token), signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return 0;
    const j = (await r.json()) as { total_count?: number };
    return Math.min(j.total_count ?? 0, SOFT_CAP);
  } catch { return 0; }
};

// --- Signal 2: Cross-repo merged PRs ----------------------------------------
// `author:LOGIN type:pr is:merged -user:LOGIN` excludes PRs in your own user
// namespace. This is the bedrock OSS signal: "someone else's repo accepted my
// patch." Note: -user:LOGIN only excludes the LOGIN user-namespace, not orgs
// you happen to belong to — fine, "contributed to my employer's monorepo" is
// still a valid signal.
export const fetchCrossRepoPrsCount = async (login: string, token = process.env.GITHUB_TOKEN): Promise<number> => {
  if (!login) return 0;
  const q = `author:${login} type:pr is:merged -user:${login}`;
  try {
    const r = await fetch(`${GH}/search/issues?q=${encodeURIComponent(q)}&per_page=1`, {
      headers: ghHeaders(token), signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return 0;
    const j = (await r.json()) as { total_count?: number };
    return Math.min(j.total_count ?? 0, SOFT_CAP);
  } catch { return 0; }
};

// --- Signal 3: PR authored/merged counts (for merge ratio) ------------------
// Two calls. Merge ratio = merged/authored, reported in the response for the
// frontend to show; the achievement ladder uses merged count, with the ratio
// as a quality multiplier on the score contribution (low ratio = spammy).
export const fetchPrCounts = async (login: string, token = process.env.GITHUB_TOKEN): Promise<{ authored: number; merged: number }> => {
  if (!login) return { authored: 0, merged: 0 };
  const authoredQ = `author:${login} type:pr`;
  const mergedQ = `author:${login} type:pr is:merged`;
  try {
    const [authoredR, mergedR] = await Promise.all([
      fetch(`${GH}/search/issues?q=${encodeURIComponent(authoredQ)}&per_page=1`, { headers: ghHeaders(token), signal: AbortSignal.timeout(15_000) }),
      fetch(`${GH}/search/issues?q=${encodeURIComponent(mergedQ)}&per_page=1`, { headers: ghHeaders(token), signal: AbortSignal.timeout(15_000) }),
    ]);
    const authoredJ = authoredR.ok ? (await authoredR.json()) as { total_count?: number } : { total_count: 0 };
    const mergedJ = mergedR.ok ? (await mergedR.json()) as { total_count?: number } : { total_count: 0 };
    return {
      authored: Math.min(authoredJ.total_count ?? 0, SOFT_CAP),
      merged: Math.min(mergedJ.total_count ?? 0, SOFT_CAP),
    };
  } catch { return { authored: 0, merged: 0 }; }
};

// --- Signal 4: Package downloads (npm) --------------------------------------
// npm registry search-by-maintainer → list of packages → bulk downloads
// endpoint (up to 128 packages per call). Returns sum of last-month downloads
// across every package the user maintains. PyPI/crates.io are skipped in v1
// but slot in here when added (sum across all registries).
export const fetchPackageDownloads = async (login: string): Promise<number> => {
  if (!login) return 0;
  try {
    // search for packages where this login is a maintainer; npmjs search caps
    // at 250/page so for the rare prolific maintainer we'd page, but v1 caps
    // at one page (the bulk-downloads endpoint also caps at 128 packages).
    const searchR = await fetch(`${NPM_REGISTRY}/-/v1/search?text=maintainer:${encodeURIComponent(login)}&size=100`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!searchR.ok) return 0;
    const searchJ = (await searchR.json()) as { objects?: { package?: { name?: string } }[] };
    const names = (searchJ.objects ?? [])
      .map((o) => o.package?.name)
      .filter((n): n is string => !!n)
      .slice(0, 100); // bulk endpoint cap is 128 — leave headroom
    if (names.length === 0) return 0;
    // npm's bulk endpoint rejects scoped packages ("@org/name"), so split + handle
    // separately: unscoped get one bulk call, scoped get per-package calls in
    // parallel (cheap; capped at 100 by the search above so worst case is ~100
    // tiny GETs to api.npmjs.org).
    const scoped = names.filter((n) => n.startsWith("@"));
    const unscoped = names.filter((n) => !n.startsWith("@"));
    let total = 0;
    if (unscoped.length > 0) {
      const bulkR = await fetch(`${NPM_DOWNLOADS}/point/last-month/${unscoped.join(",")}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (bulkR.ok) {
        const bulkJ = (await bulkR.json()) as Record<string, { downloads?: number } | null>;
        for (const v of Object.values(bulkJ)) if (v && typeof v.downloads === "number") total += v.downloads;
      }
    }
    if (scoped.length > 0) {
      const results = await Promise.all(scoped.map(async (n) => {
        try {
          const r = await fetch(`${NPM_DOWNLOADS}/point/last-month/${n}`, { signal: AbortSignal.timeout(10_000) });
          if (!r.ok) return 0;
          const j = (await r.json()) as { downloads?: number };
          return typeof j.downloads === "number" ? j.downloads : 0;
        } catch { return 0; }
      }));
      for (const v of results) total += v;
    }
    return Math.min(total, Number.MAX_SAFE_INTEGER);
  } catch { return 0; }
};

// --- Merit ladder registry --------------------------------------------------
// Each ladder is "tier name → threshold". The score that grants a tier is
// whichever per-dimension counter is its source.
export type MeritDef = {
  id: string;             // stable id, used in achievement_id
  label: string;          // human label ("Reviewer")
  flavor: string;         // one-line panel description
  // Source column on players row. Used by computeMeritScore + by the cron
  // sync to decide which tier achievements to grant. real-valued for substance.
  source: "prReviewsCount" | "crossRepoPrsCount" | "prsMergedCount" | "packageDownloads" | "substanceScore";
  // 5 thresholds, lowest first; tier IV is the achievement at thresholds[3]
  // (we keep it as 5 so substance can have finer tier resolution without a
  // separate ladder model).
  thresholds: [number, number, number, number, number];
  // Per-tier celebration text on unlock. Index = tier - 1.
  celebrate: [string, string, string, string, string];
};

export const MERIT: Record<string, MeritDef> = {
  reviewer: {
    id: "reviewer",
    label: "Reviewer",
    flavor: "PRs you reviewed for other people.",
    source: "prReviewsCount",
    thresholds: [1, 10, 100, 1000, 10000],
    celebrate: [
      "Reviewed a PR. Welcome to the carriage that pulls open source.",
      "10 reviews. You've started doing the unglamorous work that makes maintainers cry tears of joy.",
      "100 reviews. People are tagging you because they trust your eyes.",
      "1,000 reviews. You are, statistically, the most patient person in your network.",
      "10,000 reviews. You should probably be charging for this.",
    ],
  },
  contributor: {
    id: "contributor",
    label: "Contributor",
    flavor: "Merged PRs in repos you don't own. The real OSS signal.",
    source: "crossRepoPrsCount",
    thresholds: [1, 10, 50, 250, 1000],
    celebrate: [
      "Someone else's repo merged your patch. This is the moment.",
      "10 cross-repo merges. You are no longer a tourist.",
      "50 cross-repo merges. Maintainers know your handle.",
      "250 cross-repo merges. Several projects' commit graphs would notice if you stopped.",
      "1,000 cross-repo merges. You are the kind of contributor README files thank.",
    ],
  },
  shipper: {
    id: "shipper",
    label: "Shipper",
    flavor: "PRs you opened and landed. Counts merged.",
    source: "prsMergedCount",
    thresholds: [1, 25, 250, 2500, 10000],
    celebrate: [
      "First PR merged. The world is now slightly different because of you.",
      "25 PRs merged. You ship.",
      "250 PRs merged. You are someone's senior engineer.",
      "2,500 PRs merged. You are listed in three retrospectives by name.",
      "10,000 PRs merged. The git history has a Wikipedia page about you.",
    ],
  },
  maintainer: {
    id: "maintainer",
    label: "Maintainer",
    flavor: "Total monthly downloads across npm packages you maintain.",
    source: "packageDownloads",
    thresholds: [100, 1000, 10000, 100000, 1000000],
    celebrate: [
      "100 downloads. Someone installed your code on purpose.",
      "1,000 downloads. A small team depends on you.",
      "10,000 downloads. Many small teams depend on you.",
      "100,000 downloads. You are part of the supply chain.",
      "1,000,000 downloads. You are the supply chain.",
    ],
  },
  substance: {
    id: "substance",
    label: "Substance",
    flavor: "Mean substance weight of your commits (RAG-classified).",
    source: "substanceScore",
    // substance_score is 0..1, so thresholds are real — but the achievement
    // catalog stores them as integers (×100) for consistency with the others.
    thresholds: [30, 50, 65, 80, 90],
    celebrate: [
      "Your commits are real. (substance ≥ 0.30 over enough samples to count.)",
      "Average commit substance ≥ 0.50. You're shipping meaningful work most days.",
      "Average commit substance ≥ 0.65. Few of your commits are typo fixes or version bumps.",
      "Average commit substance ≥ 0.80. Nearly every commit you make moves something.",
      "Average commit substance ≥ 0.90. Either you're a perfectionist or you squash like a Roman emperor.",
    ],
  },
};

// Catalog rows derived from MERIT — one row per tier per merit dimension. Same
// shape the quirks migration uses, for consistency with the existing seeder.
export const meritAchievementRows = (): {
  id: string; name: string; description: string; category: string; tier: string;
}[] => {
  const out: { id: string; name: string; description: string; category: string; tier: string }[] = [];
  const tierNames = ["I", "II", "III", "IV", "V"];
  for (const def of Object.values(MERIT)) {
    for (let i = 0; i < 5; i++) {
      out.push({
        id: `merit-${def.id}-${i + 1}`,
        name: `${def.label} ${tierNames[i]}`,
        description: def.celebrate[i] ?? def.flavor,
        category: "merit",
        tier: tierNames[i]!,
      });
    }
  }
  return out;
};

// --- Roll-up scorer ---------------------------------------------------------
// Returns the integer merit_score that gets summed into verified_score. Each
// signal is normalized into a roughly 0-10000 range and weighted:
//   reviews: 1pt per review (linear, since each is bounded work)
//   cross-repo PRs: 5pt per PR (premium signal)
//   shipped PRs: 0.5pt per merged PR (anyone can ship enough but lots is real)
//   downloads: log10(downloads + 1) * 500 (compresses huge numbers; 1M DL = 3000pt)
//   substance: substance_score * substanceSampleSize / 10 (needs sample size to matter)
// Final formula intentionally favors quality over volume: a maintainer with 100
// reviews + 50 cross-repo PRs beats a copy-pasta committer with 50,000 commits.
export const computeMeritScore = (row: {
  prReviewsCount?: number;
  crossRepoPrsCount?: number;
  prsMergedCount?: number;
  prsAuthoredCount?: number;
  packageDownloads?: number;
  substanceScore?: number;
  substanceSampleSize?: number;
}): number => {
  const reviews = row.prReviewsCount ?? 0;
  const crossRepo = row.crossRepoPrsCount ?? 0;
  const merged = row.prsMergedCount ?? 0;
  const authored = row.prsAuthoredCount ?? 0;
  const dls = row.packageDownloads ?? 0;
  const subScore = row.substanceScore ?? 0;
  const subN = row.substanceSampleSize ?? 0;

  // Merge-ratio penalty: spammy PRs (low ratio) reduce shipper contribution.
  const mergeRatio = authored > 0 ? merged / authored : 1;
  const shipperPts = merged * 0.5 * Math.max(0.2, mergeRatio); // floor at 20%

  const reviewerPts = reviews * 1;
  const contributorPts = crossRepo * 5;
  const maintainerPts = Math.log10(dls + 1) * 500;
  const substancePts = subN >= 10 ? subScore * subN / 10 : 0; // need 10+ samples

  return Math.floor(reviewerPts + contributorPts + shipperPts + maintainerPts + substancePts);
};

// --- Determine which tier achievements to grant for a refreshed row ---------
// Returns the achievement ids the player has newly crossed. Caller upserts
// into player_achievements + bumps unlock_count on the catalog row.
export const meritAchievementsToGrant = (row: {
  prReviewsCount?: number;
  crossRepoPrsCount?: number;
  prsMergedCount?: number;
  packageDownloads?: number;
  substanceScore?: number;
  substanceSampleSize?: number;
}): string[] => {
  const out: string[] = [];
  const sources: Record<MeritDef["source"], number> = {
    prReviewsCount: row.prReviewsCount ?? 0,
    crossRepoPrsCount: row.crossRepoPrsCount ?? 0,
    prsMergedCount: row.prsMergedCount ?? 0,
    packageDownloads: row.packageDownloads ?? 0,
    // substance is 0..1, multiply by 100 so thresholds align with catalog ints;
    // also require ≥10 samples to grant any substance tier (avoids 1.0 from 1 sample).
    substanceScore: (row.substanceSampleSize ?? 0) >= 10 ? Math.floor((row.substanceScore ?? 0) * 100) : 0,
  };
  for (const def of Object.values(MERIT)) {
    const value = sources[def.source];
    for (let i = 0; i < 5; i++) {
      if (value >= def.thresholds[i]!) out.push(`merit-${def.id}-${i + 1}`);
    }
  }
  return out;
};
