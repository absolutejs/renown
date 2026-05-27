#!/usr/bin/env node
// Renown CLI — runtime-agnostic HTTP entry. Distinct from cli/index.ts (the full,
// Bun-flavored CLI that also has the tick/commit/heartbeat/menagerie game commands
// requiring Bun's `$` and the runtime-state machine). This entry only includes the
// HTTP-API commands so the bundle works under Node / npm / pnpm / yarn / Deno.
//
// Built via:    bun build cli/api.ts --target=node --outfile=dist/cli.mjs
// Published as: the `renown` bin in package.json
//
// Commands exposed here:
//   link / sync (via /api/cli/link)
//   ai-attest [--clear] [--auto] [--webauthn] [--jwt] [--evidence-url]
//   weekly · ai-stats · digest-test
//   rate-limited [--count N]
//   quirk <name> [--count N]  + 49 aliases (tsc / mypy / ruff / clippy / …)
//   scan-commits [--limit N] [--dry-run]
//
// Bun-game commands (tick / commit / heartbeat / menagerie / companion / parade /
// adopt / etc.) are intentionally not here — they require Bun's $ and the local
// state machine. Run those via the full CLI in this repo: `bun run cli/index.ts`.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run, runSync } from "./proc.ts";

type AppConfig = { leaderboardEndpoint?: string; playerId?: string; clientId?: string; clientSecret?: string };

// Minimal config-loader — looks at ~/.renown/config.json (XDG_CONFIG_HOME aware).
// Same shape core/runtime.ts uses; inlined so the bundle stays free of bun deps.
const loadConfig = (): AppConfig => {
  try {
    const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
    const path = join(base, "renown", "config.json");
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as AppConfig;
  } catch { return {}; }
};

// gh auth token — used by all auth'd CLI commands. Returns empty string if gh isn't
// installed or the user isn't logged in; callers decide what to do.
const ghToken = (): string => runSync(["gh", "auth", "token"]).stdout.trim();

const flag = (args: string[], name: string): string | undefined => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  if (args[i].includes("=")) return args[i].split("=", 2)[1];
  return args[i + 1];
};
const hasFlag = (args: string[], name: string) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

