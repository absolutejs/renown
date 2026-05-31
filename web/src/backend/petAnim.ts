// Wraps a pet sprite fragment in a gentle, script-free idle bob (SMIL animateTransform). Chromium
// (VS Code webviews, and SVGs referenced via <img>) animate it; GitHub's camo rasterizer flattens
// to the first frame (values start at "0 0"), so the same SVG stays safe to embed in a README.
// `delaySec` staggers multiple pets so a roster doesn't bob in lockstep.
export const idleBob = (fragment: string, delaySec = 0): string =>
  `<g>${fragment}<animateTransform attributeName="transform" type="translate" values="0 0;0 -3.2;0 0" keyTimes="0;0.5;1" dur="2.6s" begin="${delaySec.toFixed(2)}s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/></g>`;
