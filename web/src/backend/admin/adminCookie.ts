// Minimal signed cookie for the admin session realm — separate from @absolutejs/auth's
// `user_session_id` so user and admin sessions can't impersonate each other. HMAC-SHA256
// over a tiny `{sub, exp}` payload; reads `ADMIN_SESSION_SECRET` (32+ random bytes).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 12 * 60 * 60 * 1000;   // 12 hours
const enc = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const dec = (s: string) => Buffer.from(s, "base64url").toString("utf8");

const secret = () => {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("ADMIN_SESSION_SECRET must be set (>= 32 chars)");
  return s;
};

export const issueAdminToken = (sub: string) => {
  const payload = enc(JSON.stringify({ exp: Date.now() + TTL_MS, sub }));
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
};

export const verifyAdminToken = (token: string | undefined): { sub: string } | null => {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig, "base64url"), Buffer.from(expected, "base64url"))) return null;
  } catch { return null; }
  try {
    const data = JSON.parse(dec(payload)) as { sub?: string; exp?: number };
    if (!data.sub || !data.exp || data.exp < Date.now()) return null;
    return { sub: data.sub };
  } catch { return null; }
};

export const adminCookieName = "renown_admin";
export const adminCookieAttrs = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
export const randomSecret = () => randomBytes(32).toString("base64url");
