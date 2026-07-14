// Procedural generation — the keystone. A seed deterministically produces a unique
// creature: traits (weighted, CryptoPunks/Loot-style) → rarity (OpenRarity information
// content) → tier, with shiny-style hidden mythics and a threshold-gated 1-of-1, then an
// ASCII sprite (symmetric silhouette via cellular automata + part libraries + golden-ratio
// truecolor palette) and a grammar name. Pure + side-effect-free: the SAME seed always
// reproduces the SAME creature, anywhere — which is exactly what an optional on-chain
// proof layer would record ("the seed is the asset"). Powers collectibles AND pets.
import { R, type RGB, fg, hsvToRgb } from "./shiny.ts";
import { DEFAULT_PET_LOOK_ID, isPetLookId, type PetLookId } from "./petLooks.ts";

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
  seed: string; traits: Traits; tier: Tier; score: number; statRarity: number; rarestTrait: string;
  oneOfOne: boolean; mythicAura: boolean; name: string; palette: [RGB, RGB]; eyeColor: RGB;
  // Serialized cards split the stable printing DNA from the individual copy seed.
  // Legacy creatures omit both fields and therefore render exactly as they always have.
  visualSeed?: string;
  card?: CardCopyIdentity;
  // Continuous size (1-100), biased smoothly within the categorical size trait. Drives the
  // voxel grid dimensions — bigger sizeN = more pixels/voxels = a physically bigger creature.
  // Sortable: "biggest" leaderboard ranks by max(sizeN) across a player's wild.
  sizeN: number;
  sprite: () => string;
}

// sizeN derives a continuous number from the categorical size trait — each category gets a
// sub-range so a 'huge' is always > 'large', but within a category two creatures can be
// slightly different sizes. Distribution: ~10% tiny up to ~3% huge.
const SIZE_BANDS: Record<string, [number, number]> = { tiny: [1, 15], small: [16, 30], medium: [31, 50], large: [51, 75], huge: [76, 100] };
const computeSizeN = (rng: Rng, sizeCat: string) => {
  const [lo, hi] = SIZE_BANDS[sizeCat] ?? [25, 50];
  return Math.round(lo + rng() * (hi - lo));
};
// Voxel grid dimensions as a function of sizeN. Smooth scaling: size 1 → H≈4, size 100 → H≈15.
export const dimsFor = (sizeN: number) => {
  const H = Math.max(3, Math.round(3.5 + sizeN * 0.115));
  const halfW = Math.max(3, Math.round(H * 0.9));
  const fillP = 0.44 + sizeN * 0.0026;   // size 1→0.44, size 100→0.70
  return { H, halfW, fillP };
};

const ONE_OF_ONE = 1 / 250000;   // ultra-rare flag (true uniqueness is enforced by the chain layer)
const MYTHIC_PREDICATE = 0x37;   // hidden "shiny" combo on the seed hash (~1/256)

// ── serialized card lineage ────────────────────────────────────────────────
// A pet subject is the recognizable character; a printing is that subject in a
// specific variant with an immutable run; a copy owns one sequential serial.
// `/N` is therefore always supply. Pull odds are a separate field.
export type CardVariant = "base" | "uncommon" | "rare" | "epic" | "legendary" | "mythic" | "one-of-one";
type CardVariantConfig = { tier: Tier; printRun: number; weight: number; pullOdds: number };
export const CARD_VARIANTS: Record<CardVariant, CardVariantConfig> = {
  base:         { tier: "Common",    printRun: 10_000_000, weight: 780_000, pullOdds: 1 },
  uncommon:     { tier: "Uncommon",  printRun: 1_000_000,  weight: 140_000, pullOdds: 7 },
  rare:         { tier: "Rare",      printRun: 100_000,    weight: 50_000,  pullOdds: 20 },
  epic:         { tier: "Epic",      printRun: 10_000,     weight: 20_000,  pullOdds: 50 },
  legendary:    { tier: "Legendary", printRun: 500,        weight: 8_000,   pullOdds: 125 },
  mythic:       { tier: "Mythic",    printRun: 25,         weight: 1_900,   pullOdds: 526 },
  "one-of-one": { tier: "Mythic",    printRun: 1,          weight: 100,     pullOdds: 10_000 },
};
const CARD_VARIANT_ORDER = Object.keys(CARD_VARIANTS) as CardVariant[];
export const CARD_SET = "genesis-2026";
export const BUILTIN_CARD_SUBJECTS = 64;

