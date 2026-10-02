// One GitHub account's authoritative refresh: recompute its verified score, credit new co-author
// attribution through the idempotent SHA ledger, issue pets for those commits, and roll the
// player's headline numbers up across every linked github. POST /api/verify, the background
// refresh when a signed-in player opens the site, and the human-refresh cron all run this, so a
// player never has to press a button to stay current.
import { and, desc, eq, sql } from "drizzle-orm";
import { attributionCommits, playerAccounts, playerAttributionSnapshots, players, wildSeedSources } from "../../../db/schema.ts";
import { resolvePetLookId } from "../../../core/petLooks.ts";
import { advanceAllTimeVerifiedScore } from "./allTimeScore.ts";
import { fetchAttributionShas } from "./attribution.ts";
import { REVERIFY_COOLDOWN_MS, normalizeTier } from "./billing/tiers";
import { setPetLookAssignmentsForSeeds } from "./petLooks.ts";
import { issuePetCopies } from "./petIssuance.ts";
import { rollupPlayerFromAccounts } from "./playerAccounts.ts";
import { notifyNewcomerToBoard } from "./push.ts";
import { publicParticipantCondition } from "./reservedAi.ts";
import { resolvePlayerByGithubLogin } from "./resolvePlayer.ts";
import { computeVerifiedSkillXp } from "./skillScore.ts";
import { gameDb, grantAchievements, hub } from "./sync.ts";
import { type GithubFailure, isGithubFailure, verifyGithubResult } from "./verify.ts";

// In-process tracker for the current weekly AI leader (login → most recent broadcast).
// Single-instance assumption already holds for the rest of sync.ts (in-memory hub +
// write-behind cache); when this app scales horizontally, both this and the hub move
// to Redis cluster pub/sub together. Each account sync recomputes it and only publishes
// when the login changes — silent ticks don't spam the SSE topic.
let weeklyAiLeaderLogin: string | null = null;
const recomputeWeeklyAiLeader = async () => {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const weeklyOrder = sql<number>`(${players.attributionScore} - coalesce((select ${playerAttributionSnapshots.attributionScore} from ${playerAttributionSnapshots} where ${playerAttributionSnapshots.playerId} = ${players.id} and ${playerAttributionSnapshots.snapshotDate} >= ${cutoff} order by ${playerAttributionSnapshots.snapshotDate} asc limit 1), ${players.attributionScore}))`;
  const rows = await gameDb.select().from(players)
    .where(and(publicParticipantCondition(), eq(players.isAi, true)))
    .orderBy(desc(weeklyOrder))
    .limit(1);
  const top = rows[0];
  if (!top?.githubLogin) return;
  if (top.githubLogin === weeklyAiLeaderLogin) return;
  weeklyAiLeaderLogin = top.githubLogin;
  hub.publish("weekly-ai-leader", {
    login: top.githubLogin,
    verifiedScore: top.verifiedScore,
    verified: top.githubVerified,
    claimStatus: top.claimStatus,
    aiProvider: top.aiProvider,
    isAi: true,
    aiAttestation: top.aiAttestation,
    avatarSeed: top.avatarSeed,
  });
};

const failureMessage = (login: string, failure: GithubFailure) => {
  if (failure.reason === "not_found") return `GitHub has no account named @${login}.`;
  if (failure.reason === "rate_limited") {
    const minutes = failure.retryAt ? Math.max(1, Math.ceil((failure.retryAt - Date.now()) / 60_000)) : null;
    return `GitHub is rate-limiting Renown right now${minutes ? `; @${login} will refresh again in about ${minutes} min` : ""}. Your last verified score is kept.`;
  }
  return `GitHub didn't respond in time for @${login}. Your last verified score is kept and it will retry automatically.`;
};

export type GithubSyncResult = Awaited<ReturnType<typeof runGithubSync>>;

