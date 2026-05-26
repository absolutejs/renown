// Register an M2M (client_credentials) client for renown's trusted server-to-server auth.
//
//   bun run scripts/provision-m2m-client.ts "renown-server" renown:submit,renown:verify
//
// Prints the clientId + clientSecret ONCE. Store them as RENOWN_CLIENT_ID / RENOWN_CLIENT_SECRET
// on the trusted backend (env, not in source). The secret is hashed at rest and cannot be
// recovered — re-provision if you lose it. This is for first-party/partner backends, NOT the
// public CLI (whose real per-user proof is the GitHub token on `renown link`).
import { createApiClient, createNeonApiClientStore } from "@absolutejs/auth";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL not set (run from web/ where .env lives)."); process.exit(1); }

const name = process.argv[2] ?? "renown-server";
const scopes = (process.argv[3] ?? "renown:submit,renown:verify").split(",").map((s) => s.trim()).filter(Boolean);

const store = createNeonApiClientStore(databaseUrl);
const { clientId, clientSecret } = await createApiClient(store, { name, scopes });

console.log("✓ provisioned M2M client\n");
console.log(`  name          : ${name}`);
console.log(`  scopes        : ${scopes.join(" ")}`);
console.log(`  RENOWN_CLIENT_ID     = ${clientId}`);
console.log(`  RENOWN_CLIENT_SECRET = ${clientSecret}`);
console.log("\nThe secret is shown only once. Exchange them at POST /oauth2/token (grant_type=client_credentials).");
