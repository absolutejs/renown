// Shared attestation state-transition logic — one implementation used by both the web
// session-protected /api/account/ai-attestation and the CLI-token /api/cli/ai-attest
// endpoints. Centralizing here means both paths apply the exact same player-row update,
// the exact same achievement grants, and the exact same audit-log writes; no drift, no
// "the CLI doesn't grant ai-verified" edge cases.

import { eq } from "drizzle-orm";
import { aiAttestationEvents, players, webhookDeliveries } from "../../../db/schema.ts";
import { defaultAuthorQuery, resolveProvider } from "./aiProviders.ts";
import { gameDb, grantAchievements, hub } from "./sync.ts";

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

  // Outbound webhook on verified attestation only — public-claim attestations stay quiet
  // (anyone can post one; not worth notifying about) but a cryptographically-verified
  // claim is a real social moment, and operators can wire RENOWN_ATTESTATION_WEBHOOK to
  // Mastodon / Bluesky / Discord / etc. for cross-surface auditability. Fire-and-forget
  // (.catch swallows errors so a webhook outage can't 500 the attestation endpoint).
  if (verified) {
    void postAttestationWebhook({
      event: "attestation.verified",
      login: githubLogin,
      provider: providerId,
      claimedAt: attestation.claimedAt,
      evidenceUrl: input.evidenceUrl,
      profileUrl: `${process.env.RENOWN_PUBLIC_BASE ?? "https://renown.local"}/?profile=${encodeURIComponent(githubLogin)}`,
      verified: true,
    });
    // Site-wide live banner — every connected browser subscribed to the
    // 'verified-attestation' hub topic gets a transient toast. Public claims stay quiet
    // for the same reason webhook stays quiet on them (low signal, can be spammed).
    hub.publish("verified-attestation", {
      login: githubLogin,
      provider: providerId,
      claimedAt: attestation.claimedAt,
    });
  }

  return { ok: true, cleared: false, provider: providerId, verified, resolvedKnownProvider: !!resolved };
};

// POST to RENOWN_ATTESTATION_WEBHOOK on verified attestations. Generic JSON payload so
// operators can wire it to any service (Mastodon `statuses` API, Bluesky bot,
// Discord/Slack webhook, IFTTT, etc.). 5s timeout — outbound webhook should never block
// our request lifecycle. Errors are console-logged but never thrown.
//
// When RENOWN_ATTESTATION_WEBHOOK_SECRET is set, the raw JSON body is HMAC-SHA256'd
// with the secret and sent as `X-Renown-Signature: sha256=<hex>`. Receivers verify with:
//
//   import { createHmac, timingSafeEqual } from "node:crypto";
//   const expected = "sha256=" + createHmac("sha256", SECRET).update(rawBody).digest("hex");
//   const got = req.headers["x-renown-signature"];
//   const ok = got && expected.length === got.length
//     && timingSafeEqual(Buffer.from(expected), Buffer.from(got));
//
// (timingSafeEqual avoids the early-return side channel.) Backwards-compatible —
// receivers that don't care about the signature just ignore the header.
type WebhookPayload = {
  event: "attestation.verified";
  login: string;
  provider: string;
  claimedAt: string;
  evidenceUrl?: string;
  profileUrl: string;
  verified: boolean;
};
// 1s → 4s → 16s exponential backoff (counted from the first attempt). Three attempts
// total before we give up and leave the deliveries log as the dead-letter store. The
// loop runs detached from the caller; the attestation endpoint never waits for it.
const RETRY_DELAYS_MS = [0, 4000, 16000];   // attempt 1 immediate, then +4s, then +16s
const deliveryId = () => `whd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const postAttestationWebhook = async (payload: WebhookPayload): Promise<void> => {
  const url = process.env.RENOWN_ATTESTATION_WEBHOOK;
  if (!url) return;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "renown-attestation-webhook",
  };
  const secret = process.env.RENOWN_ATTESTATION_WEBHOOK_SECRET;
  if (secret) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
    headers["x-renown-signature"] = "sha256=" + Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    let statusCode: number | null = null;
    let lastError: string | null = null;
    try {
      const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
      statusCode = r.status;
      if (!r.ok) lastError = `HTTP ${r.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    // Log every attempt — successes AND failures — so ops have full delivery receipts.
    try {
      await gameDb.insert(webhookDeliveries).values({
        id: deliveryId(),
        eventKind: payload.event,
        url,
        payload: payload as unknown as Record<string, unknown>,
        attempt,
        statusCode,
        lastError,
      });
    } catch (e) {
      console.error("webhook_deliveries insert failed", e);
    }
    if (statusCode !== null && statusCode >= 200 && statusCode < 300) return;   // success → done
    if (attempt === RETRY_DELAYS_MS.length) {
      console.error(`attestation webhook ${url} gave up after ${attempt} attempts; last error: ${lastError}`);
    }
  }
};
