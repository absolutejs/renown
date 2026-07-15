import { describe, expect, test } from "bun:test";
import { presentIdentity } from "../web/src/backend/auth/identityPresentation.ts";

describe("linked identity presentation", () => {
  test("shows a GitHub name and handle without exposing the provider subject", () => {
    expect(presentIdentity("github", "opaque-id", {
      name: "Ada Lovelace",
      login: "ada",
      avatar_url: "https://avatars.example/ada",
    })).toEqual({
      displayName: "Ada Lovelace",
      accountName: "@ada",
      avatarUrl: "https://avatars.example/ada",
    });
  });

  test("shows a Google profile name and email", () => {
    expect(presentIdentity("google", "opaque-id", {
      given_name: "Grace",
      family_name: "Hopper",
      email: "grace@example.com",
    })).toEqual({
      displayName: "Grace Hopper",
      accountName: "grace@example.com",
      avatarUrl: null,
    });
  });
});
