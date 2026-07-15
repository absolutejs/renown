// Authenticated private-repository discovery. Private repository identities are deliberately
// fetched live from GitHub and returned only to the session owner; they are never inserted into
// projects/player_projects, logged, or mixed into public repository loaders.

const GH = "https://api.github.com";
const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "renown",
});

type GithubRepo = {
  full_name?: string; name?: string; private?: boolean; stargazers_count?: number;
  pushed_at?: string | null; updated_at?: string | null; permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean };
  owner?: { login?: string };
};

const roleOf = (permissions: GithubRepo["permissions"]): string => {
  if (permissions?.admin) return "admin";
  if (permissions?.maintain) return "maintain";
  if (permissions?.push) return "write";
  if (permissions?.triage) return "triage";
  return "read";
};

export const loadAccessiblePrivateRepos = async (token: string, allowedLogins: string[]) => {
  const userResponse = await fetch(`${GH}/user`, { headers: headers(token), signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!userResponse?.ok) return { repos: [], needsGithubAuth: true, reason: "Sign in with GitHub to load private repositories." };
  const login = String(((await userResponse.json()) as { login?: string }).login ?? "");
  if (!login || !allowedLogins.some((allowed) => allowed.toLowerCase() === login.toLowerCase())) {
    return { repos: [], needsGithubAuth: true, reason: "This session is not backed by one of your linked GitHub accounts." };
  }

  const grantedScopes = (userResponse.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim().toLowerCase());
  const hasPrivateScope = grantedScopes.includes("repo");
  const repos: GithubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`${GH}/user/repos?visibility=private&affiliation=owner,collaborator,organization_member&sort=pushed&direction=desc&per_page=100&page=${page}`, {
      headers: headers(token), signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!response?.ok) return { repos: [], needsGithubAuth: true, reason: "GitHub did not allow private repository access. Reconnect GitHub to grant it." };
    const rows = (await response.json()) as GithubRepo[];
    repos.push(...rows.filter((repo) => repo.private && repo.full_name));
    if (rows.length < 100) break;
  }

  const needsGithubAuth = !hasPrivateScope && repos.length === 0;
  return {
    login,
    needsGithubAuth,
    reason: needsGithubAuth ? "Reconnect GitHub once to grant private repository access." : null,
    repos: repos.map((repo) => {
      const key = repo.full_name!;
      const [owner, ...rest] = key.split("/");
      return {
        key, owner, repo: rest.join("/") || repo.name || key, name: repo.name || key,
        stars: repo.stargazers_count ?? 0, pushedAt: repo.pushed_at ?? null,
        updatedAt: repo.updated_at ?? null, role: roleOf(repo.permissions), private: true as const,
      };
    }),
  };
};
