# PICKUP.md

Resume document for the renown work-in-progress. If you're a future session,
read this top-to-bottom before doing anything else.

## Mission

Renown is the productized DEVQUEST — an editor-agnostic dev-progression game
that scores **real, meritorious dev work** with XP, achievements, 1/1 pets,
and per-project leaderboards. The product lives at `~/abs/renown`, ships as
`@absolutejs/renown`, and runs on Bun + Drizzle + Neon Postgres + AbsoluteJS.

The tagline is **"XP and renown for real, meritorious dev work."** Two halves
hold that promise up:

- **Merit half** (hard-to-game signals): PR reviews given, cross-repo merged
  PRs, shipper ratio, npm download weight, RAG-classified commit substance.
- **Comedy half** (cope ladder): 49 self-reported quirks, rate-limited
  achievement family, easter eggs.

The leaderboard's headline `score` is `verified_score + merit_score` so merit
IS the headline — not a separate dashboard.

## What's done in this arc

### Pet rendering unification + OG image (2026-05-29)
- ✅ One canonical creature structure in `core/procgen.ts` —
  `buildBody` + `facePlacement` + `buildCrest` — feeding three engines that
  can't drift: ANSI console (`renderCreature`), 2D SVG (`core/petSvg.ts` →
  `spriteToSvg`), and the 3D voxelizer (`voxelize` → in-app three.js).
- ✅ OG image (`web/src/backend/ogImage.ts`, route `/profile/:login/og.png`)
  now renders the canonical 2D sprite (was a flat `voxelize` projection):
  terminal-accurate cell aspect, anchored pixel-art crests (shoulder-mounted
  antlers/horns, gold crown, light-tipped antennae, elliptical halo), eyes with
  pupil+highlight, mouth, pattern speckle, aura sparkles.
- ✅ 3D pets gained crests for free: `voxelize` emits crest voxels from the same
  `buildCrest`; `PetViewer` renders them as cubes. Body/eye/mouth voxels + rng
  stream order preserved → existing seeds visually unchanged except added crest.
- ✅ 3D crest visually confirmed in the running production app (claude's avatar
  antlers render as green crest cubes on the leaderboard spotlight + profile).
  NOTE: `absolute dev` 404s `/core/*.ts` (dev module-serving quirk) so the 3D
  pet canvas stays empty in dev — test pets against `absolute build` +
  `absolute start` (production), per "How to verify" below.
- Migration `db/migrate-add-pet-looks.ts` was run against the DB (column +
  table created, 60 assignment rows backfilled to legacy) and the historical
  look invariant smoke-tested (5/5 pass).

### Pet looks + portal (committed 2026-05-29, see `a4bbd9b`)
- ✅ Type-safe pet look registry in `core/petLooks.ts`:
  - `PetLookId` union: `"legacy" | "volumetric"`
  - `PET_LOOKS` catalog + `resolvePetLookId` helper; default is `legacy`
- ✅ DB persistence so look changes are **historical**:
  - `players.active_pet_look_id` for future summons
  - `pet_look_assignments(player_id, pet_seed, look_id)` for per-pet history
  - Migration + backfill: `db/migrate-add-pet-looks.ts` (re-runnable)
- ✅ Backend helper layer for look reads/writes: `web/src/backend/petLooks.ts`
- ✅ Look selection wired into procgen rendering (`core/procgen.ts`):
  - `voxelize()` accepts `lookId`; volumetric builds z-depth stacks
    (`clampVoxelDepth`); callsites carry dimensional look data
- ✅ Look metadata plumbed through API payloads:
  - `/api/verify` returns `newPetLooks` and records look assignment for new
    pets at mint time
  - `/api/top` includes `activePetLookId` + `petLookAssignments` per row
  - `/api/profile/:login` includes the same look fields via shared loader
  - account payload includes look fields for signed-in session state
  - (`web/src/backend/plugins/apiPlugin.ts`, `authApiPlugin.ts`)
- ✅ Account APIs for portal UX:
  - `POST /api/account/pet-look` → change active default for future pets;
    snapshots existing pets' current look first
  - `POST /api/account/pets/:seed/look` → override one owned pet
- ✅ Frontend pet portal + per-pet override controls:
  - per-card look dropdown (`PetViewer` card controls)
  - "Pet portal" card in account view to set default future look
  - spotlight/avatar/showcase resolves look per seed (historical overrides
    respected)
  - (`PetViewer.tsx`, `RenownHome.tsx`, `ProfileModal.tsx`,
    `RenownProfile.tsx`, `petMaterials.tsx`, styles `renown.css`)

