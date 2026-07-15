import { presentIdentity } from "./identityPresentation.ts";

type GithubIdentity = {
  id: string;
  provider_subject: string;
  metadata: unknown;
  created_at: Date | string | null;
};

type GithubLedgerAccount = {
  githubLogin: string;
  githubVerified: boolean | null;
  verifiedScore: number | string | null;
  attributionScore: number | string | null;
  attributionQuery: string | null;
  lastAttributionSyncAt: Date | string | null;
  verifiedAt: Date | string | null;
  verifiedSkillXp: unknown;
  prReviewsCount: number | null;
  crossRepoPrsCount: number | null;
  prsMergedCount: number | null;
  packageDownloads: number | string | null;
  substanceScore: number | string | null;
  lastMeritSyncAt: Date | string | null;
  createdAt: Date | string | null;
};

export const githubIdentityLogin = (identity: GithubIdentity | undefined) =>
  (identity?.metadata as { login?: string } | undefined)?.login?.trim() || null;

export const presentGithubAccounts = ({
  profileLogin,
  primaryIdentityId,
  identities,
  ledgerAccounts,
}: {
  profileLogin: string | null;
  primaryIdentityId: string | null;
  identities: GithubIdentity[];
  ledgerAccounts: GithubLedgerAccount[];
}) => {
  const ledgerByLogin = new Map(ledgerAccounts.map((account) => [account.githubLogin.toLowerCase(), account]));
  const identityByLogin = new Map(identities.flatMap((identity) => {
    const login = githubIdentityLogin(identity);
    return login ? [[login.toLowerCase(), identity] as const] : [];
  }));
  const logins = [...new Set([
    ...(profileLogin ? [profileLogin] : []),
    ...ledgerAccounts.map((account) => account.githubLogin),
    ...identities.map(githubIdentityLogin).filter((login): login is string => Boolean(login)),
  ].map((login) => login.toLowerCase()))];

  return logins.map((lower) => {
    const ledger = ledgerByLogin.get(lower);
    const identity = identityByLogin.get(lower);
    const profile = identity ? presentIdentity("github", identity.provider_subject, identity.metadata) : null;
    const login = ledger?.githubLogin ?? githubIdentityLogin(identity) ?? lower;
    return {
      login,
      identityId: identity?.id ?? null,
      displayName: profile?.displayName ?? null,
      accountName: profile?.accountName ?? `@${login}`,
      avatarUrl: profile?.avatarUrl ?? null,
      loginLinked: Boolean(identity),
      isLoginPrimary: identity?.id === primaryIdentityId,
      isProfilePrimary: profileLogin?.toLowerCase() === lower,
      verified: ledger?.githubVerified ?? false,
      verifiedScore: Number(ledger?.verifiedScore ?? 0),
      baseScore: Number(ledger?.verifiedScore ?? 0) - Number(ledger?.attributionScore ?? 0),
      attributionScore: Number(ledger?.attributionScore ?? 0),
      attributionQuery: ledger?.attributionQuery ?? null,
      lastAttributionSyncAt: ledger?.lastAttributionSyncAt ?? null,
      verifiedAt: ledger?.verifiedAt ?? null,
      verifiedSkillXp: (ledger?.verifiedSkillXp as Record<string, number> | null) ?? {},
      prReviewsCount: ledger?.prReviewsCount ?? 0,
      crossRepoPrsCount: ledger?.crossRepoPrsCount ?? 0,
      prsMergedCount: ledger?.prsMergedCount ?? 0,
      packageDownloads: Number(ledger?.packageDownloads ?? 0),
      substanceScore: Number(ledger?.substanceScore ?? 0),
      lastMeritSyncAt: ledger?.lastMeritSyncAt ?? null,
      linkedAt: identity?.created_at ?? ledger?.createdAt ?? null,
    };
  });
};
