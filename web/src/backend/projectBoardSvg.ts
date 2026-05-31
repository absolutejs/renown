// Embeddable mini-leaderboard — a live top-N board SVG for a repo's README. Bigger than the
// single badge: shows the actual contributor competition (rank · pet · @login · renown) inline,
// so a repo that embeds it advertises renown with a real board. Verified (GitHub-scored) renown
// is shown green; self-reported is muted. Pure rects/circles/text (no <defs> beyond a clip, no
// foreignObject/external refs) so it survives GitHub's camo rasterizer — hence no emoji.
import { generate } from "../../../core/procgen.ts";
import { spriteToSvg } from "../../../core/petSvg.ts";
import type { ProjectData } from "./project.ts";

type Project = NonNullable<ProjectData>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const trunc = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export const projectBoardEtag = (p: Project, limit: number) =>
  `"pboard:${limit}:${Bun.hash(p.contributors.slice(0, limit).map((c) => `${c.login}:${c.xp}:${c.verified}`).join("|") + `:${p.totals.devs}`).toString(36)}"`;

export const renderProjectBoardSvg = (p: Project, limit = 5): string => {
  const W = 408, HEAD = 46, ROW = 34, FOOT = 28, PAD = 16;
  const rows = p.contributors.slice(0, Math.max(1, Math.min(10, limit)));
  const H = HEAD + rows.length * ROW + FOOT;
  const ACCENT = "#8b5cf6";

  const rowSvg = rows.map((c, i) => {
    const cy = HEAD + i * ROW + ROW / 2;
    const rank = `${i + 1}`;
    let pet = "";
    if (c.avatarSeed) {
      const s = spriteToSvg(generate(c.avatarSeed), { box: 24 });
      pet = `<g transform="translate(${(40 - s.width / 2).toFixed(1)},${(cy - s.height / 2).toFixed(1)})">${s.svg}</g>`;
    }
    const name = `@${trunc(c.login, 22)}${c.isAi ? " (ai)" : ""}`;
    const xpColor = c.verified ? "#86efac" : "#cfd6e4";   // green = GitHub-verified, muted = self-reported
    return `
    <text x="22" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="#8b93a7" font-weight="700">${rank}</text>
    ${pet}
    <text x="62" y="${(cy + 4).toFixed(1)}" font-size="13" fill="#e7ebf3" font-weight="600">${esc(name)}</text>
    <text x="${W - PAD}" y="${(cy + 4).toFixed(1)}" text-anchor="end" font-size="13" fill="${xpColor}" font-weight="800" font-family="Verdana,DejaVu Sans,sans-serif">${fmt(c.xp)}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="renown leaderboard for ${esc(p.key)}" font-family="Verdana,DejaVu Sans,Geneva,sans-serif">
  <clipPath id="r"><rect width="${W}" height="${H}" rx="10"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${W}" height="${H}" fill="#12141c"/>
    <rect width="${W}" height="${HEAD}" fill="#1b1830"/>
    <rect width="4" height="${H}" fill="${ACCENT}"/>
  </g>
  <text x="${PAD}" y="20" font-size="13" fill="${ACCENT}" font-weight="900">renown</text>
  <text x="${PAD}" y="38" font-size="12" fill="#9aa3b6" font-weight="700">${esc(trunc(p.key, 34))}</text>
  <text x="${W - PAD}" y="20" text-anchor="end" font-size="11" fill="#8b93a7" font-weight="700">${p.totals.devs} dev${p.totals.devs === 1 ? "" : "s"}</text>
  <text x="${W - PAD}" y="38" text-anchor="end" font-size="11" fill="#8b93a7" font-weight="700">${fmt(p.totals.xp)} renown</text>
  ${rowSvg}
  <text x="${PAD}" y="${H - 10}" font-size="10.5" fill="#6b7489" font-weight="700">green = GitHub-verified</text>
  <text x="${W - PAD}" y="${H - 10}" text-anchor="end" font-size="10.5" fill="#6b7489" font-weight="800">★ Renown</text>
</svg>`;
};
