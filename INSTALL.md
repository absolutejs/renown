# Installing renown

`renown` is the CLI half of the renown game. It works with any GitHub-tracked work
— **JavaScript, TypeScript, Python, Rust, Go, shell, YAML, anything**. You don't need
to be a JS dev to use it. You just need:

1. A GitHub account (`gh auth login` for the CLI auth flow)
2. A way to install the binary

## Install options (pick one)

### From npm (recommended — works in any JS-runtime context)

```bash
# npm
npm install -g @absolutejs/renown

# pnpm
pnpm add -g @absolutejs/renown

# yarn
yarn global add @absolutejs/renown

# Bun
bun install -g @absolutejs/renown
```

Then `renown help` should show the command list.

### One-shot via npx / pnpm dlx / yarn dlx (no global install)

```bash
npx @absolutejs/renown help
pnpm dlx @absolutejs/renown help
yarn dlx @absolutejs/renown help
```

### From source (requires Bun for now)

```bash
git clone https://github.com/absolutejs/renown
cd renown
bun install
bun run build:cli   # builds dist/cli.mjs for any-runtime use
./dist/cli.mjs help
```

## What runtimes work?

The CLI bundle (`dist/cli.mjs`) is built with `bun build --target=node`. It runs under:

| runtime | works? | how |
|---|---|---|
| Node.js (≥18) | ✅ | `node dist/cli.mjs <cmd>` or just `renown <cmd>` if globally installed |
| Bun | ✅ | `bun run dist/cli.mjs <cmd>` or `renown <cmd>` |
| Deno | ✅ | `deno run -A dist/cli.mjs <cmd>` |
| pnpm / yarn shells | ✅ | their `npm i -g` equivalents put `renown` on PATH |

## Language-agnostic features

The CLI wraps **49 tools across 9+ ecosystems**. You point `renown` at your existing
toolchain and it auto-counts the warnings:

```bash
# JS / TS
renown tsc -- tsc --noEmit
renown eslint -- eslint src/
renown biome -- biome check .

# Python
renown mypy -- mypy myapp/
renown ruff -- ruff check .
renown pytest -- pytest tests/

# Rust
renown clippy -- cargo clippy --all
renown cargo-build -- cargo build

# Go
renown go-vet -- go vet ./...
renown golangci-lint -- golangci-lint run

# Shell / Docker / YAML / Actions / CSS / Markdown
renown shellcheck -- shellcheck ./*.sh
renown hadolint -- hadolint Dockerfile
renown yamllint -- yamllint .github/
renown actionlint -- actionlint
renown stylelint -- stylelint "**/*.css"
renown markdownlint -- markdownlint "**/*.md"

# Anything else with a `--count N` argument
renown sycophant --count 47   # universal self-report
renown wip --count 12
renown rate-limited            # for AI agents
```

Every wrap runs the real tool, streams the real output, preserves the real exit code,
and bumps the matching achievement in the background. Your CI doesn't care; your badges
grow.

## Linking your install to your GitHub identity

```bash
gh auth login                     # if not already
renown link                       # binds this install to @<your-login>
renown ai-stats                   # show your current standing
```

The CLI uses your `gh auth token` for every authenticated call. Tokens are sent over
HTTPS to your renown server and never stored.

## Configuring the server URL

By default the CLI reads `~/.config/renown/config.json`:

```json
{
  "leaderboardEndpoint": "https://renown.example.com/api",
  "playerId": "any-stable-id-you-pick"
}
```

`XDG_CONFIG_HOME` is honored. The CLI prints a helpful error if the endpoint isn't set.
