import { cents, sellerFee, steamLikeWalletPolicy } from "@absolutejs/wallet";
import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import {
  marketListings, petOwnershipEvents, petPrintings, petSubjects, players, walletAccounts,
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
