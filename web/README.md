# Renown — web (AbsoluteJS)

The React UI + API + auth for Renown, built on **AbsoluteJS** (Elysia + React) with
**`@absolutejs/auth`** (OAuth via `citra`) on the same Neon DB as the engine/CLI.
Replaces the old `Bun.serve` stub. Mirrors `~/abs/examples/auth` (auth wiring) and
`~/abs/examples/spa` (React-on-AbsoluteJS).

## What it serves (one Elysia app)
- **Auth** — log in with **GitHub** or **Google**, linked to one Renown profile
  (`@absolutejs/auth`: sessions, refresh/revoke, identity linking).
- **API** — `/submit`, `/top`, `/top?project`, `/achievements` (+ live rarity %),
  reusing the engine's Drizzle schema in `../db`.
- **UI (React)** — public profile (`/u/<handle>`: level, XP, badges, heatmaps,
  recap), global + per-project leaderboards, achievement gallery with rarity.

## You do this once: create the OAuth apps
1. **GitHub** → Settings → Developer settings → OAuth Apps → New:
   - Homepage: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/oauth2/callback`
   - copy Client ID + generate a secret → `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
2. **Google** → Google Cloud Console → APIs & Services → Credentials → OAuth client ID
   (Web application):
   - Authorized redirect URI: `http://localhost:3000/oauth2/callback`
   - copy → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
3. `cp .env.example .env`, fill those + `DATABASE_URL`. (`.env` is gitignored.)
   - For production swap `localhost:3000` for the real domain in both the apps and
     `OAUTH2_CALLBACK_URI`.

## Build status / next steps
Scaffolded: project config, deps, env, structure. **Next (wired against your OAuth
creds):**
- [ ] `src/backend/server.ts` — Elysia + `auth<User>()` (GitHub+Google) + API plugin + pages + `absolutejs`/`networking`
- [ ] `src/backend/auth/{config,providersConfiguration}.ts` — GitHub + Google
- [ ] `src/backend/handlers/userHandlers.ts` — create/get a Renown **player** from the OAuth identity (the digital profile; ties to the GitHub login we score)
- [ ] `db` auth tables (users/sessions/linked providers) via `@absolutejs/auth` + `drizzle-kit push`
- [ ] `src/frontend/react/pages` — Profile, Leaderboard, Achievements
- [ ] CLI auth — GitHub device flow so the CLI submits as the verified player
- [ ] Anti-cheat — recompute XP server-side from the GitHub Events API for the verified user

```bash
bun install
cp .env.example .env   # fill OAuth + DATABASE_URL
bun run dev            # absolute dev
```
