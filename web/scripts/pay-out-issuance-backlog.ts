// One-off payout (2026-10-24): every recorded contribution earns its collectible.
// Before durable receipts a sync minted only for the commits new in that sync,
// capped at 30, so most recorded contributions never produced a pet. This drains
// each player's pending receipts oldest first through the same issuance path the
// server uses (issuePetCopies with contribution receipts): deterministic subject
// and variant, atomic serial allocation, and a receipt bound in the same
// transaction, so a rerun resumes and never mints twice.
//
// Run from the repository root against the target database:
//   DATABASE_URL=... bun web/scripts/pay-out-issuance-backlog.ts
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { attributionCommits } from "../../db/schema.ts";
import { issuePetCopies } from "../src/backend/petIssuance.ts";
import { gameDb } from "../src/backend/sync.ts";

const BATCH = 60;
const PARALLEL = 6;

const owners = await gameDb
  .selectDistinct({ playerId: attributionCommits.playerId, githubLogin: attributionCommits.githubLogin })
  .from(attributionCommits)
  .where(isNull(attributionCommits.issuedPetSeed));

const pendingCount = async () =>
  Number((await gameDb.execute(sql`select count(*)::int as n from attribution_commits where issued_pet_seed is null`))
    .rows[0]?.n ?? 0);

console.log(`payout: ${owners.length} player logins, ${await pendingCount()} pending receipts`);

let minted = 0;
let linked = 0;
await Promise.all(owners.map(async ({ playerId, githubLogin }) => {
  for (;;) {
    const pending = await gameDb.select({ sha: attributionCommits.sha }).from(attributionCommits)
      .where(and(eq(attributionCommits.playerId, playerId), eq(attributionCommits.githubLogin, githubLogin),
        isNull(attributionCommits.issuedPetSeed)))
      .orderBy(asc(attributionCommits.discoveredAt), asc(attributionCommits.sha))
      .limit(BATCH);
    if (pending.length === 0) return;
    const chunks = Array.from({ length: PARALLEL }, (_, index) =>
      pending.filter((_, position) => position % PARALLEL === index).map((row) => row.sha));
    const issued = (await Promise.all(chunks.filter((chunk) => chunk.length > 0).map((provenanceSeeds) =>
      issuePetCopies({ playerId, githubLogin, provenanceSeeds, contributionReceipts: true })))).flat();
    for (const pet of issued) if (pet.created) minted++; else linked++;
    if (issued.length < pending.length)
      throw new Error(`payout: ${pending.length - issued.length} receipts for ${githubLogin} did not issue`);
  }
}));

console.log(`payout: minted ${minted}, linked ${linked} existing copies, ${await pendingCount()} still pending`);
