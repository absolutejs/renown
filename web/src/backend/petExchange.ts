import { populationReport } from "@absolutejs/collectibles";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  marketAuctions, marketBuyOrders, marketListings, marketWatchlists, petOwnershipEvents,
  petPrintings, petSubjects, players, wildSeedSources,
} from "../../../db/schema.ts";
import { gameDb } from "./sync.ts";
import { notifyMarketplace } from "./push.ts";
import { CARD_VARIANTS, cardPrintingId, type CardVariant } from "../shared/procgen.ts";

const watchId = (playerId: string, subjectId: string) => `watch:${playerId}:${subjectId}`;

export const loadPetExchange = async (subjectId: string) => {
  const subject = (await gameDb.select({ id: petSubjects.id, setId: petSubjects.setId, slotNumber: petSubjects.slotNumber, name: petSubjects.name, subjectSeed: petSubjects.subjectSeed })
    .from(petSubjects).where(eq(petSubjects.id, subjectId)).limit(1))[0];
  if (!subject) return null;
  const printingRows = await gameDb.select({ id: petPrintings.id, variant: petPrintings.variant, supply: petPrintings.printRun, issued: petPrintings.issued })
    .from(petPrintings).where(eq(petPrintings.subjectId, subjectId)).orderBy(desc(petPrintings.printRun));
  const existingPrintings = new Map(printingRows.map((row) => [row.variant, row]));
  const printings = (Object.entries(CARD_VARIANTS) as [CardVariant, (typeof CARD_VARIANTS)[CardVariant]][]).map(([variant, config]) => {
    const existing = existingPrintings.get(variant);
    return { id: existing?.id ?? cardPrintingId(subject.setId, subject.subjectSeed, variant), variant, finish: config.finish, supply: config.printRun, issued: existing?.issued ?? 0 };
  });
  const printingIds = printings.map((row) => row.id);
  const [copies, listings, orderRows, auctions, sales, watchRows] = await Promise.all([
    gameDb.select({
      seed: wildSeedSources.petSeed, printingId: wildSeedSources.printingId, ownerId: wildSeedSources.playerId,
      owner: players.githubLogin, ownerHandle: players.handle, ownerIsAi: players.isAi, name: wildSeedSources.name,
      tier: wildSeedSources.tier, finish: wildSeedSources.finish, mutation: wildSeedSources.mutation,
      material: wildSeedSources.material, colorway: wildSeedSources.colorway, pattern: wildSeedSources.copyPattern,
      serialNumber: wildSeedSources.serialNumber, supply: wildSeedSources.printRun, rarityScore: wildSeedSources.rarityScore,
      size: wildSeedSources.size, earnedAt: wildSeedSources.earnedAt,
    }).from(wildSeedSources).innerJoin(players, eq(players.id, wildSeedSources.playerId))
      .where(printingIds.length ? inArray(wildSeedSources.printingId, printingIds) : sql`false`)
      .orderBy(desc(wildSeedSources.rarityScore), asc(wildSeedSources.serialNumber)).limit(500),
    gameDb.select({
      id: marketListings.id, petSeed: marketListings.petSeed, priceCents: marketListings.priceCents, sellerId: marketListings.sellerPlayerId,
      seller: players.githubLogin, sellerHandle: players.handle, createdAt: marketListings.createdAt, expiresAt: marketListings.expiresAt,
      printingId: wildSeedSources.printingId, name: wildSeedSources.name, finish: wildSeedSources.finish, material: wildSeedSources.material,
      colorway: wildSeedSources.colorway, pattern: wildSeedSources.copyPattern, serialNumber: wildSeedSources.serialNumber,
      supply: wildSeedSources.printRun, rarityScore: wildSeedSources.rarityScore, size: wildSeedSources.size,
    }).from(marketListings).innerJoin(wildSeedSources, eq(wildSeedSources.petSeed, marketListings.petSeed)).innerJoin(players, eq(players.id, marketListings.sellerPlayerId))
      .where(and(eq(marketListings.status, "active"), printingIds.length ? inArray(wildSeedSources.printingId, printingIds) : sql`false`, sql`(${marketListings.expiresAt} is null or ${marketListings.expiresAt} > now())`))
      .orderBy(asc(marketListings.priceCents), asc(marketListings.createdAt)).limit(100),
    gameDb.select({ id: marketBuyOrders.id, buyerId: marketBuyOrders.buyerPlayerId, buyer: players.githubLogin, buyerHandle: players.handle,
      criteria: marketBuyOrders.criteria, priceCents: marketBuyOrders.priceCents, createdAt: marketBuyOrders.createdAt, expiresAt: marketBuyOrders.expiresAt,
    }).from(marketBuyOrders).innerJoin(players, eq(players.id, marketBuyOrders.buyerPlayerId)).where(eq(marketBuyOrders.status, "active")).orderBy(desc(marketBuyOrders.priceCents)).limit(200),
    gameDb.select({ id: marketAuctions.id, petSeed: marketAuctions.petSeed, sellerId: marketAuctions.sellerPlayerId, seller: players.githubLogin,
      sellerHandle: players.handle, startCents: marketAuctions.startCents, reserveCents: marketAuctions.reserveCents, finalCents: marketAuctions.finalCents,
      endsAt: marketAuctions.endsAt, extensionCount: marketAuctions.extensionCount, finish: wildSeedSources.finish,
      serialNumber: wildSeedSources.serialNumber, supply: wildSeedSources.printRun,
    }).from(marketAuctions).innerJoin(wildSeedSources, eq(wildSeedSources.petSeed, marketAuctions.petSeed)).innerJoin(players, eq(players.id, marketAuctions.sellerPlayerId))
      .where(and(eq(marketAuctions.status, "active"), printingIds.length ? inArray(wildSeedSources.printingId, printingIds) : sql`false`)).orderBy(asc(marketAuctions.endsAt)).limit(100),
    gameDb.select({ petSeed: petOwnershipEvents.petSeed, amountCents: petOwnershipEvents.amountCents, reason: petOwnershipEvents.reason,
      occurredAt: petOwnershipEvents.occurredAt, finish: wildSeedSources.finish, material: wildSeedSources.material,
      colorway: wildSeedSources.colorway, pattern: wildSeedSources.copyPattern, serialNumber: wildSeedSources.serialNumber,
      supply: wildSeedSources.printRun,
    }).from(petOwnershipEvents).innerJoin(wildSeedSources, eq(wildSeedSources.petSeed, petOwnershipEvents.petSeed))
      .where(and(printingIds.length ? inArray(wildSeedSources.printingId, printingIds) : sql`false`, isNotNull(petOwnershipEvents.amountCents)))
      .orderBy(desc(petOwnershipEvents.occurredAt)).limit(100),
    gameDb.select({ count: sql<number>`count(*)::int` }).from(marketWatchlists).where(eq(marketWatchlists.subjectId, subjectId)),
  ]);
  // Preserve the binder's chase mystery: a deterministic manifest slot proves that
  // something exists, but its named exchange stays unavailable until first discovery.
  if (copies.length === 0) return null;
  const buyOrders = orderRows.filter((row) => row.criteria.subjectId === subjectId || Boolean(row.criteria.printingId && printingIds.includes(row.criteria.printingId)));
  const byPrinting = new Map<string, number>(); for (const copy of copies) if (copy.printingId) byPrinting.set(copy.printingId, (byPrinting.get(copy.printingId) ?? 0) + 1);
  const listedByPrinting = new Map<string, number>(); for (const listing of listings) if (listing.printingId) listedByPrinting.set(listing.printingId, (listedByPrinting.get(listing.printingId) ?? 0) + 1);
  const population = printings.map((printing) => ({ ...printing, ...populationReport({ supply: printing.supply, issued: printing.issued, discovered: byPrinting.get(printing.id) ?? 0, publiclyOwned: byPrinting.get(printing.id) ?? 0, listed: listedByPrinting.get(printing.id) ?? 0 }) }));
  const census = (key: "finish" | "material" | "colorway" | "pattern" | "mutation") => [...copies.reduce((map, copy) => { const value = copy[key] ?? "Unknown"; map.set(value, (map.get(value) ?? 0) + 1); return map; }, new Map<string, number>())]
    .map(([value, count]) => ({ value, count })).sort((a, b) => a.count - b.count || a.value.localeCompare(b.value));
  const saleGroups = [...sales.reduce((map, sale) => { const finish = sale.finish ?? "Unknown"; const group = map.get(finish) ?? []; group.push(sale.amountCents ?? 0); map.set(finish, group); return map; }, new Map<string, number[]>())]
    .map(([finish, amounts]) => ({ finish, count: amounts.length, averageCents: Math.round(amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length), lowCents: Math.min(...amounts), highCents: Math.max(...amounts) }));
  const lowestSerial = [...copies].filter((copy) => copy.serialNumber != null).sort((a, b) => (a.serialNumber ?? Infinity) - (b.serialNumber ?? Infinity))[0] ?? null;
  const largest = [...copies].sort((a, b) => b.size - a.size || b.rarityScore - a.rarityScore)[0] ?? null;
  const rarest = copies[0] ?? null;
  const serializedCopies = copies.map((copy) => ({ ...copy, earnedAt: copy.earnedAt.toISOString() }));
  const serializeRecord = (copy: typeof lowestSerial) => copy ? { ...copy, earnedAt: copy.earnedAt.toISOString() } : null;
  return {
    subject, population, copies: serializedCopies,
    listings: listings.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null })),
    buyOrders: buyOrders.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null })),
    auctions: auctions.map((row) => ({ ...row, endsAt: row.endsAt.toISOString() })),
    sales: sales.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })), saleGroups,
    census: { finishes: census("finish"), materials: census("material"), colorways: census("colorway"), patterns: census("pattern"), mutations: census("mutation") },
    records: { lowestSerial: serializeRecord(lowestSerial), largest: serializeRecord(largest), rarest: serializeRecord(rarest) }, watchCount: Number(watchRows[0]?.count ?? 0),
    summary: {
      discovered: copies.length, listed: listings.length, floorCents: listings[0]?.priceCents ?? null,
      highestBuyOrderCents: buyOrders[0]?.priceCents ?? null, sales: sales.length,
    },
  };
};

