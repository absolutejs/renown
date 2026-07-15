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
type OwnedPet = { seed: string; name: string; tier: string; finish?: string | null; serialNumber?: number | null; printRun?: number | null };
const money = (amountCents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountCents / 100);

const petArt = (seed: string) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box: 112 });
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><g>${svg}</g></svg>`;
};

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

export const RenownMarketplace = ({ cssPath, market: initialMarket, origin = "" }: { cssPath?: string; market: MarketData; origin?: string }) => {
  const [market, setMarket] = useState(initialMarket);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [fundingEnabled, setFundingEnabled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [owned, setOwned] = useState<OwnedPet[]>([]);
  const [query, setQuery] = useState("");
  const [focusListing, setFocusListing] = useState("");
  const [sellSeed, setSellSeed] = useState("");
  const [sellDollars, setSellDollars] = useState("");
  const [depositDollars, setDepositDollars] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sellCents = Math.round(Number(sellDollars) * 100);
  const fee = useMemo(() => { const feeCents = Math.ceil((sellCents * market.policy.sellerFeeBps) / 10_000); return Number.isSafeInteger(sellCents) && sellCents > 0 ? { feeCents, sellerNetCents: sellCents - feeCents } : null; }, [sellCents, market.policy.sellerFeeBps]);

  const refreshWallet = async () => {
    const response = await fetch("/api/account/wallet");
    if (response.ok) { setSignedIn(true); setWallet(await response.json() as WalletData); }
  };
  const refreshMarket = async () => {
    const params = new URLSearchParams({ limit: "24" }); if (query.trim()) params.set("q", query.trim()); if (focusListing) params.set("listing", focusListing);
    const response = await fetch(`/api/marketplace?${params}`); if (response.ok) setMarket(await response.json() as MarketData);
  };
  useEffect(() => {
    const requestedSell = new URLSearchParams(window.location.search).get("sell");
    const requestedBuy = new URLSearchParams(window.location.search).get("buy");
    if (requestedSell) setSellSeed(requestedSell);
    if (requestedBuy) setFocusListing(requestedBuy);
    void refreshWallet();
    fetch("/stripe/config").then(async (response) => { if (response.ok) setFundingEnabled(Boolean(((await response.json()) as { walletFundingEnabled?: boolean }).walletFundingEnabled)); }).catch(() => {});
    fetch("/api/account/pets?limit=60&sort=rarest").then(async (r) => { if (r.ok) { const p = await r.json() as { pets: OwnedPet[] }; setOwned(p.pets ?? []); } }).catch(() => {});
  }, []);
  useEffect(() => { const timer = setTimeout(() => void refreshMarket(), 180); return () => clearTimeout(timer); }, [query, focusListing]);

  const deposit = async () => {
    const amountCents = Math.round(Number(depositDollars) * 100); setBusy("deposit");
    const response = await fetch("/wallet/deposit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountCents }) });
    const body = await response.json().catch(() => null) as { url?: string } | null;
    if (response.ok && body?.url) window.location.href = body.url;
    else { setNotice(typeof body === "string" ? body : "Wallet funding is not available yet."); setBusy(null); }
  };
  const list = async () => {
    setBusy("list"); const response = await fetch("/api/account/marketplace/listings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ petSeed: sellSeed, priceCents: sellCents }) });
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (response.ok) { setNotice("Your pet is live on the market. You can keep using it until it sells."); setSellSeed(""); setSellDollars(""); await refreshMarket(); }
    else setNotice(body.message ?? "Could not create the listing."); setBusy(null);
  };
  const buy = async (item: Listing) => {
    if ((wallet?.availableCents ?? 0) < item.priceCents) { setNotice("Add enough wallet funds before buying."); return; }
    if (!window.confirm(`Buy ${item.name} for ${money(item.priceCents)}? Ownership transfers immediately.`)) return;
    setBusy(item.id); const key = `web:${crypto.randomUUID()}`;
    const response = await fetch(`/api/account/marketplace/listings/${encodeURIComponent(item.id)}/buy`, { method: "POST", headers: { "idempotency-key": key } });
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (response.ok) { setNotice(`${item.name} is now yours. Its complete ownership history stays attached.`); await Promise.all([refreshWallet(), refreshMarket()]); }
    else setNotice(body.message ?? "The sale could not settle."); setBusy(null);
  };

  const title = "Pet marketplace — Renown";
  const description = "Buy, sell, and track Renown pet cards with guaranteed settlement and permanent provenance.";
  return <html lang="en"><Head cssPath={cssPath} title={title} description={description} canonical={`${origin}/marketplace`} /><body><main className="wrap marketPage">
    <SiteHeader current="marketplace" />
    <section className="marketHero"><div><span className="collectionEyebrow">GUARANTEED SETTLEMENT</span><h1>The pet market</h1><p>List while you flex. When a sale settles, dollars and ownership move together—once—and the pet keeps its complete history.</p></div>
      <div className="walletCard"><span>Available wallet</span><strong>{wallet ? money(wallet.availableCents) : signedIn ? "Loading…" : "$0.00"}</strong><small>{wallet?.reservedCents ? `${money(wallet.reservedCents)} reserved` : "Closed-loop USD · no cash withdrawals"}</small></div>
    </section>
    {notice && <div className="collectionNotice"><span>{notice}</span><button onClick={() => setNotice(null)}>Dismiss</button></div>}
    <section className="marketControls">
      <label className="marketSearch"><span>Search the market</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pet, subject, or seller…" /></label>
      <div className="marketPolicy"><strong>10% seller fee</strong><span>Buyers pay the displayed price. No surprise checkout fee.</span></div>
    </section>
    {signedIn && <section className="marketDesk">
      <div><h2>Add wallet funds</h2><p>{fundingEnabled ? "Minimum $5 · maximum wallet balance $2,000." : "Funding opens after payment-provider marketplace approval."}</p><div className="marketInline"><span>$</span><input inputMode="decimal" disabled={!fundingEnabled} value={depositDollars} onChange={(e) => setDepositDollars(e.target.value)} /><button disabled={!fundingEnabled || busy === "deposit"} onClick={() => void deposit()}>{fundingEnabled ? "Continue to Stripe" : "Funding not open"}</button></div></div>
      <div><h2>Sell a pet</h2><p>It stays usable until ownership transfers.</p><select value={sellSeed} onChange={(e) => setSellSeed(e.target.value)}><option value="">Choose from your collection…</option>{owned.map((pet) => <option value={pet.seed} key={pet.seed}>{pet.name} · {pet.finish ?? pet.tier}{pet.serialNumber ? ` #${pet.serialNumber}/${pet.printRun}` : ""}</option>)}</select><div className="marketInline"><span>$</span><input inputMode="decimal" value={sellDollars} onChange={(e) => setSellDollars(e.target.value)} placeholder="25.00" /><button disabled={!sellSeed || !fee || busy === "list"} onClick={() => void list()}>List for sale</button></div>{fee && <small>You receive {money(fee.sellerNetCents)} after the {money(fee.feeCents)} fee.</small>}</div>
    </section>}
    <div className="marketSectionTitle"><div><span>LIVE LISTINGS</span><h2>{focusListing ? "Selected listing" : "Available now"}</h2></div>{focusListing ? <button className="petAction" onClick={() => { setFocusListing(""); history.replaceState(null, "", "/marketplace"); }}>View all listings</button> : <span>{market.items.length} shown</span>}</div>
    {market.items.length ? <section className="marketGrid">{market.items.map((item) => <ListingCard key={item.id} item={item} wallet={wallet} signedIn={signedIn} busy={busy} buy={(row) => void buy(row)} />)}</section>
      : <section className="collectionEmpty"><h2>The market floor is empty</h2><p>Be the first collector to name a price.</p></section>}
    <section className="marketTrust"><div><strong>Atomic by design</strong><span>A pet cannot be sold twice or promised to two buyers.</span></div><div><strong>Origin is permanent</strong><span>Founder and original-earner marks survive every transfer.</span></div><div><strong>Public provenance, private payments</strong><span>Ownership may be anchored on-chain; financial and identity data never is.</span></div></section>
  </main></body></html>;
};
