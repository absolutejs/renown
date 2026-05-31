// Org OG card — 1200×630 shareable image behind /org/:owner. Tier-tinted, carries the org's top
// contributor's pet + the org headline (repos, devs, renown) + its top-3 contributors. Mirrors
// ogImage.ts / projectOg.ts.
import { Resvg } from "@resvg/resvg-js";
import { generate, TIER_RGB } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";
import type { OrgData } from "./org.ts";

type Org = NonNullable<OrgData>;
type RGB = [number, number, number];

const WIDTH = 1200, HEIGHT = 630;
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const rgb = ([r, g, b]: RGB, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

const stat = (label: string, value: string, x: number, y: number) => `
  <g transform="translate(${x} ${y})">
    <rect width="260" height="104" rx="18" fill="rgba(8,12,18,0.58)" stroke="rgba(255,255,255,0.12)" />
    <text x="24" y="42" font-family="Inter, Arial, sans-serif" font-size="20" fill="rgba(224,229,238,0.68)" font-weight="700">${esc(label)}</text>
    <text x="24" y="80" font-family="Inter, Arial, sans-serif" font-size="36" fill="#f5f7fb" font-weight="900">${esc(value)}</text>
  </g>`;

const petProjection = (seed: string, x: number, y: number, size: number) => {
  const creature = generate(seed);
  const { svg, width, height } = spriteToSvg(creature, { box: size * 0.86 });
  const ox = x + (size - width) / 2, oy = y + (size - height) / 2;
  return `
    <g>
      <circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size * 0.49}" fill="rgba(255,255,255,0.055)" stroke="${rgb(TIER_RGB[creature.tier], 0.7)}" stroke-width="3" />
      <ellipse cx="${x + size / 2}" cy="${y + size - 18}" rx="${size * 0.34}" ry="24" fill="rgba(0,0,0,0.32)" />
      <g filter="url(#petGlow)" transform="translate(${ox.toFixed(2)} ${oy.toFixed(2)})">${svg}</g>
      <text x="${x + size / 2}" y="${y + size + 42}" font-family="Inter, Arial, sans-serif" text-anchor="middle" font-size="21" fill="rgba(245,247,251,0.74)" font-weight="800">${esc(creature.tier)}</text>
    </g>`;
};

export const orgOgEtag = (g: Org) =>
  `"org-og:${Bun.hash([g.owner, g.totals.repos, g.totals.devs, g.totals.xp, g.topContributor?.login ?? "", g.topContributor?.avatarSeed ?? ""].join(":")).toString(36)}"`;

export const renderOrgOgPng = (g: Org) => {
  const seed = g.topContributor?.avatarSeed ?? null;
  const accent: RGB = seed ? TIER_RGB[generate(seed).tier] : [196, 181, 253];
  const top3 = g.contributors.slice(0, 3);
  const pet = seed
    ? petProjection(seed, 810, 112, 260)
    : `<g transform="translate(810 112)"><circle cx="130" cy="130" r="126" fill="rgba(255,255,255,0.055)" stroke="rgba(255,255,255,0.14)" stroke-width="3" /><text x="130" y="140" font-family="Inter, Arial, sans-serif" text-anchor="middle" font-size="26" fill="rgba(245,247,251,0.62)" font-weight="800">no pets yet</text></g>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101722" /><stop offset="0.46" stop-color="#121a26" /><stop offset="1" stop-color="${hex(accent)}" stop-opacity="0.38" /></linearGradient>
    <radialGradient id="flare" cx="78%" cy="22%" r="70%"><stop offset="0" stop-color="${hex(accent)}" stop-opacity="0.58" /><stop offset="0.54" stop-color="${hex(accent)}" stop-opacity="0.14" /><stop offset="1" stop-color="#07090e" stop-opacity="0" /></radialGradient>
    <filter id="petGlow" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="${hex(accent)}" flood-opacity="0.34" /></filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#flare)" />
  <path d="M0 480 C210 390 350 650 570 540 C770 440 880 500 1200 375 L1200 630 L0 630 Z" fill="rgba(255,255,255,0.045)" />
  <rect x="46" y="46" width="1108" height="538" rx="34" fill="rgba(4,7,11,0.32)" stroke="rgba(255,255,255,0.12)" />
  <text x="82" y="122" font-family="Inter, Arial, sans-serif" font-size="32" fill="rgba(224,229,238,0.68)" font-weight="800">renown · org</text>
  <text x="82" y="196" font-family="Inter, Arial, sans-serif" font-size="72" fill="#f5f7fb" font-weight="950">${esc(g.owner)}</text>
  <text x="82" y="262" font-family="Inter, Arial, sans-serif" font-size="26" fill="rgba(245,247,251,0.72)" font-weight="700">${top3.map((c) => `@${esc(c.login)}`).join("  ·  ") || "no contributors yet"}</text>
  <text x="82" y="372" font-family="Inter, Arial, sans-serif" font-size="92" fill="${hex(accent)}" font-weight="950">${esc(fmt(g.totals.xp))}</text>
  <text x="84" y="410" font-family="Inter, Arial, sans-serif" font-size="24" fill="rgba(224,229,238,0.68)" font-weight="800">renown across the org</text>
  ${stat("repos", fmt(g.totals.repos), 82, 448)}
  ${stat("devs", fmt(g.totals.devs), 368, 448)}
  ${stat("verified devs", fmt(g.totals.verifiedDevs), 654, 448)}
  ${pet}
  <text x="1118" y="534" font-family="Inter, Arial, sans-serif" text-anchor="end" font-size="27" fill="#f5f7fb" font-weight="950">Renown</text>
  <text x="1118" y="562" font-family="Inter, Arial, sans-serif" text-anchor="end" font-size="18" fill="rgba(224,229,238,0.58)" font-weight="800">XP and renown for real dev work</text>
</svg>`;

  const png = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH }, font: { defaultFontFamily: "Arial", loadSystemFonts: true } }).render().asPng();
  return new Uint8Array(png).buffer;
};
