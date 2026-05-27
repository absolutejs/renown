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
    });
