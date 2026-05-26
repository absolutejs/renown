# renown billing, tiers & abuse protection

## The rule: no pay-to-win

Everything that makes renown *renown* is **free for everyone** and always will be: all 100
skills, every achievement, procedural 1/1 creatures, wild drops, adopting companions, on-chain
ownership of what you genuinely earn, and your rank on the public leaderboard. Paid tiers never
touch `verified_score` or rank. They exist to **offset costs** (GitHub API calls, compute) and,
later, to be a viable business — not to sell power.

## Tiers (`web/src/backend/billing/tiers.ts`)

| Tier | Price | What you get |
| --- | --- | --- |
| **Free** | $0 | The whole game. All skills/achievements/1-of-1s, public leaderboard, earned on-chain ownership. |
| **Supporter** | small monthly | Supporter badge on the board, cosmetic HUD themes, faster verify refresh. A thank-you for chipping in. |
| **Pro** | monthly | Everything in Supporter + near on-demand verify/recompute, private leaderboards + analytics, a personal API (M2M client). |

The only thing tiers *meter* is the **refresh cooldown** (`REVERIFY_COOLDOWN_MS`): how often your
authoritative score recomputes from GitHub (free 10 min → supporter 2 min → pro ~20 s). Your
score is identical at every tier; paid just sees updates sooner. `tier` lives on the auth `users`
row (source of truth) and is mirrored onto `players.tier` (by GitHub login) for the board badge.

## Stripe setup (when the account exists)

The server **runs without keys** — billing routes answer `503 "billing not configured"` until set.

1. In the Stripe dashboard, create two recurring **Products/Prices** (Supporter, Pro).
2. Fill `web/.env` (see `.env.example`):
   - `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`
   - `STRIPE_PRICE_SUPPORTER`, `STRIPE_PRICE_PRO`
   - `STRIPE_WEBHOOK_SECRET` (from the webhook endpoint, or `stripe listen` in dev)
3. Dev webhook forwarding: `cd web && bun run stripe:local` (needs the Stripe CLI).

### Routes (`web/src/backend/plugins/stripePlugin.ts`)

- `GET /stripe/config` — publishable key + tier metadata (public).
- `POST /billing/checkout` `{ tier }` — **sign-in required**; hosted Stripe Checkout (subscription); returns `{ url }`.
- `POST /billing/portal` — **sign-in required**; Stripe billing portal to manage/cancel; returns `{ url }`.
- `POST /webhooks/stripe` — raw-body signature-verified; `customer.subscription.*` events set the tier. Source of truth.

## "Signed in to do anything" + rate limiting (`web/src/backend/rateLimit.ts`)

We don't want bots/scammers burning our GitHub quota and compute. The model:

- **The public leaderboard stays viewable** (good for growth) — anonymous reads get a per-IP
  bucket (**100/min**); signed-in callers get a per-session bucket (**600/min**).
- **Actions require an identity.** Web account/billing actions need a session; the CLI
  authenticates with your GitHub token (`renown link`) / an M2M token. Reads are open.
- **Costly paths are tightly limited** — `/api/verify`, `/api/cli/link`, `/api/m2m/recompute`
  share a **30 / 15 min** bucket; OAuth entry points get **40 / 15 min**.
- **Bot guard** (`createAbuseGuard` + `defaultBotClassifier`) on the **human** OAuth login flow
  only — it blocks empty-UA / curl / python-requests / headless callers before they start a
  login. Machine paths (`/oauth2/token`, `/api/cli/link`, `/api/m2m/recompute`) are intentionally
  *not* bot-guarded (they're server-to-server, authed by secret/token). `ABUSE_IP_DENYLIST`
  adds IP/CIDR blocks. The Stripe webhook is exempt from rate limiting (Stripe must always reach it).

Standard `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` / `Retry-After` headers are
returned; over-limit requests get `429`.
