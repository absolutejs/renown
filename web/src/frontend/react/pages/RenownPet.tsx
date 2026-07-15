// Public /pet/:seed page — a complete collectible record for one pet copy.
import { Head } from "@absolutejs/absolute/react/components";
import type { ReactNode } from "react";
import { CARD_VARIANTS, COPY_COLORWAYS, COPY_MATERIALS, COPY_MUTATIONS, COPY_PATTERNS, generate, TIER_RGB, type CardVariant, type CopyTraits, type RarityComponent, type Tier, type WeightedCopyTrait } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";
import { SiteHeader } from "../components/SiteHeader";

type RGB = readonly [number, number, number];
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const pct = (p: number) => `${p >= .01 ? (p * 100).toFixed(p >= .1 ? 0 : 2) : (p * 100).toFixed(4)}%`;
const odds = (p: number) => p >= 1 ? "Every copy" : `1 in ${(1 / p).toLocaleString(undefined, { maximumFractionDigits: p > .01 ? 1 : 0 })}`;
const money = (amountCents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountCents / 100);
const variants = Object.entries(CARD_VARIANTS) as [CardVariant, (typeof CARD_VARIANTS)[CardVariant]][];

const heroSvgHtml = (seed: string, box: number) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box });
  return `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible"><g>${svg}<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/></g></svg>`;
};

type PetForUI = {
  seed: string; name: string; tier: string; sizeN: number; score: number;
  statRarity: number; rarestTrait: string; oneOfOne: boolean; mythicAura: boolean;
  traits: Record<string, string>; rarityBreakdown: RarityComponent[]; copyTraits?: CopyTraits;
  card?: { recipeVersion: "genesis-v1" | "genesis-v2"; serialNumber: number; printRun: number; pullOdds: number; variant: CardVariant; finish: string };
};

type PetOwner = { login: string | null; handle: string; tier: string; isAi: boolean; earnedVia: string | null;
  printingId: string | null; serialNumber: number | null; printRun: number | null; mintNumber: number | null;
  variant: string | null; finish: string | null; recipeVersion: string | null; mutation: string | null; colorway: string | null; material: string | null; copyPattern: string | null;
  population: number | null; setId: string | null; subjectName: string | null; earnedAt: string | null; sizeRank: number | null } | null;
type SaleStats = { count: number; averageCents: number | null; lowCents: number | null; highCents: number | null };
type PetMarket = { listing: { id: string; priceCents: number; sellerPlayerId: string } | null; valuation?: { printingSales: SaleStats; exactSales: SaleStats; printingFloorCents: number | null; exactFloorCents: number | null; recentSales: { seed: string; amountCents: number | null; occurredAt: string | Date; name: string; finish: string | null; material: string | null; colorway: string | null; pattern: string | null; serialNumber: number | null; printRun: number | null }[] }; events: { sequence: number; kind: string; reason: string; amountCents: number | null; occurredAt: string | Date; from: { login: string | null; handle: string } | null; to: { login: string | null; handle: string } | null }[] };

const Fact = ({ label, value }: { label: string; value: ReactNode }) => <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)" }}>
  <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div>
  <div style={{ marginTop: 3, fontWeight: 750 }}>{value}</div>
</div>;
const OddsTable = ({ title, rows, current }: { title: string; rows: readonly WeightedCopyTrait[]; current: string }) => <>
  <h3>{title}</h3>
  <div style={{ overflowX: "auto" }}><table className="atable"><thead><tr><th>Treatment</th><th>Probability</th><th>Odds</th></tr></thead><tbody>
    {rows.map((row) => <tr key={row.value} style={row.value === current ? { outline: "1px solid rgba(255,255,255,.35)", outlineOffset: -1 } : undefined}><td><strong>{row.value}{row.value === current ? " · this copy" : ""}</strong></td><td>{pct(row.probability)}</td><td>{odds(row.probability)}</td></tr>)}
  </tbody></table></div>
</>;

