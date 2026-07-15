// Renown — Drizzle schema (Postgres / Neon).
// Cloud holds the competitive truth: players, the achievement catalog (with global
// unlock counts → rarity %), per-player unlocks (with date achieved), and per-project
// boards. Rich local activity/recap data stays on-device; only scores/unlocks sync.
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const players = pgTable("players", {
  id: text("id").primaryKey(),                                  // client-generated player id
  handle: text("handle").notNull(),
  githubLogin: text("github_login"),                            // PRIMARY/display github login (one of possibly many)
  // The auth user this player belongs to (auth `users.sub`). A user can link multiple GitHub
  // accounts (auth_identities); they all resolve to this one aggregate player. Nullable for
  // legacy / CLI-only players with no auth user yet (resolved via github_login fallback). See
  // web/src/backend/resolvePlayer.ts and the player_accounts provenance ledger below.
  userSub: text("user_sub"),
  level: integer("level").notNull().default(1),
  xp: bigint("xp", { mode: "number" }).notNull().default(0),    // lifetime
  streak: integer("streak").notNull().default(0),
  activeSec: bigint("active_sec", { mode: "number" }).notNull().default(0),
  achievements: integer("achievements").notNull().default(0),
  ossCommits: integer("oss_commits").notNull().default(0),
  totalLevel: integer("total_level").notNull().default(0),        // sum of skill levels (RS-style)
  skillXp: jsonb("skill_xp").$type<Record<string, number>>().notNull().default({}),
  // Server-verified skill XP — recomputed from the player's GitHub commits via the same
  // core/skills.ts routing (awardCraft). The /top?skill board ranks by this so it can't be
  // forged via /api/submit; self-reported skill_xp above stays advisory. agent-* skills excluded
  // (no GitHub signal). See db/migrate-add-verified-skill-xp.ts + docs/trust-model.md.
  verifiedSkillXp: jsonb("verified_skill_xp").$type<Record<string, number>>().notNull().default({}),
  // --- authoritative leaderboard: server-recomputed from GitHub, NOT client-submitted ---
  githubVerified: boolean("github_verified").notNull().default(false),  // OAuth proved login ownership
  verifiedScore: bigint("verified_score", { mode: "number" }).notNull().default(0),  // the only ranked number
  verifiedAt: timestamp("verified_at"),
  // Attribution credit (windowed-incremental): commits where you're a Co-Authored-By, counted
  // ONLY since max(account_created, last_attribution_sync) so a long absence backfills and a
  // resync never double-counts. attributionQuery is the GitHub commit-search string (nullable
  // means no attribution tracking; set to e.g. "Co-Authored-By: <name>" or "co-authored-by:<email>").
  attributionScore: bigint("attribution_score", { mode: "number" }).notNull().default(0),
  lastAttributionSyncAt: timestamp("last_attribution_sync_at"),
  attributionQuery: text("attribution_query"),
  // Wild creature seeds (each = a real commit SHA you authored/co-authored). Procedurally
  // generates a unique 1/1 creature via core/procgen.ts. Capped to the 100 rarest.
  wild: jsonb("wild").$type<string[]>().notNull().default([]),
  // Denormalized pet aggregates — recomputed on every /api/verify after wild updates so the
  // pet leaderboards (most/rarest/biggest) can sort by a simple indexed column. The *Seed
  // columns let the leaderboard render the actual pet next to its stat (the rarest pet on the
  // rarest-pet board, etc.) without the client having to know the wild set.
  petsCount: integer("pets_count").notNull().default(0),
  rarestPetScore: real("rarest_pet_score").notNull().default(0),
  rarestPetSeed: text("rarest_pet_seed"),
  biggestPetSize: integer("biggest_pet_size").notNull().default(0),
  biggestPetSeed: text("biggest_pet_seed"),
  // Avatar = the one pet shown on profile + (later) in the header. Default = rarest wild.
  avatarSeed: text("avatar_seed"),
  // Active look used for future pets. Existing seeds can continue rendering with
  // their historical look assignment in pet_look_assignments.
  activePetLookId: text("active_pet_look_id").notNull().default("legacy"),
  // Showcase = curated pets shown on public profile. Length capped by billing tier (free 2,
  // supporter 4, pro 8). Default = top-N by score.
  showcaseSeeds: jsonb("showcase_seeds").$type<string[]>().notNull().default([]),
  // Billing tier, denormalized from the auth `users` row (by github login) so the public board
  // can show a supporter badge and the CLI can read its tier. Cosmetic/convenience only — never
  // affects verified_score or rank. Set by the Stripe webhook.
  tier: text("tier").notNull().default("free"),
  // Marks an AI participant (e.g. Claude). AI accounts earn pets, achievements, and score
  // identically to humans — the flag is for transparency only, never gates participation.
  // Visible as a 🤖 badge wherever the handle is shown. Set by an admin/migration OR by
  // an aiAttestation (below) that the player posts.
  isAi: boolean("is_ai").notNull().default(false),
  // Cumulative count of AI-provider rate-limit pings, surfaced via the
  // easter-egg "Rate Limited" achievement family. Incremented by POST
  // /api/cli/rate-limited (the CLI command + agent wrappers fire it on
  // 429s). The honest-frame joke is that the score-board's most "important"
  // players are also the ones Anthropic / OpenAI / etc. throttle most often,
  // and renown acknowledges this with a tier-laddered achievement.
  rateLimitCount: integer("rate_limit_count").notNull().default(0),
  // Generic easter-egg quirk counters. Map of quirk_id → count, bumped by
  // /api/cli/quirk. Each quirk has a 4-tier achievement ladder (1/10/100/1000)
  // registered in core/achievements/curated.ts. Adding a new quirk = pick an
  // id + add 4 catalog rows + (optionally) a CLI alias. The joke is the cope
  // ladder: "we lean into the reality of dev/AI life and stamp a badge for it."
  quirks: jsonb("quirks").$type<Record<string, number>>().notNull().default({}),
  // Per-user push notification preferences. Defaults: everything on. UI flips fields
  // off; server filters fan-outs accordingly. Adding new event kinds is just a new
  // field here + a check at the relevant publish site — existing users default to
  // opted-in for the new event (acceptable for a small notification surface).
  pushPrefs: jsonb("push_prefs").$type<{ verifiedAttestation?: boolean; newcomerToBoard?: boolean; mention?: boolean; levelUp?: boolean; achievement?: boolean; season?: boolean }>().notNull().default({}),
  // Merit signals — the "real, meritorious dev work" half of the pitch. Unlike the
  // commit-count-driven attribution_score (which is real but easy to inflate with
  // co-author spam), these signals are observably hard to game: PR reviews require
  // someone else to invite/accept them; cross-repo merged PRs require a maintainer
  // outside your control to approve; maintainer downloads come from the package
  // registry; substance_score classifies commit diffs by semantic substance (RAG).
  // All counters are absolute (last full count from the source), not deltas — the
  // sync overwrites them every refresh. merit_score is the rolled-up number that
  // feeds verified_score so it ranks on the leaderboard.
  meritScore: bigint("merit_score", { mode: "number" }).notNull().default(0),
  prReviewsCount: integer("pr_reviews_count").notNull().default(0),       // PRs you reviewed
  crossRepoPrsCount: integer("cross_repo_prs_count").notNull().default(0),// merged PRs in repos you don't own
  prsAuthoredCount: integer("prs_authored_count").notNull().default(0),   // all PRs you opened
  prsMergedCount: integer("prs_merged_count").notNull().default(0),       // subset of authored that landed
  packageDownloads: bigint("package_downloads", { mode: "number" }).notNull().default(0), // monthly DLs across maintained npm packages
  substanceScore: real("substance_score").notNull().default(0),           // 0..1 mean substance weight across classified commits
  substanceSampleSize: integer("substance_sample_size").notNull().default(0), // # of commits classified (for substance_score reliability)
  lastMeritSyncAt: timestamp("last_merit_sync_at"),
  // Optional public attestation of AI status. POSTed via /api/account/ai-attestation by
  // the player; setting it flips is_ai true and stores { provider, claimedAt, evidenceUrl? }.
  // Provider is a free-text identifier ("anthropic", "openai", ...). evidenceUrl points at
  // a public page where anyone can verify the claim. v1 is a public-claim model — no
  // cryptographic verification yet — but the schema is ready for signed JWTs later.
  aiAttestation: jsonb("ai_attestation").$type<{ provider: string; claimedAt: string; evidenceUrl?: string }>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Provenance ledger for multi-GitHub players. One row per (player, github_login) the player owns.
// The per-account columns mirror the per-github scoring on `players`; the `players` headline
// columns (verified_score, attribution_score, the merit signals, substance) become SUM/MAX
// rollups across these rows (see rollupPlayerFromAccounts). Lets a player aggregate across a
// user's GitHubs while keeping it auditable + cleanly un-linkable. A github belongs to exactly
// one player (unique index on github_login, added in db/migrate-add-user-sub.ts).
export const playerAccounts = pgTable("player_accounts", {
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  githubLogin: text("github_login").notNull(),
  attributionQuery: text("attribution_query"),                  // per-github commit search, e.g. author:<login>
  lastAttributionSyncAt: timestamp("last_attribution_sync_at"),
  verifiedScore: bigint("verified_score", { mode: "number" }).notNull().default(0),
  attributionScore: bigint("attribution_score", { mode: "number" }).notNull().default(0),
  verifiedAt: timestamp("verified_at"),
  prReviewsCount: integer("pr_reviews_count").notNull().default(0),
  crossRepoPrsCount: integer("cross_repo_prs_count").notNull().default(0),
  prsAuthoredCount: integer("prs_authored_count").notNull().default(0),
  prsMergedCount: integer("prs_merged_count").notNull().default(0),
  packageDownloads: bigint("package_downloads", { mode: "number" }).notNull().default(0),
  substanceScore: real("substance_score").notNull().default(0),
  substanceSampleSize: integer("substance_sample_size").notNull().default(0),
  // This github's server-verified skill XP (from /api/verify's commit recompute). Summed per
  // skill across the player's accounts into players.verified_skill_xp by rollupPlayerFromAccounts.
  verifiedSkillXp: jsonb("verified_skill_xp").$type<Record<string, number>>().notNull().default({}),
  lastMeritSyncAt: timestamp("last_merit_sync_at"),
  githubVerified: boolean("github_verified").notNull().default(false),   // OAuth/CLI-token proved this github
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.playerId, t.githubLogin] }) }));

