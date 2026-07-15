import type {
  LinkedProviderBinding,
  LinkedProviderBindingStore,
  LinkedProviderCredentialResolver,
  LinkedProviderGrant,
  LinkedProviderGrantStore,
} from "@absolutejs/linked-providers";
import type { ResolvedOAuthAuthorization } from "@absolutejs/auth";
import { loadAccessiblePrivateRepos } from "../privateRepos.ts";

export const GITHUB_REPOS_CONNECTOR = "github_repos";
export const GITHUB_PRIVATE_REPO_SCOPE = "repo";

export const parseGrantedScopes = (scope: unknown, fallback: string[] = []) => {
  const values = typeof scope === "string" ? scope.split(/[\s,]+/) : fallback;
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
};

type PersistGithubRepoGrantInput = {
  authorization: ResolvedOAuthAuthorization;
  bindingStore: LinkedProviderBindingStore;
  configuredScopes: string[];
  grantStore: LinkedProviderGrantStore;
  ownerRef: string;
  tokenResponse: Record<string, unknown>;
};

export const persistGithubRepoGrant = async ({
  authorization,
  bindingStore,
  configuredScopes,
  grantStore,
  ownerRef,
  tokenResponse,
}: PersistGithubRepoGrantInput) => {
  const subjectValue = authorization.userIdentity.id;
  const loginValue = authorization.userIdentity.login;
  if ((typeof subjectValue !== "string" && typeof subjectValue !== "number") || typeof loginValue !== "string" || !loginValue) {
    throw new Error("GitHub authorization is missing its immutable subject or login");
  }
  const providerSubject = String(subjectValue);
  const login = loginValue;
  const now = Date.now();
  const grantedScopes = parseGrantedScopes(tokenResponse.scope, configuredScopes);
  const existingGrant = (await grantStore.listGrantsByOwner(ownerRef)).find(
    (grant) => grant.authProviderKey === "github" && grant.providerSubject === providerSubject,
  );
  const grantId = existingGrant?.id ?? `github:${providerSubject}`;
  const grant: LinkedProviderGrant = {
    accessTokenCiphertext: authorization.accessToken,
    authProviderKey: "github",
    createdAt: existingGrant?.createdAt ?? now,
    expiresAt: authorization.expiresAt,
    grantedScopes,
    id: grantId,
    lastRefreshedAt: now,
    ownerRef,
    providerFamily: "github",
    providerSubject,
    refreshTokenCiphertext: authorization.refreshToken ?? existingGrant?.refreshTokenCiphertext,
    status: "active",
    tokenType: authorization.tokenType,
    updatedAt: now,
  };
  await grantStore.saveGrant(grant);

  const bindingId = `${GITHUB_REPOS_CONNECTOR}:${providerSubject}`;
  const existingBinding = (await bindingStore.listBindingsByGrant(grantId)).find((binding) => binding.id === bindingId);
  const binding: LinkedProviderBinding = {
    availableScopes: grantedScopes,
    capabilities: ["repositories.private.read"],
    connectorProvider: GITHUB_REPOS_CONNECTOR,
    createdAt: existingBinding?.createdAt ?? now,
    externalAccountId: providerSubject,
    externalAccountType: "user",
    grantId,
    id: bindingId,
    label: `@${login}`,
    status: "active",
    updatedAt: now,
    username: login,
  };
  await bindingStore.saveBinding(binding);
  return { binding, grant };
};

type BootstrapGithubRepoGrantInput = {
  accessToken: string;
  allowedLogins: string[];
  bindingStore: LinkedProviderBindingStore;
  grantStore: LinkedProviderGrantStore;
  ownerRef: string;
};

export const bootstrapGithubRepoGrantFromSession = async ({
  accessToken,
  allowedLogins,
  bindingStore,
  grantStore,
  ownerRef,
}: BootstrapGithubRepoGrantInput) => {
  const response = await fetch("https://api.github.com/user", {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${accessToken}`, "user-agent": "renown" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response?.ok) return false;
  const identity = await response.json() as { id?: string | number; login?: string };
  if (!identity.login || !allowedLogins.some((login) => login.toLowerCase() === identity.login!.toLowerCase())) return false;
  const grantedScopes = parseGrantedScopes(response.headers.get("x-oauth-scopes") ?? "");
  if (!grantedScopes.includes(GITHUB_PRIVATE_REPO_SCOPE)) return false;
  await persistGithubRepoGrant({
    authorization: { accessToken, userIdentity: identity },
    bindingStore,
    configuredScopes: grantedScopes,
    grantStore,
    ownerRef,
    tokenResponse: { scope: grantedScopes.join(" ") },
  });
  return true;
};

type LoadGithubGrantReposInput = {
  allowedLogins: string[];
  credentialResolver: LinkedProviderCredentialResolver;
  ownerRef: string;
};

export const loadPrivateReposFromGithubGrants = async ({ allowedLogins, credentialResolver, ownerRef }: LoadGithubGrantReposInput) => {
  const allowed = new Set(allowedLogins.map((login) => login.toLowerCase()));
  const bindings = (await credentialResolver.listBindings({ ownerRef, connectorProvider: GITHUB_REPOS_CONNECTOR, status: "active" }))
    .filter((binding) => binding.username && allowed.has(binding.username.toLowerCase()));
  if (bindings.length === 0) {
    return { repos: [], needsGithubAuth: true, reason: "Reconnect GitHub once to grant private repository access." };
  }

  const repos = new Map<string, Awaited<ReturnType<typeof loadAccessiblePrivateRepos>>["repos"][number]>();
  let successfulBindings = 0;
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
      const result = await loadAccessiblePrivateRepos(lease.accessToken, [binding.username!]);
      if (result.needsGithubAuth) continue;
      successfulBindings += 1;
      for (const repo of result.repos) repos.set(repo.key.toLowerCase(), repo);
    } catch {
      // A disconnected/revoked grant remains isolated to this binding. Other linked GitHub
      // accounts can still return their repositories, and the UI offers a reconnect below.
    }
  }

  const needsGithubAuth = successfulBindings < bindings.length;
  return {
    needsGithubAuth,
    reason: needsGithubAuth ? "Reconnect GitHub to refresh private repository access for every linked account." : null,
    repos: [...repos.values()].sort((a, b) => Date.parse(b.pushedAt ?? b.updatedAt ?? "0") - Date.parse(a.pushedAt ?? a.updatedAt ?? "0")),
  };
};
