// Minimal auth config for renown: GitHub + Google login. All link/merge hooks are optional
// and omitted. The renown-specific bit lives in onProfileSuccess: a successful GitHub login
// PROVES the player owns that GitHub login, so we flip players.github_verified and recompute
// their authoritative verified_score — this is what lights up the real leaderboard.
import { defineAuthConfig, instantiateUserSession } from "@absolutejs/auth";
import { eq } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { SchemaType, User } from "../../../db/schema";
import { players } from "../../../../db/schema.ts";
import { gameDb } from "../sync.ts";
import { verifyGithub } from "../verify.ts";
import { createUser, getUser } from "../handlers/userHandlers";
import { providersConfiguration } from "./providersConfiguration";

// On a verified GitHub login, bind + verify the canonical player row (keyed by the login
// under OAuth control, so nobody can impersonate someone's login) and recompute their score.
const onGithubVerified = async (login: string) => {
  const id = `gh:${login}`;
  await gameDb.insert(players).values({ id, handle: login.slice(0, 40), githubLogin: login, githubVerified: true })
    .onConflictDoUpdate({ target: players.id, set: { githubVerified: true, githubLogin: login } });
  const v = await verifyGithub(login);
  if (v) await gameDb.update(players).set({ verifiedScore: v.score, verifiedAt: new Date() }).where(eq(players.id, id));
};

export const authConfig = (db: NeonHttpDatabase<SchemaType>) =>
  defineAuthConfig<User>({
    providersConfiguration,
    onCallbackSuccess: async ({ authProvider, providerInstance, session, tokenResponse, unregisteredSession, cookie: { user_session_id } }) =>
      instantiateUserSession<User>({
        authProvider,
        providerInstance,
        session,
        tokenResponse,
        unregisteredSession,
        user_session_id,
        getUser: (userIdentity) => getUser({ authProvider, db, userIdentity }),
        onNewUser: async (userIdentity) => {
          const user = await createUser({ authProvider, db, userIdentity });
          if (user === undefined) throw new Error("Failed to create user");
          return user;
        }
      }),
    onProfileSuccess: async ({ authProvider, userProfile }) => {
      if (authProvider !== "github") return;
      const login = (userProfile as { login?: string }).login;
      if (login) await onGithubVerified(login).catch((e) => console.error("renown: github verify failed", e));
    }
  });
