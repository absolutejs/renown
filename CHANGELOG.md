# Changelog

All notable changes to `@absolutejs/renown` (the CLI) are documented here. The web app
and engine ship alongside it. Format loosely follows [Keep a Changelog](https://keepachangelog.com);
this project uses [SemVer](https://semver.org) while pre-1.0 (minor = features, patch = fixes).

## [Unreleased]
### Added
- The CLI now defaults to the hosted leaderboard (`https://renown.absolutejs.com/api`)
  out of the box — `renown link` and submits work immediately on a fresh install. Override
  with the `RENOWN_ENDPOINT` env var or `leaderboardEndpoint` in config (env > config > default).
- The GitHub Action defaults its `endpoint` to the hosted board, so `uses: absolutejs/renown@v1`
  needs no inputs.
- "Ranked" web redesign: a distinctive esports/arcade dark theme (Chakra Petch / Hanken
  Grotesk / JetBrains Mono), the leaderboard promoted to the hero, framed pets, and a
  cohesive token system across all pages.
- README quick-start, live-leaderboard link, and BSL license note; CONTRIBUTING guide.

### Fixed
- `heartbeat` delegates to the full Bun engine when a source checkout is present, so commit
  scoring / achievements / streak survive a hook reinstall (e.g. when adding Codex).
- Infinite-spinner loading bug: the shared `api()` helper no longer throws on network
  failure, the profile modal handles fetch errors instead of spinning forever, and every
  loading flag is cleared in a `finally`.
- `bun run dev` now serves the shared `core/*` modules (via a `web/src/shared` symlink), so
  the dev server renders the board + pets like production instead of 404ing.

## [0.3.1] — 2026-06-21
### Fixed
- `heartbeat` resolves a Bun source checkout and delegates the full engine; `installClaudeAgent`
  writes the full-engine Stop hook when a checkout is present.

## [0.3.0]
- Mile High Code Club; production hosting on a DigitalOcean droplet; live "from devs you
  follow" feed; follower/following counts; rotating weekly quest pool; monthly seasons +
  Hall of Champions; head-to-head compare (`/vs/:a/:b`); rivals/following social graph;
  achievements + skill leaderboards; `/pets` gallery; push notifications on level-up and
  achievement unlock.
