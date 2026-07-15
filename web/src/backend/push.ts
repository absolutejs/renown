// Web Push fan-out — wraps the web-push lib so the rest of the app speaks our shape.
// VAPID keys come from env (RENOWN_VAPID_PUBLIC_KEY + RENOWN_VAPID_PRIVATE_KEY +
// RENOWN_VAPID_SUBJECT, the last being a mailto: or https: identifying the operator).
// When any of the three is missing, every call no-ops — production-safe to deploy
// without push configured.
//
// Failed sends with HTTP 404 / 410 (the push service says the subscription is gone)
// delete the row, so the table self-prunes; transient errors leave the row alone for
// the next event to retry.

import { and, eq, inArray, sql } from "drizzle-orm";
import webpush from "web-push";
import { achievements, players, pushSubscriptions } from "../../../db/schema.ts";
import { gameDb } from "./sync.ts";

// Push event kinds → matching field on players.push_prefs. Absence in prefs reads as
// opted-in (default-true semantic). Adding a new event kind = add a tuple here + the
// matching field in the schema's push_prefs type.
export type PushEventKind = "verified-attestation" | "newcomer-to-board" | "mention" | "level-up" | "achievement" | "season" | "marketplace";
const PREF_FIELD: Record<PushEventKind, string> = {
  "verified-attestation": "verifiedAttestation",
  "newcomer-to-board": "newcomerToBoard",
  "mention": "mention",
  "level-up": "levelUp",
  "achievement": "achievement",
  "season": "season",
  "marketplace": "marketplace",
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

// Like sendPushToPlayer, but only if the player hasn't opted out of this event kind
// (default opted-in). Used for the per-player celebration events below.
export const sendPushToPlayerGated = async (playerId: string, event: PushEventKind, payload: PushPayload): Promise<{ sent: number; pruned: number }> => {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 };
  const field = PREF_FIELD[event];
  const subs = await gameDb.select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .innerJoin(players, eq(players.id, pushSubscriptions.playerId))
    .where(and(eq(pushSubscriptions.playerId, playerId), sql`coalesce((${players.pushPrefs} ->> ${field})::boolean, true)`));
  return sendPushToSubscriptions(subs, payload);
};

// --- celebration notifiers: called from the sync layer when progression actually lands ---

// "You reached level N." Fired from persistPlayer when a player's total level crosses up.
export const notifyLevelUp = async (playerId: string, totalLevel: number): Promise<void> => {
  if (!isPushConfigured()) return;
  await sendPushToPlayerGated(playerId, "level-up", {
    title: "Level up! 🎉",
    body: `You reached total level ${totalLevel}.`,
    url: "/",
    tag: `level-${playerId}`,   // a burst of submits collapses to one notification
  }).catch((e) => console.error("renown: level-up push failed", e));
};

// "Achievement unlocked: X" (or "+N achievements" for a burst). Fired wherever new
// achievement rows are inserted for a player. Looks up names/tiers for the message.
export const notifyAchievementUnlock = async (playerId: string, ids: string[]): Promise<void> => {
  if (!isPushConfigured() || ids.length === 0) return;
  const rows = await gameDb.select({ id: achievements.id, name: achievements.name, tier: achievements.tier }).from(achievements).where(inArray(achievements.id, ids));
  if (rows.length === 0) return;
  const payload: PushPayload = rows.length === 1
    ? { title: "Achievement unlocked 🏆", body: rows[0].name, url: `/achievement/${encodeURIComponent(rows[0].id)}`, tag: `ach-${rows[0].id}` }
    : { title: `+${rows.length} achievements 🏆`, body: rows.slice(0, 3).map((r) => r.name).join(", ") + (rows.length > 3 ? `, +${rows.length - 3} more` : ""), url: "/", tag: `ach-burst-${playerId}` };
  await sendPushToPlayerGated(playerId, "achievement", payload).catch((e) => console.error("renown: achievement push failed", e));
};

// "You broke into the top N." Fired from /verify after a score rollup. Ranks by the default
// board metric (verified_score + merit_score); fires only when the player crossed from outside
// the top N into it. Two cheap COUNT(*)s, gated on the score actually rising.
export const notifyNewcomerToBoard = async (playerId: string, prevCombined: number, newCombined: number, topN = 10): Promise<void> => {
  if (!isPushConfigured() || newCombined <= prevCombined) return;
  const combined = sql<number>`${players.verifiedScore} + ${players.meritScore}`;
  // How many OTHER verified players sit strictly above a score threshold → rank = that + 1.
  const above = async (threshold: number): Promise<number> =>
    Number((await gameDb.select({ c: sql<number>`count(*)` }).from(players)
      .where(and(eq(players.githubVerified, true), sql`${players.id} <> ${playerId}`, sql`${combined} > ${threshold}`)))[0]?.c ?? 0);
  const newRank = (await above(newCombined)) + 1;
  if (newRank > topN) return;                     // not in the top N now
  const oldRank = (await above(prevCombined)) + 1;
  if (oldRank <= topN) return;                     // was already in the top N → not a newcomer
  await sendPushToPlayerGated(playerId, "newcomer-to-board", {
    title: `Top ${topN}! 🎉`,
    body: `You broke into the top ${topN} on the renown leaderboard — now #${newRank}.`,
    url: "/",
    tag: `newcomer-${playerId}`,
  }).catch((e) => console.error("renown: newcomer push failed", e));
};

// "@x followed you." Fired from the /follow route; gated on the 'mention' pref (someone
// interacting with you). Links to the new follower's circle.
export const notifyFollowed = async (followeePlayerId: string, followerLogin: string): Promise<void> => {
  if (!isPushConfigured()) return;
  await sendPushToPlayerGated(followeePlayerId, "mention", {
    title: "New follower 👀",
    body: `@${followerLogin} is now following you on renown.`,
    url: `/rivals/${encodeURIComponent(followerLogin)}`,
    tag: `follow-${followerLogin}-${followeePlayerId}`,
  }).catch((e) => console.error("renown: follow push failed", e));
};

// "🏆 You won {month}!" Fired from finalizeSeason when a season's champions are crowned.
export const notifySeasonWon = async (playerId: string, label: string, rank: number): Promise<void> => {
  if (!isPushConfigured()) return;
  await sendPushToPlayerGated(playerId, "season", {
    title: rank === 1 ? `🏆 You won ${label}!` : `Season ${label} — #${rank}!`,
    body: rank === 1 ? "You topped the renown season — enshrined in the Hall of Champions." : `You placed #${rank} this season. In the Hall of Champions.`,
    url: "/season",
    tag: `season-${label}-${playerId}`,
  }).catch((e) => console.error("renown: season push failed", e));
};

export const notifyMarketplace = async (playerId: string, title: string, body: string, tag: string): Promise<void> => {
  if (!isPushConfigured()) return;
  await sendPushToPlayerGated(playerId, "marketplace", { title, body, url: "/marketplace?view=trades", tag })
    .catch((e) => console.error("renown: marketplace push failed", e));
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
