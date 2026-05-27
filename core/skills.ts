// RuneScape-style multi-skill progression. Every skill levels 1 → 99 on the authentic
// OSRS experience curve (fast early, a brutal slow-burn near the cap), XP keeps accruing
// past 99 for prestige bragging rights, and your TOTAL LEVEL — the sum across every
// skill — is the headline flex (max = 99 × number of skills). Skills are data (SKILLS),
// so adding or retuning a strength is a one-line change. XP is *routed* from the craft
// engine: a single commit can train several skills at once — an open-source test commit
// trains Shipping + Testing + Open Source, RuneScape-style.

import type { CraftResult } from "./craft.ts";
import { AGENTS } from "./agents.ts";

export const MAX_LEVEL = 99;

// XP_SCALE divides the authentic OSRS thresholds. 1 = the real OSRS curve (level 99 =
// 13,034,431 xp): brutal on purpose. At dev xp rates (~30-300/commit) even a single 99 is
// a long-haul grind, and maxing EVERY skill is a lifetime flex you are not meant to finish
// — exactly like RuneScape. Push it below 1 to make 99s rarer still; shape is preserved.
export const XP_SCALE = 1;

// Authentic OSRS experience table (scaled): xp required to *reach* each level, 1-indexed.
const xpAt: number[] = (() => {
  const table = [0, 0]; // index 0 unused; level 1 = 0 xp
  let points = 0;
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    table[lvl + 1] = Math.floor(Math.floor(points / 4) / XP_SCALE);
  }
  return table;
})();

export const xpForLevel = (lvl: number) => xpAt[Math.max(1, Math.min(MAX_LEVEL, lvl))] ?? 0;

// Level for a given xp (capped at 99; xp past 99 still counts toward total xp / prestige).
export const levelForXp = (xp: number) => {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= xpAt[lvl + 1]) lvl++;
  return lvl;
};

// Progress within the current level: { level, into, need, pct } (pct 0-100; 100 at the cap).
export const skillProgress = (xp: number) => {
  const lvl = levelForXp(xp);
  if (lvl >= MAX_LEVEL) return { level: MAX_LEVEL, into: 0, need: 0, pct: 100 };
  const base = xpAt[lvl], next = xpAt[lvl + 1];
  const into = xp - base, need = next - base;
  return { level: lvl, into, need, pct: Math.floor((into / need) * 100) };
};

// ---------- virtual levels & absurd numbers ----------
// 99 is the *displayed* cap, but xp never stops — virtual levels extend the same curve
// forever. Their thresholds blow far past Number.MAX_SAFE_INTEGER, so they live in BigInt:
// the integer limit is NOT the level limit. The authentic (unscaled) table is grown lazily
// and memoized; player xp is scaled at compare time so XP_SCALE still applies.
const bigAt: bigint[] = [0n, 0n];
let bigPoints = 0n;
let bigBuilt = 1;
const growVirtual = (toLevel: number) => {
  for (let lvl = bigBuilt; lvl < toLevel; lvl++) {
    bigPoints += BigInt(Math.floor(lvl + 300 * Math.pow(2, lvl / 7)));
    bigAt[lvl + 1] = bigPoints / 4n;
  }
  if (toLevel > bigBuilt) bigBuilt = toLevel;
};

// Uncapped level (1 → ∞): 99+ for prestige grinders, BigInt-safe to absurd magnitudes.
export const virtualLevelForXp = (xp: number) => {
  const target = BigInt(Math.floor(Math.max(0, xp) * XP_SCALE));
  let lvl = 1;
  growVirtual(3);
  while (target >= bigAt[lvl + 1]) {
    lvl++;
    growVirtual(lvl + 2);
  }
  return lvl;
};

const BIG_SUFFIX = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc", "Ud", "Dd", "Td", "Qad", "Qid", "Sxd", "Spd", "Ocd", "Nod", "Vg"];
const FMT_GROUP = 3;

