// 3D pet viewer — the procgen ASCII creature lives in three.js with real materials/lights.
// Each voxel = one filled ASCII cell; tier drives the shader treatment (Legendary → metallic
// + shimmer, Mythic → distort + rainbow). Drei: OrbitControls/Float/Environment/Sparkles.
// react-spring/three: entry scale animation. Same seeded procgen — server and client render
// the SAME creature from the SAME commit SHA.
import { Float, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, type ThreeElements } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer } from "@react-three/postprocessing";
import { animated, useSpring } from "@react-spring/three";
import { BlendFunction, KernelSize } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { Vector2 } from "three";
import { type Creature, generate, type RGB, voxelize } from "../../../../../core/procgen";
import { ProceduralMat } from "./petMaterials";

const css = ([r, g, b]: RGB) => `rgb(${r},${g},${b})`;

const Pet = ({ seed }: { seed: string }) => {
  const c = useMemo(() => generate(seed), [seed]);
  const grid = useMemo(() => voxelize(c, 0), [c]);
  const groupRef = useRef<Group>(null);
  const offsetX = -grid.w / 2 + 0.5;
  const offsetY = grid.h / 2 - 0.5;

  // Spring entry: pop into view (different per pet via seed-derived delay)
  const seedHash = useMemo(() => Array.from(seed).reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 0), [seed]);
  const { scale } = useSpring({ config: { friction: 14, tension: 180 }, delay: Math.abs(seedHash) % 220, from: { scale: 0 }, to: { scale: 1 } });

  // Gentle bob + heartbeat pulse. Rarer tiers move more (matches the CLI philosophy).
  const intensity = c.tier === "Mythic" ? 0.22 : c.tier === "Legendary" ? 0.16 : c.tier === "Epic" ? 0.12 : 0.08;
  const bpm = c.oneOfOne ? 3.2 : c.tier === "Mythic" ? 2.4 : c.tier === "Legendary" ? 1.8 : 1.2;
  const pulseRef = useRef<Group>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (groupRef.current) groupRef.current.position.y = Math.sin(t * 1.4 + seedHash * 0.01) * intensity;
    if (pulseRef.current) {
      // Heartbeat: a brief expansion every beat, otherwise flat — feels alive vs sine bob.
      const phase = (t * bpm) % 1;
      const beat = phase < 0.18 ? Math.sin(phase * Math.PI / 0.18) : 0;
      pulseRef.current.scale.setScalar(1 + beat * 0.06);
    }
  });

  return (
    <animated.group ref={groupRef} scale={scale as unknown as ThreeElements["group"]["scale"]}>
      <group ref={pulseRef}>
      <Float floatIntensity={0.2} rotationIntensity={0.25} speed={1.3}>
        {grid.voxels.map((v, i) => {
          const x = v.x + offsetX;
          const y = -v.y + offsetY;
          const color = css(v.color);
          if (v.kind === "eye") {
            // Eye scale + intensity reads from the eye trait — fierce/star/void/cyclops
            // each get their own treatment. Mythic eyes brightest of all.
            const trait = c.traits.eyes;
            const radius = trait === "cyclops" ? 0.55 : trait === "many" ? 0.25 : trait === "fierce" ? 0.42 : 0.38;
            const intensity = c.mythicAura ? 1.6 : trait === "void" ? 0.4 : trait === "star" ? 1.4 : trait === "fierce" ? 1.1 : 0.85;
            return (
              <mesh key={i} position={[x, y, 0.5]}>
                <sphereGeometry args={[radius, 18, 18]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} roughness={trait === "void" ? 1 : 0.1} metalness={trait === "void" ? 0 : 0.4} />
              </mesh>
            );
          }
          if (v.kind === "mouth") {
            return (
              <mesh key={i} position={[x, y, 0.42]}>
                <boxGeometry args={[0.55, 0.18, 0.25]} />
                <meshStandardMaterial color={color} roughness={0.4} emissive={color} emissiveIntensity={0.25} />
              </mesh>
            );
          }
          // Body voxel — fully procedural shader: pattern + aura + tier all baked in.
          return (
            <mesh key={i} position={[x, y, 0]}>
              <boxGeometry args={[0.94, 0.94, 0.94]} />
              <ProceduralMat creature={c} color={v.color} />
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

// The Canvas needs a DOM/WebGL context, so skip it during SSR and hydrate on mount. Camera
// distance autoscales to sizeN so big pets don't clip out of frame. Body voxels are
// shader-lit (ProceduralMat handles its own diffuse/specular), so scene lights here only
// hit the eye + mouth standard materials. Bloom on the emissive parts is the magic that
// makes eyes + auras feel alive.
export const PetCanvas = ({ seed, creature }: { seed: string; creature: Creature }) => {
  const z = Math.max(8, 6 + creature.sizeN * 0.10);
  const cam = { fov: 36, position: [0, 0, z] as [number, number, number] };
  const dramatic = creature.tier === "Mythic" || creature.tier === "Legendary" || creature.oneOfOne;
  return (
    <Canvas camera={cam} dpr={[1, 1.6]} gl={{ antialias: true, alpha: false }}>
      <color attach="background" args={["#0a0a0a"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 5]} intensity={1.0} />
      <directionalLight position={[-3, -2, 4]} intensity={0.5} color="#5fbeeb" />
      {dramatic && <Stars radius={32} depth={20} count={420} factor={2.4} fade speed={0.4} />}
      <Pet seed={seed} />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={creature.tier === "Mythic" ? 1.6 : creature.tier === "Legendary" ? 0.95 : 0.55} />
      <EffectComposer>
        <Bloom intensity={0.9} luminanceThreshold={0.55} luminanceSmoothing={0.4} kernelSize={KernelSize.LARGE} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
};

// HERO canvas for big single-pet displays (avatar in profile modal) — adds chromatic
// aberration on the rarest pets + denser stars + a slightly slower auto-rotate so it
// reads as a presentation piece, not a thumbnail.
export const HeroCanvas = ({ seed, creature }: { seed: string; creature: Creature }) => {
  const z = Math.max(8, 6 + creature.sizeN * 0.10);
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
      {dramatic && <Stars radius={50} depth={30} count={900} factor={3} fade speed={0.5} />}
      <Pet seed={seed} />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={wild ? 1.3 : 0.5} />
      <EffectComposer>
        <Bloom intensity={wild ? 1.6 : 1.1} luminanceThreshold={0.45} luminanceSmoothing={0.5} kernelSize={KernelSize.HUGE} mipmapBlur />
        {wild && <ChromaticAberration offset={caOffset} blendFunction={BlendFunction.NORMAL} radialModulation={false} modulationOffset={0} />}
      </EffectComposer>
    </Canvas>
  );
};

// One pet, used for avatars and other single-pet displays (mount-gated so SSR is safe).
export const SinglePet = ({ seed, hero = false }: { seed: string; hero?: boolean }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const c = useMemo(() => generate(seed), [seed]);
  if (!mounted) return <div className="petCanvas" />;
  return <div className="petCanvas">{hero ? <HeroCanvas seed={seed} creature={c} /> : <PetCanvas seed={seed} creature={c} />}</div>;
};

export const PetViewer = ({ seeds, limit = 6, avatarSeed, onSetAvatar }: { seeds: string[]; limit?: number; avatarSeed?: string | null; onSetAvatar?: (seed: string) => void }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Top N by rarity score (rarest first), unique seeds only.
  const top = useMemo(() => {
    const uniq = Array.from(new Set(seeds));
    return uniq.map((seed) => ({ c: generate(seed), seed })).sort((a, b) => b.c.score - a.c.score).slice(0, limit);
  }, [seeds, limit]);

  if (top.length === 0) return <p className="muted">No wild creatures yet — they drop from real attributed commits each sync.</p>;

  return (
    <div className="petStage">
      {top.map(({ c, seed }) => {
        const isAvatar = seed === avatarSeed;
        return (
          <div className={`petCard tier-${c.tier.toLowerCase()}${isAvatar ? " isAvatar" : ""}`} key={seed}>
            <div className="petCanvas">{mounted && <PetCanvas seed={seed} creature={c} />}</div>
            {onSetAvatar && (
              <button className={`avatarBtn${isAvatar ? " on" : ""}`} title={isAvatar ? "Your avatar" : "Set as avatar"} onClick={() => !isAvatar && onSetAvatar(seed)}>
                {isAvatar ? "★" : "☆"}
              </button>
            )}
            <div className="petLabel">
              <span className={`tierTag t-${c.tier.toLowerCase()}`}>{c.tier}</span>
              <span className="petName" title={c.name}>{c.name}</span>
              <span className="petSize" title="size">{c.sizeN}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
