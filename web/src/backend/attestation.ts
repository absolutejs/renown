// Shared attestation state-transition logic — one implementation used by both the web
// session-protected /api/account/ai-attestation and the CLI-token /api/cli/ai-attest
// endpoints. Centralizing here means both paths apply the exact same player-row update,
// the exact same achievement grants, and the exact same audit-log writes; no drift, no
// "the CLI doesn't grant ai-verified" edge cases.

import { eq } from "drizzle-orm";
import { aiAttestationEvents, players } from "../../../db/schema.ts";
import { defaultAuthorQuery, resolveProvider } from "./aiProviders.ts";
import { gameDb, grantAchievements } from "./sync.ts";

export type AttestationInput =
  | { kind: "clear" }
  | { kind: "claim"; provider: string; evidenceUrl?: string; attestationJwt?: string };

export type AttestationResult =
  | { ok: true; cleared: true }
  | { ok: true; cleared: false; provider: string; verified: boolean; resolvedKnownProvider: boolean }
  | { ok: false; error: string };

const eventId = () => `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Apply an attestation transition for the player identified by their GitHub login. Caller
// is responsible for authenticating that the requesting session/token owns that login.
export const applyAttestation = async (githubLogin: string, input: AttestationInput): Promise<AttestationResult> => {
  const playerRows = await gameDb.select().from(players).where(eq(players.githubLogin, githubLogin));
  const player = playerRows[0];
  if (!player) return { ok: false, error: "player not found" };

  if (input.kind === "clear") {
    await gameDb.update(players).set({
      aiAttestation: null,
      isAi: false,
      attributionQuery: defaultAuthorQuery(githubLogin),
      lastAttributionSyncAt: null,
    }).where(eq(players.id, player.id));
    await gameDb.insert(aiAttestationEvents).values({
      id: eventId(), playerId: player.id, kind: "cleared",
      provider: null, evidenceUrl: null, verified: false,
    });
    return { ok: true, cleared: true };
  }

  // Claim path: validate inputs, resolve provider against the registry, run JWT
  // verification if provided + supported, persist + grant + log.
  const providerRaw = input.provider.trim();
  if (!providerRaw) return { ok: false, error: "provider required" };
  const resolved = resolveProvider(providerRaw);
  if (input.evidenceUrl && !/^https:\/\//.test(input.evidenceUrl)) return { ok: false, error: "evidenceUrl must be https://" };

  let verified = false;
  if (input.attestationJwt && resolved?.config.verifyJwt) {
    try { verified = await resolved.config.verifyJwt(input.attestationJwt, githubLogin); }
    catch { verified = false; }
  }

  const providerId = resolved?.id ?? providerRaw;
  const attestation = {
    provider: providerId,
    claimedAt: new Date().toISOString(),
    ...(input.evidenceUrl ? { evidenceUrl: input.evidenceUrl } : {}),
    ...(verified ? { verified: true } : {}),
  };

  const update: Partial<typeof players.$inferInsert> = { aiAttestation: attestation, isAi: true };
  if (resolved) {
    update.attributionQuery = resolved.config.coauthorQuery;
    update.lastAttributionSyncAt = null;
  }
  await gameDb.update(players).set(update).where(eq(players.id, player.id));

  // Two events when a JWT verifies: the "claimed" event for the storage, plus a
  // "verified" event so the timeline shows the trust-elevation as a distinct moment.
  await gameDb.insert(aiAttestationEvents).values({
    id: eventId(), playerId: player.id, kind: "claimed",
    provider: providerId, evidenceUrl: input.evidenceUrl ?? null, verified: false,
  });
  if (verified) {
    await gameDb.insert(aiAttestationEvents).values({
      id: eventId(), playerId: player.id, kind: "verified",
      provider: providerId, evidenceUrl: input.evidenceUrl ?? null, verified: true,
    });
  }

  // Instant grant — ai-revealed always, ai-attested once we've stored one, ai-verified
  // only on a successful JWT verify. /api/verify also grants these on its next pass.
  await grantAchievements(player.id, [
    "ai-revealed",
    "ai-attested",
    ...(verified ? ["ai-verified"] : []),
  ]);

  return { ok: true, cleared: false, provider: providerId, verified, resolvedKnownProvider: !!resolved };
};
