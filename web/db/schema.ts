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
  email: varchar("email", { length: 320 }),
  first_name: varchar("first_name", { length: 255 }),
  last_name: varchar("last_name", { length: 255 }),
  primary_auth_identity_id: varchar("primary_auth_identity_id", {
    length: 255,
  }),
  sub: varchar("sub", { length: 36 }).primaryKey(),
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

// M2M (client_credentials) tables. Defined locally — NOT imported from @absolutejs/auth —
// because drizzle-kit runs under CJS and can't load the package's ESM-only export. Column
// names/types mirror the package's Neon apikeys stores exactly (table names auth_api_clients /
// auth_access_tokens, all varchars length 255), so createNeon{ApiClient,AccessToken}Store work.
export const authApiClients = pgTable("auth_api_clients", {
  client_id: varchar("client_id", { length: 255 }).primaryKey(),
  created_at_ms: bigint("created_at_ms", { mode: "number" }).notNull(),
  hashed_secret: varchar("hashed_secret", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  owner_id: varchar("owner_id", { length: 255 }),
  scopes: text("scopes").array().notNull(),
});

export const authAccessTokens = pgTable("auth_access_tokens", {
  client_id: varchar("client_id", { length: 255 }).notNull(),
  created_at_ms: bigint("created_at_ms", { mode: "number" }).notNull(),
  expires_at_ms: bigint("expires_at_ms", { mode: "number" }).notNull(),
  hashed_token: varchar("hashed_token", { length: 255 }).notNull(),
  owner_id: varchar("owner_id", { length: 255 }),
  scopes: text("scopes").array().notNull(),
  token_id: varchar("token_id", { length: 255 }).primaryKey(),
});

export const schema = {
  authAccessTokens,
  authApiClients,
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
