// README badge for a repo's renown — a self-contained shields-style flat SVG (server-only, no
// React, no deps). Repos embed it: [![renown](.../project/owner/repo/badge.svg)](.../project/owner/repo)
// → every repo that adds it advertises renown to anyone viewing the repo.
//
// Richer than a plain pill: the left segment carries the top contributor's actual 1/1 pet (the
// signature renown sprite, the same one the OG card + 3D viewer render) next to the wordmark,
// and the right segment shows live devs · XP · top login. The pet is pure rects/circles/ellipses
// with no <defs>/IDs, so it composes into the badge without collisions and survives GitHub's
// camo rasterizer (which is why we still avoid emoji in the text).
import { generate } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";
import type { ProjectData } from "./project.ts";

type Project = NonNullable<ProjectData>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Rough per-char width at 11px (Verdana-ish): caps/digits wide, punctuation narrow, rest medium.
const textWidth = (s: string) => [...s].reduce((w, c) => w + (/[A-Z0-9@%]/.test(c) ? 7.4 : /[ .,:'!|ilj]/.test(c) ? 3.4 : 6.5), 0);
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));

export const projectBadgeEtag = (p: Project) =>
  `"pbadge:${Bun.hash(`${p.key}:${p.topContributor?.login ?? ""}:${p.topContributor?.avatarSeed ?? ""}:${p.totals.devs}:${p.totals.xp}`).toString(36)}"`;

export const renderProjectBadge = (p: Project): string => {
  const H = 28, PAD = 8, GAP = 6, ACCENT = "#8b5cf6";   // renown purple
  const label = "renown";
  const top = p.topContributor;

  // Top contributor's pet, fitted into the bar height and vertically centered in the dark segment.
  let petFrag = "", petW = 0;
  if (top?.avatarSeed) {
    const pet = spriteToSvg(generate(top.avatarSeed), { box: H - 6 });
    petW = pet.width;
    const py = (H - pet.height) / 2;
    petFrag = `<g transform="translate(${PAD},${py.toFixed(1)})">${pet.svg}</g>`;
  }

  const stat = `${p.totals.devs} dev${p.totals.devs === 1 ? "" : "s"} · ${fmt(p.totals.xp)} XP`;
  const msg = top ? `${stat} · @${top.login}` : (p.totals.devs > 0 ? stat : "be the first");

  const labelX = PAD + (petW ? petW + GAP : 0);                 // wordmark starts after the pet
  const lw = Math.ceil(labelX + textWidth(label) + PAD);        // dark segment width
  const mw = Math.ceil(textWidth(msg) + PAD * 2);               // accent segment width
  const W = lw + mw;
  const ty = (H / 2 + 3.8).toFixed(1);                          // text baseline

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="renown: ${esc(msg)}">
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
