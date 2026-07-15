import {
  assertIdempotencyKey, assertMarketAmount, criteriaFromAsset, decodeMarketCursor, encodeMarketCursor,
  normalizeAuctionDraft, normalizeListingDraft, normalizeOrderDuration, steamLikeMarketplacePolicy,
} from "@absolutejs/marketplace";
import { cents, steamLikeWalletPolicy } from "@absolutejs/wallet";
import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import {
  marketAuctions, marketBids, marketBuyOrders, marketListings, marketTrades, petOwnershipEvents, petPrintings, petSubjects, players, walletAccounts,
  walletEntries, walletTransactions, wildSeedSources,
} from "../../../db/schema.ts";
import { gameDb } from "./sync.ts";
import { notifyMarketplace } from "./push.ts";
import { notifySubjectWatchers } from "./petExchange.ts";

const PAGE_MAX = 60;

export const loadMarketplace = async (query: Record<string, unknown> = {}) => {
  const limit = Math.max(1, Math.min(PAGE_MAX, Number(query.limit ?? 24) || 24));
  const cursor = decodeMarketCursor(query.cursor);
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
  const items = rows.slice(0, limit).map((row) => ({ ...row, sellerReceivesCents: row.priceCents - Math.ceil(row.priceCents * steamLikeMarketplacePolicy.wallet.sellerFeeBps / 10_000) }));
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeMarketCursor({ at: last.createdAt.toISOString(), id: last.id }) : null, policy: steamLikeMarketplacePolicy.wallet };
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

export const loadMarketBuyOrders = async () => {
  await gameDb.execute(sql`select expire_market_buy_orders()`);
  const items = await gameDb.select({
    id: marketBuyOrders.id, criteria: marketBuyOrders.criteria, priceCents: marketBuyOrders.priceCents,
    status: marketBuyOrders.status, createdAt: marketBuyOrders.createdAt, expiresAt: marketBuyOrders.expiresAt,
    buyerId: marketBuyOrders.buyerPlayerId, buyerLogin: players.githubLogin, buyerHandle: players.handle,
  }).from(marketBuyOrders).innerJoin(players, eq(players.id, marketBuyOrders.buyerPlayerId))
    .where(eq(marketBuyOrders.status, "active")).orderBy(desc(marketBuyOrders.priceCents), desc(marketBuyOrders.createdAt)).limit(60);
  const printingIds = [...new Set(items.map((item) => item.criteria.printingId).filter((id): id is string => Boolean(id)))];
  const printings = printingIds.length ? await gameDb.select({ id: petPrintings.id, subjectId: petPrintings.subjectId, subjectName: petSubjects.name })
    .from(petPrintings).innerJoin(petSubjects, eq(petSubjects.id, petPrintings.subjectId)).where(inArray(petPrintings.id, printingIds)) : [];
  const names = new Map(printings.map((printing) => [printing.id, printing]));
  return { items: items.map((item) => ({ ...item, subject: item.criteria.printingId ? names.get(item.criteria.printingId) ?? null : null })), policy: steamLikeWalletPolicy };
};

export const loadMarketPetTemplate = async (petSeed: string) => {
  const row = (await gameDb.select({ seed: wildSeedSources.petSeed, name: wildSeedSources.name, printingId: wildSeedSources.printingId,
    subjectId: petPrintings.subjectId, subjectName: petSubjects.name, finish: wildSeedSources.finish, material: wildSeedSources.material,
    colorway: wildSeedSources.colorway, pattern: wildSeedSources.copyPattern, serialNumber: wildSeedSources.serialNumber, printRun: wildSeedSources.printRun,
  }).from(wildSeedSources).leftJoin(petPrintings, eq(petPrintings.id, wildSeedSources.printingId)).leftJoin(petSubjects, eq(petSubjects.id, petPrintings.subjectId))
    .where(eq(wildSeedSources.petSeed, petSeed)).limit(1))[0];
  if (!row?.printingId) throw new Error("this pet does not belong to a buy-order printing");
  return row;
};