// Output parsers per tool — same set the bun CLI uses; copy-pasted here so the api
// bundle is self-contained. When the bun CLI's PARSE_TOOL changes, mirror the change
// here. (Could be extracted to a shared module if it grows; for now the duplication
// keeps the bundle hermetic.)
const PARSE_TOOL: Record<string, (out: string, exit: number) => number> = {
  tsc: (out) => { const m = out.match(/Found (\d+) errors? in/i); return m ? parseInt(m[1]!, 10) : (out.match(/\(\d+,\d+\):\s+error\s+TS\d+/g) ?? []).length; },
  "vue-tsc": (out) => { const m = out.match(/Found (\d+) errors? in/i); return m ? parseInt(m[1]!, 10) : (out.match(/\(\d+,\d+\):\s+error\s+TS\d+/g) ?? []).length; },
  eslint: (out) => { const m = out.match(/✖\s+(\d+)\s+problems?/); return m ? parseInt(m[1]!, 10) : (out.match(/^\s*\d+:\d+\s+error\b/gm) ?? []).length; },
  biome: (out) => { const m = out.match(/Found (\d+) errors?/i); return m ? parseInt(m[1]!, 10) : (out.match(/×\s+/g) ?? []).length; },
  mypy: (out) => { const m = out.match(/Found (\d+) errors? in/i); return m ? parseInt(m[1]!, 10) : (out.match(/:\d+:\s+error:/g) ?? []).length; },
  ruff: (out) => { const m = out.match(/Found (\d+) errors?/); return m ? parseInt(m[1]!, 10) : (out.match(/^[^\s].+:\d+:\d+:/gm) ?? []).length; },
  pyright: (out) => { const m = out.match(/(\d+) errors?,/); return m ? parseInt(m[1]!, 10) : (out.match(/^\s*\S+:\d+:\d+\s+-\s+error:/gm) ?? []).length; },
  pytest: (out) => { const m = out.match(/(\d+) failed/); return m ? parseInt(m[1]!, 10) : 0; },
  "cargo-build": (out) => { const m = out.match(/aborting due to (\d+) previous errors?/); return m ? parseInt(m[1]!, 10) : (out.match(/^error(\[E\d+\])?:/gm) ?? []).length; },
  clippy: (out) => (out.match(/^(warning|error):/gm) ?? []).length,
  "go-vet": (out) => (out.match(/^\S+:\d+:\d+:/gm) ?? []).length,
  "golangci-lint": (out) => { const m = out.match(/(\d+) issues?/); return m ? parseInt(m[1]!, 10) : (out.match(/^\S+\.go:\d+:\d+:/gm) ?? []).length; },
  shellcheck: (out) => (out.match(/^In\s+\S+\s+line\s+\d+:/gm) ?? []).length,
  hadolint: (out) => (out.match(/^\S+:\d+\s+DL\d+/gm) ?? []).length,
  yamllint: (out) => (out.match(/^\s+\d+:\d+\s+(error|warning)\s/gm) ?? []).length,
  actionlint: (out) => (out.match(/^\S+:\d+:\d+:\s/gm) ?? []).length,
  stylelint: (out) => (out.match(/^\s+\d+:\d+\s+✖\s/gm) ?? []).length,
  markdownlint: (out) => (out.match(/^\S+:\d+(?::\d+)?\s+MD\d+/gm) ?? []).length,
  oxlint: (out) => { const m = out.match(/Found (\d+) (warnings?|errors?)/); return m ? parseInt(m[1]!, 10) : (out.match(/^(warning|error)\[/gm) ?? []).length; },
  "deno-check": (out) => (out.match(/^error: TS\d+/gm) ?? []).length || (out.match(/^TS\d+/gm) ?? []).length,
};

const QUIRK_NAME_MAP: Record<string, string> = {
  pytest: "pytest-failed",
  "cargo-build": "cargo-build-broke",
};

const TOOL_COMMANDS = new Set([
  "tsc", "vue-tsc", "eslint", "biome",
  "mypy", "ruff", "pyright", "pytest",
  "cargo-build", "clippy", "go-vet", "golangci-lint",
  "shellcheck", "hadolint", "yamllint", "actionlint",
  "stylelint", "markdownlint", "oxlint", "deno-check",
]);

const KNOWN_QUIRKS = [
  "context-overflow", "hallucinated", "sycophant", "wip", "revert-revert",
  "friday-deploy", "late-night", "force-push", "stack-overflow",
  "off-by-one", "console-log-shipped", "eslint-disable", "mocked-in-prod",
  "any-type", "try-catch-empty", "commented-out-code", "fix-typo",
  "rebase-disaster", "prod-debug", "chmod-777", "dependabot-merge",
  "node-modules-rm", "mcp-crash", "wrong-model", "prompt-leaked",
  "linter-disagreed", "wifi-died", "vscode-crashed", "merge-conflict-veteran",
];

const usage = () => {
  console.log("renown — HTTP-API CLI (runtime-agnostic; works under Node, Bun, Deno, pnpm, yarn, npm)\n");
  console.log("commands:");
  console.log("  link                     link this install to GitHub (browserless, via gh auth token)");
  console.log("  ai-attest --provider X   mark this account as AI participant ([--auto] [--webauthn] [--jwt] [--clear])");
  console.log("  weekly                   7-day attribution + verified-score delta + new achievements");
  console.log("  ai-stats                 combined dashboard: attestation / weekly / rate-limits / achievements");
  console.log("  digest-test [--days N]   preview the stale-attestation digest");
  console.log("  rate-limited [--count N] report a provider rate limit (joke achievement family)");
  console.log("  quirk <name> [--count N] bump a quirk (49 aliases below)");
  console.log("  scan-commits             auto-bump quirks from git log regex matches");
  console.log("");
  console.log("tool wrappers (auto-count from output: `renown TOOL -- TOOL <args...>`):");
  console.log("  tsc / vue-tsc / eslint / biome      (JavaScript / TypeScript)");
  console.log("  mypy / ruff / pyright / pytest      (Python)");
  console.log("  cargo-build / clippy                 (Rust)");
  console.log("  go-vet / golangci-lint              (Go)");
  console.log("  shellcheck / hadolint / yamllint / actionlint  (Shell / Docker / YAML / GH Actions)");
  console.log("  stylelint / markdownlint            (CSS / Markdown)");
  console.log("  oxlint / deno-check                 (alternative JS/TS)");
  console.log("");
  console.log("renown is part of @absolutejs/renown — https://github.com/absolutejs/renown");
};

const main = async () => {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { usage(); return; }
  const cfg = loadConfig();
  const apiBase = cfg.leaderboardEndpoint?.replace(/\/$/, "");
  if (!apiBase) { console.log("No leaderboard endpoint configured. Set leaderboardEndpoint in ~/.config/renown/config.json."); return; }

  // ── link / sync (the original CLI commands re-implemented HTTP-only) ───────
  if (cmd === "link") {
    const token = ghToken();
    if (!token) { console.log("No GitHub token — run `gh auth login` first."); return; }
    const res = await fetch(`${apiBase}/cli/link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerId: cfg.playerId, token }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.ok) console.log(`✓ Linked to GitHub @${j.login} — verified score ${j.verifiedScore}.`);
    else console.log("link failed:", j.error);
    return;
  }

  // ── ai-attest ─────────────────────────────────────────────────────────────
  if (cmd === "ai-attest") {
    const args = rest;
    const clear = hasFlag(args, "clear");
    const auto = hasFlag(args, "auto");
    const webauthn = hasFlag(args, "webauthn");
    const provider = clear ? null : (flag(args, "provider") ?? (auto ? process.env.RENOWN_AI_PROVIDER : undefined));
    const jwt = clear ? undefined : (flag(args, "jwt") ?? (auto ? process.env.RENOWN_AI_ATTESTATION_JWT : undefined));
    const evidenceUrl = clear ? undefined : (flag(args, "evidence-url") ?? (auto ? process.env.RENOWN_AI_EVIDENCE_URL : undefined));
    if (webauthn) {
      if (!provider) { console.log("--webauthn requires --provider"); return; }
      const webBase = apiBase.replace(/\/api$/, "");
      const params = new URLSearchParams({ "attest-webauthn": provider });
      if (evidenceUrl) params.set("evidence", evidenceUrl);
      const url = `${webBase || "https://renown.local"}/?${params.toString()}`;
      console.log("Open this URL in a browser:\n  " + url);
      // Best-effort auto-open via OS opener.
      const opener = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
      try { void run(opener); } catch { /* not fatal */ }
      return;
    }
    if (!clear && !provider) { console.log("usage: renown ai-attest --provider <name> [--evidence-url URL] [--jwt JWT]"); return; }
    const token = ghToken();
    if (!token) { console.log("No GitHub token — run `gh auth login` first."); return; }
    const body = clear ? { token, provider: null } : { token, provider, evidenceUrl, attestationJwt: jwt };
    const res = await fetch(`${apiBase}/cli/ai-attest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.error) { console.log("ai-attest failed:", j.error); return; }
    if (j.cleared) console.log("✓ Attestation cleared.");
    else console.log(`✓ Attested as ${j.provider}${j.verified ? " ✓" : ""}${j.resolvedKnownProvider ? "" : " (unknown provider)"}`);
    return;
  }

  // ── rate-limited ──────────────────────────────────────────────────────────
  if (cmd === "rate-limited") {
    const token = ghToken();
    if (!token) { console.log("No GitHub token — run `gh auth login` first."); return; }
    const count = Number(flag(rest, "count") ?? 1);
    const res = await fetch(`${apiBase}/cli/rate-limited`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, count }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.error) { console.log("rate-limited failed:", j.error); return; }
    const total = Number(j.total ?? 0);
    console.log(total >= 1000 ? "🤖  Computational Persona Non Grata." : total >= 100 ? "🚦  Token Tax Bracket." : total >= 10 ? "✈️   Frequent Flyer." : "🤷  Rate Limited.");
    console.log(`  total: ${total.toLocaleString()}`);
    return;
  }

  // ── quirk + aliases + tool wrappers ───────────────────────────────────────
  if (cmd === "quirk" || KNOWN_QUIRKS.includes(cmd) || TOOL_COMMANDS.has(cmd)) {
    const args = rest;
    const dashIdx = args.indexOf("--");
    const countArg = flag(args, "count");
    const tokenForBump = () => {
      const tk = ghToken();
      if (!tk) { console.log("No GitHub token — run `gh auth login` first."); return null; }
      return tk;
    };
    const bump = async (name: string, count: number) => {
      const tk = tokenForBump();
      if (!tk) return null;
      const res = await fetch(`${apiBase}/cli/quirk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: tk, name, count }) }).catch(() => null);
      return res ? await res.json().catch(() => null) : null;
    };
    // Tool wrapper mode: command is a known tool AND args contain `--`. Run the
    // tool, parse output, bump the matching quirk.
    if (TOOL_COMMANDS.has(cmd) && dashIdx >= 0) {
      const toolArgs = args.slice(dashIdx + 1);
      if (toolArgs.length === 0) { console.log("missing command after `--`"); return; }
      const result = await run(toolArgs);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      const parser = PARSE_TOOL[cmd];
      if (!parser) { console.log(`no parser for ${cmd}`); return; }
      const count = parser(result.stdout + "\n" + result.stderr, result.exitCode);
      console.log(`\n  ${cmd}: ${count} issue${count === 1 ? "" : "s"} parsed.`);
      if (count > 0) {
        const quirkName = QUIRK_NAME_MAP[cmd] ?? `${cmd}-caught`;
        const j = await bump(quirkName, count);
        if (j?.ok) console.log(`  total: ${Number(j.total).toLocaleString()}  ·  granted: ${(j.granted as string[]).join(", ") || "(already in tier)"}`);
      }
      process.exit(result.exitCode);
    }
    // Manual mode: explicit count (or default 1).
    const name = cmd === "quirk" ? rest[0] : (TOOL_COMMANDS.has(cmd) ? (QUIRK_NAME_MAP[cmd] ?? `${cmd}-caught`) : cmd);
    if (!name) { console.log("usage: renown quirk <name> [--count N]   or use an alias"); return; }
    const count = Math.max(1, Number(countArg ?? 1));
    const j = await bump(name, count);
    if (j?.error) { console.log(`quirk ${name} failed:`, j.error); return; }
    if (j?.ok) console.log(`✓ ${name}  total: ${Number(j.total).toLocaleString()}  ·  granted: ${(j.granted as string[]).join(", ") || "(already in tier)"}`);
    return;
  }

  console.log(`Unknown command: ${cmd}. Run \`renown help\` for the full list.`);
};

void main();
