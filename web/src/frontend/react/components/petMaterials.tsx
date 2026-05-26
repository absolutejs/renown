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
import type { Creature, RGB } from "../../../../../core/procgen";

const PATTERN_MAP: Record<string, number> = { plain: 0, spots: 1, stripes: 2, scales: 3, runes: 4, cosmic: 5 };
const AURA_MAP: Record<string, number> = { none: 0, glow: 1, sparkle: 2, flame: 3, frost: 4, void: 5, rainbow: 6 };

// Shared GLSL — uniforms swap per pet, source is one compiled program (three.js dedupes).
const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uDistort;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec3 pos = position;
    if (uDistort > 0.0) {
      // Mythic / Eldritch / 1-of-1 — surface ripples on top of the voxel cubes.
      float w = sin(uTime * 2.4 + position.x * 4.0 + position.y * 3.3 + position.z * 2.0);
      pos += normal * w * 0.06 * uDistort;
    }
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3  uColor;
  uniform vec3  uColor2;
  uniform int   uPattern;
  uniform int   uAura;
  uniform float uEmissive;
  uniform float uMetal;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

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
    vec3 col = uColor;

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
    } else if (uPattern == 6) {                                // chromatic — reserved for 1-of-1
      vec2 q = vUv - 0.5;
      float r = length(q);
      float a = atan(q.y, q.x);
      col = hsv2rgb(a * 0.159 + uTime * 0.2 + r * 1.2, 1.0, 1.0);
      col *= 1.0 - r * 0.35;
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
    gl_FragColor = vec4(col, 1.0);
  }
`;

const cssToVec = (rgb: RGB) => new THREE.Color(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);

export const ProceduralMat = ({ creature, color }: { creature: Creature; color: RGB }) => {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  // Trait → uniform mapping is deterministic; 1-of-1 hijacks pattern to "chromatic".
  const pattern = creature.oneOfOne ? 6 : PATTERN_MAP[creature.traits.pattern] ?? 0;
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
    uColor: { value: cssToVec(color) },
    uColor2: { value: cssToVec(creature.palette[1]) },
    uDistort: { value: distort },
    uEmissive: { value: emissive },
    uMetal: { value: metal },
    uPattern: { value: pattern },
    uTime: { value: 0 },
  }), [color, creature.palette, aura, distort, emissive, metal, pattern]);

  useFrame((state) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return <shaderMaterial ref={matRef} vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} />;
};
