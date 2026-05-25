// Shiny — 24-bit truecolor toolkit for the HUD + celebrations. Gradients for everyday
// polish; full per-character rainbow reserved for the rarest tiers so "rare" actually
// looks rare. Iterates by grapheme (Intl.Segmenter) so emoji stay intact under color.
export type RGB = [number, number, number];
export const R = "\x1b[0m";
export const B = "\x1b[1m";

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text: string) => [...seg.segment(text)].map((g) => g.segment);
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

export const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r | 0};${g | 0};${b | 0}m`;

const hsvToRgb = (h: number, s = 1, v = 1): RGB => {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};

// per-character rainbow; advance `phase` (0..1) across frames to scroll it (animation)
export const rainbow = (text: string, phase = 0, spread = 0.09) =>
  graphemes(text).map((ch, i) => fg(...hsvToRgb((((phase + i * spread) % 1) + 1) % 1)) + ch).join("") + R;

// smooth two-colour gradient across the text
export const gradient = (text: string, a: RGB, b: RGB) => {
  const gs = graphemes(text), n = Math.max(1, gs.length - 1);
  return gs.map((ch, i) => fg(lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n), lerp(a[2], b[2], i / n)) + ch).join("") + R;
};

// a bright highlight at `pos` over a base colour; sweep `pos` across frames to shimmer
export const shimmer = (text: string, pos: number, base: RGB = [245, 205, 90]) =>
  graphemes(text).map((ch, i) => (Math.abs(i - pos) <= 1 ? fg(255, 255, 255) : fg(...base)) + ch).join("") + R;

// a partial gradient bar (filled portion gradients a→b, empty is dim)
export const gradientBar = (pct: number, width: number, a: RGB = [196, 181, 253], b: RGB = [240, 171, 252]) => {
  const f = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return gradient("▓".repeat(f), a, b) + `\x1b[38;2;90;90;110m${"░".repeat(width - f)}${R}`;
};
