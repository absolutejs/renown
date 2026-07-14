// Who owns a given serialized copy. A copy seed resolves to at most one player. Used by the
// /pet/:seed page to show "Owned by @x" — bidirectional with the
// profile's per-pet links. Prefers the wild_seed_sources provenance map (also names which linked
// github earned it); falls back to a jsonb containment scan of players.wild for older seeds.
import { eq, sql } from "drizzle-orm";
import { players, wildSeedSources } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { gameDb } from "./sync.ts";

export type PetOwner = { login: string | null; handle: string; tier: string; isAi: boolean; earnedVia: string | null; printingId: string | null; serialNumber: number | null; printRun: number | null } | null;

export const findPetOwner = async (seed: string): Promise<PetOwner> => {
  if (!seed) return null;
  const src = (await gameDb.select({ playerId: wildSeedSources.playerId, githubLogin: wildSeedSources.githubLogin,
    printingId: wildSeedSources.printingId, serialNumber: wildSeedSources.serialNumber, printRun: wildSeedSources.printRun })
    .from(wildSeedSources).where(eq(wildSeedSources.petSeed, seed)).limit(1))[0];
  const row = src
    ? (await gameDb.select({ login: players.githubLogin, handle: players.handle, tier: players.tier, isAi: players.isAi }).from(players).where(eq(players.id, src.playerId)).limit(1))[0]
    : (await gameDb.select({ login: players.githubLogin, handle: players.handle, tier: players.tier, isAi: players.isAi }).from(players).where(sql`${players.wild} @> ${JSON.stringify([seed])}::jsonb`).limit(1))[0];
  if (!row) return null;
  return { login: row.login, handle: row.handle, tier: normalizeTier(row.tier), isAi: row.isAi, earnedVia: src?.githubLogin ?? null,
    printingId: src?.printingId ?? null, serialNumber: src?.serialNumber ?? null, printRun: src?.printRun ?? null };
};
