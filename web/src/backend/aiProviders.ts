// AI provider registry + JWT-based attestation verification.
//
// Provider DATA lives in aiProviders.json (id, displayName, coauthorQuery, jwksUrl?).
// Contributors PR new providers by adding a row there — no code changes needed for the
// common case. CODE-only providers (the `dev` HMAC verifier used for end-to-end testing)
// stay in this file because they require a custom verifier function.
//
// Each effective entry knows:
//  - coauthorQuery: the GitHub commit-search query that finds commits where this provider
//    appears in the Co-authored-by trailer. Set as the player's attribution_query when
//    they attest as this provider so the next /api/verify backfills their score from
//    real co-authored commits.
//  - displayName: shown in the UI ("🤖 anthropic" badge / "Attested as <name>" copy).
//  - verifyJwt (optional): cryptographic verifier for a signed claim. Auto-wired to a
//    JWKS-backed verifier when the JSON entry has jwksUrl; jose's createRemoteJWKSet
//    handles fetch + ~1h cache + automatic key-rollover, so a provider rotating keys is
//    a transparent operation on our side.
//
// Required JWT claims (enforced by every verifier we ship): iss = provider id, sub =
// github_login asserted by the auth session, aud = "renown", exp valid.

import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from "jose";
import providersJson from "./aiProviders.json" with { type: "json" };

const RENOWN_AUDIENCE = "renown";
const DEV_HMAC_ENV = "RENOWN_DEV_AI_HMAC";

type ProviderJson = { id: string; displayName: string; coauthorQuery: string; jwksUrl?: string };

// Common claims contract enforcement. jose's jwtVerify already validates exp/nbf and
// (when passed) iss/aud before we get here — this just adds the sub check, which jose
// doesn't have a built-in option for.
const claimsValid = (payload: JWTPayload, expectedSub: string): boolean =>
  payload.sub === expectedSub;

// Verifier return shape — boolean + the JWT's expiry (so callers can copy it into the
// attestation record without re-parsing the JWT themselves). On failure, both are
// undefined; callers treat that as "didn't verify."
export type VerifyJwtResult = { ok: false } | { ok: true; expiresAt: string };

// HMAC dev verifier — read RENOWN_DEV_AI_HMAC on every call so flipping the env at
// runtime takes effect without a server restart, and so the verifier returns false (not
// throws) when the env isn't set. Lets the verified-attestation path be end-to-end
// testable today, before any real provider ships signing keys.
const verifyHmacJwt = async (jwt: string, expectedIss: string, expectedSub: string): Promise<VerifyJwtResult> => {
  const secret = process.env[DEV_HMAC_ENV];
  if (!secret) return { ok: false };
  try {
    const { payload } = await jwtVerify(jwt, new TextEncoder().encode(secret), {
      issuer: expectedIss,
      audience: RENOWN_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (!claimsValid(payload, expectedSub)) return { ok: false };
    // exp is required by claimsValid's iss/aud/sub gate + jose's own exp check.
    return { ok: true, expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString() };
  } catch (e) {
    if (!(e instanceof joseErrors.JOSEError)) console.error("dev JWT verify error", e);
    return { ok: false };
  }
};

// JWKS verifier factory — one createRemoteJWKSet instance per provider (jose memoizes
// fetches + caches keys with a ~10-minute cooldown by default; key rollover is
// transparent). Falls back to { ok: false } on any fetch/verify error so a provider's
// key outage can't 500 unrelated requests.
const makeJwksVerifier = (jwksUrl: string, providerId: string) => {
  let resolver: ReturnType<typeof createRemoteJWKSet> | null = null;
  return async (jwt: string, expectedSub: string): Promise<VerifyJwtResult> => {
    try {
      if (!resolver) resolver = createRemoteJWKSet(new URL(jwksUrl));
      const { payload } = await jwtVerify(jwt, resolver, {
        issuer: providerId,
        audience: RENOWN_AUDIENCE,
      });
      if (!claimsValid(payload, expectedSub)) return { ok: false };
      return { ok: true, expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString() };
    } catch (e) {
      if (!(e instanceof joseErrors.JOSEError)) console.error(`${providerId} JWKS verify error`, e);
      return { ok: false };
    }
  };
};

export type AiProviderConfig = {
  displayName: string;
  coauthorQuery: string;
  jwksUrl?: string;
  verifyJwt?: (jwt: string, githubLogin: string) => Promise<VerifyJwtResult>;
};

// Build the effective PROVIDERS map at module load: data-defined entries from JSON +
// code-defined entries (just `dev` today). For JSON entries with jwksUrl, auto-attach
// the JWKS verifier — contributors only need to add the URL, no code change.
const jsonEntries = (providersJson as { providers: ProviderJson[] }).providers;
const fromJson: Record<string, AiProviderConfig> = {};
for (const p of jsonEntries) {
  fromJson[p.id] = {
    displayName: p.displayName,
    coauthorQuery: p.coauthorQuery,
    ...(p.jwksUrl ? { jwksUrl: p.jwksUrl, verifyJwt: makeJwksVerifier(p.jwksUrl, p.id) } : {}),
  };
}

export const PROVIDERS: Record<string, AiProviderConfig> = {
  ...fromJson,
  // The dev provider exists so the verified-attestation path is end-to-end testable
  // today. Disabled (returns false) when RENOWN_DEV_AI_HMAC is unset, so it's safe to
  // leave in production builds.
  dev: {
    displayName: "dev (HMAC)",
    coauthorQuery: `"Co-authored-by: dev-ai"`,
    verifyJwt: (jwt, sub) => verifyHmacJwt(jwt, "dev", sub),
  },
};

// Normalize a user-provided provider id (case-insensitive lookup, trims whitespace).
// Returns the canonical key if known, undefined otherwise. Unknown providers are still
// allowed in the v1 public-claim model — they just don't get the auto-fill or verifier.
export const resolveProvider = (raw: string): { id: string; config: AiProviderConfig } | undefined => {
  const k = raw.trim().toLowerCase();
  const config = PROVIDERS[k];
  return config ? { id: k, config } : undefined;
};

// Default attribution_query for non-AI accounts. Exported so callers don't hardcode the
// pattern in three places.
export const defaultAuthorQuery = (login: string) => `author:${login}`;
