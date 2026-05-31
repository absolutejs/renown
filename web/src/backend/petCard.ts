// A single pet rendered as a standalone camo-safe SVG card — used for the "new pet hatched"
// celebration in the VS Code extension (it only has the pet's seed from /verify's newPetSeeds, so
// the server renders the creature). generate() + spriteToSvg, the same sprite source as the badge
// / OG card / 3D viewer, so it can't drift. Pure rects/circles/text, no <defs>/IDs.
import { generate, TIER_RGB, type Tier } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hex = ([r, g, b]: readonly [number, number, number]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const BG = "#16131f", TITLE = "#f4f1fb", MUTED = "#9a90b4";
const FONT = "Inter, Segoe UI, Verdana, DejaVu Sans, sans-serif";

export const petCardEtag = (seed: string) => `"petcard:${Bun.hash(seed).toString(36)}"`;

export const renderPetCard = (seed: string): string => {
  const c = generate(seed);
  const tint = TIER_RGB[c.tier as Tier] ?? [160, 160, 180];
  const W = 300, H = 320, PAD = 18, ART = 196;
  const pet = spriteToSvg(c, { box: ART });
  const px = (W - pet.width) / 2;
  const py = PAD + (ART - pet.height) / 2;
  const one = c.oneOfOne
    ? `<text x="${(W - PAD).toFixed(1)}" y="${(PAD + 14).toFixed(1)}" text-anchor="end" font-family="${FONT}" font-size="12" font-weight="700" fill="${hex(tint)}">1/1</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.name)} — ${c.tier}">
  <rect width="${W}" height="${H}" rx="14" fill="${BG}"/>
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="12" fill="${hex(tint)}" fill-opacity="0.10"/>
  <rect x="6.5" y="6.5" width="${W - 13}" height="${H - 13}" rx="12" fill="none" stroke="${hex(tint)}" stroke-opacity="0.5"/>
  ${one}
  <g transform="translate(${px.toFixed(1)},${py.toFixed(1)})">${pet.svg}</g>
  <text x="${W / 2}" y="${(PAD + ART + 32).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="700" fill="${TITLE}">${esc(truncate(c.name, 22))}</text>
  <text x="${W / 2}" y="${(PAD + ART + 54).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${hex(tint)}">${c.tier} · size ${c.sizeN}</text>
</svg>`;
};