**Why "historical looks stay" holds:** changing the portal default only
changes `players.active_pet_look_id`. Existing owned seeds keep their specific
`pet_look_assignments` row and render by that historical look later. Newly
earned seeds after a change get the new active look at verify/mint time.

### Merit (the load-bearing addition)
- ✅ 5 ladders × 5 tiers (Reviewer, Contributor, Shipper, Maintainer, Substance)
  — 25 achievement rows seeded
- ✅ `web/src/backend/merit.ts` with 4 GitHub-native fetchers + npm-downloads
  signal (the bulk endpoint rejects scoped packages — split scoped from
  unscoped, fan-out per-package for scoped)
- ✅ `computeMeritScore` formula — log10-compresses downloads, ratio-penalizes
  spammy shippers, requires ≥10 substance samples to count
- ✅ `/api/cli/merit-sync` + `/api/cli/substance-sync` endpoints (on demand)
- ✅ Two crons: `merit-refresh` (every 6h, 20 oldest players) +
  `substance-refresh` (daily 03:30 UTC, 5 players × 30 commits)
- ✅ `db/backfill-merit.ts` for one-shot every-player sync
- ✅ `web/src/backend/substance.ts` — heuristic classifier (default, no deps)
  + RAG classifier opt-in via `RENOWN_EMBEDDING_PROVIDER` env. 54 reference
  exemplars across 9 substance buckets. RAG failures transparently fall back
  to heuristic.
- ✅ Frontend: `MeritPanel` (live-updating per-signal grid),
  `RecentUnlocks` activity feed, ProfileModal merit block, `merit` board on
  leaderboard plus per-dimension boards (`merit:reviews`, `:crossRepo`,
  `:shipper`, `:downloads`, `:substance`)

### Profile pages (the share-loop)
- ✅ Public `/profile/:login` — SSR-rendered, OG/Twitter metadata per
  profile, no auth needed. Soft-200 on not-found so OG previews still work.
  Case-insensitive (canonical stays lowercase). x-forwarded-proto/host aware.
- ✅ `web/src/backend/profile.ts` — shared `loadProfile()` +
  `profileShareSnippet()` consumed by both `/api/profile/:login` JSON and the
  SSR page so they can't drift.
- ✅ `web/src/frontend/react/pages/RenownProfile.tsx` — full-page layout with
  avatar pet, merit block, showcase, achievements grouped by category,
  quirks. Doesn't bundle RenownHome's heavy chunks (cursor sync, parade
  physics, audio).
- ✅ ProfileModal got a `ProfileShareRow` ("🔗 Copy link" + "Open public page ↗")
  so modal-browsers can bridge to the public URL.

### Cross-language inclusivity (earlier in the arc)
- ✅ CLI wrappers for 49 tools across 9 ecosystems (tsc/eslint/biome/mypy/
  ruff/clippy/cargo/go-vet/golangci-lint/shellcheck/hadolint/yamllint/
  actionlint/stylelint/markdownlint/oxlint/deno-check/pytest/pyright)
- ✅ Runtime-agnostic CLI bundle (`dist/cli.mjs`, ~17KB, runs under Node /
  Bun / Deno) via `cli/api.ts` + `cli/proc.ts` (node:child_process shim)
- ✅ INSTALL.md with multi-runtime install instructions + Merit section

### Upstream fixes shipped during this arc
- ✅ **`@absolutejs/absolute@0.19.0-beta.1053`** — fixed the vendor pipeline's
  CJS-wrapper transitive-import miss (zustand/traditional via @react-three/fiber).
  Live on npm. See `~/abs/absolutejs/src/build/buildDepVendor.ts:113-178`
  for `collectBareImportsFromFile`.
- Renown's `web/package.json` was upgraded from 1047 → 1053 to consume it.

## Critical context that's easy to lose

1. **Drizzle TS noise is systemic.** `bunx tsc --noEmit` produces ~3500
   errors in this project, almost all "Property X does not exist on type
   {} | ..." or "No overload matches this call" from drizzle's overload
   inference breaking with this tsconfig. Runtime works fine. To check
   whether YOUR change broke anything, grep tsc output for the specific
   files you touched.

2. **`bun run tsc` is shadowed.** package.json has a `"tsc"` script that
   invokes the renown CLI tool wrapper. Use `bunx tsc` (or
   `./node_modules/.bin/tsc` after installing bun-types).

3. **Vendor pipeline runs only in dev mode.** `prepare()` only calls
   `prepareDev()` (which runs `buildDepVendor`) when `NODE_ENV=development`.
   Production builds inline deps. If you're testing vendor-related
   behavior, use `bunx absolute dev`, not `absolute start`.

