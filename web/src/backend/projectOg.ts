// OG card for a repo's renown page (1200×630) — repo name, contributor headcount, top-3
// contributors, and the top contributor's pet. Mirrors ogImage.ts (hand-rolled SVG → PNG via
// resvg, pet via core/petSvg.ts spriteToSvg). Shared so the /project page's og:image POPs in
// Slack/Discord/Twitter.
import { Resvg } from "@resvg/resvg-js";
import { generate, TIER_RGB } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";
import type { ProjectData } from "./project.ts";

type Project = NonNullable<ProjectData>;
type RGB = [number, number, number];
const WIDTH = 1200, HEIGHT = 630;

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const rgb = ([r, g, b]: RGB, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

export const projectOgEtag = (p: Project) =>
  `"project-og:${Bun.hash(`${p.key}:${p.totals.devs}:${p.totals.xp}:${p.topContributor?.login ?? ""}:${p.topContributor?.avatarSeed ?? ""}`).toString(36)}"`;

export const renderProjectOgPng = (p: Project) => {
  const topSeed = p.topContributor?.avatarSeed ?? null;
  const accentCreature = topSeed ? generate(topSeed) : null;
  const accent: RGB = accentCreature ? TIER_RGB[accentCreature.tier] : [139, 92, 246];

  const pet = topSeed
    ? (() => {
        const { svg, width, height } = spriteToSvg(generate(topSeed), { box: 240 });
        const cx = 940, cy = 250, r = 130;
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,255,0.055)" stroke="${rgb(accent, 0.7)}" stroke-width="3"/>
          <g filter="url(#petGlow)" transform="translate(${cx - width / 2} ${cy - height / 2})">${svg}</g>
          <text x="${cx}" y="${cy + r + 34}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="20" fill="rgba(245,247,251,0.74)" font-weight="800">top: @${esc(p.topContributor!.login)}</text>`;
      })()
    : "";

  const rows = p.contributors.slice(0, 3).map((c, i) => `
    <text x="82" y="${452 + i * 50}" font-family="Inter, Arial, sans-serif" font-size="30" fill="#f5f7fb" font-weight="800">${i + 1}. @${esc(c.login)}${c.isAi ? "  🤖" : ""}</text>
    <text x="1118" y="${452 + i * 50}" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="30" fill="${hex(accent)}" font-weight="900">${fmt(c.xp)} XP</text>`).join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101722"/><stop offset="0.46" stop-color="#121a26"/>
      <stop offset="1" stop-color="${hex(accent)}" stop-opacity="0.38"/>
    </linearGradient>
    <radialGradient id="flare" cx="78%" cy="22%" r="70%">
      <stop offset="0" stop-color="${hex(accent)}" stop-opacity="0.5"/><stop offset="1" stop-color="#07090e" stop-opacity="0"/>
    </radialGradient>
    <filter id="petGlow" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="${hex(accent)}" flood-opacity="0.34"/></filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#flare)"/>
  <rect x="46" y="46" width="1108" height="538" rx="34" fill="rgba(4,7,11,0.32)" stroke="rgba(255,255,255,0.12)"/>
  <text x="82" y="122" font-family="Inter, Arial, sans-serif" font-size="30" fill="rgba(224,229,238,0.68)" font-weight="800">renown · repo leaderboard</text>
  <text x="82" y="196" font-family="Inter, Arial, sans-serif" font-size="64" fill="#f5f7fb" font-weight="950">${esc(p.key)}</text>
  <text x="82" y="250" font-family="Inter, Arial, sans-serif" font-size="30" fill="${hex(accent)}" font-weight="900">${fmt(p.totals.devs)} dev${p.totals.devs === 1 ? "" : "s"} · ${fmt(p.totals.xp)} XP earning renown here</text>
  ${rows}
  ${pet}
  <text x="1118" y="548" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="22" fill="rgba(224,229,238,0.6)" font-weight="800">XP and renown for real dev work</text>
</svg>`;

  const png = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH }, font: { defaultFontFamily: "Arial", loadSystemFonts: true } }).render().asPng();
  return new Uint8Array(png).buffer;
};