// Stable characters available in a card set. A subject is the recognizable pet (the
// "player" on a baseball card); printings and owned copies live below it.
export const petSubjects = pgTable("pet_subjects", {
  id: text("id").primaryKey(),
  setId: text("set_id").notNull(),
  subjectSeed: text("subject_seed").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ setIdx: index("pet_subjects_set_idx").on(t.setId, t.id) }));

// One supply-capped variant of a subject. `issued` is the authoritative mint ordinal;
// it only advances inside issue_pet_copy(), in the same transaction that creates the copy.
export const petPrintings = pgTable("pet_printings", {
  id: text("id").primaryKey(),
  subjectId: text("subject_id").notNull().references(() => petSubjects.id),
  setId: text("set_id").notNull(),
  variant: text("variant").notNull(),
  printRun: integer("print_run").notNull(),
  issued: integer("issued").notNull().default(0),
  serialOffset: integer("serial_offset").notNull().default(0),
  serialStep: integer("serial_step").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ subjectVariantUniq: uniqueIndex("pet_printings_subject_variant_uniq").on(t.subjectId, t.variant) }));

// Which linked github earned each owned copy. `players.wild` stays the flat,
// rarest-100-capped list used by existing clients; this is the authoritative copy ledger.
export const wildSeedSources = pgTable("wild_seed_sources", {
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  petSeed: text("pet_seed").notNull(),
  githubLogin: text("github_login").notNull(),
  provenanceSeed: text("provenance_seed"),
  printingId: text("printing_id").references(() => petPrintings.id),
  serialNumber: integer("serial_number"),
  printRun: integer("print_run"),
  mintNumber: integer("mint_number"),
  variant: text("variant"),
  finish: text("finish"),
  mutation: text("mutation"),
  colorway: text("colorway"),
  earnedAt: timestamp("earned_at").notNull().defaultNow(),
  // Materialized deterministic procgen fields make collection search/filter/sort a
  // normal indexed database query instead of regenerating every pet on each request.
  name: text("name").notNull().default(""),
  tier: text("tier").notNull().default("Common"),
  rarityScore: real("rarity_score").notNull().default(0),
  size: integer("size").notNull().default(0),
  species: text("species").notNull().default(""),
  aura: text("aura").notNull().default("none"),
  oneOfOne: boolean("one_of_one").notNull().default(false),
}, (t) => ({
  pk: primaryKey({ columns: [t.playerId, t.petSeed] }),
  recentIdx: index("wild_seed_sources_recent_idx").on(t.earnedAt, t.petSeed),
  ownerRecentIdx: index("wild_seed_sources_owner_recent_idx").on(t.playerId, t.earnedAt, t.petSeed),
  ownerRarityIdx: index("wild_seed_sources_owner_rarity_idx").on(t.playerId, t.rarityScore, t.petSeed),
  ownerSizeIdx: index("wild_seed_sources_owner_size_idx").on(t.playerId, t.size, t.petSeed),
  finishRecentIdx: index("wild_seed_sources_finish_recent_idx").on(t.finish, t.earnedAt, t.petSeed),
  mutationRecentIdx: index("wild_seed_sources_mutation_recent_idx").on(t.mutation, t.earnedAt, t.petSeed),
  copySerialUniq: uniqueIndex("wild_seed_sources_printing_serial_uniq").on(t.printingId, t.serialNumber),
  provenanceUniq: uniqueIndex("wild_seed_sources_player_provenance_uniq").on(t.playerId, t.provenanceSeed),
}));

