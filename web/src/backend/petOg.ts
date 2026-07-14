// 1200×630 share card for a single pet's page (/pet/:seed). A seed deterministically generates a
// creature, so this is pure (no DB) and cached hard. Mirrors ogImage.ts's look (tier-accented
// gradient + the canonical pet projection) so a shared pet link produces a real card.
import { Resvg } from "@resvg/resvg-js";
import { generate, TIER_RGB } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";

type RGB = [number, number, number];
const WIDTH = 1200, HEIGHT = 630;
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const rgb = ([r, g, b]: RGB, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
const compact = (n: number) => (n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(1)}B` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));

export const petOgEtag = (seed: string) => `"pet-og:${Bun.hash(seed).toString(36)}"`;

export const renderPetOgPng = (seed: string) => {
  const c = generate(seed);
  const accent = TIER_RGB[c.tier];
  const { svg, width, height } = spriteToSvg(c, { box: 300 });
  const px = 880 - width / 2, py = 300 - height / 2;
  const edition = c.card ? `#${compact(c.card.serialNumber)} / ${compact(c.card.printRun)}` : "legacy pet";
  const rarity = `pull odds ≈ 1 in ${compact(c.card?.pullOdds ?? c.statRarity)}`;

  const page = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101722" /><stop offset="0.46" stop-color="#121a26" />
      <stop offset="1" stop-color="${hex(accent)}" stop-opacity="0.40" />
    </linearGradient>
    <radialGradient id="flare" cx="74%" cy="40%" r="64%">
      <stop offset="0" stop-color="${hex(accent)}" stop-opacity="0.6" />
      <stop offset="0.54" stop-color="${hex(accent)}" stop-opacity="0.14" />
      <stop offset="1" stop-color="#07090e" stop-opacity="0" />
    </radialGradient>
    <filter id="petGlow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="${hex(accent)}" flood-opacity="0.4" />
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#flare)" />
  <rect x="46" y="46" width="1108" height="538" rx="34" fill="rgba(4,7,11,0.32)" stroke="rgba(255,255,255,0.12)" />
  <text x="82" y="132" font-family="Inter, Arial, sans-serif" font-size="30" fill="rgba(224,229,238,0.68)" font-weight="800">${esc(edition)} · renown pet</text>
  <text x="82" y="214" font-family="Inter, Arial, sans-serif" font-size="68" fill="#f5f7fb" font-weight="950">${esc(c.name)}</text>
  <g transform="translate(82 250)">
    <rect width="${c.tier.length * 22 + 40}" height="44" rx="22" fill="${rgb(accent, 0.18)}" stroke="${rgb(accent, 0.5)}" />
    <text x="${(c.tier.length * 22 + 40) / 2}" y="30" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="24" fill="${hex(accent)}" font-weight="900">${esc(c.tier)}</text>
  </g>
  <text x="82" y="356" font-family="Inter, Arial, sans-serif" font-size="26" fill="rgba(245,247,251,0.78)" font-weight="700">size ${c.sizeN} · ${esc(rarity)}</text>
  <text x="82" y="396" font-family="Inter, Arial, sans-serif" font-size="22" fill="rgba(224,229,238,0.6)" font-weight="700">rarest trait · ${esc(c.rarestTrait)}${c.oneOfOne ? " · one of one" : ""}</text>
  <circle cx="880" cy="300" r="190" fill="rgba(255,255,255,0.055)" stroke="${rgb(accent, 0.7)}" stroke-width="3" />
  <ellipse cx="880" cy="${300 + height / 2 + 6}" rx="120" ry="22" fill="rgba(0,0,0,0.32)" />
  <g filter="url(#petGlow)" transform="translate(${px.toFixed(2)} ${py.toFixed(2)})">${svg}</g>
  <text x="1118" y="544" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="27" fill="#f5f7fb" font-weight="950">Renown</text>
  <text x="1118" y="572" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="18" fill="rgba(224,229,238,0.58)" font-weight="800">a pet minted from a real commit</text>
</svg>`;

  const png = new Resvg(page, { fitTo: { mode: "width", value: WIDTH }, font: { defaultFontFamily: "Arial", loadSystemFonts: true } }).render().asPng();
  return new Uint8Array(png).buffer;
};
