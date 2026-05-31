# Renown trust model & anti-cheat

Renown mixes **server-verified** signals (recomputed from the GitHub API with the server's own
token) and **self-reported** signals (sent by the CLI/agent over an open endpoint). This document
is the source of truth for which is which, what a malicious client can forge, what we've hardened,
and what remains a launch blocker.

The one-line rule: **only server-verified data is allowed to rank on the headline leaderboard.**
Self-reported data is for a player's own progress and clearly-labelled cosmetic boards.

## Tier 1 — server-verified (trustworthy, ranks)

Computed on the server from the GitHub API; the client cannot submit the numbers. Spoofing these
would require fooling GitHub.

| Surface | What it computes | How it's protected |
| --- | --- | --- |
| `POST /api/verify` | `verifiedScore`, attribution, pets | recomputes from GitHub API; requires `githubVerified`; per-tier reverify cooldown |
| `POST /api/cli/merit-sync` | PR reviews, cross-repo PRs, shipper, maintainer, downloads | fetched from GitHub/npm with the server's token |
| `POST /api/cli/substance-sync` | commit substance score | server classifies fetched commits |
| `POST /api/ci/repo-sync` | per-repo `player_projects` xp/commits/lines | scores the contributor's real GitHub commits server-side; monotonic `greatest()` upsert; per-(player,repo) cooldown; credits linked players only |
| `POST /m2m/recompute` | `verifiedScore` | M2M `renown:verify` scope required |

The **headline board** (`/top` default, `?board=merit*`, `?board=pets-count|rarest-pet|biggest-pet`)
ranks only Tier-1 fields. These are safe.

## Tier 2 — self-reported (advisory; hardened, but NOT authoritative)

`POST /api/submit` is **unauthenticated by design** — coding agents submit local progress without a
GitHub login. A client may submit data for any `id`. We do **not** trust it for the headline board,
and we've bounded it so it can't be weaponized:

- **Clamps** (`web/src/backend/sync.ts`): every numeric is clamped to a plausible ceiling before it
  hits the DB (kills "set xp to `MAX_INT`"). Per-project `xp` is additionally capped at
  `commits × 300` — the most the craft engine could ever award for the claimed commits.
- **Monotonic boards**: `player_projects` xp/commits/lines upsert with `greatest()`, matching the
  CI path — a submit can raise a board stat but never lower it (no griefing, no regressions).
- **Rarity integrity**: `unlocked[]` still records a player's achievements, but the **public
  `unlock_count` rarity counter only moves for `githubVerified` players** — so throwaway accounts
  mass-claiming achievement ids can't distort the rarity % everyone sees.
- **Rate limit**: `/api/submit` is capped at 120/min per session-or-IP (was uncovered).
- **Read gating**: profiles and the headline board require `githubVerified`, so an unverified
  forged player never appears publicly.

## Tier 3 — cosmetic / self-reported by design (acceptable, labelled)

| Surface | Auth | Notes |
| --- | --- | --- |
| `/top?board=quirk:*` | gh-token (own login), incremental | "cope leaderboard" easter-eggs, explicitly self-reported in the UI |
| `/top?board=rate-limited` | gh-token (own login), incremental | self-reported comedic metric |
| pet-look endpoints | session | cosmetic; only your own |

These are labelled as self-reported in the UI and never feed the headline score.

## Known residual

No public board ranks purely on self-reported data anymore. The one remaining nuance: the
verified-first ordering guarantees a verified contributor **always outranks** any self-reported
one, but *among* contributors with no verified data yet, self-reported values still order them
(shown un-ticked). That window closes per-board as contributors verify; a cheater can never sit
above a verified player. To fully eliminate it, make the boards verified-ONLY (drop self-reported
rows) — a UX call, deferred so boards aren't empty pre-adoption.

## Resolved

