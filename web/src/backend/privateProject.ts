// Permission-scoped private repository leaderboard. Repository identity and contribution data
// live only in this request/response: no project/player_project rows, caches, logs, or public
// image routes. Every load resolves a linked GitHub grant and rechecks access with GitHub.
import type { LinkedProviderCredentialResolver } from "@absolutejs/linked-providers";
import { and, eq, sql } from "drizzle-orm";
import { playerAccounts, players } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers.ts";
import { GITHUB_PRIVATE_REPO_SCOPE, GITHUB_REPOS_CONNECTOR } from "./auth/githubRepoGrants.ts";
import { gameDb } from "./sync.ts";
import type { ProjectSort } from "./project.ts";

const GH = "https://api.github.com";
const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const githubHeaders = (token: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "user-agent": "renown",
  "x-github-api-version": "2022-11-28",
});

type GithubRepo = {
  full_name?: string; name?: string; private?: boolean; stargazers_count?: number;
  owner?: { login?: string };
};
type GithubContributorStat = {
  author?: { login?: string } | null;
  total?: number;
  weeks?: Array<{ a?: number; d?: number; c?: number }>;
};
type GithubContributor = { login?: string; contributions?: number };
type RenownAccount = {
  login: string; handle: string; avatarSeed: string | null; isAi: boolean; tier: string;
};
type PrivateContribution = { login: string; commits: number; additions: number; deletions: number };

// A live, deliberately non-authoritative estimate for the familiar XP column. Exact craft XP
// needs commit messages/file paths and would require hundreds of GitHub calls. This bounded score
// lets the board sort immediately while the UI labels it as a live estimate.
export const privateActivityXp = (commits: number, additions: number) =>
  Math.max(0, commits) * 25 + Math.min(Math.max(0, additions), Math.max(0, commits) * 125);

const loadRenownAccounts = async (logins: string[]): Promise<RenownAccount[]> => {
  if (logins.length === 0) return [];
  const wanted = new Set(logins.map((login) => login.toLowerCase()));
  const rows = await gameDb.select({
    login: playerAccounts.githubLogin,
    handle: players.handle,
    avatarSeed: players.avatarSeed,
    isAi: players.isAi,
    tier: players.tier,
  }).from(playerAccounts).innerJoin(players, eq(players.id, playerAccounts.playerId))
    .where(and(eq(playerAccounts.githubVerified, true), sql`lower(${playerAccounts.githubLogin}) in (${sql.join([...wanted].map((login) => sql`${login}`), sql`, `)})`));
  return rows.map((row) => ({ ...row, tier: normalizeTier(row.tier) }));
};

export const buildPrivateProject = ({
  accounts,
  contributions,
  repo,
  sort,
  viewerLogins,
}: {
  accounts: RenownAccount[];
  contributions: PrivateContribution[];
  repo: Required<Pick<GithubRepo, "full_name" | "name" | "private">> & GithubRepo;
  sort: ProjectSort;
  viewerLogins: string[];
}) => {
  const accountByLogin = new Map(accounts.map((account) => [account.login.toLowerCase(), account]));
  const contributors = contributions.map((contribution) => {
    const account = accountByLogin.get(contribution.login.toLowerCase());
    return {
      login: contribution.login,
      handle: account?.handle ?? contribution.login,
      avatarSeed: account?.avatarSeed ?? null,
      isAi: account?.isAi ?? false,
      tier: account?.tier ?? "free",
      xp: privateActivityXp(contribution.commits, contribution.additions),
      commits: contribution.commits,
      lines: contribution.additions,
      verified: Boolean(account),
    };
  });
  contributors.sort((a, b) => b[sort] - a[sort] || b.commits - a.commits || a.login.localeCompare(b.login));
  const [owner, ...repoParts] = repo.full_name.split("/");
  const totals = {
    devs: contributors.length,
    verifiedDevs: contributors.filter((contributor) => contributor.verified).length,
    xp: contributors.reduce((sum, contributor) => sum + contributor.xp, 0),
    commits: contributors.reduce((sum, contributor) => sum + contributor.commits, 0),
    lines: contributors.reduce((sum, contributor) => sum + contributor.lines, 0),
  };
  return {
    key: repo.full_name,
    owner,
    repo: repoParts.join("/") || repo.name,
    name: repo.name,
    stars: repo.stargazers_count ?? 0,
    oss: false,
    private: true as const,
    ephemeral: true as const,
    sort,
    viewerLogins,
    contributors,
    topContributor: contributors[0] ?? null,
    totals,
  };
};

