// Tiny Web Audio voice bank. Synth-only (no asset loading), so first-trigger latency is
// the Web Audio sample-rate setup (~5–15 ms) and nothing else. Feature-flagged via
// localStorage 'renown:sound' (default off — no surprise sounds on first visit). Hooked
// into the user-gesture chain in setSoundOn() because most browsers refuse to start an
// AudioContext until they see a real interaction; calling setSoundOn(true) from a click
// handler satisfies that and warms the context for future event-driven plays.

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
const SOUND_KEY = "renown:sound";

const ensureCtx = () => {
  if (ctx) return ctx;
  const C = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.18;     // headroom-friendly default; voices add on top of this
  masterGain.connect(ctx.destination);
  return ctx;
};

/** Read current preference. SSR-safe — returns false off the server. */
export const isSoundOn = () => typeof window !== "undefined" && window.localStorage?.getItem(SOUND_KEY) === "on";

/** Persist preference + warm the AudioContext when enabling. Call from a user click. */
export const setSoundOn = (on: boolean) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  if (on) {
    const c = ensureCtx();
    if (c && c.state === "suspended") void c.resume();
  }
};

// ── Voice helpers ──────────────────────────────────────────────────────────
// Each voice schedules a small oscillator + gain envelope at currentTime+0 and lets it
// disconnect itself when finished. No persistent state, no lingering nodes.

type Wave = OscillatorType;
const note = (freq: number, durationS: number, waveType: Wave, peakGain: number, attackS = 0.005, releaseS = 0.12, detune = 0) => {
  if (!isSoundOn()) return;
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = waveType;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peakGain, t0 + attackS);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationS + releaseS);
  osc.connect(g).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + durationS + releaseS + 0.02);
  osc.onended = () => { osc.disconnect(); g.disconnect(); };
};

/** Bell — short bright ping. Used for leaderboard newcomer arrival. */
export const playBell = () => {
  note(880, 0.18, "triangle", 0.22, 0.003, 0.18);
  note(1320, 0.14, "sine", 0.10, 0.003, 0.14, 5);   // shimmer harmonic, slightly detuned
};

/** Chime — slightly longer, lusher. Used per-pet inside the summon cinematic. */
export const playChime = () => {
  note(523.25, 0.22, "sine", 0.18, 0.004, 0.22);       // C5
  note(659.25, 0.22, "triangle", 0.14, 0.005, 0.22);   // E5
  note(783.99, 0.30, "sine", 0.10, 0.006, 0.30, -3);   // G5 (slightly flat for warmth)
};

/** Gong — low cosmic hit. Used when hovering a row on a rare/big board. Throttled by
 *  callers so it doesn't machine-gun on cursor drag through the list. */
export const playGong = () => {
  note(82, 0.45, "triangle", 0.20, 0.008, 0.45);
  note(164, 0.35, "sine", 0.08, 0.010, 0.35, 4);
};
