// Official spoiler-safe set binders + persistent personal chase books.
// Official subjects are only revealed when the requesting player owns a copy.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { CARD_VARIANTS, type CardVariant } from "../../../core/procgen.ts";
import {
  collectorBooks, collectorBookSlots, petPrintings, petSets, petSubjects, wildSeedSources,
  players, type CollectorSlotTarget,
} from "../../../db/schema.ts";
import { gameDb } from "./sync.ts";
import { sql as neonSql } from "../../../db/index.ts";

const variantEntries = Object.entries(CARD_VARIANTS) as [CardVariant, (typeof CARD_VARIANTS)[CardVariant]][];
const safeText = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const COVER_STYLES = new Set(["midnight", "holo", "archive", "neon", "field", "rose"]);
const VISIBILITIES = new Set(["private", "unlisted", "public"]);
const TARGET_KINDS = new Set<CollectorSlotTarget["kind"]>(["freeform", "tier", "finish", "mutation", "material", "colorway", "pattern", "species", "serial", "size"]);

const cleanTarget = (raw: unknown): CollectorSlotTarget => {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<CollectorSlotTarget>;
  const kind = TARGET_KINDS.has(value.kind as CollectorSlotTarget["kind"]) ? value.kind as CollectorSlotTarget["kind"] : "freeform";
  return { kind, label: safeText(value.label, 80) || "Open slot", ...(safeText(value.value, 80) ? { value: safeText(value.value, 80) } : {}) };
};

export const loadOfficialPetBooks = async (playerId?: string | null) => {
  const [sets, subjects, printings, owned] = await Promise.all([
    gameDb.select().from(petSets).orderBy(asc(petSets.ordinal), asc(petSets.id)),
    gameDb.select({ id: petSubjects.id, setId: petSubjects.setId, slotNumber: petSubjects.slotNumber, name: petSubjects.name })
      .from(petSubjects).orderBy(asc(petSubjects.setId), asc(petSubjects.slotNumber)),
    gameDb.select({ subjectId: petPrintings.subjectId, variant: petPrintings.variant, issued: petPrintings.issued })
      .from(petPrintings),
    playerId ? gameDb.select({ subjectId: petPrintings.subjectId, variant: wildSeedSources.variant, petSeed: wildSeedSources.petSeed })
      .from(wildSeedSources).innerJoin(petPrintings, eq(petPrintings.id, wildSeedSources.printingId))
      .where(eq(wildSeedSources.playerId, playerId)) : Promise.resolve([]),
  ]);
  const printingMap = new Map(printings.map((row) => [`${row.subjectId}:${row.variant}`, Number(row.issued)]));
  const ownedMap = new Map<string, { count: number; seed: string }>();
  for (const row of owned) {
    const key = `${row.subjectId}:${row.variant}`;
    const hit = ownedMap.get(key);
    ownedMap.set(key, { count: (hit?.count ?? 0) + 1, seed: hit?.seed ?? row.petSeed });
  }
  const ownedSubjects = new Set(owned.map((row) => row.subjectId));
  return sets.map((set) => {
    const setSubjects = subjects.filter((subject) => subject.setId === set.id);
    const slots = setSubjects.map((subject) => {
      const revealed = ownedSubjects.has(subject.id);
      const parallels = variantEntries.map(([variant, cfg]) => {
        const own = ownedMap.get(`${subject.id}:${variant}`);
        const population = printingMap.get(`${subject.id}:${variant}`) ?? 0;
        return { variant, finish: cfg.finish, tier: cfg.tier, printRun: cfg.printRun, ownedCount: own?.count ?? 0, globallyDiscovered: population > 0 };
      });
      const firstOwned = variantEntries.map(([variant]) => ownedMap.get(`${subject.id}:${variant}`)?.seed).find(Boolean) ?? null;
      return {
        slotNumber: subject.slotNumber,
        revealed,
        ...(revealed ? { name: subject.name, subjectId: subject.id, ownedSeed: firstOwned } : {}),
        parallels,
      };
    });
    const subjectsOwned = slots.filter((slot) => slot.revealed).length;
    const parallelsOwned = slots.reduce((sum, slot) => sum + slot.parallels.filter((parallel) => parallel.ownedCount > 0).length, 0);
    return {
      id: set.id, name: set.name, description: set.description, releaseYear: set.releaseYear,
      coverStyle: set.coverStyle, spoilerMode: set.spoilerMode, subjectCount: set.subjectCount,
      subjectsOwned, parallelsOwned, totalParallels: set.subjectCount * variantEntries.length, slots,
    };
  }).filter((set) => set.id !== "legacy-genesis" || set.subjectsOwned > 0);
};

