import { networking, prepare } from "@absolutejs/absolute";
import { apiKeysRoutes, auth, createNeonAccessTokenStore, createNeonApiClientStore, createNeonAuthSessionStore } from "@absolutejs/auth";
import { sync } from "@absolutejs/sync";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Elysia } from "elysia";
import { apiPlugin } from "./plugins/apiPlugin";
import { authApiPlugin } from "./plugins/authApiPlugin";
import { pagesPlugin } from "./plugins/pagesPlugin";
import { stripePlugin } from "./plugins/stripePlugin";
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

const server = new Elysia()
  .use(absolutejs)
  .use(rateLimiting())   // anon/authed buckets + tight limits & bot guard on costly paths (must be early)
  .use(await auth<User>({ ...authConfig(authDb), authSessionStore }))   // /oauth2/<provider>/authorization, /oauth2/callback, /oauth2/status…
  .use(apiKeysRoutes({ accessTokenStore, apiClientStore }))   // POST /oauth2/token (client_credentials grant)
  .use(sync({ hub }))   // live push to browsers: GET /sync?topics=top,player:<id>
  .use(apiPlugin({ accessTokenStore }))
  .use(authApiPlugin({ authSessionStore, db: authDb }))   // /api/account/* — manage your linked logins
  .use(stripePlugin({ authSessionStore, db: authDb }))   // /stripe/config, /billing/*, /webhooks/stripe (no-op without keys)
  .use(pagesPlugin(manifest))
  .use(networking)
  .onStop(async () => { await playerCache.flush(); })
  .on("error", (error) => {
    const { request } = error;
    console.error(`Server error on ${request.method} ${request.url}: ${error.message}`);
  });

export type Server = typeof server;
