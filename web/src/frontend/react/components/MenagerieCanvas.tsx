// One shared Canvas for the WHOLE menagerie grid. Each pet card mounts a drei <View> that
// tracks its DOM rect — the renderer paints all of them in a single WebGL context, one
// scissored viewport per View. Goes from N canvases to 1.
//
// IMPORTANT: no EffectComposer here — it's designed for a single full-canvas scene and
// clobbers the per-View scissored renders. Per-card cards rely on emissive shader output
// + bright materials to "glow." HeroCanvas (single-scene, standalone) keeps full post-FX.
//
// `eventSource=document.body` so events inside Views still resolve even though the canvas
// itself is `pointer-events: none` (overlaid on the page).
import { AdaptiveDpr, AdaptiveEvents, Stats, View } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";

const showStats = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("stats");

export const MenagerieCanvas = () => {
  // Mount-gate the canvas so SSR doesn't try to set up WebGL.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  // drei <View> auto-detects offscreen rects via computeContainerPosition and SKIPS those
  // scissor renders — so scrolled-past pet cards stop drawing for free, no IntersectionObserver
  // needed. AdaptiveDpr drops DPR automatically when frame budget is exceeded; AdaptiveEvents
  // pauses pointer events while interacting (cheap raycasting when nothing's hovering).
  return (
    <div className="viewportCanvas">
      <Canvas
        dpr={[0.75, 1.3]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        eventSource={document.body}
        eventPrefix="client"
        frameloop="always"
        performance={{ min: 0.5 }}
      >
        <AdaptiveDpr pixelated={false} />
        <AdaptiveEvents />
        <View.Port />
        {showStats() && <Stats />}
      </Canvas>
    </div>
  );
};
