// Collectibles — dev-themed loot that rarely drops from real work (phase 3). Most commits
// drop nothing; substantial / open-source commits roll better odds and better rarity, and
// calendar events (Hacktoberfest, Halloween, New Year, Advent, weekends) unlock exclusive
// drops. A drop is a celebration (rarity → tier), legendary drops fire the ASCII spectacle.
import { C, RDIR } from "./runtime.ts";
import { B, R, fg, gradient, rainbow, type RGB } from "./shiny.ts";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "event";
export interface Collectible { id: string; name: string; icon: string; rarity: Rarity; blurb: string; event?: string }

export const RARITY: Record<Rarity, { label: string; rgb: RGB; tier: number }> = {
  common: { label: "Common", rgb: [155, 155, 175], tier: 1 },
  uncommon: { label: "Uncommon", rgb: [120, 220, 120], tier: 2 },
  rare: { label: "Rare", rgb: [100, 170, 255], tier: 3 },
  epic: { label: "Epic", rgb: [200, 140, 255], tier: 3 },
  legendary: { label: "Legendary", rgb: [255, 200, 80], tier: 4 },
  event: { label: "Event", rgb: [120, 220, 255], tier: 3 }
};

// calendar events: each gates its exclusive drops + nudges the odds while active
export const EVENTS: { id: string; name: string; active: (d: Date) => boolean }[] = [
  { id: "newyear", name: "New Year", active: (d) => d.getMonth() === 0 && d.getDate() <= 2 },
  { id: "halloween", name: "Halloween", active: (d) => d.getMonth() === 9 && d.getDate() >= 25 },
  { id: "hacktoberfest", name: "Hacktoberfest", active: (d) => d.getMonth() === 9 },
  { id: "advent", name: "Advent", active: (d) => d.getMonth() === 11 },
  { id: "weekend", name: "Weekend Rush", active: (d) => d.getDay() === 0 || d.getDay() === 6 }
];
export const activeEvents = (now = new Date()) => EVENTS.filter((e) => e.active(now)).map((e) => e.id);

