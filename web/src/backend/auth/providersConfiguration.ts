import { env } from "process";
import { defineProvidersConfiguration } from "@absolutejs/auth";

const getEnvVar = (key: string) => {
  const v = env[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`Missing environment variable ${key}`);
  return v;
};

// renown only needs login (GitHub is the identity that gates the verified leaderboard;
// Google is a convenience login). Both use the single OAUTH2_CALLBACK_URI.
export const providersConfiguration = defineProvidersConfiguration({
  github: {
    credentials: {
      clientId: getEnvVar("GITHUB_CLIENT_ID"),
      clientSecret: getEnvVar("GITHUB_CLIENT_SECRET"),
      redirectUri: getEnvVar("OAUTH2_CALLBACK_URI")
    }
  },
  google: {
    login: {
      credentials: {
        clientId: getEnvVar("GOOGLE_CLIENT_ID"),
        clientSecret: getEnvVar("GOOGLE_CLIENT_SECRET"),
        redirectUri: getEnvVar("OAUTH2_CALLBACK_URI")
      },
      scope: ["profile", "email", "openid"],
      searchParams: [["access_type", "offline"], ["prompt", "consent"]]
    }
  }
});
