// A player's pet roster as one camo-safe SVG — the visual surface the VS Code extension panel
// embeds (and a README can too). Renders each showcase pet sprite (generate() + spriteToSvg, the
// SAME source as the badge / OG card / 3D viewer, so it can't drift) into a tidy tier-tinted
// grid with the pet's name + tier. Pure rects/circles/text, no <defs>/IDs, so it survives
// GitHub's camo rasterizer.
import { generate, TIER_RGB, type Tier } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";
import type { ProfileData } from "./profile";

type Profile = NonNullable<ProfileData>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hex = ([r, g, b]: readonly [number, number, number]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Which pets to show: the curated showcase first, then the signature pets (rarest / biggest /
// avatar) that aren't already in it. Capped so the grid stays a glanceable roster, not a dump.
const petSeeds = (p: Profile): string[] => {
  const out = (Array.isArray(p.showcaseSeeds) ? p.showcaseSeeds : []).filter((s): s is string => typeof s === "string" && s.length > 0);
  for (const s of [p.rarestPetSeed, p.biggestPetSeed, p.avatarSeed]) if (typeof s === "string" && s && !out.includes(s)) out.push(s);
  return out.slice(0, 12);
};

export const profilePetsEtag = (p: Profile) =>
  `"profpets:${Bun.hash(`${p.login}:${petSeeds(p).join(",")}:${p.petsCount}`).toString(36)}"`;

const BG = "#16131f", TITLE = "#f4f1fb", MUTED = "#9a90b4";
const PAD = 16, GAP = 12, CARD = 122, LABELH = 32, TITLEH = 40;
const FONT = "Inter, Segoe UI, Verdana, DejaVu Sans, sans-serif";

const emptyCard = (login: string): string => {
  const W = 320, H = 150;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="@${esc(login)} has no pets yet">
  <rect width="${W}" height="${H}" rx="12" fill="${BG}"/>
  <text x="${W / 2}" y="${H / 2 - 8}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${TITLE}" font-weight="700">No pets yet</text>
  <text x="${W / 2}" y="${H / 2 + 14}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${MUTED}">Commit verified work to hatch your first 1/1.</text>
</svg>`;
};

export const renderProfilePets = (p: Profile): string => {
  const seeds = petSeeds(p);
  if (seeds.length === 0) return emptyCard(p.login);

  const cols = seeds.length <= 1 ? 1 : seeds.length <= 2 ? 2 : 3;
  const rows = Math.ceil(seeds.length / cols);
  const cardH = CARD + LABELH;
  const W = PAD * 2 + cols * CARD + (cols - 1) * GAP;
  const H = PAD + TITLEH + rows * cardH + (rows - 1) * GAP + PAD;

  const cards = seeds.map((seed, i) => {
    const c = generate(seed);
    const tint = TIER_RGB[c.tier as Tier] ?? [160, 160, 180];
    const cx = PAD + (i % cols) * (CARD + GAP);
    const cy = PAD + TITLEH + Math.floor(i / cols) * (cardH + GAP);
    const pet = spriteToSvg(c, { box: CARD - 30 });
    const px = cx + (CARD - pet.width) / 2;
    const py = cy + (CARD - pet.height) / 2;
    const one = c.oneOfOne
      ? `<text x="${(cx + CARD - 8).toFixed(1)}" y="${(cy + 16).toFixed(1)}" text-anchor="end" font-family="${FONT}" font-size="10" font-weight="700" fill="${hex(tint)}">1/1</text>`
      : "";
    return `<g>
    <rect x="${cx}" y="${cy}" width="${CARD}" height="${cardH}" rx="10" fill="${hex(tint)}" fill-opacity="0.12"/>
    <rect x="${cx + 0.5}" y="${cy + 0.5}" width="${CARD - 1}" height="${cardH - 1}" rx="10" fill="none" stroke="${hex(tint)}" stroke-opacity="0.45"/>
    ${one}
    <g transform="translate(${px.toFixed(1)},${py.toFixed(1)})">${pet.svg}</g>
    <text x="${(cx + CARD / 2).toFixed(1)}" y="${(cy + CARD + 12).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="${TITLE}">${esc(truncate(c.name, 16))}</text>
    <text x="${(cx + CARD / 2).toFixed(1)}" y="${(cy + CARD + 26).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="9" fill="${hex(tint)}">${c.tier}${c.sizeN ? ` · sz ${c.sizeN}` : ""}</text>
  </g>`;
  }).join("");

  const title = `@${esc(p.login)}'s pets`;
  const sub = `${p.petsCount} total`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title} — ${sub}">
  <rect width="${W}" height="${H}" rx="12" fill="${BG}"/>
  <text x="${PAD}" y="${PAD + 18}" font-family="${FONT}" font-size="14" font-weight="700" fill="${TITLE}">${title}</text>
  <text x="${(W - PAD).toFixed(1)}" y="${PAD + 18}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${MUTED}">${esc(sub)}</text>
  ${cards}
</svg>`;
};
