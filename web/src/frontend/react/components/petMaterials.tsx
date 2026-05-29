// Procedural shader for every pet voxel — branches on the creature's `pattern` + `aura`
// traits (already drawn by core/procgen) to give each creature a visibly distinct treatment.
// Same trait combo → same material every time (deterministic).
//
// Patterns: plain · spots · stripes · scales · runes · cosmic · chromatic(1/1 only)
// Auras:    none  · glow  · sparkle · flame  · frost · void   · rainbow
// On top of those, Mythic / Eldritch / 1-of-1 get a vertex-displacement distort.
// "everyone gets a base material; rarer pets get more going on."
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { RGB } from "../../../../../core/shiny.ts";
import type { Creature } from "../../../../../core/procgen";

const PATTERN_MAP: Record<string, number> = { plain: 0, spots: 1, stripes: 2, scales: 3, runes: 4, cosmic: 5 };
const AURA_MAP: Record<string, number> = { none: 0, glow: 1, sparkle: 2, flame: 3, frost: 4, void: 5, rainbow: 6 };

// Shared GLSL — uniforms swap per pet, source is one compiled program (three.js dedupes).
// USE_VCOL define is set when the material is used on a MERGED body geometry (one mesh per
// pet instead of N per-voxel meshes) — per-voxel base color rides on a `voxColor` attribute.
const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uDistort;
  uniform float uBurst;        // 0..1 — periodic flourish that triples warp amplitude briefly
  uniform int   uWarpMode;     // 0=none 1=breathing 2=wave 3=chaos
  #ifdef USE_VCOL
    attribute vec3 voxColor;
  #endif
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vBaseColor;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    #ifdef USE_VCOL
      vBaseColor = voxColor;
    #else
      vBaseColor = vec3(1.0);
    #endif
    vec3 pos = position;
    // Light per-voxel ripple — applies on top of warp modes for any pet with distort > 0.
    if (uDistort > 0.0) {
      float w = sin(uTime * 2.4 + position.x * 4.0 + position.y * 3.3 + position.z * 2.0);
      pos += normal * w * 0.06 * uDistort;
    }
    // Tier-escalating vertex displacement: Legendary breathes, Mythic waves, 1-of-1 chaos.
    // Burst (periodic flourish) triples the warp amplitude for ~0.4s — "show off" moment.
    float warpAmp = 1.0 + uBurst * 2.0;
    if (uWarpMode == 1) {
      // BREATHING — slow normal-direction expansion in waves
      pos += normal * sin(uTime * 1.4 + position.y * 2.5) * 0.05 * warpAmp;
    } else if (uWarpMode == 2) {
      // WAVE — orthogonal sine waves on each axis, pronounced
      pos.x += sin(uTime * 2.0 + position.y * 3.5) * 0.08 * warpAmp;
      pos.y += sin(uTime * 1.7 + position.x * 3.0 + position.z * 2.0) * 0.08 * warpAmp;
      pos.z += sin(uTime * 2.3 + position.x * 2.7) * 0.06 * warpAmp;
    } else if (uWarpMode == 3) {
      // CHAOS — multiple high-freq sines + normal-direction noise. Body LITERALLY morphs.
      pos += normal * sin(uTime * 4.5 + position.x * 5.0 + position.y * 3.0) * 0.14 * warpAmp;
      pos.x += cos(uTime * 3.7 + position.y * 6.0) * 0.10 * warpAmp;
      pos.y += sin(uTime * 4.1 + position.x * 5.5 + position.z * 4.0) * 0.10 * warpAmp;
      pos.z += cos(uTime * 3.3 + position.y * 7.0 + position.x * 3.0) * 0.08 * warpAmp;
    }
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3  uColor;          // fallback if not using vertex colors
  uniform vec3  uColor2;
  uniform int   uPattern;
  uniform int   uAura;
  uniform float uEmissive;
  uniform float uMetal;
  uniform float uUseVcol;        // 1.0 = use the per-voxel base color from the vertex stream
  uniform float uBurst;          // 0..1 — same flourish as vertex; lifts emissive + tints chromatic
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vBaseColor;

  // hash + 2D value noise — cheap, dependency-free.
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  vec3 hsv2rgb(float h, float s, float v) {
    vec3 K = vec3(1.0, 2.0/3.0, 1.0/3.0);
    vec3 p = abs(fract(vec3(h) + K) * 6.0 - 3.0);
    return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
  }

  void main() {
    vec3 col = mix(uColor, vBaseColor, uUseVcol);

    // ── Pattern (uPattern 0-6) ───────────────────────────────────
    if (uPattern == 1) {                                       // spots
      float n = noise(vUv * 7.0 + vWorldPos.xy);
      col = mix(col, uColor2, smoothstep(0.45, 0.7, n));
    } else if (uPattern == 2) {                                // stripes (gently animated)
      col = mix(uColor, uColor2, step(0.5, fract(vUv.y * 4.5 + sin(uTime * 0.4 + vUv.x * 2.0) * 0.25)));
    } else if (uPattern == 3) {                                // hex scales
      vec2 q = vUv * vec2(6.5, 5.0);
      q.x += step(0.5, fract(q.y)) * 0.5;
      float d = length(fract(q) - 0.5);
      col = mix(uColor2 * 0.7, uColor, smoothstep(0.32, 0.5, d));
    } else if (uPattern == 4) {                                // runes — glowing glyph patches
      float n = noise(vUv * 4.0 + uTime * 0.25);
      if (n > 0.72) col += hsv2rgb(n + 0.15, 0.85, 1.4) * 0.7;
    } else if (uPattern == 5) {                                // cosmic — nebula + twinkles
      col = uColor * 0.25 + uColor2 * 0.25 * (1.0 - vUv.y);
      float h = hash21(floor(vUv * 14.0 + vWorldPos.xy * 8.0));
      if (h > 0.86) col += vec3(0.5 + 0.5 * sin(uTime * 3.0 + h * 6.28));
    } else if (uPattern == 6) {                                // chromatic — reserved for 1-of-1, wild
      vec2 q = vUv - 0.5;
      float r = length(q);
      float a = atan(q.y, q.x);
      // base rainbow swirl pulled outward by radius
      col = hsv2rgb(a * 0.159 + uTime * 0.3 + r * 1.5, 1.0, 1.0);
      // iridescent fresnel layered on
      float fres = pow(1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0))), 1.8);
      col += hsv2rgb(uTime * 0.45 + fres, 0.9, 1.0) * fres * 0.7;
      // CRT-style scanline glitch
      float glitch = step(0.96, fract(vUv.y * 32.0 + uTime * 9.0));
      col = mix(col, vec3(1.0) - col, glitch * 0.6);
      // hot edge ring around the center
      col += vec3(smoothstep(0.45, 0.5, r) * 0.6);
    } else if (uPattern == 7) {                                // voronoi — alien cell pattern (Eldritch)
      vec2 vq = vUv * 5.0;
      vec2 vi = floor(vq), vf = fract(vq);
      float minD = 8.0;
      for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
        vec2 n = vec2(float(xx), float(yy));
        vec2 pp = vec2(hash21(vi + n), hash21(vi + n + vec2(11.0, 17.0)));
        pp = 0.5 + 0.5 * sin(uTime * 0.6 + 6.28 * pp);
        minD = min(minD, length(n + pp - vf));
      }
      col = mix(uColor2 * 0.45, uColor, smoothstep(0.0, 0.5, minD));
      col += uColor2 * (1.0 - smoothstep(0.0, 0.06, minD)) * 0.8;   // bright cell-edge glow
    } else if (uPattern == 8) {                                // HOLOGRAPHIC FOIL — Construct
      // angle-dependent iridescence: facets shift color as the camera moves.
      float angle = dot(vNormal, vec3(0.4, 0.8, 0.6));
      vec3 iri = hsv2rgb(angle * 0.6 + uTime * 0.15 + vUv.y * 0.3, 0.85, 1.0);
      col = mix(uColor * 0.4, iri, 0.85);
      float g = step(0.5, fract(vUv.x * 12.0 + uTime * 0.2)) * step(0.5, fract(vUv.y * 12.0));
      col += g * 0.35;                                          // foil grid overlay
    } else if (uPattern == 9) {                                // NEON GRID — Sprite
      vec2 g = abs(fract(vUv * 9.0) - 0.5);
      float line = min(g.x, g.y);
      float glow = exp(-line * 28.0);
      col = uColor * 0.18;
      vec3 neon = hsv2rgb(0.55 + sin(uTime * 0.6) * 0.1, 1.0, 1.0);
      col += neon * glow * 1.8;                                 // bright grid lines for bloom to catch
    } else if (uPattern == 10) {                               // OIL SLICK — Slime
      float fres = pow(1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.2);
      float n = noise(vUv * 3.5 + uTime * 0.18);
      float h = fract(fres + n * 0.5 + uTime * 0.08);
      col = hsv2rgb(h, 0.85, 0.95);
      col = mix(col, uColor, 0.18);                             // tint toward palette
    }

    // ── Aura overlay (uAura 0-6) ─────────────────────────────────
    if (uAura == 1) {                                          // glow
      col += uColor * 0.45;
    } else if (uAura == 2) {                                   // sparkle
      float h = hash21(floor(vUv * 18.0));
      if (h > 0.92) {
        float t = sin(uTime * 5.0 + h * 6.28) * 0.5 + 0.5;
        col += vec3(t * t);
      }
    } else if (uAura == 3) {                                   // flame — fire shader overlay
      vec3 fire = mix(vec3(1.0, 0.25, 0.0), vec3(1.0, 0.95, 0.4), pow(vUv.y, 2.4));
      float n = noise(vUv * 5.0 + vec2(0.0, uTime * 1.6));
      col = mix(col, fire * (0.45 + n * 0.7), 0.5);
    } else if (uAura == 4) {                                   // frost — crystalline cyan
      float crystal = abs(sin(vUv.x * 14.0 + uTime * 0.4) * cos(vUv.y * 16.0));
      col = mix(col, vec3(0.75, 0.9, 1.0), crystal * 0.55);
    } else if (uAura == 5) {                                   // void — dark with edge glow
      col *= 0.45;
      col += vec3(0.18, 0.05, 0.32) * (0.6 + 0.4 * sin(uTime * 1.2 + vUv.x * 8.0));
    } else if (uAura == 6) {                                   // rainbow — animated HSV
      col = hsv2rgb(fract(vUv.x * 0.3 + vUv.y * 0.4 + uTime * 0.22), 0.95, 1.0);
    }

    // ── Soft directional lighting (no scene Environment needed) ──
    vec3 light = normalize(vec3(0.4, 0.9, 0.7));
    float diff = max(0.55, dot(vNormal, light));
    col *= diff;
    // Specular fake — fresnel-ish rim for metallic feel on rarer tiers.
    if (uMetal > 0.1) {
      float rim = pow(1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.5);
      col += rim * uMetal * vec3(1.0);
    }
    col += col * uEmissive;
    // Burst overlay: temporarily blend a hue-shifted iridescent layer + emissive boost.
    if (uBurst > 0.0) {
      vec3 glitch = hsv2rgb(fract(uTime * 4.0 + vUv.x * 3.0 + vUv.y * 2.0), 1.0, 1.4);
      col = mix(col, glitch, uBurst * 0.4);
      col *= 1.0 + uBurst * 0.6;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const cssToVec = (rgb: RGB) => new THREE.Color(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);

export const ProceduralMat = ({ creature, color, useVertexColor = false, warpMode = 0, burstRef }: { creature: Creature; color: RGB; useVertexColor?: boolean; warpMode?: number; burstRef?: { current: { value: number } } }) => {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  // Trait → uniform mapping is deterministic. 1-of-1 hijacks to "chromatic"; a few species
  // claim signature shaders (Eldritch=voronoi cells, Construct=holographic foil, Sprite=neon
  // grid, Slime=oil-slick iridescence). Otherwise the creature's pattern trait wins.
  const pattern = creature.oneOfOne ? 6
    : creature.traits.species === "Eldritch" ? 7
    : creature.traits.species === "Construct" ? 8
    : creature.traits.species === "Sprite" ? 9
    : creature.traits.species === "Slime" ? 10
    : PATTERN_MAP[creature.traits.pattern] ?? 0;
  // Mythic forces rainbow aura on top of whatever the trait was — keeps the existing
  // "mythic = rainbow" feel from the ASCII renderer.
  const aura = creature.mythicAura ? 6 : AURA_MAP[creature.traits.aura] ?? 0;
  const distort = creature.mythicAura ? 1.0
    : creature.oneOfOne ? 1.2
    : creature.traits.species === "Eldritch" ? 0.7
    : 0;
  const metal = creature.tier === "Legendary" ? 0.6
    : creature.tier === "Mythic" ? 0.8
    : creature.traits.species === "Construct" ? 0.5
    : 0;
  const emissive = creature.tier === "Mythic" ? 0.35
    : creature.tier === "Legendary" ? 0.18
    : creature.traits.aura === "glow" ? 0.25 : 0.05;

  const uniforms = useMemo(() => ({
    uAura: { value: aura },
    uBurst: { value: 0 },
    uColor: { value: cssToVec(color) },
    uColor2: { value: cssToVec(creature.palette[1]) },
    uDistort: { value: distort },
    uEmissive: { value: emissive },
    uMetal: { value: metal },
    uPattern: { value: pattern },
    uTime: { value: 0 },
    uUseVcol: { value: useVertexColor ? 1.0 : 0.0 },
    uWarpMode: { value: warpMode },
  }), [color, creature.palette, aura, distort, emissive, metal, pattern, useVertexColor, warpMode]);

  useFrame((state) => {
    if (!matRef.current) return;
    matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    matRef.current.uniforms.uBurst.value = burstRef?.current?.value ?? 0;
  });

  const defines = useMemo(() => (useVertexColor ? { USE_VCOL: "" } : undefined), [useVertexColor]);
  return <shaderMaterial ref={matRef} vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} defines={defines} />;
};
