import type {
  LinkedProviderBinding,
  LinkedProviderGrant,
} from "@absolutejs/linked-providers";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import {
  type AnyPgTable,
  bigint,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  created_at: timestamp("created_at").notNull().defaultNow(),
  // Billing (Stripe). tier is the source of truth for what the account has paid for; it is
  // purely revenue/cost-offset — NO gameplay, 1/1s, or leaderboard rank is gated by it.
  current_period_end: timestamp("current_period_end"),
  email: varchar("email", { length: 320 }),
  first_name: varchar("first_name", { length: 255 }),
  last_name: varchar("last_name", { length: 255 }),
  primary_auth_identity_id: varchar("primary_auth_identity_id", {
    length: 255,
  }),
  stripe_customer_id: varchar("stripe_customer_id", { length: 255 }),
  stripe_subscription_id: varchar("stripe_subscription_id", { length: 255 }),
  sub: varchar("sub", { length: 36 }).primaryKey(),
  subscription_status: varchar("subscription_status", { length: 32 }),
  tier: varchar("tier", { length: 32 }).notNull().default("free"),
});

export const authIdentities = pgTable("auth_identities", {
  auth_provider: varchar("auth_provider", { length: 64 }).notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  id: varchar("id", { length: 255 }).primaryKey(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  provider_subject: varchar("provider_subject", { length: 255 }).notNull(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  user_sub: varchar("user_sub", { length: 255 }).notNull(),
});

export const authIdentityMergeRequests = pgTable(
  "auth_identity_merge_requests",
  {
    conflicting_auth_provider: varchar("conflicting_auth_provider", {
      length: 64,
    }).notNull(),
    conflicting_provider_subject: varchar("conflicting_provider_subject", {
      length: 255,
    }).notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    id: varchar("id", { length: 255 }).primaryKey(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    source_user_sub: varchar("source_user_sub", { length: 255 }).notNull(),
    status: varchar("status", { length: 64 }).notNull(),
    target_user_sub: varchar("target_user_sub", { length: 255 }).notNull(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
);

export const authSessions = pgTable("auth_sessions", {
  access_token: text("access_token").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  expires_at_ms: bigint("expires_at_ms", { mode: "number" }).notNull(),
  id: varchar("id", { length: 255 }).primaryKey(),
  refresh_token: text("refresh_token"),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  user_json: jsonb("user_json").$type<Record<string, unknown>>().notNull(),
});

export const authUnregisteredSessions = pgTable("auth_unregistered_sessions", {
  access_token: text("access_token"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  expires_at_ms: bigint("expires_at_ms", { mode: "number" }).notNull(),
  id: varchar("id", { length: 255 }).primaryKey(),
  refresh_token: text("refresh_token"),
  session_information_json: jsonb("session_information_json").$type<
    Record<string, unknown>
  >(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  user_identity_json:
    jsonb("user_identity_json").$type<Record<string, unknown>>(),
});

export const linkedProviderGrants = pgTable("linked_provider_grants", {
  access_token_ciphertext: text("access_token_ciphertext"),
  auth_provider_key: varchar("auth_provider_key", { length: 64 }).notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  expires_at: timestamp("expires_at"),
  granted_scopes: jsonb("granted_scopes")
    .$type<string[]>()
    .notNull()
    .default([]),
  id: varchar("id", { length: 255 }).primaryKey(),
  last_refresh_error: text("last_refresh_error"),
  last_refreshed_at: timestamp("last_refreshed_at"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  owner_ref: varchar("owner_ref", { length: 255 }).notNull(),
  provider_family: varchar("provider_family", { length: 64 }).notNull(),
  provider_subject: varchar("provider_subject", { length: 255 }).notNull(),
  refresh_token_ciphertext: text("refresh_token_ciphertext"),
  status: varchar("status", { length: 64 })
    .$type<LinkedProviderGrant["status"]>()
    .notNull(),
  token_type: varchar("token_type", { length: 64 }),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const linkedProviderBindings = pgTable("linked_provider_bindings", {
  available_scopes: jsonb("available_scopes")
    .$type<string[]>()
    .notNull()
    .default([]),
  capabilities: jsonb("capabilities").$type<string[]>().default([]),
  connector_provider: varchar("connector_provider", { length: 64 }).notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  email: varchar("email", { length: 320 }),
  external_account_id: varchar("external_account_id", {
    length: 255,
  }).notNull(),
  external_account_type: varchar("external_account_type", {
    length: 64,
  }).notNull(),
  grant_id: varchar("grant_id", { length: 255 }).notNull(),
  id: varchar("id", { length: 255 }).primaryKey(),
  label: varchar("label", { length: 255 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  status: varchar("status", { length: 64 })
    .$type<LinkedProviderBinding["status"]>()
    .notNull(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  username: varchar("username", { length: 255 }),
});

// NOTE: the M2M (client_credentials) tables `auth_api_clients` / `auth_access_tokens` are NOT
// declared here — the @absolutejs/auth Neon apikeys stores (createNeonApiClientStore /
// createNeonAccessTokenStore) auto-create + own them at runtime. Declaring them here just makes
// drizzle-kit (which excludes them via tablesFilter on introspection) try to re-create them and
// fail with "relation already exists". Leave them to the stores.

export const schema = {
  authIdentities,
  authIdentityMergeRequests,
  authSessions,
  authUnregisteredSessions,
  linkedProviderBindings,
  linkedProviderGrants,
  users,
} satisfies Record<string, AnyPgTable>;

export type SchemaType = typeof schema;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthIdentity = typeof authIdentities.$inferSelect;
export type NewAuthIdentity = typeof authIdentities.$inferInsert;
export type AuthIdentityMergeRequest =
  typeof authIdentityMergeRequests.$inferSelect;
export type NewAuthIdentityMergeRequest =
  typeof authIdentityMergeRequests.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
export type AuthUnregisteredSession =
  typeof authUnregisteredSessions.$inferSelect;
export type NewAuthUnregisteredSession =
  typeof authUnregisteredSessions.$inferInsert;
export type LinkedProviderGrantRow = typeof linkedProviderGrants.$inferSelect;
export type NewLinkedProviderGrantRow =
  typeof linkedProviderGrants.$inferInsert;
export type LinkedProviderBindingRow =
  typeof linkedProviderBindings.$inferSelect;
export type NewLinkedProviderBindingRow =
  typeof linkedProviderBindings.$inferInsert;

export type DatabaseFunctionProps = {
  db: NeonHttpDatabase<SchemaType>;
  schema: SchemaType;
};
