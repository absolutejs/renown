// Head-to-head: two devs compared across every renown dimension, with a verdict. Reuses the
// shared profile loader so /vs can't drift from profiles. Powers the public /api/vs/:a/:b, the
// /vs/:a/:b page, and its OG card.
import { loadProfile } from "./profile.ts";

export type VsSide = {
  login: string; handle: string; tier: string; isAi: boolean; avatarSeed: string | null;
  score: number; totalLevel: number; achievements: number; petsCount: number; rarestPetScore: number;
  reviews: number; crossRepo: number; merged: number; downloads: number;
};
export type VsDim = { key: string; label: string; a: number; b: number; winner: "a" | "b" | "tie"; float?: boolean };
export type Versus = { a: VsSide; b: VsSide; dims: VsDim[]; verdict: { leader: "a" | "b" | "tie"; text: string; aWins: number; bWins: number } };

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : Math.round(n).toLocaleString("en-US"));

type Profile = NonNullable<Awaited<ReturnType<typeof loadProfile>>>;
const sideOf = (p: Profile): VsSide => ({
  login: p.login, handle: p.handle, tier: p.tier, isAi: p.isAi, avatarSeed: p.avatarSeed,
  score: p.score, totalLevel: p.totalLevel, achievements: Array.isArray(p.achievements) ? p.achievements.length : 0,
  petsCount: p.petsCount, rarestPetScore: p.rarestPetScore,
  reviews: p.merit.reviews, crossRepo: p.merit.crossRepo, merged: p.merit.merged, downloads: p.merit.downloads,
});

export const loadVersus = async (aLogin: string, bLogin: string): Promise<Versus | { error: string; missing?: string }> => {
  if (aLogin.toLowerCase() === bLogin.toLowerCase()) return { error: "pick two different devs" };
  const [pa, pb] = await Promise.all([loadProfile(aLogin), loadProfile(bLogin)]);
  if (!pa) return { error: "not found", missing: aLogin };
  if (!pb) return { error: "not found", missing: bLogin };
  const a = sideOf(pa), b = sideOf(pb);

  const win = (x: number, y: number): "a" | "b" | "tie" => (x > y ? "a" : y > x ? "b" : "tie");
  const dims: VsDim[] = [
    { key: "score", label: "Renown", a: a.score, b: b.score, winner: win(a.score, b.score) },
    { key: "totalLevel", label: "Total level", a: a.totalLevel, b: b.totalLevel, winner: win(a.totalLevel, b.totalLevel) },
    { key: "achievements", label: "Achievements", a: a.achievements, b: b.achievements, winner: win(a.achievements, b.achievements) },
    { key: "pets", label: "Pets", a: a.petsCount, b: b.petsCount, winner: win(a.petsCount, b.petsCount) },
    { key: "rarestPet", label: "Rarest pet", a: a.rarestPetScore, b: b.rarestPetScore, winner: win(a.rarestPetScore, b.rarestPetScore), float: true },
    { key: "reviews", label: "PR reviews", a: a.reviews, b: b.reviews, winner: win(a.reviews, b.reviews) },
    { key: "crossRepo", label: "Cross-repo PRs", a: a.crossRepo, b: b.crossRepo, winner: win(a.crossRepo, b.crossRepo) },
    { key: "merged", label: "PRs merged", a: a.merged, b: b.merged, winner: win(a.merged, b.merged) },
    { key: "downloads", label: "npm DLs/mo", a: a.downloads, b: b.downloads, winner: win(a.downloads, b.downloads) },
  ];

  const aWins = dims.filter((d) => d.winner === "a").length;
  const bWins = dims.filter((d) => d.winner === "b").length;
  const margin = Math.abs(a.score - b.score);
  const leader: "a" | "b" | "tie" = a.score > b.score ? "a" : b.score > a.score ? "b" : "tie";
  // Two separate truths: who leads on RENOWN (the headline) and who takes more CATEGORIES. They
  // can disagree (a high score on one axis vs broad wins) — say so honestly rather than conflate.
  const catWins = Math.max(aWins, bWins);
  const catLeader: "a" | "b" | "tie" = aWins > bWins ? "a" : bWins > aWins ? "b" : "tie";
  let text: string;
  if (leader === "tie") {
    text = `@${a.login} and @${b.login} are dead even on renown — categories ${aWins}–${bWins}.`;
  } else {
    const lead = leader === "a" ? a : b, trail = leader === "a" ? b : a;
    const verb = margin > lead.score * 0.25 ? "leads" : "edges";
    if (catLeader === "tie") text = `@${lead.login} ${verb} @${trail.login} by ${fmt(margin)} renown · categories split ${aWins}–${bWins}.`;
    else if (catLeader === leader) text = `@${lead.login} ${verb} @${trail.login} by ${fmt(margin)} renown · winning ${catWins} of ${dims.length} categories.`;
    else text = `@${lead.login} ${verb} @${trail.login} by ${fmt(margin)} renown — but @${(catLeader === "a" ? a : b).login} takes ${catWins} of ${dims.length} categories.`;
  }

  return { a, b, dims, verdict: { leader, text, aWins, bWins } };
};
