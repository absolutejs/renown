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
import { schema, type User } from "../../db/schema";
import { authConfig } from "./auth/config";
import { providersConfiguration } from "./auth/providersConfiguration";

const { absolutejs, manifest } = await prepare();
const databaseUrl = process.env.DATABASE_URL!;
const authDb = drizzle(neon(databaseUrl), { schema });          // auth-schema client (users, identities, sessions)
const authSessionStore = createNeonAuthSessionStore<User>(databaseUrl);
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
let builtApp: any = new Elysia();
builtApp = builtApp.onAfterHandle(({ set }: { set: { headers: Record<string, string> } }) => {
  // Privacy/security defaults for every HTML/API response. no-referrer also protects any
  // already-issued legacy auth links that carried a token in the query string.
  set.headers["referrer-policy"] = "no-referrer";
  set.headers["x-content-type-options"] = "nosniff";
  set.headers["permissions-policy"] = "camera=(), geolocation=(), microphone=()";
});
builtApp = builtApp.use(absolutejs);
builtApp = builtApp.use(rateLimiting());   // anon/authed buckets + tight limits & bot guard on costly paths (must be early)
builtApp = builtApp.use(await auth<User>({ ...authConfig(authDb, linkedProviderStores), authSessionStore }));   // /oauth2/<provider>/authorization, /oauth2/callback, /oauth2/status…
builtApp = builtApp.use(credentialsPlugin({ authSessionStore, db: authDb }));   // POST /auth/{register,login,verify-email,reset-password,reset-password/request}
builtApp = builtApp.use(apiKeysRoutes({ accessTokenStore, apiClientStore }));   // POST /oauth2/token (client_credentials grant)
builtApp = builtApp.use(sync({ hub }));   // live push to browsers: GET /sync?topics=top,player:<id>
builtApp = builtApp.use(apiPlugin({ accessTokenStore }));
builtApp = builtApp.use(authApiPlugin({ authSessionStore, ...linkedProviderStores, credentialResolver: linkedProviderCredentialResolver, db: authDb }));   // /api/account/* — manage your linked logins
builtApp = builtApp.use(adminAuthPlugin({ db: authDb }));   // /admin/login + /api/admin/* (separate cookie realm)
builtApp = builtApp.use(stripePlugin({ authSessionStore, db: authDb }));   // /stripe/config, /billing/*, /webhooks/stripe (no-op without keys)
builtApp = builtApp.use(wellKnownPlugin());   // /.well-known/renown-providers.json — self-discovery for AI providers
builtApp = builtApp.use(pushPlugin());   // /sw.js — Web Push service worker for cross-tab/closed-tab notifications
builtApp = builtApp.use(cronPlugin());   // hourly attestation-expiry sweep (and any future scheduled tasks)
builtApp = builtApp.use(pagesPlugin(manifest));
builtApp = builtApp
  .onStop(async () => { await playerCache.flush(); })
  .on("error", (error: { request: Request; message: string }) => {
    const { request } = error;
    console.error(`Server error on ${request.method} ${request.url}: ${error.message}`);
  });

// `networking` WRAPS the fully-built app (Bun.serve + dev route introspection) as
// the canonical OUTERMOST form — and, crucially, this is the runtime VALUE export
// that `absolute start`/`absolute compile` mount as the backend. The prior form
// (`.use(networking)` as a plugin + only `export type Server`) built the app but
// never exported a server instance, so the compiled binary had no backend to serve
// and fell back to static pages only. Matches the dealroom (>=1064) pattern.
export const server = networking(builtApp);

export type Server = typeof server;
