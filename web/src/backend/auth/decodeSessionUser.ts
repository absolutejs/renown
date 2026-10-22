import type { User } from "../../../db/schema";

// Sessions store the user as JSON, so a read gets back plain values: dates as strings and
// whatever an older deploy wrote. @absolutejs/auth calls this on every session read and
// drops the session when it throws, so an unexpected shape signs the visitor out rather
// than handing the app a malformed user.
const text = (value: unknown) => (typeof value === "string" ? value : null);
const date = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const decodeSessionUser = (value: unknown): User => {
  if (!value || typeof value !== "object") throw new Error("Invalid session user");
  const user = value as Record<string, unknown>;
  if (typeof user.sub !== "string" || typeof user.tier !== "string") throw new Error("Invalid session user");
  const createdAt = date(user.created_at);
  if (!createdAt) throw new Error("Invalid session user");

  return {
    created_at: createdAt,
    current_period_end: date(user.current_period_end),
    email: text(user.email),
    first_name: text(user.first_name),
    last_name: text(user.last_name),
    primary_auth_identity_id: text(user.primary_auth_identity_id),
    stripe_customer_id: text(user.stripe_customer_id),
    stripe_subscription_id: text(user.stripe_subscription_id),
    sub: user.sub,
    subscription_status: text(user.subscription_status),
    tier: user.tier,
  };
};
