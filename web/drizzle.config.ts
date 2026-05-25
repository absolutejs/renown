import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // CRITICAL: only manage the auth tables here. The game tables (players,
  // achievements, projects, …) are owned by ../db — never let this push touch them.
  tablesFilter: ["users", "auth_identities", "auth_identity_merge_requests", "auth_sessions", "auth_unregistered_sessions", "linked_provider_grants", "linked_provider_bindings"],
});