- **Project boards (`/top?project=` and the `/project/:owner/:repo` page)** — *fixed.* `player_projects`
  has GitHub-scored `verified_{xp,commits,lines}` (written only by `/api/ci/repo-sync`, monotonic).
  Both boards rank **verified-first** and show the verified numbers with a ✓. "Trending repos" sums
  verified-preferred XP too.
- **Skill boards (`/top?skill=<id>`)** — *fixed.* `players.verified_skill_xp` is recomputed server-side
  by running `core/skills.ts awardCraft` (the exact local routing) over the player's GitHub commits in
  `/api/verify` (cooldown-gated). The board ranks **verified-first** with a `verified` flag. 84/94 skills
  are commit-derived (verifiable, incl. opensource/foreign/stargazing — per-repo meta is fetched);
  the 10 `agent-*` skills stay self-reported (no GitHub signal).

## What changed in this pass

- `sync.ts`: numeric clamps, `commits × 300` xp bound, monotonic project upsert, verified-gated
  rarity counter.
- `rateLimit.ts`: `/api/submit` write bucket (120/min); `/api/ci/repo-sync` added to the expensive
  (GitHub-quota) bucket.
- This document.

## Hardening from the post-review pass

A multi-agent review of the feature work surfaced (and these fixed) several quota/abuse/correctness
issues:

- **Score deflation on GitHub rate-limit** (`verify.ts`): a 403/429 on the repos/events fetch used to
  coalesce to `[]` and write a *deflated* score over the real one. Now a failed fetch (vs a genuine
  200-empty) aborts the verify — never overwrites good data with a degraded recompute.
- **Search-API budget** (GitHub's 30-req/min, far scarcer than the 5000/hr core): the per-verify
  skill recompute is now gated to runs with NEW attribution (or a player with no skill XP yet), and
  `/api/ci/repo-sync` no longer calls `search/commits` at all — it derives the commit count from the
  core commits API. A no-op CI re-sync now spends ~0 search calls.
- **`/api/ci/repo-sync` fan-out**: `logins` capped at 8 (was 50) and the per-login scoring sample
  bounded, so a single request can't fan out to ~1600 GitHub calls.
- **Rate-limit IP spoofing** (`rateLimit.ts`): forwarded headers (`X-Forwarded-For`/`CF`) are only
  trusted when `RENOWN_TRUST_PROXY=1`; otherwise the unspoofable socket IP is used. **Set
  `RENOWN_TRUST_PROXY=1` only when actually behind a proxy that overwrites those headers.**
- **Caching**: `/api/achievements` (incl. the ~11k-row compact rarity scan) and `/api/catalog` now
  send `cache-control: public, max-age=300`.
- **Consistency**: project board ranks verified-bucket-first so the `verified` flag and ordering
  always agree; trending-card top contributor + recap page are verified-preferred / verified-gated;
  multi-github skill XP merges per-skill (max) instead of clobbering.

### Recommended (maintainer-run) follow-ups

- **Board indexes** — `bun run db/migrate-add-player-projects-indexes.ts` adds functional indexes on
  `lower(project_key)` and the owner so /project + /org board queries are index scans, not seq scans.
- **OG/SVG render cache** — the `*.png`/`*.svg` routes re-rasterize on each cache-miss; an in-process
  LRU keyed by ETag (and/or an edge cache) would blunt crawler-unfurl bursts. Not yet done.
- ~~True multi-github skill SUM~~ — **done**: `player_accounts.verified_skill_xp` holds each
  github's recompute; `rollupPlayerFromAccounts` sums per skill into `players`, so a multi-github
  player's `/top?skill` standing is their combined total (single-github = that one account).

## What's explicitly out of scope (and why it's fine)

- Authenticating `/api/submit` would break the agent flow (Claude/Codex/etc. submit without a GitHub
  login). The mitigation is "self-reported never ranks," not "lock down submit."
- Per-`id` ownership binding on submit is unnecessary while submitted fields don't rank; revisit if
  any self-reported field is ever promoted to the headline board.