const PetBody = ({ pet, owner, market, origin }: { pet: PetForUI; owner: PetOwner; market: PetMarket; origin: string }) => {
  const accent = hex(TIER_RGB[pet.tier as Tier] ?? [160, 160, 180]);
  const pageUrl = `${origin}/pet/${encodeURIComponent(pet.seed)}`;
  const serial = owner?.serialNumber ?? pet.card?.serialNumber ?? null;
  const total = owner?.printRun ?? pet.card?.printRun ?? null;
  const variant = (owner?.variant ?? pet.card?.variant ?? null) as CardVariant | null;
  const config = variant && CARD_VARIANTS[variant] ? CARD_VARIANTS[variant] : null;
  const finish = owner?.finish ?? pet.card?.finish ?? config?.finish ?? pet.tier;
  const mutation = owner?.mutation ?? pet.copyTraits?.mutation ?? "Standard";
  const colorway = owner?.colorway ?? pet.copyTraits?.colorway ?? "Original";
  const material = owner?.material ?? pet.copyTraits?.material ?? "Standard";
  const copyPattern = owner?.copyPattern ?? pet.copyTraits?.copyPattern ?? "None";
  const masterpieceTitle = pet.copyTraits?.masterpieceTitle;
  const population = owner?.population ?? null;
  const finishBreakdown = pet.rarityBreakdown.some((row) => row.group === "Finish") || !config ? [] : [{ group: "Finish" as const, label: "finish", value: finish, probability: config.probability, score: +(-Math.log2(config.probability)).toFixed(2) }];
  const breakdown = [...pet.rarityBreakdown, ...finishBreakdown];
  const totalScore = breakdown.reduce((sum, row) => sum + row.score, 0);
  const distinctions = [
    owner?.sizeRank === 1 ? "Largest known copy" : owner?.sizeRank ? `Size rank #${owner.sizeRank}` : null,
    serial != null && serial <= 10 ? `Low serial #${serial}` : null,
    mutation !== "Standard" ? `${mutation} mutation` : null,
    material !== "Standard" ? `${material} material` : null,
    copyPattern !== "None" ? `${copyPattern} pattern` : null,
    owner?.setId === "legacy-genesis" ? "Founders Original" : null,
  ].filter(Boolean) as string[];

  return <main className="wrap profilePage">
    <SiteHeader back={{ href: "/pets", label: "Back to collection" }} />

    <section className="card" style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
      <div style={{ flexShrink: 0, width: 220, height: 220, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 20, background: "rgba(255,255,255,.04)", border: `2px solid ${accent}66` }}>
        <span dangerouslySetInnerHTML={{ __html: heroSvgHtml(pet.seed, 176) }} />
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div className="muted" style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em", fontSize: 12 }}>{finish}{masterpieceTitle ? ` · ${masterpieceTitle}` : ""} · {pet.tier}</div>
        <h1 style={{ margin: "5px 0 8px" }}>{pet.name}{serial != null && total != null && <span style={{ marginLeft: 10, fontSize: 14, color: accent, fontWeight: 800, verticalAlign: "middle" }}>#{serial.toLocaleString()} / {total.toLocaleString()}</span>}</h1>
        <p className="muted" style={{ margin: 0 }}>Size {pet.sizeN} · {colorway} colorway · {material} material · {copyPattern} surface · {mutation} mutation</p>
        {distinctions.length > 0 && <div className="petDistinctions" style={{ marginTop: 10 }}>{distinctions.map((item) => <span key={item}>{item}</span>)}</div>}
        {owner?.login
          ? <p style={{ margin: "13px 0 0" }}>Owned by <a href={`/profile/${encodeURIComponent(owner.login)}`} style={{ fontWeight: 700, color: accent, textDecoration: "none" }}>@{owner.login}</a>{owner.isAi && <span title="AI participant"> 🤖</span>}</p>
          : <p className="muted" style={{ margin: "13px 0 0", fontSize: 13 }}>Unclaimed — this exact copy has not been discovered.</p>}
        {(market.listing || owner?.login) && <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>{market.listing && <><strong style={{ fontSize: 22 }}>{money(market.listing.priceCents)}</strong><a className="btn" href={`/marketplace?buy=${encodeURIComponent(market.listing.id)}`}>Buy on market</a></>}{owner?.login && <a className="petAction" href={`/marketplace?trade=${encodeURIComponent(owner.login)}&want=${encodeURIComponent(pet.seed)}`}>Offer a trade</a>}{owner?.printingId && <a className="petAction" href={`/marketplace?buyOrder=${encodeURIComponent(pet.seed)}`}>Post a buy order</a>}</div>}
      </div>
    </section>

    <section className="card marketValueCard">
      <div className="marketValueHead"><div><span>PUBLIC MARKET DATA</span><h2>What collectors have paid</h2><p>Printing compares every copy of this subject. Exact variation narrows to this finish, material, colorway, and pattern. Serial and condition-like traits can still make individual copies trade above or below these references.</p></div><a className="petAction" href={`/marketplace?q=${encodeURIComponent(owner?.subjectName ?? pet.name)}`}>Search the market</a></div>
      {market.valuation && (market.valuation.printingSales.count || market.valuation.printingFloorCents) ? <><div className="marketValueStats"><Fact label="Printing floor" value={market.valuation.printingFloorCents ? money(market.valuation.printingFloorCents) : "No active listings"} /><Fact label="Exact variation floor" value={market.valuation.exactFloorCents ? money(market.valuation.exactFloorCents) : "No exact listing"} /><Fact label="Printing average" value={market.valuation.printingSales.averageCents ? money(market.valuation.printingSales.averageCents) : "No sales yet"} /><Fact label="Exact average" value={market.valuation.exactSales.averageCents ? money(market.valuation.exactSales.averageCents) : "No exact sales"} /><Fact label="Recorded sales" value={`${market.valuation.printingSales.count} printing · ${market.valuation.exactSales.count} exact`} /></div>{market.valuation.recentSales.length > 0 && <div className="marketSales"><h3>Recent comparable sales</h3>{market.valuation.recentSales.map((sale) => <a href={`/pet/${encodeURIComponent(sale.seed)}`} key={`${sale.seed}:${new Date(sale.occurredAt).toISOString()}`}><div><strong>{sale.name}</strong><span>{sale.finish} · {sale.material} · {sale.colorway}{sale.serialNumber ? ` · #${sale.serialNumber}/${sale.printRun}` : ""}</span></div><strong>{sale.amountCents ? money(sale.amountCents) : "—"}</strong><time>{new Date(sale.occurredAt).toLocaleDateString()}</time></a>)}</div>}</> : <div className="marketNoSales"><strong>No public sale has established a price yet.</strong><span>The first completed sale becomes the first comparable—not an official appraisal.</span></div>}
      <p className="marketValueDisclaimer">Market references describe prior activity, not guaranteed value. Renown does not promise appreciation, liquidity, or resale profit.</p>
    </section>

    <section className="card">
      <h2 style={{ marginTop: 0 }}>Ownership history</h2>
      <p className="muted">The original earner is permanent. Transfers append to this record; they never rewrite it.</p>
      <div className="ownershipTimeline">{market.events.length ? market.events.map((event) => <div key={event.sequence}>
        <span>#{event.sequence}</span><div><strong>{event.kind === "mint" ? "Earned" : event.reason[0]?.toUpperCase() + event.reason.slice(1)}</strong><p>{event.kind === "mint" ? `${event.to?.login ? `@${event.to.login}` : event.to?.handle ?? "Original owner"} discovered this copy` : `${event.from?.login ? `@${event.from.login}` : event.from?.handle ?? "Collector"} → ${event.to?.login ? `@${event.to.login}` : event.to?.handle ?? "Collector"}`}{event.amountCents ? ` · ${money(event.amountCents)}` : ""}</p></div><time>{new Date(event.occurredAt).toLocaleDateString()}</time>
      </div>) : <p className="muted">Provenance will appear after the marketplace ledger migration.</p>}</div>
    </section>

    <section className="card">
      <h2 style={{ marginTop: 0 }}>Printing & provenance</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 8 }}>
        <Fact label="Finish" value={finish} />
        <Fact label="Serial" value={serial != null && total != null ? `#${serial.toLocaleString()} / ${total.toLocaleString()}` : "Legacy original"} />
        <Fact label="Discovered" value={population != null && total != null ? `${population.toLocaleString()} of ${total.toLocaleString()}` : "Not yet measured"} />
        <Fact label="Published odds" value={config ? `${pct(config.probability)} · ${odds(config.probability)}` : "Legacy issue"} />
        <Fact label="Discovery order" value={owner?.mintNumber ? `Mint #${owner.mintNumber.toLocaleString()}` : "Original issue"} />
        <Fact label="Set" value={owner?.setId ?? (pet.card ? "Genesis 2026" : "Legacy")} />
        <Fact label="Generation recipe" value={owner?.recipeVersion ?? pet.card?.recipeVersion ?? "Founders original"} />
        {masterpieceTitle && <Fact label="Unique Masterpiece title" value={masterpieceTitle} />}
      </div>
      <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>Serials are deterministically shuffled inside the fixed print run. Mint number records when a copy was discovered; serial number does not, so the first pull is not automatically #1.</p>
      {owner?.earnedAt && <p className="muted" style={{ fontSize: 13 }}>Earned {new Date(owner.earnedAt).toLocaleString()}{owner.earnedVia ? ` via @${owner.earnedVia}` : ""}. Ownership and earning provenance are permanent.</p>}
    </section>

    <section className="card">
      <h2 style={{ marginTop: 0 }}>Why this copy is rare</h2>
      <p className="muted">Rarity score is transparent information content: each independently rolled component contributes −log₂(probability). Scores add; probabilities multiply.</p>
      <p><strong>Exact generated combination:</strong> {odds(breakdown.reduce((product, row) => product * row.probability, 1))}</p>
      <div style={{ overflowX: "auto" }}><table className="atable">
        <thead><tr><th>Layer</th><th>Trait</th><th>Value</th><th>Probability</th><th>Odds</th><th>Score</th></tr></thead>
        <tbody>{breakdown.map((row, index) => <tr key={`${row.group}:${row.label}:${index}`}><td>{row.group}</td><td>{row.label}</td><td><strong>{row.value}</strong></td><td>{pct(row.probability)}</td><td>{odds(row.probability)}</td><td>+{row.score.toFixed(2)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={5}><strong>Total rarity score</strong></td><td><strong>{totalScore.toFixed(2)}</strong></td></tr></tfoot>
      </table></div>
      <h3>Copy mutation odds</h3>
      <p className="muted">Mutation is a separate roll after the finish. This is the shiny-style chase: it changes this copy’s appearance without changing its fixed print run.</p>
      <div style={{ overflowX: "auto" }}><table className="atable"><thead><tr><th>Mutation</th><th>Probability</th><th>Odds</th></tr></thead><tbody>
        {[...COPY_MUTATIONS].reverse().map((row) => <tr key={row.value} style={row.value === mutation ? { outline: `1px solid ${accent}88`, outlineOffset: -1 } : undefined}><td><strong>{row.value}{row.value === mutation ? " · this copy" : ""}</strong></td><td>{pct(row.probability)}</td><td>{odds(row.probability)}</td></tr>)}
      </tbody></table></div>
      {pet.card?.recipeVersion === "genesis-v2" && <>
        <OddsTable title="Material odds" rows={COPY_MATERIALS} current={material} />
        <OddsTable title="Surface-pattern odds" rows={COPY_PATTERNS} current={copyPattern} />
        <OddsTable title="Colorway odds" rows={COPY_COLORWAYS} current={colorway} />
      </>}
    </section>

    <section className="card">
      <h2 style={{ marginTop: 0 }}>The chase</h2>
      <p className="muted">Every subject has the same published finish ladder. A printing exists mathematically even before anyone owns a copy; “discovered” only means it has been pulled.</p>
      <div style={{ overflowX: "auto" }}><table className="atable">
        <thead><tr><th>Finish</th><th>Tier</th><th>Pull probability</th><th>Odds</th><th>Fixed print run</th></tr></thead>
        <tbody>{variants.map(([key, row]) => <tr key={key} style={key === variant ? { outline: `1px solid ${accent}88`, outlineOffset: -1 } : undefined}><td><strong>{row.finish}{key === variant ? " · this copy" : ""}</strong></td><td>{row.tier}</td><td>{pct(row.probability)}</td><td>{odds(row.probability)}</td><td>/{row.printRun.toLocaleString()}</td></tr>)}</tbody>
      </table></div>
    </section>

    <section className="card">
      <h2 style={{ marginTop: 0 }}>Subject DNA & copy variation</h2>
      <p className="muted">Copies in one line share recognizable subject DNA—species, face, body pattern, name, and silhouette family. Finish sets the edition and fixed supply. Each physical copy independently rolls scale, colorway, material, surface pattern, and mutation, creating disclosed combination chases without changing its subject identity.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {Object.entries(pet.traits).map(([k, v]) => <Fact key={k} label={k} value={v} />)}
      </div>
    </section>

    <section className="card" style={{ textAlign: "center" }}>
      <p className="muted" style={{ marginTop: 0 }}>Pets hatch from real work. Install Renown, connect GitHub, and your commits can discover the next chase copy.</p>
      <p style={{ marginBottom: 6 }}><code>bun add -g @absolutejs/renown</code></p>
      <p className="muted" style={{ fontSize: 13 }}>Then <code>gh auth login</code> and <code>renown link</code>.</p>
      <p style={{ marginTop: 14, fontSize: 13 }}><a href={pageUrl}>{pageUrl}</a></p>
    </section>
  </main>;
};

type RenownPetProps = { cssPath?: string; pet?: PetForUI | null; owner?: PetOwner; market?: PetMarket; origin?: string; shareSnippet?: string };

export const RenownPet = ({ cssPath, pet = null, owner = null, market = { listing: null, events: [] }, origin = "", shareSnippet }: RenownPetProps) => {
  const serial = owner?.serialNumber ?? pet?.card?.serialNumber ?? null;
  const total = owner?.printRun ?? pet?.card?.printRun ?? null;
  const edition = serial != null && total != null ? ` #${serial.toLocaleString()} / ${total.toLocaleString()}` : "";
  const finish = owner?.finish ?? pet?.card?.finish ?? pet?.tier;
  const title = pet ? `${pet.name}${edition} — ${finish} pet on Renown` : "A Renown pet";
  const desc = shareSnippet ?? (pet ? `${finish}${edition} · size ${pet.sizeN} · rarity score ${pet.score.toFixed(2)} — a collectible pet earned from real work.` : "A serialized pet on Renown.");
  const fullUrl = pet ? `${origin}/pet/${encodeURIComponent(pet.seed)}` : `${origin}/`;
  const image = pet ? `${origin}/pet/${encodeURIComponent(pet.seed)}/og.png` : undefined;
  return <html lang="en">
    <Head cssPath={cssPath} title={title} description={desc} canonical={fullUrl}
      openGraph={{ title, description: desc, type: "website", url: fullUrl, image, imageAlt: title, imageWidth: 1200, imageHeight: 630, siteName: "Renown" }}
      twitter={{ card: "summary_large_image", title, description: desc, image, imageAlt: title }} />
    <body>{pet ? <PetBody pet={pet} owner={owner} market={market} origin={origin} /> : <main className="wrap profilePage"><SiteHeader back={{ href: "/pets", label: "Back to collection" }} /><section className="card"><h1>No such pet</h1><p className="muted">That seed does not resolve to a pet.</p></section></main>}</body>
  </html>;
};
