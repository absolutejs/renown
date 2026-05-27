// /.well-known/* endpoints. No /api prefix on purpose: well-known URLs are an internet
// convention (RFC 8615), and tools that look for them expect them at the document root.
//
// Currently serves /.well-known/renown-providers.json — a self-discovery document for AI
// providers that want to know what attestation claims renown would accept from them.
// Acts as a tiny standard: a provider can fetch this URL, configure their JWT signing
// against the documented contract, publish their JWKS, and submit an attestation.
import { Elysia } from "elysia";
import { PROVIDERS } from "../aiProviders.ts";

export const wellKnownPlugin = () =>
  new Elysia()
    .get("/.well-known/renown-providers.json", ({ headers }) => {
      const host = headers["host"] ?? "renown.local";
      const proto = headers["x-forwarded-proto"] ?? "https";
      const base = `${proto}://${host}`;
      // Don't leak code-only verifiers (dev/HMAC) here — this document advertises which
      // providers we'd accept attestation JWTs from publicly. The `dev` provider's HMAC
      // is environment-bound and not meaningful to advertise.
      const advertised = Object.entries(PROVIDERS)
        .filter(([id]) => id !== "dev")
        .map(([id, cfg]) => ({
          id,
          displayName: cfg.displayName,
          coauthorQuery: cfg.coauthorQuery,
          ...(cfg.jwksUrl ? { jwksUrl: cfg.jwksUrl } : {}),
          verificationSupported: !!cfg.verifyJwt,
        }));
      return new Response(JSON.stringify({
        service: "renown",
        documentation: "https://github.com/absolutejs/renown",
        attestation_endpoint: `${base}/api/account/ai-attestation`,
        cli_attestation_endpoint: `${base}/api/cli/ai-attest`,
        attestation_discovery: `${base}/.well-known/renown-attestation.json`,
        // The claim contract every JWT we accept must satisfy. Documenting this here
        // means a provider doesn't have to read our source to know what to sign.
        required_claims: {
          iss: "<your provider id as it appears in the providers list>",
          sub: "<the user's GitHub login the JWT is asserting>",
          aud: "renown",
          exp: "<unix-seconds, future>",
          alg: "RS256 / ES256 / EdDSA (via JWKS) — or HS256 for the dev provider",
        },
        // How to onboard a new provider: PR into web/src/backend/aiProviders.json.
        onboarding: {
          source: "https://github.com/absolutejs/renown/blob/main/web/src/backend/aiProviders.json",
          process: "Open a pull request adding { id, displayName, coauthorQuery, jwksUrl } to the providers array.",
        },
        providers: advertised,
      }, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
    })
    // Companion discovery doc focused on the cryptographic integration story. Single
    // place a provider's eng team reads to wire up their JWT signer + know what we'll
    // accept, including the canonical example payload + the signature contract for
    // the webhook (if the receiver subscribes to /api/account/ai-attestation/webhook).
    .get("/.well-known/renown-attestation.json", ({ headers }) => {
      const host = headers["host"] ?? "renown.local";
      const proto = headers["x-forwarded-proto"] ?? "https";
      const base = `${proto}://${host}`;
      const nowSec = Math.floor(Date.now() / 1000);
      return new Response(JSON.stringify({
        service: "renown",
        documentation: "https://github.com/absolutejs/renown",
        provider_discovery: `${base}/.well-known/renown-providers.json`,
        attestation_endpoints: {
          web_session: { url: `${base}/api/account/ai-attestation`, auth: "renown session cookie (sign in via web UI first)" },
          cli_token:   { url: `${base}/api/cli/ai-attest`, auth: "GitHub OAuth token in request body (token field, matches `gh auth token`)" },
        },
        // Full schema for the JWT a provider would sign on behalf of a GitHub login.
        jwt_schema: {
          required_claims: {
            iss: { type: "string", description: "Provider id (matches `id` field in providers list)" },
            sub: { type: "string", description: "GitHub login the attestation asserts" },
            aud: { type: "string", value: "renown", description: "Constant. Must equal exactly \"renown\"" },
            exp: { type: "number", description: "Unix seconds, must be in the future at verify time" },
          },
          optional_claims: {
            nbf: { type: "number", description: "Unix seconds, valid-from. Honored if present (jose default)" },
          },
          supported_algorithms: {
            jwks_backed: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "EdDSA"],
            shared_secret: ["HS256"],
            notes: "JWKS-backed providers' algorithms are determined by the keys advertised in their jwks_uri. HS256 only used by the dev provider for end-to-end testing.",
          },
          example_payload: {
            iss: "anthropic",
            sub: "alexkahndev",
            aud: "renown",
            iat: nowSec,
            exp: nowSec + 300,
          },
        },
        webhook_signature: {
          header: "X-Renown-Signature",
          format: "sha256=<lowercase-hex>",
          algorithm: "HMAC-SHA256",
          key_source: "operator-configured shared secret (RENOWN_ATTESTATION_WEBHOOK_SECRET env)",
          verify_pseudocode: "expected = 'sha256=' + hmac_sha256(secret, raw_body).hex(); valid = constant_time_equal(expected, request.headers['X-Renown-Signature'])",
          notes: "Only present when the operator has configured a secret. Receivers should accept calls without the header in the no-secret case, but reject mismatches when a secret is in use.",
        },
      }, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
    });
