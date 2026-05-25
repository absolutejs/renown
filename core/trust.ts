// Anti-gaming. renown is open source and commit-driven, so the FUN layer (local XP, skills,
// levels, the HUD) is deliberately NOT gated — faking your own dashboard is pointless and
// it's good motivation. But anything that confers STATUS or OWNERSHIP (ownable collectibles,
// coins, crates, on-chain 1/1s, the global leaderboard) must be EARNED from work that stays
// hard to fake even when the formula is public.
//
// The only signals a formula-reader cannot fake are ones that require OTHER humans to
// validate the work:
//   • public + licensed OSS  → accountable, tied to your real identity, reputationally costly
//   • stars                  → other people valued it
//   • commits to repos you DON'T own (ext) → maintainers accepted/merged them
// Private throwaway commits, bot-farmed history, and "I edited my local state" confer 0
// ownership. The real enforcement is SERVER-SIDE: the reward path recomputes this from the
// GitHub API (commit exists, you authored it, the repo's stars/license/owner are real), and
// the on-chain Attestation only signs a fact that GitHub independently confirms. This file is
// the shared, auditable scoring; the thresholds + anomaly model can stay private server-side.
import type { CraftResult } from "./craft.ts";

// 0..1 — how externally validated / accountable this work is (NOT how much effort it took).
export const genuineness = (c: CraftResult): number => {
  let g = c.oss ? 0.5 : c.repoPublic ? 0.3 : 0;          // public+licensed > public original > private/local(0)
  if (c.ext) g += 0.35;                                   // someone else's repo accepted your work
  if (c.stars > 0) g += Math.min(0.25, Math.log10(c.stars + 1) * 0.1);  // others starred it
  return Math.min(1, g);
};

// tunable; server-side recompute is the real gate. Public/accountable work clears it,
// private/local/fake work does not — and rare rewards still favor higher genuineness.
export const OWNABLE_THRESHOLD = 0.3;
export const isOwnable = (c: CraftResult) => genuineness(c) >= OWNABLE_THRESHOLD;

// reward-bearing value = effort × external validation (kept separate from local "fun" XP).
// This is what coins/crates/ownership draw on — fun XP (c.xp) is never spent here.
export const rewardValue = (c: CraftResult) => Math.round(c.xp * genuineness(c));
