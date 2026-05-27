// Shared attestation state-transition logic — one implementation used by both the web
// session-protected /api/account/ai-attestation and the CLI-token /api/cli/ai-attest
// endpoints. Centralizing here means both paths apply the exact same player-row update,
// the exact same achievement grants, and the exact same audit-log writes; no drift, no
// "the CLI doesn't grant ai-verified" edge cases.

import { trace, SpanStatusCode } from "@opentelemetry/api";
import { and, eq, sql } from "drizzle-orm";
import { aiAttestationEvents, players, webhookDeliveries } from "../../../db/schema.ts";
import { defaultAuthorQuery, resolveProvider } from "./aiProviders.ts";
import { sendPushToAll } from "./push.ts";
import { gameDb, grantAchievements, hub } from "./sync.ts";

// Tracer — no-op when no SDK is registered, so this file is safe to import in
// environments that haven't wired @opentelemetry/sdk-node. Operators who want traces
// register their SDK + exporter in server.ts entrypoint and spans flow automatically.
const tracer = trace.getTracer("renown.attestation");

export type AttestationInput =
  | { kind: "clear" }
  | { kind: "claim"; provider: string; evidenceUrl?: string; attestationJwt?: string; webauthnVerified?: boolean };

// Who triggered the attestation transition. Stamped into ai_attestation_events so the
// timeline answers "this was cleared by an admin" vs "this was the cron sweep" vs
// "Alex did it from the web." Default 'system' captures "no caller said otherwise"
// (legacy code paths + the cron job).
export type AttestationActor =
  | { kind: "system" }
  | { kind: "user"; sub: string }
  | { kind: "admin"; sub: string }
  | { kind: "cli" };

export type AttestationResult =
  | { ok: true; cleared: true }
  | { ok: true; cleared: false; provider: string; verified: boolean; webauthnVerified: boolean; resolvedKnownProvider: boolean }
  | { ok: false; error: string };

