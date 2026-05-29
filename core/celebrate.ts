// Celebrations — the reward moment. Level-ups, achievement unlocks, slain bosses and
// total-level milestones become tiered Celebrations that get queued to a file the status
// line drains one-per-refresh, so a big commit sends a *parade* of toasts across your
// HUD over the next several seconds. Tier escalates the styling (tier 4 = the rarest,
// loudest moments — the hook phase 4 swaps for full ASCII animations).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { C, RDIR } from "./runtime.ts";
import { B, R, gradient, rainbow, shimmer } from "./shiny.ts";

export const CELEBRATIONS = `${RDIR}/celebrations.txt`;
const QUEUE_CAP = 60;
const RAINBOW_FRAMES = 7, SHIMMER_FRAMES = 3;

export interface Celebration { tier: number; text: string }

// One celebration → one or more rendered frames (the status line pops one per refresh, so
// extra frames animate). Shine escalates with tier so the rare stuff is unmistakable:
//   1 plain green · 2 cyan→blue gradient · 3 gold shimmer (sweeps) · 4 scrolling RAINBOW.
const framesFor = (c: Celebration): string[] => {
  if (c.tier >= 4) {
    const txt = `✦ ${c.text} ✦`;
    return Array.from({ length: RAINBOW_FRAMES }, (_, i) => B + rainbow(txt, i / RAINBOW_FRAMES));
  }
  if (c.tier === 3) {
    const txt = `★ ${c.text} ★`, len = [...txt].length;
    return Array.from({ length: SHIMMER_FRAMES }, (_, i) => B + shimmer(txt, Math.round((i / (SHIMMER_FRAMES - 1)) * (len - 1))));
  }
  if (c.tier === 2) return [gradient(`✧ ${c.text}`, [120, 220, 255], [130, 140, 255])];
  return [`${C.grn}⬆ ${c.text}${R}`];
};

export const skillUp = (icon: string, name: string, level: number): Celebration => {
  const tier = level >= 99 ? 4 : level >= 50 ? 3 : level % 10 === 0 ? 2 : 1;
  const text = level >= 99 ? `MASTERY — ${icon} ${name} 99` : `${icon} ${name} Lv${level}`;
  return { tier, text };
};
export const achievementUp = (name: string, tier = 2): Celebration => ({ tier, text: `🏆 ${name}` });
export const bossUp = (): Celebration => ({ tier: 2, text: "⚔ Boss slain" });
export const totalUp = (total: number): Celebration => ({ tier: total % 100 === 0 ? 4 : total % 50 === 0 ? 3 : 2, text: `Total Level ${total}` });

// expand celebrations into frames and append to the drain file (capped, never unbounded)
export const enqueue = (cels: Celebration[]) => {
  const frames = cels.flatMap(framesFor);
  if (!frames.length) return;
  try {
    let existing: string[] = [];
    try { existing = readFileSync(CELEBRATIONS, "utf8").split("\n").filter(Boolean); } catch {}
    writeFileSync(CELEBRATIONS, [...existing, ...frames].slice(-QUEUE_CAP).join("\n") + "\n");
  } catch {}
};

// Pop the oldest queued frame — the status line calls this once per refresh, so a big
// commit's parade of toasts scrolls across the HUD one-by-one over the next seconds.
// (The node bundle in cli/api.ts duplicates this; keep the two in sync.)
export const popCelebration = (): string | undefined => {
  try {
    if (!existsSync(CELEBRATIONS)) return undefined;
    const lines = readFileSync(CELEBRATIONS, "utf8").split("\n").filter(Boolean);
    const next = lines.shift();
    if (next === undefined) return undefined;
    const tmp = `${CELEBRATIONS}.tmp`;
    writeFileSync(tmp, lines.length ? `${lines.join("\n")}\n` : "");
    renameSync(tmp, CELEBRATIONS);
    return next;
  } catch { return undefined; }
};
