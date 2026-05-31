// Authoritative verification — the leaderboard's source of truth. The client is UNTRUSTED:
// ~/.renown/state.json is editable, so any xp/level/skill number a client submits is a hint
// at best. This recomputes a player's score *directly from GitHub's public API* — real repos,
// real stars, real contributions to others' repos, real account age — none of which a player
// (or we) can fabricate without it actually being true on GitHub. Ranked placement uses ONLY
// this number; submitted numbers never touch the ranking.
//
// Identity is the other half: a login is only trusted once OAuth proves the player owns it
// (players.github_verified). Verification + ownership together = an authentic leaderboard.

const GH = "https://api.github.com";
const DAY = 86400000;

type Repo = { fork: boolean; stargazers_count: number; language: string | null; full_name: string };
type Event = { type: string; repo: { name: string }; payload?: { size?: number } };

export interface VerifiedScore {
  login: string; ok: boolean; score: number;
  totalStars: number; publicRepos: number; extContribs: number; recentCommits: number;
  accountAgeDays: number; skillXp: Record<string, number>; verifiedAt: number;
}

const headersFor = (token?: string): Record<string, string> => ({ accept: "application/vnd.github+json", "user-agent": "renown", ...(token ? { authorization: `Bearer ${token}` } : {}) });

// Recompute a player's authoritative score from GitHub public data. Returns null if the
// account doesn't exist. Weighted toward what OTHERS validate (stars, contributions to
// repos you don't own), discounted for very young accounts (anti-fresh-farm).
export const verifyGithub = async (login: string, token = process.env.GITHUB_TOKEN): Promise<VerifiedScore | null> => {
  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login)) return null;
  const headers = headersFor(token);
  const get = async <T>(path: string): Promise<T | null> => { try { const r = await fetch(`${GH}${path}`, { headers, signal: AbortSignal.timeout(10000) }); return r.ok ? (await r.json() as T) : null; } catch { return null; } };

  const user = await get<{ created_at: string }>(`/users/${login}`);
  if (!user) return null;
  // `get` returns null on a FAILED fetch (non-ok/timeout — e.g. GitHub rate-limiting us) and a
  // 200 returns the array (possibly empty for a real account with no repos/events). Abort on
  // failure rather than coalescing to [] — otherwise a transient 403/429 would compute a
  // deflated score and overwrite the player's real one.
  const repos = await get<Repo[]>(`/users/${login}/repos?sort=pushed&per_page=100&type=owner`);
  const events = await get<Event[]>(`/users/${login}/events/public?per_page=100`);
  if (repos === null || events === null) return null;

  const accountAgeDays = Math.max(0, Math.round((Date.now() - Date.parse(user.created_at)) / DAY));
  const owned = repos.filter((r) => !r.fork);
  const totalStars = owned.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const publicRepos = owned.length;
  const pushes = events.filter((e) => e.type === "PushEvent");
  const extContribs = pushes.filter((e) => !e.repo.name.toLowerCase().startsWith(`${login.toLowerCase()}/`)).length;  // pushed to repos you don't own
  const recentCommits = pushes.reduce((s, e) => s + (e.payload?.size ?? 0), 0);

  // skills (coarse) from the languages of starred-weighted owned repos
  const skillXp: Record<string, number> = {};
  for (const r of owned) if (r.language) skillXp[r.language.toLowerCase()] = (skillXp[r.language.toLowerCase()] ?? 0) + 100 + (r.stargazers_count || 0) * 5;

  const ageTrust = Math.min(1, accountAgeDays / 180);          // <6-month accounts are trusted less
  const score = Math.round(ageTrust * (Math.log10(totalStars + 1) * 400 + publicRepos * 20 + extContribs * 60 + Math.min(recentCommits, 300) * 3));

  return { login, ok: true, score, totalStars, publicRepos, extContribs, recentCommits, accountAgeDays, skillXp, verifiedAt: Date.now() };
};
