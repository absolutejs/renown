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

/** Chime — slightly longer, lusher. Used per-pet inside the summon cinematic. The optional
 *  voice arg lets the caller select a tier-driven cluster so the sound carries information:
 *  Common is a quiet major third; Legendary stacks a fifth and shimmer; Mythic adds an
 *  upper-cluster dissonance; 1/1 detunes overtones for an unsettled, "this is special" feel.
 *  No-arg call falls back to "common" so non-cinematic callers stay simple. */
export type ChimeVoice = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic" | "oneOfOne";
export const playChime = (voice: ChimeVoice = "common") => {
  // Each voice = [freq, durationS, wave, gain, detuneCents][] — kept flat so it's obvious
  // at a glance which voice does what and so detuning / overtones can be tuned per tier
  // without reshaping the data.
  const v: Record<ChimeVoice, [number, number, Wave, number, number][]> = {
    common:    [[523.25, 0.22, "sine",     0.16, 0],
                [659.25, 0.22, "triangle", 0.12, 0]],
    uncommon:  [[523.25, 0.22, "sine",     0.18, 0],
                [659.25, 0.22, "triangle", 0.14, 0],
                [783.99, 0.28, "sine",     0.10, -3]],
    rare:      [[587.33, 0.24, "sine",     0.18, 0],
                [739.99, 0.24, "triangle", 0.14, 0],
                [880.00, 0.30, "sine",     0.10, -4]],
    epic:      [[622.25, 0.26, "sine",     0.18, 0],
                [783.99, 0.26, "triangle", 0.14, 4],
                [932.33, 0.30, "sine",     0.12, -3],
                [1244.5, 0.20, "sine",     0.06, 8]],
    // Heavier stack — fifth + shimmer harmonic an octave up, with the third sweetened.
    legendary: [[659.25, 0.28, "sine",     0.18, -2],
                [830.61, 0.28, "triangle", 0.14, 0],
                [987.77, 0.32, "sine",     0.12, 0],
                [1318.5, 0.22, "sine",     0.08, 5]],
    // Upper-register cluster with a deliberate semitone bite so it reads as "uncommon
    // important" rather than just "loud chime."
    mythic:    [[783.99, 0.32, "sine",     0.18, 0],
                [932.33, 0.32, "triangle", 0.14, 3],
                [1108.7, 0.36, "sine",     0.12, -5],
                [1244.5, 0.28, "sine",     0.08, 7],
                [1661.2, 0.22, "triangle", 0.06, 10]],
    // 1/1 — unsettled overtones; not pretty, but unforgettable. Detuned cents push it
    // slightly out of tune on purpose, like the pet is leaking into adjacent frequencies.
    oneOfOne:  [[880.00, 0.36, "triangle", 0.18, 0],
                [1046.5, 0.36, "sine",     0.14, -12],
                [1318.5, 0.40, "sine",     0.12, 15],
                [1567.9, 0.32, "triangle", 0.10, -22],
                [2093.0, 0.28, "sine",     0.07, 30]],
  };
  for (const [f, d, w, g, dt] of v[voice]) note(f, d, w, g, 0.005, Math.max(0.22, d), dt);
};

/** Map a creature's tier/oneOfOne to a chime voice. Kept here so callers don't have to know
 *  the rarity ladder; just pass the pet. */
export const chimeVoiceFor = (tier: string | undefined | null, oneOfOne = false, mythicAura = false): ChimeVoice => {
  if (oneOfOne) return "oneOfOne";
  if (mythicAura || tier === "Mythic") return "mythic";
  if (tier === "Legendary") return "legendary";
  if (tier === "Epic") return "epic";
  if (tier === "Rare") return "rare";
  if (tier === "Uncommon") return "uncommon";
  return "common";
};

/** Gong — low cosmic hit. Used when hovering a row on a rare/big board. Throttled by
 *  callers so it doesn't machine-gun on cursor drag through the list. */
