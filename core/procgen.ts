// Procedural generation — the keystone. A seed deterministically produces a unique
// creature: traits (weighted, CryptoPunks/Loot-style) → rarity (OpenRarity information
// content) → tier, with shiny-style hidden mythics and a threshold-gated 1-of-1, then an
// ASCII sprite (symmetric silhouette via cellular automata + part libraries + golden-ratio
// truecolor palette) and a grammar name. Pure + side-effect-free: the SAME seed always
// reproduces the SAME creature, anywhere — which is exactly what an optional on-chain
// proof layer would record ("the seed is the asset"). Powers collectibles AND pets.
import { R, type RGB, fg, hsvToRgb } from "./shiny.ts";

// ---- seeded PRNG: xmur3 (string→ints) feeding sfc32 (full-period, high quality) ----
const xmur3 = (str: string) => {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
};
const sfc32 = (a: number, b: number, c: number, d: number) => () => {
  a |= 0; b |= 0; c |= 0; d |= 0;
  const t = ((a + b) | 0) + d | 0; d = (d + 1) | 0;
  a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
  return (t >>> 0) / 4294967296;
};
export type Rng = () => number;
export const makeRng = (seed: string): Rng => { const s = xmur3(seed); const r = sfc32(s(), s(), s(), s()); for (let i = 0; i < 12; i++) r(); return r; };
const rint = (rng: Rng, n: number) => Math.floor(rng() * n);

// ---- weighted traits (rarity lives in the weights) ----
type Opt = [string, number];                                  // [value, weight]
type Slot = { key: string; opts: Opt[] };
const SLOTS: Slot[] = [
  { key: "species", opts: [["Slime", 40], ["Critter", 30], ["Beast", 18], ["Construct", 11], ["Drake", 7], ["Sprite", 6], ["Wyrm", 3], ["Eldritch", 1.2], ["Celestial", 0.4]] },
  { key: "size", opts: [["tiny", 22], ["small", 34], ["medium", 29], ["large", 12], ["huge", 3]] },
  { key: "eyes", opts: [["dot", 30], ["round", 25], ["sleepy", 15], ["fierce", 12], ["star", 8], ["void", 5], ["cyclops", 3], ["many", 2]] },
  { key: "mouth", opts: [["smile", 30], ["neutral", 25], ["fangs", 16], ["agape", 12], ["none", 9], ["grin", 5], ["tongue", 3]] },
  { key: "crest", opts: [["none", 48], ["nub", 20], ["horns", 15], ["antennae", 8], ["antlers", 4], ["crown", 3], ["halo", 2]] },
  { key: "aura", opts: [["none", 58], ["glow", 20], ["sparkle", 11], ["flame", 5], ["frost", 3], ["void", 1.5], ["rainbow", 1]] },
  { key: "pattern", opts: [["plain", 40], ["spots", 25], ["stripes", 19], ["scales", 11], ["runes", 4], ["cosmic", 1]] }
];

export type Traits = Record<string, string>;
const draw = (rng: Rng, opts: Opt[]) => {
  const total = opts.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [v, w] of opts) { roll -= w; if (roll <= 0) return v; }
  return opts[opts.length - 1][0];
};
const freq = (slot: Slot, value: string) => { const total = slot.opts.reduce((s, [, w]) => s + w, 0); return (slot.opts.find(([v]) => v === value)?.[1] ?? 1) / total; };

export type Tier = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary" | "Mythic";
// thresholds calibrated from the score distribution → ~52/30/12/4/1.6/0.4% Common→Mythic
const TIERS: [Tier, number][] = [["Mythic", 24.36], ["Legendary", 22.34], ["Epic", 20.31], ["Rare", 18.14], ["Uncommon", 15.45]];
export const TIER_RGB: Record<Tier, RGB> = {
  Common: [160, 160, 180], Uncommon: [120, 220, 120], Rare: [100, 170, 255],
  Epic: [200, 140, 255], Legendary: [255, 200, 80], Mythic: [255, 120, 200]
};