export const createMarketBuyOrder = async (buyerPlayerId: string, input: unknown) => {
  const openCount = Number((await gameDb.select({ count: sql<number>`count(*)::int` }).from(marketBuyOrders).where(and(eq(marketBuyOrders.buyerPlayerId, buyerPlayerId), eq(marketBuyOrders.status, "active"))))[0]?.count ?? 0);
  if (openCount >= 20) throw new Error("cancel an existing buy order before posting another");
  const body = (input ?? {}) as { petSeed?: unknown; match?: unknown; priceCents?: unknown; maxSerial?: unknown; expiresInDays?: unknown };
  const template = await loadMarketPetTemplate(String(body.petSeed ?? "").trim());
  const priceCents = assertMarketAmount(body.priceCents, "buy order price");
  const match = body.match === "exact" ? "exact" : body.match === "finish" ? "finish" : "printing";
  const normalizedCriteria = criteriaFromAsset({ id: template.seed, ...template }, match, Number(body.maxSerial));
  const criteria: { printingId: string; subjectId?: string; finish?: string; material?: string; colorway?: string; pattern?: string; maxSerial?: number } = {
    printingId: normalizedCriteria.printingId!, subjectId: normalizedCriteria.subjectId, finish: normalizedCriteria.finish,
    material: normalizedCriteria.material, colorway: normalizedCriteria.colorway, pattern: normalizedCriteria.pattern,
    maxSerial: normalizedCriteria.maximumSerial,
  };
  const days = normalizeOrderDuration(body.expiresInDays);
  const expiresAt = new Date(Date.now() + days * 86_400_000); const id = `buy:${crypto.randomUUID()}`; const key = `buy-order:create:${id}`;
  const result = await gameDb.execute(sql`select * from create_market_buy_order(${id},${buyerPlayerId},${JSON.stringify(criteria)}::jsonb,${priceCents},${expiresAt},${key})`);
  if (!result.rows.length) throw new Error("buy order was not created");
  return { id, criteria, priceCents, expiresAt, template };
};

export const cancelMarketBuyOrder = async (buyerPlayerId: string, orderId: string) => { await gameDb.execute(sql`select cancel_market_buy_order(${orderId},${buyerPlayerId})`); };

type BuyOrderSettlementRow = { out_transaction_id: string; out_order_id: string; out_pet_seed: string; out_buyer: string; out_seller: string };
export const fillMarketBuyOrder = async (sellerPlayerId: string, orderId: string, petSeed: string, idempotencyKey: string) => {
  const key = assertIdempotencyKey(idempotencyKey);
  const result = await gameDb.execute(sql`select * from settle_market_buy_order(${orderId},${sellerPlayerId},${petSeed},${key})`);
  const row = (result.rows as unknown as BuyOrderSettlementRow[])[0]; if (!row) throw new Error("buy order did not settle");
  void notifyMarketplace(row.out_buyer, "Buy order filled", "A matching pet is now in your collection and the reserved funds settled.", `buy-order:filled:${orderId}`);
  void notifyMarketplace(row.out_seller, "Instant sale complete", "The buyer's reserved funds settled and your wallet is updated.", `buy-order:sold:${orderId}`);
  return row;
};

type AuctionSettlementRow = { out_transaction_id: string | null; out_auction_id: string; out_pet_seed: string; out_buyer: string | null; out_seller: string; out_status: string };
const settleAuction = async (auctionId: string) => {
  const result = await gameDb.execute(sql`select * from settle_market_auction(${auctionId},${`auction:auto:${auctionId}`})`);
  const row = (result.rows as unknown as AuctionSettlementRow[])[0];
  if (row?.out_status === "settled" && row.out_buyer) {
    void notifyMarketplace(row.out_buyer, "Auction won", "The reserved bid settled and the pet is now in your collection.", `auction:won:${auctionId}`);
    void notifyMarketplace(row.out_seller, "Auction sold", "The winning bid settled and your wallet is updated.", `auction:sold:${auctionId}`);
  }
  return row;
};

export const loadMarketAuctions = async () => {
  const ended = await gameDb.select({ id: marketAuctions.id }).from(marketAuctions).where(and(eq(marketAuctions.status, "active"), sql`${marketAuctions.endsAt} <= now()`)).limit(20);
  for (const auction of ended) await settleAuction(auction.id).catch((error) => console.error("auction settlement failed", auction.id, error));
  const rows = await gameDb.select({
    id: marketAuctions.id, petSeed: marketAuctions.petSeed, sellerId: marketAuctions.sellerPlayerId, startCents: marketAuctions.startCents,
    reserveCents: marketAuctions.reserveCents, status: marketAuctions.status, endsAt: marketAuctions.endsAt, extensionCount: marketAuctions.extensionCount,
    finalCents: marketAuctions.finalCents, sellerLogin: players.githubLogin, sellerHandle: players.handle,
    name: wildSeedSources.name, tier: wildSeedSources.tier, finish: wildSeedSources.finish, material: wildSeedSources.material,
    colorway: wildSeedSources.colorway, serialNumber: wildSeedSources.serialNumber, printRun: wildSeedSources.printRun,
  }).from(marketAuctions).innerJoin(players, eq(players.id, marketAuctions.sellerPlayerId)).innerJoin(wildSeedSources, eq(wildSeedSources.petSeed, marketAuctions.petSeed))
    .where(eq(marketAuctions.status, "active")).orderBy(marketAuctions.endsAt).limit(60);
  const ids = rows.map((row) => row.id);
  const bids = ids.length ? await gameDb.select({ id: marketBids.id, auctionId: marketBids.auctionId, bidderId: marketBids.bidderPlayerId, amountCents: marketBids.amountCents, status: marketBids.status, createdAt: marketBids.createdAt })
    .from(marketBids).where(inArray(marketBids.auctionId, ids)).orderBy(desc(marketBids.amountCents), marketBids.createdAt) : [];
  return { items: rows.map((row) => { const all = bids.filter((bid) => bid.auctionId === row.id); return { ...row, leadingBid: all.find((bid) => bid.status === "active") ?? null, bidCount: all.length }; }), policy: steamLikeWalletPolicy };
};

