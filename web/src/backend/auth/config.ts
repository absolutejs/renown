// Auth config for renown: GitHub + Google login, with multi-login account linking.
//
// One renown user can sign in with MORE THAN ONE provider. The model (copied from
// examples/auth) keys logins in `auth_identities` (auth_provider + provider_subject ->
// user_sub); the FIRST login creates the user, and any later login while already signed
// in is LINKED to that same user instead of making a new account (resolveAuthIntent ->
// "link_identity"). If the second login already belongs to a different user, we queue a
// merge request (onLinkIdentityConflict) the user can accept later.
//
// The renown-specific bit lives in onProfileSuccess / onGithubVerified: a proven GitHub
// login flips players.github_verified and recomputes the authoritative verified_score —
// this is what lights up the real leaderboard. It fires whether GitHub is the first login
// or a later linked one.
import {
  defineAuthConfig,
  instantiateUserSession,
  resolveOAuthAuthorization,
} from "@absolutejs/auth";
import { eq } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { SchemaType, User } from "../../../db/schema";
import { players } from "../../../../db/schema.ts";
import { gameDb } from "../sync.ts";
import { verifyGithub } from "../verify.ts";
import {
  createUser,
  getUser,
  linkUserIdentity,
  upsertDBAuthIdentityMergeRequest,
} from "../handlers/userHandlers";
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
    // Signed in already? Then this OAuth round-trip is LINKING another login to the current
    // account, not a fresh login. (renown has no connectors yet, so we never link_connector.)
    resolveAuthIntent: ({ currentUser }) =>
      currentUser !== undefined ? "link_identity" : "login",
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
    // Add a second (or third) login to the already-signed-in user.
    onLinkIdentity: async ({ authProvider, currentUser, providerInstance, redirect, tokenResponse }) => {
      if (currentUser === undefined) throw new Error("Identity linking requires an active signed-in user");
      const { userIdentity } = await resolveOAuthAuthorization({ authProvider, providerInstance, tokenResponse });
      const linked = await linkUserIdentity({ authProvider, db, userIdentity, userSub: currentUser.sub });
      // Linking a GitHub login also verifies the player (same as a first-time GitHub login).
      if (authProvider === "github") {
        const login = (userIdentity as { login?: string }).login;
        if (login) await onGithubVerified(login).catch((e) => console.error("renown: github verify failed", e));
      }
      return redirect(linked.status === "already_linked" ? "/?linked=already" : `/?linked=${authProvider}`);
    },
    // The login the user tried to add already belongs to a different account: queue a merge
    // they can accept from the UI (POST /api/auth-identity-merge-requests/:id/merge).
    onLinkIdentityConflict: async ({ conflict, currentUser, redirect }) => {
      if (currentUser === undefined) throw new Error("Identity conflict requires an active signed-in user");
      await upsertDBAuthIdentityMergeRequest({
        authProvider: conflict.authProvider,
        db,
        metadata: { currentUserSub: currentUser.sub, intent: conflict.intent },
        providerSubject: conflict.providerSubject,
        sourceUserSub: conflict.existingUserAuthSub,
        targetUserSub: currentUser.sub
      });
      return redirect("/?merge=pending");
    },
    onProfileSuccess: async ({ authProvider, userProfile }) => {
      if (authProvider !== "github") return;
      const login = (userProfile as { login?: string }).login;
      if (login) await onGithubVerified(login).catch((e) => console.error("renown: github verify failed", e));
    }
  });
