// One-shot substance backfill — the counterpart to db/backfill-merit.ts. For each github
// ACCOUNT on a verified player, classify that github's recent attributed commits into the
// account's substance fields, then roll each touched player up across its githubs. Multi-github
// aware. Same classifier as the substance-refresh cron, no batch cap.
//
// EXPENSIVE: each account costs 1 commit search + up to N per-commit stat fetches, plus an
// embedding per commit when RENOWN_EMBEDDING_PROVIDER is set. Use --limit to batch.
//
//   bun run db/backfill-substance.ts
//   bun run db/backfill-substance.ts --dry-run
//   bun run db/backfill-substance.ts --limit 10            # at most 10 github accounts
//   bun run db/backfill-substance.ts --commits 50 --force
//   GITHUB_TOKEN=... bun run db/backfill-substance.ts --limit 25
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { meritAchievementsToGrant } from "../web/src/backend/merit.ts";
import { aggregateSubstance, fetchRecentCommits } from "../web/src/backend/substance.ts";
import { rollupPlayerFromAccounts } from "../web/src/backend/playerAccounts.ts";
import { db } from "./index.ts";
import { players, playerAccounts } from "./schema.ts";

const argValue = (name: string) => {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const intArg = (name: string, fallback: number, min: number, max: number) => {
  const n = argValue(name) ? Number(argValue(name)) : fallback;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
};

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const acctLimit = intArg("--limit", 10, 1, 500);
const commitLimit = intArg("--commits", 30, 5, 100);
const SLEEP_MS = 750;   // GitHub commit-search is rate-limited; keep batches gentle.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-github accounts with an attribution query; only the never-classified ones unless --force.
const base = and(eq(players.githubVerified, true), isNotNull(playerAccounts.attributionQuery));
const where = force ? base : and(base, eq(playerAccounts.substanceSampleSize, 0));
const due = await db.select({ playerId: playerAccounts.playerId, login: playerAccounts.githubLogin, attributionQuery: playerAccounts.attributionQuery })
  .from(playerAccounts).innerJoin(players, eq(players.id, playerAccounts.playerId))
  .where(where).orderBy(sql`${playerAccounts.substanceSampleSize} ASC NULLS FIRST`).limit(acctLimit);
console.log(`substance backfill: ${due.length} github account(s) to classify${force ? " (forced)" : ""}; commit window=${commitLimit}`);
if (dryRun) {
  for (const [i, a] of due.entries()) console.log(`  [${i + 1}/${due.length}] @${a.login}  query=${a.attributionQuery}`);
  console.log("\ndry run complete; no GitHub calls or DB writes performed");
  process.exit(0);
}

let failed = 0, skipped = 0;
const touched = new Set<string>();
for (let i = 0; i < due.length; i++) {
  const a = due[i]!;
  try {
    const commits = await fetchRecentCommits(a.attributionQuery!, commitLimit);
    if (commits.length === 0) { skipped++; console.log(`  [${i + 1}/${due.length}] @${a.login}  skipped: no attributed commits`); continue; }
    const { mean, sampleSize, detail } = await aggregateSubstance(commits);
    await db.update(playerAccounts).set({ substanceScore: mean, substanceSampleSize: sampleSize, lastMeritSyncAt: new Date() })
      .where(and(eq(playerAccounts.playerId, a.playerId), eq(playerAccounts.githubLogin, a.login)));
    touched.add(a.playerId);
    const reasons = Object.entries(detail.reduce((m, d) => { m[d.reason] = (m[d.reason] ?? 0) + 1; return m; }, {} as Record<string, number>))
      .sort(([, x], [, y]) => y - x).slice(0, 3).map(([r, n]) => `${r}:${n}`).join(" ");
    console.log(`  [${i + 1}/${due.length}] @${a.login}  substance=${Math.round(mean * 100)}% n=${sampleSize}  ${reasons}`);
  } catch (e) {
    failed++;
    console.error(`  [${i + 1}/${due.length}] @${a.login}  FAILED: ${(e as Error).message}`);
  }
  if (i < due.length - 1) await sleep(SLEEP_MS);
}

// Roll each touched player up + grant Substance tiers off the AGGREGATE.
let totalGranted = 0;
for (const pid of touched) {
  const rolled = await rollupPlayerFromAccounts(pid);
  const grantIds = meritAchievementsToGrant({
    prReviewsCount: rolled?.prReviewsCount ?? 0, crossRepoPrsCount: rolled?.crossRepoPrsCount ?? 0,
    prsMergedCount: rolled?.prsMergedCount ?? 0, packageDownloads: rolled?.packageDownloads ?? 0,
    substanceScore: rolled?.substanceScore ?? 0, substanceSampleSize: rolled?.substanceSampleSize ?? 0,
  });
  if (grantIds.length === 0) continue;
  const arrayLiteral = `{${grantIds.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",")}}`;
  const inserted = await db.execute<{ achievement_id: string }>(sql`
    INSERT INTO player_achievements (player_id, achievement_id, unlocked_at)
    SELECT ${pid}, achievement_id, now() FROM unnest(${arrayLiteral}::text[]) AS achievement_id
    ON CONFLICT DO NOTHING RETURNING achievement_id`);
  const newIds = inserted.rows ?? [];
  if (newIds.length > 0) {
    const lit = `{${newIds.map((r) => `"${r.achievement_id.replace(/"/g, '\\"')}"`).join(",")}}`;
    await db.execute(sql`UPDATE achievements SET unlock_count = unlock_count + 1 WHERE id = ANY(${lit}::text[])`);
    totalGranted += newIds.length;
  }
}

console.log(`\n✓ substance backfill complete: ${touched.size} player(s) rolled up, ${skipped} skipped, ${failed} failed, ${totalGranted} tier-grant events`);
process.exit(failed > 0 ? 1 : 0);
