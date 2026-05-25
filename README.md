# Renown

**Earn XP and renown for real, meritorious dev work — in any editor.** A gamified,
quantified-self layer for programming: XP is *earned* by the craft and importance of
your work (never by commit-count), with thousands of achievements, deep activity
recaps, and competitive per-project leaderboards. By [AbsoluteJS](https://absolutejs.com).

> Grew out of a personal Claude Code experiment; now its own thing — **editor-agnostic**.

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

## Roadmap
- [x] DB schema + Neon
- [ ] Migrate the craft/achievements/stats/leaderboard engine into `src/core`
- [ ] Editor-agnostic activity daemon (`renown watch`)
- [ ] 10,000-achievement generator + DB seed
- [ ] Server API (submit/top/achievements) + rarity %
- [ ] Per-project leaderboards end-to-end
- [ ] Editor plugins (VS Code first — we already ship `absolutejs-vscode-extension`)
