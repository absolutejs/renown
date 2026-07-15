// Credentials (email + password) auth — wired via @absolutejs/auth's credentialRoutes.
//
// Locked behind email verification (`requireEmailVerification: true`): registration creates
// the account but NO session, and login is rejected until the email is verified.
//
// No production email provider is wired yet. Console token delivery requires an explicit
// non-production opt-in; production fails closed instead of writing account-takeover tokens to
// centralized logs. Links use URL fragments so tokens never enter HTTP access logs or Referers.
import { type AuthSessionStore, credentialRoutes, createNeonCredentialStore } from "@absolutejs/auth";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { schema } from "../../../db/schema";
import type { SchemaType, User } from "../../../db/schema";

type Deps = { authSessionStore: AuthSessionStore<User>; db: NeonHttpDatabase<SchemaType> };

const APP_URL = process.env.APP_URL ?? "http://localhost:7777";
const DEV_LOG_AUTH_TOKENS = process.env.NODE_ENV !== "production" && process.env.RENOWN_DEV_LOG_AUTH_TOKENS === "1";

export const credentialsPlugin = ({ authSessionStore, db }: Deps) => {
  const credentialStore = createNeonCredentialStore(process.env.DATABASE_URL!);

  return credentialRoutes<User>({
    credentialStore,
    authSessionStore,
    requireEmailVerification: true,
    // Replace this with transactional email before enabling credentials in production.
    onSendEmail: async (msg) => {
      if (!DEV_LOG_AUTH_TOKENS) throw new Error("credential email delivery is not configured");
      const path = msg.type === "verify_email" ? "verify" : "reset";
      const link = `${APP_URL}/#${path}=${encodeURIComponent(msg.token)}`;
      console.log(`\n[renown:auth:dev] ${msg.type}\n  link: ${link}\n  expires: ${new Date(msg.expiresAt).toISOString()}\n`);
    },
    getUserByEmail: async (email) => {
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase()));
      return rows[0] ?? null;
    },
    // Create the renown user row + a synthetic auth_identity for the credentials login so it
    // shows up in the "Your logins" list alongside GitHub / Google.
    onCreateCredentialUser: async (identity) => {
      const userSub = randomUUID();
      const email = identity.email.toLowerCase();
      const [user] = await db.insert(schema.users).values({ sub: userSub, email, primary_auth_identity_id: null }).returning();
      const id = `credentials:${email}`;
      const [ident] = await db.insert(schema.authIdentities).values({
        auth_provider: "credentials",
        id, metadata: { email },
        provider_subject: email,
        user_sub: userSub,
      }).returning();
      await db.update(schema.users).set({ primary_auth_identity_id: ident.id }).where(eq(schema.users.sub, userSub));
      return { ...user, primary_auth_identity_id: ident.id };
    },
    passwordPolicy: { minLength: 8, requireUppercase: false, requireLowercase: false, requireDigit: true, requireSymbol: false },
    onRegistrationSuccess: () => console.log("[renown:auth] credentials registration created (awaiting verification)"),
    onEmailVerified: () => console.log("[renown:auth] credentials email verified"),
    onCredentialsLoginSuccess: () => console.log("[renown:auth] credentials login succeeded"),
  }).onAfterHandle(({ set }) => { set.headers["cache-control"] = "private, no-store"; set.headers.pragma = "no-cache"; });
};