export const CATALOG: Collectible[] = [
  // common
  { id: "ducky", name: "Rubber Duck", icon: "🦆", rarity: "common", blurb: "Explains your bug back to you." },
  { id: "mug", name: "Coffee Mug", icon: "☕", rarity: "common", blurb: "Fuel." },
  { id: "sticky", name: "Sticky Note", icon: "🗒️", rarity: "common", blurb: "TODO: forever." },
  { id: "keycap", name: "Stray Keycap", icon: "⌨️", rarity: "common", blurb: "Probably the spacebar." },
  { id: "usb", name: "USB Stick", icon: "💾", rarity: "common", blurb: "Orientation unknown." },
  { id: "cable", name: "Tangled Cable", icon: "🔌", rarity: "common", blurb: "It was fine yesterday." },
  { id: "pixel", name: "Lost Pixel", icon: "🟦", rarity: "common", blurb: "Off by one." },
  { id: "log", name: "console.log", icon: "🪵", rarity: "common", blurb: "The original debugger." },
  { id: "todo", name: "// TODO", icon: "📌", rarity: "common", blurb: "Aspirational." },
  { id: "bracket", name: "Lonely Bracket", icon: "❳", rarity: "common", blurb: "Looking for its pair." },
  { id: "byte", name: "A Byte", icon: "🍪", rarity: "common", blurb: "Eight bits of joy." },
  { id: "cursor", name: "Blinking Cursor", icon: "▏", rarity: "common", blurb: "Waiting." },
  { id: "promptreceipt", name: "Prompt Receipt", icon: "🧾", rarity: "common", blurb: "Proof you paid in tokens." },
  // uncommon
  { id: "hoodie", name: "Hacker Hoodie", icon: "🧥", rarity: "uncommon", blurb: "+2 to looking busy." },
  { id: "glasses", name: "Blue-Light Glasses", icon: "👓", rarity: "uncommon", blurb: "3am insurance." },
  { id: "snippet", name: "Golden Snippet", icon: "✂️", rarity: "uncommon", blurb: "Stack Overflow's finest." },
  { id: "branch", name: "Clean Branch", icon: "🌿", rarity: "uncommon", blurb: "No merge conflicts." },
  { id: "linter", name: "Tamed Linter", icon: "🧹", rarity: "uncommon", blurb: "Zero warnings." },
  { id: "cache", name: "Warm Cache", icon: "🔥", rarity: "uncommon", blurb: "Sub-millisecond." },
  { id: "mechkey", name: "Mechanical Keyboard", icon: "🎹", rarity: "uncommon", blurb: "Clack." },
  { id: "greenci", name: "All-Green CI", icon: "✅", rarity: "uncommon", blurb: "A rare sight." },
  { id: "coldbrew", name: "Cold Brew", icon: "🧊", rarity: "uncommon", blurb: "For the long sessions." },
  { id: "approvalstamp", name: "Approval Stamp", icon: "✅", rarity: "uncommon", blurb: "The agent asked nicely before touching the rake." },
  { id: "contextcorkboard", name: "Context Corkboard", icon: "🧷", rarity: "uncommon", blurb: "A place to pin the thing it forgot anyway." },
  // rare
  { id: "goldcommit", name: "Golden Commit", icon: "🪙", rarity: "rare", blurb: "Perfectly atomic." },
  { id: "perfectdiff", name: "The Perfect Diff", icon: "📜", rarity: "rare", blurb: "Net-negative lines." },
  { id: "shard", name: "Shard of Clean Code", icon: "💠", rarity: "rare", blurb: "Reads like prose." },
  { id: "owl", name: "Owl Familiar", icon: "🦉", rarity: "rare", blurb: "Companion for 3am." },
  { id: "bugnet", name: "Bug Net", icon: "🪲", rarity: "rare", blurb: "Catches them mid-flight." },
  { id: "compass", name: "Debugger's Compass", icon: "🧭", rarity: "rare", blurb: "Points to the stack frame." },
  { id: "prism", name: "Syntax Prism", icon: "🌈", rarity: "rare", blurb: "Highlights everything." },
  { id: "keymaster", name: "Keymaster", icon: "🔑", rarity: "rare", blurb: "Knows every shortcut." },
  { id: "sandboxkey", name: "Sandbox Key", icon: "🗝️", rarity: "rare", blurb: "Works only after three approvals and a stern look." },
  { id: "modelswitcher", name: "Model Switcher", icon: "🎚️", rarity: "rare", blurb: "Surely the next model will understand the repo." },
  // epic
  { id: "monocle", name: "Architect's Monocle", icon: "🧐", rarity: "epic", blurb: "Sees the whole system." },
  { id: "phoenix", name: "Phoenix Down", icon: "🔥", rarity: "epic", blurb: "git revert, but stylish." },
  { id: "crown", name: "Refactor Crown", icon: "👑", rarity: "epic", blurb: "Bow to clean code." },
  { id: "orb", name: "Orb of Foresight", icon: "🔮", rarity: "epic", blurb: "Predicts the edge case." },
  { id: "katana", name: "Refactor Katana", icon: "🗡️", rarity: "epic", blurb: "One clean slice." },
  { id: "beacon", name: "Deploy Beacon", icon: "🚨", rarity: "epic", blurb: "Shipped to prod on a Friday." },
  { id: "anvil", name: "Build Anvil", icon: "⚒️", rarity: "epic", blurb: "Forges the binary." },
  { id: "statuslinefuse", name: "Status-Line Fuse", icon: "🧨", rarity: "epic", blurb: "Makes terminal chrome legally excessive." },
  // legendary
  { id: "monolith", name: "The Monolith", icon: "🗿", rarity: "legendary", blurb: "It compiles. Nobody knows why." },
  { id: "excalibur", name: "Excalibur", icon: "⚔️", rarity: "legendary", blurb: "The one-character fix that saved prod." },
  { id: "truth", name: "Source of Truth", icon: "🔮", rarity: "legendary", blurb: "The README that was correct." },
  { id: "unicorn", name: "Bug-Free Build", icon: "🦄", rarity: "legendary", blurb: "Allegedly exists." },
  { id: "dragon", name: "Slain Type Dragon", icon: "🐉", rarity: "legendary", blurb: "tsc: 0 errors." },
  { id: "halo", name: "The Green Halo", icon: "😇", rarity: "legendary", blurb: "100% coverage, honestly." },
  { id: "ring", name: "The Root Password", icon: "💍", rarity: "legendary", blurb: "One key to rule them all." },
  { id: "goldendiff", name: "The Golden Diff", icon: "🏆", rarity: "legendary", blurb: "AI changed three lines and only one was decorative." },
  // event-exclusive
  { id: "hacktober", name: "Hacktoberfest Leaf", icon: "🍂", rarity: "event", event: "hacktoberfest", blurb: "Four PRs and a T-shirt." },
  { id: "pumpkin", name: "Pumpkin Bug", icon: "🎃", rarity: "event", event: "halloween", blurb: "Spooky segfault." },
  { id: "ghost", name: "Null Ghost", icon: "👻", rarity: "event", event: "halloween", blurb: "undefined is not a function." },
  { id: "advent", name: "Advent Commit", icon: "🎄", rarity: "event", event: "advent", blurb: "One a day 'til release." },
  { id: "gift", name: "Wrapped Release", icon: "🎁", rarity: "event", event: "advent", blurb: "Shipped before the holidays." },
  { id: "midnight", name: "Midnight Deploy", icon: "🎆", rarity: "event", event: "newyear", blurb: "Resolution: more tests." },
  { id: "floppy", name: "Y2K Floppy", icon: "💾", rarity: "event", event: "newyear", blurb: "Still bootable." },
  { id: "wkcrown", name: "Weekend Warrior's Crown", icon: "👑", rarity: "event", event: "weekend", blurb: "Who needs rest?" },
  { id: "pajamas", name: "Saturday Special", icon: "🛋️", rarity: "event", event: "weekend", blurb: "Coding in pajamas." }
];