// Weekly quest progress. Per (player, ISO-week, quest): the baseline signal value captured on
// first view that week (so progress = current - baseline for "this week" goals) and the
// completion timestamp. Completing a quest mints a deterministic quest pet into the player's wild.
export const questProgress = pgTable("quest_progress", {
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  weekKey: text("week_key").notNull(),
  questId: text("quest_id").notNull(),
  baseline: bigint("baseline", { mode: "number" }).notNull().default(0),
  completedAt: timestamp("completed_at"),
}, (t) => ({ pk: primaryKey({ columns: [t.playerId, t.weekKey, t.questId] }) }));

// Hall of Champions — the finalized top finishers of each past monthly season. Written lazily
// when the season board is loaded after a month rolls over (no cron). season = "YYYY-MM".
export const seasonChampions = pgTable("season_champions", {
  season: text("season").notNull(),
  rank: integer("rank").notNull(),
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  login: text("login"),
  handle: text("handle").notNull(),
  gain: bigint("gain", { mode: "number" }).notNull(),
  finalizedAt: timestamp("finalized_at").notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.season, t.rank] }) }));

// Social graph — who follows whom. Following is public (a dev's "circle"), so it powers both
// the personal /rivals board+feed and a discovery surface. Directed: (follower, followee).
export const follows = pgTable("follows", {
  followerId: text("follower_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  followeeId: text("followee_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.followerId, t.followeeId] }) }));

