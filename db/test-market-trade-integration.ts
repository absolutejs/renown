// Deliberately exercises the real PostgreSQL settlement function without retaining
// fixtures. The final exception rolls the entire DO statement back, including the
// platform fee. A separate read proves that every synthetic identifier is absent.
import { sql } from "./index.ts";

const rollbackSentinel = "__RENOWN_SYNTHETIC_TRADE_ROLLBACK__";

try {
  await sql`do $$
  declare
    v_platform_before integer;
    v_platform_after integer;
    v_owner_a text;
    v_owner_b text;
    v_balance_a integer;
    v_balance_b integer;
    v_tx_count integer;
    v_printing text;
  begin
    perform pg_advisory_xact_lock(hashtext('__renown_market_trade_integration__'));

    if exists(select 1 from players where id in ('__trade_fixture_player_a__', '__trade_fixture_player_b__'))
      or exists(select 1 from wild_seed_sources where pet_seed in ('__trade_fixture_pet_a__', '__trade_fixture_pet_b__'))
      or exists(select 1 from market_trades where id = '__trade_fixture_trade__')
      or exists(select 1 from market_buy_orders where id = '__buy_fixture_order__')
      or exists(select 1 from market_watchlists where id = '__watch_fixture__')
      or exists(select 1 from market_auctions where id in ('__auction_fixture__','__auction_cancel_fixture__')) then
      raise exception 'synthetic trade fixtures already exist; refusing to touch them';
    end if;

    select coalesce(balance_cents, 0) into v_platform_before from wallet_accounts where id = 'platform:revenue';
    v_platform_before := coalesce(v_platform_before, 0);
    select id into v_printing from pet_printings order by id limit 1;
    if v_printing is null then raise exception 'integration test requires one real printing as a read-only template'; end if;

    insert into players(id, handle) values
      ('__trade_fixture_player_a__', 'Synthetic Trader A'),
      ('__trade_fixture_player_b__', 'Synthetic Trader B');
    insert into market_watchlists(id,player_id,subject_id,finish,maximum_price_cents)
      select '__watch_fixture__','__trade_fixture_player_a__',subject_id,'Base',500 from pet_printings where id=v_printing;
    if (select maximum_price_cents from market_watchlists where id='__watch_fixture__') <> 500 then raise exception 'subject watch was not stored'; end if;
    insert into wild_seed_sources(player_id, pet_seed, github_login, name, tier, finish, printing_id) values
      ('__trade_fixture_player_a__', '__trade_fixture_pet_a__', '__synthetic_a__', 'Rollback Raccoon', 'Common', 'Base', v_printing),
      ('__trade_fixture_player_b__', '__trade_fixture_pet_b__', '__synthetic_b__', 'Transaction Terrier', 'Rare', 'Holo', v_printing);
    insert into pet_ownership_events(id, pet_seed, sequence, kind, to_player_id, reason) values
      ('__trade_fixture_mint_a__', '__trade_fixture_pet_a__', 1, 'mint', '__trade_fixture_player_a__', 'synthetic_test'),
      ('__trade_fixture_mint_b__', '__trade_fixture_pet_b__', 1, 'mint', '__trade_fixture_player_b__', 'synthetic_test');

    perform ensure_player_wallet('__trade_fixture_player_a__');
    perform ensure_player_wallet('__trade_fixture_player_b__');
    update wallet_accounts set balance_cents = 200 where player_id in ('__trade_fixture_player_a__', '__trade_fixture_player_b__');
    insert into market_trades(id, proposer_player_id, counterparty_player_id, offered_pet_seeds, requested_pet_seeds, note)
      values('__trade_fixture_trade__', '__trade_fixture_player_a__', '__trade_fixture_player_b__', '["__trade_fixture_pet_a__"]', '["__trade_fixture_pet_b__"]', 'rollback-only integration fixture');

    perform settle_market_trade('__trade_fixture_trade__', '__trade_fixture_player_b__', '__trade_fixture_idempotency__');
    -- A retry with the same key must return the original settlement and do no more work.
    perform settle_market_trade('__trade_fixture_trade__', '__trade_fixture_player_b__', '__trade_fixture_idempotency__');

    select player_id into v_owner_a from wild_seed_sources where pet_seed = '__trade_fixture_pet_a__';
    select player_id into v_owner_b from wild_seed_sources where pet_seed = '__trade_fixture_pet_b__';
    select balance_cents into v_balance_a from wallet_accounts where player_id = '__trade_fixture_player_a__';
    select balance_cents into v_balance_b from wallet_accounts where player_id = '__trade_fixture_player_b__';
    select balance_cents into v_platform_after from wallet_accounts where id = 'platform:revenue';
    select count(*)::integer into v_tx_count from wallet_transactions where idempotency_key = '__trade_fixture_idempotency__';

    if v_owner_a <> '__trade_fixture_player_b__' or v_owner_b <> '__trade_fixture_player_a__' then raise exception 'synthetic ownership did not swap'; end if;
    if v_balance_a <> 175 or v_balance_b <> 175 then raise exception 'synthetic trade fees were not charged exactly once'; end if;
    if v_platform_after is distinct from v_platform_before + 50 then raise exception 'platform fee delta was not 50 cents'; end if;
    if v_tx_count <> 1 then raise exception 'idempotent retry created % wallet transactions', v_tx_count; end if;
    if (select status from market_trades where id = '__trade_fixture_trade__') <> 'accepted' then raise exception 'synthetic trade did not settle'; end if;
    if (select count(*) from pet_ownership_events where pet_seed in ('__trade_fixture_pet_a__', '__trade_fixture_pet_b__')) <> 4 then raise exception 'provenance events are incomplete'; end if;

    -- Player A now buys pet A back from player B through a reserved-funds order.
    perform create_market_buy_order('__buy_fixture_order__','__trade_fixture_player_a__',jsonb_build_object('printingId',v_printing),100,now()+interval '1 day','__buy_fixture_create__');
    if (select reserved_cents from wallet_accounts where player_id='__trade_fixture_player_a__') <> 100 then raise exception 'buy order funds were not reserved'; end if;
    perform settle_market_buy_order('__buy_fixture_order__','__trade_fixture_player_b__','__trade_fixture_pet_a__','__buy_fixture_settle__');
    select balance_cents into v_balance_a from wallet_accounts where player_id = '__trade_fixture_player_a__';
    select balance_cents into v_balance_b from wallet_accounts where player_id = '__trade_fixture_player_b__';
    select balance_cents into v_platform_after from wallet_accounts where id = 'platform:revenue';
    if v_balance_a <> 75 or v_balance_b <> 265 then raise exception 'buy order settlement balances are wrong'; end if;
    if (select reserved_cents from wallet_accounts where player_id='__trade_fixture_player_a__') <> 0 then raise exception 'captured buy order stayed reserved'; end if;
    if v_platform_after is distinct from v_platform_before + 60 then raise exception 'buy order seller fee was not credited'; end if;
    if (select player_id from wild_seed_sources where pet_seed='__trade_fixture_pet_a__') <> '__trade_fixture_player_a__' then raise exception 'buy order ownership did not transfer'; end if;
    if (select status from market_buy_orders where id='__buy_fixture_order__') <> 'filled' then raise exception 'buy order did not fill'; end if;

    -- A seller can cancel only before a bid, with the check and cancellation under one lock.
    perform create_market_auction('__auction_cancel_fixture__','__trade_fixture_player_a__','__trade_fixture_pet_a__',100,null,now()+interval '2 hours');
    perform cancel_market_auction('__auction_cancel_fixture__','__trade_fixture_player_a__');
    if (select status from market_auctions where id='__auction_cancel_fixture__') <> 'cancelled' then raise exception 'no-bid auction did not cancel'; end if;

    -- Auction bid reservations, anti-sniping, seller fee, and transfer settle together.
    perform create_market_auction('__auction_fixture__','__trade_fixture_player_a__','__trade_fixture_pet_b__',100,100,now()+interval '2 hours');
    update market_auctions set ends_at=now()+interval '1 minute' where id='__auction_fixture__';
    perform place_market_bid('__auction_bid_fixture__','__auction_fixture__','__trade_fixture_player_b__',100,'__auction_bid_reserve__');
    perform place_market_bid('__ignored_retry_id__','__auction_fixture__','__trade_fixture_player_b__',100,'__auction_bid_reserve__');
    begin
      perform place_market_bid('__bad_retry_id__','__auction_fixture__','__trade_fixture_player_b__',200,'__auction_bid_reserve__');
      raise exception 'mismatched bid idempotency retry was accepted';
    exception when others then
      if sqlerrm not like '%idempotency key belongs to another bid%' then raise; end if;
    end;
    begin
      perform cancel_market_auction('__auction_fixture__','__trade_fixture_player_a__');
      raise exception 'auction with a live bid was cancelled';
    exception when others then
      if sqlerrm not like '%live bid cannot be cancelled%' then raise; end if;
    end;
    if (select extension_count from market_auctions where id='__auction_fixture__') <> 1 then raise exception 'anti-sniping did not extend exactly once'; end if;
    if (select reserved_cents from wallet_accounts where player_id='__trade_fixture_player_b__') <> 100 then raise exception 'auction bid was not reserved exactly once'; end if;
    update market_auctions set ends_at=now()-interval '1 second' where id='__auction_fixture__';
    perform settle_market_auction('__auction_fixture__','__auction_settle_fixture__');
    select balance_cents into v_balance_a from wallet_accounts where player_id = '__trade_fixture_player_a__';
    select balance_cents into v_balance_b from wallet_accounts where player_id = '__trade_fixture_player_b__';
    select balance_cents into v_platform_after from wallet_accounts where id = 'platform:revenue';
    if v_balance_a <> 165 or v_balance_b <> 165 then raise exception 'auction settlement balances are wrong'; end if;
    if v_platform_after is distinct from v_platform_before + 70 then raise exception 'auction seller fee was not credited'; end if;
    if (select reserved_cents from wallet_accounts where player_id='__trade_fixture_player_b__') <> 0 then raise exception 'winning auction bid stayed reserved'; end if;
    if (select player_id from wild_seed_sources where pet_seed='__trade_fixture_pet_b__') <> '__trade_fixture_player_b__' then raise exception 'auction ownership did not transfer'; end if;
    if (select status from market_auctions where id='__auction_fixture__') <> 'settled' then raise exception 'auction did not settle'; end if;
    if (select count(*) from onchain_transfer_outbox where pet_seed in ('__trade_fixture_pet_a__','__trade_fixture_pet_b__')) <> 4 then raise exception 'settlements were not queued for on-chain anchoring'; end if;

    -- A refund/dispute can create debt, freezes the wallet, and remains balanced and idempotent.
    perform adjust_wallet_external('__trade_fixture_player_a__',-200,'__external_debit_fixture__','dispute','__synthetic_dispute__',true);
    perform adjust_wallet_external('__trade_fixture_player_a__',-200,'__external_debit_fixture__','dispute','__synthetic_dispute__',true);
    if (select balance_cents from wallet_accounts where player_id='__trade_fixture_player_a__') <> -35 then raise exception 'external debit was not applied exactly once'; end if;
    if (select status from wallet_accounts where player_id='__trade_fixture_player_a__') <> 'frozen' then raise exception 'disputed wallet was not frozen'; end if;
    perform adjust_wallet_external('__trade_fixture_player_a__',200,'__external_reversal_fixture__','dispute-reversal','__synthetic_dispute__',true);
    if (select balance_cents from wallet_accounts where player_id='__trade_fixture_player_a__') <> 165 then raise exception 'external reversal did not restore the wallet'; end if;
    if (select status from wallet_accounts where player_id='__trade_fixture_player_a__') <> 'frozen' then raise exception 'external reversal silently unfroze the wallet'; end if;
    if (select count(*) from wallet_transactions where idempotency_key in ('__external_debit_fixture__','__external_reversal_fixture__')) <> 2 then raise exception 'external adjustments were not idempotent'; end if;
    if exists(select 1 from wallet_transactions t join lateral (select sum(e.amount_cents) total from wallet_entries e where e.transaction_id=t.id) x on true where t.idempotency_key in ('__external_debit_fixture__','__external_reversal_fixture__') and x.total<>0) then raise exception 'external adjustment ledger is unbalanced'; end if;

    raise exception '__RENOWN_SYNTHETIC_TRADE_ROLLBACK__';
  end $$`;
  throw new Error("integration test committed unexpectedly");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes(rollbackSentinel)) throw error;
}