export const byId = (id: string) => CATALOG.find((c) => c.id === id);
export const totalCount = CATALOG.filter((c) => c.rarity !== "event").length;

export type Owned = Record<string, { at: number; count: number }>;
type Rng = () => number;
const DROP_TIERS: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
const WEIGHT: Record<string, number> = { common: 1000, uncommon: 320, rare: 90, epic: 22, legendary: 4 };
const MAX_CHANCE = 0.3, EVENT_ROLL = 0.4;

const pick = <T>(arr: T[], rng: Rng) => arr[Math.floor(rng() * arr.length)];
const preferUnowned = (pool: Collectible[], owned: Owned, rng: Rng) => {
  const fresh = pool.filter((c) => !owned[c.id]);
  return pick(fresh.length ? fresh : pool, rng);
};

// Roll a drop for one scored commit. Returns null most of the time.
export const rollDrop = (xp: number, oss: boolean, owned: Owned, now = new Date(), rng: Rng = Math.random): Collectible | null => {
  const chance = Math.min(MAX_CHANCE, 0.03 + xp / 1500 + (oss ? 0.05 : 0));
  if (rng() > chance) return null;
  const events = activeEvents(now);
  if (events.length && rng() < EVENT_ROLL) {
    const pool = CATALOG.filter((c) => c.event && events.includes(c.event));
    if (pool.length) return preferUnowned(pool, owned, rng);
  }
  const boost = 1 + xp / 400 + (oss ? 1 : 0);   // bigger / OSS commits tilt toward the good stuff
  const weighted = DROP_TIERS.map((t) => [t, WEIGHT[t] * (t === "epic" || t === "legendary" ? boost : 1)] as const);
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total, rarity: Rarity = "common";
  for (const [t, w] of weighted) { roll -= w; if (roll <= 0) { rarity = t; break; } }
  const pool = CATALOG.filter((c) => c.rarity === rarity && !c.event);
  return pool.length ? preferUnowned(pool, owned, rng) : null;
};

// record a drop; returns whether it's newly collected (the bigger celebration)
export const addCollectible = (owned: Owned, c: Collectible) => {
  const isNew = !owned[c.id];
  owned[c.id] = { at: owned[c.id]?.at ?? Date.now(), count: (owned[c.id]?.count ?? 0) + 1 };
  return isNew;
};

// a drop → a {tier, text} celebration (structurally a Celebration; event.ts queues it)
export const dropCelebration = (c: Collectible, isNew: boolean) => ({
  tier: RARITY[c.rarity].tier,
  text: `📦 ${isNew ? "NEW " : ""}${RARITY[c.rarity].label}: ${c.icon} ${c.name}`
});

// the `renown collection` sheet — owned shine by rarity, locked rares stay a mystery
export const renderCollection = (owned: Owned) => {
  const got = CATALOG.filter((c) => owned[c.id]).length;
  const order: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common", "event"];
  const head = `${B}${fg(196, 181, 253)}Collection ${got}/${CATALOG.length}${R}  ${C.dim}(${totalCount} core + ${CATALOG.length - totalCount} event)${R}`;
  const lines: string[] = [head];
  for (const rarity of order) {
    const group = CATALOG.filter((c) => c.rarity === rarity);
    const meta = RARITY[rarity];
    lines.push(`${B}${fg(...meta.rgb)}${meta.label}${R} ${C.dim}${group.filter((c) => owned[c.id]).length}/${group.length}${R}`);
    for (const c of group) {
      const have = owned[c.id];
      if (have) {
        const name = rarity === "legendary" ? rainbow(c.name) : gradient(c.name, meta.rgb, [255, 255, 255]);
        const mult = have.count > 1 ? `${C.dim} ×${have.count}${R}` : "";
        lines.push(`  ${c.icon} ${name}${mult}  ${C.dim}${c.blurb}${R}`);
      } else if (rarity === "legendary" || rarity === "epic") {
        lines.push(`  ${C.dim}🔒 ??? — undiscovered ${meta.label.toLowerCase()}${R}`);
      } else {
        lines.push(`  ${C.dim}🔒 ${c.name}${R}`);
      }
    }
  }
  return lines.join("\n");
};

export const RDIR_HINT = RDIR;   // (collectibles persist inside the local renown state)
