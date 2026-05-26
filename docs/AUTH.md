# renown auth

renown uses [`@absolutejs/auth`](https://github.com/absolutejs/auth) (citra-backed OAuth).
Two trust boundaries matter, and they are independent:

1. **Leaderboard integrity** — only `github_verified` player rows rank, by a server-recomputed
   `verified_score` pulled from the GitHub public API. Client-submitted xp **never** ranks.
   (see `ANTICHEAT.md`). Nothing below weakens or is required by this.
2. **Identity** — who a renown account is, and how the CLI proves it.

## Multiple logins for one account

One renown user can sign in with more than one provider (GitHub **and** Google). The model
(`web/db/schema.ts`, `web/src/backend/handlers/userHandlers.ts`) keys each login in
`auth_identities` as `(auth_provider, provider_subject) → user_sub`:

- **First login** creates the user + its first identity (`onCallbackSuccess` → `createUser`).
- **Already signed in?** The next OAuth round-trip *links* instead of creating a new account.
  `resolveAuthIntent` returns `link_identity` whenever there's a current user, so simply
  visiting `/oauth2/<provider>/authorization` while logged in attaches that login
  (`onLinkIdentity` → `linkUserIdentity`). Linking a **GitHub** login also verifies the player.
- **Conflict** (the login you tried to add already belongs to someone else) → a pending merge
  request is queued (`onLinkIdentityConflict`), which the owner can accept later.

### Account endpoints (session-protected, `/api/account/*`)

| Method | Path | What |
| --- | --- | --- |
| `GET` | `/api/account/` | your identities + pending merge requests |
| `POST` | `/api/account/identities/:id/primary` | set the canonical login |
| `DELETE` | `/api/account/identities/:id` | unlink (not the last / not the primary) |
| `POST` | `/api/account/merge-requests/:id/merge` | accept a merge |
| `DELETE` | `/api/account/merge-requests/:id` | decline a merge |

## Machine-to-machine (`client_credentials`)

The token endpoint is mounted at **`POST /oauth2/token`** (`apiKeysRoutes`). A registered client
exchanges its id+secret for a short-lived bearer token:

```
POST /oauth2/token
{ "grant_type": "client_credentials", "client_id": "...", "client_secret": "..." }
→ { "access_token": "at_…", "expires_in": 3600, "scope": "renown:submit renown:verify", "token_type": "Bearer" }
```

Provision a client (prints id+secret once; secret is hashed at rest):

```
cd web && bun run scripts/provision-m2m-client.ts "renown-server" renown:submit,renown:verify
```

Scopes in use:

- `renown:submit` — marks a `/api/submit` write as first-party-trusted (`{ trusted: true }`).
- `renown:verify` — required by **`POST /api/m2m/recompute`**, a trusted, un-throttled
  server-to-server recompute of a player's authoritative score (vs. the rate-limited `/verify`).

The CLI will present a token automatically **iff** `RENOWN_CLIENT_ID` + `RENOWN_CLIENT_SECRET`
(or `cfg.clientId`/`cfg.clientSecret`) are set (`core/m2m.ts`); otherwise it's a no-op.

### Honest caveat: M2M is for trusted backends, not the public CLI

renown is open source. A client secret shipped inside a public CLI is **not** secret, so we do
**not** gate the public CLI behind one — that would be security theater. M2M exists for
deployments that hold real credentials in env: a self-hosted renown, a first-party ingest
worker, an editor-vendor or partner backend. The public CLI's real per-user proof stays the
**GitHub token** on `renown link` (`/api/cli/link`), and leaderboard integrity stays the
verified-only ranking — neither depends on the M2M secret.

## What else `@absolutejs/auth` offers (and what's worth adopting)

The upgraded package (`0.27.0-beta.7`) ships far more than we use. Ranked for renown:

- **Worth adopting soon**
  - **`abuse` / `lockout`** — per-client/per-IP throttling + lockout. The natural home for rate
    limiting `/submit`, `/verify`, and `/cli/link` (defense-in-depth for the public endpoints).
  - **`audit` (+ SIEM/tamper-evident sink)** — an append-only, hash-chained log of verifications,
    links, and merges. High value for a leaderboard whose whole pitch is authenticity.
  - **`webhooks`** — signed events (e.g. "player verified", "merge accepted") other services can
    subscribe to.
- **Strategic / later**
  - **`oidc` provider** — renown becomes an identity provider: "Sign in with renown" + an MCP/agent
    resource other apps authenticate against. Pairs with the M2M layer already wired.
  - **`apikeys` (static keys)** — simpler per-user/per-integration keys alongside M2M clients.
  - **`organizations` / `roles` / `fga`** — for team/guild leaderboards and admin permissions.
- **Probably not needed**
  - **`credentials` / `passwordless` / `webauthn` / `mfa`** — password & MFA flows. renown is
    OAuth-only by design (GitHub is the meaningful identity), so these add little here.
  - **`sso` / `scim` / `compliance` / `tenancy`** — enterprise IdP/provisioning; out of scope.
