import { cents, sellerFee, steamLikeWalletPolicy } from "@absolutejs/wallet";
import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import {
  marketListings, marketTrades, petOwnershipEvents, petPrintings, petSubjects, players, walletAccounts,
  walletEntries, walletTransactions, wildSeedSources,
} from "../../../db/schema.ts";
import { gameDb } from "./sync.ts";

const PAGE_MAX = 60;
type ListingCursor = { at: string; id: string };
const encodeCursor = (value: ListingCursor) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decodeCursor = (raw: unknown): ListingCursor | null => {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ListingCursor;
    return typeof value.at === "string" && !Number.isNaN(Date.parse(value.at)) && typeof value.id === "string" ? value : null;
  } catch { return null; }
};

export const loadMarketplace = async (query: Record<string, unknown> = {}) => {
  const limit = Math.max(1, Math.min(PAGE_MAX, Number(query.limit ?? 24) || 24));
  const cursor = decodeCursor(query.cursor);
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const finish = typeof query.finish === "string" ? query.finish : "";
  const listingId = typeof query.listingId === "string" ? query.listingId : "";
  const before = cursor ? or(lt(marketListings.createdAt, new Date(cursor.at)), and(eq(marketListings.createdAt, new Date(cursor.at)), lt(marketListings.id, cursor.id))) : undefined;
  const where = and(
    eq(marketListings.status, "active"),
    listingId ? eq(marketListings.id, listingId) : undefined,
    sql`(${marketListings.expiresAt} is null or ${marketListings.expiresAt} > now())`,
    before,
    q ? or(ilike(wildSeedSources.name, `%${q}%`), ilike(players.githubLogin, `%${q}%`), ilike(petSubjects.name, `%${q}%`)) : undefined,
    finish ? eq(wildSeedSources.finish, finish) : undefined,
  );
  const rows = await gameDb.select({
    id: marketListings.id, priceCents: marketListings.priceCents, createdAt: marketListings.createdAt, expiresAt: marketListings.expiresAt,
    seed: marketListings.petSeed, sellerId: marketListings.sellerPlayerId, seller: players.githubLogin, sellerHandle: players.handle,
    name: wildSeedSources.name, tier: wildSeedSources.tier, rarityScore: wildSeedSources.rarityScore, size: wildSeedSources.size,
    finish: wildSeedSources.finish, mutation: wildSeedSources.mutation, material: wildSeedSources.material,
    colorway: wildSeedSources.colorway, copyPattern: wildSeedSources.copyPattern,
    serialNumber: wildSeedSources.serialNumber, printRun: wildSeedSources.printRun,
    subjectId: petPrintings.subjectId, subjectName: petSubjects.name,
  }).from(marketListings)
    .innerJoin(wildSeedSources, eq(wildSeedSources.petSeed, marketListings.petSeed))
    .innerJoin(players, eq(players.id, marketListings.sellerPlayerId))
    .leftJoin(petPrintings, eq(petPrintings.id, wildSeedSources.printingId))
    .leftJoin(petSubjects, eq(petSubjects.id, petPrintings.subjectId))
    .where(where).orderBy(desc(marketListings.createdAt), desc(marketListings.id)).limit(limit + 1);
  const items = rows.slice(0, limit).map((row) => ({ ...row, sellerReceivesCents: sellerFee(row.priceCents, steamLikeWalletPolicy.sellerFeeBps).sellerNetCents }));
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null, policy: steamLikeWalletPolicy };
};

export const loadWallet = async (playerId: string) => {
  const id = `wallet:${playerId}`;
  const account = (await gameDb.select().from(walletAccounts).where(eq(walletAccounts.id, id)).limit(1))[0];
  const history = account ? await gameDb.select({
    id: walletTransactions.id, kind: walletTransactions.kind, metadata: walletTransactions.metadata,
    amountCents: walletEntries.amountCents, createdAt: walletTransactions.createdAt,
  }).from(walletEntries).innerJoin(walletTransactions, eq(walletTransactions.id, walletEntries.transactionId))
    .where(eq(walletEntries.accountId, id)).orderBy(desc(walletTransactions.createdAt)).limit(50) : [];
  return {
    balanceCents: account?.balanceCents ?? 0,
    reservedCents: account?.reservedCents ?? 0,
    availableCents: (account?.balanceCents ?? 0) - (account?.reservedCents ?? 0),
    status: account?.status ?? "active",
    history,
    policy: steamLikeWalletPolicy,
  };
};

