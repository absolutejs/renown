// AI provider registry + JWT-based attestation verification.
//
// Each entry knows:
//  - coauthorQuery: the GitHub commit-search query that finds commits where this provider
//    appears in the Co-authored-by trailer. Set as the player's attribution_query when
//    they attest as this provider so the next /api/verify backfills their score from real
//    co-authored commits across GitHub.
//  - displayName: shown in the UI ("🤖 anthropic" badge / "Attested as <name>" copy).
//  - verifyJwt (optional): cryptographic verifier for a signed claim from this provider.
//    Returns true on a valid signature + matching claims (iss/sub/aud/exp). Real
//    providers will replace these stubs with JWKS-backed verifiers once they ship
//    public attestation keys. The `dev` provider uses an HMAC secret from the env so
//    the verified-attestation path is actually testable end-to-end today.
//
// To add a new provider: drop a new entry in PROVIDERS keyed by the short id you want
// users to type in the attestation form.

import { errors as joseErrors, jwtVerify, type JWTPayload } from "jose";

const RENOWN_AUDIENCE = "renown";
const DEV_HMAC_ENV = "RENOWN_DEV_AI_HMAC";

// Common claims contract: iss = provider id (anthropic/openai/dev/…), sub = github_login
// the JWT is asserting, aud = "renown", exp valid. Any verifier should enforce this.
const claimsValid = (payload: JWTPayload, expectedIss: string, expectedSub: string): boolean => {
  if (payload.iss !== expectedIss) return false;
  if (payload.sub !== expectedSub) return false;
  if (payload.aud !== RENOWN_AUDIENCE && !(Array.isArray(payload.aud) && payload.aud.includes(RENOWN_AUDIENCE))) return false;
  return true;   // jwtVerify already validates exp / nbf before we get here
};

// HMAC verifier — used by the `dev` provider so admins/contributors can test the
// verified-attestation flow without waiting for a real provider to ship signing keys.
// Set RENOWN_DEV_AI_HMAC=<some secret> in .env and sign a JWT with HS256 against the
// same secret to mint a working dev attestation.
const verifyHmacJwt = async (jwt: string, expectedIss: string, expectedSub: string): Promise<boolean> => {
  const secret = process.env[DEV_HMAC_ENV];
  if (!secret) return false;
  try {
    const { payload } = await jwtVerify(jwt, new TextEncoder().encode(secret), {
      issuer: expectedIss,
      audience: RENOWN_AUDIENCE,
      algorithms: ["HS256"],
    });
    return claimsValid(payload, expectedIss, expectedSub);
  } catch (e) {
    // Expected when the JWT is malformed / signature wrong / expired — log nothing to
    // avoid noise from probing attempts; failures just mean the attestation stays a
    // public claim (verified=false).
    if (!(e instanceof joseErrors.JOSEError)) console.error("dev JWT verify error", e);
    return false;
  }
};

export type AiProviderConfig = {
  displayName: string;
  coauthorQuery: string;
  verifyJwt?: (jwt: string, githubLogin: string) => Promise<boolean>;
};

export const PROVIDERS: Record<string, AiProviderConfig> = {
  anthropic: {
    displayName: "anthropic",
    coauthorQuery: `"Co-authored-by: Claude"`,
    // TODO: replace with JWKS-backed verifier once Anthropic publishes attestation keys.
  },
  openai: {
    displayName: "openai",
    coauthorQuery: `"Co-authored-by: ChatGPT"`,
  },
  cursor: {
    displayName: "cursor",
    coauthorQuery: `"Co-authored-by: Cursor"`,
  },
  copilot: {
    displayName: "github copilot",
    coauthorQuery: `"Co-authored-by: copilot-swe-agent"`,
  },
  codex: {
    displayName: "codex",
    coauthorQuery: `"Co-authored-by: Codex"`,
  },
  // The dev provider exists so the verified-attestation path is end-to-end testable
  // today, before any real provider ships signing keys. Disabled if RENOWN_DEV_AI_HMAC
  // is unset (verifyJwt returns false), so it's safe to leave in production builds.
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
// pattern in three places (auth/config.ts already has it; this is the single source of
// truth that other call sites can import).
export const defaultAuthorQuery = (login: string) => `author:${login}`;
