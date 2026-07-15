import { and, asc, eq, lte, sql } from "drizzle-orm";
import { onchainTransferOutbox, petChainTokens } from "../../../db/schema.ts";
import { gameDb } from "./sync.ts";

const endpoint = process.env.RENOWN_ONCHAIN_TRANSFER_URL?.trim();
const secret = process.env.RENOWN_ONCHAIN_TRANSFER_SECRET?.trim();
export const isOnchainTransferConfigured = () => Boolean(endpoint && secret);

const signature = (body: string) => new Bun.CryptoHasher("sha256", secret!).update(body).digest("hex");

export const processOnchainTransferOutbox = async (limit = 20) => {
  if (!endpoint || !secret) return { processed: 0, anchored: 0, failed: 0, awaitingTokens: 0 };
  const due = await gameDb.select({ outbox: onchainTransferOutbox, tokenId: petChainTokens.tokenId, adapter: petChainTokens.adapter })
    .from(onchainTransferOutbox).leftJoin(petChainTokens, eq(petChainTokens.petSeed, onchainTransferOutbox.petSeed))
    .where(and(eq(onchainTransferOutbox.status, "pending"), lte(onchainTransferOutbox.nextAttemptAt, new Date())))
    .orderBy(asc(onchainTransferOutbox.createdAt)).limit(Math.max(1, Math.min(100, limit)));
  let anchored = 0, failed = 0, awaitingTokens = 0;
  for (const row of due) {
    if (!row.tokenId) { awaitingTokens++; continue; }
    const payload = JSON.stringify({
      id: row.outbox.id, tokenId: row.tokenId, adapter: row.adapter, fromUserId: row.outbox.fromPlayerId,
      toUserId: row.outbox.toPlayerId, reason: row.outbox.reason, settlementRef: row.outbox.settlementRef,
    });
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": row.outbox.id, "x-renown-signature": signature(payload) }, body: payload, signal: AbortSignal.timeout(15_000) });
      const result = await response.json().catch(() => null) as { chainRef?: string; error?: string } | null;
      if (!response.ok || !result?.chainRef) throw new Error(result?.error ?? `adapter returned HTTP ${response.status}`);
      await gameDb.execute(sql`select complete_onchain_anchor(${row.outbox.id},${result.chainRef})`); anchored++;
    } catch (error) {
      const attempts = row.outbox.attempts + 1; const message = error instanceof Error ? error.message : String(error);
      await gameDb.update(onchainTransferOutbox).set({ attempts, lastError: message.slice(0,1000), status: attempts >= 10 ? "failed" : "pending", nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 2 ** attempts * 30_000)) }).where(eq(onchainTransferOutbox.id, row.outbox.id)); failed++;
    }
  }
  return { processed: due.length, anchored, failed, awaitingTokens };
};
