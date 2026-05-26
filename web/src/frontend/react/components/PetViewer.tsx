// 3D pet viewer — the procgen ASCII creature lives in three.js with real materials/lights.
// Each voxel = one filled ASCII cell; tier drives the shader treatment (Legendary → metallic
// + shimmer, Mythic → distort + rainbow). Drei: OrbitControls/Float/Environment/Sparkles.
// react-spring/three: entry scale animation. Same seeded procgen — server and client render
// the SAME creature from the SAME commit SHA.
import { Float, MeshReflectorMaterial, MeshTransmissionMaterial, OrbitControls, PerspectiveCamera, Sparkles, Stars, Stats, Trail, View } from "@react-three/drei";
import { Canvas, useFrame, type ThreeElements } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { animated, useSpring } from "@react-spring/three";
import { BlendFunction, KernelSize } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxGeometry, BufferAttribute, type BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, type Group, Shape, Vector2 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Creature, generate, type RGB, voxelize } from "../../../../../core/procgen";
import { ProceduralMat } from "./petMaterials";

// One merged BoxGeometry for the whole pet body (per-voxel translation baked in + a custom
// `voxColor` attribute carrying the procgen gradient color per cube). One draw call per pet
// instead of N — the biggest single perf win for the menagerie grid.
const buildBodyGeom = (voxels: { x: number; y: number; color: RGB }[], offsetX: number, offsetY: number): BufferGeometry | null => {
  if (voxels.length === 0) return null;
  const geoms = voxels.map((v) => {
    const g = new BoxGeometry(0.94, 0.94, 0.94);
    g.translate(v.x + offsetX, -v.y + offsetY, 0);
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

const Pet = ({ seed, autoRotate = 0 }: { seed: string; autoRotate?: number }) => {
  const c = useMemo(() => generate(seed), [seed]);
  const grid = useMemo(() => voxelize(c, 0), [c]);
  const groupRef = useRef<Group>(null);
  const offsetX = -grid.w / 2 + 0.5;
  const offsetY = grid.h / 2 - 0.5;
  // Merged body geometry — one mesh + one shader program instance per pet.
  const bodyGeom = useMemo(() => {
    const bodyVoxels = grid.voxels.filter((v) => v.kind === "body");
    return buildBodyGeom(bodyVoxels, offsetX, offsetY);
  }, [grid, offsetX, offsetY]);

  // Imperative entry spring (function form). Function runs once at mount; the initial
  // config has from/to so the animation kicks off immediately — no useEffect needed.
  // `api` is here for future hover/state-driven animations (always use api.start, never
  // declarative re-runs against changing state).
  const seedHash = useMemo(() => Array.from(seed).reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 0), [seed]);
  const [{ scale }] = useSpring(() => ({
    config: { friction: 14, tension: 180 },
    delay: Math.abs(seedHash) % 220,
    from: { scale: 0 },
    to: { scale: 1 },
  }));

  // Gentle bob + heartbeat pulse + (if requested) y-rotation — all in one useFrame, all
  // mutating refs directly. Rarer tiers bob more and beat faster (matches the CLI philosophy).
  const intensity = c.tier === "Mythic" ? 0.22 : c.tier === "Legendary" ? 0.16 : c.tier === "Epic" ? 0.12 : 0.08;
  const bpm = c.oneOfOne ? 3.2 : c.tier === "Mythic" ? 2.4 : c.tier === "Legendary" ? 1.8 : 1.2;
  const pulseRef = useRef<Group>(null);
  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    if (groupRef.current) {
      groupRef.current.position.y = Math.sin(t * 1.4 + seedHash * 0.01) * intensity;
      if (autoRotate) groupRef.current.rotation.y += autoRotate * delta;   // delta-based so framerate-independent
    }
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
        {/* Body: one merged mesh + one ShaderMaterial — N voxels collapse to 1 draw call. */}
        {bodyGeom && (
          <mesh geometry={bodyGeom}>
            <ProceduralMat creature={c} color={c.palette[0]} useVertexColor />
          </mesh>
        )}
        {/* Eyes + mouth stay as individual meshes (small count, unique geometries/materials). */}
        {grid.voxels.filter((v) => v.kind !== "body").map((v, i) => {
          const x = v.x + offsetX;
          const y = -v.y + offsetY;
          const color = css(v.color);
          if (v.kind === "eye") return <Eye key={i} pos={[x, y, 0.5]} color={color} trait={c.traits.eyes} mythic={c.mythicAura} />;
          return (
            <mesh key={i} position={[x, y, 0.42]}>
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

// Pet card content — drei's <View>, when used outside a Canvas, RENDERS ITS OWN DOM element
// and ignores the `track` prop. So the View IS the petCanvas div (className routes our CSS).
// The shared MenagerieCanvas picks up the View through tunnel-rat and scissor-renders the
// scene at this div's rect.
const PetCardView = ({ seed, creature }: { seed: string; creature: Creature }) => {
  const z = Math.max(8, 6 + creature.sizeN * 0.10);
  const dramatic = creature.tier === "Mythic" || creature.tier === "Legendary" || creature.oneOfOne;
  const rate = creature.tier === "Mythic" ? 0.5 : creature.tier === "Legendary" ? 0.3 : 0.18;   // rad/sec
  return (
    <View className="petCanvas">
      <PerspectiveCamera makeDefault position={[0, 0, z]} fov={36} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 5]} intensity={1.1} />
      <directionalLight position={[-3, -2, 4]} intensity={0.5} color="#5fbeeb" />
      {dramatic && <Stars radius={32} depth={20} count={420} factor={2.4} fade speed={0.4} />}
      <Pet seed={seed} autoRotate={rate} />
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
        {wild && <ChromaticAberration offset={caOffset} blendFunction={BlendFunction.NORMAL} radialModulation={false} modulationOffset={0} />}
        <Vignette offset={0.15} darkness={0.55} />
        <Noise opacity={0.035} />
      </EffectComposer>
      {showStats() && <Stats />}
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

// One card. The PetCardView IS the visible canvas region (it renders a div internally and
// the shared MenagerieCanvas scissor-renders the pet to its rect via tunnel-rat).
const PetCard = ({ seed, creature, isAvatar, onSetAvatar, mounted }: { seed: string; creature: Creature; isAvatar: boolean; onSetAvatar?: (seed: string) => void; mounted: boolean }) => {
  return (
    <div className={`petCard tier-${creature.tier.toLowerCase()}${isAvatar ? " isAvatar" : ""}`}>
      {mounted ? <PetCardView seed={seed} creature={creature} /> : <div className="petCanvas" />}
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
      {top.map(({ c, seed }) => (
        <PetCard key={seed} seed={seed} creature={c} isAvatar={seed === avatarSeed} onSetAvatar={onSetAvatar} mounted={mounted} />
      ))}
    </div>
  );
};
