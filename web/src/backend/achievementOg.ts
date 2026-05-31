// Achievement OG card — 1200×630 shareable image behind /achievement/:id. Tier-tinted, the
// achievement's emoji + name + description, its rarity ("X% of N players"), and the recent
// earners' pets. Mirrors ogImage.ts / projectOg.ts.
import { Resvg } from "@resvg/resvg-js";
import { generate, TIER_RGB } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";
import type { AchievementData } from "./achievement.ts";

type Ach = NonNullable<AchievementData>;
type RGB = [number, number, number];

const WIDTH = 1200, HEIGHT = 630;
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const rgb = ([r, g, b]: RGB, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
// Tier accents — named tiers + a default for numbered (I/II/III…) and merit tiers.
const TIER_ACCENT: Record<string, RGB> = { mythic: [217, 159, 255], platinum: [125, 211, 252], gold: [250, 204, 21], silver: [203, 213, 225], bronze: [217, 142, 96], secret: [148, 163, 184] };
const TIER_EMOJI: Record<string, string> = { mythic: "🏆", platinum: "💠", gold: "🥇", silver: "🥈", bronze: "🥉", secret: "🔒" };

// Wrap a description to ~N chars/line over up to 2 lines.
const wrap = (s: string, per = 52, lines = 2): string[] => {
  const words = s.split(/\s+/); const out: string[] = []; let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > per) { out.push(cur.trim()); cur = w; if (out.length === lines) break; } else cur = `${cur} ${w}`; }
  if (cur.trim() && out.length < lines) out.push(cur.trim());
  if (out.length === lines && words.join(" ").length > out.join(" ").length) out[lines - 1] = `${out[lines - 1].slice(0, per - 1)}…`;
  return out;
};

export const achievementOgEtag = (a: Ach) =>
  `"ach-og:${Bun.hash([a.id, a.unlocks, a.players, a.earners[0]?.login ?? ""].join(":")).toString(36)}"`;

export const renderAchievementOgPng = (a: Ach) => {
  const accent: RGB = TIER_ACCENT[a.tier] ?? [196, 181, 253];
  const emoji = TIER_EMOJI[a.tier] ?? (a.secret ? "🔒" : "✦");
  const rarityText = a.unlocks === 0 ? "no one has it yet" : `${a.rarity}% of ${fmt(a.players)} players have it`;
  const desc = wrap(a.description, 54, 2);
  const pets = a.earners.slice(0, 6).filter((e) => e.avatarSeed).map((e, i) => {
    const { svg, width, height } = spriteToSvg(generate(e.avatarSeed as string), { box: 84 });
    const x = 82 + i * 100, y = 470;
    return `<g transform="translate(${(x + (84 - width) / 2).toFixed(1)},${(y + (84 - height) / 2).toFixed(1)})">${svg}</g>`;
  }).join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101722" /><stop offset="0.46" stop-color="#121a26" /><stop offset="1" stop-color="${hex(accent)}" stop-opacity="0.4" /></linearGradient>
    <radialGradient id="flare" cx="80%" cy="20%" r="72%"><stop offset="0" stop-color="${hex(accent)}" stop-opacity="0.6" /><stop offset="0.54" stop-color="${hex(accent)}" stop-opacity="0.14" /><stop offset="1" stop-color="#07090e" stop-opacity="0" /></radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#flare)" />
  <rect x="46" y="46" width="1108" height="538" rx="34" fill="rgba(4,7,11,0.32)" stroke="rgba(255,255,255,0.12)" />
  <text x="82" y="120" font-family="Inter, Arial, sans-serif" font-size="30" fill="rgba(224,229,238,0.68)" font-weight="800">renown achievement · ${esc(a.category)}</text>
  <text x="780" y="150" font-family="Inter, Arial, sans-serif" font-size="120" text-anchor="middle">${emoji}</text>
  <text x="82" y="220" font-family="Inter, Arial, sans-serif" font-size="68" fill="#f5f7fb" font-weight="950">${esc(a.name)}</text>
  ${desc.map((line, i) => `<text x="84" y="${272 + i * 38}" font-family="Inter, Arial, sans-serif" font-size="27" fill="rgba(245,247,251,0.78)" font-weight="600">${esc(line)}</text>`).join("")}
  <text x="82" y="408" font-family="Inter, Arial, sans-serif" font-size="46" fill="${hex(accent)}" font-weight="950">${esc(rarityText)}</text>
  ${a.earners.length > 0 ? `<text x="82" y="456" font-family="Inter, Arial, sans-serif" font-size="20" fill="rgba(224,229,238,0.6)" font-weight="800">recently earned by</text>${pets}` : ""}
  <text x="1118" y="556" font-family="Inter, Arial, sans-serif" text-anchor="end" font-size="22" fill="#f5f7fb" font-weight="950">Renown · earn it for real dev work</text>
</svg>`;

  const png = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH }, font: { defaultFontFamily: "Arial", loadSystemFonts: true } }).render().asPng();
  return new Uint8Array(png).buffer;
};