export const createMarketListing = async (playerId: string, input: unknown) => {
  const body = (input ?? {}) as { petSeed?: unknown; priceCents?: unknown; expiresAt?: unknown };
  const petSeed = String(body.petSeed ?? "").trim();
  const priceCents = cents(Number(body.priceCents), "listing price");
  if (!petSeed) throw new Error("pet is required");
  if (priceCents < 100) throw new Error("minimum listing price is $1.00");
  if (priceCents > steamLikeWalletPolicy.maximumTransactionCents) throw new Error("maximum listing price is $1,800.00");
  const owned = (await gameDb.select({ seed: wildSeedSources.petSeed }).from(wildSeedSources)
    .where(and(eq(wildSeedSources.playerId, playerId), eq(wildSeedSources.petSeed, petSeed))).limit(1))[0];
  if (!owned) throw new Error("you do not own this pet");
  const expiresAt = typeof body.expiresAt === "string" && !Number.isNaN(Date.parse(body.expiresAt)) ? new Date(body.expiresAt) : null;
  const id = `listing:${crypto.randomUUID()}`;
  await gameDb.insert(marketListings).values({ id, petSeed, sellerPlayerId: playerId, priceCents, expiresAt });
  return { id, petSeed, priceCents, fee: sellerFee(priceCents, steamLikeWalletPolicy.sellerFeeBps) };
};

export const cancelMarketListing = async (playerId: string, listingId: string) => {
  const changed = await gameDb.update(marketListings).set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(marketListings.id, listingId), eq(marketListings.sellerPlayerId, playerId), eq(marketListings.status, "active")))
    .returning({ id: marketListings.id });
  if (!changed.length) throw new Error("active listing not found");
};

type SettlementRow = { out_transaction_id: string; out_pet_seed: string; out_seller: string; out_buyer: string };
export const buyMarketListing = async (buyerPlayerId: string, listingId: string, idempotencyKey: string) => {
  if (!idempotencyKey.trim()) throw new Error("idempotency key is required");
  const result = await gameDb.execute(sql`select * from settle_market_listing(${listingId}, ${buyerPlayerId}, ${idempotencyKey})`);
  const row = (result.rows as unknown as SettlementRow[])[0];
  if (!row) throw new Error("sale did not settle");
  return row;
};

export const loadPetProvenance = async (petSeed: string) => gameDb.select({
  sequence: petOwnershipEvents.sequence, kind: petOwnershipEvents.kind, reason: petOwnershipEvents.reason,
  fromPlayerId: petOwnershipEvents.fromPlayerId, toPlayerId: petOwnershipEvents.toPlayerId,
  settlementRef: petOwnershipEvents.settlementRef, chainRef: petOwnershipEvents.chainRef,
  amountCents: petOwnershipEvents.amountCents, occurredAt: petOwnershipEvents.occurredAt,
}).from(petOwnershipEvents).where(eq(petOwnershipEvents.petSeed, petSeed)).orderBy(petOwnershipEvents.sequence);

export const loadPetMarketState = async (petSeed: string) => {
  const [listing, events] = await Promise.all([
    gameDb.select({ id: marketListings.id, priceCents: marketListings.priceCents, sellerPlayerId: marketListings.sellerPlayerId })
      .from(marketListings).where(and(eq(marketListings.petSeed, petSeed), eq(marketListings.status, "active"), sql`(${marketListings.expiresAt} is null or ${marketListings.expiresAt} > now())`)).limit(1),
    loadPetProvenance(petSeed),
  ]);
  const ids = [...new Set(events.flatMap((event) => [event.fromPlayerId, event.toPlayerId]).filter((id): id is string => Boolean(id)))];
  const people = ids.length ? await gameDb.select({ id: players.id, login: players.githubLogin, handle: players.handle }).from(players).where(inArray(players.id, ids)) : [];
  const names = new Map(people.map((person) => [person.id, { login: person.login, handle: person.handle }]));
  return { listing: listing[0] ?? null, events: events.map((event) => ({ ...event, from: event.fromPlayerId ? names.get(event.fromPlayerId) ?? null : null, to: event.toPlayerId ? names.get(event.toPlayerId) ?? null : null })) };
};

