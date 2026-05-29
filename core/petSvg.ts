// 2D SVG engine for the canonical pet sprite. Renders the shared `spriteCells` structure
// (see core/procgen.ts) to an SVG fragment — the SAME source of truth the ANSI console and
// the 3D voxelizer consume, so the flat pet can't drift from the terminal or in-app pet.
// Used by the OG image (web/src/backend/ogImage.ts) and available to the frontend.
import { type Creature, spriteCells } from "./procgen.ts";
import type { RGB } from "./shiny.ts";

const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;

export type PetSvgOptions = {
  // Box (px) the pet is fitted into; the returned width/height are the actual drawn size.
  box: number;
  // Cell width / cell height. ~0.58 mirrors the terminal's ~1:2 character cell, which is why
  // the pet reads as a creature (not a wide slab) in a square-celled medium.
  aspect?: number;
};

export type PetSvg = { svg: string; width: number; height: number };

// Returns an SVG fragment (no <svg> wrapper) drawn from the origin (0,0). The caller
// positions it via a parent <g transform>. width/height are the fitted pixel dimensions.
export const spriteToSvg = (c: Creature, options: PetSvgOptions): PetSvg => {
  const aspect = options.aspect ?? 0.58;
  const sp = spriteCells(c);
  const cellH = Math.min(options.box / sp.h, options.box / (sp.w * aspect));
  const cellW = cellH * aspect;
  const width = sp.w * cellW, height = sp.h * cellH;
  const ov = Math.max(1.2, cellW * 0.14); // overlap to eliminate pinhole gaps between cells
  const isHalo = c.traits.crest === "halo";

  // The halo is emitted by buildCrest as a ring of cells; the 2D engine upgrades it to a
  // clean ellipse positioned at the ring cells' bounding box (3D/console render it blocky).
  let halo: { cx: number; cy: number; rx: number; ry: number } | null = null;
  if (isHalo) {
    const ring = sp.cells.filter((k) => k.kind === "crest");
    if (ring.length) {
      const xs = ring.map((k) => k.x), ys = ring.map((k) => k.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      halo = {
        cx: ((x0 + x1 + 1) / 2) * cellW,
        cy: ((y0 + y1 + 1) / 2) * cellH,
        rx: ((x1 - x0 + 1) / 2) * cellW * 1.05,
        ry: Math.max(cellH * 0.42, ((y1 - y0 + 1) / 2) * cellH * 0.7),
      };
    }
  }

  const parts: string[] = [];
  const block = (x: number, y: number, color: RGB) =>
    `<rect x="${(x - ov / 2).toFixed(2)}" y="${(y - ov / 2).toFixed(2)}" width="${(cellW + ov).toFixed(2)}" height="${(cellH + ov).toFixed(2)}" fill="${hex(color)}"/>`;

  for (const v of sp.cells) {
    const x = v.x * cellW, y = v.y * cellH;
    if (v.kind === "crest") {
      if (isHalo) continue; // drawn as a single ellipse below
      parts.push(block(x, y, v.color));
    } else if (v.kind === "body") {
      parts.push(block(x, y, v.color));
    } else if (v.kind === "eye") {
      const s = Math.min(cellW, cellH) * 1.15, cx = x + cellW / 2, cy = y + cellH * 0.5;
      parts.push(
        `<rect x="${(cx - s / 2).toFixed(2)}" y="${(cy - s / 2).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" rx="${(s * 0.32).toFixed(2)}" fill="${hex(v.color)}"/>` +
        `<circle cx="${cx.toFixed(2)}" cy="${(cy + s * 0.06).toFixed(2)}" r="${(s * 0.24).toFixed(2)}" fill="#14161d"/>` +
        `<circle cx="${(cx - s * 0.13).toFixed(2)}" cy="${(cy - s * 0.13).toFixed(2)}" r="${(s * 0.09).toFixed(2)}" fill="#ffffff" fill-opacity="0.9"/>`,
      );
    } else if (v.kind === "mouth") {
      const mw = cellW * 1.3, mh = cellH * 0.5, cx = x + cellW / 2, cy = y + cellH * 0.55;
      parts.push(`<rect x="${(cx - mw / 2).toFixed(2)}" y="${(cy - mh / 2).toFixed(2)}" width="${mw.toFixed(2)}" height="${mh.toFixed(2)}" rx="${(mh * 0.4).toFixed(2)}" fill="#14161d"/>`);
    } else if (v.kind === "spark") {
      parts.push(`<text x="${(x + cellW / 2).toFixed(2)}" y="${(y + cellH * 0.82).toFixed(2)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${cellH.toFixed(1)}" fill="${hex(v.color)}">✦</text>`);
    }
  }
  if (halo) {
    const sw = Math.max(2.4, cellH * 0.22);
    parts.push(`<ellipse cx="${halo.cx.toFixed(2)}" cy="${halo.cy.toFixed(2)}" rx="${halo.rx.toFixed(2)}" ry="${halo.ry.toFixed(2)}" fill="none" stroke="#fff0aa" stroke-width="${sw.toFixed(2)}"/>`);
  }

  return { svg: parts.join(""), width, height };
};
