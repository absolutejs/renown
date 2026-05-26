// 3D pet viewer — the procgen ASCII creature lives in three.js with real materials/lights.
// Each voxel = one filled ASCII cell; tier drives the shader treatment (Legendary → metallic
// + shimmer, Mythic → distort + rainbow). Drei: OrbitControls/Float/Environment/Sparkles.
// react-spring/three: entry scale animation. Same seeded procgen — server and client render
// the SAME creature from the SAME commit SHA.
import { Environment, Float, OrbitControls, Sparkles } from "@react-three/drei";
import { Canvas, useFrame, type ThreeElements } from "@react-three/fiber";
import { animated, useSpring } from "@react-spring/three";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { type Creature, generate, type RGB, voxelize } from "../../../../../core/procgen";

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

  // Gentle breathing bob — rarer tiers move more (matches the CLI animation philosophy).
  const intensity = c.tier === "Mythic" ? 0.22 : c.tier === "Legendary" ? 0.16 : c.tier === "Epic" ? 0.12 : 0.08;
  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.getElapsedTime();
    groupRef.current.position.y = Math.sin(t * 1.4 + seedHash * 0.01) * intensity;
  });

  return (
    <animated.group ref={groupRef} scale={scale as unknown as ThreeElements["group"]["scale"]}>
      <Float floatIntensity={0.2} rotationIntensity={0.25} speed={1.3}>
        {grid.voxels.map((v, i) => {
          const x = v.x + offsetX;
          const y = -v.y + offsetY;
          const color = css(v.color);
          if (v.kind === "eye") {
            // Eyes pop out + glow — the "soul" of the creature.
            return (
              <mesh key={i} position={[x, y, 0.45]}>
                <sphereGeometry args={[0.35, 16, 16]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} roughness={0.15} />
              </mesh>
            );
          }
          if (v.kind === "mouth") {
            return (
              <mesh key={i} position={[x, y, 0.4]}>
                <boxGeometry args={[0.6, 0.2, 0.3]} />
                <meshStandardMaterial color={color} roughness={0.5} />
              </mesh>
            );
          }
          // Body voxel — Legendary gets metallic shimmer, Mythic gets rainbow + emissive,
          // everyone else gets a clean matte material that reads the procgen palette.
          const isLegendary = grid.tier === "Legendary";
          const isMythic = grid.mythicAura;
          return (
            <mesh key={i} position={[x, y, 0]}>
              <boxGeometry args={[0.92, 0.92, 0.92]} />
              <meshStandardMaterial
                color={color}
                roughness={isMythic ? 0.2 : isLegendary ? 0.35 : 0.85}
                metalness={isMythic ? 0.5 : isLegendary ? 0.65 : 0}
                emissive={color}
                emissiveIntensity={isMythic ? 0.5 : isLegendary ? 0.25 : 0.15}
              />
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
    </animated.group>
  );
};

// The Canvas needs a DOM/WebGL context, so skip it during SSR and hydrate on mount. Camera
// distance autoscales to sizeN so big pets don't clip out of frame.
export const PetCanvas = ({ seed, tier, sizeN }: { seed: string; tier: Creature["tier"]; sizeN: number }) => {
  const z = 7 + sizeN * 0.06;   // bigger pets pulled back so they fit the viewport
  const cam = { fov: 36, position: [0, 0, z] as [number, number, number] };
  return (
    <Canvas camera={cam} dpr={[1, 1.6]} gl={{ antialias: true }}>
      <color attach="background" args={["#0a0a0a"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 4, 5]} intensity={0.9} />
      <directionalLight position={[-3, -2, 4]} intensity={0.4} color="#5fbeeb" />
      {(tier === "Legendary" || tier === "Mythic") && <Environment preset={tier === "Mythic" ? "sunset" : "city"} background={false} environmentIntensity={0.6} />}
      <Pet seed={seed} />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={tier === "Mythic" ? 1.4 : tier === "Legendary" ? 0.9 : 0.5} />
    </Canvas>
  );
};

// One pet, used for avatars and other single-pet displays (mounted-gated so SSR is safe).
export const SinglePet = ({ seed }: { seed: string }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const c = useMemo(() => generate(seed), [seed]);
  if (!mounted) return <div className="petCanvas" />;
  return <div className="petCanvas"><PetCanvas seed={seed} tier={c.tier} sizeN={c.sizeN} /></div>;
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
            <div className="petCanvas">{mounted && <PetCanvas seed={seed} tier={c.tier} sizeN={c.sizeN} />}</div>
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