export const playGong = () => {
  note(82, 0.45, "triangle", 0.20, 0.008, 0.45);
  note(164, 0.35, "sine", 0.08, 0.010, 0.35, 4);
};

// ── Ambient pad ────────────────────────────────────────────────────────────
// A slow, breathing sine bed for the menagerie. Two octaves stacked, routed through a
// lowpass whose cutoff is gently swept by an LFO so the timbre opens and closes over
// ~14 seconds. Master gain stays under the event voices so a bell/chime/gong still
// reads clearly on top. Started by startAmbientPad(); stopAmbientPad() does a 0.6s
// release so closing it doesn't click.

let ambientNodes: { osc1: OscillatorNode; osc2: OscillatorNode; lfo: OscillatorNode; lfoGain: GainNode; filter: BiquadFilterNode; gain: GainNode } | null = null;

export const startAmbientPad = () => {
  if (!isSoundOn()) return;
  if (ambientNodes) return;          // idempotent — caller can spam this safely
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const t0 = c.currentTime;

  // Voices: a low C2 + a perfect fifth above, both sine. Subtle, lush, low presence.
  const osc1 = c.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 65.41;       // C2
  const osc2 = c.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 98.00;       // G2
  osc2.detune.value = -8;             // hairline-flat for warmth

  // Slow LFO that opens/closes a lowpass cutoff: 280Hz ± 220Hz over a ~14s cycle.
  const lfo = c.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 1 / 14;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 220;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 280;
  filter.Q.value = 1.2;
  lfo.connect(lfoGain).connect(filter.frequency);

  // Master pad gain, lifted gently from 0 so the pad fades in instead of popping.
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.045, t0 + 1.6);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain).connect(masterGain);

  osc1.start(t0);
  osc2.start(t0);
  lfo.start(t0);
  ambientNodes = { osc1, osc2, lfo, lfoGain, filter, gain };
};

/** Add a transient voice to the ambient pad — a single sine that fades in then out over
 *  ~60s, routed through the pad's own filter so it sits in the same acoustic space. Each
 *  caller picks from a small consonant chord against the base C-G drone so additions can
 *  pile up without dissonance. Used to make the pad acoustically reflect activity (each
 *  leaderboard update = one more voice for a minute, then it decays back). No-ops when
 *  the pad isn't running. */
const padChord = [196.00, 246.94, 293.66, 392.00, 493.88, 587.33]; // G3 B3 D4 G4 B4 D5
export const addPadVoice = () => {
  if (!ambientNodes || !ctx || !masterGain) return;
  const c = ctx;
  const { filter } = ambientNodes;
  const t0 = c.currentTime;
  const freq = padChord[Math.floor(Math.random() * padChord.length)] ?? padChord[0]!;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.detune.value = (Math.random() - 0.5) * 18;     // small detune so stacked voices beat slightly
  const g = c.createGain();
  // Envelope: 4s in → hold ~50s → 6s out. Peak gain stays modest so a long burst of
  // activity doesn't clobber the pad's headroom.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.020, t0 + 4);
  g.gain.setValueAtTime(0.020, t0 + 54);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 60);
  osc.connect(g).connect(filter);   // share the pad's lowpass + LFO sweep
  osc.start(t0);
  osc.stop(t0 + 60.2);
  osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch { /* already torn down */ } };
};

export const stopAmbientPad = () => {
  if (!ambientNodes || !ctx) return;
  const t0 = ctx.currentTime;
  const { osc1, osc2, lfo, gain } = ambientNodes;
  // Release over 0.6s, then stop the oscillators a hair later so the ramp completes.
  gain.gain.cancelScheduledValues(t0);
  gain.gain.setValueAtTime(gain.gain.value, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
  osc1.stop(t0 + 0.7);
  osc2.stop(t0 + 0.7);
  lfo.stop(t0 + 0.7);
  osc1.onended = () => { try { osc1.disconnect(); osc2.disconnect(); lfo.disconnect(); gain.disconnect(); } catch { /* already torn down */ } };
  ambientNodes = null;
};