export type CardCopyIdentity = {
  setId: string;
  subjectSeed: string;
  variant: CardVariant;
  printingId: string;
  serialNumber: number;
  printRun: number;
  pullOdds: number;
};

export const stableToken = (value: string) => {
  const h = xmur3(value);
  return [h(), h(), h()].map((n) => n.toString(36).padStart(7, "0")).join("").slice(0, 18);
};
export const cardPrintingId = (setId: string, subjectSeed: string, variant: CardVariant) =>
  `${setId}:${stableToken(subjectSeed)}:${variant}`;
export const builtInCardSubjectSeed = (index: number, setId = CARD_SET) =>
  `card-subject:${setId}:${Math.max(0, Math.floor(index)).toString(36).padStart(2, "0")}`;
export const cardSubjectIndex = (pullSeed: string, count: number, attempt = 0) =>
  count > 0 ? rint(makeRng(`card-subject-pick:${pullSeed}:${attempt}`), count) : 0;
export const chooseCardVariant = (pullSeed: string, attempt = 0): CardVariant => {
  let roll = makeRng(`card-variant:${pullSeed}:${attempt}`)() * 1_000_000;
  for (const variant of CARD_VARIANT_ORDER) {
    roll -= CARD_VARIANTS[variant].weight;
    if (roll < 0) return variant;
  }
  return "base";
};
export const cardCopyToken = (ownerKey: string, provenanceSeed: string) => stableToken(`${ownerKey}:${provenanceSeed}`);
export const cardSeedPrefix = (setId: string, subjectSeed: string, variant: CardVariant) =>
  `card:v1:${encodeURIComponent(setId)}:${encodeURIComponent(subjectSeed)}:${variant}`;
export const serializedCardSeed = ({ setId, subjectSeed, variant, serialNumber, printRun, copyToken }: {
  setId: string; subjectSeed: string; variant: CardVariant; serialNumber: number; printRun: number; copyToken: string;
}) => `${cardSeedPrefix(setId, subjectSeed, variant)}:${serialNumber}:${printRun}:${copyToken}`;

export const parseCardSeed = (seed: string): CardCopyIdentity | null => {
  const parts = seed.split(":");
  if (parts.length !== 8 || parts[0] !== "card" || parts[1] !== "v1") return null;
  const variant = parts[4] as CardVariant;
  const cfg = CARD_VARIANTS[variant];
  const serialNumber = Number(parts[5]), printRun = Number(parts[6]);
  if (!cfg || !Number.isInteger(serialNumber) || serialNumber < 1 || printRun !== cfg.printRun || serialNumber > printRun || !parts[7]) return null;
  try {
    const setId = decodeURIComponent(parts[2]), subjectSeed = decodeURIComponent(parts[3]);
    if (!setId || !subjectSeed) return null;
    return { setId, subjectSeed, variant, printingId: cardPrintingId(setId, subjectSeed, variant), serialNumber, printRun, pullOdds: cfg.pullOdds };
  } catch { return null; }
};

// ---- ASCII sprite: symmetric silhouette (CA + mirror) + parts + palette ----
const EYE: Record<string, string> = { dot: "•", round: "o", sleepy: "‿", fierce: ">", star: "*", void: "◦", cyclops: "O", many: "∷" };
const MOUTH: Record<string, [string, number]> = { smile: ["‿", 1], neutral: ["—", 1], fangs: ["ᴥ", 1], agape: ["o", 1], none: ["", 0], grin: ["▿", 1], tongue: ["ᵕ", 1] };