const eventId = () => `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Apply an attestation transition for the player identified by their GitHub login. Caller
// is responsible for authenticating that the requesting session/token owns that login,
// and for passing an actor describing who triggered the transition.
export const applyAttestation = async (githubLogin: string, input: AttestationInput, actor: AttestationActor = { kind: "system" }): Promise<AttestationResult> =>
  tracer.startActiveSpan("attestation.apply", { attributes: { "renown.login": githubLogin, "renown.attestation.kind": input.kind, "renown.attestation.actor": actor.kind } }, async (span) => {
    try {
      const result = await applyAttestationInner(githubLogin, input, actor);
      if (!result.ok) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.error });
      } else if (!result.cleared) {
        span.setAttributes({
          "renown.attestation.provider": result.provider,
          "renown.attestation.verified": result.verified,
          "renown.attestation.webauthn_verified": result.webauthnVerified,
          "renown.attestation.resolved_known": result.resolvedKnownProvider,
        });
      } else {
        span.setAttributes({ "renown.attestation.cleared": true });
      }
      return result;
    } catch (e) {
      span.recordException(e instanceof Error ? e : new Error(String(e)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      span.end();
    }
  });

const applyAttestationInner = async (githubLogin: string, input: AttestationInput, actor: AttestationActor): Promise<AttestationResult> => {
  const actorKind = actor.kind;
  const actorSub = actor.kind === "user" || actor.kind === "admin" ? actor.sub : null;
  const playerRows = await tracer.startActiveSpan("attestation.player_lookup", async (s) => {
    try { return await gameDb.select().from(players).where(eq(players.githubLogin, githubLogin)); }
    finally { s.end(); }
  });
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
      actorKind, actorSub,
    });
    // Live broadcast for the admin dashboard — every claim/verify/clear fires here.
    // (Distinct from "verified-attestation" which is verified-only + site-wide UI.)
    hub.publish("attestation-events", { login: githubLogin, kind: "cleared", provider: null, verified: false, at: new Date().toISOString() });
    return { ok: true, cleared: true };
  }

  // Claim path: validate inputs, resolve provider against the registry, run JWT
  // verification if provided + supported, persist + grant + log.
  const providerRaw = input.provider.trim();
  if (!providerRaw) return { ok: false, error: "provider required" };
  const resolved = resolveProvider(providerRaw);
  if (input.evidenceUrl && !/^https:\/\//.test(input.evidenceUrl)) return { ok: false, error: "evidenceUrl must be https://" };

  let verified = false;
  let verifiedExpiresAt: string | undefined;
  if (input.attestationJwt && resolved?.config.verifyJwt) {
    const v = await tracer.startActiveSpan("attestation.jwt_verify", { attributes: { "renown.attestation.provider": resolved.id } }, async (s) => {
      try {
        const r = await resolved.config.verifyJwt!(input.attestationJwt!, githubLogin);
        s.setAttribute("renown.attestation.verified", r.ok);
        return r;
      } catch { return { ok: false as const }; }
      finally { s.end(); }
    });
    if (v.ok) { verified = true; verifiedExpiresAt = v.expiresAt; }
  }
  const webauthnVerified = !!input.webauthnVerified;
  // Impersonation guard: KNOWN providers (anything in PROVIDERS) require a verified
  // JWT OR a verified WebAuthn assertion. Two distinct rejection cases when neither
  // path checks out:
  //   1. Provider is known but their registry entry has no verifyJwt — claimant can
  //      still pass via WebAuthn (self-key), otherwise we can't accept the name.
  //   2. Provider is known with a verifier, but no JWT given or it failed; and no
  //      WebAuthn assertion either.
  // Unknown providers stay in the v1 public-claim model — there's no name to borrow.
  if (resolved && !verified && !webauthnVerified) {
    if (!resolved.config.verifyJwt) {
      return { ok: false, error: `provider "${resolved.id}" is a known provider that hasn't published verification keys yet — claims as this provider need a self-key (WebAuthn) attestation, or pick an unknown provider name for a public claim.` };
    }
    return { ok: false, error: `provider "${resolved.id}" requires a verified JWT (iss=${resolved.id}, sub=<your github login>, aud=renown) OR a WebAuthn assertion from a registered hardware key. Neither was provided / valid.` };
  }

  const providerId = resolved?.id ?? providerRaw;
  const attestation = {
    provider: providerId,
    claimedAt: new Date().toISOString(),
    ...(input.evidenceUrl ? { evidenceUrl: input.evidenceUrl } : {}),
    ...(verified ? { verified: true } : {}),
    ...(webauthnVerified ? { webauthnVerified: true } : {}),
    // Provider-JWT expiry, copied from the verified JWT's exp claim. UI surfaces a
    // countdown; /api/verify re-checks at sync time and demotes verified=true to a
    // public claim when expired (without clearing the attestation outright — the
    // provider can re-sign and bump it back).
    ...(verifiedExpiresAt ? { expiresAt: verifiedExpiresAt } : {}),
  };

  const update: Partial<typeof players.$inferInsert> = { aiAttestation: attestation, isAi: true };
  if (resolved) {
    update.attributionQuery = resolved.config.coauthorQuery;
    update.lastAttributionSyncAt = null;
  }
  await tracer.startActiveSpan("attestation.player_update", async (s) => {
    try { await gameDb.update(players).set(update).where(eq(players.id, player.id)); }
    finally { s.end(); }
  });

  // Two events when a JWT verifies: the "claimed" event for the storage, plus a
  // "verified" event so the timeline shows the trust-elevation as a distinct moment.
  await tracer.startActiveSpan("attestation.audit_insert", { attributes: { "renown.attestation.events": verified ? 2 : 1 } }, async (s) => {
    try {
      await gameDb.insert(aiAttestationEvents).values({
        id: eventId(), playerId: player.id, kind: "claimed",
        provider: providerId, evidenceUrl: input.evidenceUrl ?? null, verified: false,
        actorKind, actorSub,
      });
      if (verified) {
        await gameDb.insert(aiAttestationEvents).values({
          id: eventId(), playerId: player.id, kind: "verified",
          provider: providerId, evidenceUrl: input.evidenceUrl ?? null, verified: true,
          actorKind, actorSub,
        });
      }
    } finally { s.end(); }
  });
  // Live broadcast for the admin dashboard — claim row always, plus a verified row
  // when the JWT checked out. Sibling to the "verified-attestation" hub topic which
  // is verified-only + drives the site-wide user-facing toast; this topic is
  // event-for-event, intended for ops consoles that want every state change.
  hub.publish("attestation-events", { login: githubLogin, kind: "claimed", provider: providerId, verified: false, evidenceUrl: input.evidenceUrl ?? null, at: attestation.claimedAt });
  if (verified) hub.publish("attestation-events", { login: githubLogin, kind: "verified", provider: providerId, verified: true, evidenceUrl: input.evidenceUrl ?? null, at: attestation.claimedAt });

  // Instant grant — ai-revealed always, ai-attested once we've stored one, ai-verified
  // only on a successful JWT verify. /api/verify also grants these on its next pass.
  await tracer.startActiveSpan("attestation.grant_achievements", async (s) => {
    try {
      const granted = await grantAchievements(player.id, [
        "ai-revealed",
        "ai-attested",
        ...(verified ? ["ai-verified"] : []),
        ...(webauthnVerified ? ["ai-self-verified"] : []),
      ]);
      s.setAttribute("renown.attestation.newly_granted", granted.length);
    } finally { s.end(); }
  });

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
    // OS-level push to every subscribed browser — reaches CLOSED tabs (Service Worker
    // handles the push event even with no renown tab open). No-ops when VAPID env
    // isn't configured. Fire-and-forget.
    void sendPushToAll("verified-attestation", {
      title: "🤖 Verified AI attestation",
      body: `@${githubLogin} attested as ${providerId} ✓`,
      url: `${process.env.RENOWN_PUBLIC_BASE ?? "https://renown.local"}/?profile=${encodeURIComponent(githubLogin)}`,
      tag: `attestation:${githubLogin}:${attestation.claimedAt}`,
    });
  }

  return { ok: true, cleared: false, provider: providerId, verified, webauthnVerified, resolvedKnownProvider: !!resolved };
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
// Stale-attestation digest builder. Returns every player whose verified attestation
// expires within `withinDays`, with the per-row metadata an operator-side emailer
// would need. Stays in this module since it's about attestation lifecycle. The cron
// (cronPlugin) and the admin endpoint both call it; the cron additionally POSTs the
// digest to RENOWN_DIGEST_WEBHOOK if set so an operator can wire it to an email
// service of their choice.
export type StaleEntry = { login: string | null; handle: string; provider: string | null; expiresAt: string | null; daysUntilExpiry: number };
export const buildStaleAttestationDigest = async (withinDays: number): Promise<StaleEntry[]> => {
  const cutoffMs = Date.now() + withinDays * 24 * 60 * 60 * 1000;
  const rows = await gameDb.select().from(players).where(and(
    eq(players.isAi, true),
    sql`(${players.aiAttestation} ->> 'verified')::boolean = true`,
    sql`(${players.aiAttestation} ->> 'expiresAt') < ${new Date(cutoffMs).toISOString()}`,
  ));
  return rows.map((r) => {
    const a = r.aiAttestation as { provider?: string; expiresAt?: string } | null;
    const expiresAt = a?.expiresAt ?? null;
    const daysUntilExpiry = expiresAt ? Math.round((Date.parse(expiresAt) - Date.now()) / (24 * 60 * 60 * 1000)) : -Infinity;
    return { login: r.githubLogin, handle: r.handle, provider: a?.provider ?? null, expiresAt, daysUntilExpiry };
  }).sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
};

