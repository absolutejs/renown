# Stripe marketplace launch runbook

This is the operator checklist for accepting real wallet deposits. It is not legal advice.
Subscriptions and wallet deposits are separate products: a working subscription account does
not imply approval for a user-to-user collectibles marketplace.

## Product statement for Stripe review

Use this as a draft and have the account owner review it before sending:

> Renown operates a first-party digital collectibles game and its user-to-user marketplace.
> Users earn Renown pets, may list or trade them, and may fund a closed-loop USD-denominated
> balance to buy pets or pay $0.25-per-person guaranteed-trade fees. Balances cannot be withdrawn,
> redeemed for cash, transferred outside Renown, or converted to cryptocurrency. Sellers receive
> only closed-loop balance. Renown controls item issuance, verifies ownership, atomically guarantees
> settlement, keeps 10% of sales from the seller, and retains public item provenance. Stripe Checkout
> is the only card-entry surface. Please confirm in writing that Stripe approves this exact model,
> including wallet funding and user-to-user digital-item sales, and identify any required Connect,
> identity, age, country, tax, reserve, or dispute controls.

Do not add claims about incorporation, location, age restrictions, tax status, or legal review until
they are true. Save the written approval ticket/reference as `STRIPE_MARKETPLACE_APPROVAL_REFERENCE`.

## Information the account owner must supply

- Legal entity/business name, type, country, and physical address.
- Public support email and support URL.
- Launch countries and minimum user age.
- Refund policy and response time.
- Terms of Service and Privacy Policy URLs reviewed for the actual marketplace model.
- Tax registration/collection decision for each launch jurisdiction.
- Bank/payout details and representative identity requested by Stripe.

## Dashboard readiness

1. Finish Stripe account activation and business verification; resolve every dashboard requirement.
2. Set the public business name, statement descriptor, support email/phone/URL, Terms URL, Privacy URL,
   and refund policy to match Renown exactly.
3. Ask Stripe for the written approval above. Do not enable live deposits while it is pending.
4. Confirm live card payments are enabled. Start with card only; do not enable delayed methods until
   their asynchronous and refund behavior has a tested ledger path.
5. Create the live Supporter and Pro recurring prices if subscriptions will launch simultaneously.
6. Add `https://renown.absolutejs.com/webhooks/stripe` as a live webhook endpoint. Subscribe to:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `refund.created`, `refund.updated`,
   `charge.dispute.created`, and `charge.dispute.closed`.
7. Store the live signing secret and live API keys only in the production secret store.

## Production environment

Required for deposits:

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_MARKETPLACE_APPROVAL_REFERENCE=<Stripe ticket or written approval reference>
STRIPE_WALLET_FUNDING_ENABLED=false
```

Also set `STRIPE_PRICE_SUPPORTER` and `STRIPE_PRICE_PRO` to live price IDs when subscriptions are
enabled. Never mix test and live keys, prices, or webhook secrets. The server rejects webhook events
whose `livemode` does not match its secret-key mode.

## Test-mode acceptance drill

Keep the production funding flag false. In a staging/test-key environment:

1. Deposit $5 through hosted Checkout and confirm exactly one wallet credit after webhook replay.
2. Replay the same event and confirm the balance does not change.
3. Buy a synthetic listing and verify buyer debit, seller credit, 10% revenue, ownership, avatar/book
   removal, provenance, and notification.
4. Create/cancel/fill a buy order and verify reserved balance returns or captures exactly once.
5. Bid, outbid, exercise the two-minute anti-sniping extension, and settle an auction.
6. Issue a partial refund; confirm the matching wallet debit and automatic freeze if funds are short.
7. Create/close a test dispute; confirm debit/reversal and that admin review is required to unfreeze.
8. Confirm admin health reports zero ledger imbalances and no failed Stripe events.
9. Run `bun run db/test-market-trade-integration.ts`; it must report zero synthetic residue.

## Controlled live opening

After written approval, policies, tax decision, and the complete test drill:

1. Deploy live keys and approval reference with `STRIPE_WALLET_FUNDING_ENABLED=false`.
2. Verify `/stripe/config` reports `mode: "live"`, webhook configured, approval recorded, and funding off.
3. Process a real $5 owner deposit, then a refund, while monitoring Stripe and marketplace health.
4. Reconcile Stripe gross/refunds against `platform:clearing`; ledger imbalance count must be zero.
5. Set `STRIPE_WALLET_FUNDING_ENABLED=true`, deploy, and verify Checkout once more.
6. Monitor webhook failures, frozen wallets, reservations, disputes, and chain-outbox failures daily.

Emergency response: turn `STRIPE_WALLET_FUNDING_ENABLED=false` first. Existing ownership and balances
remain readable; deposits stop. Freeze implicated wallets in Marketplace operations, preserve logs,
resolve failed signed webhook events, and reconcile before reopening.