// ──────────────────────────────────────────────────────────────────────────────
// Canonical sprite structure — ONE source of truth for a creature's silhouette,
// face, and crest, consumed by three rendering engines that therefore cannot drift:
//   • the ANSI console      (renderCreature, below)
//   • the 2D SVG / OG image (core/petSvg.ts → spriteToSvg)
//   • the 3D voxelizer      (voxelize → in-app three.js)
// ──────────────────────────────────────────────────────────────────────────────

// Shared body silhouette: seeded cellular-automata blob, mirrored to a symmetric body.
// Returns the live rng (positioned right after the random fill, before any per-cell
// rolls) so each engine can continue the EXACT same stream it always did — the console
// for pattern speckle, the voxelizer for z-stack depth — preserving determinism.
export const buildBody = (c: Creature) => {
  const rng = makeRng((c.visualSeed ?? c.seed) + ":sprite");
  const { H, halfW, fillP } = dimsFor(c.sizeN);
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
  return { W, H, halfW, body, rng };
};

// Where the eyes + mouth land on the body grid — shared so 2D and 3D place them identically.
export const facePlacement = (c: Creature, W: number, H: number) => {
  const eyeRow = Math.max(0, Math.floor(H * 0.35)), mouthRow = Math.min(H - 1, eyeRow + 1);
  const eyeXs: [number, number] = [Math.floor(W * 0.3), Math.ceil(W * 0.7) - 1];
  const cyclops = c.traits.eyes === "cyclops";
  const cyclopsX = Math.floor(W / 2), mouthX = Math.floor(W / 2);
  const hasMouth = (MOUTH[c.traits.mouth]?.[1] ?? 0) > 0;
  return {
    eyeRow, mouthRow, eyeXs, cyclopsX, mouthX, hasMouth,
    isEye: (x: number, y: number) => y === eyeRow && !cyclops && (x === eyeXs[0] || x === eyeXs[1]),
    isCyclops: (x: number, y: number) => y === eyeRow && cyclops && x === cyclopsX,
    isMouth: (x: number, y: number) => y === mouthRow && hasMouth && x === mouthX,
  };
};

export type SpriteCellKind = "body" | "eye" | "mouth" | "crest" | "spark";
export type SpriteCell = { x: number; y: number; color: RGB; kind: SpriteCellKind };
export type Sprite = { w: number; h: number; cells: SpriteCell[] };

