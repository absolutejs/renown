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

## Merit — the hard-to-game half of the leaderboard

Most leaderboards reward what's easy to count: commits, lines, stars. Renown's
**merit** half rewards what someone *outside your control* had to validate:
reviews, accepted PRs, downloaded packages, semantically substantive commits.

```bash
renown merit          # refresh all 5 signals from GitHub + npm
renown substance      # classify your recent commits by semantic substance
```

### The five merit ladders (each I → V)

| Ladder | What it counts | API source | Why it's hard to game |
|---|---|---|---|
| **Reviewer** | PRs you reviewed for other people | GitHub `reviewed-by:LOGIN type:pr` | Someone had to invite/accept your review |
| **Contributor** | PRs you authored that got merged into repos you don't own | GitHub `author:LOGIN type:pr is:merged -user:LOGIN` | A maintainer outside your control approved your work |
| **Shipper** | Your own PRs that actually landed (ratio-weighted vs spam) | GitHub `author:LOGIN type:pr is:merged` + merge ratio penalty | Low merge ratio floors your contribution |
| **Maintainer** | Monthly downloads across npm packages you maintain | npm registry `maintainer:LOGIN` + bulk downloads | npm install counts are real |
| **Substance** | Mean substance score of your recent commits (0.0–1.0) | Per-commit classification: heuristic or RAG | Typo fixes count for less than features |

### How merit_score is computed

```
reviewer    = reviews × 1
contributor = crossRepoPRs × 5             ← premium signal
shipper     = merged × 0.5 × max(0.2, mergeRatio)
maintainer  = log10(monthlyDownloads + 1) × 500
substance   = substanceScore × sampleSize ÷ 10   (requires ≥10 samples)

merit_score = floor(sum of all five)
```

The default leaderboard board (`Score`) sorts by `verified_score + merit_score`,
so merit is the headline number — not a separate dashboard.

### Substance classifier — heuristic by default, RAG opt-in

The heuristic classifier ships with zero dependencies. It scores conventional-
commit prefixes (`feat:`, `fix:`, `perf:`, `refactor:`, `chore:`, etc.) against
a calibrated 0.05–0.90 scale, with a churn-size nudge. Runs instantly under any
runtime.

For higher-quality classification on creative/non-English commit subjects, opt
into the RAG path. It uses [@absolutejs/rag](https://www.npmjs.com/package/@absolutejs/rag)'s
embedding provider to compute cosine similarity against a hand-labeled
reference set, then weighted-averages the top-3 by similarity:

```bash
# Either install the rag SDK globally:
npm install -g @absolutejs/rag

# Or set the env on your renown server (deployment-side):
export RENOWN_EMBEDDING_PROVIDER=openai     # or gemini / ollama
export RENOWN_EMBEDDING_API_KEY=sk-...
export RENOWN_EMBEDDING_MODEL=text-embedding-3-small   # optional override
```

Failures in the RAG path transparently fall back to the heuristic, so the
substance pipeline never blocks on a flaky embedding API.

### How often does merit refresh?

| Trigger | Cadence | What it does |
|---|---|---|
| `renown merit` (CLI) | on demand | All 4 GH-native signals, 1 player, ≤5 API calls |
| `renown substance` (CLI) | on demand | Classify N recent commits (default 30) for 1 player |
| Server cron: `merit-refresh` | every 6h | 20 oldest-synced verified players, 4 signals each |
| Server cron: `substance-refresh` | daily 03:30 UTC | 5 players × 30 commits classified |
| One-shot backfill (`db/backfill-merit.ts`) | operator | Every verified player, all signals, no batch cap |
| One-shot backfill (`db/backfill-substance.ts`) | operator | Same for substance |

Backfills are idempotent and respect a 24h sync cooldown unless `--force` is
passed.

### Achievements

25 new catalog rows (5 ladders × 5 tiers) under `category=merit`. They unlock
automatically when each signal's sub-counter crosses the next threshold.
Verified by the catalog row IDs `merit-{reviewer,contributor,shipper,maintainer,substance}-{1,2,3,4,5}`.
