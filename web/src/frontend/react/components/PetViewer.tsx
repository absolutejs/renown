// 3D pet viewer — the procgen ASCII creature lives in three.js with real materials/lights.
// Each voxel = one filled ASCII cell; tier drives the shader treatment (Legendary → metallic
// + shimmer, Mythic → distort + rainbow). Drei: OrbitControls/Float/Environment/Sparkles.
// react-spring/three: entry scale animation. Same seeded procgen — server and client render
// the SAME creature from the SAME commit SHA.
import { Environment, Float, MeshReflectorMaterial, MeshTransmissionMaterial, OrbitControls, PerspectiveCamera, Sparkles, Stars, Stats, Trail, View } from "@react-three/drei";
import { Canvas, useFrame, type ThreeElements } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { animated, useSpring } from "@react-spring/three";
import { BlendFunction, KernelSize } from "postprocessing";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoxGeometry, BufferAttribute, type BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, type Group, type PerspectiveCamera as ThreePerspectiveCamera, Shape, Vector2 } from "three";
import * as CANNON from "cannon-es";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clampVoxelDepth, type Creature, generate, voxelize } from "../../../../../core/procgen";
import type { RGB } from "../../../../../core/shiny.ts";
import { DEFAULT_PET_LOOK_ID, PET_LOOKS, isPetLookId, type PetLookId } from "../../../../../core/petLooks.ts";
import { chimeVoiceFor, playChime } from "../../audio";
import { ProceduralMat } from "./petMaterials";

const resolveLookId = (value: string | undefined | null): PetLookId => isPetLookId(value) ? value : DEFAULT_PET_LOOK_ID;

// Camera pushback so a pet's FRONT face sits at a consistent apparent distance across looks.
// A volumetric pet is stacked toward the camera by (depth-1)/2 voxels; pushing the camera
// back by the same amount keeps it the same on-screen size as the flat legacy look. Exactly
// 0 for legacy (depth 1), so legacy framing is unchanged.
const lookDepthPush = (c: Creature, lookId: PetLookId) => (clampVoxelDepth(resolveLookId(lookId), c) - 1) / 2;
const PET_LOOK_OPTIONS = Object.values(PET_LOOKS);
type PetLookMap = Record<string, PetLookId>;
export type SummonPet = { seed: string; lookId: PetLookId };

// One merged BoxGeometry for the whole pet body (per-voxel translation baked in + a custom
// `voxColor` attribute carrying the procgen gradient color per cube). One draw call per pet
// instead of N — the biggest single perf win for the menagerie grid.
const buildBodyGeom = (voxels: { x: number; y: number; z: number; color: RGB }[], offsetX: number, offsetY: number, offsetZ: number): BufferGeometry | null => {
  if (voxels.length === 0) return null;
  const geoms = voxels.map((v) => {
    const g = new BoxGeometry(0.94, 0.94, 0.94);
    g.translate(v.x + offsetX, -v.y + offsetY, v.z + offsetZ);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = v.color[0] / 255;
      arr[i * 3 + 1] = v.color[1] / 255;
      arr[i * 3 + 2] = v.color[2] / 255;
    }
    g.setAttribute("voxColor", new BufferAttribute(arr, 3));
    return g;
  });
  return mergeGeometries(geoms, false);
};

// Stats overlay (drei wraps three.js Stats.js). Gated to opt-in via `?stats` query so it
// doesn't show in normal use. Mounts a DOM panel showing FPS / MS / MB / GPU.
const showStats = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("stats");

// 5-pointed star geometry — the eye for "star" trait creatures. Built once, shared.
const STAR_GEOM = (() => {
  const shape = new Shape();
  const outer = 0.55, inner = 0.22;
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new ExtrudeGeometry(shape, { bevelEnabled: true, bevelSegments: 2, bevelSize: 0.04, bevelThickness: 0.04, depth: 0.12 });
})();

// Eye component — geometry + material both branch on the eye trait so each kind is unique:
//   star    = extruded 5-pointed star, glows brightly
//   void    = matte black core + emissive accretion ring (torus) around it
//   many    = a constellation cluster of 5 small spheres
//   cyclops = single big sphere
//   others  = single sphere sized by trait
const Eye = ({ pos, color, trait, mythic }: { pos: [number, number, number]; color: string; trait: string; mythic: boolean }) => {
  const intensity = mythic ? 1.8 : trait === "void" ? 0.2 : trait === "star" ? 1.6 : trait === "fierce" ? 1.2 : 1.0;
  if (trait === "star") {
    return (
      <mesh position={pos} rotation={[0, 0, 0]}>
        <primitive object={STAR_GEOM} attach="geometry" />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} roughness={0.15} metalness={0.4} />
      </mesh>
    );
  }
  if (trait === "void") {
    return (
      <group position={pos}>
        <mesh>
          <sphereGeometry args={[0.4, 18, 18]} />
          <meshStandardMaterial color="#000" emissive="#000" />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.5, 0.06, 12, 32]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} />
        </mesh>
      </group>
    );
  }
  if (trait === "many") {
    // Constellation — 5 small spheres in a + plus pattern. Eye color, all emissive.
    const offsets: [number, number][] = [[0, 0], [0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]];
    return (
      <group position={pos}>
        {offsets.map((o, i) => (
          <mesh key={i} position={[o[0], o[1], 0]}>
            <sphereGeometry args={[0.12, 10, 10]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} roughness={0.1} />
          </mesh>
        ))}
      </group>
    );
  }
  const radius = trait === "cyclops" ? 0.55 : trait === "fierce" ? 0.42 : 0.38;
  return (
    <mesh position={pos}>
      <sphereGeometry args={[radius, 18, 18]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} roughness={0.1} metalness={0.4} />
    </mesh>
  );
};