const tradeSeeds = (value: unknown, label: string) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const seeds = value.map((seed) => String(seed).trim()).filter(Boolean);
  if (seeds.length > 10) throw new Error(`${label} is limited to 10 pets`);
  if (new Set(seeds).size !== seeds.length) throw new Error(`${label} contains duplicate pets`);
  return seeds;
};

const loadTradePets = async (seeds: string[]) => seeds.length ? gameDb.select({
  seed: wildSeedSources.petSeed, ownerId: wildSeedSources.playerId, name: wildSeedSources.name, tier: wildSeedSources.tier,
  finish: wildSeedSources.finish, serialNumber: wildSeedSources.serialNumber, printRun: wildSeedSources.printRun,
  mutation: wildSeedSources.mutation, material: wildSeedSources.material, colorway: wildSeedSources.colorway,
}).from(wildSeedSources).where(inArray(wildSeedSources.petSeed, seeds)) : [];

export const loadCollectorTradePets = async (login: string) => {
  const collector = (await gameDb.select({ id: players.id, login: players.githubLogin, handle: players.handle }).from(players)
    .where(and(eq(players.githubVerified, true), sql`lower(${players.githubLogin})=lower(${login.trim()})`)).limit(1))[0];
  if (!collector) throw new Error("collector not found");
  const pets = await gameDb.select({
    seed: wildSeedSources.petSeed, name: wildSeedSources.name, tier: wildSeedSources.tier, finish: wildSeedSources.finish,
    serialNumber: wildSeedSources.serialNumber, printRun: wildSeedSources.printRun, mutation: wildSeedSources.mutation,
    material: wildSeedSources.material, colorway: wildSeedSources.colorway,
  }).from(wildSeedSources).where(eq(wildSeedSources.playerId, collector.id)).orderBy(desc(wildSeedSources.rarityScore), desc(wildSeedSources.petSeed)).limit(100);
  return { collector, pets };
};

export const createMarketTrade = async (proposerId: string, input: unknown) => {
  const body = (input ?? {}) as { counterpartyLogin?: unknown; offeredPetSeeds?: unknown; requestedPetSeeds?: unknown; note?: unknown; expiresInDays?: unknown; parentTradeId?: unknown };
  const login = String(body.counterpartyLogin ?? "").trim();
  if (!login) throw new Error("choose a collector");
  const counterparty = (await gameDb.select({ id: players.id, login: players.githubLogin, handle: players.handle }).from(players)
    .where(and(eq(players.githubVerified, true), sql`lower(${players.githubLogin})=lower(${login})`)).limit(1))[0];
  if (!counterparty) throw new Error("collector not found");
  if (counterparty.id === proposerId) throw new Error("you cannot trade with yourself");
  const parentTradeId = body.parentTradeId ? String(body.parentTradeId) : null;
  if (parentTradeId) {
    const parent = (await gameDb.select({
      proposerPlayerId: marketTrades.proposerPlayerId, counterpartyPlayerId: marketTrades.counterpartyPlayerId,
      status: marketTrades.status, expiresAt: marketTrades.expiresAt,
    }).from(marketTrades).where(eq(marketTrades.id, parentTradeId)).limit(1))[0];
    if (!parent || parent.status !== "pending" || (parent.expiresAt && parent.expiresAt.getTime() <= Date.now())) throw new Error("the original trade is no longer open");
    if (parent.counterpartyPlayerId !== proposerId || parent.proposerPlayerId !== counterparty.id) throw new Error("that trade cannot be countered by this collector");
  }
  const offered = tradeSeeds(body.offeredPetSeeds, "offered pets");
  const requested = tradeSeeds(body.requestedPetSeeds, "requested pets");
  if (!offered.length) throw new Error("offer at least one pet");
  if (offered.some((seed) => requested.includes(seed))) throw new Error("a pet cannot appear on both sides");
  const pets = await loadTradePets([...offered, ...requested]);
  if (offered.some((seed) => !pets.some((pet) => pet.seed === seed && pet.ownerId === proposerId))) throw new Error("you no longer own every offered pet");
  if (requested.some((seed) => !pets.some((pet) => pet.seed === seed && pet.ownerId === counterparty.id))) throw new Error("the collector no longer owns every requested pet");
  const days = Math.max(1, Math.min(30, Number(body.expiresInDays ?? 7) || 7));
  const id = `trade:${crypto.randomUUID()}`;
  await gameDb.insert(marketTrades).values({
    id, proposerPlayerId: proposerId, counterpartyPlayerId: counterparty.id, offeredPetSeeds: offered, requestedPetSeeds: requested,
    note: String(body.note ?? "").trim().slice(0, 280), parentTradeId,
    expiresAt: new Date(Date.now() + days * 86_400_000),
  });
  if (parentTradeId) {
    const changed = await gameDb.update(marketTrades).set({ status: "countered", updatedAt: new Date() })
      .where(and(eq(marketTrades.id, parentTradeId), eq(marketTrades.status, "pending"))).returning({ id: marketTrades.id });
    if (!changed.length) {
      await gameDb.delete(marketTrades).where(eq(marketTrades.id, id));
      throw new Error("the original trade changed before your counteroffer was sent");
    }
  }
  return { id, counterparty, offered, requested, feeCents: requested.length ? steamLikeWalletPolicy.tradeFeeCents * 2 : steamLikeWalletPolicy.tradeFeeCents };
};

