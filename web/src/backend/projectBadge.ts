// README badge for a repo's renown — a self-contained shields-style flat SVG (server-only, no
// React, no deps). Repos embed it: [![renown](.../project/owner/repo/badge.svg)](.../project/owner/repo)
// → every repo that adds it advertises renown to anyone viewing the repo. Kept ASCII-safe (no
// emoji) so GitHub's camo rasterizer renders it reliably.
import type { ProjectData } from "./project.ts";

type Project = NonNullable<ProjectData>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Rough per-char width at 11px (Verdana-ish): caps/digits wide, punctuation narrow, rest medium.
const textWidth = (s: string) => [...s].reduce((w, c) => w + (/[A-Z0-9@%]/.test(c) ? 7.4 : /[ .,:'!|ilj]/.test(c) ? 3.4 : 6.5), 0);

export const projectBadgeEtag = (p: Project) => `"pbadge:${Bun.hash(`${p.key}:${p.topContributor?.login ?? ""}:${p.totals.devs}`).toString(36)}"`;

export const renderProjectBadge = (p: Project): string => {
  const H = 20, PAD = 8, ACCENT = "#8b5cf6";   // renown purple
  const label = "renown";
  const top = p.topContributor;
  const msg = top
    ? `@${top.login}${p.totals.devs > 1 ? ` +${p.totals.devs - 1}` : ""}`
    : `${p.totals.devs} dev${p.totals.devs === 1 ? "" : "s"}`;
  const lw = Math.ceil(textWidth(label) + PAD * 2);
  const mw = Math.ceil(textWidth(msg) + PAD * 2);
  const W = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="renown: ${esc(msg)}">
  <linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${W}" height="${H}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${H}" fill="#555"/>
    <rect x="${lw}" width="${mw}" height="${H}" fill="${ACCENT}"/>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
    <text x="${(lw / 2).toFixed(1)}" y="14">${esc(label)}</text>
    <text x="${(lw + mw / 2).toFixed(1)}" y="14">${esc(msg)}</text>
  </g>
</svg>`;
};