const css = ([r, g, b]: RGB) => `rgb(${r},${g},${b})`;

// Per-creature movement personality, derived deterministically from species + tier. Species
// sets the baseline (Slime squashes, Sprite hovers, Wyrm undulates, Construct is rigid…) —
// tier escalates intensity, with Mythic/1-of-1 unlocking vertex chaos + ghost mirror copies.
type MovementProfile = {
  bobAmp: number; bobFreq: number;
  spin: number;                                       // rad/sec added to autoRotate
  tiltAmp: number; tiltFreq: number;                  // x/z rotation sway
  squashAmp: number; squashFreq: number;              // squash-and-stretch y vs x/z
  warpMode: number;                                   // shader vertex displacement: 0/1/2/3
  ghostCount: number;                                 // additional translucent copies orbiting through it
};
const movementFor = (c: Creature): MovementProfile => {
  // Base profile per species — each one moves differently.
  const sp = c.traits.species;
  let p: MovementProfile = { bobAmp: 0.10, bobFreq: 1.5, spin: 0.18, tiltAmp: 0.05, tiltFreq: 1.0, squashAmp: 0.02, squashFreq: 1.4, warpMode: 0, ghostCount: 0 };
  if (sp === "Slime")     p = { ...p, squashAmp: 0.14, squashFreq: 1.8, bobAmp: 0.18 };
  if (sp === "Critter")   p = { ...p, bobAmp: 0.06, bobFreq: 3.5, tiltAmp: 0.10, tiltFreq: 3.2 };
  if (sp === "Beast")     p = { ...p, bobAmp: 0.05, bobFreq: 0.7, spin: 0.08, tiltAmp: 0.03 };
  if (sp === "Construct") p = { ...p, bobAmp: 0,    spin: 0.45, tiltAmp: 0,    squashAmp: 0 };
  if (sp === "Drake")     p = { ...p, bobAmp: 0.12, bobFreq: 1.0, spin: 0.35, tiltAmp: 0.10 };
  if (sp === "Sprite")    p = { ...p, bobAmp: 0.08, bobFreq: 4.0, spin: 1.20, tiltAmp: 0,    squashAmp: 0.04 };
  if (sp === "Wyrm")      p = { ...p, bobAmp: 0.22, bobFreq: 1.1, tiltAmp: 0.18, tiltFreq: 0.8, squashAmp: 0.06, squashFreq: 1.1 };
  if (sp === "Eldritch")  p = { ...p, tiltAmp: 0.22, tiltFreq: 0.6, squashAmp: 0.10, warpMode: 1 };
  if (sp === "Celestial") p = { ...p, bobAmp: 0.10, bobFreq: 0.8, spin: 0.25, tiltAmp: 0.04 };
  // Tier escalation — rarer tiers unlock vertex chaos + ghost copies.
  if (c.tier === "Legendary") p = { ...p, warpMode: Math.max(p.warpMode, 1), spin: p.spin * 1.3 };
  if (c.mythicAura) p = { ...p, warpMode: 2, spin: p.spin * 1.6, tiltAmp: p.tiltAmp + 0.08, ghostCount: 1 };
  if (c.oneOfOne) p = { ...p, warpMode: 3, spin: p.spin * 2.0, squashAmp: 0.20, squashFreq: 2.2, ghostCount: 2 };
  return p;
};

// Translucent mirror of the body geometry that orbits around the pet's center. Stacks well
// for ghostCount > 1 (each copy phase-offset). Same merged geometry, additive blend implied
// by emissive shader + a small transparent material on top.
const GhostCopy = ({ geom, creature, warpMode, index, count, burstRef }: { geom: BufferGeometry; creature: Creature; warpMode: number; index: number; count: number; burstRef: { current: { value: number } } }) => {
  const ref = useRef<Group>(null);
  const radius = 0.45;
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.getElapsedTime();
    const phase = (index / (count + 1)) * Math.PI * 2;
    const speed = creature.oneOfOne ? 1.6 : 1.0;
    ref.current.position.x = Math.cos(t * speed + phase) * radius;
    ref.current.position.z = Math.sin(t * speed + phase) * radius;
    ref.current.rotation.y = t * speed + phase;
    const breathe = 0.85 + Math.sin(t * 2 + phase) * 0.1;
    ref.current.scale.setScalar(breathe);
  });
  return (
    <group ref={ref}>
      <mesh geometry={geom}>
        <ProceduralMat creature={creature} color={creature.eyeColor} useVertexColor={false} warpMode={warpMode} burstRef={burstRef} />
      </mesh>
    </group>
  );
};

