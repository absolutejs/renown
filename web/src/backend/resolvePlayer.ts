// The one new primitive for multi-GitHub support: resolve the canonical aggregate `players`
// row for a github login or an auth user. A user can link several GitHub accounts (auth
// `auth_identities`), all of which map to one player. See db/migrate-add-user-sub.ts and the
// `player_accounts` provenance ledger in db/schema.ts.
//
// gameDb is an unbound drizzle client over the same Neon DB as the auth `db`, so it can query
// both the game tables (players, player_accounts — root db/schema) and the auth `auth_identities`
// (web/db/schema) by passing the table object.
import { and, eq, sql } from "drizzle-orm";
import { players, playerAccounts } from "../../../db/schema.ts";
import { authIdentities } from "../../db/schema.ts";
import { gameDb } from "./sync.ts";

export type PlayerRow = typeof players.$inferSelect;
export type PlayerAccountRow = typeof playerAccounts.$inferSelect;

const playerById = async (id: string): Promise<PlayerRow | null> =>
  (await gameDb.select().from(players).where(eq(players.id, id)).limit(1))[0] ?? null;

/**
 * login → canonical player. Resolution order:
 *   1) player_accounts.github_login = login  (a github belongs to exactly one player)
 *   2) auth_identities(github, login) → user_sub → players.user_sub
 *   3) LEGACY fallback: players.github_login = login  (CLI-only / pre-migration rows, no auth user)
 * Step 3 lets callers work before every player has a user_sub. All comparisons case-insensitive.
 */
export const resolvePlayerByGithubLogin = async (login: string): Promise<PlayerRow | null> => {
  if (!login) return null;
  const lower = login.toLowerCase();

  const acct = (await gameDb.select({ playerId: playerAccounts.playerId }).from(playerAccounts)
    .where(sql`lower(${playerAccounts.githubLogin}) = ${lower}`).limit(1))[0];
  if (acct) { const p = await playerById(acct.playerId); if (p) return p; }

  const ident = (await gameDb.select({ userSub: authIdentities.user_sub }).from(authIdentities)
    .where(and(eq(authIdentities.auth_provider, "github"),
      sql`lower(coalesce(${authIdentities.metadata}->>'login', ${authIdentities.provider_subject})) = ${lower}`))
    .limit(1))[0];
  if (ident?.userSub) {
    const p = (await gameDb.select().from(players).where(eq(players.userSub, ident.userSub)).limit(1))[0];
    if (p) return p;
  }

  return (await gameDb.select().from(players).where(sql`lower(${players.githubLogin}) = ${lower}`).limit(1))[0] ?? null;
};

/** user_sub → canonical player (players.user_sub = sub). Creates nothing. */
export const resolvePlayerByUserSub = async (userSub: string): Promise<PlayerRow | null> => {
  if (!userSub) return null;
  return (await gameDb.select().from(players).where(eq(players.userSub, userSub)).limit(1))[0] ?? null;
};

/** Every github login attached to a player (provenance display + per-account sync fan-out). */
export const listPlayerAccounts = async (playerId: string): Promise<PlayerAccountRow[]> =>
  gameDb.select().from(playerAccounts).where(eq(playerAccounts.playerId, playerId));
