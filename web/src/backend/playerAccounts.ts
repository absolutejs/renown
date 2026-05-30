// Roll a multi-GitHub player's headline columns up from its per-account provenance ledger
// (player_accounts). Each account row holds that github's own verified/attribution/merit/
// substance contribution (mirroring the per-github columns the single-github world wrote to
// `players`); the player's headline numbers are the SUM across accounts so the leaderboard
// ranks one combined identity. See resolvePlayer.ts + db/migrate-add-user-sub.ts.
import { eq, sql } from "drizzle-orm";
import { players, playerAccounts } from "../../../db/schema.ts";
import { generate } from "../../../core/procgen.ts";
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
  const totals = {
    verifiedScore: sum("verifiedScore"),
    attributionScore: sum("attributionScore"),
    ...signals,
    meritScore: computeMeritScore(signals),
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
  // Move pet-seed provenance, dropping any seed the target already has (PK player_id,pet_seed).
  await gameDb.execute(sql`DELETE FROM wild_seed_sources s WHERE s.player_id = ${source.id} AND EXISTS (SELECT 1 FROM wild_seed_sources t WHERE t.player_id = ${target.id} AND t.pet_seed = s.pet_seed)`);
  await gameDb.execute(sql`UPDATE wild_seed_sources SET player_id = ${target.id} WHERE player_id = ${source.id}`);
  // Union achievements (idempotent on the (player,achievement) PK).
  await gameDb.execute(sql`INSERT INTO player_achievements (player_id, achievement_id, unlocked_at) SELECT ${target.id}, achievement_id, unlocked_at FROM player_achievements WHERE player_id = ${source.id} ON CONFLICT DO NOTHING`);

  // Union the wild pets, keep the rarest 100, recompute denormalized pet aggregates.
  const sw = Array.isArray(source.wild) ? (source.wild as string[]) : [];
  const tw = Array.isArray(target.wild) ? (target.wild as string[]) : [];
  const creatures = Array.from(new Set([...tw, ...sw])).map((s) => ({ s, c: generate(s) })).sort((a, b) => b.c.score - a.c.score).slice(0, 100);
  const mergedWild = creatures.map((x) => x.s);
  const bySize = [...creatures].sort((a, b) => b.c.sizeN - a.c.sizeN || b.c.score - a.c.score)[0];
  await gameDb.update(players).set({
    wild: mergedWild, petsCount: mergedWild.length,
    rarestPetScore: creatures[0]?.c.score ?? 0, rarestPetSeed: creatures[0]?.s ?? null,
    biggestPetSize: bySize?.c.sizeN ?? 0, biggestPetSeed: bySize?.s ?? null,
    avatarSeed: target.avatarSeed && mergedWild.includes(target.avatarSeed) ? target.avatarSeed : (creatures[0]?.s ?? null),
  }).where(eq(players.id, target.id));

  // Delete the now-empty source player (FK-cascade clears any remaining child rows), then roll up.
  await gameDb.delete(players).where(eq(players.id, source.id));
  await rollupPlayerFromAccounts(target.id);
};
