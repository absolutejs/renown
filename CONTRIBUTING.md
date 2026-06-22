# Contributing to Renown

Thanks for your interest! Renown is a Bun monorepo: a CLI/engine (`cli/`, `core/`), a web
app (`web/`), the DB schema (`db/`), and a GitHub Action (`action.yml`).

## Getting set up
```bash
bun install                 # root (CLI + engine)
cd web && bun install       # web app
```
- **CLI / engine:** `bun cli/index.ts <command>` (e.g. `tick`, `heartbeat`, `recap`).
- **Web:** `cd web && bun run dev` → http://localhost:7777 (needs a `.env`; see `web/.env.example`).
- **Typecheck:** `bun run typecheck` (root) and `cd web && bun run typecheck`.
- **Tests:** `bun test` (the CI workflow gates every PR on typecheck + tests).

## Ground rules
- **Never commit secrets.** `.env` / `web/.env` are gitignored; only `*.example` files are tracked.
- Keep changes focused and match the surrounding code's style (no linter reformatting churn).
- Run typecheck + tests before opening a PR. Add tests for behavior changes where practical.
- Engine code that the web frontend also imports lives in `core/` and is surfaced to the web
  build via the `web/src/shared` symlink — keep those modules dependency-light and browser-safe.

## Reporting issues
Open a GitHub issue with repro steps. For security-sensitive reports, please disclose
privately rather than in a public issue.

## License
By contributing you agree your contributions are licensed under the repository's
[Business Source License 1.1](LICENSE).
