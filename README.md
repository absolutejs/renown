# Renown

[![CI](https://github.com/absolutejs/renown/actions/workflows/ci.yml/badge.svg)](https://github.com/absolutejs/renown/actions/workflows/ci.yml)

**Earn XP and renown for real, meritorious dev work — in any editor.** A gamified,
quantified-self layer for programming: XP is *earned* by the craft and importance of
your work (never by commit-count), with thousands of achievements, deep activity
recaps, and competitive per-project leaderboards. By [AbsoluteJS](https://absolutejs.com).

> Grew out of a personal coding-agent experiment; now its own thing — **editor- and
> agent-agnostic**, with Claude, Codex, Cursor, Copilot, Aider, Gemini, and friends all
> treated as first-class participants.

**▶ Live leaderboard: [renown.absolutejs.com](https://renown.absolutejs.com)**

## Quick start
```bash
npm install -g @absolutejs/renown   # or: bun add -g @absolutejs/renown
renown link                         # link your GitHub account → get a verified score
renown                              # open the TUI: skills, quests, pets, leaderboard
```
The CLI talks to the hosted leaderboard out of the box — no config needed. Then wire it
into your editor so XP accrues as you work:
```bash
renown install-agent all            # Claude Code / Codex hooks + tmux HUD
```
…or drop the Action into any repo to score every contributor on each push:
```yaml
# .github/workflows/renown.yml
on: [push]
jobs:
  renown:
    runs-on: ubuntu-latest
    steps:
      - uses: absolutejs/renown@v1
```

## Why it's not cheese-able
XP comes from a **craft engine** that scores each commit by *substance* (generated
files / lockfiles / minified / reformat ≈ 0), with bonuses for tests/docs/new code and
penalties for tiny/junk/duplicate commits and daily grinding — then a **project-
importance multiplier**: open-source ×, GitHub stars (log scale), and contributing to
*someone else's* repo ×. Only commits you authored count.

## Architecture (Bun monorepo)
- `core` — engine: craft scoring, achievements, stats, leveling, shared types.
- `daemon` — **editor-agnostic** activity tracker: a filesystem watcher over your
  git repos emits activity heartbeats with **zero editor plugins** (works in VS Code,
  Neovim, JetBrains, anything) and detects commits. Editor plugins can POST richer
  heartbeats to it (WakaTime-style) later.
- `cli` — `renown` / `renown recap` TUI + `renown heartbeat`.
- `core/agents.ts` — universal coding-agent registry used by local stats, agent
  skills, achievements, and install docs.
- `server` — Bun API + Drizzle/Neon: `/submit`, `/top`, `/top?project`,
  `/achievements` (catalog + global rarity %).
- `db` — Drizzle schema + Neon client.

## Database (Drizzle + Postgres on Neon)
`players`, `achievements` (catalog incl. the 10k; `unlock_count` → **rarity %**),
`player_achievements` (`unlocked_at` → **date achieved**), `projects`, `player_projects`
(per-project boards). Rich local activity/recap data stays on-device; only scores and
unlocks sync.

```bash
bun install
cp .env.example .env      # paste your Neon DATABASE_URL
bun run db:push           # create tables on Neon
bun run db:check          # verify connectivity
```

## ⚠️ Secrets
`DATABASE_URL` lives in `.env` (gitignored) — never commit it. **Rotate the Neon
password before this repo is public.**

## GitHub Action — auto-sync from CI

Drop the renown Action into a repo and every push refreshes that repo's contributors'
renown — their score, **Co-Authored-By attribution**, freshly-pulled serialized pets, **and the
repo's own `/project` leaderboard** — with **no manual `renown sync` and no secrets in
the workflow**. The Action reads GitHub's own context (the pusher + the authors GitHub names
in the event) and asks your renown server to recompute each *linked* contributor from the
GitHub API using the **server's** token: their global renown *and* their per-repo commits/XP
(scored by the same craft engine your local CLI uses — `core/craftScore.ts` is shared, so CI
and local scoring can't drift; the board upsert is monotonic, so CI only ever adds
contributors or raises stats). Contributors who aren't on renown simply no-op, and the step
never fails your build.

```yaml
# .github/workflows/renown.yml
name: Renown
on: [push]
jobs:
  renown:
    runs-on: ubuntu-latest
    steps:
      - uses: absolutejs/renown@v1   # points at the hosted leaderboard by default
```

Self-hosting? Add `with: { endpoint: https://your-host/api }`. Prefer no extra action?
Call the CLI directly — same effect:

```yaml
      - run: npx -y @absolutejs/renown ci-sync
        # RENOWN_ENDPOINT defaults to the hosted board; set it only when self-hosting.
```

Locally, `renown ci-sync --endpoint <url>` does the same against a `GITHUB_*`-populated env.

## Roadmap
- [x] DB schema + Neon
- [x] Engine in `core/` (craft, achievements, stats, leaderboard, runtime, event)
- [x] 10,000-achievement catalog (258 curated + 10.6k generated) + DB seed
- [x] Universal memory bosses (live `/proc` sampler — any machine, no log files)
- [x] Editor-agnostic activity daemon (`renown watch`)
- [x] Coding-agent usage skills (`renown agent codex`, `renown agent claude`, etc.)
- [x] Server API (`/submit`, `/top`, `/top?project`, `/achievements` + rarity %)
- [x] Per-project leaderboards end-to-end
- [x] GitHub Action — auto-sync contributors' renown from CI (`renown ci-sync`)
- [x] CI workflow — typecheck + tests gate every PR; renown dogfoods its own sync
- [x] Shareable "your week" recap card + page (`/recap/:login`) with an OG image
- [x] Per-user README badge (`/profile/:login/badge.svg`) with your pet
- [x] Org pages (`/org/:owner`) — an org's repos + top contributors, badge + OG card
- [x] Weekly recap digest webhook (`RENOWN_RECAP_WEBHOOK`) — Mondays; preview at `/api/recap-digest`
- [x] Embeddable live mini-leaderboard SVG (`/project/:owner/:repo/board.svg`) for READMEs
- [x] Achievement share pages (`/achievement/:id`) — rarity, recent earners, OG card
- [x] Trust model documented + hardened ([docs/trust-model.md](docs/trust-model.md)): submit clamps, monotonic boards, verified-gated rarity, rate limits
- [x] TUI shows live rarity % from the server (per-badge, full-catalog coverage)
- [ ] Editor plugins (VS Code first — we already ship `absolutejs-vscode-extension`)
- [x] Anti-cheat: project + skill boards rank GitHub-verified XP (server-recomputed); no public board ranks purely on self-reported data ([docs/trust-model.md](docs/trust-model.md))

## License
[Business Source License 1.1](LICENSE) — free to use, modify, and self-host for any
purpose **except** running a competing hosted leaderboard service. Converts to Apache 2.0
on 2030-05-29. See [LICENSE](LICENSE) for the exact additional-use grant.