// name grammar
const PREFIX = ["Mossy", "Glimmering", "Ancient", "Feral", "Cosmic", "Tiny", "Dread", "Gilded", "Hollow", "Prismatic", "Vorpal", "Eternal"];
const SUFFIX = ["of the Void", "of Dawn", "the Unyielding", "of Bytes", "the Lost", "of Embers", "the Pure", "of the Deep", "the Forgotten"];
const NOUN: Record<string, string[]> = {
  Slime: ["Ooze", "Blob", "Gel", "Pudding"], Critter: ["Kit", "Mite", "Pip", "Tot"], Beast: ["Maw", "Fang", "Howl", "Brute"],
  Construct: ["Cog", "Sentinel", "Idol", "Frame"], Drake: ["Drakeling", "Wyrmlet", "Scale", "Ember"], Sprite: ["Wisp", "Glow", "Flit", "Spark"],
  Wyrm: ["Serpent", "Coil", "Naga", "Leviath"], Eldritch: ["Horror", "Whisper", "Eye", "Dread"], Celestial: ["Star", "Halo", "Seraph", "Aurora"]
};

export interface Creature {
  seed: string; traits: Traits; tier: Tier; score: number; rarestTrait: string;
  oneOfOne: boolean; mythicAura: boolean; name: string; palette: [RGB, RGB]; eyeColor: RGB;
  sprite: () => string;
}

const ONE_OF_ONE = 1 / 250000;   // ultra-rare flag (true uniqueness is enforced by the chain layer)
const MYTHIC_PREDICATE = 0x37;   // hidden "shiny" combo on the seed hash (~1/256)

// ---- ASCII sprite: symmetric silhouette (CA + mirror) + parts + palette ----
const EYE: Record<string, string> = { dot: "•", round: "o", sleepy: "‿", fierce: ">", star: "*", void: "◦", cyclops: "O", many: "∷" };
const MOUTH: Record<string, [string, number]> = { smile: ["‿", 1], neutral: ["—", 1], fangs: ["ᴥ", 1], agape: ["o", 1], none: ["", 0], grin: ["▿", 1], tongue: ["ᵕ", 1] };

const renderCreature = (c: Creature): string => {
  const rng = makeRng(c.seed + ":sprite");
  const size = c.traits.size;
  const H = size === "tiny" ? 4 : size === "small" ? 5 : size === "large" ? 7 : size === "huge" ? 8 : 6;
  const halfW = Math.max(3, Math.round(H * 0.9));
  const fillP = size === "huge" ? 0.62 : size === "tiny" ? 0.46 : 0.54;
  // 1) random half-grid
  let half: boolean[][] = Array.from({ length: H }, () => Array.from({ length: halfW }, () => rng() < fillP));
  // 2) cellular-automata smoothing → organic blob
  const neighbors = (g: boolean[][], y: number, x: number) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dy && !dx) continue;
      const ny = y + dy, nx = x + dx;
      if (ny < 0 || ny >= H || nx < 0) n++;               // treat top/left edges as solid → fuller body
      else if (nx >= halfW) continue;
      else if (g[ny][nx]) n++;
    }
    return n;
  };
  for (let pass = 0; pass < 3; pass++) {
    half = half.map((row, y) => row.map((on, x) => { const n = neighbors(half, y, x); return n >= 5 ? true : n <= 2 ? false : on; }));
  }
  half.forEach((row) => { row[0] = row[0] || row[1]; });    // keep the spine (mirror seam) filled
  // 3) mirror to a full symmetric body
  const W = halfW * 2;
  const body: boolean[][] = half.map((row) => [...row, ...[...row].reverse()]);
  // 4) paint: vertical gradient body, eyes + mouth overlaid, aura sparkles, mythic = rainbow
  const [c1, c2] = c.palette;
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const eyeRow = Math.max(0, Math.floor(H * 0.35)), mouthRow = Math.min(H - 1, eyeRow + 1);
  const eyeGlyph = EYE[c.traits.eyes] ?? "•", [mGlyph] = MOUTH[c.traits.mouth] ?? ["—", 1];
  const dense = c.traits.pattern === "scales" ? "▓" : c.traits.pattern === "cosmic" ? "█" : "█";
  const out: string[] = [];
  for (let y = 0; y < H; y++) {
    let line = "";
    for (let x = 0; x < W; x++) {
      const on = body[y][x];
      if (!on) { line += " "; continue; }
      const t = H > 1 ? y / (H - 1) : 0;
      const col: RGB = c.mythicAura ? hsvToRgb(((x / W) + (y * 0.07)) % 1, 0.9, 1) : [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
      // eyes: two symmetric cells on the eye row; mouth: center on the mouth row
      const isEye = y === eyeRow && (x === Math.floor(W * 0.3) || x === Math.ceil(W * 0.7) - 1) && c.traits.eyes !== "cyclops";
      const isCyclops = y === eyeRow && c.traits.eyes === "cyclops" && x === Math.floor(W / 2);
      const isMouth = y === mouthRow && mGlyph && x === Math.floor(W / 2);
      if (isEye || isCyclops) line += fg(...c.eyeColor) + eyeGlyph;
      else if (isMouth) line += fg(20, 20, 30) + mGlyph;
      else { const speckle = (c.traits.pattern === "spots" || c.traits.pattern === "runes") && rng() < 0.18; line += fg(...col) + (speckle ? "·" : dense); }
    }
    out.push(line + R);
  }
  // crest on top + aura flourishes
  const crest = c.traits.crest;
  if (crest !== "none") {
    const top = { nub: "  ╷", horns: " \\ /", antennae: " ╎╎", antlers: "Y Y", crown: "♔", halo: "◜◝" }[crest] ?? "";
    if (top) out.unshift(fg(...c.eyeColor) + " ".repeat(Math.max(0, Math.floor((W - top.length) / 2))) + top + R);
  }
  if (c.traits.aura === "sparkle" || c.traits.aura === "rainbow" || c.mythicAura) {
    out[0] = `${fg(255, 240, 160)}✦${R} ` + out[0];                  // prepend (don't slice into escapes)
    out[out.length - 1] = out[out.length - 1] + `${fg(255, 240, 160)} ✦${R}`;
  }
  return out.join("\n");
};

