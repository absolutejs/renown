type IdentityMetadata = Record<string, unknown>;

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

/** Only expose provider profile fields that help a person recognize a linked login. */
export const presentIdentity = (provider: string, subject: string, rawMetadata: unknown) => {
  const metadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata as IdentityMetadata : {};
  const name = text(metadata.name);
  const email = text(metadata.email);
  const login = text(metadata.login);
  const givenName = text(metadata.given_name);
  const familyName = text(metadata.family_name);
  const fullName = [givenName, familyName].filter(Boolean).join(" ") || null;

  if (provider === "github") return {
    displayName: name,
    accountName: login ? `@${login}` : null,
    avatarUrl: text(metadata.avatar_url),
  };

  if (provider === "google") return {
    displayName: name ?? fullName,
    accountName: email,
    avatarUrl: text(metadata.picture),
  };

  if (provider === "credentials") return {
    displayName: name,
    accountName: email ?? (subject.includes("@") ? subject : null),
    avatarUrl: null,
  };

  return { displayName: name, accountName: email ?? login, avatarUrl: null };
};
