// Scheduled background tasks. Currently just the attestation-expiry sweep — runs
// hourly and demotes verified-with-past-expiresAt attestations to public claims. The
// per-/api/verify sweep keeps active players current; this catches the players who
// never re-sync (so a stale verified badge gets demoted in a timely way regardless).
//
// Single instance, in-process — matches the rest of sync.ts. When we cluster, this
// moves to a leader-elected job (or @elysiajs/cron's clustered mode if it lands).

import { cron } from "@elysiajs/cron";
import { and, eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { players } from "../../../../db/schema.ts";
import { gameDb } from "../sync.ts";

const sweepExpiredAttestations = async (): Promise<number> => {
  // jsonb update path: build the demoted attestation (drop .verified + .expiresAt,
  // keep everything else) and write it back per matching row. Doing it in one SQL
  // statement with `(ai_attestation - 'verified' - 'expiresAt')` works but loses the
  // explicit row count + isn't much cheaper at our scale — readable wins.
  const rows = await gameDb.select().from(players).where(
    and(
      eq(players.isAi, true),
      sql`(${players.aiAttestation} ->> 'verified')::boolean = true`,
      sql`(${players.aiAttestation} ->> 'expiresAt') < ${new Date().toISOString()}`,
    ),
  );
  for (const row of rows) {
    const a = row.aiAttestation as { provider?: string; claimedAt?: string; evidenceUrl?: string; webauthnVerified?: boolean } | null;
    if (!a) continue;
    const demoted = { provider: a.provider, claimedAt: a.claimedAt, ...(a.evidenceUrl ? { evidenceUrl: a.evidenceUrl } : {}), ...(a.webauthnVerified ? { webauthnVerified: true } : {}) };
    await gameDb.update(players).set({ aiAttestation: demoted as typeof players.$inferInsert["aiAttestation"] }).where(eq(players.id, row.id));
  }
  return rows.length;
};

export const cronPlugin = () =>
  new Elysia({ name: "renown-cron" })
    .use(cron({
      name: "attestation-expiry-sweep",
      // Every hour on the hour. Cheap query (single indexed predicate + a per-row
      // update for the matches); even on a busy week we'd be sweeping a handful.
      pattern: "0 * * * *",
      run: async () => {
        try {
          const n = await sweepExpiredAttestations();
          if (n > 0) console.log(`[renown:cron] attestation-expiry-sweep demoted ${n} expired verified attestation(s)`);
        } catch (e) {
          console.error("[renown:cron] attestation-expiry-sweep failed", e);
        }
      },
    }));
