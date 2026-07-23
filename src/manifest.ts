import { defineManifest, toolFactory } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";

const tool = toolFactory<never>();

/* Renown is a CLI + GitHub Action, not an app library: nothing wires into the
 * site's server or client, so `wiring` is empty and integration happens via
 * lifecycle commands and exec-capability workspace tools. The CLI talks to
 * the hosted leaderboard out of the box — no settings, no env required. */
export const manifest = defineManifest<Record<never, never>>()({
  contract: 2,
  identity: {
    accent: "#eab308",
    category: "growth",
    description:
      "Earn XP and renown for real, meritorious dev work — in any editor. XP is earned by the craft and importance of each commit (never commit-count), with thousands of achievements, deep activity recaps, and competitive per-project leaderboards. AI coding agents are first-class participants with verified attribution.",
    docsUrl: "https://github.com/absolutejs/renown",
    name: "@absolutejs/renown",
    tagline: "Reward people with points and achievements.",
  },
  lifecycle: [
    {
      command: "bunx @absolutejs/renown link",
      docsUrl: "https://github.com/absolutejs/renown#quick-start",
      id: "link",
      idempotent: true,
      kind: "post-install",
      title: "Link your GitHub account for a verified score",
      when: "manual",
    },
    {
      command: "bunx @absolutejs/renown install-agent all",
      docsUrl: "https://github.com/absolutejs/renown#quick-start",
      id: "install-agent",
      idempotent: true,
      kind: "post-install",
      title: "Install editor/agent hooks so XP accrues as you work",
      when: "manual",
    },
    {
      // Code change, not a command (v1 convention): add the renown GitHub
      // Action workflow so every push scores the repo's contributors.
      docsUrl:
        "https://github.com/absolutejs/renown#github-action--auto-sync-from-ci",
      id: "github-action",
      idempotent: true,
      kind: "post-install",
      title: "Add the GitHub Action to score contributors on every push",
      when: "manual",
    },
  ],
  settings: Type.Object({}),
  tools: {
    dev_stats: tool.workspace({
      annotations: { idempotentHint: true, openWorldHint: true },
      authorization: {
        approval: "policy",
        audience: "admin",
        destinations: ["configured-renown-service"],
        effects: ["read", "external-network", "arbitrary-code"],
        idempotency: { mode: "host" },
        requiredScopes: ["renown:read"],
        reversible: false,
      },
      capabilities: ["exec"],
      description:
        "Show this workspace's dev-work dashboard: AI attestation status, 7-day recap, rate limits, and earned achievements.",
      handler: async (_input, workspace) => {
        if (!workspace.exec) return "host did not grant exec";
        const result = await workspace.exec("renown", ["ai-stats"]);

        return result.code === 0
          ? result.stdout
          : `renown failed (${result.code}): ${result.stderr}`;
      },
      input: Type.Object({}),
    }),
    sync_score: tool.workspace({
      annotations: { idempotentHint: true, openWorldHint: true },
      authorization: {
        approval: "policy",
        audience: "admin",
        destinations: ["configured-renown-service"],
        effects: ["write", "external-network", "arbitrary-code"],
        idempotency: { mode: "host" },
        requiredScopes: ["renown:sync"],
        resource: { type: "renown-profile" },
        reversible: false,
      },
      capabilities: ["exec"],
      description:
        "Push this machine's local renown state to the hosted leaderboard now, instead of waiting for the periodic sync.",
      handler: async (_input, workspace) => {
        if (!workspace.exec) return "host did not grant exec";
        const result = await workspace.exec("renown", ["sync"]);

        return result.code === 0
          ? result.stdout
          : `renown failed (${result.code}): ${result.stderr}`;
      },
      input: Type.Object({}),
    }),
  },
  wiring: [],
});
