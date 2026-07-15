import { Head } from "@absolutejs/absolute/react/components";
import { useEffect, useMemo, useState } from "react";
import { generate } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";
import { SiteHeader } from "../components/SiteHeader";

type Listing = {
  id: string; seed: string; priceCents: number; sellerReceivesCents: number; seller: string | null; sellerHandle: string;
  name: string; tier: string; finish: string | null; mutation: string | null; material: string | null; colorway: string | null;
  copyPattern: string | null; serialNumber: number | null; printRun: number | null; subjectId: string | null; subjectName: string | null; createdAt: string | Date;
};
type WalletPolicy = { minimumFundingCents: number; maximumBalanceCents: number; maximumTransactionCents: number; sellerFeeBps: number; tradeFeeCents: number; currency: string };
type MarketData = { items: Listing[]; nextCursor: string | null; policy: WalletPolicy };
type WalletData = { playerId?: string; status?: string; balanceCents: number; reservedCents: number; availableCents: number; history: { id: string; kind: string; amountCents: number; createdAt: string }[] };
type TradePet = { seed: string; name: string; tier: string; printingId?: string | null; finish?: string | null; mutation?: string | null; material?: string | null; colorway?: string | null; copyPattern?: string | null; serialNumber?: number | null; printRun?: number | null };
type Collector = { id: string; login: string | null; handle: string };
type Trade = {
  id: string; status: string; direction: "incoming" | "outgoing"; note: string | null; createdAt: string; expiresAt: string | null; parentTradeId: string | null;
  proposer: Collector | null; counterparty: Collector | null; offeredPets: TradePet[]; requestedPets: TradePet[];
};
type TradesData = { items: Trade[]; policy: { tradeFeeCents: number } };
type BuyCriteria = { printingId?: string; subjectId?: string; finish?: string; material?: string; colorway?: string; pattern?: string; maxSerial?: number };
type BuyOrder = { id: string; criteria: BuyCriteria; priceCents: number; createdAt: string; expiresAt: string | null; buyerId: string; buyerLogin: string | null; buyerHandle: string; subject: { id: string; subjectId: string; subjectName: string } | null };
type PetTemplate = { seed: string; name: string; printingId: string; subjectId: string | null; subjectName: string | null; finish: string | null; material: string | null; colorway: string | null; pattern: string | null; serialNumber: number | null; printRun: number | null };
type Auction = { id: string; petSeed: string; sellerId: string; startCents: number; reserveCents: number | null; endsAt: string; extensionCount: number; sellerLogin: string | null; sellerHandle: string; name: string; tier: string; finish: string | null; material: string | null; colorway: string | null; serialNumber: number | null; printRun: number | null; leadingBid: { bidderId: string; amountCents: number } | null; bidCount: number };
const money = (amountCents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountCents / 100);

const petArt = (seed: string) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box: 112 });
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><g>${svg}</g></svg>`;
};
const errorMessage = (body: unknown, fallback: string) => typeof body === "string" ? body : body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : fallback;
const collectorName = (collector: Collector | null) => collector?.login ? `@${collector.login}` : collector?.handle ?? "Collector";

const ListingCard = ({ item, wallet, signedIn, busy, buy }: { item: Listing; wallet: WalletData | null; signedIn: boolean; busy: string | null; buy: (item: Listing) => void }) => (
  <article className="marketCard">
    <a className="marketPetArt" href={`/pet/${encodeURIComponent(item.seed)}`} dangerouslySetInnerHTML={{ __html: petArt(item.seed) }} />
    <div className="marketCardBody">
      <div className="marketCardTitle"><a href={`/pet/${encodeURIComponent(item.seed)}`}>{item.name || item.subjectName}</a><span>{item.tier}</span></div>
      <div className="marketTraits"><span>{item.finish}</span>{item.serialNumber && <span>#{item.serialNumber}/{item.printRun}</span>}{item.material !== "Standard" && <span>{item.material}</span>}{item.mutation !== "Standard" && <span>{item.mutation}</span>}</div>
      <a className="marketSeller" href={item.seller ? `/profile/${item.seller}` : "#"}>Sold by {item.seller ? `@${item.seller}` : item.sellerHandle}</a>
      {item.subjectId && <a className="marketSeller" href={`/marketplace/subjects/${encodeURIComponent(item.subjectId)}`}>View every {item.subjectName ?? "subject"} copy →</a>}
      <div className="marketPrice"><div><strong>{money(item.priceCents)}</strong><small>buyer pays</small></div>
        {signedIn ? <button disabled={busy === item.id || (wallet?.availableCents ?? 0) < item.priceCents} onClick={() => buy(item)}>{busy === item.id ? "Settling…" : (wallet?.availableCents ?? 0) < item.priceCents ? "Add funds" : "Buy now"}</button> : <a href="/">Sign in to buy</a>}
      </div>
    </div>
  </article>
);

const TradePetPicker = ({ title, subtitle, pets, selected, toggle, empty }: { title: string; subtitle: string; pets: TradePet[]; selected: string[]; toggle: (seed: string) => void; empty: string }) => (
  <div className="tradePicker">
    <div className="tradePickerHead"><div><h3>{title}</h3><p>{subtitle}</p></div><strong>{selected.length}/10</strong></div>
    {pets.length ? <div className="tradePetGrid">{pets.map((pet) => {
      const active = selected.includes(pet.seed);
      return <button type="button" className={active ? "tradePet active" : "tradePet"} aria-pressed={active} key={pet.seed} onClick={() => toggle(pet.seed)}>
        <span className="tradePetArt" dangerouslySetInnerHTML={{ __html: petArt(pet.seed) }} /><span className="tradePetCopy"><strong>{pet.name}</strong><small>{pet.finish ?? pet.tier}{pet.serialNumber ? ` · #${pet.serialNumber}/${pet.printRun}` : ""}</small></span><span className="tradeCheck">{active ? "✓" : "+"}</span>
      </button>;
    })}</div> : <div className="tradePickerEmpty">{empty}</div>}
  </div>
);

