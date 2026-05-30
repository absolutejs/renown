import { networking, prepare } from "@absolutejs/absolute";
import { apiKeysRoutes, auth, createNeonAccessTokenStore, createNeonApiClientStore, createNeonAuthSessionStore } from "@absolutejs/auth";
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

const { absolutejs, manifest } = await prepare();
const databaseUrl = process.env.DATABASE_URL!;
const authDb = drizzle(neon(databaseUrl), { schema });          // auth-schema client (users, identities, sessions)
const authSessionStore = createNeonAuthSessionStore<User>(databaseUrl);
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
let server: any = new Elysia();
server = server.use(absolutejs);
server = server.use(rateLimiting());   // anon/authed buckets + tight limits & bot guard on costly paths (must be early)
server = server.use(await auth<User>({ ...authConfig(authDb), authSessionStore }));   // /oauth2/<provider>/authorization, /oauth2/callback, /oauth2/status…
server = server.use(credentialsPlugin({ authSessionStore, db: authDb }));   // POST /auth/{register,login,verify-email,reset-password,reset-password/request}
server = server.use(apiKeysRoutes({ accessTokenStore, apiClientStore }));   // POST /oauth2/token (client_credentials grant)
server = server.use(sync({ hub }));   // live push to browsers: GET /sync?topics=top,player:<id>
server = server.use(apiPlugin({ accessTokenStore }));
server = server.use(authApiPlugin({ authSessionStore, db: authDb }));   // /api/account/* — manage your linked logins
server = server.use(adminAuthPlugin({ db: authDb }));   // /admin/login + /api/admin/* (separate cookie realm)
server = server.use(stripePlugin({ authSessionStore, db: authDb }));   // /stripe/config, /billing/*, /webhooks/stripe (no-op without keys)
server = server.use(wellKnownPlugin());   // /.well-known/renown-providers.json — self-discovery for AI providers
server = server.use(pushPlugin());   // /sw.js — Web Push service worker for cross-tab/closed-tab notifications
server = server.use(cronPlugin());   // hourly attestation-expiry sweep (and any future scheduled tasks)
server = server.use(pagesPlugin(manifest));
server = server.use(networking);
server = server
  .onStop(async () => { await playerCache.flush(); })
  .on("error", (error: { request: Request; message: string }) => {
    const { request } = error;
    console.error(`Server error on ${request.method} ${request.url}: ${error.message}`);
  });

export type Server = typeof server;
