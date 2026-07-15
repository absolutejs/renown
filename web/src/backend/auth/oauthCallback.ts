// Small, provider-agnostic guards around OAuth callback responses. Some providers (including
// GitHub) can return an OAuth error as a JSON body even when the token endpoint itself answered
// successfully. Never let an absent token turn into a misleading `Bearer undefined` profile call.

type TokenResponse = Record<string, unknown>;

export const oauthAccessToken = (tokenResponse: TokenResponse): string | null => {
  const token = tokenResponse.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
};

export const oauthErrorCode = (tokenResponse: TokenResponse): string => {
  const error = tokenResponse.error;
  if (typeof error !== "string" || error.length === 0) return "missing_access_token";
  // Provider error codes are logged for diagnosis, but constrain the value so an upstream
  // response can never inject arbitrary text or credentials into production logs.
  return /^[a-z0-9_.-]{1,80}$/i.test(error) ? error : "invalid_oauth_error";
};

export const replaceSessionAccessToken = <User>(
  session: Record<string, { user: User; accessToken?: string; refreshToken?: string; expiresAt: number }>,
  sessionId: string,
  accessToken: string,
  refreshToken?: string,
) => {
  const current = session[sessionId];
  if (!current) return false;
  session[sessionId] = {
    ...current,
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
  };
  return true;
};
