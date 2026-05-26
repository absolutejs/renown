// Optional machine-to-machine auth for the renown CLI.
//
// IMPORTANT (open-source honesty): the public CLI does NOT need this. Leaderboard integrity
// does not rest on it — only github_verified rows rank, and /cli/link is gated by your real
// GitHub token. A client secret shipped in an open-source binary isn't truly secret, so we
// never gate the public CLI behind one. This exists for TRUSTED deployments (a self-hosted
// renown, a first-party ingest worker, an editor-vendor backend) that hold real credentials
// in env and want their writes recognized as first-party / call M2M-only endpoints.
//
// Set RENOWN_CLIENT_ID + RENOWN_CLIENT_SECRET (or cfg.clientId / cfg.clientSecret) and the
// CLI will exchange them for a short-lived bearer token at /oauth2/token and present it.
import type { Config } from "./runtime.ts";

let cached: { token: string; exp: number } | null = null;

const creds = (cfg: Config) => ({
  id: cfg.clientId ?? process.env.RENOWN_CLIENT_ID,
  secret: cfg.clientSecret ?? process.env.RENOWN_CLIENT_SECRET,
});

export async function clientToken(cfg: Config): Promise<string | undefined> {
  const { id, secret } = creds(cfg);
  if (!id || !secret || !cfg.leaderboardEndpoint) return undefined;
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;   // reuse until ~30s before expiry
  try {
    const origin = new URL(cfg.leaderboardEndpoint).origin;   // token route lives at the root, not under /api
    const r = await fetch(`${origin}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return undefined;
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return undefined;
    cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  } catch { return undefined; }
}

// Bearer header when a trusted-client token is available, otherwise empty (no-op for the public CLI).
export async function authHeaders(cfg: Config): Promise<Record<string, string>> {
  const t = await clientToken(cfg);
  return t ? { authorization: `Bearer ${t}` } : {};
}