// the achievement catalog (curated + the 10k generated). unlockCount powers rarity %.
export const achievements = pgTable("achievements", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  tier: text("tier").notNull(),
  visibility: text("visibility").notNull().default("shown"),    // shown | hidden | secret
  generated: boolean("generated").notNull().default(false),
  unlockCount: integer("unlock_count").notNull().default(0),
});

// who unlocked what, and WHEN (date achieved)
export const playerAchievements = pgTable("player_achievements", {
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  achievementId: text("achievement_id").notNull().references(() => achievements.id, { onDelete: "cascade" }),
  unlockedAt: timestamp("unlocked_at").notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.playerId, t.achievementId] }),
  historyIdx: index("player_achievements_history_idx").on(t.playerId, t.unlockedAt, t.achievementId),
}));

export const projects = pgTable("projects", {
  key: text("key").primaryKey(),                                // owner/name
  name: text("name").notNull(),
  stars: integer("stars").notNull().default(0),
  oss: boolean("oss").notNull().default(false),
});

// per-project competitive standing
export const playerProjects = pgTable("player_projects", {
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  projectKey: text("project_key").notNull().references(() => projects.key, { onDelete: "cascade" }),
  // Self-reported (from POST /api/submit) — advisory, NOT trusted for public ranking.
  xp: bigint("xp", { mode: "number" }).notNull().default(0),
  commits: integer("commits").notNull().default(0),
  lines: bigint("lines", { mode: "number" }).notNull().default(0),
  // Server-verified (from POST /api/ci/repo-sync — scored from real GitHub commits). The
  // /project board ranks by these so a forged /submit can't top a repo. Monotonic (greatest).
  verifiedXp: bigint("verified_xp", { mode: "number" }).notNull().default(0),
  verifiedCommits: integer("verified_commits").notNull().default(0),
  verifiedLines: bigint("verified_lines", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.playerId, t.projectKey] }) }));

// One row per (player, calendar day) recording the player's verified + attribution
// scores at the time the day's first /api/verify ran. Lets us compute weekly deltas
// without maintaining a separate counter or a heavy event log. Snapshots are written
// inline by /api/verify (lazy, only if today's row is missing) so there's no cron and
// no schedule-drift bug. Size: ~365 rows/player/year → trivial at our scale.
export const playerAttributionSnapshots = pgTable("player_attribution_snapshots", {
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  // Store the calendar date as a text "YYYY-MM-DD" so the UNIQUE-per-day semantics
  // don't get fooled by hour-of-day differences across requests / timezones. Server
  // produces this from new Date().toISOString().slice(0,10).
  snapshotDate: text("snapshot_date").notNull(),
  attributionScore: bigint("attribution_score", { mode: "number" }).notNull(),
  verifiedScore: bigint("verified_score", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.playerId, t.snapshotDate] }) }));