const loadPersonalBooks = async (playerId: string) => {
  const books = await gameDb.select().from(collectorBooks).where(eq(collectorBooks.playerId, playerId)).orderBy(desc(collectorBooks.updatedAt), asc(collectorBooks.name));
  if (books.length === 0) return [];
  const ids = books.map((book) => book.id);
  const slots = await gameDb.select().from(collectorBookSlots).where(inArray(collectorBookSlots.bookId, ids)).orderBy(asc(collectorBookSlots.bookId), asc(collectorBookSlots.position));
  const petSeeds = slots.map((slot) => slot.petSeed).filter((seed): seed is string => Boolean(seed));
  const pets = petSeeds.length ? await gameDb.select({
    seed: wildSeedSources.petSeed, name: wildSeedSources.name, tier: wildSeedSources.tier,
    finish: wildSeedSources.finish, mutation: wildSeedSources.mutation, material: wildSeedSources.material,
    colorway: wildSeedSources.colorway, copyPattern: wildSeedSources.copyPattern, serialNumber: wildSeedSources.serialNumber,
    printRun: wildSeedSources.printRun, size: wildSeedSources.size,
  }).from(wildSeedSources).where(and(eq(wildSeedSources.playerId, playerId), inArray(wildSeedSources.petSeed, petSeeds))) : [];
  const petMap = new Map(pets.map((pet) => [pet.seed, pet]));
  return books.map((book) => {
    const bookSlots = slots.filter((slot) => slot.bookId === book.id).map((slot) => ({
      position: slot.position, target: slot.target, note: slot.note, pet: slot.petSeed ? petMap.get(slot.petSeed) ?? null : null,
    }));
    return { ...book, createdAt: book.createdAt.toISOString(), updatedAt: book.updatedAt.toISOString(), slots: bookSlots, filled: bookSlots.filter((slot) => slot.pet).length };
  });
};

export const loadPetBooks = async (player: typeof players.$inferSelect) => ({
  official: await loadOfficialPetBooks(player.id),
  personal: await loadPersonalBooks(player.id),
});

export const loadSharedCollectorBook = async (bookId: string) => {
  const row = (await gameDb.select({ playerId: collectorBooks.playerId, owner: players.githubLogin, visibility: collectorBooks.visibility })
    .from(collectorBooks).innerJoin(players, eq(players.id, collectorBooks.playerId))
    .where(eq(collectorBooks.id, bookId)).limit(1))[0];
  if (!row || row.visibility === "private") return null;
  const book = (await loadPersonalBooks(row.playerId)).find((item) => item.id === bookId);
  if (!book) return null;
  const { playerId: _playerId, ...safeBook } = book;
  return { ...safeBook, owner: row.owner };
};

export const loadPetBookOptions = async (playerId: string) => gameDb.select({
  seed: wildSeedSources.petSeed, name: wildSeedSources.name, tier: wildSeedSources.tier,
  finish: wildSeedSources.finish, mutation: wildSeedSources.mutation, material: wildSeedSources.material,
  colorway: wildSeedSources.colorway, copyPattern: wildSeedSources.copyPattern, serialNumber: wildSeedSources.serialNumber,
  printRun: wildSeedSources.printRun,
}).from(wildSeedSources).where(eq(wildSeedSources.playerId, playerId)).orderBy(desc(wildSeedSources.rarityScore), asc(wildSeedSources.name)).limit(500);

const starterTargets = (starter: string): CollectorSlotTarget[] => starter === "tiers"
  ? ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"].map((value) => ({ kind: "tier", value, label: `${value} tier` }))
  : starter === "finishes" ? variantEntries.map(([, cfg]) => ({ kind: "finish", value: cfg.finish, label: `${cfg.finish} parallel` }))
    : starter === "mutations" ? ["Iridescent", "Chromatic", "Negative", "Singularity"].map((value) => ({ kind: "mutation", value, label: `${value} mutation` }))
      : starter === "materials" ? ["Satin", "Pearl", "Chrome", "Gold", "Crystal", "Obsidian", "Relic"].map((value) => ({ kind: "material", value, label: `${value} material` }))
        : starter === "patterns" ? ["Speckled", "Pinstripe", "Constellation", "Circuit", "Aurora Veil", "Gilded Filigree", "Impossible Fracture"].map((value) => ({ kind: "pattern", value, label: `${value} pattern` }))
      : starter === "species" ? ["Slime", "Critter", "Beast", "Construct", "Drake", "Sprite", "Wyrm", "Eldritch", "Celestial"].map((value) => ({ kind: "species", value, label: value }))
        : [];

