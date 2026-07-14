import { Resvg } from "@resvg/resvg-js";
import { generate, TIER_RGB } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";
import type { ProfileData } from "./profile";

type Profile = NonNullable<ProfileData>;
type RGB = [number, number, number];

const WIDTH = 1200;
const HEIGHT = 630;

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatCompact = (n: number) => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`;
  return n.toLocaleString("en-US");
};

const rgb = ([r, g, b]: RGB, alpha = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

const stat = (label: string, value: string, x: number, y: number) => `
  <g transform="translate(${x} ${y})">
    <rect width="260" height="104" rx="18" fill="rgba(8,12,18,0.58)" stroke="rgba(255,255,255,0.12)" />
    <text x="24" y="42" font-family="Inter, Arial, sans-serif" font-size="20" fill="rgba(224,229,238,0.68)" font-weight="700">${esc(label)}</text>
    <text x="24" y="80" font-family="Inter, Arial, sans-serif" font-size="36" fill="#f5f7fb" font-weight="900">${esc(value)}</text>
  </g>`;

const petProjection = (seed: string, x: number, y: number, size: number) => {
  const creature = generate(seed);
  // Render the canonical 2D pet sprite (same source the console + 3D pet use) into the frame.
  const { svg, width, height } = spriteToSvg(creature, { box: size * 0.86 });
  const ox = x + (size - width) / 2;
  const oy = y + (size - height) / 2;
  const shadow = `<ellipse cx="${x + size / 2}" cy="${y + size - 18}" rx="${size * 0.34}" ry="24" fill="rgba(0,0,0,0.32)" />`;
  const tierColor = rgb(TIER_RGB[creature.tier], 0.7);
  return `
    <g>
      <circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size * 0.49}" fill="rgba(255,255,255,0.055)" stroke="${tierColor}" stroke-width="3" />
      ${shadow}
      <g filter="url(#petGlow)" transform="translate(${ox.toFixed(2)} ${oy.toFixed(2)})">${svg}</g>
      <text x="${x + size / 2}" y="${y + size + 42}" font-family="Inter, Arial, sans-serif" text-anchor="middle" font-size="21" fill="rgba(245,247,251,0.74)" font-weight="800">${esc(creature.tier)}</text>
    </g>`;
};

const statsFor = (profile: Profile) => {
  const stats: Array<[string, string]> = [];
  if (profile.merit.downloads >= 1_000) stats.push(["npm DLs/mo", formatCompact(profile.merit.downloads)]);
  if (profile.merit.crossRepo > 0) stats.push(["cross-repo PRs", formatCompact(profile.merit.crossRepo)]);
  if (profile.merit.reviews > 0) stats.push(["PR reviews", formatCompact(profile.merit.reviews)]);
  if (profile.merit.merged > 0 && stats.length < 3) stats.push(["PRs merged", formatCompact(profile.merit.merged)]);
  if (profile.merit.substanceSampleSize >= 10 && stats.length < 3) stats.push(["substance", `${Math.round(profile.merit.substanceScore * 100)}%`]);
  if (profile.petsCount > 0 && stats.length < 3) stats.push(["pet cards", formatCompact(profile.petsCount)]);
  if (stats.length < 3) stats.push(["total level", formatCompact(profile.totalLevel)]);
  if (stats.length < 3) stats.push(["rarest pet", profile.rarestPetScore.toFixed(2)]);
  if (stats.length < 3) stats.push(["merit", formatCompact(profile.meritScore)]);
  return stats.slice(0, 3);
};

const etagSeed = (profile: Profile) => [
  profile.login,
  profile.score,
  profile.meritScore,
  profile.petsCount,
  profile.avatarSeed ?? "",
  profile.merit.lastSyncAt ? new Date(profile.merit.lastSyncAt).toISOString() : "",
].join(":");

export const profileOgEtag = (profile: Profile) => `"profile-og:${Bun.hash(etagSeed(profile)).toString(36)}"`;

export const renderProfileOgPng = (profile: Profile) => {
  const accentSeed = profile.avatarSeed ? generate(profile.avatarSeed) : null;
  const accent = accentSeed ? TIER_RGB[accentSeed.tier] : ([196, 181, 253] as RGB);
  const stats = statsFor(profile);
  const badge = profile.isAi
    ? `<rect x="82" y="76" width="156" height="38" rx="19" fill="rgba(70,210,180,0.18)" stroke="rgba(107,255,220,0.32)" />
       <text x="160" y="102" font-family="Inter, Arial, sans-serif" font-size="19" text-anchor="middle" fill="#b8fff0" font-weight="900">AI PARTICIPANT</text>`
    : "";
  const pet = profile.avatarSeed
    ? petProjection(profile.avatarSeed, 810, 112, 260)
    : `<g transform="translate(810 112)"><circle cx="130" cy="130" r="126" fill="rgba(255,255,255,0.055)" stroke="rgba(255,255,255,0.14)" stroke-width="3" /><text x="130" y="140" font-family="Inter, Arial, sans-serif" text-anchor="middle" font-size="28" fill="rgba(245,247,251,0.62)" font-weight="800">no avatar pet</text></g>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101722" />
      <stop offset="0.46" stop-color="#121a26" />
      <stop offset="1" stop-color="${hex(accent)}" stop-opacity="0.38" />
    </linearGradient>
    <radialGradient id="flare" cx="78%" cy="22%" r="70%">
      <stop offset="0" stop-color="${hex(accent)}" stop-opacity="0.58" />
      <stop offset="0.54" stop-color="${hex(accent)}" stop-opacity="0.14" />
      <stop offset="1" stop-color="#07090e" stop-opacity="0" />
    </radialGradient>
    <filter id="petGlow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="${hex(accent)}" flood-opacity="0.34" />
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#flare)" />
  <path d="M0 480 C210 390 350 650 570 540 C770 440 880 500 1200 375 L1200 630 L0 630 Z" fill="rgba(255,255,255,0.045)" />
  <rect x="46" y="46" width="1108" height="538" rx="34" fill="rgba(4,7,11,0.32)" stroke="rgba(255,255,255,0.12)" />
  ${badge}
  <text x="82" y="${profile.isAi ? 168 : 122}" font-family="Inter, Arial, sans-serif" font-size="32" fill="rgba(224,229,238,0.68)" font-weight="800">renown profile</text>
  <text x="82" y="${profile.isAi ? 238 : 192}" font-family="Inter, Arial, sans-serif" font-size="76" fill="#f5f7fb" font-weight="950">@${esc(profile.login)}</text>
  <text x="84" y="${profile.isAi ? 286 : 240}" font-family="Inter, Arial, sans-serif" font-size="28" fill="rgba(245,247,251,0.72)" font-weight="700">${esc(profile.handle)}</text>
  <text x="82" y="366" font-family="Inter, Arial, sans-serif" font-size="96" fill="${hex(accent)}" font-weight="950">${esc(formatCompact(profile.score))}</text>
  <text x="84" y="404" font-family="Inter, Arial, sans-serif" font-size="24" fill="rgba(224,229,238,0.68)" font-weight="800">score for real, meritorious dev work</text>
  ${stats.map(([label, value], i) => stat(label, value, 82 + i * 286, 444)).join("")}
  ${pet}
  <text x="1118" y="534" font-family="Inter, Arial, sans-serif" text-anchor="end" font-size="27" fill="#f5f7fb" font-weight="950">Renown</text>
  <text x="1118" y="562" font-family="Inter, Arial, sans-serif" text-anchor="end" font-size="18" fill="rgba(224,229,238,0.58)" font-weight="800">XP and renown for real dev work</text>
</svg>`;

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    font: {
      defaultFontFamily: "Arial",
      loadSystemFonts: true,
    },
  }).render().asPng();
  return new Uint8Array(png).buffer;
};