const runGithubSync = async (login: string, token?: string) => {
  const row = await resolvePlayerByGithubLogin(login);
  if (!row?.githubVerified) return { error: "login ownership not verified (OAuth required)" } as const;
  // Per-account: this syncs the github it was called with. That github's own attribution
  // window + score live on its player_accounts row; the player's headline numbers are rolled
  // up across all the user's githubs at the end.
  const acct = (await gameDb.select().from(playerAccounts).where(and(eq(playerAccounts.playerId, row.id), sql`lower(${playerAccounts.githubLogin}) = ${login.toLowerCase()}`)).limit(1))[0];
  const acctQuery = acct?.attributionQuery ?? row.attributionQuery;
  // Refresh cooldown by tier — measured on the synced account's own last verify.
  const cooldown = REVERIFY_COOLDOWN_MS[normalizeTier(row.tier)];
  const acctVerifiedAt = acct?.verifiedAt ?? row.verifiedAt;
  if (acctVerifiedAt && Date.now() - new Date(acctVerifiedAt).getTime() < cooldown) {
    const baseScoreCached = Number(row.verifiedScore) - Number(row.attributionScore);
    return { ok: true, score: row.verifiedScore, baseScore: baseScoreCached, attributionScore: row.attributionScore, attributionDelta: 0, throttled: true, tier: normalizeTier(row.tier) } as const;
  }
  const v = await verifyGithubResult(login, token);
  if (isGithubFailure(v)) return { error: failureMessage(login, v), reason: v.reason, retryAt: v.retryAt } as const;
  // Attribution: GitHub's date filter overlaps at day boundaries, so count only SHAs newly
  // inserted into the per-account ledger. Retries and concurrent refreshes become no-ops.
  let attrDelta = 0;
  let newShas: string[] = [];
  // Keep the human-readable cursor for status/recency; correctness comes from the SHA ledger.
  const attributionSyncStartedAt = new Date();
  if (acctQuery) {
    const candidateShas = await fetchAttributionShas(acctQuery, 1000, token);
    if (candidateShas.length > 0) {
      const inserted = await gameDb.insert(attributionCommits).values(candidateShas.map((sha) => ({
        playerId: row.id, githubLogin: login, sha,
      }))).onConflictDoNothing().returning({ sha: attributionCommits.sha });
      newShas = inserted.map((item) => item.sha);
      // Accounts that predate the SHA ledger seed their recent baseline once without
      // changing the historical total. New accounts default initialized and backfill.
      attrDelta = acct?.attributionLedgerInitialized === false ? 0 : newShas.length;
    }
  }
  // This github's own verified score (base + its attribution); rolls up to the player below.
  const acctAttribution = Number(acct?.attributionScore ?? 0) + attrDelta;
  const score = advanceAllTimeVerifiedScore({
    currentVerifiedScore: Number(acct?.verifiedScore ?? 0),
    currentAttributionScore: Number(acct?.attributionScore ?? 0),
    recomputedBaseScore: v.score,
    nextAttributionScore: acctAttribution,
  });
  const acctScore = score.verifiedScore;
  // Turn commit provenance into supply-limited serialized copies. PostgreSQL assigns the
  // next serial atomically; replaying this sync returns the same already-issued copy.
  const issuedPets = newShas.length > 0
    ? await issuePetCopies({ playerId: row.id, githubLogin: login, provenanceSeeds: newShas.slice(0, 30) })
    : [];
  const issuedSeeds = issuedPets.map((pet) => pet.seed);
  const createdPets = issuedPets.filter((pet) => pet.created);
  // Append issued copies to the player's wild; cap at the 100 newest so it doesn't grow forever.
  const wild: string[] = Array.isArray(row.wild) ? row.wild : [];
  const mergedWild = Array.from(new Set([...issuedSeeds, ...wild])).slice(0, 100);
  const newLookId = resolvePetLookId(row.activePetLookId);
  const newPetSeeds = createdPets.slice(0, 6).map((pet) => pet.seed);
  const newPetLooks = Object.fromEntries(newPetSeeds.map((seed) => [seed, newLookId]));
  // Every created copy keeps the look that was active when it was minted, including copies
  // beyond the cinematic cap that are revealed later from the since-last-visit recap.
  await setPetLookAssignmentsForSeeds(row.id, createdPets.map((pet) => pet.seed), newLookId);
  // The ledger is the authoritative, unbounded inventory. `players.wild` remains only a
  // small compatibility/render cache; it must never cap collection totals or rankings.
  const [{ totalPets = 0 } = { totalPets: 0 }] = await gameDb.select({ totalPets: sql<number>`count(*)::int` })
    .from(wildSeedSources).where(eq(wildSeedSources.playerId, row.id));
  const sortedByScore = await gameDb.select({ seed: wildSeedSources.petSeed, score: wildSeedSources.rarityScore })
    .from(wildSeedSources).where(eq(wildSeedSources.playerId, row.id))
    .orderBy(desc(wildSeedSources.rarityScore), desc(wildSeedSources.petSeed)).limit(8);
  const [biggest] = await gameDb.select({ seed: wildSeedSources.petSeed, size: wildSeedSources.size })
    .from(wildSeedSources).where(eq(wildSeedSources.playerId, row.id))
    .orderBy(desc(wildSeedSources.size), desc(wildSeedSources.rarityScore), desc(wildSeedSources.petSeed)).limit(1);
  const rarestPetScore = sortedByScore[0]?.score ?? 0;
  const rarestPetSeed = sortedByScore[0]?.seed ?? null;
  const biggestPetSize = biggest?.size ?? 0;
  const biggestPetSeed = biggest?.seed ?? null;
  // Avatar copy seeds are immutable ledger identities, so a selection remains valid even
  // after it ages out of the small `wild` compatibility cache.
  const currentAvatar = row.avatarSeed ?? rarestPetSeed;
  // Showcase: tier-gated slot count, defaulted to top-N by score. Honors a player's explicit
  // pick if they've curated one (length-trimmed to current tier slots).
  const slots = normalizeTier(row.tier) === "pro" ? 8 : normalizeTier(row.tier) === "supporter" ? 4 : 2;
  const currentShowcase: string[] = Array.isArray(row.showcaseSeeds) ? row.showcaseSeeds : [];
  const curated = currentShowcase.slice(0, slots);
  const showcase = curated.length > 0 ? curated : sortedByScore.slice(0, slots).map((x) => x.seed);
  // Server-verified skill XP — recompute from this github's recent commits using the SAME
  // routing the local engine uses, so /top?skill ranks GitHub-scored skill XP, not /submit's.
  // GUARD: this costs a Search-API call + ~25 commit fetches, so only recompute when there's
  // NEW attribution this sync (attrDelta > 0) or the account has no verified skill XP yet.
  // Recompute is written to THIS github's account row (overwrite — it's the full recompute for
  // this github, so re-verifying doesn't double-count); rollupPlayerFromAccounts then SUMS
  // per skill across the player's githubs into players.verified_skill_xp.
  const acctHasSkill = Object.keys((acct?.verifiedSkillXp as Record<string, number> | null) ?? {}).length > 0;
  const recomputedSkillXp = (attrDelta > 0 || !acctHasSkill) ? await computeVerifiedSkillXp(login, token).catch((): Record<string, number> => ({})) : null;
  await gameDb.update(players).set({
    avatarSeed: currentAvatar, biggestPetSeed, biggestPetSize,
    petsCount: totalPets, rarestPetScore, rarestPetSeed,
    showcaseSeeds: showcase, verifiedAt: new Date(), wild: mergedWild,
  }).where(eq(players.id, row.id));   // verified_skill_xp is rolled up from accounts below
  // Write THIS github's account row (its score + attribution + sync cursor), then roll the
  // player's headline score/attribution up across all the user's linked githubs.
  await gameDb.update(playerAccounts).set({
    verifiedScore: acctScore, attributionScore: acctAttribution, verifiedAt: new Date(),
    lastAttributionSyncAt: acctQuery ? attributionSyncStartedAt : acct?.lastAttributionSyncAt ?? null,
    attributionLedgerInitialized: acctQuery ? true : acct?.attributionLedgerInitialized ?? true,
    ...(recomputedSkillXp ? { verifiedSkillXp: recomputedSkillXp } : {}),
  }).where(and(eq(playerAccounts.playerId, row.id), sql`lower(${playerAccounts.githubLogin}) = ${login.toLowerCase()}`));
  const agg = await rollupPlayerFromAccounts(row.id);
  const aggAttribution = agg?.attributionScore ?? acctAttribution;
  const aggScore = agg?.verifiedScore ?? acctScore;
  // Newcomer-to-board push: did this rollup push the player into the top 10? (default-board
  // metric = verified_score + merit_score; merit is unchanged by this verify). No-ops without
  // VAPID and unless the score actually rose into the top N.
  void notifyNewcomerToBoard(row.id, Number(row.verifiedScore) + Number(row.meritScore), Number(aggScore) + Number(row.meritScore));
  // Lazy daily snapshot — one row per (player, calendar day). onConflictDoNothing
  // means we only write the FIRST verify of a day; subsequent verifies don't
  // overwrite it (so the day's baseline stays the day's first reading, and weekly
  // deltas are derived from a consistent series). No cron, no schedule drift.
  const today = new Date().toISOString().slice(0, 10);
  await gameDb.insert(playerAttributionSnapshots)
    .values({ playerId: row.id, snapshotDate: today, attributionScore: aggAttribution, verifiedScore: aggScore })
    .onConflictDoNothing();
  // Attestation expiry sweep — if the verified flag is set with an expiresAt in the
  // past, demote it to a public claim (keep .provider/.claimedAt/.evidenceUrl, strip
  // .verified + .expiresAt). The next attestation POST with a fresh signed JWT re-
  // promotes. Cheaper than a separate scheduled job since every account sync passes here.
  {
    const att = (row as { aiAttestation?: { verified?: boolean; expiresAt?: string; provider?: string; claimedAt?: string; evidenceUrl?: string; webauthnVerified?: boolean } | null }).aiAttestation;
    if (att?.verified && att.expiresAt && Date.parse(att.expiresAt) < Date.now()) {
      const demoted = { provider: att.provider, claimedAt: att.claimedAt, ...(att.evidenceUrl ? { evidenceUrl: att.evidenceUrl } : {}), ...(att.webauthnVerified ? { webauthnVerified: true } : {}) };
      await gameDb.update(players).set({ aiAttestation: demoted as typeof players.$inferInsert["aiAttestation"] }).where(eq(players.id, row.id));
      row.aiAttestation = demoted as typeof row.aiAttestation;
    }
  }
  // Server-evaluated co-author + AI-participation achievements. The catalog rows live
  // in core/achievements/curated.ts with check() = false (the CLI's client-side eval
  // never grants them); this is the authoritative path. grantAchievements is in
  // sync.ts so /api/account/ai-attestation can call the same idempotent grant flow.
  const att = (row as { aiAttestation?: { verified?: boolean } | null }).aiAttestation;
  const grantIds = [
    aggAttribution >= 1     && "better-together",
    aggAttribution >= 100   && "symbiote-100",
    aggAttribution >= 1000  && "symbiote-1k",
    aggAttribution >= 10000 && "cohabit-10k",
    !!row.isAi                && "ai-revealed",
    !!att                     && "ai-attested",
    !!att?.verified           && "ai-verified",
  ].filter((x): x is string => typeof x === "string");
  const granted = await grantAchievements(row.id, grantIds);
  // Update the live AI-of-the-Week tracker. Cheap (one indexed query); only fans
  // out via SSE when the leader login actually changes.
  void recomputeWeeklyAiLeader();
  // Topic payloads are public, so this only says "this player changed"; the owner's open
  // pages refetch their private since-last-visit recap.
  if (createdPets.length > 0 || attrDelta > 0 || granted.length > 0 || Number(aggScore) !== Number(row.verifiedScore)) {
    hub.publish(`player:${row.id}`);
    hub.publish("top");
  }
  // Return the newly-minted SHAs so the client can roll the Summon cinematic. Capped
  // small (<= 6) — the cinematic burns ~2s per pet on-screen so dumping 30 at once
  // would be tedious. Anything beyond the cap still lands in `wild` (the player owns
  // every pet they earned this sync), it just doesn't get a screen-takeover entrance.
  return { ok: true, score: aggScore, baseScore: v.score, attributionScore: aggAttribution, attributionDelta: attrDelta, newPets: createdPets.length, newPetSeeds, newPetLooks,
    newPetCopies: createdPets.slice(0, 6).map(({ seed, printingId, serialNumber, printRun }) => ({ seed, printingId, serialNumber, printRun })),
    totalPets, rarestPetScore, biggestPetSize, totalStars: v.totalStars, publicRepos: v.publicRepos, extContribs: v.extContribs, accountAgeDays: v.accountAgeDays } as const;
};

// A page load, the cron, and a manual request can all ask for the same account at once.
// Share one run per login so they spend GitHub budget once and see the same result.
const inflight = new Map<string, ReturnType<typeof runGithubSync>>();

export const syncGithubAccount = (login: string, token?: string) => {
  const key = login.toLowerCase();
  const running = inflight.get(key);
  if (running) return running;
  const run = runGithubSync(login, token).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
};
