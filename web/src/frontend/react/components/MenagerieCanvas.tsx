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
import { View } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";

export const MenagerieCanvas = () => {
  // Mount-gate the canvas so SSR doesn't try to set up WebGL.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <div className="viewportCanvas">
      <Canvas
        dpr={[1, 1.3]}
        gl={{ alpha: true, antialias: true }}
        eventSource={document.body}
        eventPrefix="client"
        frameloop="always"
      >
        <View.Port />
      </Canvas>
    </div>
  );
};