const TradePetStrip = ({ pets, empty }: { pets: TradePet[]; empty: string }) => pets.length ? <div className="tradePetStrip">{pets.map((pet) => <a href={`/pet/${encodeURIComponent(pet.seed)}`} key={pet.seed}><span dangerouslySetInnerHTML={{ __html: petArt(pet.seed) }} /><strong>{pet.name}</strong><small>{pet.finish ?? pet.tier}{pet.serialNumber ? ` · #${pet.serialNumber}/${pet.printRun}` : ""}</small></a>)}</div> : <div className="tradeGift">{empty}</div>;

const PRACTICE_PETS = [
  { seed: "practice:market:rookie", name: "Ledger Lynx", tier: "Common", finish: "Base", priceCents: 600 },
  { seed: "practice:market:holo", name: "Webhook Wolf", tier: "Rare", finish: "Holo", priceCents: 1200 },
  { seed: "practice:market:trade", name: "Atomic Axolotl", tier: "Epic", finish: "Prismatic", priceCents: 0 },
] as const;
const PracticeMarket = () => {
  const [balance, setBalance] = useState(2500); const [owned, setOwned] = useState<string[]>([PRACTICE_PETS[0].seed]); const [activity, setActivity] = useState<string[]>([]);
  const buy = (pet: typeof PRACTICE_PETS[number]) => { if (!pet.priceCents || balance < pet.priceCents || owned.includes(pet.seed)) return; setBalance((value) => value - pet.priceCents); setOwned((value) => [...value, pet.seed]); setActivity((value) => [`Bought ${pet.name} for ${money(pet.priceCents)}. Money and ownership moved together.`, ...value]); };
  const trade = () => { if (!owned.includes(PRACTICE_PETS[0].seed) || balance < 25) return; setBalance((value) => value - 25); setOwned((value) => [...value.filter((seed) => seed !== PRACTICE_PETS[0].seed), PRACTICE_PETS[2].seed]); setActivity((value) => [`Traded Ledger Lynx for Atomic Axolotl; ${money(25)} practice fee charged.`, ...value]); };
  const reset = () => { setBalance(2500); setOwned([PRACTICE_PETS[0].seed]); setActivity([]); };
  return <section className="practiceMarket"><header><div><span>SAFE WALKTHROUGH</span><h2>Learn the market with pretend money</h2><p>This browser-only practice desk never contacts the wallet API, creates a listing, or touches a real pet.</p></div><div className="practiceBalance"><span>Practice balance</span><strong>{money(balance)}</strong><button onClick={reset}>Reset</button></div></header><div className="practiceSteps"><article><span>1</span><h3>Buy a listed pet</h3><p>The displayed price is the complete buyer cost. Settlement is all-or-nothing.</p><div className="practicePets">{PRACTICE_PETS.slice(0, 2).map((pet) => <div key={pet.seed}><span dangerouslySetInnerHTML={{ __html: petArt(pet.seed) }} /><div><strong>{pet.name}</strong><small>{pet.finish} · {pet.tier}</small></div><button disabled={owned.includes(pet.seed) || balance < pet.priceCents} onClick={() => buy(pet)}>{owned.includes(pet.seed) ? "Owned" : money(pet.priceCents)}</button></div>)}</div></article><article><span>2</span><h3>Accept a direct trade</h3><p>Practice swapping your Ledger Lynx. The trade fee applies only when the exchange succeeds.</p><div className="practiceOffer"><div><strong>You give</strong><span>Ledger Lynx</span></div><b>⇄</b><div><strong>You receive</strong><span>Atomic Axolotl</span></div></div><button disabled={!owned.includes(PRACTICE_PETS[0].seed) || balance < 25} onClick={trade}>{owned.includes(PRACTICE_PETS[2].seed) ? "Trade complete" : `Accept · ${money(25)}`}</button></article><article><span>3</span><h3>Read the receipt</h3><p>Real settlements retain the item’s origin and append its transfer to permanent provenance.</p>{activity.length ? <ol>{activity.map((line) => <li key={line}>{line}</li>)}</ol> : <div className="practiceEmpty">Your practice activity will appear here.</div>}</article></div></section>;
};

const TradeCard = ({ trade, feeCents, wallet, busy, act, counter }: { trade: Trade; feeCents: number; wallet: WalletData | null; busy: string | null; act: (trade: Trade, action: "accept" | "decline" | "cancel") => void; counter: (trade: Trade) => void }) => {
  const other = trade.direction === "incoming" ? trade.proposer : trade.counterparty;
  const pending = trade.status === "pending";
  const isGift = trade.requestedPets.length === 0;
  const acceptFee = isGift ? 0 : feeCents;
  return <article className="tradeCard">
    <header><div><span className={`tradeStatus ${trade.status}`}>{trade.status}</span><h3>{trade.direction === "incoming" ? "Offer from" : "Offer to"} {collectorName(other)}</h3></div><time>{new Date(trade.createdAt).toLocaleDateString()}</time></header>
    {trade.note && <blockquote>“{trade.note}”</blockquote>}
    <div className="tradeSides">
      <div><span>{trade.direction === "incoming" ? "You receive" : "You give"}</span><TradePetStrip pets={trade.offeredPets} empty="No pets" /></div>
      <div className="tradeArrow" aria-hidden="true">⇄</div>
      <div><span>{trade.direction === "incoming" ? "You give" : "You receive"}</span><TradePetStrip pets={trade.requestedPets} empty="Nothing requested · this is a gift" /></div>
    </div>
    <footer><span>{pending ? isGift ? (trade.direction === "incoming" ? "Free to accept" : `${money(feeCents)} sender fee on acceptance`) : `${money(feeCents)} per collector when accepted` : trade.status === "accepted" ? "Ownership transferred atomically" : "No ownership changed"}</span>
      {pending && trade.direction === "incoming" && <div><button className="tradeSecondary" disabled={busy === trade.id} onClick={() => counter(trade)}>Counter</button><button className="tradeSecondary" disabled={busy === trade.id} onClick={() => act(trade, "decline")}>Decline</button><button disabled={busy === trade.id || (wallet?.availableCents ?? 0) < acceptFee} onClick={() => act(trade, "accept")}>{busy === trade.id ? "Working…" : (wallet?.availableCents ?? 0) < acceptFee ? "Add funds" : `Accept${acceptFee ? ` · ${money(acceptFee)}` : ""}`}</button></div>}
      {pending && trade.direction === "outgoing" && <button className="tradeSecondary" disabled={busy === trade.id} onClick={() => act(trade, "cancel")}>{busy === trade.id ? "Cancelling…" : "Cancel offer"}</button>}
    </footer>
  </article>;
};

