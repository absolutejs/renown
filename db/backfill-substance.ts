// One-shot substance backfill — classify recent attributed commits for verified
// players, write players.substance_score + .substance_sample_size, recompute
// merit_score, and grant any newly-crossed Substance ladder tiers.
//
// Expensive: each player costs one commit-search call plus up to N per-commit
// GitHub calls, and RAG mode may add embedding calls. Defaults are conservative.
//
//   bun run db/backfill-substance.ts
//   bun run db/backfill-substance.ts --dry-run
//   bun run db/backfill-substance.ts --limit 10
//   bun run db/backfill-substance.ts --commits 50 --force
//   GITHUB_TOKEN=... bun run db/backfill-substance.ts --limit 25
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { computeMeritScore, meritAchievementsToGrant } from "../web/src/backend/merit.ts";
import { aggregateSubstance, fetchRecentCommits } from "../web/src/backend/substance.ts";
import { db } from "./index.ts";
import { players } from "./schema.ts";

const argValue = (name: string) => {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const intArg = (name: string, fallback: number, min: number, max: number) => {
  const raw = argValue(name);
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const playerLimit = intArg("--limit", 10, 1, 500);
const commitLimit = intArg("--commits", 30, 5, 100);

const SLEEP_MS = 750; // GitHub commit-search is rate-limited; keep batches gentle.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const where = force
  ? and(eq(players.githubVerified, true), isNotNull(players.githubLogin), isNotNull(players.attributionQuery))
  : and(
      eq(players.githubVerified, true),
      isNotNull(players.githubLogin),
      isNotNull(players.attributionQuery),
      eq(players.substanceSampleSize, 0),
    );

const due = await db.select().from(players).where(where).orderBy(sql`${players.createdAt} ASC`).limit(playerLimit);
console.log(`substance backfill: ${due.length} player(s) to classify${force ? " (forced)" : ""}; commit window=${commitLimit}`);
if (dryRun) {
  for (const [i, p] of due.entries()) {
    console.log(`  [${i + 1}/${due.length}] @${p.githubLogin}  query=${p.attributionQuery}`);
  }
  console.log("\ndry run complete; no GitHub calls or DB writes performed");
  process.exit(0);
}

let totalGranted = 0, failed = 0, skipped = 0;

for (let i = 0; i < due.length; i++) {
  const p = due[i]!;
  const login = p.githubLogin!;
  try {
    const commits = await fetchRecentCommits(p.attributionQuery!, commitLimit);
    if (commits.length === 0) {
      skipped++;
      console.log(`  [${i + 1}/${due.length}] @${login}  skipped: no attributed commits found`);
      continue;
    }

    const { mean, sampleSize, detail } = await aggregateSubstance(commits);
    const meritScore = computeMeritScore({
      prReviewsCount: p.prReviewsCount,
      crossRepoPrsCount: p.crossRepoPrsCount,
      prsAuthoredCount: p.prsAuthoredCount,
      prsMergedCount: p.prsMergedCount,
      packageDownloads: Number(p.packageDownloads),
      substanceScore: mean,
      substanceSampleSize: sampleSize,
    });

    await db.update(players).set({
      substanceScore: mean,
      substanceSampleSize: sampleSize,
      meritScore,
    }).where(eq(players.id, p.id));

    const grantIds = meritAchievementsToGrant({
      prReviewsCount: p.prReviewsCount,
      crossRepoPrsCount: p.crossRepoPrsCount,
      prsMergedCount: p.prsMergedCount,
      packageDownloads: Number(p.packageDownloads),
      substanceScore: mean,
      substanceSampleSize: sampleSize,
    });

    let insertedGrantCount = 0;
    if (grantIds.length > 0) {
      const arrayLiteral = `{${grantIds.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",")}}`;
      const inserted = await db.execute<{ insertedCount: number }>(sql`
        WITH inserted AS (
          INSERT INTO player_achievements (player_id, achievement_id, unlocked_at)
          SELECT ${p.id}, achievement_id, now()
          FROM unnest(${arrayLiteral}::text[]) AS achievement_id
          ON CONFLICT DO NOTHING
          RETURNING achievement_id
        ), bumped AS (
          UPDATE achievements
          SET unlock_count = unlock_count + 1
          WHERE id IN (SELECT achievement_id FROM inserted)
          RETURNING id
        )
        SELECT count(*)::int AS "insertedCount" FROM inserted
      `);
      insertedGrantCount = Number(inserted.rows[0]?.insertedCount ?? 0);
      totalGranted += insertedGrantCount;
    }

    const reasons = Object.entries(detail.reduce((m, d) => {
      m[d.reason] = (m[d.reason] ?? 0) + 1;
      return m;
    }, {} as Record<string, number>)).sort(([, a], [, b]) => b - a).slice(0, 3);
    const reasonSummary = reasons.map(([reason, n]) => `${reason}:${n}`).join(" ");
    console.log(`  [${i + 1}/${due.length}] @${login}  substance=${Math.round(mean * 100)}% n=${sampleSize} merit=${meritScore} +${insertedGrantCount} tier(s) ${reasonSummary}`);
  } catch (e) {
    failed++;
    console.error(`  [${i + 1}/${due.length}] @${login}  FAILED: ${(e as Error).message}`);
  }
  if (i < due.length - 1) await sleep(SLEEP_MS);
}

console.log(`\n✓ substance backfill complete: ${due.length - failed - skipped} synced, ${skipped} skipped, ${failed} failed, ${totalGranted} tier-grant events recorded`);
process.exit(failed > 0 ? 1 : 0);