export const createMarketAuction = async (sellerPlayerId: string, input: unknown) => {
  const openCount = Number((await gameDb.select({ count: sql<number>`count(*)::int` }).from(marketAuctions).where(and(eq(marketAuctions.sellerPlayerId, sellerPlayerId), eq(marketAuctions.status, "active"))))[0]?.count ?? 0);
  if (openCount >= 10) throw new Error("cancel an auction without bids before starting another");
  const body = (input ?? {}) as { petSeed?: unknown; startCents?: unknown; reserveCents?: unknown; durationHours?: unknown };
  const draft = normalizeAuctionDraft({ assetId: body.petSeed, startCents: body.startCents, reserveCents: body.reserveCents, durationHours: body.durationHours });
  const { assetId: petSeed, startCents, reserveCents, endsAt } = draft; const id = `auction:${crypto.randomUUID()}`;
  await gameDb.execute(sql`select create_market_auction(${id},${sellerPlayerId},${petSeed},${startCents},${reserveCents},${endsAt})`);
  void notifySubjectWatchers(petSeed, startCents, sellerPlayerId, "auction");
  return { id, petSeed, startCents, reserveCents, endsAt };
};

export const placeMarketBid = async (bidderPlayerId: string, auctionId: string, amountCentsRaw: unknown, idempotencyKey: string) => {
  const amountCents = assertMarketAmount(amountCentsRaw, "bid"); const key = assertIdempotencyKey(idempotencyKey);
  const previous = (await gameDb.select({ bidderId: marketBids.bidderPlayerId }).from(marketBids).where(and(eq(marketBids.auctionId, auctionId), eq(marketBids.status, "active"))).orderBy(desc(marketBids.amountCents)).limit(1))[0];
  const id = `bid:${crypto.randomUUID()}`; const result = await gameDb.execute(sql`select * from place_market_bid(${id},${auctionId},${bidderPlayerId},${amountCents},${key})`);
  if (!result.rows.length) throw new Error("bid was not placed");
  if (previous && previous.bidderId !== bidderPlayerId) void notifyMarketplace(previous.bidderId, "You were outbid", "Your reserved funds were released. Raise your bid before the auction ends if you still want the pet.", `auction:outbid:${auctionId}`);
  return { id, amountCents, ...(result.rows[0] as object) };
};

export const cancelMarketAuction = async (sellerPlayerId: string, auctionId: string) => {
  await gameDb.execute(sql`select cancel_market_auction(${auctionId},${sellerPlayerId})`);
};

export const createMarketListing = async (playerId: string, input: unknown) => {
  const openCount = Number((await gameDb.select({ count: sql<number>`count(*)::int` }).from(marketListings).where(and(eq(marketListings.sellerPlayerId, playerId), eq(marketListings.status, "active"))))[0]?.count ?? 0);
  if (openCount >= 50) throw new Error("active listing limit reached");
  const body = (input ?? {}) as { petSeed?: unknown; priceCents?: unknown; expiresAt?: unknown };
  const draft = normalizeListingDraft({ assetId: body.petSeed, priceCents: body.priceCents, expiresAt: body.expiresAt });
  const { assetId: petSeed, priceCents, expiresAt } = draft;
  const owned = (await gameDb.select({ seed: wildSeedSources.petSeed }).from(wildSeedSources)
    .where(and(eq(wildSeedSources.playerId, playerId), eq(wildSeedSources.petSeed, petSeed))).limit(1))[0];
  if (!owned) throw new Error("you do not own this pet");
  const id = `listing:${crypto.randomUUID()}`;
  await gameDb.insert(marketListings).values({ id, petSeed, sellerPlayerId: playerId, priceCents, expiresAt });
  void notifySubjectWatchers(petSeed, priceCents, playerId, "listing");
  return { id, petSeed, priceCents, fee: draft.fee };
};