export const RenownMarketplace = ({ cssPath, market: initialMarket, origin = "" }: { cssPath?: string; market: MarketData; origin?: string }) => {
  const [market, setMarket] = useState(initialMarket);
  const [workspace, setWorkspace] = useState<"listings" | "orders" | "auctions" | "trades" | "practice">("listings");
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [fundingEnabled, setFundingEnabled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [owned, setOwned] = useState<TradePet[]>([]);
  const [trades, setTrades] = useState<TradesData>({ items: [], policy: { tradeFeeCents: initialMarket.policy.tradeFeeCents } });
  const [buyOrders, setBuyOrders] = useState<BuyOrder[]>([]);
  const [auctions, setAuctions] = useState<Auction[]>([]); const [auctionSeed, setAuctionSeed] = useState(""); const [auctionStart, setAuctionStart] = useState(""); const [auctionReserve, setAuctionReserve] = useState(""); const [auctionHours, setAuctionHours] = useState("24"); const [bidDollars, setBidDollars] = useState<Record<string,string>>({});
  const [templateSeed, setTemplateSeed] = useState(""); const [template, setTemplate] = useState<PetTemplate | null>(null);
  const [orderMatch, setOrderMatch] = useState<"printing" | "finish" | "exact">("printing"); const [orderDollars, setOrderDollars] = useState(""); const [orderMaxSerial, setOrderMaxSerial] = useState("");
  const [fillSeeds, setFillSeeds] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [focusListing, setFocusListing] = useState("");
  const [sellSeed, setSellSeed] = useState("");
  const [sellDollars, setSellDollars] = useState("");
  const [depositDollars, setDepositDollars] = useState("10");
  const [counterpartyLogin, setCounterpartyLogin] = useState("");
  const [counterparty, setCounterparty] = useState<Collector | null>(null);
  const [counterpartyPets, setCounterpartyPets] = useState<TradePet[]>([]);
  const [offered, setOffered] = useState<string[]>([]);
  const [requested, setRequested] = useState<string[]>([]);
  const [tradeNote, setTradeNote] = useState("");
  const [parentTradeId, setParentTradeId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sellCents = Math.round(Number(sellDollars) * 100);
  const fee = useMemo(() => { const feeCents = Math.ceil((sellCents * market.policy.sellerFeeBps) / 10_000); return Number.isSafeInteger(sellCents) && sellCents > 0 ? { feeCents, sellerNetCents: sellCents - feeCents } : null; }, [sellCents, market.policy.sellerFeeBps]);
  const toggle = (current: string[], seed: string, setter: (seeds: string[]) => void) => setter(current.includes(seed) ? current.filter((item) => item !== seed) : current.length < 10 ? [...current, seed] : current);

  const refreshWallet = async () => {
    const response = await fetch("/api/account/wallet");
    if (response.ok) { setSignedIn(true); setWallet(await response.json() as WalletData); return true; }
    return false;
  };
  const refreshTrades = async () => {
    const response = await fetch("/api/account/marketplace/trades");
    if (response.ok) setTrades(await response.json() as TradesData);
  };
  const refreshBuyOrders = async () => { const response = await fetch("/api/marketplace/buy-orders"); if (response.ok) setBuyOrders(((await response.json()) as { items: BuyOrder[] }).items ?? []); };
  const refreshAuctions = async () => { const response = await fetch("/api/marketplace/auctions"); if (response.ok) setAuctions(((await response.json()) as { items: Auction[] }).items ?? []); };
  const refreshMarket = async () => {
    const params = new URLSearchParams({ limit: "24" }); if (query.trim()) params.set("q", query.trim()); if (focusListing) params.set("listingId", focusListing);
    const response = await fetch(`/api/marketplace?${params}`); if (response.ok) setMarket(await response.json() as MarketData);
  };
  const loadCollector = async (login = counterpartyLogin, wantedSeed?: string) => {
    const clean = login.trim().replace(/^@/, ""); if (!clean) return;
    setBusy("collector");
    const response = await fetch(`/api/account/marketplace/collectors/${encodeURIComponent(clean)}/pets`);
    const body = await response.json().catch(() => null) as { collector?: Collector; pets?: TradePet[] } | string | null;
    if (response.ok && body && typeof body === "object" && body.collector) { setCounterparty(body.collector); setCounterpartyLogin(body.collector.login ?? clean); setCounterpartyPets(body.pets ?? []); if (wantedSeed && (body.pets ?? []).some((pet) => pet.seed === wantedSeed)) setRequested([wantedSeed]); }
    else setNotice(errorMessage(body, "Collector not found."));
    setBusy(null);
  };
  const loadTemplate = async (seed = templateSeed) => { const clean = seed.trim(); if (!clean) return; setBusy("template"); const response = await fetch(`/api/account/marketplace/pet-template/${encodeURIComponent(clean)}`); const body = await response.json().catch(() => null); if (response.ok) { setTemplate(body as PetTemplate); setTemplateSeed(clean); } else setNotice(errorMessage(body, "Could not load that pet.")); setBusy(null); };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedSell = params.get("sell"); const requestedBuy = params.get("buy"); const tradeWith = params.get("trade"); const wanted = params.get("want"); const give = params.get("give"); const buyOrderSeed = params.get("buyOrder"); const requestedView = params.get("view");
    if (requestedSell) setSellSeed(requestedSell); if (requestedBuy) setFocusListing(requestedBuy);
    if (requestedView === "trades" || tradeWith || wanted || give) { setWorkspace("trades"); if (tradeWith) setCounterpartyLogin(tradeWith); if (give) setOffered([give]); }
    if (requestedView === "orders" || buyOrderSeed) { setWorkspace("orders"); if (buyOrderSeed) setTemplateSeed(buyOrderSeed); }
    if (requestedView === "auctions") setWorkspace("auctions");
    if (requestedView === "practice") setWorkspace("practice");
    void Promise.all([refreshBuyOrders(), refreshAuctions()]);
    void (async () => {
      const sessionResponse = await fetch("/oauth2/status", { credentials: "include" });
      const session = sessionResponse.ok ? await sessionResponse.json().catch(() => null) as { user?: unknown } | null : null;
      if (session?.user && await refreshWallet()) {
      await refreshTrades();
      const petsResponse = await fetch("/api/account/pets?limit=100&sort=rarest");
      if (petsResponse.ok) { const petsBody = await petsResponse.json() as { pets: TradePet[] }; setOwned(petsBody.pets ?? []); }
      if (tradeWith) await loadCollector(tradeWith, wanted ?? undefined); if (buyOrderSeed) await loadTemplate(buyOrderSeed);
      }
    })();
    fetch("/stripe/config").then(async (response) => { if (response.ok) setFundingEnabled(Boolean(((await response.json()) as { walletFundingEnabled?: boolean }).walletFundingEnabled)); }).catch(() => {});
  }, []);
  useEffect(() => { const timer = setTimeout(() => void refreshMarket(), 180); return () => clearTimeout(timer); }, [query, focusListing]);

  const deposit = async () => {
    const amountCents = Math.round(Number(depositDollars) * 100); setBusy("deposit");
    const response = await fetch("/wallet/deposit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountCents }) });
    const body = await response.json().catch(() => null) as { url?: string } | string | null;
    if (response.ok && body && typeof body === "object" && body.url) window.location.href = body.url;
    else { setNotice(errorMessage(body, "Wallet funding is not available yet.")); setBusy(null); }
  };
  const list = async () => {
    setBusy("list"); const response = await fetch("/api/account/marketplace/listings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ petSeed: sellSeed, priceCents: sellCents }) });
    const body = await response.json().catch(() => null);
    if (response.ok) { setNotice("Your pet is live on the market. You can keep using it until it sells."); setSellSeed(""); setSellDollars(""); await refreshMarket(); }
    else setNotice(errorMessage(body, "Could not create the listing.")); setBusy(null);
  };
  const buy = async (item: Listing) => {
    if ((wallet?.availableCents ?? 0) < item.priceCents) { setNotice("Add enough wallet funds before buying."); return; }
    if (!window.confirm(`Buy ${item.name} for ${money(item.priceCents)}? Ownership transfers immediately.`)) return;
    setBusy(item.id); const response = await fetch(`/api/account/marketplace/listings/${encodeURIComponent(item.id)}/buy`, { method: "POST", headers: { "idempotency-key": `web:${crypto.randomUUID()}` } });
    const body = await response.json().catch(() => null);
    if (response.ok) { setNotice(`${item.name} is now yours. Its complete ownership history stays attached.`); await Promise.all([refreshWallet(), refreshMarket()]); }
    else setNotice(errorMessage(body, "The sale could not settle.")); setBusy(null);
  };
  const sendTrade = async () => {
    if (!counterparty || !offered.length) return; setBusy("send-trade");
    const response = await fetch("/api/account/marketplace/trades", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ counterpartyLogin: counterparty.login, offeredPetSeeds: offered, requestedPetSeeds: requested, note: tradeNote, parentTradeId }) });
    const body = await response.json().catch(() => null);
    if (response.ok) { setNotice(parentTradeId ? "Counteroffer sent. The original offer is now closed." : requested.length ? "Trade offer sent. Nothing moves until they accept." : "Gift offer sent. It remains yours until they accept."); setOffered([]); setRequested([]); setTradeNote(""); setParentTradeId(null); await refreshTrades(); }
    else setNotice(errorMessage(body, "Could not send the trade offer.")); setBusy(null);
  };
  const actOnTrade = async (trade: Trade, action: "accept" | "decline" | "cancel") => {
    if (action === "accept" && !window.confirm("Accept this trade? Wallet fees and every pet will transfer together immediately.")) return;
    setBusy(trade.id); const endpoint = action === "cancel" ? `/api/account/marketplace/trades/${encodeURIComponent(trade.id)}` : `/api/account/marketplace/trades/${encodeURIComponent(trade.id)}/${action}`;
    const response = await fetch(endpoint, { method: action === "cancel" ? "DELETE" : "POST", headers: action === "accept" ? { "idempotency-key": `web:${trade.id}` } : undefined });
    const body = await response.json().catch(() => null);
    if (response.ok) { setNotice(action === "accept" ? "Trade complete. Ownership histories and both collections are updated." : action === "decline" ? "Offer declined. No ownership changed." : "Offer cancelled. No ownership changed."); await Promise.all([refreshTrades(), refreshWallet()]); }
    else setNotice(errorMessage(body, `Could not ${action} the trade.`)); setBusy(null);
  };
  const beginCounter = async (trade: Trade) => {
    const login = trade.proposer?.login; if (!login) { setNotice("This collector does not have a tradeable GitHub profile."); return; }
    setCounterpartyLogin(login); await loadCollector(login); setOffered(trade.requestedPets.map((pet) => pet.seed)); setRequested(trade.offeredPets.map((pet) => pet.seed)); setTradeNote(""); setParentTradeId(trade.id); document.getElementById("trade-composer")?.scrollIntoView({ behavior: "smooth" });
  };
  const createOrder = async () => { if (!template) return; const priceCents = Math.round(Number(orderDollars) * 100); setBusy("create-order"); const response = await fetch("/api/account/marketplace/buy-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ petSeed: template.seed, match: orderMatch, priceCents, maxSerial: Number(orderMaxSerial) || undefined }) }); const body = await response.json().catch(() => null); if (response.ok) { setNotice(`Buy order posted. ${money(priceCents)} is reserved until it fills, expires, or you cancel.`); setOrderDollars(""); await Promise.all([refreshBuyOrders(), refreshWallet()]); } else setNotice(errorMessage(body, "Could not post the buy order.")); setBusy(null); };
  const cancelOrder = async (order: BuyOrder) => { setBusy(order.id); const response = await fetch(`/api/account/marketplace/buy-orders/${encodeURIComponent(order.id)}`, { method: "DELETE" }); const body = await response.json().catch(() => null); if (response.ok) { setNotice("Buy order cancelled and reserved funds released."); await Promise.all([refreshBuyOrders(), refreshWallet()]); } else setNotice(errorMessage(body, "Could not cancel the buy order.")); setBusy(null); };
  const fillOrder = async (order: BuyOrder) => { const petSeed = fillSeeds[order.id]; if (!petSeed || !window.confirm(`Instantly sell this pet for ${money(order.priceCents)}? Ownership transfers immediately.`)) return; setBusy(order.id); const response = await fetch(`/api/account/marketplace/buy-orders/${encodeURIComponent(order.id)}/fill`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `web:${order.id}:${petSeed}` }, body: JSON.stringify({ petSeed }) }); const body = await response.json().catch(() => null); if (response.ok) { setNotice("Instant sale complete. Ownership and reserved funds settled together."); await Promise.all([refreshBuyOrders(), refreshWallet()]); } else setNotice(errorMessage(body, "The pet did not match or the order could not settle.")); setBusy(null); };
  const matchingPets = (order: BuyOrder) => owned.filter((pet) => pet.printingId === order.criteria.printingId && (!order.criteria.finish || pet.finish === order.criteria.finish) && (!order.criteria.material || pet.material === order.criteria.material) && (!order.criteria.colorway || pet.colorway === order.criteria.colorway) && (!order.criteria.pattern || pet.copyPattern === order.criteria.pattern) && (!order.criteria.maxSerial || Boolean(pet.serialNumber && pet.serialNumber <= order.criteria.maxSerial)));
  const createAuction = async () => { setBusy("create-auction"); const response = await fetch("/api/account/marketplace/auctions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ petSeed: auctionSeed, startCents: Math.round(Number(auctionStart)*100), reserveCents: auctionReserve ? Math.round(Number(auctionReserve)*100) : undefined, durationHours: Number(auctionHours) }) }); const body = await response.json().catch(() => null); if (response.ok) { setNotice("Auction started. The pet remains usable, but a live bid makes the auction non-cancellable."); setAuctionSeed(""); setAuctionStart(""); setAuctionReserve(""); await refreshAuctions(); } else setNotice(errorMessage(body, "Could not start the auction.")); setBusy(null); };
  const placeBid = async (auction: Auction) => { const amountCents = Math.round(Number(bidDollars[auction.id])*100); if (!window.confirm(`Reserve ${money(amountCents)} as your bid? It is released immediately if someone outbids you.`)) return; setBusy(auction.id); const response = await fetch(`/api/account/marketplace/auctions/${encodeURIComponent(auction.id)}/bids`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `web:${auction.id}:${amountCents}:${crypto.randomUUID()}` }, body: JSON.stringify({ amountCents }) }); const body = await response.json().catch(() => null); if (response.ok) { setNotice("Bid placed and funds reserved. Bids inside the final two minutes extend the auction to prevent sniping."); await Promise.all([refreshAuctions(), refreshWallet()]); } else setNotice(errorMessage(body, "Could not place the bid.")); setBusy(null); };
  const cancelAuction = async (auction: Auction) => { setBusy(auction.id); const response = await fetch(`/api/account/marketplace/auctions/${encodeURIComponent(auction.id)}`, { method: "DELETE" }); const body = await response.json().catch(() => null); if (response.ok) { setNotice("Auction cancelled. No ownership changed."); await refreshAuctions(); } else setNotice(errorMessage(body, "Could not cancel the auction.")); setBusy(null); };

  const title = "Pet marketplace — Renown";
  const description = "Buy, sell, trade, and track Renown pet cards with guaranteed settlement and permanent provenance.";
  return <html lang="en"><Head cssPath={cssPath} title={title} description={description} canonical={`${origin}/marketplace`} /><body><main className="wrap marketPage">
    <SiteHeader current="marketplace" />
    <section className="marketHero"><div><span className="collectionEyebrow">GUARANTEED SETTLEMENT</span><h1>The pet market</h1><p>Buy at a known price or negotiate pet-for-pet. Ownership and wallet fees move together—once—and every pet keeps its complete history.</p></div>
      <div className="walletCard"><span>Available wallet</span><strong>{wallet ? money(wallet.availableCents) : signedIn ? "Loading…" : "$0.00"}</strong><small>{wallet?.status === "frozen" ? "Frozen for review · contact support" : wallet?.reservedCents ? `${money(wallet.reservedCents)} reserved` : "Closed-loop USD · no cash withdrawals"}</small></div>
    </section>
    <nav className="marketTabs" aria-label="Marketplace sections"><button className={workspace === "listings" ? "active" : ""} onClick={() => setWorkspace("listings")}><strong>Buy & sell</strong><span>Fixed-price listings</span></button><button className={workspace === "orders" ? "active" : ""} onClick={() => setWorkspace("orders")}><strong>Buy orders</strong><span>Reserved instant offers</span></button><button className={workspace === "auctions" ? "active" : ""} onClick={() => setWorkspace("auctions")}><strong>Auctions</strong><span>Timed bidding</span></button><button className={workspace === "trades" ? "active" : ""} onClick={() => setWorkspace("trades")}><strong>Direct trades</strong><span>Offers & counteroffers</span></button><button className={workspace === "practice" ? "active" : ""} onClick={() => setWorkspace("practice")}><strong>Practice</strong><span>Safe guided sandbox</span></button></nav>
    {notice && <div className="collectionNotice"><span>{notice}</span><button onClick={() => setNotice(null)}>Dismiss</button></div>}
    {workspace === "listings" ? <>
      <section className="marketControls"><label className="marketSearch"><span>Search the market</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pet, subject, or seller…" /></label><div className="marketPolicy"><strong>10% seller fee</strong><span>Buyers pay the displayed price. No surprise checkout fee.</span></div></section>
      {signedIn && <section className="marketDesk"><div><h2>Add wallet funds</h2><p>{fundingEnabled ? "Minimum $5 · maximum wallet balance $2,000." : "Funding opens after payment-provider marketplace approval."}</p><div className="marketInline"><span>$</span><input inputMode="decimal" disabled={!fundingEnabled} value={depositDollars} onChange={(e) => setDepositDollars(e.target.value)} /><button disabled={!fundingEnabled || busy === "deposit"} onClick={() => void deposit()}>{fundingEnabled ? "Continue to Stripe" : "Funding not open"}</button></div></div><div><h2>Sell a pet</h2><p>It stays usable until ownership transfers.</p><select value={sellSeed} onChange={(e) => setSellSeed(e.target.value)}><option value="">Choose from your collection…</option>{owned.map((pet) => <option value={pet.seed} key={pet.seed}>{pet.name} · {pet.finish ?? pet.tier}{pet.serialNumber ? ` #${pet.serialNumber}/${pet.printRun}` : ""}</option>)}</select><div className="marketInline"><span>$</span><input inputMode="decimal" value={sellDollars} onChange={(e) => setSellDollars(e.target.value)} placeholder="25.00" /><button disabled={!sellSeed || !fee || busy === "list"} onClick={() => void list()}>List for sale</button></div>{fee && <small>You receive {money(fee.sellerNetCents)} after the {money(fee.feeCents)} fee.</small>}</div></section>}
      {signedIn && wallet?.history?.length ? <details className="walletReceipts"><summary>Wallet receipts <span>{wallet.history.length} recent entries</span></summary><div>{wallet.history.map((entry) => <article key={entry.id}><div><strong>{entry.kind.replaceAll("-", " ")}</strong><code>{entry.id}</code></div><span className={entry.amountCents > 0 ? "credit" : "debit"}>{entry.amountCents > 0 ? "+" : ""}{money(entry.amountCents)}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></article>)}</div></details> : null}
      <div className="marketSectionTitle"><div><span>LIVE LISTINGS</span><h2>{focusListing ? "Selected listing" : "Available now"}</h2></div>{focusListing ? <button className="petAction" onClick={() => { setFocusListing(""); history.replaceState(null, "", "/marketplace"); }}>View all listings</button> : <span>{market.items.length} shown</span>}</div>
      {market.items.length ? <section className="marketGrid">{market.items.map((item) => <ListingCard key={item.id} item={item} wallet={wallet} signedIn={signedIn} busy={busy} buy={(row) => void buy(row)} />)}</section> : <section className="collectionEmpty"><h2>The market floor is empty</h2><p>Be the first collector to name a price.</p></section>}
    </> : workspace === "orders" ? <>
      {signedIn && <section className="buyOrderComposer"><header><div><span>RESERVED OFFER</span><h2>Post a price you will pay now</h2><p>Choose an existing pet as the template. Your dollars are reserved immediately and released automatically if you cancel or the order expires.</p></div><strong>{wallet ? `${money(wallet.availableCents)} available` : "Wallet loading…"}</strong></header><div className="buyOrderTemplate"><label><span>Pet seed or pet-page link seed</span><div><input value={templateSeed} onChange={(event) => { setTemplateSeed(event.target.value); setTemplate(null); }} placeholder="Paste a pet seed…" /><button disabled={!templateSeed.trim() || busy === "template"} onClick={() => void loadTemplate()}>{busy === "template" ? "Loading…" : "Use as template"}</button></div></label>{template && <div className="buyOrderTemplateFound"><span dangerouslySetInnerHTML={{ __html: petArt(template.seed) }} /><div><strong>{template.subjectName ?? template.name}</strong><small>{template.finish} · {template.material} · {template.colorway} · {template.pattern}</small></div></div>}</div>{template && <div className="buyOrderTerms"><label><span>Copies you will accept</span><select value={orderMatch} onChange={(event) => setOrderMatch(event.target.value as "printing" | "finish" | "exact")}><option value="printing">Any copy of this subject</option><option value="finish">Same subject and finish</option><option value="exact">Exact finish, material, colorway, and pattern</option></select></label><label><span>Maximum serial <small>optional</small></span><input inputMode="numeric" value={orderMaxSerial} onChange={(event) => setOrderMaxSerial(event.target.value)} placeholder="Any serial" /></label><label><span>Your instant-buy price</span><div className="buyOrderMoney"><span>$</span><input inputMode="decimal" value={orderDollars} onChange={(event) => setOrderDollars(event.target.value)} placeholder="25.00" /></div></label><button disabled={!Number(orderDollars) || busy === "create-order" || Math.round(Number(orderDollars) * 100) > (wallet?.availableCents ?? 0)} onClick={() => void createOrder()}>{busy === "create-order" ? "Reserving…" : Math.round(Number(orderDollars) * 100) > (wallet?.availableCents ?? 0) ? "Not enough available" : "Reserve funds & post"}</button></div>}</section>}
      <div className="marketSectionTitle"><div><span>LIVE BUY ORDERS</span><h2>Collectors ready to buy</h2></div><span>{buyOrders.length} open</span></div>
      {buyOrders.length ? <section className="buyOrderList">{buyOrders.map((order) => { const matches = matchingPets(order); const mine = wallet?.playerId === order.buyerId; const details = [order.criteria.finish, order.criteria.material, order.criteria.colorway, order.criteria.pattern, order.criteria.maxSerial ? `serial ≤ ${order.criteria.maxSerial}` : null].filter(Boolean); return <article key={order.id}><header><div><span>WANTED</span><h3>{order.subject?.subjectName ?? "A matching pet"}</h3><p>{details.length ? details.join(" · ") : "Any variation in this printing"}</p></div><div><strong>{money(order.priceCents)}</strong><small>seller receives {money(order.priceCents - Math.ceil(order.priceCents * market.policy.sellerFeeBps / 10_000))}</small></div></header><footer><a href={order.buyerLogin ? `/profile/${order.buyerLogin}` : "#"}>{order.buyerLogin ? `@${order.buyerLogin}` : order.buyerHandle}</a>{mine ? <button className="tradeSecondary" disabled={busy === order.id} onClick={() => void cancelOrder(order)}>Cancel & release funds</button> : signedIn ? <div><select value={fillSeeds[order.id] ?? ""} onChange={(event) => setFillSeeds((current) => ({ ...current, [order.id]: event.target.value }))}><option value="">{matches.length ? "Choose a matching pet…" : "No matching pets owned"}</option>{matches.map((pet) => <option value={pet.seed} key={pet.seed}>{pet.name} · {pet.finish}{pet.serialNumber ? ` #${pet.serialNumber}/${pet.printRun}` : ""}</option>)}</select><button disabled={!fillSeeds[order.id] || busy === order.id} onClick={() => void fillOrder(order)}>{busy === order.id ? "Settling…" : "Sell instantly"}</button></div> : <a className="petAction" href="/">Sign in to sell</a>}</footer></article>; })}</section> : <section className="collectionEmpty"><h2>No open buy orders</h2><p>Post the first reserved offer for a subject collectors may be willing to sell.</p></section>}
    </> : workspace === "auctions" ? <>
      {signedIn && <section className="auctionComposer"><header><div><span>START AN AUCTION</span><h2>Let collectors name the market</h2><p>Your pet stays usable while bidding is open. Once a valid bid exists, you cannot cancel. A bid in the final two minutes extends the close by two minutes.</p></div></header><div><label><span>Pet</span><select value={auctionSeed} onChange={(event) => setAuctionSeed(event.target.value)}><option value="">Choose a pet…</option>{owned.map((pet) => <option value={pet.seed} key={pet.seed}>{pet.name} · {pet.finish}{pet.serialNumber ? ` #${pet.serialNumber}/${pet.printRun}` : ""}</option>)}</select></label><label><span>Starting bid</span><div><b>$</b><input inputMode="decimal" value={auctionStart} onChange={(event) => setAuctionStart(event.target.value)} placeholder="5.00" /></div></label><label><span>Hidden reserve <small>optional</small></span><div><b>$</b><input inputMode="decimal" value={auctionReserve} onChange={(event) => setAuctionReserve(event.target.value)} placeholder="No reserve" /></div></label><label><span>Duration</span><select value={auctionHours} onChange={(event) => setAuctionHours(event.target.value)}><option value="1">1 hour</option><option value="6">6 hours</option><option value="24">1 day</option><option value="72">3 days</option><option value="168">7 days</option></select></label><button disabled={!auctionSeed || Number(auctionStart)<1 || busy === "create-auction"} onClick={() => void createAuction()}>{busy === "create-auction" ? "Starting…" : "Start auction"}</button></div></section>}
      <div className="marketSectionTitle"><div><span>LIVE AUCTIONS</span><h2>Ending soonest</h2></div><span>{auctions.length} open</span></div>
      {auctions.length ? <section className="auctionGrid">{auctions.map((auction) => { const mine = wallet?.playerId === auction.sellerId; const leader = auction.leadingBid?.amountCents ?? auction.startCents; const minimum = auction.leadingBid ? leader + 100 : auction.startCents; return <article key={auction.id}><a className="auctionArt" href={`/pet/${encodeURIComponent(auction.petSeed)}`} dangerouslySetInnerHTML={{ __html: petArt(auction.petSeed) }} /><div className="auctionBody"><div className="auctionTitle"><div><h3>{auction.name}</h3><span>{auction.finish} · {auction.tier}{auction.serialNumber ? ` · #${auction.serialNumber}/${auction.printRun}` : ""}</span></div><div><strong>{money(leader)}</strong><small>{auction.leadingBid ? "current bid" : "starting bid"}</small></div></div><div className="auctionMeta"><span>Ends {new Date(auction.endsAt).toLocaleString()}</span><span>{auction.bidCount} bid{auction.bidCount === 1 ? "" : "s"}{auction.extensionCount ? ` · extended ${auction.extensionCount}×` : ""}</span><span>{auction.reserveCents ? "Reserve set" : "No reserve"}</span></div><footer>{mine ? <button className="tradeSecondary" disabled={auction.bidCount>0 || busy===auction.id} onClick={() => void cancelAuction(auction)}>{auction.bidCount ? "Bid received · locked" : "Cancel auction"}</button> : signedIn ? <div><span>$</span><input inputMode="decimal" value={bidDollars[auction.id] ?? ""} onChange={(event) => setBidDollars((current) => ({ ...current, [auction.id]: event.target.value }))} placeholder={(minimum/100).toFixed(2)} /><button disabled={Math.round(Number(bidDollars[auction.id])*100)<minimum || busy===auction.id || Math.round(Number(bidDollars[auction.id])*100)>(wallet?.availableCents ?? 0)} onClick={() => void placeBid(auction)}>{busy===auction.id ? "Reserving…" : "Place bid"}</button></div> : <a className="petAction" href="/">Sign in to bid</a>}<a href={auction.sellerLogin ? `/profile/${auction.sellerLogin}` : "#"}>Seller {auction.sellerLogin ? `@${auction.sellerLogin}` : auction.sellerHandle}</a></footer></div></article>; })}</section> : <section className="collectionEmpty"><h2>No live auctions</h2><p>Collectors can start with a public floor and let demand decide the final price.</p></section>}
    </> : workspace === "trades" ? <>
      {!signedIn ? <section className="tradeSignIn"><span>COLLECTOR-TO-COLLECTOR</span><h2>Sign in to make an offer</h2><p>Browse remains public. Your identity, collection, and wallet are required before a trade can be proposed or accepted.</p><a href="/">Sign in</a></section> : <>
        <section className="tradeComposer" id="trade-composer"><header><div><span>{parentTradeId ? "COUNTEROFFER" : "NEW OFFER"}</span><h2>{parentTradeId ? "Shape your counteroffer" : "Build a direct trade"}</h2></div><div className="tradeFeeCallout"><strong>{money(trades.policy.tradeFeeCents)} each</strong><span>only when a two-sided trade settles</span></div></header>
          <div className="tradeCollectorSearch"><label><span>Trade with a GitHub collector</span><div><span>@</span><input value={counterpartyLogin} onChange={(e) => { setCounterpartyLogin(e.target.value); setCounterparty(null); setCounterpartyPets([]); }} placeholder="collector" onKeyDown={(e) => { if (e.key === "Enter") void loadCollector(); }} /><button disabled={!counterpartyLogin.trim() || busy === "collector"} onClick={() => void loadCollector()}>{busy === "collector" ? "Loading…" : "Load collection"}</button></div></label>{counterparty && <div className="tradeCollectorFound"><span>Trading with</span><strong>{collectorName(counterparty)}</strong><small>{counterpartyPets.length} pets available to request</small></div>}</div>
          <div className="tradeBuild"><TradePetPicker title="You give" subtitle="Choose from your collection" pets={owned} selected={offered} toggle={(seed) => toggle(offered, seed, setOffered)} empty="Your tradeable pets will appear here." /><div className="tradeBuildArrow">⇄</div><TradePetPicker title="You receive" subtitle={counterparty ? `Choose from ${collectorName(counterparty)}’s collection` : "Load a collector first"} pets={counterpartyPets} selected={requested} toggle={(seed) => toggle(requested, seed, setRequested)} empty={counterparty ? "This collector has no tradeable pets." : "Search for a collector to see their collection."} /></div>
          <div className="tradeSend"><label><span>Note <small>optional</small></span><textarea maxLength={280} value={tradeNote} onChange={(e) => setTradeNote(e.target.value)} placeholder="What makes this a good trade?" /></label><div><p>{requested.length ? <><strong>Two-sided trade.</strong> Each collector pays {money(trades.policy.tradeFeeCents)} only if accepted.</> : <><strong>Gift offer.</strong> You pay {money(trades.policy.tradeFeeCents)} if accepted; the recipient pays nothing.</>}</p><button disabled={!counterparty || !offered.length || busy === "send-trade"} onClick={() => void sendTrade()}>{busy === "send-trade" ? "Sending…" : parentTradeId ? "Send counteroffer" : requested.length ? "Send trade offer" : "Send gift offer"}</button>{parentTradeId && <button className="tradeCancelCounter" onClick={() => { setParentTradeId(null); setOffered([]); setRequested([]); }}>Cancel counter</button>}</div></div>
        </section>
        <div className="marketSectionTitle"><div><span>TRADE DESK</span><h2>Offers and history</h2></div><span>{trades.items.filter((trade) => trade.status === "pending").length} open</span></div>
        {trades.items.length ? <section className="tradeList">{trades.items.map((trade) => <TradeCard key={trade.id} trade={trade} feeCents={trades.policy.tradeFeeCents} wallet={wallet} busy={busy} act={(row, action) => void actOnTrade(row, action)} counter={(row) => void beginCounter(row)} />)}</section> : <section className="collectionEmpty"><h2>No offers yet</h2><p>Load another collector’s collection above and build the first one.</p></section>}
      </>}
    </> : <PracticeMarket />}
    <section className="marketTrust"><div><strong>Atomic by design</strong><span>A pet cannot be sold twice or promised to two accepted trades.</span></div><div><strong>Origin is permanent</strong><span>Founder and original-earner marks survive every transfer.</span></div><div><strong>Public provenance, private payments</strong><span>Ownership may be anchored on-chain; financial and identity data never is.</span></div></section>
    <nav className="marketLegal" aria-label="Marketplace policies"><a href="/marketplace/rules">Marketplace rules</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="https://github.com/absolutejs/renown/issues">Support</a></nav>
  </main></body></html>;
};