const Pet = ({ seed, autoRotate = 0, entranceBurst = false, lookId = DEFAULT_PET_LOOK_ID }: { seed: string; autoRotate?: number; entranceBurst?: boolean; lookId?: PetLookId }) => {
  const c = useMemo(() => generate(seed), [seed]);
  const grid = useMemo(() => voxelize(c, 0, resolveLookId(lookId)), [c, lookId]);
  const mp = useMemo(() => movementFor(c), [c]);
  const groupRef = useRef<Group>(null);
  const offsetX = -grid.w / 2 + 0.5;
  const offsetY = grid.h / 2 - 0.5;
  const offsetZ = -(grid.d - 1) / 2;
  // Merged body geometry — one mesh + one shader program instance per pet.
  const bodyGeom = useMemo(() => {
    const bodyVoxels = grid.voxels.filter((v) => v.kind === "body");
    return buildBodyGeom(bodyVoxels, offsetX, offsetY, offsetZ);
  }, [grid, offsetX, offsetY, offsetZ]);

  // Imperative entry spring (function form). Function runs once at mount; initial config
  // has from/to so the animation kicks off — no useEffect needed. `api` available in scope
  // for future event-driven .start()/.set() calls. entranceBurst variant overshoots a bit
  // so newcomer pets visibly "land" on the board rather than just appearing.
  const seedHash = useMemo(() => Array.from(seed).reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 0), [seed]);
  const [{ scale }] = useSpring(() => entranceBurst
    ? { config: { friction: 10, tension: 220 }, delay: 0, from: { scale: 0 }, to: { scale: 1 } }
    : { config: { friction: 14, tension: 180 }, delay: Math.abs(seedHash) % 220, from: { scale: 0 }, to: { scale: 1 } });

  // Movement: bob + tilt + squash + spin per species/tier — every pet has a personality.
  // Heartbeat sits on a separate inner pulse group. Bursts are tier-gated flourish moments
  // (vertex warp triples, color glitches, scale pulses) — invisible for Common-Epic, regular
  // for Legendary, frequent + insane for Mythic / 1-of-1.
  const bpm = c.oneOfOne ? 3.2 : c.tier === "Mythic" ? 2.4 : c.tier === "Legendary" ? 1.8 : 1.2;
  const pulseRef = useRef<Group>(null);
  const burstRef = useRef({ value: 0 });
  // Sentinel -1 means "fire a one-shot burst on the first frame after mount" — used by the
  // entranceBurst path so newcomers to the leaderboard land with a flourish, regardless of
  // tier (the periodic burst system below only fires for Legendary+). The useFrame loop
  // converts -1 to a real `t + 0.4` window on the very next frame.
  const burstUntilRef = useRef(entranceBurst ? -1 : 0);
  const nextBurstRef = useRef(2 + Math.random() * 4);
  // Average burst interval per tier (seconds between flourishes); 0 = never.
  const burstInterval = c.oneOfOne ? 4 : c.mythicAura ? 7.5 : c.tier === "Legendary" ? 12 : 0;

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    // One-shot entrance burst: convert the -1 sentinel into a real 0.4s window on the
    // first frame after mount. Independent of tier — even a Common newcomer should
    // visibly "arrive" on the leaderboard with a flourish.
    if (burstUntilRef.current === -1) burstUntilRef.current = t + 0.4;
    // Periodic-burst scheduling — only fires for tiers with burstInterval > 0.
    if (burstInterval > 0 && t > nextBurstRef.current && t > burstUntilRef.current) {
      burstUntilRef.current = t + 0.4;
      nextBurstRef.current = t + burstInterval + (Math.random() - 0.5) * 2;
    }
    // Burst easing — runs regardless of tier so an entrance burst on a Common pet still
    // gets the smooth 0→1→0 pulse. Clamped to a 0.5s window so a stale/misconfigured
    // burstUntilRef can't pin the value at >1 indefinitely.
    const remaining = burstUntilRef.current - t;
    if (remaining > 0 && remaining < 0.5) {
      const phase = 1 - remaining / 0.4;
      burstRef.current.value = Math.sin(phase * Math.PI);
    } else {
      burstRef.current.value = 0;
    }
    const burst = burstRef.current.value;
    if (groupRef.current) {
      groupRef.current.position.y = Math.sin(t * mp.bobFreq + seedHash * 0.01) * mp.bobAmp;
      groupRef.current.rotation.y += (autoRotate + mp.spin * (1 + burst * 2)) * delta;
      groupRef.current.rotation.x = Math.sin(t * mp.tiltFreq) * mp.tiltAmp;
      groupRef.current.rotation.z = Math.cos(t * mp.tiltFreq * 0.7) * mp.tiltAmp * 0.6;
      // Squash-and-stretch + burst pop.
      const s = Math.sin(t * mp.squashFreq) * mp.squashAmp;
      const pop = 1 + burst * 0.18;
      groupRef.current.scale.x = (1 - s * 0.5) * pop;
      groupRef.current.scale.y = (1 + s) * pop;
      groupRef.current.scale.z = (1 - s * 0.5) * pop;
    }
    if (pulseRef.current) {
      const phase = (t * bpm) % 1;
      const beat = phase < 0.18 ? Math.sin(phase * Math.PI / 0.18) : 0;
      pulseRef.current.scale.setScalar(1 + beat * 0.06);
    }
  });

  return (
    <animated.group ref={groupRef} scale={scale as unknown as ThreeElements["group"]["scale"]}>
      <group ref={pulseRef}>
      <Float floatIntensity={0.2} rotationIntensity={0.25} speed={1.3}>
        {/* Body: one merged mesh + one ShaderMaterial — N voxels collapse to 1 draw call. */}
        {bodyGeom && (
          <mesh geometry={bodyGeom}>
            <ProceduralMat creature={c} color={c.palette[0]} useVertexColor warpMode={mp.warpMode} burstRef={burstRef} />
          </mesh>
        )}
        {bodyGeom && mp.ghostCount > 0 && Array.from({ length: mp.ghostCount }, (_, gi) => (
          <GhostCopy key={gi} geom={bodyGeom} creature={c} warpMode={mp.warpMode} index={gi + 1} count={mp.ghostCount} burstRef={burstRef} />
        ))}
        {/* Eyes + mouth stay as individual meshes (small count, unique geometries/materials). */}
        {grid.voxels.filter((v) => v.kind !== "body").map((v, i) => {
          const x = v.x + offsetX;
          const y = -v.y + offsetY;
          const z = v.z + offsetZ;
          const color = css(v.color);
          if (v.kind === "eye") return <Eye key={i} pos={[x, y, z]} color={color} trait={c.traits.eyes} mythic={c.mythicAura} />;
          if (v.kind === "crest") return (
            <mesh key={i} position={[x, y, z]}>
              <boxGeometry args={[0.92, 0.92, 0.92]} />
              <meshStandardMaterial color={color} roughness={0.35} metalness={0.2} emissive={color} emissiveIntensity={0.3} />
            </mesh>
          );
          return (
            <mesh key={i} position={[x, y, z]}>
              <boxGeometry args={[0.55, 0.18, 0.25]} />
              <meshStandardMaterial color={color} roughness={0.4} emissive={color} emissiveIntensity={0.25} />
            </mesh>
          );
        })}
        {(grid.aura || grid.mythicAura) && (
          <Sparkles
            count={grid.mythicAura ? 28 : 16}
            scale={[grid.w + 1.5, grid.h + 1.5, 2]}
            size={grid.mythicAura ? 4 : 2.5}
            speed={0.45}
            color={grid.mythicAura ? "#ffe9b3" : "#9cd6ff"}
          />
        )}
      </Float>
      </group>
    </animated.group>
  );
};

