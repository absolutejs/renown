import { Head } from "@absolutejs/absolute/react/components";
import { useEffect, useMemo, useState } from "react";
import { generate } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";
import { SiteHeader } from "../components/SiteHeader";

type Listing = {
  id: string; seed: string; priceCents: number; sellerReceivesCents: number; seller: string | null; sellerHandle: string;
  name: string; tier: string; finish: string | null; mutation: string | null; material: string | null; colorway: string | null;
  copyPattern: string | null; serialNumber: number | null; printRun: number | null; subjectName: string | null; createdAt: string | Date;
};
type WalletPolicy = { minimumFundingCents: number; maximumBalanceCents: number; maximumTransactionCents: number; sellerFeeBps: number; tradeFeeCents: number; currency: string };
type MarketData = { items: Listing[]; nextCursor: string | null; policy: WalletPolicy };
type WalletData = { balanceCents: number; reservedCents: number; availableCents: number; history: { id: string; kind: string; amountCents: number; createdAt: string }[] };
type TradePet = { seed: string; name: string; tier: string; finish?: string | null; mutation?: string | null; material?: string | null; colorway?: string | null; serialNumber?: number | null; printRun?: number | null };
type Collector = { id: string; login: string | null; handle: string };
type Trade = {
  id: string; status: string; direction: "incoming" | "outgoing"; note: string | null; createdAt: string; expiresAt: string | null; parentTradeId: string | null;
  proposer: Collector | null; counterparty: Collector | null; offeredPets: TradePet[]; requestedPets: TradePet[];
};
type TradesData = { items: Trade[]; policy: { tradeFeeCents: number } };
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
  const [workspace, setWorkspace] = useState<"listings" | "trades">("listings");
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [fundingEnabled, setFundingEnabled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [owned, setOwned] = useState<TradePet[]>([]);
  const [trades, setTrades] = useState<TradesData>({ items: [], policy: { tradeFeeCents: initialMarket.policy.tradeFeeCents } });
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
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedSell = params.get("sell"); const requestedBuy = params.get("buy"); const tradeWith = params.get("trade"); const wanted = params.get("want"); const give = params.get("give");
    if (requestedSell) setSellSeed(requestedSell); if (requestedBuy) setFocusListing(requestedBuy);
    if (tradeWith || wanted || give) { setWorkspace("trades"); if (tradeWith) setCounterpartyLogin(tradeWith); if (give) setOffered([give]); }
    void (async () => { if (await refreshWallet()) { await refreshTrades(); if (tradeWith) await loadCollector(tradeWith, wanted ?? undefined); } })();
    fetch("/stripe/config").then(async (response) => { if (response.ok) setFundingEnabled(Boolean(((await response.json()) as { walletFundingEnabled?: boolean }).walletFundingEnabled)); }).catch(() => {});
    fetch("/api/account/pets?limit=100&sort=rarest").then(async (r) => { if (r.ok) { const p = await r.json() as { pets: TradePet[] }; setOwned(p.pets ?? []); } }).catch(() => {});
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

  const title = "Pet marketplace — Renown";
  const description = "Buy, sell, trade, and track Renown pet cards with guaranteed settlement and permanent provenance.";
  return <html lang="en"><Head cssPath={cssPath} title={title} description={description} canonical={`${origin}/marketplace`} /><body><main className="wrap marketPage">
    <SiteHeader current="marketplace" />
    <section className="marketHero"><div><span className="collectionEyebrow">GUARANTEED SETTLEMENT</span><h1>The pet market</h1><p>Buy at a known price or negotiate pet-for-pet. Ownership and wallet fees move together—once—and every pet keeps its complete history.</p></div>
      <div className="walletCard"><span>Available wallet</span><strong>{wallet ? money(wallet.availableCents) : signedIn ? "Loading…" : "$0.00"}</strong><small>{wallet?.reservedCents ? `${money(wallet.reservedCents)} reserved` : "Closed-loop USD · no cash withdrawals"}</small></div>
    </section>
    <nav className="marketTabs" aria-label="Marketplace sections"><button className={workspace === "listings" ? "active" : ""} onClick={() => setWorkspace("listings")}><strong>Buy & sell</strong><span>Fixed-price listings</span></button><button className={workspace === "trades" ? "active" : ""} onClick={() => setWorkspace("trades")}><strong>Direct trades</strong><span>Offers, gifts & counteroffers</span></button></nav>
    {notice && <div className="collectionNotice"><span>{notice}</span><button onClick={() => setNotice(null)}>Dismiss</button></div>}
    {workspace === "listings" ? <>
      <section className="marketControls"><label className="marketSearch"><span>Search the market</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pet, subject, or seller…" /></label><div className="marketPolicy"><strong>10% seller fee</strong><span>Buyers pay the displayed price. No surprise checkout fee.</span></div></section>
      {signedIn && <section className="marketDesk"><div><h2>Add wallet funds</h2><p>{fundingEnabled ? "Minimum $5 · maximum wallet balance $2,000." : "Funding opens after payment-provider marketplace approval."}</p><div className="marketInline"><span>$</span><input inputMode="decimal" disabled={!fundingEnabled} value={depositDollars} onChange={(e) => setDepositDollars(e.target.value)} /><button disabled={!fundingEnabled || busy === "deposit"} onClick={() => void deposit()}>{fundingEnabled ? "Continue to Stripe" : "Funding not open"}</button></div></div><div><h2>Sell a pet</h2><p>It stays usable until ownership transfers.</p><select value={sellSeed} onChange={(e) => setSellSeed(e.target.value)}><option value="">Choose from your collection…</option>{owned.map((pet) => <option value={pet.seed} key={pet.seed}>{pet.name} · {pet.finish ?? pet.tier}{pet.serialNumber ? ` #${pet.serialNumber}/${pet.printRun}` : ""}</option>)}</select><div className="marketInline"><span>$</span><input inputMode="decimal" value={sellDollars} onChange={(e) => setSellDollars(e.target.value)} placeholder="25.00" /><button disabled={!sellSeed || !fee || busy === "list"} onClick={() => void list()}>List for sale</button></div>{fee && <small>You receive {money(fee.sellerNetCents)} after the {money(fee.feeCents)} fee.</small>}</div></section>}
      <div className="marketSectionTitle"><div><span>LIVE LISTINGS</span><h2>{focusListing ? "Selected listing" : "Available now"}</h2></div>{focusListing ? <button className="petAction" onClick={() => { setFocusListing(""); history.replaceState(null, "", "/marketplace"); }}>View all listings</button> : <span>{market.items.length} shown</span>}</div>
      {market.items.length ? <section className="marketGrid">{market.items.map((item) => <ListingCard key={item.id} item={item} wallet={wallet} signedIn={signedIn} busy={busy} buy={(row) => void buy(row)} />)}</section> : <section className="collectionEmpty"><h2>The market floor is empty</h2><p>Be the first collector to name a price.</p></section>}
    </> : <>
      {!signedIn ? <section className="tradeSignIn"><span>COLLECTOR-TO-COLLECTOR</span><h2>Sign in to make an offer</h2><p>Browse remains public. Your identity, collection, and wallet are required before a trade can be proposed or accepted.</p><a href="/">Sign in</a></section> : <>
        <section className="tradeComposer" id="trade-composer"><header><div><span>{parentTradeId ? "COUNTEROFFER" : "NEW OFFER"}</span><h2>{parentTradeId ? "Shape your counteroffer" : "Build a direct trade"}</h2></div><div className="tradeFeeCallout"><strong>{money(trades.policy.tradeFeeCents)} each</strong><span>only when a two-sided trade settles</span></div></header>
          <div className="tradeCollectorSearch"><label><span>Trade with a GitHub collector</span><div><span>@</span><input value={counterpartyLogin} onChange={(e) => { setCounterpartyLogin(e.target.value); setCounterparty(null); setCounterpartyPets([]); }} placeholder="collector" onKeyDown={(e) => { if (e.key === "Enter") void loadCollector(); }} /><button disabled={!counterpartyLogin.trim() || busy === "collector"} onClick={() => void loadCollector()}>{busy === "collector" ? "Loading…" : "Load collection"}</button></div></label>{counterparty && <div className="tradeCollectorFound"><span>Trading with</span><strong>{collectorName(counterparty)}</strong><small>{counterpartyPets.length} pets available to request</small></div>}</div>
          <div className="tradeBuild"><TradePetPicker title="You give" subtitle="Choose from your collection" pets={owned} selected={offered} toggle={(seed) => toggle(offered, seed, setOffered)} empty="Your tradeable pets will appear here." /><div className="tradeBuildArrow">⇄</div><TradePetPicker title="You receive" subtitle={counterparty ? `Choose from ${collectorName(counterparty)}’s collection` : "Load a collector first"} pets={counterpartyPets} selected={requested} toggle={(seed) => toggle(requested, seed, setRequested)} empty={counterparty ? "This collector has no tradeable pets." : "Search for a collector to see their collection."} /></div>
          <div className="tradeSend"><label><span>Note <small>optional</small></span><textarea maxLength={280} value={tradeNote} onChange={(e) => setTradeNote(e.target.value)} placeholder="What makes this a good trade?" /></label><div><p>{requested.length ? <><strong>Two-sided trade.</strong> Each collector pays {money(trades.policy.tradeFeeCents)} only if accepted.</> : <><strong>Gift offer.</strong> You pay {money(trades.policy.tradeFeeCents)} if accepted; the recipient pays nothing.</>}</p><button disabled={!counterparty || !offered.length || busy === "send-trade"} onClick={() => void sendTrade()}>{busy === "send-trade" ? "Sending…" : parentTradeId ? "Send counteroffer" : requested.length ? "Send trade offer" : "Send gift offer"}</button>{parentTradeId && <button className="tradeCancelCounter" onClick={() => { setParentTradeId(null); setOffered([]); setRequested([]); }}>Cancel counter</button>}</div></div>
        </section>
        <div className="marketSectionTitle"><div><span>TRADE DESK</span><h2>Offers and history</h2></div><span>{trades.items.filter((trade) => trade.status === "pending").length} open</span></div>
        {trades.items.length ? <section className="tradeList">{trades.items.map((trade) => <TradeCard key={trade.id} trade={trade} feeCents={trades.policy.tradeFeeCents} wallet={wallet} busy={busy} act={(row, action) => void actOnTrade(row, action)} counter={(row) => void beginCounter(row)} />)}</section> : <section className="collectionEmpty"><h2>No offers yet</h2><p>Load another collector’s collection above and build the first one.</p></section>}
      </>}
    </>}
    <section className="marketTrust"><div><strong>Atomic by design</strong><span>A pet cannot be sold twice or promised to two accepted trades.</span></div><div><strong>Origin is permanent</strong><span>Founder and original-earner marks survive every transfer.</span></div><div><strong>Public provenance, private payments</strong><span>Ownership may be anchored on-chain; financial and identity data never is.</span></div></section>
  </main></body></html>;
};