// a full terminal "card" for a creature: tier badge, name, sprite, rarity + traits
export const renderCard = (c: Creature): string => {
  const tc = TIER_RGB[c.tier];
  const badge = `${fg(...tc)}◆ ${c.tier.toUpperCase()}${c.oneOfOne ? " · 1-OF-1" : c.mythicAura ? " · MYTHIC AURA" : ""}${R}`;
  const traits = Object.entries(c.traits).map(([k, v]) => `${k}:${v}`).join("  ");
  return [`${badge}  ${fg(...tc)}${c.name}${R}`, "", c.sprite(), "", `${fg(135, 135, 160)}rarity ${c.score} bits · rarest: ${c.rarestTrait}${R}`, `${fg(135, 135, 160)}${traits}${R}`, `${fg(95, 95, 115)}seed: ${c.seed}${R}`].join("\n");
};

export const generate = (seed: string): Creature => {
  const rng = makeRng(seed);
  const traits: Traits = {};
  for (const slot of SLOTS) traits[slot.key] = draw(rng, slot.opts);
  // OpenRarity-style information content: Σ -log2(P(trait)); rarer traits dominate
  let score = 0, rarest = SLOTS[0].key, rarestP = 1;
  for (const slot of SLOTS) { const p = freq(slot, traits[slot.key]); score += -Math.log2(p); if (p < rarestP) { rarestP = p; rarest = `${traits[slot.key]} ${slot.key}`; } }
  const hashRng = makeRng(seed + ":gate");
  const mythicAura = traits.aura === "rainbow" || (rint(hashRng, 256) === MYTHIC_PREDICATE);
  const oneOfOne = hashRng() < ONE_OF_ONE;
  let tier: Tier = "Common";
  for (const [t, threshold] of TIERS) if (score >= threshold) { tier = t; break; }
  if (mythicAura || oneOfOne) tier = "Mythic";
  // palette: golden-ratio hue, tier sets saturation/value; eyes complementary
  const GOLDEN = 0.618033988749895;
  const baseHue = rng();
  const sat = tier === "Common" ? 0.45 : tier === "Mythic" ? 1 : 0.55 + 0.08 * TIERS.findIndex(([x]) => x === tier);
  const palette: [RGB, RGB] = [hsvToRgb(baseHue, sat, 0.95), hsvToRgb((baseHue + GOLDEN * 0.12) % 1, sat, 0.6)];
  const eyeColor = hsvToRgb((baseHue + 0.5) % 1, 0.9, 1);
  const noun = NOUN[traits.species] ?? ["Thing"];
  const name = `${PREFIX[rint(rng, PREFIX.length)]} ${noun[rint(rng, noun.length)]} ${SUFFIX[rint(rng, SUFFIX.length)]}`;
  const creature: Creature = { seed, traits, tier, score: +score.toFixed(2), rarestTrait: rarest, oneOfOne, mythicAura, name, palette, eyeColor, sprite: () => "" };
  creature.sprite = () => renderCreature(creature);
  return creature;
};