export const loadMarketTrades = async (playerId: string) => {
  const trades = await gameDb.select().from(marketTrades)
    .where(or(eq(marketTrades.proposerPlayerId, playerId), eq(marketTrades.counterpartyPlayerId, playerId)))
    .orderBy(desc(marketTrades.updatedAt), desc(marketTrades.id)).limit(100);
  const playerIds = [...new Set(trades.flatMap((trade) => [trade.proposerPlayerId, trade.counterpartyPlayerId]))];
  const seeds = [...new Set(trades.flatMap((trade) => [...trade.offeredPetSeeds, ...trade.requestedPetSeeds]))];
  const [people, pets] = await Promise.all([
    playerIds.length ? gameDb.select({ id: players.id, login: players.githubLogin, handle: players.handle, isAi: players.isAi }).from(players).where(inArray(players.id, playerIds)) : [],
    loadTradePets(seeds),
  ]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const petsBySeed = new Map(pets.map((pet) => [pet.seed, pet]));
  const now = Date.now();
  return { items: trades.map((trade) => ({
    ...trade,
    status: trade.status === "pending" && trade.expiresAt && trade.expiresAt.getTime() <= now ? "expired" : trade.status,
    direction: trade.proposerPlayerId === playerId ? "outgoing" as const : "incoming" as const,
    proposer: peopleById.get(trade.proposerPlayerId) ?? null, counterparty: peopleById.get(trade.counterpartyPlayerId) ?? null,
    offeredPets: trade.offeredPetSeeds.map((seed) => petsBySeed.get(seed) ?? { seed, name: "Transferred pet", tier: "", finish: null, serialNumber: null, printRun: null }),
    requestedPets: trade.requestedPetSeeds.map((seed) => petsBySeed.get(seed) ?? { seed, name: "Transferred pet", tier: "", finish: null, serialNumber: null, printRun: null }),
  })), policy: { tradeFeeCents: steamLikeWalletPolicy.tradeFeeCents } };
};

type TradeSettlementRow = { out_transaction_id: string; out_trade_id: string; out_status: string };
export const acceptMarketTrade = async (playerId: string, tradeId: string, idempotencyKey: string) => {
  const result = await gameDb.execute(sql`select * from settle_market_trade(${tradeId}, ${playerId}, ${idempotencyKey})`);
  const row = (result.rows as unknown as TradeSettlementRow[])[0];
  if (!row) throw new Error("trade did not settle");
  return row;
};

export const declineMarketTrade = async (playerId: string, tradeId: string) => {
  const changed = await gameDb.update(marketTrades).set({ status: "declined", updatedAt: new Date() })
    .where(and(eq(marketTrades.id, tradeId), eq(marketTrades.counterpartyPlayerId, playerId), eq(marketTrades.status, "pending"))).returning({ id: marketTrades.id });
  if (!changed.length) throw new Error("pending incoming trade not found");
};

export const cancelMarketTrade = async (playerId: string, tradeId: string) => {
  const changed = await gameDb.update(marketTrades).set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(marketTrades.id, tradeId), eq(marketTrades.proposerPlayerId, playerId), eq(marketTrades.status, "pending"))).returning({ id: marketTrades.id });
  if (!changed.length) throw new Error("pending outgoing trade not found");
};