// Crest cells anchored to the actual silhouette — shoulder-mounted antlers/horns, a gold
// crown band, light-tipped antennae, and a halo emitted as a ring of cells. Coordinates are
// in body space; crest cells sit at NEGATIVE y (above the body) and are normalized by the
// consumer. The 2D engine upgrades the halo ring to a clean ellipse; the console and 3D
// engines render it blocky — same semantic crest, just optimized per medium.
export const buildCrest = (c: Creature, W: number, H: number, body: boolean[][]): SpriteCell[] => {
  const L = W / 2 - 1, R = W / 2;
  const topAt = (col: number) => { if (col < 0 || col >= W) return H; for (let y = 0; y < H; y++) if (body[y][col]) return y; return H; };
  const headTop = () => { let ht = H; for (let x = L - 2; x <= R + 2; x++) ht = Math.min(ht, topAt(x)); return ht >= H ? 0 : ht; };
  // nearest filled column's top (search outward) — avoids the sparse center seam so crests
  // sit on the head rather than floating above the central notch.
  const nearestTop = (col: number) => { for (let d = 0; d <= 3; d++) { const m = Math.min(topAt(col - d), topAt(col + d)); if (m < H) return m; } return headTop(); };
  const E = c.eyeColor, GOLD: RGB = [255, 206, 84], LIGHT: RGB = [255, 240, 170];
  const out: SpriteCell[] = [];
  const put = (x: number, y: number, color: RGB = E) => { if (x >= 0 && x < W) out.push({ x, y, color, kind: "crest" }); };
  switch (c.traits.crest) {
    case "nub": { put(L - 1, nearestTop(L - 1) - 1); put(R + 1, nearestTop(R + 1) - 1); break; }
    case "horns": { const sL = L - 1, sR = R + 1, tl = nearestTop(sL), tr = nearestTop(sR); put(sL, tl - 1); put(sL - 1, tl - 2); put(sR, tr - 1); put(sR + 1, tr - 2); break; }
    case "antennae": { const aL = L - 1, aR = R + 1, tl = nearestTop(aL), tr = nearestTop(aR); put(aL, tl - 1); put(aL, tl - 2, LIGHT); put(aR, tr - 1); put(aR, tr - 2, LIGHT); break; }
    case "antlers": {
      const sL = L - 1, sR = R + 1, tl = nearestTop(sL), tr = nearestTop(sR);
      put(sL, tl - 1); put(sL, tl - 2); put(sL - 1, tl - 2); put(sL, tl - 3); put(sL - 2, tl - 3);
      put(sR, tr - 1); put(sR, tr - 2); put(sR + 1, tr - 2); put(sR, tr - 3); put(sR + 2, tr - 3); break;
    }
    case "crown": { const ht = headTop(); for (let x = L - 2; x <= R + 2; x++) put(x, ht - 1, GOLD); [L - 2, L, R, R + 2].forEach((x) => put(x, ht - 2, GOLD)); break; }
    case "halo": { const ht = headTop(); [L - 1, L, R, R + 1].forEach((x) => put(x, ht - 3, LIGHT)); put(L - 2, ht - 2, LIGHT); put(R + 2, ht - 2, LIGHT); break; }
    default: break;
  }
  return out;
};

// Structured 2D sprite (static): body gradient + pattern speckle + eyes/mouth + crest + aura
// sparkles, normalized to a tight grid. The 2D SVG engine renders from this.
export const spriteCells = (c: Creature): Sprite => {
  const { W, H, body, rng } = buildBody(c);
  const [c1, c2] = c.palette;
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const fp = facePlacement(c, W, H);
  const cells: SpriteCell[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!body[y][x]) continue;
    const t = H > 1 ? y / (H - 1) : 0;
    let col: RGB = c.mythicAura ? hsvToRgb(((x / W) + (y * 0.07)) % 1, 0.9, 1) : [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
    if ((c.traits.pattern === "spots" || c.traits.pattern === "runes") && rng() < 0.18) col = [col[0] * 0.72, col[1] * 0.72, col[2] * 0.72];
    if (fp.isEye(x, y) || fp.isCyclops(x, y)) cells.push({ x, y, color: c.eyeColor, kind: "eye" });
    else if (fp.isMouth(x, y)) cells.push({ x, y, color: [20, 20, 30], kind: "mouth" });
    else cells.push({ x, y, color: col, kind: "body" });
  }
  cells.push(...buildCrest(c, W, H, body));
  if (c.traits.aura === "sparkle" || c.traits.aura === "rainbow" || c.mythicAura) {
    const minY = Math.min(...cells.map((cc) => cc.y));
    cells.push({ x: 0, y: minY, color: [255, 240, 170], kind: "spark" }, { x: W - 1, y: H - 1, color: [255, 240, 170], kind: "spark" });
  }
  const xs = cells.map((cc) => cc.x), ys = cells.map((cc) => cc.y), minX = Math.min(...xs), minY = Math.min(...ys);
  const w = Math.max(...xs) - minX + 1, h = Math.max(...ys) - minY + 1;
  for (const cc of cells) { cc.x -= minX; cc.y -= minY; }
  return { w, h, cells };
};