export const cancelMarketListing = async (playerId: string, listingId: string) => {
  const changed = await gameDb.update(marketListings).set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(marketListings.id, listingId), eq(marketListings.sellerPlayerId, playerId), eq(marketListings.status, "active")))
    .returning({ id: marketListings.id });
  if (!changed.length) throw new Error("active listing not found");
};

type SettlementRow = { out_transaction_id: string; out_pet_seed: string; out_seller: string; out_buyer: string };
export const buyMarketListing = async (buyerPlayerId: string, listingId: string, idempotencyKey: string) => {
  const key = assertIdempotencyKey(idempotencyKey);
  const result = await gameDb.execute(sql`select * from settle_market_listing(${listingId}, ${buyerPlayerId}, ${key})`);
  const row = (result.rows as unknown as SettlementRow[])[0];
  if (!row) throw new Error("sale did not settle");
  void notifyMarketplace(row.out_seller, "Your pet sold", "The sale settled and your wallet and collection are updated.", `sale:${listingId}`);
  return row;
};

export const loadPetProvenance = async (petSeed: string) => gameDb.select({
  sequence: petOwnershipEvents.sequence, kind: petOwnershipEvents.kind, reason: petOwnershipEvents.reason,
  fromPlayerId: petOwnershipEvents.fromPlayerId, toPlayerId: petOwnershipEvents.toPlayerId,
  settlementRef: petOwnershipEvents.settlementRef, chainRef: petOwnershipEvents.chainRef,
  amountCents: petOwnershipEvents.amountCents, occurredAt: petOwnershipEvents.occurredAt,
}).from(petOwnershipEvents).where(eq(petOwnershipEvents.petSeed, petSeed)).orderBy(petOwnershipEvents.sequence);