4. **Pre-existing SSR bug in `@absolutejs/sync`.** `createLiveQuery` →
   `createSyncSubscriber` throws if there's no `globalThis.EventSource`
   (always true during SSR). RenownHome.tsx's `useLiveQuery` has an inline
   SSR guard as a workaround. The proper fix belongs upstream in
   @absolutejs/sync.

5. **WSL memory.** If memory > 75%, check
   `ps -eo pid,rss,cmd --sort=-rss | head` — the 1-2GB "node" process is
   almost always VS Code's TS Server, not user code. Playwright/Chrome
   orphans accumulate from playwright-mcp shutdown bugs — see
   `~/.claude/CLAUDE.md` for kill commands.

6. **Always push.** User preference: push to origin after every commit in
   their own repos. Don't ask. (Saved in
   `~/.claude/projects/-home-alexkahn-alex/memory/always-push.md`.)

7. **For upstream OSS PRs, strip AI markers.** No `🤖 Generated with
   Claude Code` footer, no `Co-Authored-By: Claude` trailer. For
   user's own repos, the Co-Authored-By trailer is fine and expected.

## Total plan (where we are vs where we're going)

```
[done]    Merit signals + 5 ladders + cron + backfill
[done]    Substance classifier (heuristic + RAG opt-in)
[done]    Merit panel + activity feed + leaderboard integration
[done]    Standalone /profile/:login page + OG metadata + share row
[done]    @absolutejs/absolute beta 1053 released (CJS wrapper fix)
[done]    Pet look registry + portal + historical per-pet assignments (code)
[done]    Pet-looks migration run + historical-look invariant smoke-tested
[done]    Unify pet rendering on one canonical sprite (console/2D/3D)
[done]    OG image renders the canonical 2D sprite w/ crests + aura
[done]    3D crests visually confirmed in production (claude's antlers)

[done]    Leaderboard + feeds rows as <a> tags (cmd-click → /profile new tab)
[done]    Substance backfill script (db/backfill-substance.ts) — run for @claude
          (substance 66%, n=30, +3 tiers); idempotent skip-if-classified verified

[done]    Volumetric look parity — camera now depth-aware (front face framed
          like legacy); legacy pixel-identical (depth-push is 0 for depth 1)
[done]    Multi-github STAGE 1 — players.user_sub + player_accounts ledger +
          wild_seed_sources + resolvePlayer.ts; /cli/link attaches a 2nd github;
          renown pet/rarest/switch resolve across a user's githubs. Verified:
          gh=absolutejs → alexkahndev player, no dup. (full plan: ~/.claude/
          plans/nifty-meandering-wigderson.md)

[done]    Multi-github STAGE 2 — auth/config onGithubVerified attaches to the
          user's one canonical player (no per-login minting); authApiPlugin +
          crons route through the resolver; accountPayload has accounts[] breakdown
[done]    Multi-github STAGE 3 — cross-github aggregation via
          web/src/backend/playerAccounts.ts rollupPlayerFromAccounts; /verify +
          /cli/* + crons write per-account then roll up. Verified: alexkahndev +
          absolutejs combine to 8244 verified (11505 w/ merit), no clobber on resync.

[next]    Multi-github STAGE 4 — merge-request prompt+confirm for a populated 2nd
          github (extend mergeUserAccounts to fold players/accounts/wild)
[next]    Route the DEFERRED lookups through the resolver too (operator/edge paths
          still resolve via primary github): attestation.ts, stripePlugin,
          adminAuthPlugin tier writes, db/backfill-merit.ts + db/backfill-substance.ts

[medium]  SPA-style profile-to-profile navigation (no full reload)
[medium]  Push notifications on tier unlocks (push infra already exists)

[ship]    Make publishable: flip private:false, publish 0.1.0 to npm
[ship]    Public deployment of renown.app
[ship]    README/marketing — turn the docs+INSTALL.md into a landing
```

## Next steps (concrete, in order)

### 1. Pet-looks: migrate + smoke-test
The code is built but the migration hasn't run against the real DB and the
flow is untested end-to-end.
- Run migration: `bunx tsx db/migrate-add-pet-looks.ts`
- Smoke-test: sign in → grant a 2nd pet → set look on the legacy pet →
  switch portal default to volumetric → verify one more pet → confirm the
  old pet is unchanged and the new pet is volumetric.
- Confirm visual parity for volumetric in compact views (camera/scale may
  need tuning; current volumetric is depth-stacking, not a full skeletal 3D
  rewrite).

### 2. OG image generator — `/profile/:login/og.png`
**Why**: og:image already points at it (in RenownProfile.tsx). Without an
actual image, share cards in Slack/Discord/Twitter show text-only previews.
Image is what makes shares POP in feeds — the whole point of profile pages.

