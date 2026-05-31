// Server-verified skill XP — recomputes a player's per-skill XP from their real GitHub commits so
// the /top?skill board ranks GitHub-scored skill XP instead of self-reported players.skill_xp
// (see docs/trust-model.md). Reuses the EXACT routing the local engine uses: core/craftScore.ts
// scores each commit, then core/skills.ts `awardCraft` routes that into per-skill XP — so verified
// skill XP matches what the CLI would compute, just over commits the server fetched itself.
//
// A consistent recent-window SAMPLE (not all-time): everyone is sampled the same way, the server
// uses its own token, and nothing is taken from the client — so it can't be spoofed. Repo
// importance (oss/stars/external) is omitted here (no per-commit repo-meta fetch), so the
// opensource/foreign/stargazing skills aren't trained on this path; every other commit-derived
// skill is. The 10 agent-* skills are excluded (no GitHub signal).
import { scoreCommitData } from "../../../core/craftScore.ts";
import { awardCraft } from "../../../core/skills.ts";
import type { CraftResult } from "../../../core/craft.ts";

const GH = "https://api.github.com";
const headers = (token?: string): Record<string, string> => ({
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "renown",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});
const searchHeaders = (token?: string) => ({ ...headers(token), accept: "application/vnd.github.cloak-preview+json" });

type SearchItem = { sha?: string; repository?: { full_name?: string }; commit?: { author?: { date?: string }; message?: string } };

export const computeVerifiedSkillXp = async (login: string, token = process.env.GITHUB_TOKEN, sample = 20): Promise<Record<string, number>> => {
  const ledger: Record<string, number> = {};
  try {
    const sr = await fetch(`${GH}/search/commits?q=${encodeURIComponent(`author:${login}`)}&sort=committer-date&order=desc&per_page=${Math.min(100, sample)}`, { headers: searchHeaders(token), signal: AbortSignal.timeout(15_000) });
    if (!sr.ok) return ledger;
    const items = (((await sr.json()) as { items?: SearchItem[] }).items ?? []).slice(0, sample);
    const queue = items.slice();
    const worker = async () => {
      while (queue.length > 0) {
        const it = queue.shift();
        if (!it?.sha || !it.repository?.full_name) continue;
        try {
          const r = await fetch(`${GH}/repos/${it.repository.full_name}/commits/${it.sha}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
          if (!r.ok) continue;
          const j = (await r.json()) as { commit?: { message?: string; author?: { date?: string } }; files?: Array<{ filename?: string; additions?: number }> };
          const files = (j.files ?? []).map((f) => ({ path: f.filename ?? "", additions: f.additions ?? 0 })).filter((f) => f.path);
          const scored = scoreCommitData({ subject: (j.commit?.message ?? "").split("\n")[0], files, meta: null, myOwners: [], recentFps: [], craftXpToday: 0 });
          const cr: CraftResult = {
            xp: scored.xp, lines: scored.lines, oss: scored.oss, ext: scored.ext, stars: scored.stars,
            langs: scored.langs, paths: scored.paths, hasTests: scored.hasTests, subject: scored.subject,
            committedAt: new Date(j.commit?.author?.date ?? it.commit?.author?.date ?? 0).getTime(), breakdown: scored.breakdown,
          };
          for (const [id, x] of Object.entries(awardCraft(cr))) {
            if (id.startsWith("agent-")) continue;   // not GitHub-verifiable
            ledger[id] = (ledger[id] ?? 0) + x;
          }
        } catch { /* drop this commit */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  } catch { /* return whatever we accumulated */ }
  return ledger;
};
