#!/usr/bin/env node
// Renown CLI — runtime-agnostic entry. Distinct from cli/index.ts (the full,
// Bun-flavored CLI that also has commit reconciliation / the TUI / creature animation).
// This file carries HTTP commands plus the small local state commands agents need
// (`agent`, `statusline`) so the npm-installed binary works in Codex, Claude, Cursor,
// and other coding-agent runtimes without Bun.
//
// Built via:    bun build cli/api.ts --target=node --outfile=dist/cli.mjs
// Published as: the `renown` bin in package.json
//
// Commands exposed here:
//   agent <provider> / statusline
//   heartbeat (lightweight HUD refresh + submit; full commit scoring lives in cli/index.ts)
//   link / sync (via /api/cli/link)
//   ai-attest [--clear] [--auto] [--webauthn] [--jwt] [--evidence-url]
//   weekly · ai-stats · digest-test
//   rate-limited [--count N]
//   quirk <name> [--count N]  + 49 aliases (tsc / mypy / ruff / clippy / …)
//   scan-commits [--limit N] [--dry-run]
//
// Bun-game commands (tick / commit / heartbeat / menagerie / companion / parade /
// adopt / etc.) are intentionally not here — some require Bun's $ and the richer local
// state machine. Run those via the full CLI in this repo: `bun run cli/index.ts`.

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { run, runSync } from "./proc.ts";
import { agentById, agentFromEnv, normalizeAgentId } from "../core/agents.ts";
import { applyGains, displayLevelForSkill, skillById, skillProgress, topSkills, totalLevel } from "../core/skills.ts";
import { createInterface } from "node:readline";
import { face, frames, generate, renderCard } from "../core/procgen.ts";
import { play } from "../core/ascii.ts";
import { B, R, gradientBar, gradient, rainbow, shimmer } from "../core/shiny.ts";
import { evalAll, info as achInfo } from "../core/achievements/index.ts";

type AppConfig = { leaderboardEndpoint?: string; playerId?: string; playerName?: string; clientId?: string; clientSecret?: string; autoUpdate?: boolean; sourceDir?: string };

const HOME = homedir();
const RDIR = join(HOME, ".renown");
const STATE = join(RDIR, "state.json");
const HUD = join(RDIR, "hud.txt");
const CELEBRATIONS = join(RDIR, "celebrations.txt");
const TMUX_CONF = join(RDIR, "tmux-status.conf");
const CODEX_REAL = join(RDIR, "codex-real-path");

// The hosted leaderboard. A fresh install points here so `renown link` / submit
// work out of the box; self-hosters override via config.leaderboardEndpoint or the
// RENOWN_ENDPOINT env var (env > config > this default).
const DEFAULT_ENDPOINT = "https://renown.absolutejs.com/api";

// Minimal config-loader — accepts the historical XDG path and the current ~/.renown
// path used by the local engine. Always resolves an endpoint so the CLI is usable
// the moment it's installed.
const loadConfig = (): AppConfig => {
  const withEndpoint = (c: AppConfig): AppConfig => ({
    ...c,
    leaderboardEndpoint: process.env.RENOWN_ENDPOINT || c.leaderboardEndpoint || DEFAULT_ENDPOINT,
  });
  try {
    const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
    const path = [join(RDIR, "config.json"), join(base, "renown", "config.json")].find((p) => existsSync(p));
    if (!path) return withEndpoint({});
    return withEndpoint(JSON.parse(readFileSync(path, "utf8")) as AppConfig);
  } catch { return withEndpoint({}); }
};

type LocalState = {
  v?: number; name?: string; playerId?: string; createdAt?: number;
  xp?: number; lifetimeXp?: number; streak?: number; ossCommits?: number;
  achievements?: Record<string, number>; skillXp?: Record<string, number>;
  agentUses?: Record<string, number>; agentLastUsedAt?: Record<string, number>;
  stats?: { activeSec?: number }; companion?: string;
};

const loadLocalState = (): LocalState => {
  try { return JSON.parse(readFileSync(STATE, "utf8")) as LocalState; } catch {
    const now = Date.now();
    return { v: 3, name: "player", playerId: "local", createdAt: now, xp: 0, lifetimeXp: 0, streak: 1, ossCommits: 0, achievements: {}, skillXp: {}, agentUses: {}, agentLastUsedAt: {}, stats: { activeSec: 0 } };
  }
};
const saveLocalState = (s: LocalState) => {
  mkdirSync(RDIR, { recursive: true });
  const t = `${STATE}.tmp`;
  writeFileSync(t, JSON.stringify(s));
  renameSync(t, STATE);
};
// Color codes mirrored from core/runtime.ts's `C` so this node bundle stays hermetic
// (importing runtime here would pull in its Bun.* references). Keep in sync with `C`.
const HC = { r: "\x1b[0m", b: "\x1b[1m", dim: "\x1b[2m", mag: "\x1b[95m" };

// Must render IDENTICALLY to renderHud() in core/runtime.ts — both write the same
// ~/.renown/hud.txt and feed the same status line. If you change one, change both.
// Features the skill you're ACTIVELY using (current agent, from env) — fed per turn by heartbeat
// so its bar advances each turn; falls back to your top skill when no agent is detected. MUST
// stay identical to renderHud() in core/runtime.ts — both write the same ~/.renown/hud.txt.
const renderLocalHud = (s: LocalState) => {
  const skx = s.skillXp ?? {};
  const total = totalLevel(skx);
  const fid = agentById(agentFromEnv())?.skillId;
  const fdef = (fid ? skillById(fid) : undefined) ?? topSkills(skx, 1)[0].def;
  const fxp = skx[fdef.id] ?? 0;
  const fpct = skillProgress(fxp).pct;
  const flevel = displayLevelForSkill(fdef.id, fxp);
  // a 99 skill earns a rainbow level — the rarest thing on the line.
  const lvlBadge = flevel >= 99 ? rainbow(String(flevel)) : `${HC.b}${flevel}${HC.r}`;
  const pet = s.companion ? `  ${face(generate(s.companion))}` : "";   // your adopted companion, always with you
  return `${HC.b}${HC.mag}Lvl${total}${HC.r} ${gradientBar(fpct, 8)} ${HC.dim}${fpct}%${HC.r} ${fdef.icon} ${HC.b}${fdef.name}${HC.r} ${lvlBadge}${pet}`;
};

// Pop the oldest queued celebration frame. The status line calls this once per refresh,
// so a big commit's level-ups / achievements parade across the HUD over several seconds.
// Mirrors core/celebrate.ts's queue format; duplicated here to keep the bundle hermetic.
const popCelebration = (): string | undefined => {
  try {
    if (!existsSync(CELEBRATIONS)) return undefined;
    const lines = readFileSync(CELEBRATIONS, "utf8").split("\n").filter(Boolean);
    const next = lines.shift();
    if (next === undefined) return undefined;
    const tmp = `${CELEBRATIONS}.tmp`;
    writeFileSync(tmp, lines.length ? `${lines.join("\n")}\n` : "");
    renameSync(tmp, CELEBRATIONS);
    return next;
  } catch { return undefined; }
};

