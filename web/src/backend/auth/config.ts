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
import { and, eq, sql } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { authIdentities } from "../../../db/schema";
import type { SchemaType, User } from "../../../db/schema";
import { players, playerAccounts } from "../../../../db/schema.ts";
import { gameDb } from "../sync.ts";
import { verifyGithub } from "../verify.ts";
import { resolvePlayerByGithubLogin, resolvePlayerByUserSub } from "../resolvePlayer.ts";
import { rollupPlayerFromAccounts } from "../playerAccounts.ts";
import { advanceAllTimeVerifiedScore } from "../allTimeScore.ts";
import {
  createUser,
  getDBUser,
  getUser,
  linkUserIdentity,
  upsertDBAuthIdentityMergeRequest,
} from "../handlers/userHandlers";
import { providersConfiguration } from "./providersConfiguration";
import { assertReservedAiClaim, markReservedAiClaimed } from "../reservedAiClaim.ts";
import { oauthAccessToken, oauthErrorCode, replaceSessionAccessToken } from "./oauthCallback.ts";

// On a verified GitHub login, bind + verify the canonical player row (keyed by the login
// under OAuth control, so nobody can impersonate someone's login) and recompute their score.
// Same formula for everyone: verified_score = base_recompute + accumulated attribution credit.
// The default `attribution_query = author:<login>` gives every user credit for commits they
// authored across GitHub — same rule as everyone, no special carve-outs.
//
// AI accounts (players.is_ai = true) are a special case: AIs rarely appear as the GitHub
// commit author — they show up in the `Co-authored-by:` trailer of a human's commit. So if
// the existing player row is already flagged as AI, we leave its attribution_query alone
// (it will have been set by an admin/migration to a co-author search). Only set the default
// for fresh / non-AI rows.
const defaultAttributionQuery = (login: string) => `author:${login}`;
// A proven GitHub login (first login OR a later linked one) binds to the user's ONE canonical
// player and verifies that github as one of the player's accounts — it does NOT mint a new
// player per login (the multi-github fix). The auth identity already exists by the time this
// runs (createUser / linkUserIdentity wrote it), so we resolve the owning user from it.
const onGithubVerified = async (login: string) => {
  const lower = login.toLowerCase();
  const ident = (await gameDb.select({ userSub: authIdentities.user_sub, providerSubject: authIdentities.provider_subject }).from(authIdentities)
    .where(and(eq(authIdentities.auth_provider, "github"), sql`lower(coalesce(${authIdentities.metadata}->>'login', ${authIdentities.provider_subject})) = ${lower}`)).limit(1))[0];
  const userSub = ident?.userSub ?? null;
  // Reserved AI personas require the immutable GitHub numeric ID. Matching a mutable username
  // is deliberately insufficient, even if an auth identity row already exists.
  const reservedClaim = await assertReservedAiClaim(login, ident?.providerSubject);
  // Canonical player: by user (preferred) → by this login (legacy) → create on first github.
  // A valid reserved claim always adopts the pre-existing persona; it must never attach the
  // protected login to some other player merely because the claimant already has a Renown user.
  let player = reservedClaim
    ? await resolvePlayerByGithubLogin(login)
    : (userSub ? await resolvePlayerByUserSub(userSub) : null) ?? await resolvePlayerByGithubLogin(login);
  if (!player) {
    const id = `gh:${login}`;   // keep gh:<login> as the id for the user's FIRST github (back-compat)
    await gameDb.insert(players).values({ attributionQuery: defaultAttributionQuery(login), githubLogin: login, githubVerified: true, handle: login.slice(0, 40), id, userSub })
      .onConflictDoUpdate({ target: players.id, set: { githubVerified: true, githubLogin: login, ...(userSub ? { userSub } : {}) } });
    player = (await gameDb.select().from(players).where(eq(players.id, id)).limit(1))[0]!;
  } else {
    // Existing player: ensure verified + stamp user_sub if it wasn't set; never clobber the primary login.
    await gameDb.update(players).set({ githubVerified: true, ...(player.userSub || !userSub ? {} : { userSub }) }).where(eq(players.id, player.id));
  }
  const isPrimary = !player.githubLogin || player.githubLogin.toLowerCase() === lower;
  // Provenance ledger row for this github; backfill the default query only for the primary.
  await gameDb.insert(playerAccounts).values({ playerId: player.id, githubLogin: login, attributionQuery: defaultAttributionQuery(login), githubVerified: true })
    .onConflictDoUpdate({ target: [playerAccounts.playerId, playerAccounts.githubLogin], set: { githubVerified: true } });
  if (reservedClaim) await markReservedAiClaimed({ playerId: player.id, login, githubSubject: ident!.providerSubject, userSub });
  if (isPrimary) await gameDb.execute(sql`UPDATE players SET attribution_query = ${defaultAttributionQuery(login)} WHERE id = ${player.id} AND attribution_query IS NULL AND is_ai = false`);
  // Verify this github's base into its account row (base + its own attribution), then roll up.
  const v = await verifyGithub(login);
  if (v) {
    const a = (await gameDb.select({ verifiedScore: playerAccounts.verifiedScore, attributionScore: playerAccounts.attributionScore }).from(playerAccounts).where(and(eq(playerAccounts.playerId, player.id), sql`lower(${playerAccounts.githubLogin}) = ${lower}`)).limit(1))[0];
    const score = advanceAllTimeVerifiedScore({ currentVerifiedScore: Number(a?.verifiedScore ?? 0), currentAttributionScore: Number(a?.attributionScore ?? 0), recomputedBaseScore: v.score });
    await gameDb.update(playerAccounts).set({ verifiedScore: score.verifiedScore, verifiedAt: new Date() }).where(and(eq(playerAccounts.playerId, player.id), sql`lower(${playerAccounts.githubLogin}) = ${lower}`));
  }
  await rollupPlayerFromAccounts(player.id);
};