export const createCollectorBook = async (playerId: string, raw: unknown) => {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const [{ total = 0 } = { total: 0 }] = await gameDb.select({ total: sql<number>`count(*)::int` }).from(collectorBooks).where(eq(collectorBooks.playerId, playerId));
  if (total >= 24) throw new Error("collector book limit reached");
  const name = safeText(body.name, 60);
  if (!name) throw new Error("book name is required");
  const id = `book:${crypto.randomUUID()}`;
  await gameDb.insert(collectorBooks).values({
    id, playerId, name, description: safeText(body.description, 240),
    visibility: VISIBILITIES.has(String(body.visibility)) ? String(body.visibility) : "private",
    coverStyle: COVER_STYLES.has(String(body.coverStyle)) ? String(body.coverStyle) : "midnight",
  });
  const targets = starterTargets(safeText(body.starter, 20));
  if (targets.length) await gameDb.insert(collectorBookSlots).values(targets.map((target, index) => ({ bookId: id, position: index + 1, target })));
  return { id };
};

const ownedBook = async (playerId: string, bookId: string) => (await gameDb.select().from(collectorBooks)
  .where(and(eq(collectorBooks.id, bookId), eq(collectorBooks.playerId, playerId))).limit(1))[0];

export const addCollectorBookSlot = async (playerId: string, bookId: string, raw: unknown) => {
  if (!await ownedBook(playerId, bookId)) throw new Error("book not found");
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const petSeed = safeText(body.petSeed, 1000) || null;
  let target = cleanTarget(body.target);
  if (petSeed) {
    const pet = (await gameDb.select({ name: wildSeedSources.name }).from(wildSeedSources)
      .where(and(eq(wildSeedSources.playerId, playerId), eq(wildSeedSources.petSeed, petSeed))).limit(1))[0];
    if (!pet) throw new Error("you do not own that pet");
    if (!safeText((body.target as { label?: unknown } | undefined)?.label, 80)) target = { kind: "freeform", label: pet.name };
  }
  const [{ next = 1 } = { next: 1 }] = await gameDb.select({ next: sql<number>`coalesce(max(${collectorBookSlots.position}), 0)::int + 1` })
    .from(collectorBookSlots).where(eq(collectorBookSlots.bookId, bookId));
  if (next > 250) throw new Error("book slot limit reached");
  await gameDb.insert(collectorBookSlots).values({ bookId, position: next, target, petSeed, note: safeText(body.note, 160) });
  await gameDb.update(collectorBooks).set({ updatedAt: new Date() }).where(eq(collectorBooks.id, bookId));
  return { position: next };
};

export const deleteCollectorBookSlot = async (playerId: string, bookId: string, position: number) => {
  if (!await ownedBook(playerId, bookId)) throw new Error("book not found");
  await gameDb.delete(collectorBookSlots).where(and(eq(collectorBookSlots.bookId, bookId), eq(collectorBookSlots.position, position)));
  await gameDb.update(collectorBooks).set({ updatedAt: new Date() }).where(eq(collectorBooks.id, bookId));
};

export const reorderCollectorBookSlots = async (playerId: string, bookId: string, rawPositions: unknown) => {
  if (!await ownedBook(playerId, bookId)) throw new Error("book not found");
  const positions = Array.isArray(rawPositions) ? rawPositions.map(Number) : [];
  const current = await gameDb.select({ position: collectorBookSlots.position }).from(collectorBookSlots)
    .where(eq(collectorBookSlots.bookId, bookId)).orderBy(asc(collectorBookSlots.position));
  const expected = current.map((row) => row.position);
  if (positions.length !== expected.length || new Set(positions).size !== positions.length || [...positions].sort((a, b) => a - b).some((value, index) => value !== expected[index])) throw new Error("invalid pocket order");
  if (positions.length < 2) return;
  await neonSql.transaction([
    neonSql`update collector_book_slots set position = position + 1000000 where book_id = ${bookId}`,
    ...positions.map((oldPosition, index) => neonSql`update collector_book_slots set position = ${index + 1} where book_id = ${bookId} and position = ${oldPosition + 1_000_000}`),
  ]);
  await gameDb.update(collectorBooks).set({ updatedAt: new Date() }).where(eq(collectorBooks.id, bookId));
};

export const deleteCollectorBook = async (playerId: string, bookId: string) => {
  if (!await ownedBook(playerId, bookId)) throw new Error("book not found");
  await gameDb.delete(collectorBooks).where(eq(collectorBooks.id, bookId));
};
