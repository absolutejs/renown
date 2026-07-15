# Renown marketplace and wallet

Renown uses a closed-loop, dollar-denominated wallet. A dollar balance can buy pets and
pay trade fees inside Renown, but it cannot be withdrawn or redeemed for cash. The UI and
ledger use integer cents. The shared implementation lives in `@absolutejs/wallet`.

Reusable boundaries:

- `@absolutejs/marketplace` owns provider-agnostic criteria matching, listing and auction
  validation, anti-sniping, cursor encoding, state transitions, and settlement plans.
- `@absolutejs/collectibles` owns deterministic set/subject/printing/copy identity,
  shuffled serial allocation, weighted traits, rarity explanations, and population math.
- `@absolutejs/wallet-stripe` creates closed-loop Stripe Checkout funding sessions and
  normalizes verified funding, refund, and dispute webhooks into idempotent wallet actions.
- Renown owns its pet recipes, Genesis catalog, achievement issuance rules, visual UI,
  Drizzle queries, and PostgreSQL functions that commit money and ownership atomically.

## Launch policy

- Minimum deposit: $5.00
- Maximum wallet balance: $2,000.00
- Maximum listing/transaction: $1,800.00
- Marketplace fee: 10%, paid by the seller
- Guaranteed direct trade: $0.25 per participant
- Buyers pay exactly the displayed listing price
- Initial paid launch: United States, age 18+

These are launch risk controls, not claims about universal legal limits. Counsel and the
payment provider must review the final product, countries, age policy, tax handling, and
money-transmission analysis before funding is enabled.

## Accounting and settlement invariants

`wallet_entries` is an append-only double-entry journal. A deferred PostgreSQL trigger
rejects any transaction that does not sum to zero. Account balances are cached under row
locks for fast checks, while journal entries remain the audit source of truth.

Every external write has an idempotency key. Stripe never writes a balance from a browser
redirect: only a signature-verified paid webhook can call `fund_player_wallet`. A market
purchase calls one PostgreSQL function which locks the listing, pet, and wallets; moves
the money; transfers ownership; cancels conflicting market state; detaches the pet from
the seller's avatar, showcases, and books; refreshes both inventories; and appends public
provenance. Any error rolls the entire operation back.

The item remains usable while listed. It stops being usable by the seller at the exact
transaction that makes the buyer its owner. Buy-order funds and leading auction bids are
reserved, not spent, until one atomic settlement captures them. Outbid, cancelled, and
expired reservations return to the available balance.

## Subject exchange and watches

Every discovered subject has a permanent `/marketplace/subjects/:id` exchange. It combines
the seven known printing limits, issued and remaining population, every discovered physical
copy, record copies, trait census, active listings, buy orders, auctions, and comparable
sales. Undiscovered manifest subjects remain hidden even when a deterministic id is guessed.

Collectors can watch a whole subject or narrow the watch to a finish and maximum price.
Creating a matching listing or auction fans out through the existing marketplace push
preference. Watch rows contain public collectible criteria only; payment and identity-provider
metadata never enters the watchlist.

## Provenance and blockchain boundary

The public provenance record includes pet seed, ordered ownership events, reason, public
settlement reference, timestamp, and optional chain reference. Founder/original-earner
identity is immutable across sale, trade, gift, and recovery.

Payment-provider identifiers, balances, email, legal identity, card data, and private
account metadata are never public or on-chain. The currently published AbsoluteJS Base
package exposes an adapter boundary but does not yet implement a production transfer
contract. Renown therefore writes each ownership change and a durable, idempotent transfer
outbox row in the same database transaction. A separately configured, authenticated gateway
may anchor registered token IDs and return a chain reference. Until that succeeds and writes
`chain_ref`, Renown labels the record as provenance—not as an on-chain transaction.

## Enabling wallet funding

Keep `STRIPE_WALLET_FUNDING_ENABLED=false` until all of these are complete:

1. Written Stripe approval for the exact closed-loop collectibles marketplace model.
2. Legal review, terms, privacy policy, age/country controls, taxes, refund and dispute runbook.
3. Webhook signature verification and replay test in production.
4. Funding, partial refund, dispute, frozen-wallet, and reconciliation drills.
5. Alerts for ledger imbalance (must always be zero), settlement failures, and webhook backlog.

Live funding has two locks: set `STRIPE_WALLET_FUNDING_ENABLED=true` and record Stripe's written
approval ticket/reference in `STRIPE_MARKETPLACE_APPROVAL_REFERENCE`. Test mode only requires
the first flag. The marketplace can browse and accept listings while funding is disabled,
but accurately shows that deposits are not open. See `docs/STRIPE_LAUNCH.md` for the runbook.
