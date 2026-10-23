import { networking, prepare } from "@absolutejs/absolute";
import { apiKeysRoutes, auth, createNeonAccessTokenStore, createNeonApiClientStore, createNeonAuthSessionStore, createNeonLinkedProviderStores, createOAuthLinkedProviderCredentialResolver } from "@absolutejs/auth";
import { sync } from "@absolutejs/sync";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Elysia } from "elysia";
import { adminAuthPlugin } from "./plugins/adminAuthPlugin";
import { apiPlugin } from "./plugins/apiPlugin";
import { authApiPlugin } from "./plugins/authApiPlugin";
import { credentialsPlugin } from "./plugins/credentialsPlugin";
import { cronPlugin } from "./plugins/cronPlugin";
import { pagesPlugin } from "./plugins/pagesPlugin";
import { pushPlugin } from "./plugins/pushPlugin";
import { stripePlugin } from "./plugins/stripePlugin";
import { wellKnownPlugin } from "./plugins/wellKnownPlugin";
import { rateLimiting } from "./rateLimit";
import { hub, playerCache } from "./sync";
import { relations, type User } from "../../db/schema";
import { authConfig } from "./auth/config";
import { decodeSessionUser } from "./auth/decodeSessionUser";
import { providersConfiguration } from "./auth/providersConfiguration";

const { absolutejs, manifest } = await prepare();
const databaseUrl = process.env.DATABASE_URL!;
const authDb = drizzle({ client: neon(databaseUrl), relations });          // auth-schema client (users, identities, sessions)
const authSessionStore = createNeonAuthSessionStore<User>(databaseUrl, decodeSessionUser);
const linkedProviderStores = createNeonLinkedProviderStores(databaseUrl);
const linkedProviderCredentialResolver = await createOAuthLinkedProviderCredentialResolver({ ...linkedProviderStores, providersConfiguration });
// M2M (client_credentials): registered machine clients + the short-lived bearer tokens they mint.
const apiClientStore = createNeonApiClientStore(databaseUrl);
const accessTokenStore = createNeonAccessTokenStore(databaseUrl);

// flush any pending write-behind writes to Neon on shutdown so nothing is lost
const flushOnExit = async () => { try { await playerCache.flush(); } catch {} process.exit(0); };
process.on("SIGINT", flushOnExit);
process.on("SIGTERM", flushOnExit);

// The full inferred type of this plugin chain exceeds TypeScript's union-representation
// ceiling (TS2590), and nothing consumes an Eden treaty type from the server, so we build it
// through an `any`-typed local. That stops the per-`.use()` type accumulation; runtime is
// identical because Elysia augments and returns the same instance in place.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Elysia adds each plugin to this one instance in place, so registration is a statement per
// plugin; a typed const (not `any`) keeps every call checked against the installed Elysia.
const builtApp = new Elysia();
builtApp.onAfterHandle(({ set }) => {
  // Privacy/security defaults for every HTML/API response. no-referrer also protects any
  // already-issued legacy auth links that carried a token in the query string.
  set.headers["referrer-policy"] = "no-referrer";
  set.headers["x-content-type-options"] = "nosniff";
  set.headers["permissions-policy"] = "camera=(), geolocation=(), microphone=()";
});
builtApp.use(absolutejs);
builtApp.use(rateLimiting());   // anon/authed buckets + tight limits & bot guard on costly paths (must be early)
builtApp.use(await auth<User>({ ...authConfig(authDb, linkedProviderStores), authSessionStore }));   // /oauth2/<provider>/authorization, /oauth2/callback, /oauth2/status…
builtApp.use(credentialsPlugin({ authSessionStore, db: authDb }));   // POST /auth/{register,login,verify-email,reset-password,reset-password/request}
builtApp.use(apiKeysRoutes({ accessTokenStore, apiClientStore }));   // POST /oauth2/token (client_credentials grant)
builtApp.use(sync({ hub }));   // live push to browsers: GET /sync?topics=top,player:<id>
builtApp.use(apiPlugin({ accessTokenStore }));
builtApp.use(authApiPlugin({ authSessionStore, ...linkedProviderStores, credentialResolver: linkedProviderCredentialResolver, db: authDb }));   // /api/account/* — manage your linked logins
builtApp.use(adminAuthPlugin({ db: authDb }));   // /admin/login + /api/admin/* (separate cookie realm)
builtApp.use(stripePlugin({ authSessionStore, db: authDb }));   // /stripe/config, /billing/*, /webhooks/stripe (no-op without keys)
builtApp.use(wellKnownPlugin());   // /.well-known/renown-providers.json — self-discovery for AI providers
builtApp.use(pushPlugin());   // /sw.js — Web Push service worker for cross-tab/closed-tab notifications
// Scheduled jobs run on exactly one deployment of the shared database: while a second
// copy is staged (a host move), it runs with RENOWN_CRONS=off so digests and outbox
// transfers are not sent twice.
if (process.env.RENOWN_CRONS !== "off")
  builtApp.use(cronPlugin());   // hourly attestation-expiry sweep (and any future scheduled tasks)
builtApp.use(pagesPlugin(manifest));
builtApp
  .onStop(async () => { await playerCache.flush(); })
  // Elysia 2 has no generic .on(event); the handler's context carries the request and the error.
  .onError(({ request, error }) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Server error on ${request.method} ${request.url}: ${message}`);
  });

// `networking` WRAPS the fully-built app (Bun.serve + dev route introspection) as
// the canonical OUTERMOST form — and, crucially, this is the runtime VALUE export
// that `absolute start`/`absolute compile` mount as the backend. The prior form
// (`.use(networking)` as a plugin + only `export type Server`) built the app but
// never exported a server instance, so the compiled binary had no backend to serve
// and fell back to static pages only. Matches the dealroom (>=1064) pattern.
export const server = networking(builtApp);

export type Server = typeof server;
