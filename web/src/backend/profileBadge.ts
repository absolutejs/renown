// Per-user README badge — the individual counterpart to the per-repo badge (projectBadge.ts).
// A dev embeds it in their profile/repo README to advertise their renown:
//   [![renown](.../profile/<login>/badge.svg)](.../profile/<login>)
// Carries their 1/1 pet (the signature sprite, same source as the OG card + 3D viewer) next to
// the wordmark, then their score + total level. Pure rects/circles, no <defs>/IDs, so it
// composes cleanly and survives GitHub's camo rasterizer (hence no emoji in the text).
import { generate } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";
import type { ProfileData } from "./profile";

type Profile = NonNullable<ProfileData>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textWidth = (s: string) => [...s].reduce((w, c) => w + (/[A-Z0-9@%]/.test(c) ? 7.4 : /[ .,:'!|ilj]/.test(c) ? 3.4 : 6.5), 0);
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));

export const profileBadgeEtag = (p: Profile) =>
  `"profbadge:${Bun.hash(`${p.login}:${p.avatarSeed ?? ""}:${p.score}:${p.totalLevel}`).toString(36)}"`;

export const renderProfileBadge = (p: Profile): string => {
  const H = 28, PAD = 8, GAP = 6, ACCENT = "#8b5cf6";   // renown purple
  const label = "renown";

  // The player's identity pet, fitted to the bar height and centered in the dark segment.
  let petFrag = "", petW = 0;
  if (p.avatarSeed) {
    const pet = spriteToSvg(generate(p.avatarSeed), { box: H - 6 });
    petW = pet.width;
    const py = (H - pet.height) / 2;
    petFrag = `<g transform="translate(${PAD},${py.toFixed(1)})">${pet.svg}</g>`;
  }

  const msg = `${fmt(p.score)} renown · L${p.totalLevel}`;
  const labelX = PAD + (petW ? petW + GAP : 0);
  const lw = Math.ceil(labelX + textWidth(label) + PAD);
  const mw = Math.ceil(textWidth(msg) + PAD * 2);
  const W = lw + mw;
  const ty = (H / 2 + 3.8).toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="renown: @${esc(p.login)} ${esc(msg)}">
  <linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${W}" height="${H}" rx="4" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${H}" fill="#2b2540"/>
    <rect x="${lw}" width="${mw}" height="${H}" fill="${ACCENT}"/>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
  </g>
  ${petFrag}
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
    <text x="${(labelX + textWidth(label) / 2).toFixed(1)}" y="${ty}" font-weight="bold">${esc(label)}</text>
    <text x="${(lw + mw / 2).toFixed(1)}" y="${ty}">${esc(msg)}</text>
  </g>
</svg>`;
};