export const loadPetMarketState = async (petSeed: string) => {
  const [listing, events, metaRows] = await Promise.all([
    gameDb.select({ id: marketListings.id, priceCents: marketListings.priceCents, sellerPlayerId: marketListings.sellerPlayerId })
      .from(marketListings).where(and(eq(marketListings.petSeed, petSeed), eq(marketListings.status, "active"), sql`(${marketListings.expiresAt} is null or ${marketListings.expiresAt} > now())`)).limit(1),
    loadPetProvenance(petSeed),
    gameDb.select({ printingId: wildSeedSources.printingId, finish: wildSeedSources.finish, material: wildSeedSources.material, colorway: wildSeedSources.colorway, pattern: wildSeedSources.copyPattern })
      .from(wildSeedSources).where(eq(wildSeedSources.petSeed, petSeed)).limit(1),
  ]);
  const meta = metaRows[0];
  const printingScope = meta?.printingId ? eq(wildSeedSources.printingId, meta.printingId) : eq(wildSeedSources.petSeed, petSeed);
  const exactScope = and(printingScope,
    sql`${wildSeedSources.finish} is not distinct from ${meta?.finish ?? null}`,
    sql`${wildSeedSources.material} is not distinct from ${meta?.material ?? null}`,
    sql`${wildSeedSources.colorway} is not distinct from ${meta?.colorway ?? null}`,
    sql`${wildSeedSources.copyPattern} is not distinct from ${meta?.pattern ?? null}`);
  const salesSummary = async (scope: ReturnType<typeof and> | ReturnType<typeof eq>) => (await gameDb.select({
    count: sql<number>`count(*)::int`, averageCents: sql<number>`round(avg(${petOwnershipEvents.amountCents}))::int`,
    lowCents: sql<number>`min(${petOwnershipEvents.amountCents})::int`, highCents: sql<number>`max(${petOwnershipEvents.amountCents})::int`,
  }).from(petOwnershipEvents).innerJoin(wildSeedSources, eq(wildSeedSources.petSeed, petOwnershipEvents.petSeed))
    .where(and(scope, eq(petOwnershipEvents.reason, "sale"), sql`${petOwnershipEvents.amountCents} is not null`)))[0];
  const floor = async (scope: ReturnType<typeof and> | ReturnType<typeof eq>) => Number((await gameDb.select({ value: sql<number>`min(${marketListings.priceCents})::int` })
    .from(marketListings).innerJoin(wildSeedSources, eq(wildSeedSources.petSeed, marketListings.petSeed))
    .where(and(scope, eq(marketListings.status, "active"), sql`(${marketListings.expiresAt} is null or ${marketListings.expiresAt} > now())`)))[0]?.value ?? 0) || null;
  const [printingSales, exactSales, printingFloorCents, exactFloorCents, recentSales] = meta ? await Promise.all([
    salesSummary(printingScope), salesSummary(exactScope), floor(printingScope), floor(exactScope),
    gameDb.select({ seed: petOwnershipEvents.petSeed, amountCents: petOwnershipEvents.amountCents, occurredAt: petOwnershipEvents.occurredAt,
      name: wildSeedSources.name, finish: wildSeedSources.finish, material: wildSeedSources.material, colorway: wildSeedSources.colorway,
      pattern: wildSeedSources.copyPattern, serialNumber: wildSeedSources.serialNumber, printRun: wildSeedSources.printRun,
    }).from(petOwnershipEvents).innerJoin(wildSeedSources, eq(wildSeedSources.petSeed, petOwnershipEvents.petSeed))
      .where(and(printingScope, eq(petOwnershipEvents.reason, "sale"), sql`${petOwnershipEvents.amountCents} is not null`))
      .orderBy(desc(petOwnershipEvents.occurredAt)).limit(8),
  ]) : [null, null, null, null, []];
  const ids = [...new Set(events.flatMap((event) => [event.fromPlayerId, event.toPlayerId]).filter((id): id is string => Boolean(id)))];
  const people = ids.length ? await gameDb.select({ id: players.id, login: players.githubLogin, handle: players.handle }).from(players).where(inArray(players.id, ids)) : [];
  const names = new Map(people.map((person) => [person.id, { login: person.login, handle: person.handle }]));
  return {
    listing: listing[0] ?? null,
    valuation: { printingSales: printingSales ?? { count: 0, averageCents: null, lowCents: null, highCents: null }, exactSales: exactSales ?? { count: 0, averageCents: null, lowCents: null, highCents: null }, printingFloorCents, exactFloorCents, recentSales },
    events: events.map((event) => ({ ...event, from: event.fromPlayerId ? names.get(event.fromPlayerId) ?? null : null, to: event.toPlayerId ? names.get(event.toPlayerId) ?? null : null })),
  };
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
  const recentCount = Number((await gameDb.select({ count: sql<number>`count(*)::int` }).from(marketTrades).where(and(eq(marketTrades.proposerPlayerId, proposerId), sql`${marketTrades.createdAt} > now() - interval '24 hours'`)))[0]?.count ?? 0);
  if (recentCount >= 50) throw new Error("daily trade-offer limit reached");
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
  void notifyMarketplace(counterparty.id, parentTradeId ? "New counteroffer" : requested.length ? "New trade offer" : "A collector sent you a gift", parentTradeId ? "Open the trade desk to review the revised exchange." : requested.length ? "Open the trade desk to compare both sides." : "Accept it to add the pet to your collection.", `trade:new:${id}`);
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
  const trade = (await gameDb.select({ proposerId: marketTrades.proposerPlayerId }).from(marketTrades).where(eq(marketTrades.id, tradeId)).limit(1))[0];
  if (trade) void notifyMarketplace(trade.proposerId, "Trade accepted", "Every pet and fee moved together. Your collection is updated.", `trade:accepted:${tradeId}`);
  return row;
};

export const declineMarketTrade = async (playerId: string, tradeId: string) => {
  const changed = await gameDb.update(marketTrades).set({ status: "declined", updatedAt: new Date() })
    .where(and(eq(marketTrades.id, tradeId), eq(marketTrades.counterpartyPlayerId, playerId), eq(marketTrades.status, "pending"))).returning({ id: marketTrades.id, proposerId: marketTrades.proposerPlayerId });
  if (!changed.length) throw new Error("pending incoming trade not found");
  void notifyMarketplace(changed[0].proposerId, "Trade declined", "No pets or wallet funds moved.", `trade:declined:${tradeId}`);
};

export const cancelMarketTrade = async (playerId: string, tradeId: string) => {
  const changed = await gameDb.update(marketTrades).set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(marketTrades.id, tradeId), eq(marketTrades.proposerPlayerId, playerId), eq(marketTrades.status, "pending"))).returning({ id: marketTrades.id, counterpartyId: marketTrades.counterpartyPlayerId });
  if (!changed.length) throw new Error("pending outgoing trade not found");
  void notifyMarketplace(changed[0].counterpartyId, "Trade cancelled", "The sender closed this offer. No pets or wallet funds moved.", `trade:cancelled:${tradeId}`);
};