const renderCreature = (c: Creature, frame = 0): string => {
  const { W, H, body, rng } = buildBody(c);
  // paint: vertical gradient body, eyes + mouth overlaid, crest blocks, aura sparkles, mythic = rainbow
  const [c1, c2] = c.palette;
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const fp = facePlacement(c, W, H);
  const eyeGlyph = EYE[c.traits.eyes] ?? "•", [mGlyph] = MOUTH[c.traits.mouth] ?? ["—", 1];
  const dense = c.traits.pattern === "scales" ? "▓" : "█";
  // animation: everyone blinks + breathes; legendary shimmers; mythic rainbow-cycles
  const blink = frame % 7 === 4;
  const pulse = 0.82 + 0.18 * Math.sin(frame * 0.6);
  const shimmerCol = c.tier === "Legendary" ? frame % W : -99;
  const out: string[] = [];
  for (let y = 0; y < H; y++) {
    let line = "";
    for (let x = 0; x < W; x++) {
      const on = body[y][x];
      if (!on) { line += " "; continue; }
      const t = H > 1 ? y / (H - 1) : 0;
      let col: RGB = c.mythicAura ? hsvToRgb(((x / W) + (y * 0.07) + frame * 0.05) % 1, 0.9, 1) : [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
      if (!c.mythicAura) { const k = Math.abs(x - shimmerCol) <= 1 ? 1.6 : pulse; col = [Math.min(255, col[0] * k), Math.min(255, col[1] * k), Math.min(255, col[2] * k)]; }
      if (fp.isEye(x, y) || fp.isCyclops(x, y)) line += fg(...c.eyeColor) + (blink ? "-" : eyeGlyph);
      else if (fp.isMouth(x, y)) line += fg(20, 20, 30) + mGlyph;
      else { const speckle = (c.traits.pattern === "spots" || c.traits.pattern === "runes") && rng() < 0.18; line += fg(...col) + (speckle ? "·" : dense); }
    }
    out.push(line + R);
  }
  // crest: rendered from the shared buildCrest cells as colored blocks (one source of truth)
  const crest = buildCrest(c, W, H, body);
  if (crest.length) {
    const minCY = Math.min(...crest.map((cc) => cc.y));      // negative = rows above the body
    for (let cy = minCY; cy < 0; cy++) {
      const row = crest.filter((cc) => cc.y === cy);
      if (!row.length) { out.unshift(" ".repeat(W)); continue; }
      const cols: (string | null)[] = Array.from({ length: W }, () => null);
      for (const cc of row) cols[cc.x] = fg(...cc.color) + "█";
      out.unshift(cols.map((ch) => ch ?? " ").join("") + R);
    }
  }
  if (c.traits.aura === "sparkle" || c.traits.aura === "rainbow" || c.mythicAura) {
    out[0] = `${fg(255, 240, 160)}✦${R} ` + out[0];                  // prepend (don't slice into escapes)
    out[out.length - 1] = out[out.length - 1] + `${fg(255, 240, 160)} ✦${R}`;
  }
  return (frame % 4 >= 2 ? "\n" : "") + out.join("\n");              // gentle vertical bob
};

// animation frames for a living creature (everyone moves; rarer tiers move more)
export const frames = (c: Creature, count = 16) => Array.from({ length: count }, (_, i) => renderCreature(c, i));

// Structured 3D-friendly view of the same creature: a grid of voxels (one per filled ASCII
// cell) with rgb color + kind. Same algorithm as renderCreature, sans ANSI — for R3F.
export type Voxel = { x: number; y: number; z: number; color: RGB; kind: "body" | "eye" | "mouth" | "crest" };
export interface VoxelGrid { w: number; h: number; d: number; voxels: Voxel[]; aura: boolean; mythicAura: boolean; tier: Tier }
// Voxel depth (z-thickness) for a creature under a given look. legacy = 1 (flat);
// volumetric stacks 2–4 deep by size. Exported so the 3D viewer can keep camera framing
// consistent across looks (a deeper pet's front face sits closer to the camera).
export const clampVoxelDepth = (lookId: PetLookId, c: Creature) => {
  if (lookId !== "volumetric") return 1;
  return Math.max(2, Math.min(4, Math.round(1 + c.sizeN / 26)));
};
export const voxelize = (c: Creature, frame = 0, lookId: PetLookId = DEFAULT_PET_LOOK_ID): VoxelGrid => {
  const effectiveLookId = isPetLookId(lookId) ? lookId : DEFAULT_PET_LOOK_ID;
  const { W, H, body, rng } = buildBody(c);
  const [c1, c2] = c.palette;
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const fp = facePlacement(c, W, H);
  const pulse = 0.82 + 0.18 * Math.sin(frame * 0.6);
  const shimmerCol = c.tier === "Legendary" ? frame % W : -99;
  const voxels: Voxel[] = [];
  const maxDepth = clampVoxelDepth(effectiveLookId, c);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!body[y][x]) continue;
      const t = H > 1 ? y / (H - 1) : 0;
      let col: RGB = c.mythicAura
        ? hsvToRgb(((x / W) + (y * 0.07) + frame * 0.05) % 1, 0.9, 1)
        : [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
      if (!c.mythicAura) {
        const k = Math.abs(x - shimmerCol) <= 1 ? 1.6 : pulse;
        col = [Math.min(255, col[0] * k), Math.min(255, col[1] * k), Math.min(255, col[2] * k)];
      }
      // Volumetric mode gives depth by stacking the body across z.
      // Keep legacy mode 100% flat so old visuals continue unchanged.
      const radialBias = 1 - Math.abs((x / (W - 1)) - 0.5) * 2;
      const stackDepth = effectiveLookId === "legacy"
        ? 1
        : Math.max(1, Math.min(maxDepth, Math.round(1 + radialBias * (maxDepth - 1) + (rng() - 0.5))));
      const topZ = Math.max(0, stackDepth - 1);
      if (fp.isEye(x, y) || fp.isCyclops(x, y)) {
        voxels.push({ color: c.eyeColor, kind: "eye", x, y, z: topZ });
      } else if (fp.isMouth(x, y)) {
        voxels.push({ color: [20, 20, 30], kind: "mouth", x, y, z: Math.max(0, Math.floor(topZ * 0.6)) });
      } else {
        for (let z = 0; z < stackDepth; z++) {
          voxels.push({ color: col, kind: "body", x, y, z });
        }
      }
    }
  }
  // crest voxels from the shared structure — the 3D pet finally gets crests (negative y =
  // above the body), placed mid-depth so they read as attached to the head.
  const crestZ = Math.max(0, Math.floor((maxDepth - 1) / 2));
  for (const cc of buildCrest(c, W, H, body)) voxels.push({ color: cc.color, kind: "crest", x: cc.x, y: cc.y, z: crestZ });
  return { aura: c.traits.aura === "sparkle" || c.traits.aura === "rainbow", d: maxDepth, h: H, mythicAura: c.mythicAura, tier: c.tier, voxels, w: W };
};
// a one-line "chibi" face for compact spots (status line / lists)
const FACE_MOUTH: Record<string, string> = { smile: "ᵕ", neutral: "–", fangs: "ᴥ", agape: "o", none: "·", grin: "▿", tongue: "ᵕ" };
export const face = (c: Creature) => {
  const eye = EYE[c.traits.eyes] ?? "•", m = FACE_MOUTH[c.traits.mouth] ?? "–";
  const inner = c.traits.eyes === "cyclops" ? ` ${eye} ` : `${eye}${m}${eye}`;
  return c.mythicAura ? `(${inner})` : `${fg(...c.palette[0])}(${inner})${R}`;
};