const parseStats = (rows: GithubContributorStat[]): PrivateContribution[] => rows.flatMap((row) => {
  const login = row.author?.login;
  if (!login) return [];
  const weeks = row.weeks ?? [];
  return [{
    login,
    commits: Math.max(Number(row.total ?? 0), weeks.reduce((sum, week) => sum + Number(week.c ?? 0), 0)),
    additions: weeks.reduce((sum, week) => sum + Number(week.a ?? 0), 0),
    deletions: weeks.reduce((sum, week) => sum + Number(week.d ?? 0), 0),
  }];
});

export const loadPrivateProject = async ({
  allowedLogins,
  credentialResolver,
  owner,
  ownerRef,
  repo,
  sort,
}: {
  allowedLogins: string[];
  credentialResolver: LinkedProviderCredentialResolver;
  owner: string;
  ownerRef: string;
  repo: string;
  sort: ProjectSort;
}) => {
  if (!REPO_PART.test(owner) || !REPO_PART.test(repo)) return null;
  const requestedKey = `${owner}/${repo}`.toLowerCase();
  const allowed = new Set(allowedLogins.map((login) => login.toLowerCase()));
  const bindings = (await credentialResolver.listBindings({ ownerRef, connectorProvider: GITHUB_REPOS_CONNECTOR, status: "active" }))
    .filter((binding) => binding.username && allowed.has(binding.username.toLowerCase()));

  for (const binding of bindings) {
    const credential = await credentialResolver.resolveCredential({
      bindingId: binding.id,
      connectorProvider: GITHUB_REPOS_CONNECTOR,
      ownerRef,
      purpose: "interactive_test",
      requiredScopes: [GITHUB_PRIVATE_REPO_SCOPE],
    });
    if (!credential) continue;
    try {
      const lease = await credentialResolver.getAccessToken(credential, { requiredScopes: [GITHUB_PRIVATE_REPO_SCOPE] });
      const headers = githubHeaders(lease.accessToken);
      const repoResponse = await fetch(`${GH}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers, signal: AbortSignal.timeout(15_000) });
      if (!repoResponse.ok) continue;
      const metadata = await repoResponse.json() as GithubRepo;
      if (!metadata.private || metadata.full_name?.toLowerCase() !== requestedKey || !metadata.name) continue;

      let contributions: PrivateContribution[] = [];
      const statsResponse = await fetch(`${GH}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/contributors`, { headers, signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (statsResponse?.ok) contributions = parseStats(await statsResponse.json() as GithubContributorStat[]);
      if (contributions.length === 0) {
        const fallback = await fetch(`${GH}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors?anon=0&per_page=100`, { headers, signal: AbortSignal.timeout(20_000) }).catch(() => null);
        if (fallback?.ok) contributions = (await fallback.json() as GithubContributor[]).flatMap((row) => row.login ? [{ login: row.login, commits: Number(row.contributions ?? 0), additions: 0, deletions: 0 }] : []);
      }
      const accounts = await loadRenownAccounts(contributions.map((contribution) => contribution.login));
      return buildPrivateProject({ accounts, contributions, repo: metadata as Required<Pick<GithubRepo, "full_name" | "name" | "private">> & GithubRepo, sort, viewerLogins: allowedLogins });
    } catch {
      // Try the next linked GitHub identity. A user may access an organization repository from
      // only one of several linked accounts.
    }
  }
  return null;
};
