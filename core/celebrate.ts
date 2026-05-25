// Celebrations — the reward moment. Level-ups, achievement unlocks, slain bosses and
// total-level milestones become tiered Celebrations that get queued to a file the status
// line drains one-per-refresh, so a big commit sends a *parade* of toasts across your
// HUD over the next several seconds. Tier escalates the styling (tier 4 = the rarest,
// loudest moments — the hook phase 4 swaps for full ASCII animations).
import { readFileSync, writeFileSync } from "node:fs";
import { C, RDIR } from "./runtime.ts";

export const CELEBRATIONS = `${RDIR}/celebrations.txt`;
const QUEUE_CAP = 40;

export interface Celebration { tier: number; text: string }

// tier 1 minor · 2 notable · 3 big · 4 epic — styling gets louder as it climbs
export const renderCelebration = (c: Celebration): string => {
  if (c.tier >= 4) return `${C.b}${C.gold}${C.inv} ✦ ${c.text} ✦ ${C.r}`;
  if (c.tier === 3) return `${C.b}${C.gold}★ ${c.text} ★${C.r}`;
  if (c.tier === 2) return `${C.b}${C.cyn}✧ ${c.text}${C.r}`;
  return `${C.grn}⬆ ${c.text}${C.r}`;
};

export const skillUp = (icon: string, name: string, level: number): Celebration => {
  const tier = level >= 99 ? 4 : level >= 50 ? 3 : level % 10 === 0 ? 2 : 1;
  const text = level >= 99 ? `MASTERY — ${icon} ${name} 99` : `${icon} ${name} Lv${level}`;
  return { tier, text };
};
export const achievementUp = (name: string, tier = 2): Celebration => ({ tier, text: `🏆 ${name}` });
export const bossUp = (): Celebration => ({ tier: 2, text: "⚔ Boss slain" });
export const totalUp = (total: number): Celebration => ({ tier: total % 100 === 0 ? 4 : total % 50 === 0 ? 3 : 2, text: `Total Level ${total}` });

// append rendered celebrations to the drain file (capped so it never grows unbounded)
export const enqueue = (cels: Celebration[]) => {
  if (!cels.length) return;
  try {
    let existing: string[] = [];
    try { existing = readFileSync(CELEBRATIONS, "utf8").split("\n").filter(Boolean); } catch {}
    const all = [...existing, ...cels.map(renderCelebration)].slice(-QUEUE_CAP);
    writeFileSync(CELEBRATIONS, all.join("\n") + "\n");
  } catch {}
};
