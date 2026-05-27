// Web Push fan-out — wraps the web-push lib so the rest of the app speaks our shape.
// VAPID keys come from env (RENOWN_VAPID_PUBLIC_KEY + RENOWN_VAPID_PRIVATE_KEY +
// RENOWN_VAPID_SUBJECT, the last being a mailto: or https: identifying the operator).
// When any of the three is missing, every call no-ops — production-safe to deploy
// without push configured.
//
// Failed sends with HTTP 404 / 410 (the push service says the subscription is gone)
// delete the row, so the table self-prunes; transient errors leave the row alone for
// the next event to retry.

import { eq, inArray, sql } from "drizzle-orm";
import webpush from "web-push";
import { players, pushSubscriptions } from "../../../db/schema.ts";
import { gameDb } from "./sync.ts";

// Push event kinds → matching field on players.push_prefs. Absence in prefs reads as
// opted-in (default-true semantic). Adding a new event kind = add a tuple here + the
// matching field in the schema's push_prefs type.
export type PushEventKind = "verified-attestation" | "newcomer-to-board" | "mention";
const PREF_FIELD: Record<PushEventKind, string> = {
  "verified-attestation": "verifiedAttestation",
  "newcomer-to-board": "newcomerToBoard",
  "mention": "mention",
};

let configured = false;
const ensureConfigured = (): boolean => {
  if (configured) return true;
  const pub = process.env.RENOWN_VAPID_PUBLIC_KEY;
  const priv = process.env.RENOWN_VAPID_PRIVATE_KEY;
  const subj = process.env.RENOWN_VAPID_SUBJECT;
  if (!pub || !priv || !subj) return false;
  webpush.setVapidDetails(subj, pub, priv);
  configured = true;
  return true;
};

export const isPushConfigured = () => ensureConfigured();

export const getPushPublicKey = (): string | null => {
  if (!ensureConfigured()) return null;
  return process.env.RENOWN_VAPID_PUBLIC_KEY ?? null;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;             // where the client should navigate on click
  tag?: string;             // dedupe key — bursts collapse to one notification per tag
};

// Send a payload to every active subscription whose player has opted in to this event
// kind. Used for site-wide events like verified-attestation. The pref join is a single
// SQL filter — push_prefs.<field> NOT FALSE means "true or unset" (default opted-in).
export const sendPushToAll = async (event: PushEventKind, payload: PushPayload): Promise<{ sent: number; pruned: number }> => {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 };
  const field = PREF_FIELD[event];
  const subs = await gameDb.select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .innerJoin(players, eq(players.id, pushSubscriptions.playerId))
    .where(sql`coalesce((${players.pushPrefs} ->> ${field})::boolean, true)`);
  return sendPushToSubscriptions(subs, payload);
};

export const sendPushToPlayer = async (playerId: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> => {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 };
  const subs = await gameDb.select().from(pushSubscriptions).where(eq(pushSubscriptions.playerId, playerId));
  return sendPushToSubscriptions(subs, payload);
};

const sendPushToSubscriptions = async (subs: { id: string; endpoint: string; p256dh: string; auth: string }[], payload: PushPayload): Promise<{ sent: number; pruned: number }> => {
  if (subs.length === 0) return { sent: 0, pruned: 0 };
  const body = JSON.stringify(payload);
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 });
      sent++;
    } catch (e) {
      // 404 / 410 means the browser has unsubscribed or the endpoint is permanently
      // gone — drop the row. Other errors (timeouts, 5xx) are transient; leave it.
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.id);
      else console.error(`push send failed (status ${code ?? "?"})`, e);
    }
  }));
  if (gone.length > 0) {
    await gameDb.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  }
  return { sent, pruned: gone.length };
};
