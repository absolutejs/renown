// 1200×630 share card for /vs/:a/:b — two devs, their avatar pets, scores, and the verdict.
import { Resvg } from "@resvg/resvg-js";
import { generate, TIER_RGB } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";
import type { Versus } from "./versus.ts";

type RGB = [number, number, number];
const W = 1200, H = 630;
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const rgb = ([r, g, b]: RGB, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : Math.round(n).toLocaleString("en-US"));

export const versusOgEtag = (vs: Versus) => `"vs-og:${Bun.hash(`${vs.a.login}:${vs.a.score}:${vs.b.login}:${vs.b.score}`).toString(36)}"`;

const side = (login: string, score: number, seed: string | null, cx: number, winner: boolean) => {
  const accent: RGB = seed ? TIER_RGB[generate(seed).tier] : [160, 160, 180];
  let pet = "";
  if (seed) {
    const { svg, width, height } = spriteToSvg(generate(seed), { box: 220 });
    pet = `<g transform="translate(${(cx - width / 2).toFixed(1)} ${(250 - height / 2).toFixed(1)})">${svg}</g>`;
  }
  return `
    <circle cx="${cx}" cy="250" r="150" fill="rgba(255,255,255,0.05)" stroke="${rgb(accent, winner ? 0.95 : 0.4)}" stroke-width="${winner ? 6 : 3}" />
    ${pet}
    <text x="${cx}" y="452" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="40" font-weight="950" fill="#f5f7fb">@${esc(login)}</text>
    <text x="${cx}" y="500" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="800" fill="${hex(accent)}">${esc(fmt(score))}</text>
    ${winner ? `<text x="${cx}" y="150" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="900" fill="#ffd66b" letter-spacing="2">WINNER</text>` : ""}`;
};

export const renderVersusOgPng = (vs: Versus) => {
  const aWin = vs.verdict.leader === "a", bWin = vs.verdict.leader === "b";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101722"/><stop offset="1" stop-color="#161020"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" />
  <rect x="46" y="46" width="${W - 92}" height="${H - 92}" rx="34" fill="rgba(4,7,11,0.32)" stroke="rgba(255,255,255,0.12)" />
  ${side(vs.a.login, vs.a.score, vs.a.avatarSeed, 340, aWin)}
  ${side(vs.b.login, vs.b.score, vs.b.avatarSeed, 860, bWin)}
  <text x="${W / 2}" y="265" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="64" font-weight="950" fill="rgba(245,247,251,0.85)">VS</text>
  <text x="${W / 2}" y="566" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="800" fill="rgba(224,229,238,0.78)">${esc(vs.verdict.text)}</text>
</svg>`;
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { defaultFontFamily: "Arial", loadSystemFonts: true } }).render().asPng()).buffer;
};
