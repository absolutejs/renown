// Web Push fan-out — wraps the web-push lib so the rest of the app speaks our shape.
// VAPID keys come from env (RENOWN_VAPID_PUBLIC_KEY + RENOWN_VAPID_PRIVATE_KEY +
// RENOWN_VAPID_SUBJECT, the last being a mailto: or https: identifying the operator).
// When any of the three is missing, every call no-ops — production-safe to deploy
// without push configured.
//
// Failed sends with HTTP 404 / 410 (the push service says the subscription is gone)
// delete the row, so the table self-prunes; transient errors leave the row alone for
// the next event to retry.

import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { pushSubscriptions } from "../../../db/schema.ts";
import { gameDb } from "./sync.ts";

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

// Send a payload to every active subscription. Used for site-wide events like
// verified-attestation. For per-player notifications, filter the table on player_id
// before calling.
export const sendPushToAll = async (payload: PushPayload): Promise<{ sent: number; pruned: number }> => {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 };
  const subs = await gameDb.select().from(pushSubscriptions);
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