// ── celebration PUSH side — mirrors core/celebrate.ts; keep the two in sync. The published
// CLI must FILL this queue (level-ups, total-level milestones) or the draining status line
// has nothing to show. (core/celebrate.ts can't be imported here: it pulls in Bun-coupled
// core/runtime.ts, which is why the queue logic is duplicated in this hermetic node bundle.)
type Celebration = { tier: number; text: string };
const CEL_QUEUE_CAP = 60, CEL_RAINBOW = 7, CEL_SHIMMER = 3;
const celFramesFor = (c: Celebration): string[] => {
  if (c.tier >= 4) { const t = `✦ ${c.text} ✦`; return Array.from({ length: CEL_RAINBOW }, (_, i) => B + rainbow(t, i / CEL_RAINBOW)); }
  if (c.tier === 3) { const t = `★ ${c.text} ★`, len = [...t].length; return Array.from({ length: CEL_SHIMMER }, (_, i) => B + shimmer(t, Math.round((i / (CEL_SHIMMER - 1)) * (len - 1)))); }
  if (c.tier === 2) return [gradient(`✧ ${c.text}`, [120, 220, 255], [130, 140, 255])];
  return [`\x1b[32m⬆ ${c.text}${R}`];
};
const enqueueCelebrations = (cels: Celebration[]) => {
  const frames = cels.flatMap(celFramesFor);
  if (!frames.length) return;
  try {
    mkdirSync(RDIR, { recursive: true });
    let existing: string[] = [];
    try { existing = readFileSync(CELEBRATIONS, "utf8").split("\n").filter(Boolean); } catch {}
    writeFileSync(CELEBRATIONS, [...existing, ...frames].slice(-CEL_QUEUE_CAP).join("\n") + "\n");
  } catch {}
};
const skillUpCel = (icon: string, name: string, level: number): Celebration => ({
  tier: level >= 99 ? 4 : level >= 50 ? 3 : level % 10 === 0 ? 2 : 1,
  text: level >= 99 ? `MASTERY — ${icon} ${name} 99` : `${icon} ${name} Lv${level}`,
});
const totalUpCel = (total: number): Celebration => ({ tier: total % 100 === 0 ? 4 : total % 50 === 0 ? 3 : 2, text: `Total Level ${total}` });
const HEARTBEAT_XP = 25;   // small per-turn activity nudge (vs a full `agent` SESSION = 250)
const achievementUpCel = (name: string, tier = 2): Celebration => ({ tier, text: `🏆 ${name}` });

// Evaluate the achievement catalog (curated + generated; both pure) against the published CLI's
// state. The published state is sparse, so commit/lang/project-based achievements just won't fire
// here (they unlock via the Bun CLI's commit scoring) — but skill-level / agent / streak / total
// ones do. Fields the checks read must EXIST or their accessors throw, so overlay onto a full
// zeroed State. Mutates s.achievements with new unlocks; returns the 🏆 toasts to enqueue.
const blankStats = () => ({ firstSeen: 0, lastSeen: 0, lastActivity: 0, activeSec: 0, sessionCount: 0, longestSec: 0, curStart: 0, curSec: 0, anchorXp: 0, anchorCommits: 0, hourActive: [], dowActive: [], commitHour: [], commitDow: [], daily: {}, sessions: [] });
const checkAchievements = (s: LocalState): Celebration[] => {
  s.achievements ??= {};
  const full = {
    v: 3, name: "", playerId: "local", createdAt: 0, xp: 0, lifetimeXp: 0, streak: 0, lastActiveDay: "",
    commits: 0, linesAdded: 0, bossesSurvived: 0, secondsHealthy: 0, ossCommits: 0, extCommits: 0, starsTouched: 0, topStars: 0,
    langs: {}, hours: {}, days: {}, skillXp: {}, agentUses: {}, agentLastUsedAt: {}, collectibles: {}, wild: [],
    achievements: {}, bestiary: {}, questDay: "", quests: [], repoHeads: {}, recentFp: [], craftDay: "", craftXpToday: 0, maxMem: 0,
    lastTick: 0, lastLogScanTs: 0, lastBossTs: 0, projects: {}, langsDeep: {},
    ...s,
    stats: { ...blankStats(), ...(s.stats ?? {}) },
    best: { xpInDay: 0, level: 0, streak: s.streak ?? 0 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const have = new Set(Object.keys(s.achievements));
  const cels: Celebration[] = [];
  try {
    for (const id of evalAll(full, have)) {
      s.achievements[id] = Date.now();
      const a = achInfo(id);
      cels.push(achievementUpCel(a?.name ?? id, a?.vis === "secret" ? 3 : 2));
    }
  } catch { /* a sparse-state check threw — skip this pass */ }
  return cels;
};

const submitLocalState = async (s: LocalState, cfg: AppConfig) => {
  const apiBase = cfg.leaderboardEndpoint?.replace(/\/$/, "");
  if (!apiBase) return;
  const body = {
    id: s.playerId,
    name: s.name ?? "player",
    level: 1,
    xp: s.lifetimeXp ?? 0,
    streak: s.streak ?? 1,
    oss: s.ossCommits ?? 0,
    ach: Object.keys(s.achievements ?? {}).length,
    active: s.stats?.activeSec ?? 0,
    totalLevel: totalLevel(s.skillXp ?? {}),
    skillXp: s.skillXp ?? {},
    projects: [],
    unlocked: Object.keys(s.achievements ?? {}),
  };
  // Best-effort: a healthy endpoint answers in well under a second, and the next
  // turn resubmits, so cap aggressively. The abort rejects the promise on time, but
  // node's fetch leaves a dead connect-attempt holding the event loop open — the
  // quiet (hook) callers process.exit() right after this to avoid that ~10s tail.
  await fetch(`${apiBase}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) }).catch(() => {});
};

// gh auth token — used by all auth'd CLI commands. Returns empty string if gh isn't
// installed or the user isn't logged in; callers decide what to do.
const ghToken = (): string => runSync(["gh", "auth", "token"]).stdout.trim();
// The caller's GitHub login (for "← you" highlighting). Empty if gh isn't installed / logged in.
const ghLogin = (): string => runSync(["gh", "api", "user", "--jq", ".login"]).stdout.trim();

const flag = (args: string[], name: string): string | undefined => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  if (args[i].includes("=")) return args[i].split("=", 2)[1];
  return args[i + 1];
};
const hasFlag = (args: string[], name: string) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

// owner/repo for the cwd's GitHub remote, so `renown board` (no arg) targets the current repo.
const detectRepoKey = (): string | undefined => {
  const url = runSync(["git", "config", "--get", "remote.origin.url"]).stdout.trim();
  const m = url.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : undefined;
};

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
  console.log("  agent <provider>          count one coding-agent session (codex / claude / cursor / etc.)");
  console.log("  install-agent <target>    install first-party agent wiring (claude / codex / tmux / all)");
  console.log("  upgrade                   update renown to the latest published version");
  console.log("  launch codex              run Codex with Renown terminal-title HUD");
  console.log("  board [owner/repo]        a repo's renown leaderboard (defaults to the current git repo)");
  console.log("  pet                       show your avatar pet, animated, in the terminal");
  console.log("  rarest                    show your rarest pet");
  console.log("  switch [number]           switch your avatar to another pet you own (lists them; pick by number)");
  console.log("  statusline                print the local renown HUD for shells and agent footers");
  console.log("  heartbeat                 refresh local HUD and submit current state");
  console.log("  link                     link this install to GitHub (browserless, via gh auth token)");
  console.log("  ci-sync [--endpoint U]   refresh contributors' renown from a CI run (the GitHub Action; RENOWN_ENDPOINT)");
  console.log("  merit                    refresh PR-review / cross-repo / shipper / maintainer signals");
  console.log("  substance [--limit N]    classify recent commits by substance (RAG when configured)");
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

const isExecutable = (path: string) => {
  try {
    return existsSync(path);
  } catch { return false; }
};

const findOnPath = (name: string) => {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(process.platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
};

// The full game engine — commit scoring, the 10k-achievement catalog, streak,
// memory bosses — lives in cli/index.ts and needs Bun. This published bundle runs
// under Node and can only do the lightweight per-turn agent nudge. When a Bun
// source checkout IS present we delegate the heavy lifting to it; without this,
// reinstalling hooks (e.g. when adding Codex) silently leaves only the nudge and
// commit tracking dies. Override the checkout location with RENOWN_SRC or
// { "sourceDir": "..." } in config; otherwise probe the AbsoluteJS dev conventions.
const fullEngineEntry = (cfg: AppConfig): { bun: string; entry: string } | undefined => {
  const bun = findOnPath("bun");
  if (!bun) return undefined;
  const roots = [process.env.RENOWN_SRC, cfg.sourceDir, join(HOME, "abs", "renown"), join(HOME, "renown"), join(HOME, "src", "renown")].filter(Boolean) as string[];
  for (const root of roots) {
    const entry = join(root, "cli", "index.ts");
    if (existsSync(entry)) return { bun, entry };
  }
  return undefined;
};

const sanitizeTitle = (value: string) => value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 140).trim();
const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, "");

const currentHudLine = () => {
  const s = loadLocalState();
  return existsSync(HUD) ? readFileSync(HUD, "utf8").trim() : renderLocalHud(s);
};

const writeTerminalTitle = (title: string) => {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\x1b]0;${sanitizeTitle(title)}\x07`);
};

// ---- self-update -----------------------------------------------------------
// renown is a global CLI, so staying current shouldn't mean re-reading install docs.
//   renown upgrade             → update now, verbose (the easy manual path)
//   renown self-update --quiet → throttled (once/day) background check the SessionStart
//                                hook calls; no-ops when already on the latest version.
// Opt out with RENOWN_NO_SELF_UPDATE=1 or { "autoUpdate": false } in ~/.renown/config.json.
const PKG_NAME = "@absolutejs/renown";
const UPDATE_STAMP = join(RDIR, "last-update-check");
const SELF_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const selfPath = () => { try { return fileURLToPath(import.meta.url); } catch { return process.argv[1] ?? ""; } };

// version of the installed package — walk up from this bundle to its own package.json
const installedVersion = (): string | undefined => {
  let dir = dirname(selfPath());
  for (let i = 0; i < 6; i++) {
    try {
      const p = join(dir, "package.json");
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, "utf8")) as { name?: string; version?: string };
        if (pkg.name === PKG_NAME) return pkg.version;
      }
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
};

// numeric compare of major.minor.patch ("0.1.7" > "0.1.4"); pre-release suffix ignored
const isNewer = (latest: string, current: string): boolean => {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(latest), b = parse(current);
  for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); }
  return false;
};