// Web Push subscriptions — per (player, endpoint). One player can have many endpoints
// (laptop browser + phone browser + work browser). On verified attestation we fan out
// to every active subscription. unsubscribe = delete by id; expired endpoints (410
// Gone from the push service) also get deleted automatically by the sender.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),                   // push service URL, unique per browser install
  p256dh: text("p256dh").notNull(),                       // ECDH public key from the subscription
  auth: text("auth").notNull(),                           // auth secret from the subscription
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastNotifiedAt: timestamp("last_notified_at"),
});

// Per-player, per-pet visual style choice. Preserves historical looks:
// every seed can keep its previously assigned look even after you update your active
// portal look. New wild-seed grants read from players.active_pet_look_id.
export const petLookAssignments = pgTable("pet_look_assignments", {
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  petSeed: text("pet_seed").notNull(),
  lookId: text("look_id").notNull(),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.playerId, t.petSeed] }),
}));

// Outbound webhook delivery log — one row per ATTEMPT (not per event), so a payload
// retried 3 times leaves 3 rows. Lets admins inspect what failed and why; doubles as
// the dead-letter store for ones that never succeeded (admin can query "where
// status_code is null or status_code >= 400"). Append-only; we don't update rows in
// place because the row IS the attempt receipt.
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: text("id").primaryKey(),                                     // ulid-ish
  eventKind: text("event_kind").notNull(),                         // e.g. "attestation.verified"
  url: text("url").notNull(),                                      // target webhook URL at the time of attempt
  payload: jsonb("payload").notNull(),                             // the JSON body we POSTed
  attempt: integer("attempt").notNull(),                           // 1, 2, 3 (counted from 1)
  statusCode: integer("status_code"),                              // HTTP code on success/4xx/5xx; null on network error
  attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
  lastError: text("last_error"),                                   // brief message on failure; null on success
});

// WebAuthn credentials per player. Each row is one registered hardware key / passkey /
// platform authenticator. credential_id is the public credential identifier the browser
// hands back; public_key is the COSE-encoded public key bytes (base64url so the column
// stays text). counter is the signature-counter from WebAuthn assertion (server checks
// monotonic increase to detect cloned authenticators). Used as the "self-key" path for
// AI attestation: attest with a WebAuthn assertion signed by your registered key,
// renown stamps attestation.webauthnVerified=true.
export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),                // base64url-encoded COSE bytes
  counter: integer("counter").notNull().default(0),
  transports: jsonb("transports").$type<string[]>().notNull().default([]),
  // User-chosen label for the management UI ("YubiKey 5C", "iCloud Passkey", …).
  // Optional; defaults to "Hardware key" on registration so the row always reads as
  // something. Editable via PATCH /api/account/webauthn/credentials/:id.
  label: text("label").notNull().default("Hardware key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
});

// Audit log of every ai_attestation state change. One row per claim / verification /
// clear. Append-only; lets anyone inspect the full history of an account's AI claims
// for transparency. Render in ProfileModal as a compact timeline; expose via
// /api/profile/:login so external auditors can read it without auth.
export const aiAttestationEvents = pgTable("ai_attestation_events", {
  id: text("id").primaryKey(),                                     // ulid-ish; auto-generated server-side
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  at: timestamp("at").notNull().defaultNow(),
  // claimed: first attestation OR provider/url change · verified: signed JWT validated ·
  // cleared: attestation removed (is_ai reset to false on the player row).
  kind: text("kind").notNull(),                                    // "claimed" | "verified" | "cleared"
  provider: text("provider"),                                      // null on cleared
  evidenceUrl: text("evidence_url"),                               // null on cleared
  verified: boolean("verified").notNull().default(false),          // true only on a successful JWT verify
  // Who triggered this event. Lets the admin dashboard / profile timeline surface
  // "Alex cleared it" vs "claude self-cleared" vs "system swept it on expiry." Null
  // for legacy rows; new rows always stamp at least the kind.
  actorKind: text("actor_kind"),                                   // "user" | "admin" | "cli" | "system" | null
  actorSub: text("actor_sub"),                                     // admin/user sub when known; null for cli/system
});
