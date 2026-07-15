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
  begin
    perform pg_advisory_xact_lock(hashtext('__renown_market_trade_integration__'));

    if exists(select 1 from players where id in ('__trade_fixture_player_a__', '__trade_fixture_player_b__'))
      or exists(select 1 from wild_seed_sources where pet_seed in ('__trade_fixture_pet_a__', '__trade_fixture_pet_b__'))
      or exists(select 1 from market_trades where id = '__trade_fixture_trade__') then
      raise exception 'synthetic trade fixtures already exist; refusing to touch them';
    end if;

    select coalesce(balance_cents, 0) into v_platform_before from wallet_accounts where id = 'platform:revenue';
    v_platform_before := coalesce(v_platform_before, 0);

    insert into players(id, handle) values
      ('__trade_fixture_player_a__', 'Synthetic Trader A'),
      ('__trade_fixture_player_b__', 'Synthetic Trader B');
    insert into wild_seed_sources(player_id, pet_seed, github_login, name, tier, finish) values
      ('__trade_fixture_player_a__', '__trade_fixture_pet_a__', '__synthetic_a__', 'Rollback Raccoon', 'Common', 'Base'),
      ('__trade_fixture_player_b__', '__trade_fixture_pet_b__', '__synthetic_b__', 'Transaction Terrier', 'Rare', 'Holo');
    insert into pet_ownership_events(id, pet_seed, sequence, kind, to_player_id, reason) values
      ('__trade_fixture_mint_a__', '__trade_fixture_pet_a__', 1, 'mint', '__trade_fixture_player_a__', 'synthetic_test'),
      ('__trade_fixture_mint_b__', '__trade_fixture_pet_b__', 1, 'mint', '__trade_fixture_player_b__', 'synthetic_test');

    perform ensure_player_wallet('__trade_fixture_player_a__');
    perform ensure_player_wallet('__trade_fixture_player_b__');
    update wallet_accounts set balance_cents = 100 where player_id in ('__trade_fixture_player_a__', '__trade_fixture_player_b__');
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
    if v_balance_a <> 75 or v_balance_b <> 75 then raise exception 'synthetic trade fees were not charged exactly once'; end if;
    if v_platform_after is distinct from v_platform_before + 50 then raise exception 'platform fee delta was not 50 cents'; end if;
    if v_tx_count <> 1 then raise exception 'idempotent retry created % wallet transactions', v_tx_count; end if;
    if (select status from market_trades where id = '__trade_fixture_trade__') <> 'accepted' then raise exception 'synthetic trade did not settle'; end if;
    if (select count(*) from pet_ownership_events where pet_seed in ('__trade_fixture_pet_a__', '__trade_fixture_pet_b__')) <> 4 then raise exception 'provenance events are incomplete'; end if;

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
    (select count(*)::integer from wallet_transactions where idempotency_key = '__trade_fixture_idempotency__') as transactions,
    (select count(*)::integer from pet_ownership_events where pet_seed in ('__trade_fixture_pet_a__', '__trade_fixture_pet_b__')) as events`;
const counts = residue[0] as { players: number; pets: number; trades: number; transactions: number; events: number };
if (Object.values(counts).some(Number)) throw new Error(`synthetic fixture cleanup failed: ${JSON.stringify(counts)}`);

console.log("market trade settlement passed; rollback verified with zero synthetic residue");
