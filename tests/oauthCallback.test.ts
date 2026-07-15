import { describe, expect, test } from "bun:test";
import { oauthAccessToken, oauthErrorCode, replaceSessionAccessToken } from "../web/src/backend/auth/oauthCallback.ts";

describe("OAuth callback token handling", () => {
  test("rejects provider error bodies instead of using Bearer undefined", () => {
    const response = { error: "bad_verification_code", error_description: "expired" };
    expect(oauthAccessToken(response)).toBeNull();
    expect(oauthErrorCode(response)).toBe("bad_verification_code");
    expect(oauthErrorCode({ error: "bad code\nsecret" })).toBe("invalid_oauth_error");
  });

  test("activates a newly linked GitHub token on the existing session", () => {
    const sessions = {
      session: { user: { sub: "user-1" }, accessToken: "old-provider-token", expiresAt: 123 },
    };
    expect(replaceSessionAccessToken(sessions, "session", "new-github-token")).toBe(true);
    expect(sessions.session.accessToken).toBe("new-github-token");
    expect(sessions.session.user).toEqual({ sub: "user-1" });
  });

  test("does not create a session when the callback session is absent", () => {
    const sessions = {};
    expect(replaceSessionAccessToken(sessions, "missing", "token")).toBe(false);
    expect(sessions).toEqual({});
  });
});