export const loadSubjectWatch = async (playerId: string, subjectId: string) =>
  (await gameDb.select().from(marketWatchlists).where(eq(marketWatchlists.id, watchId(playerId, subjectId))).limit(1))[0] ?? null;

export const saveSubjectWatch = async (playerId: string, subjectId: string, raw: unknown) => {
  const subject = (await gameDb.select({ id: petSubjects.id }).from(petSubjects).where(eq(petSubjects.id, subjectId)).limit(1))[0];
  if (!subject) throw new Error("subject not found");
  const body = (raw ?? {}) as { finish?: unknown; maximumPriceCents?: unknown };
  const finish = String(body.finish ?? "").trim().slice(0, 40) || null; const price = Number(body.maximumPriceCents);
  const maximumPriceCents = Number.isSafeInteger(price) && price >= 100 && price <= 180_000 ? price : null;
  const id = watchId(playerId, subjectId);
  await gameDb.insert(marketWatchlists).values({ id, playerId, subjectId, finish, maximumPriceCents })
    .onConflictDoUpdate({ target: marketWatchlists.id, set: { finish, maximumPriceCents, updatedAt: new Date() } });
  return { id, subjectId, finish, maximumPriceCents };
};

export const deleteSubjectWatch = async (playerId: string, subjectId: string) => {
  await gameDb.delete(marketWatchlists).where(and(eq(marketWatchlists.id, watchId(playerId, subjectId)), eq(marketWatchlists.playerId, playerId)));
};

export const notifySubjectWatchers = async (petSeed: string, priceCents: number, sellerPlayerId: string, kind: "listing" | "auction") => {
  const pet = (await gameDb.select({ subjectId: petPrintings.subjectId, subjectName: petSubjects.name, finish: wildSeedSources.finish })
    .from(wildSeedSources).innerJoin(petPrintings, eq(petPrintings.id, wildSeedSources.printingId)).innerJoin(petSubjects, eq(petSubjects.id, petPrintings.subjectId))
    .where(eq(wildSeedSources.petSeed, petSeed)).limit(1))[0];
  if (!pet) return;
  const watches = await gameDb.select().from(marketWatchlists).where(eq(marketWatchlists.subjectId, pet.subjectId));
  for (const watch of watches) {
    if (watch.playerId === sellerPlayerId || (watch.finish && watch.finish !== pet.finish) || (watch.maximumPriceCents && priceCents > watch.maximumPriceCents)) continue;
    void notifyMarketplace(watch.playerId, `${pet.subjectName} is on the market`, `${pet.finish ?? "A copy"} ${kind === "auction" ? "started at" : "listed for"} $${(priceCents / 100).toFixed(2)}.`, `watch:${kind}:${petSeed}`);
  }
};