// which global package manager owns this install, inferred from the binary path
const upgradeCommand = (): string[] => {
  const p = selfPath().replace(/\\/g, "/");
  if (p.includes("/.bun/")) return ["bun", "add", "-g", `${PKG_NAME}@latest`];
  if (p.includes("/pnpm")) return ["pnpm", "add", "-g", `${PKG_NAME}@latest`];
  if (/\/\.?yarn\//.test(p)) return ["yarn", "global", "add", `${PKG_NAME}@latest`];
  return ["npm", "install", "-g", `${PKG_NAME}@latest`];
};

const selfUpdateDisabled = (cfg: AppConfig): boolean =>
  process.env.RENOWN_NO_SELF_UPDATE === "1" || cfg.autoUpdate === false;

const latestVersion = async (): Promise<string | undefined> => {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return undefined;
    return ((await res.json()) as { version?: string }).version;
  } catch { return undefined; }
};

const runUpgrade = async (quiet: boolean): Promise<boolean> => {
  const cmd = upgradeCommand();
  if (!findOnPath(cmd[0]!)) { if (!quiet) console.log(`renown upgrade: '${cmd[0]}' not found on PATH — install it or upgrade manually.`); return false; }
  const r = await run(cmd, { inheritStdout: !quiet, inheritStderr: !quiet });
  return r.exitCode === 0;
};

