// Renown — Drizzle schema (Postgres / Neon).
// Cloud holds the competitive truth: players, the achievement catalog (with global
// unlock counts → rarity %), per-player unlocks (with date achieved), and per-project
// boards. Rich local activity/recap data stays on-device; only scores/unlocks sync.
import { bigint, boolean, integer, jsonb, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";

export const players = pgTable("players", {
  id: text("id").primaryKey(),                                  // client-generated player id
  handle: text("handle").notNull(),
  githubLogin: text("github_login"),
  level: integer("level").notNull().default(1),
  xp: bigint("xp", { mode: "number" }).notNull().default(0),    // lifetime
  streak: integer("streak").notNull().default(0),
  activeSec: bigint("active_sec", { mode: "number" }).notNull().default(0),
  achievements: integer("achievements").notNull().default(0),
  ossCommits: integer("oss_commits").notNull().default(0),
  totalLevel: integer("total_level").notNull().default(0),        // sum of skill levels (RS-style)
  skillXp: jsonb("skill_xp").$type<Record<string, number>>().notNull().default({}),
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
  // pet leaderboards (most/rarest/biggest) can sort by a simple indexed column.
  petsCount: integer("pets_count").notNull().default(0),
  rarestPetScore: real("rarest_pet_score").notNull().default(0),
  biggestPetSize: integer("biggest_pet_size").notNull().default(0),
  // Avatar = the one pet shown on profile + (later) in the header. Default = rarest wild.
  avatarSeed: text("avatar_seed"),
  // Showcase = curated pets shown on public profile. Length capped by billing tier (free 2,
  // supporter 4, pro 8). Default = top-N by score.
  showcaseSeeds: jsonb("showcase_seeds").$type<string[]>().notNull().default([]),
  // Billing tier, denormalized from the auth `users` row (by github login) so the public board
  // can show a supporter badge and the CLI can read its tier. Cosmetic/convenience only — never
  // affects verified_score or rank. Set by the Stripe webhook.
  tier: text("tier").notNull().default("free"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
}, (t) => ({ pk: primaryKey({ columns: [t.playerId, t.achievementId] }) }));

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
  xp: bigint("xp", { mode: "number" }).notNull().default(0),
  commits: integer("commits").notNull().default(0),
  lines: bigint("lines", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.playerId, t.projectKey] }) }));