**Approach**: Add a route in `pagesPlugin.ts` (or a new image plugin) that
takes `:login`, loads the profile via `loadProfile()`, generates a 1200×630
PNG. Options:
- `satori` + `@resvg/resvg-js` — JSX → SVG → PNG, ~50KB deps
- `@vercel/og` — wraps satori; same approach
- Hand-rolled SVG + sharp — lighter but more work

Cache via ETag of `lastMeritSyncAt` + Cache-Control: max-age=300.

**Content**: handle, score, top 3 stats (same as profileShareSnippet),
tier-tinted gradient background, 🤖 badge if AI. Optionally a top-down
2D-projected pet voxel grid (the seed is deterministic — `core/procgen.ts`
generates the voxel data; you'd render a top-down projection).

### 3. Leaderboard rows → real anchors
Right now clicks on leaderboard ranks call `openProfile()` which opens the
modal. Wrap the row content in `<a href="/profile/${login}">` so:
- Left click: prevent default, open modal (current behavior, fast in-place)
- Middle click / cmd-click: native open-in-new-tab to the public page

Same change in RecentUnlocks rows.

### 4. Substance backfill
`db/backfill-substance.ts` mirroring `db/backfill-merit.ts`. Each verified
player: `fetchRecentCommits(attributionQuery, 30)` →
`aggregateSubstance()` → write `substance_score` + `substance_sample_size`
+ recompute `merit_score`. Respect a `--force` flag for re-runs.

Expensive — N players × ~30 GitHub API calls each. Add a `--limit N` for
safe batches. Could also chain into the merit backfill so one command does
both.

### 5. Ship-ready
- Flip `package.json` `"private": true` → false
- Bump version to `0.1.0`
- Smoke test `bun run build:cli` and `npm pack` content
- Push and `npm publish --tag beta`
- Stand up a public renown.app (Neon DB is already cloud-hosted; needs a
  Bun host — Railway/Fly/Vercel Bun runtime/etc.)

## Where things live

- **Renown code**: `~/abs/renown`
- **AbsoluteJS source**: `~/abs/absolutejs` (npm-published; the renown
  branch I touched is on main, pushed to GitHub)
- **Web app**: `~/abs/renown/web/` (where the @absolutejs/absolute install
  lives; `web/package.json` has its own deps separate from root)
- **CLI**: `~/abs/renown/cli/` — `index.ts` is the full Bun CLI, `api.ts`
  is the Node-portable HTTP-only entry that bundles to `dist/cli.mjs`
- **DB**: Neon Postgres, connection string in `web/.env`
- **Migrations**: `~/abs/renown/db/migrate-*.ts` — re-runnable, idempotent

## Recent commits (for orientation)

```
d4ee66f feat(profile): standalone /profile/:login page + OG/share metadata
d81ced5 chore: bump @absolutejs/absolute → 0.19.0-beta.1053
0964e6a feat(merit): backfill script, profile-modal panel, network activity feed
33b1f6e feat: merit — the hard-to-game half of the leaderboard
d55357f feat: cross-language tool wrappers + runtime-agnostic CLI bundle
```

## Open architectural questions

1. **Modal vs page navigation** — currently both exist; modal for in-app
   browsing, page for direct URLs / sharing. Is duplication of UI worth it,
   or should we kill the modal and only have the standalone page?
2. **Profile page is its own bundle** — doesn't share chunks with
   RenownHome (which means duplicated React, three.js code when a visitor
   hits both). Acceptable for now (each page is fast); revisit if bundle
   sizes get hairy.
3. **Substance ingestion at scale** — 5 players/day is fine for a small
   user base. For a launched product, we'd need to throttle differently
   (priority queue based on profile-view recency? embedding cost budget?).
4. **OG image caching** — generated PNGs need a cache. In-memory is
   simple but won't survive restarts. R2/S3 is overkill until launch.
   `Cache-Control: max-age=300` + browser/CDN caching may be enough for v1.

## How to verify the current state works

```bash
# 1. Start the production server (vendor pipeline only runs in dev — see
#    "Critical context" #3 — but the production server is good for testing
#    the profile page and API).
cd ~/abs/renown/web
bunx absolute build
bunx absolute start src/backend/server.ts

# 2. Profile page (open in browser):
#    http://localhost:7777/profile/alexkahndev    — real player
#    http://localhost:7777/profile/AlexKahnDev    — uppercase → canonical
#    http://localhost:7777/profile/nonexistent    — soft-not-found
#    http://localhost:7777/profile/claude         — AI badge renders

# 3. Merit data:
curl http://localhost:7777/api/merit/alexkahndev | jq
curl http://localhost:7777/api/recent-unlocks?limit=10 | jq

# 4. CLI:
gh auth login   # if not already
renown merit
renown substance --limit 30
renown ai-stats
```
