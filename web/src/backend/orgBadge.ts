// README badge for a whole org — the org counterpart to projectBadge.ts. An org embeds
// [![renown](.../org/<owner>/badge.svg)](.../org/<owner>) to advertise its collective renown.
// Carries the org's top contributor's pet next to the wordmark, then repos · devs · top login.
// Pure rects/circles, no <defs>/IDs → composes cleanly and survives GitHub's camo rasterizer.
import { generate } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";
import type { OrgData } from "./org.ts";

type Org = NonNullable<OrgData>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textWidth = (s: string) => [...s].reduce((w, c) => w + (/[A-Z0-9@%]/.test(c) ? 7.4 : /[ .,:'!|ilj]/.test(c) ? 3.4 : 6.5), 0);
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));

export const orgBadgeEtag = (g: Org) =>
  `"orgbadge:${Bun.hash(`${g.owner}:${g.topContributor?.login ?? ""}:${g.topContributor?.avatarSeed ?? ""}:${g.totals.repos}:${g.totals.devs}:${g.totals.xp}`).toString(36)}"`;

export const renderOrgBadge = (g: Org): string => {
  const H = 28, PAD = 8, GAP = 6, ACCENT = "#8b5cf6";
  const label = "renown";
  const top = g.topContributor;

  let petFrag = "", petW = 0;
  if (top?.avatarSeed) {
    const pet = spriteToSvg(generate(top.avatarSeed), { box: H - 6 });
    petW = pet.width;
    const py = (H - pet.height) / 2;
    petFrag = `<g transform="translate(${PAD},${py.toFixed(1)})">${pet.svg}</g>`;
  }

  const stat = `${g.totals.repos} repo${g.totals.repos === 1 ? "" : "s"} · ${fmt(g.totals.xp)} renown`;
  const msg = top ? `${stat} · @${top.login}` : (g.totals.devs > 0 ? stat : "be the first");
  const labelX = PAD + (petW ? petW + GAP : 0);
  const lw = Math.ceil(labelX + textWidth(label) + PAD);
  const mw = Math.ceil(textWidth(msg) + PAD * 2);
  const W = lw + mw;
  const ty = (H / 2 + 3.8).toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="renown: ${esc(g.owner)} ${esc(msg)}">
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