const runCodexWithTitleHud = async (args: string[]) => {
  const realCodex = process.env.RENOWN_REAL_CODEX
    ?? (existsSync(CODEX_REAL) ? readFileSync(CODEX_REAL, "utf8").trim() : undefined)
    ?? findOnPath("codex");
  if (!realCodex) {
    console.error("renown launch codex: could not find Codex. Install Codex first.");
    process.exit(127);
  }

  const update = () => writeTerminalTitle(stripAnsi(currentHudLine()));
  update();
  const timer = setInterval(update, 5000);
  const child = spawn(realCodex, args, {
    stdio: "inherit",
    env: { ...process.env, RENOWN_TITLE_HUD: "1" },
  });
  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  process.on("SIGHUP", forward);
  child.on("error", (err) => {
    clearInterval(timer);
    console.error(`renown launch codex: ${err.message}`);
    process.exit(1);
  });
  child.on("close", (code, signal) => {
    clearInterval(timer);
    writeTerminalTitle("codex");
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
};

const backupFile = (path: string) => {
  if (!existsSync(path)) return undefined;
  const backup = `${path}.renown-bak-${Date.now()}`;
  writeFileSync(backup, readFileSync(path, "utf8"));
  return backup;
};

const replaceManagedBlock = (source: string, name: string, body: string) => {
  const start = `# >>> renown ${name}`;
  const end = `# <<< renown ${name}`;
  const block = `${start}\n${body.trim()}\n${end}`;
  const re = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  if (re.test(source)) return source.replace(re, block);
  return `${source.trimEnd()}\n\n${block}\n`;
};

const addCommandHook = (hooks: Record<string, unknown>, event: string, command: string) => {
  const groups = Array.isArray(hooks[event]) ? hooks[event] as Array<Record<string, unknown>> : [];
  const already = groups.some((group) => {
    const handlers = Array.isArray(group.hooks) ? group.hooks as Array<Record<string, unknown>> : [];
    return handlers.some((handler) => handler.type === "command" && handler.command === command);
  });
  if (!already) groups.push({ hooks: [{ type: "command", command }] });
  hooks[event] = groups;
};

const installClaudeAgent = (dryRun: boolean) => {
  const dir = join(HOME, ".claude");
  const path = join(dir, "settings.json");
  const raw = existsSync(path) ? readFileSync(path, "utf8") : "{}";
  const settings = JSON.parse(raw || "{}") as Record<string, unknown>;
  settings.statusLine = {
    type: "command",
    command: "renown statusline",
    padding: 2,
    refreshInterval: 5,
  };
  const hooks = (settings.hooks && typeof settings.hooks === "object") ? settings.hooks as Record<string, unknown> : {};
  addCommandHook(hooks, "SessionStart", "renown agent claude --quiet");
  addCommandHook(hooks, "SessionStart", "renown self-update --quiet");
  // Prefer the full Bun engine (commit scoring + achievements + streak) when a
  // source checkout is present; otherwise the published bundle's lightweight
  // heartbeat, which delegates to the engine at runtime if it later appears.
  const engine = fullEngineEntry(loadConfig());
  addCommandHook(hooks, "Stop", engine ? `${engine.bun} ${engine.entry} heartbeat --quiet` : "renown heartbeat --quiet");
  settings.hooks = hooks;
  if (dryRun) {
    console.log(`[dry-run] would write ${path}`);
    console.log(JSON.stringify(settings, null, 2));
    return;
  }
  mkdirSync(dir, { recursive: true });
  const backup = backupFile(path);
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`✓ Claude Code wired: ${path}${backup ? ` (backup ${backup})` : ""}`);
  if (settings.disableAllHooks === true) {
    console.log("  note: disableAllHooks is true, so Claude hooks remain disabled until you remove or set it false.");
  }
};

const ensureTomlBoolean = (source: string, table: string, key: string, value: boolean) => {
  const tableRe = new RegExp(`(^\\[${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\n)([\\s\\S]*?)(?=^\\[|$)`, "m");
  const replacement = (body: string) => {
    const keyRe = new RegExp(`^${key}\\s*=\\s*(true|false)\\s*$`, "m");
    if (keyRe.test(body)) return body.replace(keyRe, `${key} = ${value ? "true" : "false"}`);
    return `${body.trimEnd()}\n${key} = ${value ? "true" : "false"}\n`;
  };
  if (tableRe.test(source)) {
    return source.replace(tableRe, (_match, head: string, body: string) => `${head}${replacement(body)}`);
  }
  return `${source.trimEnd()}\n\n[${table}]\n${key} = ${value ? "true" : "false"}\n`;
};

const ensureWritableRoot = (source: string, root: string) => {
  const table = "sandbox_workspace_write";
  const tableRe = new RegExp(`(^\\[${table}\\]\\n)([\\s\\S]*?)(?=^\\[|$)`, "m");
  const lineRe = /^writable_roots\s*=\s*\[(.*)\]\s*$/m;
  const quoted = JSON.stringify(root);
  const replacement = (body: string) => {
    const match = body.match(lineRe);
    if (!match) return `${body.trimEnd()}\nwritable_roots = [${quoted}]\n`;
    if (match[0].includes(quoted) || match[0].includes(`'${root}'`)) return body;
    return body.replace(lineRe, (_line, inner: string) => {
      const clean = inner.trim();
      return `writable_roots = [${clean ? `${clean}, ` : ""}${quoted}]`;
    });
  };
  if (tableRe.test(source)) {
    return source.replace(tableRe, (_match, head: string, body: string) => `${head}${replacement(body)}`);
  }
  return `${source.trimEnd()}\n\n[${table}]\nwritable_roots = [${quoted}]\n`;
};

const installCodexAgent = (dryRun: boolean) => {
  const dir = join(HOME, ".codex");
  const path = join(dir, "config.toml");
  let source = existsSync(path) ? readFileSync(path, "utf8") : "";
  source = source.replace(
    /\n?# Renown coding-agent tracking\.[\s\S]*?\[\[hooks\.Stop\]\]\nhooks = \[\{ type = "command", command = "renown heartbeat(?: --quiet)?" \}\]\n?/,
    "\n",
  );
  source = ensureTomlBoolean(source, "features", "hooks", true);
  source = ensureWritableRoot(source, RDIR);
  const hookBlock = `
# Tracks Codex sessions and emits a stop-hook JSON ACK so Codex accepts the hook
# output in newer versions. Use tmux for a persistent bottom HUD.
[[hooks.SessionStart]]
hooks = [{ type = "command", command = "renown agent codex --quiet" }, { type = "command", command = "renown self-update --quiet" }]

[[hooks.Stop]]
hooks = [{ type = "command", command = "renown heartbeat --quiet >/dev/null 2>&1; renown statusline 1>&2; echo '{\\"continue\\":true}'" }]
`;
  const stateIndex = source.search(/^\[hooks\.state\]/m);
  if (stateIndex >= 0) {
    const before = source.slice(0, stateIndex);
    const after = source.slice(stateIndex);
    source = `${replaceManagedBlock(before, "codex", hookBlock).trimEnd()}\n\n${after.trimStart()}`;
  } else {
    source = replaceManagedBlock(source, "codex", hookBlock);
  }
  if (dryRun) {
    console.log(`[dry-run] would write ${path}`);
    console.log(source);
    return;
  }
  mkdirSync(dir, { recursive: true });
  const backup = backupFile(path);
  writeFileSync(path, source);
  console.log(`✓ Codex hooks wired: ${path}${backup ? ` (backup ${backup})` : ""}`);
  console.log("  run /hooks in Codex if it asks you to trust new hooks.");
};

const installCodexLauncher = (dryRun: boolean) => {
  const codexPath = findOnPath("codex");
  if (!codexPath) {
    console.log("Codex launcher not installed: could not find `codex` on PATH.");
    return;
  }
  let existing = "";
  try { existing = readFileSync(codexPath, "utf8"); } catch {}
  const alreadyShim = existing.includes("RENOWN_CODEX_TITLE_SHIM");
  const realCodex = alreadyShim && existsSync(CODEX_REAL)
    ? readFileSync(CODEX_REAL, "utf8").trim()
    : realpathSync(codexPath);
  if (alreadyShim && realCodex) {
    if (dryRun) {
      console.log(`[dry-run] Codex launcher already managed at ${codexPath}`);
      return;
    }
  }
  const script = `#!/usr/bin/env sh
# RENOWN_CODEX_TITLE_SHIM
RENOWN_REAL_CODEX=${JSON.stringify(realCodex)}
export RENOWN_REAL_CODEX
exec renown launch codex "$@"
`;
  if (dryRun) {
    console.log(`[dry-run] would replace ${codexPath} with Renown Codex title shim`);
    console.log(`[dry-run] real Codex preserved as ${realCodex}`);
    return;
  }
  mkdirSync(RDIR, { recursive: true });
  writeFileSync(CODEX_REAL, `${realCodex}\n`);
  const backup = `${codexPath}.renown-bak-${Date.now()}`;
  if (!alreadyShim) {
    try {
      const stat = lstatSync(codexPath);
      if (stat.isSymbolicLink()) {
        writeFileSync(backup, `symlink -> ${realCodex}\n`);
        unlinkSync(codexPath);
      } else {
        renameSync(codexPath, backup);
      }
    } catch {
      // If backup fails, do not proceed with replacing the launcher.
      throw new Error(`Could not back up existing Codex launcher at ${codexPath}`);
    }
  }
  writeFileSync(codexPath, script);
  chmodSync(codexPath, 0o755);
  console.log(`✓ Codex launcher shim installed: ${codexPath}`);
  console.log(`  real Codex: ${realCodex}`);
  if (!alreadyShim) console.log(`  backup: ${backup}`);
};

const tmuxQuote = (value: string) => JSON.stringify(value);

const readTmuxStatusRight = () => {
  const fallback = "%H:%M %d-%b";
  if (!process.env.TMUX) return fallback;
  const result = runSync(["tmux", "show", "-gqv", "status-right"]);
  const out = result.stdout.trim();
  if (!out || out.includes("renown statusline")) return fallback;
  return out;
};

const installTmuxStatus = (dryRun: boolean) => {
  const previous = readTmuxStatusRight();
  const statusRight = `#(renown statusline)  ${previous}`;
  const snippet = [
    "# First-party Renown HUD for Codex and agents without command-backed footers.",
    "# Source this file from ~/.tmux.conf or let `renown install-agent tmux` manage it.",
    "set -g status-interval 5",
    `set -g status-right ${tmuxQuote(statusRight)}`,
    "",
  ].join("\n");
  const tmuxConfPath = join(HOME, ".tmux.conf");
  const tmuxSourceLine = `source-file ${TMUX_CONF}`;
  let tmuxConf = existsSync(tmuxConfPath) ? readFileSync(tmuxConfPath, "utf8") : "";
  if (!tmuxConf.includes(tmuxSourceLine)) tmuxConf = `${tmuxConf.trimEnd()}\n\n${tmuxSourceLine}\n`;
  if (dryRun) {
    console.log(`[dry-run] would write ${TMUX_CONF}`);
    console.log(snippet);
    console.log(`[dry-run] would ensure ${tmuxConfPath} contains: ${tmuxSourceLine}`);
    return;
  }
  mkdirSync(RDIR, { recursive: true });
  writeFileSync(TMUX_CONF, snippet);
  const backup = backupFile(tmuxConfPath);
  writeFileSync(tmuxConfPath, tmuxConf);
  console.log(`✓ tmux HUD snippet written: ${TMUX_CONF}`);
  console.log(`✓ tmux config updated: ${tmuxConfPath}${backup ? ` (backup ${backup})` : ""}`);
  if (process.env.TMUX) {
    const sourced = runSync(["tmux", "source-file", TMUX_CONF]);
    if (sourced.exitCode === 0) console.log("✓ current tmux session reloaded");
    else console.log("  tmux config written; reload with: tmux source-file ~/.renown/tmux-status.conf");
  } else {
    console.log("  start tmux or run: tmux source-file ~/.renown/tmux-status.conf");
  }
};

const main = async () => {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { usage(); return; }
  const cfg = loadConfig();
  const apiBase = cfg.leaderboardEndpoint?.replace(/\/$/, "");

  if (cmd === "statusline" || cmd === "hud") {
    const s = loadLocalState();
    // statusline drains one queued celebration per refresh (the parade); `hud` is a
    // non-consuming manual peek, so it never pops the queue.
    if (cmd === "statusline") {
      const toast = popCelebration();
      if (toast !== undefined) { console.log(toast); return; }
    }
    const line = existsSync(HUD) ? readFileSync(HUD, "utf8").trim() : renderLocalHud(s);
    console.log(line);
    return;
  }

  // ── ci-sync: refresh every contributor's renown from a CI run (powers the GitHub Action) ──
  // Zero secrets. /api/verify recomputes a linked player's renown (base score + Co-Authored-By
  // attribution + freshly-minted 1/1 pets) from just their login, using the SERVER's own GitHub
  // token — so a workflow can credit contributors without anyone exposing a personal token. We
  // refresh the pusher plus every author GitHub names in the event payload; logins that aren't on
  // renown (or aren't OAuth-verified) no-op, and we always exit 0 so CI never fails over this.
  if (cmd === "ci-sync") {
    const endpoint = (flag(rest, "endpoint") ?? process.env.RENOWN_ENDPOINT ?? cfg.leaderboardEndpoint ?? "").replace(/\/$/, "");
    if (!endpoint) { console.log("renown ci-sync: no endpoint set — pass --endpoint or RENOWN_ENDPOINT (e.g. https://your-renown.example/api). Skipping."); return; }
    const repo = process.env.GITHUB_REPOSITORY ?? "";
    // Logins to refresh: the actor + every author/committer GitHub attributes in the event.
    const logins = new Set<string>();
    const add = (l: unknown) => { const s = String(l ?? "").trim().toLowerCase(); if (s && !s.endsWith("[bot]") && s !== "github-actions") logins.add(s); };
    add(process.env.GITHUB_ACTOR);
    try {
      const ep = process.env.GITHUB_EVENT_PATH;
      if (ep && existsSync(ep)) {
        const ev = JSON.parse(readFileSync(ep, "utf8")) as Record<string, any>;
        for (const c of Array.isArray(ev.commits) ? ev.commits : []) { add(c?.author?.username); add(c?.committer?.username); }
        add(ev?.head_commit?.author?.username);
        add(ev?.pull_request?.user?.login);
        add(ev?.sender?.login);
      }
    } catch { /* event payload is best-effort */ }
    if (logins.size === 0) { console.log("renown ci-sync: no contributor logins in this event — skipping."); return; }
    console.log(`\n  ${B}renown ci-sync${R}${repo ? `  ${HC.dim}${repo}${R}` : ""}`);
    let credited = 0;
    for (const login of logins) {
      const res = await fetch(`${endpoint}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login }), signal: AbortSignal.timeout(15000) }).catch(() => null);
      const j: any = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
      if (j.ok) {
        credited++;
        const dpets = Array.isArray(j.newPetSeeds) ? j.newPetSeeds.length : Number(j.newPets ?? 0);
        const bits = [`renown ${Number(j.score ?? 0).toLocaleString()}`];
        if (Number(j.attributionDelta) > 0) bits.push(`+${j.attributionDelta} attributed`);
        if (dpets > 0) bits.push(`+${dpets} new pet${dpets === 1 ? "" : "s"}`);
        if (j.throttled) bits.push("synced recently");
        console.log(`  ✓ ${B}@${login}${R}  ${HC.dim}${bits.join(" · ")}${R}`);
      } else {
        const why = j.error === "login ownership not verified (OAuth required)" ? "not on renown yet" : (j.error ?? "skipped");
        console.log(`  ${HC.dim}· @${login} — ${why}${R}`);
      }
    }
    // Per-repo board: score each contributor's commits in THIS repo (server-side, the shared craft
    // formula on GitHub data) so the repo's public /project leaderboard fills in from CI too.
    if (repo) {
      const res = await fetch(`${endpoint}/ci/repo-sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo, logins: [...logins] }), signal: AbortSignal.timeout(60000) }).catch(() => null);
      const rj: any = res ? await res.json().catch(() => null) : null;
      const scored = Array.isArray(rj?.results) ? rj.results.filter((r: any) => r.status === "scored" || r.status === "throttled") : [];
      if (scored.length) {
        console.log(`\n  ${B}board${R}  ${HC.dim}${repo}${R}`);
        for (const r of scored) console.log(`  ✓ ${B}@${r.login}${R}  ${HC.dim}${Number(r.commits ?? 0).toLocaleString()} commits · ${Number(r.xp ?? 0).toLocaleString()} XP here${R}`);
      }
    }
    console.log(`\n  ${HC.mag}${credited} contributor${credited === 1 ? "" : "s"} refreshed${R}  ${HC.dim}· join: npm i -g @absolutejs/renown && renown link${R}\n`);
    return;
  }

  if (cmd === "upgrade" || cmd === "self-update") {
    const quiet = hasFlag(rest, "quiet");
    if (cmd === "self-update") {
      // Background path wired into SessionStart: must return fast and never block a session.
      if (selfUpdateDisabled(cfg)) return;
      if (!hasFlag(rest, "run-now")) {
        // throttle to at most once per interval, then hand the network work to a detached child
        try {
          const last = existsSync(UPDATE_STAMP) ? Number(readFileSync(UPDATE_STAMP, "utf8").trim()) : 0;
          if (Number.isFinite(last) && Date.now() - last < SELF_UPDATE_INTERVAL_MS) return;
        } catch {}
        try { mkdirSync(RDIR, { recursive: true }); writeFileSync(UPDATE_STAMP, String(Date.now())); } catch {}
        try {
          const child = spawn(process.argv[0]!, [selfPath(), "self-update", "--run-now", "--quiet"], { detached: true, stdio: "ignore" });
          child.unref();
        } catch {}
        return;
      }
      // --run-now (inside the detached child): only upgrade when npm actually has something newer
      const current = installedVersion();
      const latest = await latestVersion();
      if (!latest || (current && !isNewer(latest, current))) return;
      await runUpgrade(true);
      return;
    }
    // explicit `renown upgrade` — verbose, synchronous
    const current = installedVersion();
    console.log(`renown ${current ?? "(unknown version)"} — checking npm for updates…`);
    const latest = await latestVersion();
    if (!latest) { console.log("Couldn't reach the npm registry. Try again, or upgrade manually:\n  " + upgradeCommand().join(" ")); return; }
    if (current && !isNewer(latest, current)) { console.log(`Already on the latest version (${current}).`); return; }
    console.log(`Updating ${current ?? "?"} → ${latest} …`);
    const ok = await runUpgrade(false);
    console.log(ok ? `✓ renown updated to ${latest}.` : "Upgrade failed. Run it manually:\n  " + upgradeCommand().join(" "));
    return;
  }

  if (cmd === "install-agent" || cmd === "install-agents") {
    const target = rest.find((arg) => !arg.startsWith("-")) ?? "all";
    const dryRun = hasFlag(rest, "dry-run");
    if (!["all", "claude", "codex", "codex-launcher", "tmux"].includes(target)) {
      console.log("usage: renown install-agent <all|claude|codex|codex-launcher|tmux> [--dry-run]");
      return;
    }
    if (target === "all" || target === "claude") installClaudeAgent(dryRun);
    if (target === "all" || target === "codex") installCodexAgent(dryRun);
    if (target === "codex-launcher") installCodexLauncher(dryRun);
    if (target === "all" || target === "tmux") installTmuxStatus(dryRun);
    if (!dryRun && (target === "all" || target === "codex")) {
      console.log("  Codex note: Renown prints after each turn via hooks; tmux is only for a persistent bottom HUD.");
    }
    return;
  }

  if (cmd === "launch" && rest[0] === "codex") {
    await runCodexWithTitleHud(rest.slice(1));
    return;
  }

  if (cmd === "heartbeat") {
    // Full engine first (when a Bun checkout is available): registers the cwd repo,
    // scores new commits, evaluates the full achievement catalog, advances the
    // streak — the writes the lightweight path below can't make. Best-effort and
    // bounded; if it's absent or fails we still do the per-turn nudge.
    const engine = fullEngineEntry(cfg);
    if (engine) { try { await run([engine.bun, engine.entry, "heartbeat", "--quiet"]); } catch {} }
    const s = loadLocalState();   // reload so the nudge/HUD/submit reflect the engine's writes
    s.skillXp ??= {};
    const totalBefore = totalLevel(s.skillXp);
    const cels: Celebration[] = [];
    // Small per-turn activity XP to the CURRENT agent's skill so the status line visibly moves
    // each turn. Distinct from `agent` (a whole SESSION, +250, fired once at SessionStart) — this
    // doesn't bump the sessions counter, just XP. Level-ups + total milestones become toasts.
    const a = agentById(agentFromEnv());
    if (a) for (const u of applyGains(s.skillXp, { [a.skillId]: HEARTBEAT_XP })) cels.push(skillUpCel(a.icon, a.name, u.to));
    const totalAfter = totalLevel(s.skillXp);
    for (let m = Math.floor(totalBefore / 10) * 10 + 10; m <= totalAfter; m += 10) cels.push(totalUpCel(m));
    cels.push(...checkAchievements(s));   // 🏆 newly-unlocked catalog achievements
    enqueueCelebrations(cels);
    saveLocalState(s);
    mkdirSync(RDIR, { recursive: true });
    writeFileSync(HUD, renderLocalHud(s));
    await submitLocalState(s, cfg);
    if (!hasFlag(rest, "quiet")) { console.log(renderLocalHud(s)); return; }
    // hook path (always --quiet, no stdout to flush): hard-exit so an unreachable
    // leaderboard endpoint can't keep a dead socket alive for ~10s after the abort.
    process.exit(0);
  }

  if (cmd === "agent" || ["claude", "codex", "cursor", "copilot", "aider", "gemini", "goose", "windsurf", "openhands", "devin"].includes(cmd)) {
    const raw = cmd === "agent" ? (rest[0] && !rest[0].startsWith("--") ? rest[0] : undefined) : cmd;
    const id = normalizeAgentId(raw) ?? agentFromEnv();
    const a = agentById(id);
    if (!a) { console.log("usage: renown agent <claude|codex|cursor|copilot|aider|gemini|goose|windsurf|openhands|devin|other> [--count N] [--quiet]"); return; }
    const count = Math.max(1, Math.min(10000, Number(flag(rest, "count") ?? 1) || 1));
    const quiet = hasFlag(rest, "quiet") || rest.includes("-q");
    const s = loadLocalState();
    s.skillXp ??= {};
    s.agentUses ??= {};
    s.agentLastUsedAt ??= {};
    s.agentUses[a.id] = (s.agentUses[a.id] ?? 0) + count;
    s.agentLastUsedAt[a.id] = Date.now();
    const totalBefore = totalLevel(s.skillXp);
    const ups = applyGains(s.skillXp, { [a.skillId]: count * 250 });
    const totalAfter = totalLevel(s.skillXp);
    // Queue level-up + total-level toasts so they show in the status-line parade even under the
    // --quiet SessionStart hook (previously only printed in interactive mode → silently dropped).
    const cels: Celebration[] = ups.map((u) => skillUpCel(a.icon, a.name, u.to));
    for (let m = Math.floor(totalBefore / 10) * 10 + 10; m <= totalAfter; m += 10) cels.push(totalUpCel(m));
    cels.push(...checkAchievements(s));   // 🏆 newly-unlocked catalog achievements
    enqueueCelebrations(cels);
    saveLocalState(s);
    writeFileSync(HUD, renderLocalHud(s));
    await submitLocalState(s, cfg);
    if (!quiet) {
      const pr = skillProgress(s.skillXp[a.skillId] ?? 0);
      console.log(`${a.icon} ${a.name}: +${count} session${count === 1 ? "" : "s"} (total ${(s.agentUses[a.id] ?? 0).toLocaleString()})`);
      if (ups.length) for (const u of ups) console.log(`  ${a.name} Lv${u.to}. The agent has been fed; this was probably legal.`);
      else console.log(`  ${a.blurb} Lv${pr.level}, ${pr.pct}% to next.`);
      return;
    }
    // hook path (--quiet, e.g. SessionStart): hard-exit so an unreachable endpoint
    // can't hold the process open ~10s past submitLocalState's abort.
    process.exit(0);
  }

  if (!apiBase) { console.log("No leaderboard endpoint configured. Set leaderboardEndpoint in ~/.config/renown/config.json."); return; }

  // ── link / sync (the original CLI commands re-implemented HTTP-only) ───────
  if (cmd === "link") {
    const token = ghToken();
    if (!token) { console.log("No GitHub token — run `gh auth login` first."); return; }
    const res = await fetch(`${apiBase}/cli/link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerId: cfg.playerId, token }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.needsMerge) console.log(`⚠ ${j.message ?? `@${j.login} is already on another renown account — confirm a merge from the web settings page.`}`);
    else if (j.ok) console.log(`✓ Linked GitHub @${j.login}${j.primary === false ? " (secondary account — your pets/score now span both)" : ""} — verified score ${j.verifiedScore}. \`renown pet\` to see your pet.`);
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

  // ── board: a repo's renown leaderboard in the terminal ─────────────────────
  if (cmd === "board") {
    if (!apiBase) { console.log("No leaderboard endpoint configured. Set leaderboardEndpoint in your renown config."); return; }
    const sort = flag(rest, "sort");   // xp | commits | lines
    const key = (rest.find((a) => !a.startsWith("-")) ?? detectRepoKey());
    if (!key) { console.log("usage: renown board <owner/repo>   (or run inside a git repo with a github remote)"); return; }
    const qs = sort ? `?sort=${encodeURIComponent(sort)}` : "";
    const res = await fetch(`${apiBase}/project/${key}${qs}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.error) { console.log(`board: ${key} isn't on renown yet (${j.error}). Be the first — \`renown link\` and commit.`); return; }
    const me = (cfg.playerName ?? ghLogin()).toLowerCase();
    const t = j.totals ?? { devs: 0, xp: 0, commits: 0 };
    const by: "xp" | "commits" | "lines" = (j.sort === "commits" || j.sort === "lines") ? j.sort : "xp";   // active metric (server echoes it)
    const label = { xp: "XP", commits: "commits", lines: "lines" }[by];
    console.log(`\n  ${B}${j.key}${R}  ${HC.dim}${j.stars ? `★ ${j.stars} · ` : ""}${j.oss ? "OSS · " : ""}${t.devs} dev${t.devs === 1 ? "" : "s"} · ${Number(t.xp).toLocaleString()} XP${by === "xp" ? "" : ` · by ${label}`}${R}`);
    const rows: { login: string; avatarSeed: string | null; xp: number; commits: number; lines: number }[] = j.contributors ?? [];
    if (rows.length === 0) { console.log(`  ${HC.dim}no verified contributors yet — claim the top spot.${R}\n`); return; }
    const medal = (i: number) => ["🥇", "🥈", "🥉"][i] ?? `${HC.dim}${String(i + 1).padStart(2)}${R}`;
    let myRank = 0;
    rows.forEach((c, i) => {
      const pet = c.avatarSeed ? `${face(generate(c.avatarSeed))} ` : "";
      const mine = c.login.toLowerCase() === me;
      if (mine) myRank = i + 1;
      const name = mine ? `${B}${HC.mag}@${c.login}${R}` : `@${c.login}`;
      const primary = `${Number(c[by]).toLocaleString()} ${label}`;
      const secondary = by === "xp" ? `${c.commits.toLocaleString()} commits` : `${Number(c.xp).toLocaleString()} XP`;
      console.log(`  ${medal(i)}  ${pet}${name}${" ".repeat(Math.max(1, 22 - c.login.length))}${B}${primary}${R}  ${HC.dim}${secondary}${R}${mine ? `  ${HC.mag}← you${R}` : ""}`);
    });
    if (myRank) console.log(`\n  ${HC.mag}you're #${myRank} of ${rows.length} on ${j.repo ?? j.key}.${R}`);
    console.log("");
    return;
  }

  // ── pets: see your pet / show your rarest / switch your avatar ──────────────
  if (cmd === "pet" || cmd === "rarest" || cmd === "switch") {
    if (!apiBase) { console.log("No leaderboard endpoint configured. Set leaderboardEndpoint in your renown config, then `renown link`."); return; }
    const token = ghToken();
    if (!token) { console.log("No GitHub token — run `gh auth login` first, then `renown link`."); return; }
    const res = await fetch(`${apiBase}/cli/pets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.error) { console.log(`${cmd} failed:`, j.error); return; }
    const wild: string[] = Array.isArray(j.wild) ? j.wild : [];
    if (wild.length === 0) { console.log("No pets yet — they drop from real commits. Keep committing and they'll appear on your profile."); return; }
    // Owned pets, rarest first — tier/score/name re-derived from each seed by the generator.
    const owned = wild.map((s) => ({ seed: s, c: generate(s) })).sort((a, b) => b.c.score - a.c.score);
    const indexOf = (seed: string) => owned.findIndex((o) => o.seed === seed) + 1;
    // Animate only on a TTY; piped/non-interactive output just gets the static card.
    const renderPet = async (seed: string) => {
      const cr = generate(seed);
      if (process.stdout.isTTY) await play(frames(cr, 18), { delay: 120 });
      console.log(renderCard(cr));
    };

    if (cmd === "pet") {
      const seed = j.avatarSeed && wild.includes(j.avatarSeed) ? j.avatarSeed : owned[0].seed;
      await renderPet(seed);
      console.log(`\n  ✦ your avatar (#${indexOf(seed)} of ${owned.length}) — \`renown switch\` to change it`);
      return;
    }
    if (cmd === "rarest") {
      const seed = j.rarestPetSeed && wild.includes(j.rarestPetSeed) ? j.rarestPetSeed : owned[0].seed;
      await renderPet(seed);
      const isAvatar = seed === j.avatarSeed;
      console.log(`\n  ✦ your rarest of ${owned.length} pets${isAvatar ? " (also your avatar)" : ` — \`renown switch ${indexOf(seed)}\` to make it your avatar`}`);
      return;
    }

    // switch — set the avatar to an owned pet, by number or seed prefix; no arg → pick.
    const setAvatar = async (seed: string): Promise<boolean> => {
      const r2 = await fetch(`${apiBase}/cli/avatar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, seed }) }).catch(() => null);
      const j2 = r2 ? await r2.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
      if (j2.error) { console.log("switch failed:", j2.error); return false; }
      return true;
    };
    const resolvePick = (raw: string) => {
      if (/^\d+$/.test(raw)) return owned[Number(raw) - 1]?.seed;
      return owned.find((o) => o.seed === raw || o.seed.startsWith(raw))?.seed;
    };
    const petSources: Record<string, string> = j.sources ?? {};
    const multiSource = new Set(Object.values(petSources)).size > 1;   // only show provenance once 2+ githubs contribute
    const listPets = () => {
      console.log(`\n  your pets — rarest first (${owned.length}):\n`);
      owned.forEach((o, i) => {
        const src = multiSource && petSources[o.seed] ? `  · from @${petSources[o.seed]}` : "";
        console.log(`   ${String(i + 1).padStart(2)}.  ${o.c.tier.padEnd(10)} ${o.c.name}${o.seed === j.avatarSeed ? "   ← current avatar" : ""}${src}`);
      });
    };

    const pick = rest.find((a) => !a.startsWith("-"));
    if (pick) {
      const seed = resolvePick(pick);
      if (!seed) { console.log(`No pet matches "${pick}".`); listPets(); return; }
      if (await setAvatar(seed)) { await renderPet(seed); const cr = generate(seed); console.log(`\n  ✦ avatar switched to ${cr.name} (${cr.tier}).`); }
      return;
    }
    listPets();
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ans = (await new Promise<string>((r) => rl.question(`\n  pick a number to set your avatar (enter to cancel): `, r))).trim();
      rl.close();
      if (!ans) { console.log("  (no change)"); return; }
      const seed = resolvePick(ans);
      if (!seed) { console.log(`  No pet #${ans}.`); return; }
      if (await setAvatar(seed)) { const cr = generate(seed); console.log(`\n  ✦ avatar switched to ${cr.name} (${cr.tier}). \`renown pet\` to see it.`); }
    } else {
      console.log(`\n  run \`renown switch <number>\` to set your avatar.`);
    }
    return;
  }

  // ── substance ─────────────────────────────────────────────────────────────
  if (cmd === "substance" || cmd === "substance-sync") {
    const token = ghToken();
    if (!token) { console.log("No GitHub token — run `gh auth login` first."); return; }
    const limit = Number(flag(rest, "limit") ?? 30);
    const res = await fetch(`${apiBase}/cli/substance-sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, limit }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.error) { console.log("substance failed:", j.error); return; }
    if (j.note) { console.log(`(${j.note})`); return; }
    const pct = ((j.substanceScore ?? 0) * 100).toFixed(0);
    console.log(`\n  renown substance — @${j.login}`);
    console.log("  " + "─".repeat(56));
    console.log(`  substance:         ${pct}%   (over ${j.sampleSize ?? 0} recent commits)`);
    console.log(`  merit score:       ${Number(j.meritScore ?? 0).toLocaleString()}   ← updated`);
    if (j.reasons) {
      const total = (Object.values(j.reasons) as number[]).reduce((s: number, n: number) => s + n, 0);
      console.log(`\n  classified as:`);
      for (const [reason, count] of (Object.entries(j.reasons) as [string, number][]).sort(([, a], [, b]) => b - a)) {
        const bar = "█".repeat(Math.round(count / total * 30));
        console.log(`    ${reason.padEnd(22)} ${String(count).padStart(3)}  ${bar}`);
      }
    }
    if (Array.isArray(j.granted) && j.granted.length > 0) console.log(`\n  🏅 unlocked: ${j.granted.join(", ")}`);
    console.log("");
    return;
  }

  // ── merit ─────────────────────────────────────────────────────────────────
  if (cmd === "merit" || cmd === "merit-sync") {
    const token = ghToken();
    if (!token) { console.log("No GitHub token — run `gh auth login` first."); return; }
    const res = await fetch(`${apiBase}/cli/merit-sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.error) { console.log("merit failed:", j.error); return; }
    const ratio = (j.authored ?? 0) > 0 ? ((j.merged ?? 0) / j.authored) : 0;
    const fmt = (n: number) => Number(n).toLocaleString();
    console.log(`\n  renown merit — @${j.login}`);
    console.log("  " + "─".repeat(56));
    console.log(`  merit score:       ${fmt(j.meritScore ?? 0)}   ← rolled-up, feeds leaderboard`);
    console.log(`  PR reviews given:  ${fmt(j.reviews ?? 0)}        Reviewer`);
    console.log(`  cross-repo PRs:    ${fmt(j.crossRepo ?? 0)}        Contributor`);
    console.log(`  PRs merged:        ${fmt(j.merged ?? 0)} / ${fmt(j.authored ?? 0)} (${(ratio * 100).toFixed(0)}%)   Shipper`);
    console.log(`  npm downloads/mo:  ${fmt(j.downloads ?? 0)}        Maintainer`);
    if (Array.isArray(j.granted) && j.granted.length > 0) console.log(`\n  🏅 unlocked: ${j.granted.join(", ")}`);
    console.log("");
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