// Wild find: a commit deterministically either yields a procedural creature or not
// (the roll AND the creature are seeded by the commit SHA → provenance, not gameable).
const WILD_MAX_CHANCE = 0.06;
export const rollWild = (xp: number, repoKey: string, sha: string): Creature | null => {
  if (!sha) return null;
  const chance = Math.min(WILD_MAX_CHANCE, xp / 5000);
  if (makeRng(`wildroll:${sha}`)() >= chance) return null;
  return generate(`wild:${repoKey}:${sha}`);
};
export const wildCelebrationTier = (tier: Tier) => (tier === "Mythic" || tier === "Legendary" ? 4 : tier === "Epic" || tier === "Rare" ? 3 : tier === "Uncommon" ? 2 : 1);

// the `renown menagerie` sheet — your wild finds, rarest first (top 3 rendered)
export const renderMenagerie = (seeds: string[]): string => {
  if (!seeds.length) return `${fg(135, 135, 160)}No wild finds yet — they drop from real commits.${R}`;
  const cs = [...new Set(seeds)].map(generate).sort((a, b) => b.score - a.score);
  const head = `${fg(196, 181, 253)}Menagerie — ${cs.length} wild ${cs.length === 1 ? "find" : "finds"}${R}  ${fg(135, 135, 160)}rarest: ${cs[0].name}${R}`;
  const top = cs.slice(0, 3).map(renderCard).join("\n\n");
  const rest = cs.slice(3).map((c) => `  ${fg(...TIER_RGB[c.tier])}◆ ${c.tier}${R}  ${c.name}`).join("\n");
  return [head, "", top, rest].filter(Boolean).join("\n");
};

