import { Head } from "@absolutejs/absolute/react/components";
import { SiteHeader } from "../components/SiteHeader";

type PolicyKind = "terms" | "privacy" | "marketplace";
type Props = { cssPath?: string; origin?: string; kind: PolicyKind };
const effective = "July 15, 2026";

const Terms = () => <>
  <h2>Using Renown</h2><p>You must be at least 18 years old and able to enter a binding agreement. The initial paid marketplace is intended for people in the United States. You are responsible for your account, linked developer identities, and activity performed through them.</p>
  <p>Renown rewards authentic developer work. You may not automate claims, falsify work, manipulate issuance, evade limits, harass collectors, or interfere with the service. We may investigate, limit, freeze, or terminate access to protect collectors and the integrity of the game.</p>
  <h2>Pets and ownership</h2><p>A Renown pet is a digital game collectible, not an investment, security, deposit account, or promise of profit. Rarity, scarcity, comparable sales, and marketplace history do not guarantee value. Features, visuals, generation formulas, and metadata may evolve while serial, original-earner, Founder, and ownership history are preserved as described by the applicable collection.</p>
  <h2>Paid plans and wallet</h2><p>Subscriptions renew until cancelled through the account billing portal. The Renown wallet is closed-loop: dollars added to it may be used only inside Renown and cannot be withdrawn, redeemed for cash, converted to cryptocurrency, or transferred outside supported marketplace transactions. Wallet limits and fees are shown before an action is confirmed.</p>
  <h2>Marketplace</h2><p>When an atomic sale, accepted trade, filled buy order, or completed auction settles, ownership and related wallet entries move together. Completed collector-to-collector transactions are final except where required by law or where Renown determines that a charge or transaction was unauthorized, duplicated, technically erroneous, or fraudulent.</p>
  <h2>Changes and availability</h2><p>We may modify or discontinue features, collections, fees, limits, or these terms. Material changes will be posted with a new effective date. The service is provided without a guarantee of uninterrupted availability. Nothing here excludes rights that cannot legally be excluded.</p>
</>;

const Privacy = () => <>
  <h2>Information we collect</h2><p>Renown processes account details, linked provider identities, public developer activity, gameplay and marketplace actions, device and security signals, and support communications. Stripe processes card, billing, identity-verification, and payout information; Renown does not receive or store complete card numbers.</p>
  <h2>How information is used</h2><p>We use information to operate accounts, verify authentic work, generate and assign collectibles, settle marketplace activity, prevent abuse, provide support, comply with law, and improve Renown. We do not sell personal information.</p>
  <h2>Public and on-chain data</h2><p>Profiles, achievements, pets, serials, original-earner marks, collection displays, listings, sale history, and ownership provenance may be public. A future blockchain anchor may include a token identifier, ownership address or application identifier, and transfer reference. Email, card data, legal identity, wallet balance, payment-provider identifiers, and private account metadata are not intentionally placed on-chain.</p>
  <h2>Sharing and retention</h2><p>Information may be shared with infrastructure, authentication, analytics, payment, fraud-prevention, and legal-service providers only as needed to operate Renown or comply with law. Records are retained for operational, security, tax, dispute, and legal needs. Public blockchain records cannot be deleted by Renown.</p>
  <h2>Your choices</h2><p>You can manage linked accounts, notifications, public display choices, theme, sound, and billing from your account. Requests concerning access, correction, or deletion can be made through the support channel below; some financial, security, public provenance, or legal records must be retained.</p>
</>;

const Marketplace = () => <>
  <h2>Launch limits and fees</h2><ul><li>$5 minimum wallet funding</li><li>$2,000 maximum wallet balance</li><li>$1,800 maximum single marketplace transaction</li><li>10% seller-paid fee on sales</li><li>$0.25 per participant for a settled two-sided trade; the sender pays $0.25 for a gift</li></ul>
  <h2>Listings, orders, and auctions</h2><p>A listed pet remains usable until ownership transfers. Buy-order and leading-bid funds are reserved immediately and cannot be spent elsewhere. Cancelled, expired, or outbid reservations return to available balance. Auctions cannot be cancelled after a live bid and bids in the last two minutes extend the close to prevent sniping.</p>
  <h2>Settlement and disputes</h2><p>Renown locks the asset, transaction, and affected wallets during settlement so an item cannot be sold twice. A refund, chargeback, suspected compromise, or ledger discrepancy may debit or freeze a wallet while reviewed. A successful dispute reversal restores the ledger but does not automatically bypass administrative review.</p>
  <h2>Refund policy</h2><p>Marketplace purchases and accepted trades are normally final. Contact support promptly for an unauthorized, duplicate, or technically incorrect charge. Unused wallet funding may be refundable where required by law or when Renown approves a correction; promotional or earned balances are not cash redeemable. Refunding an external payment reverses the corresponding wallet credit and may create a frozen negative balance if those funds were already spent.</p>
  <h2>Provenance and risk</h2><p>Founder and original-earner marks survive transfers. Database provenance is not described as on-chain until an anchor succeeds. Collectibles may have no resale demand or value; do not spend money you cannot afford to keep inside Renown.</p>
</>;

export const RenownPolicies = ({ cssPath, origin = "", kind }: Props) => {
  const config = kind === "terms" ? { title: "Terms of Service", body: <Terms /> } : kind === "privacy" ? { title: "Privacy Notice", body: <Privacy /> } : { title: "Marketplace Rules", body: <Marketplace /> };
  const path = kind === "terms" ? "/terms" : kind === "privacy" ? "/privacy" : "/marketplace/rules";
  return <html lang="en"><Head cssPath={cssPath} title={`${config.title} — Renown`} description={`${config.title} for Renown accounts, pets, and marketplace.`} canonical={`${origin}${path}`} /><body><main className="wrap policyPage"><SiteHeader />
    <header className="policyHero"><span>RENOWN POLICY CENTER</span><h1>{config.title}</h1><p>Effective {effective} · Pre-live marketplace policy</p></header>
    <nav className="policyNav" aria-label="Policy pages"><a className={kind === "terms" ? "active" : ""} href="/terms">Terms</a><a className={kind === "privacy" ? "active" : ""} href="/privacy">Privacy</a><a className={kind === "marketplace" ? "active" : ""} href="/marketplace/rules">Marketplace rules</a></nav>
    <article className="policyBody">{config.body}</article>
    <footer className="policyFooter"><div><strong>Questions or account help</strong><p>Until a dedicated support address is published, use the project’s public support tracker.</p></div><a href="https://github.com/absolutejs/renown/issues">Renown support tracker</a></footer>
  </main></body></html>;
};
