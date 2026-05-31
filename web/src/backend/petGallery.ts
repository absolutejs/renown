// The public pet gallery (/pets) — a browsable stream of the latest 1/1s minted across renown.
// players.wild is stored newest-first (new commit seeds are prepended on each verify), so wild[0]
// is a player's most-recent hatch; ordering players by verifiedAt surfaces the freshest activity.
// One pet per recently-active dev keeps it a varied feed rather than one whale's whole wild.
import { and, desc, eq, sql } from "drizzle-orm";
import { players } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { gameDb } from "./sync.ts";

export type GalleryPet = { seed: string; login: string | null; handle: string; tier: string; isAi: boolean };

export const loadRecentPets = async (n = 48): Promise<GalleryPet[]> => {
  const rows = await gameDb
    .select({ login: players.githubLogin, handle: players.handle, tier: players.tier, isAi: players.isAi, wild: players.wild })
    .from(players)
    .where(and(eq(players.githubVerified, true), sql`jsonb_array_length(${players.wild}) > 0`))
    .orderBy(desc(players.verifiedAt))
    .limit(n);
  const seen = new Set<string>();
  return rows
    .map((r) => ({ seed: (Array.isArray(r.wild) ? r.wild : [])[0], login: r.login, handle: r.handle, tier: normalizeTier(r.tier), isAi: r.isAi }))
    .filter((p) => p.seed && !seen.has(p.seed) && seen.add(p.seed));
};