// 0s → 4s → 16s exponential backoff. Three attempts before we give up and leave the
// deliveries log as the dead-letter store. The loop runs detached from the caller; the
// attestation endpoint never waits for it.
const RETRY_DELAYS_MS = [0, 4000, 16000];
const deliveryId = () => `whd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Generic deliver-with-retry-and-log helper. Used by both the live attestation path
// (postAttestationWebhook below) and the admin replay endpoint. Takes the url + event
// kind + arbitrary jsonable payload; signs the body with RENOWN_ATTESTATION_WEBHOOK_SECRET
// when set; logs every attempt to webhook_deliveries.
export const deliverWebhook = async (url: string, eventKind: string, payload: Record<string, unknown>): Promise<void> => {
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
    try {
      await gameDb.insert(webhookDeliveries).values({
        id: deliveryId(),
        eventKind,
        url,
        payload,
        attempt,
        statusCode,
        lastError,
      });
    } catch (e) {
      console.error("webhook_deliveries insert failed", e);
    }
    if (statusCode !== null && statusCode >= 200 && statusCode < 300) return;
    if (attempt === RETRY_DELAYS_MS.length) {
      console.error(`webhook ${url} (${eventKind}) gave up after ${attempt} attempts; last error: ${lastError}`);
    }
  }
};

const postAttestationWebhook = async (payload: WebhookPayload): Promise<void> => {
  const url = process.env.RENOWN_ATTESTATION_WEBHOOK;
  if (!url) return;
  await deliverWebhook(url, payload.event, payload as unknown as Record<string, unknown>);
};