// a full terminal "card" for a creature: tier badge, name, sprite, rarity + traits
// empirical score CDF (from sampling) → a relative rarity, not the misleading exact-combo odds
const MAX_SCORE = 28;
const CDF: [number, number][] = [[9.73, 0], [15.45, 0.52], [18.14, 0.82], [20.31, 0.94], [22.34, 0.982], [24.36, 0.996], [33.41, 1]];
export const rarerThan = (score: number) => {                    // fraction of pulls THIS one beats (0..1)
  let pctile = 1;
  for (let i = 0; i < CDF.length - 1; i++) { const [s0, p0] = CDF[i], [s1, p1] = CDF[i + 1]; if (score <= s1) { pctile = score <= s0 ? p0 : p0 + (p1 - p0) * ((score - s0) / (s1 - s0)); break; } }
  return Math.max(0.0001, 1 - pctile);                           // fraction RARER (floored so 1-in-N is finite)
};
export const rarityLabel = (c: Creature) => {
  if (c.card) return `#${c.card.serialNumber.toLocaleString()} / ${c.card.printRun.toLocaleString()} · pull odds ≈ 1 in ${c.card.pullOdds.toLocaleString()}`;
  if (c.oneOfOne) return "THE ONLY ONE — 1 of 1";
  if (c.mythicAura) return "mythic aura · ≈ 1 in 256";
  const frac = rarerThan(c.score);                               // fraction this-rare-or-rarer
  const beats = (1 - frac) * 100;                                // % of pulls it beats
  return `rarer than ${beats.toFixed(beats > 99 ? 2 : 0)}% · ≈ 1 in ${Math.round(1 / frac).toLocaleString()}`;
};
export const renderCard = (c: Creature): string => {
  const tc = TIER_RGB[c.tier];
  const badge = `${fg(...tc)}◆ ${c.tier.toUpperCase()}${c.oneOfOne ? " · 1-OF-1" : c.mythicAura ? " · MYTHIC AURA" : ""}${R}`;
  const filled = Math.max(1, Math.min(10, Math.round((c.score / MAX_SCORE) * 10)));
  const meter = `${fg(...tc)}${"▰".repeat(filled)}${fg(70, 70, 90)}${"▱".repeat(10 - filled)}${R}`;
  const traits = Object.entries(c.traits).map(([k, v]) => `${k}:${v}`).join("  ");
  return [
    `${badge}  ${fg(...tc)}${c.name}${R}`, "",
    c.sprite(), "",
    `${meter}  ${fg(...tc)}${rarityLabel(c)}${R}  ${fg(135, 135, 160)}· rarest: ${c.rarestTrait}${R}`,
    `${fg(135, 135, 160)}${traits}${R}`,
    `${fg(95, 95, 115)}seed: ${c.seed}${R}`
  ].join("\n");
};