export const authConfig = (db: NeonHttpDatabase<SchemaType>) =>
  defineAuthConfig<User>({
    getUser: (sub) => getDBUser({ db, userSub: sub }).then((user) => user ?? null),
    providersConfiguration,
    // Signed in already? Then this OAuth round-trip is LINKING another login to the current
    // account, not a fresh login. (renown has no connectors yet, so we never link_connector.)
    resolveAuthIntent: ({ currentUser }) =>
      currentUser !== undefined ? "link_identity" : "login",
    onCallbackSuccess: async ({ authProvider, providerConfiguration, providerInstance, redirect, session, tokenResponse, unregisteredSession, cookie: { user_session_id } }) => {
      if (!oauthAccessToken(tokenResponse)) {
        console.error("renown: oauth token exchange returned no access token", { authProvider, error: oauthErrorCode(tokenResponse) });
        return redirect(authProvider === "github" ? "/repos?github=oauth-error" : "/?oauth_error=provider");
      }
      let resolvedAuthorization;
      try {
        resolvedAuthorization = await resolveOAuthAuthorization({ authProvider, providerConfiguration, providerInstance, tokenResponse });
      } catch (error) {
        // Do not leak the provider response or token to the browser. The server log retains the
        // provider/status detail needed to distinguish a revoked token from an exchange failure.
        console.error("renown: oauth identity resolution failed", { authProvider, error: error instanceof Error ? error.message : String(error) });
        return redirect(authProvider === "github" ? "/repos?github=oauth-error" : "/?oauth_error=provider");
      }
      return instantiateUserSession<User>({
        authProvider,
        providerConfiguration,
        providerInstance,
        resolvedAuthorization,
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
      });
    },
    // Add a second (or third) login to the already-signed-in user.
    onLinkIdentity: async ({ authProvider, currentUser, providerConfiguration, providerInstance, redirect, session, tokenResponse, userSessionId }) => {
      if (currentUser === undefined) throw new Error("Identity linking requires an active signed-in user");
      if (!oauthAccessToken(tokenResponse)) {
        console.error("renown: oauth link returned no access token", { authProvider, error: oauthErrorCode(tokenResponse) });
        return redirect(authProvider === "github" ? "/repos?github=oauth-error" : "/?oauth_error=provider");
      }
      let authorization;
      try {
        authorization = await resolveOAuthAuthorization({ authProvider, providerConfiguration, providerInstance, tokenResponse });
      } catch (error) {
        console.error("renown: oauth link identity resolution failed", { authProvider, error: error instanceof Error ? error.message : String(error) });
        return redirect(authProvider === "github" ? "/repos?github=oauth-error" : "/?oauth_error=provider");
      }
      const { userIdentity } = authorization;
      const linked = await linkUserIdentity({ authProvider, db, userIdentity, userSub: currentUser.sub });
      // Linking a GitHub login also verifies the player (same as a first-time GitHub login).
      if (authProvider === "github") {
        // The auth library keeps one provider token on the active session. Reconnecting GitHub
        // must replace an older GitHub/Google token or `/api/account/repos` cannot use the newly
        // granted private-repository scope.
        replaceSessionAccessToken(session, userSessionId, authorization.accessToken, authorization.refreshToken);
        const login = (userIdentity as { login?: string }).login;
        if (login) await onGithubVerified(login).catch((e) => console.error("renown: github verify failed", e));
      }
      if (authProvider === "github") return redirect(`/repos?github=${linked.status === "already_linked" ? "reconnected" : "linked"}`);
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
