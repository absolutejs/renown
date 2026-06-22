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

## Status
**Live in production at [renown.absolutejs.com](https://renown.absolutejs.com).** The whole
app is built and deployed — GitHub/Google auth, the full API, server-side anti-cheat
recompute from the GitHub API, and every React page (home/leaderboard, profile, project,
achievements, season, versus, recap, org, pets, quests, rivals). Most users never touch
this directory: the published `@absolutejs/renown` CLI and the GitHub Action talk to the
hosted board for you. You only run the server yourself to **self-host** or hack on the UI.

## Run it locally
```bash
bun install
cp .env.example .env   # fill OAuth creds + DATABASE_URL (.env is gitignored)
bun run dev            # absolute dev — http://localhost:7777
```
> Note: the dev server binds `PORT` from `.env` (default 7777). Source lives outside
> `web/` in the repo-root `core/` and is symlinked at `src/shared` so dev serves it.

For production, build and start (the deploy pipeline does this on the droplet):
```bash
bun run build && bun run start
```
