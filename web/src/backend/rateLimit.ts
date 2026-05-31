// Rate limiting + bot/abuse guard for the public surface. Modeled on ~/intent's server.ts.
//
// Philosophy: the leaderboard is VIEWABLE without signing in (good for growth), so reads get a
// generous per-IP anon bucket; signed-in callers get a much larger per-session bucket. The two
// genuinely costly things — GitHub-API calls (/verify, /cli/link, /m2m/recompute) and the OAuth
// entry points — get tight buckets + a UA-heuristic bot guard, because that's where bots and
// scammers actually burn our money. None of this gates gameplay.
import { createAbuseGuard, defaultBotClassifier } from "@absolutejs/auth";
import { Elysia } from "elysia";
import { rateLimit } from "elysia-rate-limit";

const MIN = 60_000;
const FIFTEEN_MIN = 15 * MIN;

const ASSET_RE = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|map|webmanifest|txt|xml|mp4|webm|mov|mp3|wav)$/i;
const SESSION_RE = /user_session_id=([^;]+)/;   // renown's @absolutejs/auth session cookie

const isStaticAsset = (pathname: string) => ASSET_RE.test(pathname);
// Never rate-limit the Stripe webhook (Stripe must always reach it; it has its own signature auth).
const isExempt = (pathname: string) => isStaticAsset(pathname) || pathname === "/webhooks/stripe";

const sessionKey = (request: Request): string | null => {
  const cookie = request.headers.get("cookie");
  const m = cookie?.match(SESSION_RE);
  return m ? `s:${m[1]}` : null;
};

// Only trust client-supplied forwarding headers when we're actually behind a proxy that sets
// them (set RENOWN_TRUST_PROXY=1). Otherwise an attacker spoofs a unique X-Forwarded-For per
// request and gets a fresh bucket every time, nullifying every limiter. Default = use the
// unspoofable socket IP.
const TRUST_PROXY = process.env.RENOWN_TRUST_PROXY === "1" || process.env.RENOWN_TRUST_PROXY === "true";
const ipGenerator = (request: Request, server: { requestIP?: (r: Request) => { address?: string } | null } | null) => {
  if (TRUST_PROXY) {
    const cf = request.headers.get("cf-connecting-ip");
    if (cf) return cf.trim();
    const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  return server?.requestIP?.(request)?.address ?? "unknown";
};

const sessionGenerator = (request: Request, server: Parameters<typeof ipGenerator>[1]) =>
  sessionKey(request) ?? ipGenerator(request, server);

const path = (request: Request) => new URL(request.url).pathname;

// The expensive GitHub-API / identity paths (cost real money / GitHub quota).
const EXPENSIVE = ["/api/verify", "/api/cli/link", "/api/m2m/recompute", "/api/ci/repo-sync"];
const isExpensive = (p: string) => EXPENSIVE.some((e) => p === e);
// Unauthenticated self-report writes — gameplay submits land here. Bounded so a single source
// can't spam-farm fake players / rapid achievement claims (see docs/trust-model.md).
const isWrite = (p: string) => p === "/api/submit";
// OAuth + token entry points (credential surface bots probe).
const isAuthEntry = (p: string) => p.startsWith("/oauth2/");

// Generous per-session bucket for signed-in callers (only applies when a session cookie is present).
const authedRateLimit = rateLimit({
  duration: MIN, max: 600, generator: sessionGenerator, scoping: "global",
  skip: (request) => isExempt(path(request)) || !sessionKey(request),
});

// Tighter per-IP bucket for anonymous callers (only applies when there's no session).
const anonRateLimit = rateLimit({
  duration: MIN, max: 100, generator: ipGenerator, scoping: "global",
  skip: (request) => isExempt(path(request)) || Boolean(sessionKey(request)),
});

// Costly GitHub-API / identity-binding paths: small bucket, keyed by session-or-IP.
const expensiveRateLimit = rateLimit({
  duration: FIFTEEN_MIN, max: 30, generator: sessionGenerator, scoping: "global",
  skip: (request) => !isExpensive(path(request)),
});

// Gameplay submit bucket — generous enough for legit heartbeats (well under 2/s) but bounds a
// single session/IP from spam-creating players or hammering the rarity counter.
const writeRateLimit = rateLimit({
  duration: MIN, max: 120, generator: sessionGenerator, scoping: "global",
  skip: (request) => !isWrite(path(request)),
});

// OAuth / token entry points: small per-IP bucket.
const authEntryRateLimit = rateLimit({
  duration: FIFTEEN_MIN, max: 40, generator: ipGenerator, scoping: "global",
  skip: (request) => !isAuthEntry(path(request)),
});

// UA-heuristic bot guard (headers only, no body) ONLY on the HUMAN browser OAuth flows
// (authorize / callback) — denies obvious non-human callers (empty UA, curl/python-requests/
// headless) before they start a login. It must NOT cover machine paths: /oauth2/token (M2M
// client_credentials), /api/cli/link, and /api/m2m/recompute are server-to-server by design and
// authenticate by secret/token — they'd be falsely flagged as bots. Those rely on rate limits +
// their own auth instead. Set ABUSE_IP_DENYLIST=ip,cidr,… to add IPs.
const isHumanOAuth = (p: string) => isAuthEntry(p) && p !== "/oauth2/token";
const GUARDED = (p: string) => isHumanOAuth(p);
const abuseGuard = createAbuseGuard({
  classifyBot: defaultBotClassifier,
  ipDeny: (process.env.ABUSE_IP_DENYLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean),
});
const abuseIp = (request: Request, server: Parameters<typeof ipGenerator>[1] = null) =>
  ipGenerator(request, server);

// One plugin that installs every limiter + the guard. Mounted early in server.ts.
export const rateLimiting = () =>
  new Elysia({ name: "renown-rate-limit" })
    .use(authedRateLimit)
    .use(anonRateLimit)
    .use(expensiveRateLimit)
    .use(writeRateLimit)
    .use(authEntryRateLimit)
    .onRequest(async ({ request, status, server }) => {
      if (!GUARDED(path(request))) return;
      const { action } = await abuseGuard.assess({ ip: abuseIp(request, server), userAgent: request.headers.get("user-agent") ?? undefined });
      if (action === "deny") return status("Forbidden", "Request blocked");
    });