const generateLegacy = (seed: string): Creature => {
  const rng = makeRng(seed);
  const traits: Traits = {};
  for (const slot of SLOTS) traits[slot.key] = draw(rng, slot.opts);
  // OpenRarity-style information content: Σ -log2(P(trait)); rarer traits dominate
  let score = 0, prod = 1, rarest = SLOTS[0].key, rarestP = 1;
  for (const slot of SLOTS) { const p = freq(slot, traits[slot.key]); score += -Math.log2(p); prod *= p; if (p < rarestP) { rarestP = p; rarest = `${traits[slot.key]} ${slot.key}`; } }
  const statRarity = Math.round(1 / prod);   // "≈ 1 in N" — probability of this exact combination
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
  // Numerical size (continuous 1-100) — a separate RNG stream so changing other generation
  // logic in the future doesn't shift sizeN for existing seeds.
  const sizeN = computeSizeN(makeRng(seed + ":size"), traits.size);
  const creature: Creature = { seed, traits, tier, score: +score.toFixed(2), statRarity, rarestTrait: rarest, oneOfOne, mythicAura, name, palette, eyeColor, sizeN, sprite: () => "" };
  creature.sprite = () => renderCreature(creature, 0);
  return creature;
};

const clampChannel = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const copyTint = (rgb: RGB, factor: number, bias: number): RGB => [
  clampChannel(rgb[0] * factor + bias), clampChannel(rgb[1] * factor + bias / 2), clampChannel(rgb[2] * factor - bias / 3),
];
const SCORE_FLOOR: Record<CardVariant, number> = { base: 10, uncommon: 15.45, rare: 18.14, epic: 20.31, legendary: 22.34, mythic: 24.36, "one-of-one": 34 };

// Serialized copies share their subject's name, traits and line silhouette. The copy
// token introduces bounded size/palette variation, so two cards in the same printing
// are clearly related without being pixel-identical.
export const generate = (seed: string): Creature => {
  const card = parseCardSeed(seed);
  if (!card) return generateLegacy(seed);
  const base = generateLegacy(card.subjectSeed);
  const cfg = CARD_VARIANTS[card.variant];
  const copyRng = makeRng(`card-copy:${seed}`);
  const sizeDelta = rint(copyRng, 13) - 6;
  const sizeN = Math.max(1, Math.min(100, base.sizeN + sizeDelta));
  const factor = 0.94 + copyRng() * 0.12;
  const bias = (copyRng() - 0.5) * 18;
  const palette: [RGB, RGB] = [copyTint(base.palette[0], factor, bias), copyTint(base.palette[1], factor, -bias)];
  const eyeColor = copyTint(base.eyeColor, 0.96 + copyRng() * 0.08, -bias / 2);
  const oneOfOne = card.printRun === 1;
  const creature: Creature = {
    ...base,
    seed,
    visualSeed: `card-line:${card.printingId}`,
    card,
    tier: cfg.tier,
    score: +Math.max(SCORE_FLOOR[card.variant], base.score).toFixed(2),
    statRarity: cfg.pullOdds,
    oneOfOne,
    mythicAura: card.variant === "mythic" || oneOfOne,
    palette,
    eyeColor,
    sizeN,
    sprite: () => "",
  };
  creature.sprite = () => renderCreature(creature, 0);
  return creature;
};
