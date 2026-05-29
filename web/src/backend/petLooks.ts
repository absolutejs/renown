import { and, eq, inArray } from "drizzle-orm";
import { DEFAULT_PET_LOOK_ID, resolvePetLookId, type PetLookId } from "../../../core/petLooks.ts";
import { petLookAssignments, players } from "../../../db/schema.ts";
import { gameDb } from "./sync.ts";

export type PetLookAssignments = Record<string, PetLookId>;

export const getPlayerPetLookAssignments = async (playerId: string, seeds: string[]): Promise<PetLookAssignments> => {
  if (seeds.length === 0) return {};
  const rows = await gameDb
    .select({ petSeed: petLookAssignments.petSeed, lookId: petLookAssignments.lookId })
    .from(petLookAssignments)
    .where(and(eq(petLookAssignments.playerId, playerId), inArray(petLookAssignments.petSeed, seeds)));

  const out: PetLookAssignments = {};
  for (const row of rows) {
    out[row.petSeed] = resolvePetLookId(row.lookId);
  }
  return out;
};

export const getPlayerPetLookAssignmentsForRows = async (playerRows: Pick<typeof players.$inferSelect, "id" | "activePetLookId">[]): Promise<Map<string, PetLookAssignments>> => {
  const ids = Array.from(new Set(playerRows.map((r) => r.id))).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return new Map();

  const rows = await gameDb
    .select({ playerId: petLookAssignments.playerId, petSeed: petLookAssignments.petSeed, lookId: petLookAssignments.lookId })
    .from(petLookAssignments)
    .where(inArray(petLookAssignments.playerId, ids));

  const out = new Map<string, PetLookAssignments>();
  for (const row of rows) {
    const bucket = out.get(row.playerId) ?? {};
    bucket[row.petSeed] = resolvePetLookId(row.lookId);
    out.set(row.playerId, bucket);
  }
  return out;
};

export const resolvePetLookIdForSeed = (assignment: PetLookAssignments, seed: string | null, activeLookId: string | null | undefined): PetLookId => {
  const fallback = resolvePetLookId(activeLookId, DEFAULT_PET_LOOK_ID);
  if (!seed) return fallback;
  const v = assignment[seed];
  return v ?? fallback;
};

export const setPetLookAssignmentsForSeeds = async (playerId: string, seeds: string[], lookId: PetLookId): Promise<void> => {
  if (seeds.length === 0) return;
  const rows = seeds.map((petSeed) => ({
    playerId,
    petSeed,
    lookId,
    assignedAt: new Date(),
  }));

  // Use `onConflictDoNothing` for historical consistency: these rows are only for
  // newly-earned pets; reissuing for existing pets is a no-op.
  await gameDb.insert(petLookAssignments).values(rows).onConflictDoNothing();
};

export const setPetLookAssignment = async (playerId: string, seed: string, lookId: PetLookId): Promise<void> => {
  await gameDb
    .insert(petLookAssignments)
    .values({ playerId, petSeed: seed, lookId })
    .onConflictDoUpdate({
      target: [petLookAssignments.playerId, petLookAssignments.petSeed],
      set: { lookId, assignedAt: new Date() },
    });
};