// Cannon-es physics shell — wraps a Pet so it drops on mount and settles on an invisible
// floor. The outer group's transform is driven by the rigid body, while Pet's own
// intrinsic motion (bob, tilt, squash, burst) runs in local space inside, so the two
// layers compound (bobbing while falling, tilting while resting). One world per mount:
// callers should key the component on seed so a fresh pet spawns a fresh world. Used by
// the spotlight (for 1/1 only) and by the menagerie grid (every card, with a smaller
// drop tuned for the card camera). dropFrom / floorY let callers scale the drop to the
// scene's vertical extent.
const PhysicsPet = ({ seed, autoRotate, entranceBurst = false, dropFrom = 12, floorY = -4, lookId = DEFAULT_PET_LOOK_ID }: { seed: string; autoRotate: number; entranceBurst?: boolean; dropFrom?: number; floorY?: number; lookId?: PetLookId }) => {
  const worldRef = useRef<CANNON.World | null>(null);
  const bodyRef = useRef<CANNON.Body | null>(null);
  const groupRef = useRef<Group>(null);

  useEffect(() => {
    const c = generate(seed);
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    world.allowSleep = true;
    // Box collider scaled to the pet's visible footprint. Depth is shorter so a flat
    // voxel slab lands plausibly (it isn't a cube; the body shouldn't act like one).
    const half = Math.max(1.6, c.sizeN * 0.05);
    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(new CANNON.Vec3(half, half, half * 0.55)),
      position: new CANNON.Vec3(0, dropFrom, 0),
      angularVelocity: new CANNON.Vec3((Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2, 0),
      linearDamping: 0.14,
      angularDamping: 0.30,
      material: new CANNON.Material({ restitution: 0.52, friction: 0.35 }),
    });
    world.addBody(body);
    // Invisible floor a few units below the natural resting line so the pet doesn't sit
    // dead-centered after settling — it lands slightly low, reads as "on a surface."
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    floor.position.set(0, floorY, 0);
    world.addBody(floor);
    worldRef.current = world;
    bodyRef.current = body;
    return () => { world.removeBody(body); world.removeBody(floor); worldRef.current = null; bodyRef.current = null; };
  }, [seed, dropFrom, floorY]);

  useFrame((_, delta) => {
    const w = worldRef.current; const b = bodyRef.current; const g = groupRef.current;
    if (!w || !b || !g) return;
    // Fixed 60Hz step + delta interpolation so the sim is deterministic at any framerate.
    w.step(1 / 60, delta, 3);
    g.position.set(b.position.x, b.position.y, b.position.z);
    g.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  });

  return (
    <group ref={groupRef}>
      <Pet seed={seed} autoRotate={autoRotate} entranceBurst={entranceBurst} lookId={lookId} />
    </group>
  );
};

