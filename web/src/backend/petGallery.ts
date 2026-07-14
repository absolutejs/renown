// Public pet gallery. Default mode is the actual chronological mint stream, backed by
// wild_seed_sources. The optional owners mode keeps the old discovery behavior (one newest
// pet per recently-active verified owner). Both use opaque keyset cursors, so page cost stays
// constant as the collection grows and new mints cannot shift already-loaded rows.
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { players, wildSeedSources } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { gameDb } from "./sync.ts";

export type PetGalleryMode = "latest" | "owners";
export type GalleryPet = {
  seed: string;
  login: string | null;
  handle: string;
  tier: string;
  isAi: boolean;
  earnedAt: string | null;
};
export type GalleryPage = { pets: GalleryPet[]; nextCursor: string | null; mode: PetGalleryMode };

type GalleryCursor = { mode: PetGalleryMode; at: string; id: string };
const encodeCursor = (cursor: GalleryCursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
const decodeCursor = (raw: unknown, mode: PetGalleryMode): GalleryCursor | null => {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<GalleryCursor>;
    if (value.mode !== mode || typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at)) || typeof value.id !== "string") return null;
    return value as GalleryCursor;
  } catch { return null; }
};

export const normalizePetGalleryMode = (raw: unknown): PetGalleryMode => raw === "owners" ? "owners" : "latest";

export const loadRecentPets = async ({
  limit: rawLimit = 24,
  cursor: rawCursor,
  mode: rawMode = "latest",
}: { limit?: number; cursor?: unknown; mode?: unknown } = {}): Promise<GalleryPage> => {
  const limit = Math.max(1, Math.min(60, Number(rawLimit) || 24));
  const mode = normalizePetGalleryMode(rawMode);
  const cursor = decodeCursor(rawCursor, mode);

  if (mode === "owners") {
    const cursorWhere = cursor
      ? or(lt(players.verifiedAt, new Date(cursor.at)), and(eq(players.verifiedAt, new Date(cursor.at)), lt(players.id, cursor.id)))
      : undefined;
    const rows = await gameDb
      .select({ id: players.id, login: players.githubLogin, handle: players.handle, tier: players.tier, isAi: players.isAi, wild: players.wild, verifiedAt: players.verifiedAt })
      .from(players)
      .where(and(eq(players.githubVerified, true), sql`jsonb_array_length(${players.wild}) > 0`, cursorWhere))
      .orderBy(desc(players.verifiedAt), desc(players.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const pets = pageRows.flatMap((row) => {
      const seed = (Array.isArray(row.wild) ? row.wild : [])[0];
      return seed ? [{ seed, login: row.login, handle: row.handle, tier: normalizeTier(row.tier), isAi: row.isAi, earnedAt: row.verifiedAt?.toISOString() ?? null }] : [];
    });
    const last = pageRows.at(-1);
    return {
      mode,
      pets,
      nextCursor: hasMore && last?.verifiedAt ? encodeCursor({ mode, at: last.verifiedAt.toISOString(), id: last.id }) : null,
    };
  }

  const cursorWhere = cursor
    ? or(
        lt(wildSeedSources.earnedAt, new Date(cursor.at)),
        and(eq(wildSeedSources.earnedAt, new Date(cursor.at)), lt(wildSeedSources.petSeed, cursor.id)),
      )
    : undefined;
  const rows = await gameDb
    .select({
      seed: wildSeedSources.petSeed,
      earnedAt: wildSeedSources.earnedAt,
      login: players.githubLogin,
      handle: players.handle,
      tier: players.tier,
      isAi: players.isAi,
    })
    .from(wildSeedSources)
    .innerJoin(players, eq(players.id, wildSeedSources.playerId))
    .where(and(eq(players.githubVerified, true), cursorWhere))
    .orderBy(desc(wildSeedSources.earnedAt), desc(wildSeedSources.petSeed))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const pets = pageRows.map((row) => ({
    seed: row.seed,
    login: row.login,
    handle: row.handle,
    tier: normalizeTier(row.tier),
    isAi: row.isAi,
    earnedAt: row.earnedAt.toISOString(),
  }));
  const last = pageRows.at(-1);
  return {
    mode,
    pets,
    nextCursor: hasMore && last ? encodeCursor({ mode, at: last.earnedAt.toISOString(), id: last.seed }) : null,
  };
};