// Render absurd numbers readably: 1234 → "1.23K", 1e9 → "1.00B"; past the named suffixes
// it falls back to scientific notation, so the display never overflows or lies.
export const fmtBig = (n: number) => {
  if (!isFinite(n)) return "∞";
  if (n < 1000) return String(Math.floor(n));
  const tier = Math.floor(Math.log10(n) / FMT_GROUP);
  if (tier >= BIG_SUFFIX.length) return n.toExponential(2).replace("e+", "e");
  const scaled = n / Math.pow(10, tier * FMT_GROUP);
  const dp = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${scaled.toFixed(dp)}${BIG_SUFFIX[tier]}`;
};

// ---------- the strengths (data-driven; tune freely) ----------
export interface SkillDef {
  id: string; name: string; icon: string; blurb: string;
  // xp this skill earns from one scored commit (0 = untrained by that commit).
  route: (c: CraftResult) => number;
}

// routing helpers over a scored commit
const ext = (c: CraftResult, ...exts: string[]) => c.paths.some((p) => { const lp = p.toLowerCase(); return exts.some((e) => lp.endsWith(e)); });
const inPath = (c: CraftResult, re: RegExp) => c.paths.some((p) => re.test(p.toLowerCase()));
const said = (c: CraftResult, re: RegExp) => re.test(c.subject);
const hourOf = (c: CraftResult) => new Date(c.committedAt || Date.now()).getHours();
const dowOf = (c: CraftResult) => new Date(c.committedAt || Date.now()).getDay();
const ARCH_LINES = 200, MARATHON_LINES = 400, MINI_LINES = 15, MONO_FILES = 12, NIGHT_END = 5, MORN_END = 9;
const CONVENTIONAL = /^(feat|fix|refactor|perf|test|docs|build|ci|style|chore|revert)(\(.+\))?!?:/i;

// a language skill: trained whenever the commit touches files of that language
const lang = (id: string, name: string, icon: string, exts: string[]): SkillDef => ({ id, name, icon, blurb: `${name} source.`, route: (c) => (ext(c, ...exts) ? c.xp : 0) });

const LANGS: [string, string, string, string[]][] = [
  ["typescript", "TypeScript", "🟦", [".ts", ".tsx", ".mts", ".cts"]],
  ["javascript", "JavaScript", "🟨", [".js", ".jsx", ".mjs", ".cjs"]],
  ["python", "Python", "🐍", [".py", ".pyi", ".pyw"]],
  ["rust", "Rust", "🦀", [".rs"]],
  ["go", "Go", "🐹", [".go"]],
  ["java", "Java", "☕", [".java"]],
  ["clang", "C", "🔵", [".c", ".h"]],
  ["cpp", "C++", "➕", [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"]],
  ["csharp", "C#", "🎯", [".cs"]],
  ["ruby", "Ruby", "💎", [".rb", ".erb", ".rake", ".gemspec"]],
  ["php", "PHP", "🐘", [".php"]],
  ["swift", "Swift", "🦅", [".swift"]],
  ["kotlin", "Kotlin", "🟪", [".kt", ".kts"]],
  ["scala", "Scala", "🔺", [".scala", ".sc"]],
  ["haskell", "Haskell", "🔮", [".hs", ".lhs"]],
  ["elixir", "Elixir", "💧", [".ex", ".exs"]],
  ["erlang", "Erlang", "☎️", [".erl", ".hrl"]],
  ["clojure", "Clojure", "🍃", [".clj", ".cljs", ".cljc", ".edn"]],
  ["lua", "Lua", "🌙", [".lua"]],
  ["perl", "Perl", "🐪", [".pl", ".pm"]],
  ["rlang", "R", "📈", [".r"]],
  ["julia", "Julia", "🔬", [".jl"]],
  ["dart", "Dart", "🏹", [".dart"]],
  ["zig", "Zig", "🦎", [".zig"]],
  ["nim", "Nim", "👑", [".nim"]],
  ["ocaml", "OCaml", "🐫", [".ml", ".mli"]],
  ["fsharp", "F#", "🎼", [".fs", ".fsx", ".fsi"]],
  ["elm", "Elm", "🌳", [".elm"]],
  ["shell", "Shell", "🐚", [".sh", ".bash", ".zsh", ".fish"]],
  ["powershell", "PowerShell", "💠", [".ps1", ".psm1", ".psd1"]],
  ["sqllang", "SQL", "🗃️", [".sql"]],
  ["html", "HTML", "📄", [".html", ".htm"]],
  ["csslang", "CSS", "🎨", [".css"]],
  ["sass", "Sass", "💅", [".scss", ".sass", ".less", ".styl"]],
  ["vue", "Vue", "💚", [".vue"]],
  ["svelte", "Svelte", "🧡", [".svelte"]],
  ["astro", "Astro", "🛰️", [".astro"]],
  ["graphqllang", "GraphQL", "🔷", [".graphql", ".gql"]],
  ["soliditylang", "Solidity", "⛓️", [".sol"]],
  ["assembly", "Assembly", "🔩", [".asm", ".s"]],
  ["objc", "Objective-C", "🍎", [".m", ".mm"]],
  ["groovy", "Groovy", "🎸", [".groovy", ".gradle"]],
  ["crystal", "Crystal", "🔆", [".cr"]],
  ["nix", "Nix", "❄️", [".nix"]],
  ["protobuf", "Protobuf", "🧩", [".proto"]]
];

const AGENT_SKILLS: SkillDef[] = AGENTS.map((a) => ({
  id: a.skillId,
  name: a.name,
  icon: a.icon,
  blurb: a.blurb,
  route: () => 0,
}));

export const SKILLS: SkillDef[] = [
  // --- craft / meta (12) ---
  { id: "shipping", name: "Shipping", icon: "🚢", blurb: "Substance shipped — every commit feeds it.", route: (c) => c.xp },
  { id: "featurecraft", name: "Feature Craft", icon: "✨", blurb: "Building new features.", route: (c) => (said(c, /\b(feat|feature|add(s|ed|ing)?|implement|introduce|create|new)\b/i) ? c.xp : 0) },
  { id: "debugging", name: "Debugging", icon: "🐛", blurb: "Fixes and bug hunts.", route: (c) => (said(c, /\b(fix|fixe[sd]|bug|patch|repair|resolve[sd]?|broken)\b/i) ? c.xp : 0) },
  { id: "refactoring", name: "Refactoring", icon: "♻️", blurb: "Cleanups, renames, simplifications.", route: (c) => (said(c, /\b(refactor|cleanup|clean ?up|simplif(y|ied)|rename|dedupe?|prune|tidy)\b/i) ? c.xp : 0) },
  { id: "testing", name: "Testing", icon: "🧪", blurb: "Adding or strengthening tests.", route: (c) => (c.hasTests || inPath(c, /(^|\/)(tests?|spec|__tests__|e2e)(\/|\.)/) ? c.xp : 0) },
  { id: "documentation", name: "Documentation", icon: "📖", blurb: "Docs, guides and comments.", route: (c) => (ext(c, ".md", ".mdx", ".rst", ".txt", ".adoc") || said(c, /\b(docs?|readme|guide|changelog)\b/i) ? Math.round(c.xp * 0.8) : 0) },
  { id: "architecture", name: "Architecture", icon: "🏛️", blurb: "Large, cross-cutting structural work.", route: (c) => (c.langs.length >= 2 && c.lines >= ARCH_LINES ? c.xp : 0) },
  { id: "release", name: "Release Engineering", icon: "🏷️", blurb: "Releases, versioning, changelogs.", route: (c) => (said(c, /\b(release|version|changelog|bump|publish|tag|deploy)\b/i) ? c.xp : 0) },
  { id: "opensource", name: "Open Source", icon: "🌍", blurb: "Work in public, open-licensed repos.", route: (c) => (c.oss ? c.xp : 0) },
  { id: "foreign", name: "Foreign Lands", icon: "🧭", blurb: "Contributions to other people's projects.", route: (c) => (c.ext ? c.xp : 0) },
  { id: "stargazing", name: "Stargazing", icon: "⭐", blurb: "Commits to repos the world has starred.", route: (c) => (c.stars > 0 ? Math.round(c.xp * Math.min(1, Math.log10(c.stars + 1) * 0.5)) : 0) },
  { id: "polyglot", name: "Polyglot", icon: "🗣️", blurb: "Touching many languages at once.", route: (c) => (c.langs.length >= 2 ? Math.round(c.xp * Math.min(1, (c.langs.length - 1) * 0.5)) : 0) },

  // --- languages (45) ---
  ...LANGS.map(([id, name, icon, exts]) => lang(id, name, icon, exts)),

  // --- domains / tooling (30) ---
  { id: "frontend", name: "Frontend", icon: "🖼️", blurb: "UI components, pages and views.", route: (c) => (ext(c, ".jsx", ".tsx", ".vue", ".svelte", ".astro", ".html", ".css", ".scss") || inPath(c, /(components?|pages?|views?|ui)\//) ? c.xp : 0) },
  { id: "backend", name: "Backend", icon: "🔧", blurb: "Servers, APIs, services.", route: (c) => (inPath(c, /(server|backend|api|routes?|controllers?|handlers?|services?|middleware)s?\//) ? c.xp : 0) },
  { id: "database", name: "Database", icon: "🗄️", blurb: "Schemas, migrations, queries.", route: (c) => (ext(c, ".sql") || inPath(c, /(migrations?|schema|prisma|drizzle|seeds?|repositor)/) ? c.xp : 0) },
  { id: "devops", name: "DevOps & CI", icon: "⚙️", blurb: "Pipelines and continuous integration.", route: (c) => (inPath(c, /(\.github\/workflows|\.gitlab-ci|jenkinsfile|\.circleci|azure-pipelines|\.travis|\.drone)/) ? c.xp : 0) },
  { id: "containers", name: "Containers", icon: "🐳", blurb: "Docker and friends.", route: (c) => (inPath(c, /(dockerfile|docker-compose|\.dockerignore|containerfile)/) ? c.xp : 0) },
  { id: "kubernetes", name: "Kubernetes", icon: "☸️", blurb: "Orchestration, Helm, manifests.", route: (c) => (inPath(c, /(k8s|kubernetes|helm|kustomization|chart\.yaml)/) ? c.xp : 0) },
  { id: "iac", name: "Infrastructure as Code", icon: "🏗️", blurb: "Terraform, Pulumi, Ansible.", route: (c) => (ext(c, ".tf", ".tfvars", ".hcl") || inPath(c, /(terraform|pulumi|cloudformation|ansible|\.bicep)/) ? c.xp : 0) },
  { id: "cloud", name: "Cloud", icon: "☁️", blurb: "AWS, GCP, Azure, serverless.", route: (c) => (inPath(c, /(aws|gcp|azure|serverless\.yml|lambda|cloudfront|\.firebase)/) ? c.xp : 0) },
  { id: "mobile", name: "Mobile", icon: "📱", blurb: "iOS, Android, cross-platform apps.", route: (c) => (ext(c, ".swift", ".kt", ".dart") || inPath(c, /(android|ios|react-native|flutter|expo)\//) ? c.xp : 0) },
  { id: "gamedev", name: "Game Dev", icon: "🎮", blurb: "Engines, scenes, game logic.", route: (c) => (ext(c, ".gd", ".unity", ".uasset", ".tscn") || inPath(c, /(unity|godot|unreal|game)\//) ? c.xp : 0) },
  { id: "graphics", name: "Graphics & Shaders", icon: "🖌️", blurb: "Shaders and rendering.", route: (c) => (ext(c, ".glsl", ".hlsl", ".wgsl", ".frag", ".vert", ".shader", ".metal") || inPath(c, /(shaders?|render)/) ? c.xp : 0) },
  { id: "ml", name: "Machine Learning", icon: "🤖", blurb: "Models, training, notebooks.", route: (c) => (ext(c, ".ipynb") || inPath(c, /(models?|train|neural|tensor|torch|sklearn|notebook|dataset)/) ? c.xp : 0) },
  { id: "dataeng", name: "Data Engineering", icon: "📊", blurb: "ETL, pipelines, warehouses.", route: (c) => (inPath(c, /(etl|spark|airflow|dags?|pipeline|warehouse|dbt|kafka)/) ? c.xp : 0) },
  { id: "security", name: "Security", icon: "🔐", blurb: "Auth, crypto, hardening.", route: (c) => (said(c, /\b(security|secure|vuln|cve|exploit|xss|csrf|sanitiz|harden|auth)\b/i) || inPath(c, /(auth|crypto|security|secrets?|\.pem|\.key)/) ? c.xp : 0) },
  { id: "networking", name: "Networking", icon: "📡", blurb: "Sockets, protocols, RPC.", route: (c) => (inPath(c, /(socket|tcp|udp|http|grpc|network|protocol|websocket|rpc)/) ? c.xp : 0) },
  { id: "embedded", name: "Embedded", icon: "🔌", blurb: "Firmware and microcontrollers.", route: (c) => (ext(c, ".ino") || inPath(c, /(firmware|embedded|rtos|arduino|esp32|stm32|baremetal)/) ? c.xp : 0) },
  { id: "blockchain", name: "Blockchain", icon: "🪙", blurb: "Smart contracts and web3.", route: (c) => (ext(c, ".sol") || inPath(c, /(contracts?|web3|blockchain|ethereum|hardhat|foundry|solana)/) ? c.xp : 0) },
  { id: "buildsystems", name: "Build Systems", icon: "🔨", blurb: "Make, CMake, bundlers.", route: (c) => (inPath(c, /(makefile|cmake|bazel|build\.(gradle|sbt)|webpack|vite\.config|rollup|esbuild|turbo\.json|nx\.json)/) ? c.xp : 0) },
  { id: "packaging", name: "Package Management", icon: "📦", blurb: "Manifests and dependencies.", route: (c) => (inPath(c, /(package\.json|cargo\.toml|requirements\.txt|go\.mod|gemfile|pom\.xml|pyproject\.toml|pubspec\.yaml|composer\.json)/) ? c.xp : 0) },
  { id: "apidesign", name: "API Design", icon: "🔗", blurb: "OpenAPI, schemas, contracts.", route: (c) => (inPath(c, /(openapi|swagger|\.proto|graphql|\.raml)/) ? c.xp : 0) },
  { id: "cli", name: "CLI Tooling", icon: "⌨️", blurb: "Command-line programs.", route: (c) => (inPath(c, /(^|\/)(bin|cli|cmd|commands?)\//) ? c.xp : 0) },
  { id: "observability", name: "Observability", icon: "🔭", blurb: "Metrics, logs, traces.", route: (c) => (inPath(c, /(prometheus|grafana|telemetry|metrics|logging|tracing|sentry|opentelemetry|datadog)/) ? c.xp : 0) },
  { id: "accessibility", name: "Accessibility", icon: "♿", blurb: "a11y, ARIA, inclusive UI.", route: (c) => (said(c, /\b(a11y|accessib|aria|wcag)\b/i) || inPath(c, /(a11y|aria)/) ? c.xp : 0) },
  { id: "i18n", name: "Internationalization", icon: "🌐", blurb: "Locales and translations.", route: (c) => (said(c, /\b(i18n|l10n|locali[sz]|translation)\b/i) || inPath(c, /(i18n|l10n|locales?|translations?)/) ? c.xp : 0) },
  { id: "seo", name: "SEO & Meta", icon: "🔍", blurb: "Discoverability and meta tags.", route: (c) => (inPath(c, /(sitemap|robots\.txt|\.well-known|opengraph)/) || said(c, /\b(seo|meta ?tags?|opengraph)\b/i) ? c.xp : 0) },
  { id: "animation", name: "Animation & Motion", icon: "🎞️", blurb: "Transitions and motion design.", route: (c) => (said(c, /\b(animat|transition|motion|keyframe)\b/i) || ext(c, ".gltf", ".glb", ".fbx") || inPath(c, /(animation|motion|spring)/) ? c.xp : 0) },
  { id: "e2e", name: "End-to-End Testing", icon: "🎭", blurb: "Browser and integration suites.", route: (c) => (inPath(c, /(e2e|playwright|cypress|selenium|webdriver|puppeteer)/) ? c.xp : 0) },
  { id: "performance", name: "Performance", icon: "⚡", blurb: "Speed, latency, throughput.", route: (c) => (said(c, /\b(perf|performance|optimi[sz]|speed ?up|latency|throughput|benchmark|faster|cache)\b/i) ? c.xp : 0) },
  { id: "regex", name: "Regular Expressions", icon: "🧵", blurb: "Pattern matching wizardry.", route: (c) => (said(c, /\b(regex|regexp|pattern ?match)\b/i) ? c.xp : 0) },
  { id: "config", name: "Configuration", icon: "🛠️", blurb: "Settings, env, tooling config.", route: (c) => (ext(c, ".toml", ".ini", ".env", ".conf", ".cfg", ".properties") || inPath(c, /(\.config|config\/|settings|\.rc$)/) ? c.xp : 0) },

  // --- behavior / time / craft style (13) ---
  { id: "hotfixer", name: "Hotfixer", icon: "🚒", blurb: "Urgent, under-pressure fixes.", route: (c) => (said(c, /\b(hotfix|urgent|critical|emergency|asap)\b/i) ? c.xp : 0) },
  { id: "reverter", name: "Reverter", icon: "↩️", blurb: "Knowing when to roll back.", route: (c) => (said(c, /\b(revert|rollback|undo)\b/i) ? c.xp : 0) },
  { id: "chores", name: "Chores", icon: "🧹", blurb: "Deps, lint, formatting, upkeep.", route: (c) => (said(c, /\b(chore|bump|upgrade|dependenc|lint|format|prettier|eslint)\b/i) ? c.xp : 0) },
  { id: "nightowl", name: "Night Owl", icon: "🦉", blurb: "Shipping in the dead of night.", route: (c) => (hourOf(c) < NIGHT_END ? c.xp : 0) },
  { id: "earlybird", name: "Early Bird", icon: "🐦", blurb: "Coding before the world wakes.", route: (c) => (hourOf(c) >= NIGHT_END && hourOf(c) < MORN_END ? c.xp : 0) },
  { id: "weekend", name: "Weekend Warrior", icon: "🗓️", blurb: "Saturday & Sunday grind.", route: (c) => (dowOf(c) === 0 || dowOf(c) === 6 ? c.xp : 0) },
  { id: "marathoner", name: "Marathoner", icon: "🏃", blurb: "Huge single pushes.", route: (c) => (c.lines >= MARATHON_LINES ? c.xp : 0) },
  { id: "minimalist", name: "Minimalist", icon: "🪶", blurb: "Tiny, surgical changes.", route: (c) => (c.lines > 0 && c.lines <= MINI_LINES ? c.xp : 0) },
  { id: "wordsmith", name: "Wordsmith", icon: "✍️", blurb: "Clean conventional commit messages.", route: (c) => (CONVENTIONAL.test(c.subject) ? c.xp : 0) },
  { id: "monorepo", name: "Monorepo", icon: "🗂️", blurb: "Sweeping, many-file commits.", route: (c) => (c.paths.length >= MONO_FILES ? c.xp : 0) },
  { id: "polish", name: "Polish", icon: "💄", blurb: "UX, styling and finishing touches.", route: (c) => (said(c, /\b(polish|ux|ui|tweak|cosmetic|spacing|layout|design)\b/i) ? c.xp : 0) },
  { id: "datacraft", name: "Data & Markup", icon: "📋", blurb: "JSON, YAML, XML, CSV.", route: (c) => (ext(c, ".json", ".yaml", ".yml", ".xml", ".csv") ? c.xp : 0) },
  { id: "automation", name: "Automation", icon: "🦾", blurb: "Scripts, crons, workflows.", route: (c) => (said(c, /\b(automat|script|cron|workflow)\b/i) || inPath(c, /(scripts?\/|automation)/) ? c.xp : 0) }
  ,

  // --- coding agents (tracked by `renown agent`, not by commit routing) ---
  ...AGENT_SKILLS
];

export const SKILL_IDS = SKILLS.map((sk) => sk.id);
export const skillById = (id: string) => SKILLS.find((sk) => sk.id === id);

export type SkillXp = Record<string, number>;

// Route one scored commit into per-skill xp gains (only the skills it actually trains).
export const awardCraft = (c: CraftResult): SkillXp => {
  const gains: SkillXp = {};
  for (const sk of SKILLS) {
    const got = Math.round(sk.route(c));
    if (got > 0) gains[sk.id] = got;
  }
  return gains;
};

// Merge gains into a skill-xp ledger (mutates + returns it), tracking which skills leveled.
export const applyGains = (ledger: SkillXp, gains: SkillXp) => {
  const levelUps: { id: string; from: number; to: number }[] = [];
  for (const id of Object.keys(gains)) {
    const before = levelForXp(ledger[id] ?? 0);
    ledger[id] = (ledger[id] ?? 0) + gains[id];
    const after = levelForXp(ledger[id]);
    if (after > before) levelUps.push({ id, from: before, to: after });
  }
  return levelUps;
};

export const totalLevel = (ledger: SkillXp) => SKILLS.reduce((sum, sk) => sum + levelForXp(ledger[sk.id] ?? 0), 0);
export const totalXp = (ledger: SkillXp) => SKILLS.reduce((sum, sk) => sum + (ledger[sk.id] ?? 0), 0);
export const maxedCount = (ledger: SkillXp) => SKILLS.filter((sk) => levelForXp(ledger[sk.id] ?? 0) >= MAX_LEVEL).length;
export const MAX_TOTAL_LEVEL = MAX_LEVEL * SKILLS.length;
export const displayLevelForSkill = (id: string, xp: number) => id.startsWith("agent-") ? virtualLevelForXp(xp) : levelForXp(xp);
export const isAgentSkill = (id: string) => id.startsWith("agent-");

// Highest skill(s) — used by the HUD to show your best strength at a glance.
export const topSkills = (ledger: SkillXp, n = 1) =>
  [...SKILLS]
    .map((sk) => ({ def: sk, xp: ledger[sk.id] ?? 0, level: levelForXp(ledger[sk.id] ?? 0) }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, n);