// Pull camera z out of a spring value imperatively per frame. Lives as its own component
// because useFrame must run inside the Canvas context (which drei View provides for its
// children but not for the SpotlightView function body itself).
const CameraSpringDolly = ({ camRef, camZ }: { camRef: React.RefObject<ThreePerspectiveCamera | null>; camZ: { get: () => number } }) => {
  useFrame(() => {
    if (camRef.current) camRef.current.position.z = camZ.get();
  });
  return null;
};

// Camera distance derived from creature size — bigger pets need to be further back to
// stay in frame. Shared by the spotlight's initial position and its swap-target spring.
const spotlightZFor = (seed: string | null, lookId: PetLookId = DEFAULT_PET_LOOK_ID) => {
  if (!seed) return 12;
  const c = generate(seed);
  return Math.max(10, 7 + c.sizeN * 0.10) + lookDepthPush(c, lookId);
};

// Big shared View for the leaderboard hover spotlight (one mount per page, fed by whichever
// row is currently hovered/selected). Uses the same shared MenagerieCanvas, so it costs one
// extra scissor-rect rather than another WebGL context.
//
// Seed transitions are animated via react-spring's imperative API (per
// https://www.react-spring.dev/docs/concepts/imperative-api):
//   useSpring(() => ({ scale: 1, camZ })) returns [springs, api]; on seed change we drive
//   a two-leg `api.start({ to: async (next) => ... })` chain — dolly out, swap displaySeed,
//   dolly in. No useEffect-coupled timing on the animation itself; useEffect is only the
//   prop-change detector, the animation is event-driven (start → resolve → start).
export const SpotlightView = ({ seed, lookId = DEFAULT_PET_LOOK_ID }: { seed: string | null; lookId?: PetLookId }) => {
  // displaySeed = what's currently being shown in the scene (lags behind `seed` during the
  // dolly-out leg of the transition; updated mid-chain so the new pet renders only after
  // the outgoing one has scaled away).
  const [displaySeed, setDisplaySeed] = useState<string | null>(seed);
  const [springs, api] = useSpring(() => ({ scale: 1, camZ: spotlightZFor(seed, lookId) }));
  const cameraRef = useRef<ThreePerspectiveCamera>(null);

  // Prop-change detector. The chain runs imperatively inside api.start — useEffect here
  // is only the dispatch point, it doesn't own the animation timing.
  useEffect(() => {
    if (seed === displaySeed) return;
    // Null transitions snap (no pet to animate). Only animate when going between two pets.
    if (displaySeed === null || seed === null) { setDisplaySeed(seed); return; }
    api.start({
      to: async (next) => {
        // Leg 1: outgoing pet shrinks while camera pulls back, so the swap reads as a
        // depth dolly, not a snap.
        await next({ scale: 0, camZ: spotlightZFor(displaySeed, lookId) + 6, config: { tension: 260, friction: 22 } });
        setDisplaySeed(seed);
        // Leg 2: dolly back in to the new pet's natural distance while it scales up.
        await next({ scale: 1, camZ: spotlightZFor(seed, lookId), config: { tension: 180, friction: 22 } });
      },
    });
  }, [seed, displaySeed, api]);

  if (!displaySeed) return <View className="rankSpotlight"><ambientLight intensity={0.4} /></View>;

  const c = generate(displaySeed);
  const dramatic = c.tier === "Mythic" || c.tier === "Legendary" || c.oneOfOne;
  return (
    <View className="rankSpotlight">
      <PerspectiveCamera makeDefault ref={cameraRef} position={[0, 0, spotlightZFor(displaySeed, lookId)]} fov={34} />
      <CameraSpringDolly camRef={cameraRef} camZ={springs.camZ} />
      <color attach="background" args={[dramatic ? "#0a0a14" : "#0a0a0a"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 5]} intensity={1.2} />
      <directionalLight position={[-3, -2, 4]} intensity={0.55} color="#5fbeeb" />
      {dramatic && <Stars radius={32} depth={20} count={520} factor={2.6} fade speed={0.45} />}
      {/* Outer animated.group carries the swap-scale; Pet's own intrinsic scale animations
          (squash, burst pop) multiply through, so the transition reads cleanly on top of
          the per-frame motion. 1/1 pets get a cannon-es physics shell so they drop from
          above and bounce on the entrance instead of just floating in — keyed on
          displaySeed so a fresh 1/1 spawns a fresh world. */}
      <animated.group scale={springs.scale}>
        {c.oneOfOne
          ? <PhysicsPet key={displaySeed} seed={displaySeed} autoRotate={dramatic ? 0.35 : 0.2} lookId={lookId} />
          : <Pet seed={displaySeed} autoRotate={dramatic ? 0.35 : 0.2} lookId={lookId} />}
      </animated.group>
    </View>
  );
};

