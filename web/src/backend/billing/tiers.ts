// Tier model — revenue / cost-offset ONLY, explicitly NOT pay-to-win.
//
// Everything that makes renown *renown* is free for everyone: all skills, achievements,
// procedural 1/1 creatures, wild drops, adopting companions, on-chain ownership of what you
// genuinely earn, and your rank on the public leaderboard. Paid tiers never touch verified_score
// or rank. They buy: a supporter badge + cosmetic flair, higher refresh/verify limits (the real
// cost driver we're offsetting), and B2B extras (private boards, analytics, a personal API key).

export type Tier = "free" | "supporter" | "pro";
export const TIERS: Tier[] = ["free", "supporter", "pro"];
const RANK: Record<Tier, number> = { free: 0, supporter: 1, pro: 2 };

export const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as string[]).includes(v);
export const normalizeTier = (v: unknown): Tier => (isTier(v) ? v : "free");
// "at least this tier" — pro satisfies a supporter requirement.
export const atLeast = (have: unknown, need: Tier) => RANK[normalizeTier(have)] >= RANK[need];

// Cost meter: minimum gap between authoritative GitHub recomputes, by tier. Generous-but-bounded
// for free; faster for paid. This changes only how OFTEN your score refreshes, never the score.
export const REVERIFY_COOLDOWN_MS: Record<Tier, number> = {
  free: 10 * 60_000,       // 10 min
  pro: 20_000,             // 20 s — near on-demand
  supporter: 2 * 60_000,   // 2 min
};

// Stripe price <-> tier mapping (env-configured; filled in once the Stripe account exists).
export const priceToTier = (priceId: string | undefined | null): Tier | undefined => {
  if (!priceId) return undefined;
  if (priceId === process.env.STRIPE_PRICE_SUPPORTER) return "supporter";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  return undefined;
};
export const tierToPrice = (tier: Tier): string | undefined =>
  tier === "supporter" ? process.env.STRIPE_PRICE_SUPPORTER
  : tier === "pro" ? process.env.STRIPE_PRICE_PRO
  : undefined;

// Public description of each tier (pricing UI / docs).
export const TIER_INFO: Record<Tier, { name: string; blurb: string; perks: string[] }> = {
  free: {
    name: "Free", blurb: "The whole game, forever.",
    perks: ["All skills, achievements & serialized pets", "Public leaderboard ranking", "On-chain ownership of what you genuinely earn"],
  },
  pro: {
    name: "Pro", blurb: "For power users & small teams.",
    perks: ["Everything in Supporter", "Near on-demand verify / recompute", "Private leaderboards + advanced analytics", "Personal API access (M2M client)"],
  },
  supporter: {
    name: "Supporter", blurb: "Keep renown running — and a thank-you.",
    perks: ["Supporter badge on the leaderboard", "Cosmetic HUD themes", "Faster verify refresh"],
  },
};
