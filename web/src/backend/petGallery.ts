// Database-backed pet discovery and inventory. Deterministic procgen metadata is
// materialized in wild_seed_sources so search/filter/sort remains keyset-paginated.
import { and, asc, desc, eq, gt, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { petPrintings, players, wildSeedSources } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { getPlayerPetLookAssignments } from "./petLooks.ts";
import { gameDb } from "./sync.ts";

export type PetGalleryMode = "latest" | "owners";
export type PetSort = "newest" | "rarest" | "biggest" | "name";
export type GalleryPet = {
  seed: string;
  login: string | null;
  handle: string;
  tier: string;
  isAi: boolean;
  earnedAt: string | null;
  name: string;
  rarityScore: number;
  size: number;
  species: string;
  aura: string;
  oneOfOne: boolean;
  printingId: string | null;
  serialNumber: number | null;
  printRun: number | null;
  finish: string | null;
  mutation: string | null;
  material: string | null;
  colorway: string | null;
  copyPattern: string | null;
  population: number | null;
  sizeRank: number | null;
  isAvatar?: boolean;
  lookId?: string;
};
export type GalleryPage = { pets: GalleryPet[]; nextCursor: string | null; mode: PetGalleryMode; total: number; sort: PetSort };

type GalleryCursor = { mode: PetGalleryMode; sort: PetSort; value: string | number; id: string };
const encodeCursor = (cursor: GalleryCursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
const decodeCursor = (raw: unknown, mode: PetGalleryMode, sort: PetSort): GalleryCursor | null => {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<GalleryCursor>;
    if (value.mode !== mode || value.sort !== sort || (typeof value.value !== "string" && typeof value.value !== "number") || typeof value.id !== "string") return null;
    return value as GalleryCursor;
  } catch { return null; }
};

export const normalizePetGalleryMode = (raw: unknown): PetGalleryMode => raw === "owners" ? "owners" : "latest";
export const normalizePetSort = (raw: unknown): PetSort => raw === "rarest" || raw === "biggest" || raw === "name" ? raw : "newest";
const cleanFilter = (raw: unknown) => typeof raw === "string" ? raw.trim().slice(0, 80) : "";

const cursorCondition = (cursor: GalleryCursor | null, sort: PetSort): SQL | undefined => {
  if (!cursor) return undefined;
  if (sort === "rarest" && typeof cursor.value === "number") return or(lt(wildSeedSources.rarityScore, cursor.value), and(eq(wildSeedSources.rarityScore, cursor.value), lt(wildSeedSources.petSeed, cursor.id)));
  if (sort === "biggest" && typeof cursor.value === "number") return or(lt(wildSeedSources.size, cursor.value), and(eq(wildSeedSources.size, cursor.value), lt(wildSeedSources.petSeed, cursor.id)));
  if (sort === "name" && typeof cursor.value === "string") return or(gt(wildSeedSources.name, cursor.value), and(eq(wildSeedSources.name, cursor.value), gt(wildSeedSources.petSeed, cursor.id)));
  if (typeof cursor.value === "string" && Number.isFinite(Date.parse(cursor.value))) {
    const at = new Date(cursor.value);
    return or(lt(wildSeedSources.earnedAt, at), and(eq(wildSeedSources.earnedAt, at), lt(wildSeedSources.petSeed, cursor.id)));
  }
  return undefined;
};

const orderFor = (sort: PetSort) => sort === "rarest"
  ? [desc(wildSeedSources.rarityScore), desc(wildSeedSources.petSeed)] as const
  : sort === "biggest"
    ? [desc(wildSeedSources.size), desc(wildSeedSources.petSeed)] as const
    : sort === "name"
      ? [asc(wildSeedSources.name), asc(wildSeedSources.petSeed)] as const
      : [desc(wildSeedSources.earnedAt), desc(wildSeedSources.petSeed)] as const;

const cursorValue = (row: { earnedAt: Date; rarityScore: number; size: number; name: string }, sort: PetSort) =>
  sort === "rarest" ? row.rarityScore : sort === "biggest" ? row.size : sort === "name" ? row.name : row.earnedAt.toISOString();

type PetQuery = { limit?: number; cursor?: unknown; mode?: unknown; sort?: unknown; q?: unknown; tier?: unknown; species?: unknown; finish?: unknown; mutation?: unknown; material?: unknown; colorway?: unknown; pattern?: unknown };

const loadPets = async (query: PetQuery, playerId?: string, avatarSeed?: string | null): Promise<GalleryPage> => {
  const limit = Math.max(1, Math.min(60, Number(query.limit) || 24));
  const mode = normalizePetGalleryMode(query.mode);
  const sort = normalizePetSort(query.sort);
  const cursor = decodeCursor(query.cursor, mode, sort);
  const q = cleanFilter(query.q);
  const tier = cleanFilter(query.tier);
  const species = cleanFilter(query.species);
  const finish = cleanFilter(query.finish);
  const mutation = cleanFilter(query.mutation);
  const material = cleanFilter(query.material);
  const colorway = cleanFilter(query.colorway);
  const pattern = cleanFilter(query.pattern);
  const filters: (SQL | undefined)[] = [
    eq(players.githubVerified, true),
    playerId ? eq(wildSeedSources.playerId, playerId) : undefined,
    q ? or(ilike(wildSeedSources.name, `%${q}%`), ilike(wildSeedSources.petSeed, `%${q}%`), ilike(wildSeedSources.githubLogin, `%${q}%`)) : undefined,
    tier && tier !== "all" ? eq(wildSeedSources.tier, tier) : undefined,
    species && species !== "all" ? eq(wildSeedSources.species, species) : undefined,
    finish && finish !== "all" ? eq(wildSeedSources.finish, finish) : undefined,
    mutation === "mutated" ? sql`${wildSeedSources.mutation} <> 'Standard'` : mutation && mutation !== "all" ? eq(wildSeedSources.mutation, mutation) : undefined,
    material && material !== "all" ? eq(wildSeedSources.material, material) : undefined,
    colorway && colorway !== "all" ? eq(wildSeedSources.colorway, colorway) : undefined,
    pattern && pattern !== "all" ? eq(wildSeedSources.copyPattern, pattern) : undefined,
  ];
  const baseWhere = and(...filters);
  const [{ total = 0 } = { total: 0 }] = await gameDb
    .select({ total: sql<number>`count(*)::int` })
    .from(wildSeedSources)
    .innerJoin(players, eq(players.id, wildSeedSources.playerId))
    .where(baseWhere);
  const rows = await gameDb
    .select({
      seed: wildSeedSources.petSeed, earnedAt: wildSeedSources.earnedAt,
      login: players.githubLogin, handle: players.handle, accountTier: players.tier, isAi: players.isAi,
      name: wildSeedSources.name, petTier: wildSeedSources.tier, rarityScore: wildSeedSources.rarityScore,
      size: wildSeedSources.size, species: wildSeedSources.species, aura: wildSeedSources.aura, oneOfOne: wildSeedSources.oneOfOne,
      printingId: wildSeedSources.printingId, serialNumber: wildSeedSources.serialNumber, printRun: wildSeedSources.printRun,
      finish: wildSeedSources.finish, mutation: wildSeedSources.mutation, material: wildSeedSources.material,
      colorway: wildSeedSources.colorway, copyPattern: wildSeedSources.copyPattern, population: petPrintings.issued,
      sizeRank: sql<number>`(select 1 + count(*) from wild_seed_sources other where other.printing_id = ${wildSeedSources.printingId} and other.size > ${wildSeedSources.size})::int`,
    })
    .from(wildSeedSources)
    .innerJoin(players, eq(players.id, wildSeedSources.playerId))
    .leftJoin(petPrintings, eq(petPrintings.id, wildSeedSources.printingId))
    .where(and(baseWhere, cursorCondition(cursor, sort)))
    .orderBy(...orderFor(sort))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const assignments = playerId ? await getPlayerPetLookAssignments(playerId, pageRows.map((row) => row.seed)) : {};
  const pets = pageRows.map((row) => ({
    seed: row.seed, login: row.login, handle: row.handle, tier: row.petTier || normalizeTier(row.accountTier),
    isAi: row.isAi, earnedAt: row.earnedAt.toISOString(), name: row.name,
    rarityScore: row.rarityScore, size: row.size, species: row.species, aura: row.aura,
    oneOfOne: row.oneOfOne, isAvatar: row.seed === avatarSeed, lookId: assignments[row.seed],
    printingId: row.printingId, serialNumber: row.serialNumber, printRun: row.printRun,
    finish: row.finish, mutation: row.mutation, material: row.material, colorway: row.colorway,
    copyPattern: row.copyPattern, population: row.population, sizeRank: row.sizeRank,
  }));
  const last = pageRows.at(-1);
  return {
    mode, sort, total, pets,
    nextCursor: hasMore && last ? encodeCursor({ mode, sort, value: cursorValue(last, sort), id: last.seed }) : null,
  };
};

export const loadPetCollection = (player: typeof players.$inferSelect, query: PetQuery) =>
  loadPets({ ...query, mode: "latest" }, player.id, player.avatarSeed);

export const loadRecentPets = async (query: PetQuery = {}): Promise<GalleryPage> => {
  const mode = normalizePetGalleryMode(query.mode);
  if (mode !== "owners") return loadPets(query);

  // One recent pet per owner remains a lightweight people-discovery view.
  const limit = Math.max(1, Math.min(60, Number(query.limit) || 24));
  const rows = await gameDb.select({
    id: players.id, login: players.githubLogin, handle: players.handle, accountTier: players.tier,
    isAi: players.isAi, wild: players.wild, verifiedAt: players.verifiedAt,
  }).from(players)
    .where(and(eq(players.githubVerified, true), sql`jsonb_array_length(${players.wild}) > 0`))
    .orderBy(desc(players.verifiedAt), desc(players.id)).limit(limit);
  const pets = rows.flatMap((row) => {
    const seed = (Array.isArray(row.wild) ? row.wild : [])[0];
    if (!seed) return [];
    return [{ seed, login: row.login, handle: row.handle, tier: normalizeTier(row.accountTier), isAi: row.isAi,
      earnedAt: row.verifiedAt?.toISOString() ?? null, name: "", rarityScore: 0, size: 0, species: "", aura: "none", oneOfOne: false,
      printingId: null, serialNumber: null, printRun: null, finish: null, mutation: null, material: null, colorway: null, copyPattern: null, population: null, sizeRank: null }];
  });
  return { mode, sort: "newest", total: pets.length, pets, nextCursor: null };
};