// Pet card content — drei's <View>, when used outside a Canvas, RENDERS ITS OWN DOM element
// and ignores the `track` prop. So the View IS the petCanvas div (className routes our CSS).
// The shared MenagerieCanvas picks up the View through tunnel-rat and scissor-renders the
// scene at this div's rect.
const PetCardView = ({ seed, creature, entranceBurst = false, lookId = DEFAULT_PET_LOOK_ID }: { seed: string; creature: Creature; entranceBurst?: boolean; lookId?: PetLookId }) => {
  const z = Math.max(8, 6 + creature.sizeN * 0.10) + lookDepthPush(creature, lookId);
  const dramatic = creature.tier === "Mythic" || creature.tier === "Legendary" || creature.oneOfOne;
  const rate = creature.tier === "Mythic" ? 0.5 : creature.tier === "Legendary" ? 0.3 : 0.18;   // rad/sec
  return (
    <View className="petCanvas">
      <PerspectiveCamera makeDefault position={[0, 0, z]} fov={36} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 5]} intensity={1.1} />
      <directionalLight position={[-3, -2, 4]} intensity={0.5} color="#5fbeeb" />
      {dramatic && <Stars radius={32} depth={20} count={420} factor={2.4} fade speed={0.4} />}
      {/* Every card runs its own little physics world — the pet drops in from above
          and settles on an invisible "shelf" at floorY=-3, then continues its intrinsic
          motion in local space on top of the resting body. Smaller drop/floor than the
          spotlight defaults to fit the card camera's tighter vertical extent. */}
      <PhysicsPet seed={seed} autoRotate={rate} entranceBurst={entranceBurst} dropFrom={8} floorY={-3} lookId={lookId} />
    </View>
  );
};

// A glowing point that orbits the pet on its own loop, leaving a Drei <Trail> behind it.
// Pure visual flourish for the hero canvas on rare pets — feels like the pet has its own
// little ecosystem of energy circling it.
const OrbitingTrail = ({ color, radius, speed, phase, height }: { color: string; radius: number; speed: number; phase: number; height: number }) => {
  const ref = useRef<Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.getElapsedTime() * speed + phase;
    ref.current.position.x = Math.cos(t) * radius;
    ref.current.position.z = Math.sin(t) * radius;
    ref.current.position.y = Math.sin(t * 1.7) * height;
  });
  return (
    <Trail width={0.25} length={5} color={color} decay={1.2} attenuation={(t) => t * t}>
      <group ref={ref}>
        <mesh>
          <sphereGeometry args={[0.12, 10, 10]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      </group>
    </Trail>
  );
};