const residue = await sql`
  select
    (select count(*)::integer from players where id in ('__trade_fixture_player_a__', '__trade_fixture_player_b__')) as players,
    (select count(*)::integer from wild_seed_sources where pet_seed in ('__trade_fixture_pet_a__', '__trade_fixture_pet_b__')) as pets,
    (select count(*)::integer from market_trades where id = '__trade_fixture_trade__') as trades,
    (select count(*)::integer from market_buy_orders where id = '__buy_fixture_order__') as buy_orders,
    (select count(*)::integer from market_auctions where id in ('__auction_fixture__','__auction_cancel_fixture__')) as auctions,
    (select count(*)::integer from market_bids where id in ('__auction_bid_fixture__','__ignored_retry_id__','__bad_retry_id__')) as bids,
    (select count(*)::integer from market_watchlists where id='__watch_fixture__') as watches,
    (select count(*)::integer from wallet_reservations where idempotency_key in ('__buy_fixture_create__','__auction_bid_reserve__')) as reservations,
    (select count(*)::integer from wallet_transactions where idempotency_key in ('__trade_fixture_idempotency__','__buy_fixture_settle__','__auction_settle_fixture__','__external_debit_fixture__','__external_reversal_fixture__')) as transactions,
    (select count(*)::integer from pet_ownership_events where pet_seed in ('__trade_fixture_pet_a__', '__trade_fixture_pet_b__')) as events,
    (select count(*)::integer from onchain_transfer_outbox where pet_seed in ('__trade_fixture_pet_a__', '__trade_fixture_pet_b__')) as onchain_outbox`;
const counts = residue[0] as { players: number; pets: number; trades: number; buy_orders: number; auctions: number; bids: number; watches: number; reservations: number; transactions: number; events: number; onchain_outbox: number };
if (Object.values(counts).some(Number)) throw new Error(`synthetic fixture cleanup failed: ${JSON.stringify(counts)}`);

console.log("market trade settlement passed; rollback verified with zero synthetic residue");
