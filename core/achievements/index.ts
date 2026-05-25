// Renown — unified achievement API. Combines curated (~290, predicate checks) with the
// procedural catalog (≥10k, direct threshold eval). evalAll uses a Set for O(1)
// "already unlocked" checks and never scans the 10k (generated eval is direct compute).
import type { State } from "../state.ts";
import { CURATED } from "./curated.ts";
import { catalog, evalGenerated, genCount, genMap } from "./generated.ts";

export type { Ach, Tier, Vis } from "./curated.ts";
export type { Def } from "./generated.ts";
export { CURATED };
export const generatedCatalog = catalog;

export interface AchInfo { id: string; name: string; desc: string; cat: string; tier: string; vis: string; generated: boolean }

const curatedMap = new Map(CURATED.map(a => [a.id, a]));
export function info(id: string): AchInfo | undefined {
  const c = curatedMap.get(id);
  if (c) return { id: c.id, name: c.name, desc: c.desc, cat: c.cat, tier: c.tier, vis: c.vis, generated: false };
  const g = genMap().get(id);
  return g ? { id: g.id, name: g.name, desc: g.desc, cat: g.cat, tier: g.tier, vis: g.vis, generated: true } : undefined;
}
export const totalCount = () => CURATED.length + genCount();
export const curatedCount = () => CURATED.length;

// returns newly-unlocked ids. `have` = the player's already-unlocked ids (Set is fastest).
export function evalAll(s: State, have: Iterable<string>): string[] {
  const unlocked = have instanceof Set ? have : new Set(have);
  const out: string[] = [];
  for (const a of CURATED) if (!unlocked.has(a.id) && a.check(s)) out.push(a.id);   // ~290 predicate checks
  for (const id of evalGenerated(s, unlocked)) out.push(id);                        // direct, no 10k scan
  return out;
}
