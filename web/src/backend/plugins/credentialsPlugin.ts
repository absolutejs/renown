// Credentials (email + password) auth — wired via @absolutejs/auth's credentialRoutes.
//
// Locked behind email verification (`requireEmailVerification: true`): registration creates
// the account but NO session, and login is rejected until the email is verified.
//
// No email provider is wired yet — `onSendEmail` LOGS the verification/reset link to the
// server console for dev. The link points back at the SPA (`/?verify=<token>` / `/?reset=<token>`)
// which POSTs the token to the verify/reset endpoint. Plug in Brevo/Resend/SES here when ready.
import { type AuthSessionStore, credentialRoutes, createNeonCredentialStore } from "@absolutejs/auth";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { schema, SchemaType, User } from "../../../db/schema";

type Deps = { authSessionStore: AuthSessionStore<User>; db: NeonHttpDatabase<SchemaType> };

const APP_URL = process.env.APP_URL ?? "http://localhost:7777";

export const credentialsPlugin = ({ authSessionStore, db }: Deps) => {
  const credentialStore = createNeonCredentialStore(process.env.DATABASE_URL!);

  return credentialRoutes<User>({
    credentialStore,
    authSessionStore,
    requireEmailVerification: true,
    // Sent to the user's email (we log it for dev; in prod, plug in your provider here).
    onSendEmail: async (msg) => {
      const path = msg.type === "verify_email" ? "verify" : "reset";
      const link = `${APP_URL}/?${path}=${msg.token}`;
      console.log(`\n[renown:auth] → ${msg.type} for ${msg.email}\n  link: ${link}\n  token: ${msg.token}\n  expires: ${new Date(msg.expiresAt).toISOString()}\n`);
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
    onRegistrationSuccess: ({ email }) => console.log(`[renown:auth] registered ${email} (awaiting email verification)`),
    onEmailVerified: ({ email }) => console.log(`[renown:auth] email verified: ${email}`),
    onCredentialsLoginSuccess: ({ user }) => console.log(`[renown:auth] login: ${user.email}`),
  });
};
