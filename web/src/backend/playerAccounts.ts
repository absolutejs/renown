// Roll a multi-GitHub player's headline columns up from its per-account provenance ledger
// (player_accounts). Each account row holds that github's own verified/attribution/merit/
// substance contribution (mirroring the per-github columns the single-github world wrote to
// `players`); the player's headline numbers are the SUM across accounts so the leaderboard
// ranks one combined identity. See resolvePlayer.ts + db/migrate-add-user-sub.ts.
import { desc, eq, sql } from "drizzle-orm";
import { players, playerAccounts, wildSeedSources } from "../../../db/schema.ts";
import { computeMeritScore } from "./merit.ts";
import { gameDb } from "./sync.ts";

const minDate = (rows: { [k: string]: unknown }[], key: string): Date | null => {
  const ts = rows.map((r) => r[key]).filter(Boolean).map((d) => new Date(d as string | Date).getTime());
  return ts.length ? new Date(Math.min(...ts)) : null;
};

// Recompute players.<headline> = aggregate over player_accounts, then return the new totals.
// verified_score already includes attribution credit per account (players formula:
// base + attribution), so summing verified_score AND attribution_score stays consistent with
// the single-account world. Substance is sample-size-weighted across accounts.
export const rollupPlayerFromAccounts = async (playerId: string) => {
  const accts = await gameDb.select().from(playerAccounts).where(eq(playerAccounts.playerId, playerId));
  if (accts.length === 0) return null;
  const sum = (key: keyof typeof accts[number]) => accts.reduce((s, a) => s + Number(a[key] ?? 0), 0);
  const substanceSampleSize = sum("substanceSampleSize");
  const substanceScore = substanceSampleSize > 0
    ? accts.reduce((s, a) => s + Number(a.substanceScore) * Number(a.substanceSampleSize), 0) / substanceSampleSize
    : 0;
  const signals = {
    prReviewsCount: sum("prReviewsCount"),
    crossRepoPrsCount: sum("crossRepoPrsCount"),
    prsAuthoredCount: sum("prsAuthoredCount"),
    prsMergedCount: sum("prsMergedCount"),
    packageDownloads: sum("packageDownloads"),
    substanceScore, substanceSampleSize,
  };
  // Verified skill XP = per-skill SUM across the player's githubs (each account holds its own
  // github's recompute), so a multi-github player's /top?skill standing is their combined total.
  const verifiedSkillXp: Record<string, number> = {};
  for (const a of accts) {
    const m = (a.verifiedSkillXp as Record<string, number> | null) ?? {};
    for (const [k, v] of Object.entries(m)) verifiedSkillXp[k] = (verifiedSkillXp[k] ?? 0) + Number(v ?? 0);
  }
  const totals = {
    verifiedScore: sum("verifiedScore"),
    attributionScore: sum("attributionScore"),
    ...signals,
    meritScore: computeMeritScore(signals),
    verifiedSkillXp,
    // honest cooldowns: a re-sync is "due" as soon as the OLDEST account is due.
    lastAttributionSyncAt: minDate(accts, "lastAttributionSyncAt"),
    lastMeritSyncAt: minDate(accts, "lastMeritSyncAt"),
  };
  await gameDb.update(players).set(totals).where(eq(players.id, playerId));
  return totals;
};

// Fold the SOURCE user's game player into the TARGET user's player when two accounts merge
// (stage 4, called from mergeUserAccounts after the auth identities have moved). Moves the
// provenance ledger, pet-seed sources and achievements, unions the wild (rarest-100), then
// deletes the source player and rolls the target up. Idempotent-ish; safe if either side has
// no player. NOTE: source xp/skill/streak and pet-look assignments are NOT merged (the target
// stays canonical) — only the load-bearing identity assets (accounts, pets, badges, score).
export const foldPlayersForMerge = async ({ sourceUserSub, targetUserSub }: { sourceUserSub: string; targetUserSub: string }) => {
  const source = (await gameDb.select().from(players).where(eq(players.userSub, sourceUserSub)).limit(1))[0];
  if (!source) return;
  const target = (await gameDb.select().from(players).where(eq(players.userSub, targetUserSub)).limit(1))[0];
  if (!target) {
    // Target user has no player yet — just adopt the source player as theirs.
    await gameDb.update(players).set({ userSub: targetUserSub }).where(eq(players.id, source.id));
    return;
  }
  if (source.id === target.id) return;

  // Move the per-github ledger (github_login is globally unique, so no PK/uniq collision).
  await gameDb.execute(sql`UPDATE player_accounts SET player_id = ${target.id} WHERE player_id = ${source.id}`);
  // Move serialized copies. The merged player gets one copy per provenance event, so discard a
  // source duplicate by either copy seed or non-null provenance before changing the owner key.
  await gameDb.execute(sql`DELETE FROM wild_seed_sources s WHERE s.player_id = ${source.id} AND EXISTS (
    SELECT 1 FROM wild_seed_sources t WHERE t.player_id = ${target.id} AND (
      t.pet_seed = s.pet_seed OR (s.provenance_seed IS NOT NULL AND t.provenance_seed = s.provenance_seed)
    )
  )`);
  await gameDb.execute(sql`UPDATE wild_seed_sources SET player_id = ${target.id} WHERE player_id = ${source.id}`);
  // Union achievements (idempotent on the (player,achievement) PK).
  await gameDb.execute(sql`INSERT INTO player_achievements (player_id, achievement_id, unlocked_at) SELECT ${target.id}, achievement_id, unlocked_at FROM player_achievements WHERE player_id = ${source.id} ON CONFLICT DO NOTHING`);

  // The ledger remains unbounded; only the compatibility `wild` cache is capped.
  const ledger = await gameDb.select({ seed: wildSeedSources.petSeed, score: wildSeedSources.rarityScore, size: wildSeedSources.size })
    .from(wildSeedSources).where(eq(wildSeedSources.playerId, target.id))
    .orderBy(desc(wildSeedSources.rarityScore), desc(wildSeedSources.petSeed));
  const mergedWild = ledger.slice(0, 100).map((x) => x.seed);
  const bySize = [...ledger].sort((a, b) => b.size - a.size || b.score - a.score)[0];
  const avatarOwned = target.avatarSeed ? ledger.some((pet) => pet.seed === target.avatarSeed) : false;
  await gameDb.update(players).set({
    wild: mergedWild, petsCount: ledger.length,
    rarestPetScore: ledger[0]?.score ?? 0, rarestPetSeed: ledger[0]?.seed ?? null,
    biggestPetSize: bySize?.size ?? 0, biggestPetSeed: bySize?.seed ?? null,
    avatarSeed: avatarOwned ? target.avatarSeed : (ledger[0]?.seed ?? null),
  }).where(eq(players.id, target.id));

  // Delete the now-empty source player (FK-cascade clears any remaining child rows), then roll up.
  await gameDb.delete(players).where(eq(players.id, source.id));
  await rollupPlayerFromAccounts(target.id);
};