// HERO canvas for big single-pet displays (avatar in profile modal) — adds chromatic
// aberration on the rarest pets + denser stars + a slightly slower auto-rotate so it
// reads as a presentation piece, not a thumbnail.
export const HeroCanvas = ({ seed, creature, lookId = DEFAULT_PET_LOOK_ID }: { seed: string; creature: Creature; lookId?: PetLookId }) => {
  const z = Math.max(8, 6 + creature.sizeN * 0.10) + lookDepthPush(creature, lookId);
  const cam = { fov: 32, position: [0, 0, z] as [number, number, number] };
  const wild = creature.oneOfOne || creature.mythicAura;
  const dramatic = wild || creature.tier === "Legendary";
  // Vector2 not React.memoizable directly via prop; build once per render.
  const caOffset = useMemo(() => new Vector2(0.002, 0.002), []);
  return (
    <Canvas camera={cam} dpr={[1, 1.8]} gl={{ antialias: true, alpha: false }}>
      <color attach="background" args={[wild ? "#06060a" : "#0a0a0a"]} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[3, 4, 5]} intensity={1.1} />
      <directionalLight position={[-3, -2, 4]} intensity={0.55} color="#5fbeeb" />
      {/* Global IBL — pet materials pick up environment reflections so the metallic / shimmer
          shaders read as if they're in a real scene rather than against a black void. background
          is left to our <color> above so the modal stays moody-dark; the IBL is purely lighting. */}
      <Environment preset={wild ? "night" : "city"} background={false} environmentIntensity={wild ? 0.7 : 0.45} />
      {dramatic && <Stars radius={50} depth={30} count={900} factor={3} fade speed={0.5} />}
      {/* Presentation Sparkles around the pet — denser than the in-pet sparkle so the avatar
          reads as "on display." Sized to the pet so it tracks bigger pets. */}
      <Sparkles
        count={wild ? 90 : 50}
        scale={[creature.sizeN * 0.18 + 6, creature.sizeN * 0.18 + 6, 4]}
        size={wild ? 5 : 3}
        speed={0.35}
        color={wild ? "#ffe9b3" : "#9cd6ff"}
        opacity={0.7}
      />
      <Pet seed={seed} lookId={lookId} />
      {/* Glass aura sphere — only for frost / void creatures. Real refraction via drei's
          MeshTransmissionMaterial. Sized to wrap the whole pet so the body is seen "through"
          a colored glass shell. Heavy effect, gated to these auras only. */}
      {(creature.traits.aura === "frost" || creature.traits.aura === "void") && (
        <mesh scale={Math.max(creature.sizeN * 0.045 + 4, 5)}>
          <sphereGeometry args={[1, 48, 48]} />
          <MeshTransmissionMaterial
            transmission={1} thickness={0.6} roughness={0.05} ior={1.4}
            chromaticAberration={0.06} distortion={creature.traits.aura === "void" ? 0.4 : 0.15}
            color={creature.traits.aura === "frost" ? "#a8def0" : "#3d0a45"}
          />
        </mesh>
      )}
      {/* Orbiting trail satellites — rare-pet flourish. Three different orbits in the pet's
          palette colors so each pet's accents follow its own theme. */}
      {dramatic && <OrbitingTrail color={css(creature.eyeColor)} radius={4.5} speed={0.9} phase={0} height={1.6} />}
      {wild && <OrbitingTrail color={css(creature.palette[0])} radius={5.4} speed={-0.7} phase={2.1} height={1.3} />}
      {wild && <OrbitingTrail color={css(creature.palette[1])} radius={3.8} speed={1.4} phase={4.2} height={2.0} />}
      {/* Reflective floor — catches the pet's bloom + creates a real "stage" feel. Blurred
          mirror so it reads as polished obsidian rather than a literal mirror. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -Math.max(5, creature.sizeN * 0.06), 0]}>
        <planeGeometry args={[42, 42]} />
        <MeshReflectorMaterial
          mirror={0.55} blur={[280, 90]} resolution={768} mixBlur={1.4} mixStrength={32}
          roughness={1} depthScale={1.1} minDepthThreshold={0.4} maxDepthThreshold={1.4}
          color="#050505" metalness={0.4}
        />
      </mesh>
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={wild ? 1.3 : 0.5} />
      <EffectComposer>
        <Bloom intensity={wild ? 1.7 : 1.15} luminanceThreshold={0.45} luminanceSmoothing={0.5} kernelSize={KernelSize.HUGE} mipmapBlur />
        {wild ? <ChromaticAberration offset={caOffset} blendFunction={BlendFunction.NORMAL} radialModulation={false} modulationOffset={0} /> : <></>}
        <Vignette offset={0.15} darkness={0.55} />
        <Noise opacity={0.035} />
      </EffectComposer>
      {showStats() && <Stats />}
    </Canvas>
  );
};

// Fullscreen "summon" cinematic — takes over the viewport when /api/verify yields new pets.
// Cycles through each new seed for a tier-scaled dwell (Common 2.0s → 1/1 3.2s), uses the
// HeroCanvas presentation pipeline for each, and auto-closes when done. Esc / Skip / scrim
// click all close early; the seeds are already saved to `wild` server-side so closing
// doesn't forfeit anything — it's pure UX.
//
// Per-pet remount via `key={seed}` is intentional: each cinematic beat is short enough that
// the WebGL/post-FX warm-up is hidden by the next pet's entrance burst. Keeping one Canvas
// + crossfade would be smoother but adds complexity; the current trade reads punchy.
export const SummonCinematic = ({ summons, onClose }: { summons: SummonPet[]; onClose: () => void }) => {
  const [index, setIndex] = useState(0);
  const summon = summons[index];
  const seed = summon?.seed ?? null;
  const c = useMemo(() => seed ? generate(seed) : null, [seed]);

  // Tier-scaled dwell so rare pets get a longer beat (they have more visual going on:
  // chromatic aberration, orbiting trails, ghost copies, transmission spheres).
  const dwell = c
    ? (c.oneOfOne ? 3200 : c.tier === "Mythic" ? 2800 : c.tier === "Legendary" ? 2400 : 2000)
    : 0;

  useEffect(() => {
    if (!seed || !c) return undefined;
    // Tier-voiced chime: Common pets get a quiet major third, 1/1 gets a detuned upper
    // cluster. Same trigger point, different acoustic information per pet.
    playChime(chimeVoiceFor(c.tier, c.oneOfOne, c.mythicAura));
    const id = window.setTimeout(() => {
      if (index < summons.length - 1) setIndex(index + 1);
      else window.setTimeout(onClose, 700);     // brief hold on the last pet before closing
    }, dwell);
    return () => window.clearTimeout(id);
  }, [seed, c, index, summons.length, dwell, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!seed || !c) return null;
  return (
    <div className="summonScrim" role="dialog" aria-modal onClick={onClose}>
      <header className="summonHead" onClick={(e) => e.stopPropagation()}>
        <span className="summonLabel">✦ {summons.length === 1 ? "A new pet was summoned" : `${summons.length} new pets summoned`} ✦</span>
        <span className="summonProgress">{index + 1} / {summons.length}</span>
        <button className="btn ghost summonSkip" onClick={onClose}>Skip ›</button>
      </header>
      <div className="summonStage" onClick={(e) => e.stopPropagation()}>
        <HeroCanvas key={seed} seed={seed} creature={c} lookId={summon?.lookId} />
      </div>
      <div className="summonMeta" onClick={(e) => e.stopPropagation()}>
        <h2 className={`summonName tier-${c.tier.toLowerCase()}`}>{c.name}</h2>
        <p className="muted">
          {c.tier}{c.oneOfOne ? " · 1/1" : c.mythicAura ? " · Mythic aura" : ""} · size {c.sizeN} · {c.traits.species}
        </p>
      </div>
    </div>
  );
};

// 24px inline pet for the ghost-cursor strip — own View into MenagerieCanvas, lighter
// scene than PetCardView (no Stars, single light, fast spin). Used in place of the
// colored dot for cursors whose owner has opted in to label-sharing. Mount-gated so
// SSR is safe.
export const GhostAvatar = ({ seed, lookId = DEFAULT_PET_LOOK_ID }: { seed: string; lookId?: PetLookId }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const c = useMemo(() => generate(seed), [seed]);
  if (!mounted) return <span className="ghostAvatar" />;
  const z = Math.max(8, 6 + c.sizeN * 0.10) + lookDepthPush(c, lookId);
  return (
    <View className="ghostAvatar">
      <PerspectiveCamera makeDefault position={[0, 0, z]} fov={36} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 4, 5]} intensity={1.0} />
      <Pet seed={seed} autoRotate={0.7} lookId={lookId} />
    </View>
  );
};

// One pet, used for avatars and other single-pet displays (mount-gated so SSR is safe).
// hero=true → standalone Canvas with full FX (post-processing, reflector floor, etc.).
// hero=false → drei <View> that scissor-renders into the shared MenagerieCanvas. Callers
// using non-hero (e.g. ProfileModal's showcase row) MUST ensure MenagerieCanvas is mounted
// in the page; otherwise the View has nowhere to render and the pet is invisible.
export const SinglePet = ({ seed, hero = false, entranceBurst = false, lookId = DEFAULT_PET_LOOK_ID }: { seed: string; hero?: boolean; entranceBurst?: boolean; lookId?: PetLookId }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const c = useMemo(() => generate(seed), [seed]);
  if (!mounted) return <div className="petCanvas" />;
  // hero wraps itself in a sized div; PetCardView IS the petCanvas div (View renders the
  // element itself when used outside a Canvas), so don't double-wrap it. entranceBurst only
  // flows through the non-hero path — the hero canvas is presentation-only (no leaderboard
  // newcomer story).
  return hero
    ? <div className="petCanvas"><HeroCanvas seed={seed} creature={c} lookId={lookId} /></div>
    : <PetCardView seed={seed} creature={c} entranceBurst={entranceBurst} lookId={lookId} />;
};

// One card. The PetCardView IS the visible canvas region (it renders a div internally and
// the shared MenagerieCanvas scissor-renders the pet to its rect via tunnel-rat).
const PetCard = ({
  seed,
  creature,
  isAvatar,
  onSetAvatar,
  mounted,
  lookId = DEFAULT_PET_LOOK_ID,
  onLookChange,
}: {
  seed: string;
  creature: Creature;
  isAvatar: boolean;
  onSetAvatar?: (seed: string) => void;
  mounted: boolean;
  lookId?: PetLookId;
  onLookChange?: (seed: string, nextLookId: PetLookId) => void;
}) => {
  const onLookChangeEvent = (event: ChangeEvent<HTMLSelectElement>) => {
    onLookChange?.(seed, resolveLookId(event.target.value));
  };
  return (
    <div className={`petCard tier-${creature.tier.toLowerCase()}${isAvatar ? " isAvatar" : ""}`}>
      {mounted ? <PetCardView seed={seed} creature={creature} lookId={lookId} /> : <div className="petCanvas" />}
      {onLookChange && (
        <label className="petLookControl">
          <select value={lookId} onChange={onLookChangeEvent} title="Choose pet appearance">
            {PET_LOOK_OPTIONS.map((look) => (
              <option key={look.id} value={look.id}>
                {look.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {onSetAvatar && (
        <button className={`avatarBtn${isAvatar ? " on" : ""}`} title={isAvatar ? "Your avatar" : "Set as avatar"} onClick={() => !isAvatar && onSetAvatar(seed)}>
          {isAvatar ? "★" : "☆"}
        </button>
      )}
      <div className="petLabel">
        <span className={`tierTag t-${creature.tier.toLowerCase()}`}>{creature.tier}</span>
        <span className="petName" title={creature.name}>{creature.name}</span>
        <span className="petSize" title="size">{creature.sizeN}</span>
      </div>
    </div>
  );
};

export const PetViewer = ({
  seeds,
  limit = 6,
  avatarSeed,
  onSetAvatar,
  activePetLookId = DEFAULT_PET_LOOK_ID,
  petLookAssignments = {},
  onSetPetLook,
}: {
  seeds: string[];
  limit?: number;
  avatarSeed?: string | null;
  onSetAvatar?: (seed: string) => void;
  activePetLookId?: string;
  petLookAssignments?: PetLookMap;
  onSetPetLook?: (seed: string, lookId: PetLookId) => void;
}) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const resolveSeedLookId = useCallback((seed: string): PetLookId => {
    const override = petLookAssignments[seed];
    return isPetLookId(override) ? override : resolveLookId(activePetLookId);
  }, [petLookAssignments, activePetLookId]);
  // Top N by rarity score (rarest first), unique seeds only.
  const top = useMemo(() => {
    const uniq = Array.from(new Set(seeds));
    return uniq
      .map((seed) => ({ c: generate(seed), seed, lookId: resolveSeedLookId(seed) }))
      .sort((a, b) => b.c.score - a.c.score)
      .slice(0, limit);
  }, [seeds, limit, resolveSeedLookId]);

  if (top.length === 0) return <p className="muted">No wild creatures yet — they drop from real attributed commits each sync.</p>;

  return (
    <div className="petStage">
      {top.map(({ c, seed, lookId }) => (
        <PetCard
          key={seed}
          seed={seed}
          creature={c}
          isAvatar={seed === avatarSeed}
          onSetAvatar={onSetAvatar}
          mounted={mounted}
          lookId={lookId}
          onLookChange={onSetPetLook}
        />
      ))}
    </div>
  );
};
