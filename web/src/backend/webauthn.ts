// WebAuthn server helpers — registration and assertion. Uses @simplewebauthn/server's
// generateRegistrationOptions / verifyRegistrationResponse / generateAuthenticationOptions
// / verifyAuthenticationResponse. Challenges are stored in a short-lived in-process
// map keyed by playerId; on a multi-instance deploy this would move to Redis (same
// caveat as the reactive hub).
//
// Origin / RP ID derive from env RENOWN_RP_ID + RENOWN_PUBLIC_BASE so deployments can
// own these without a code change. Defaults to localhost for dev.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";

const RP_ID = process.env.RENOWN_RP_ID ?? "localhost";
const ORIGIN = process.env.RENOWN_PUBLIC_BASE ?? "http://localhost:3000";
const RP_NAME = "Renown";

// Challenge store — { playerId → { challenge, expiresAt } }. 5-min TTL is generous;
// real registration / authentication flows complete in seconds. Stale entries are
// reaped on read so the map can't grow unbounded.
type Challenge = { challenge: string; expiresAt: number };
const challenges = new Map<string, Challenge>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const putChallenge = (playerId: string, challenge: string) => {
  challenges.set(playerId, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
};
const takeChallenge = (playerId: string): string | null => {
  const hit = challenges.get(playerId);
  challenges.delete(playerId);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) return null;
  return hit.challenge;
};

export const buildRegistrationOptions = async (playerId: string, username: string, existingCredentialIds: string[]) => {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: username,
    userID: new TextEncoder().encode(playerId),
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    excludeCredentials: existingCredentialIds.map((id) => ({ id })),
  });
  putChallenge(playerId, options.challenge);
  return options;
};

export const verifyRegistration = async (playerId: string, response: Parameters<typeof verifyRegistrationResponse>[0]["response"]) => {
  const challenge = takeChallenge(playerId);
  if (!challenge) return { ok: false as const, error: "no pending registration challenge (start over)" };
  try {
    const v = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    if (!v.verified || !v.registrationInfo) return { ok: false as const, error: "registration verification failed" };
    const cred = v.registrationInfo.credential;
    return {
      ok: true as const,
      credentialId: cred.id,                                  // already base64url
      publicKey: Buffer.from(cred.publicKey).toString("base64url"),
      counter: cred.counter,
      transports: cred.transports ?? [],
    };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
};

export const buildAuthenticationOptions = async (playerId: string, allowCredentialIds: string[]) => {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    allowCredentials: allowCredentialIds.map((id) => ({ id })),
  });
  putChallenge(playerId, options.challenge);
  return options;
};

export type VerifiedAuth = { ok: true; credentialId: string; newCounter: number } | { ok: false; error: string };
export const verifyAuthentication = async (
  playerId: string,
  response: Parameters<typeof verifyAuthenticationResponse>[0]["response"],
  storedCredential: { credentialId: string; publicKey: string; counter: number; transports: string[] },
): Promise<VerifiedAuth> => {
  const challenge = takeChallenge(playerId);
  if (!challenge) return { ok: false, error: "no pending authentication challenge (start over)" };
  try {
    const v: VerifiedAuthenticationResponse = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: storedCredential.credentialId,
        publicKey: new Uint8Array(Buffer.from(storedCredential.publicKey, "base64url")),
        counter: storedCredential.counter,
        transports: storedCredential.transports as ("usb" | "nfc" | "ble" | "internal" | "hybrid")[],
      },
    });
    if (!v.verified) return { ok: false, error: "authentication verification failed" };
    return { ok: true, credentialId: storedCredential.credentialId, newCounter: v.authenticationInfo.newCounter };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};
