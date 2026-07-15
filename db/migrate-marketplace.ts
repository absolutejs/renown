// Closed-loop marketplace substrate. Safe to rerun; all money and ownership mutations
// happen inside PostgreSQL functions so a process crash cannot create a double sale.
import { sql } from "./index.ts";

await sql`create table if not exists wallet_accounts (
  id text primary key, player_id text unique references players(id) on delete restrict,
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'active' check (status in ('active','frozen','closed')),
  allow_negative boolean not null default false, balance_cents integer not null default 0,
  reserved_cents integer not null default 0, created_at timestamp not null default now(),
  check (allow_negative or (balance_cents >= 0 and reserved_cents >= 0 and reserved_cents <= balance_cents))
)`;
await sql`create table if not exists wallet_transactions (
  id text primary key, idempotency_key text not null unique, kind text not null,
  metadata jsonb not null default '{}'::jsonb, created_at timestamp not null default now()
)`;
await sql`create table if not exists stripe_webhook_events (
  id text primary key, type text not null, live_mode boolean not null,
  status text not null default 'received' check (status in ('received','processed','failed')),
  attempts integer not null default 1, error text, received_at timestamp not null default now(), processed_at timestamp
)`;
await sql`create index if not exists stripe_webhook_events_status_received_idx on stripe_webhook_events(status,received_at)`;
await sql`create table if not exists wallet_entries (
  transaction_id text not null references wallet_transactions(id) on delete restrict,
  position integer not null check (position >= 0), account_id text not null references wallet_accounts(id) on delete restrict,
  amount_cents integer not null check (amount_cents <> 0), primary key (transaction_id, position)
)`;
await sql`create index if not exists wallet_entries_account_idx on wallet_entries(account_id, transaction_id)`;
await sql`create table if not exists wallet_reservations (
  id text primary key, idempotency_key text not null unique, account_id text not null references wallet_accounts(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0), status text not null default 'active' check (status in ('active','captured','released','expired')),
  purpose text not null, capture_transaction_id text references wallet_transactions(id) on delete restrict,
  expires_at timestamp, created_at timestamp not null default now()
)`;
await sql`create index if not exists wallet_reservations_active_idx on wallet_reservations(account_id, status, expires_at)`;

await sql`create table if not exists market_listings (
  id text primary key, pet_seed text not null, seller_player_id text not null references players(id) on delete restrict,
  price_cents integer not null check (price_cents between 100 and 180000),
  status text not null default 'active' check (status in ('active','sold','cancelled','expired')),
  buyer_player_id text references players(id) on delete restrict, created_at timestamp not null default now(),
  updated_at timestamp not null default now(), expires_at timestamp
)`;
await sql`create index if not exists market_listings_browse_idx on market_listings(status, created_at desc, id desc)`;
await sql`create unique index if not exists market_listings_one_active_pet on market_listings(pet_seed) where status = 'active'`;
await sql`create table if not exists market_buy_orders (
  id text primary key, buyer_player_id text not null references players(id) on delete restrict,
  criteria jsonb not null, price_cents integer not null check (price_cents between 100 and 180000),
  reservation_id text not null references wallet_reservations(id) on delete restrict,
  status text not null default 'active' check (status in ('active','filled','cancelled','expired')),
  seller_player_id text references players(id) on delete restrict, pet_seed text,
  created_at timestamp not null default now(), updated_at timestamp not null default now(), expires_at timestamp, filled_at timestamp
)`;
await sql`alter table market_buy_orders add column if not exists seller_player_id text references players(id) on delete restrict`;
await sql`alter table market_buy_orders add column if not exists pet_seed text`;
await sql`alter table market_buy_orders add column if not exists updated_at timestamp not null default now()`;
await sql`alter table market_buy_orders add column if not exists filled_at timestamp`;
await sql`create index if not exists market_buy_orders_browse_idx on market_buy_orders(status, price_cents desc, created_at)`;
await sql`create table if not exists market_auctions (
  id text primary key, pet_seed text not null, seller_player_id text not null references players(id) on delete restrict,
  start_cents integer not null check (start_cents between 100 and 180000), reserve_cents integer,
  status text not null default 'active' check (status in ('active','settled','cancelled','expired')),
  ends_at timestamp not null, extension_count integer not null default 0, winner_player_id text references players(id) on delete restrict,
  final_cents integer, created_at timestamp not null default now(), updated_at timestamp not null default now(), settled_at timestamp
)`;
await sql`alter table market_auctions add column if not exists extension_count integer not null default 0`;
await sql`alter table market_auctions add column if not exists winner_player_id text references players(id) on delete restrict`;
await sql`alter table market_auctions add column if not exists final_cents integer`;
await sql`alter table market_auctions add column if not exists updated_at timestamp not null default now()`;
await sql`alter table market_auctions add column if not exists settled_at timestamp`;
await sql`create unique index if not exists market_auctions_one_active_pet on market_auctions(pet_seed) where status = 'active'`;
await sql`create index if not exists market_auctions_ending_idx on market_auctions(status, ends_at)`;
await sql`create table if not exists market_bids (
  id text primary key, auction_id text not null references market_auctions(id) on delete cascade,
  bidder_player_id text not null references players(id) on delete restrict, amount_cents integer not null,
  reservation_id text not null references wallet_reservations(id) on delete restrict,
  status text not null default 'active' check (status in ('active','won','outbid','released')),
  created_at timestamp not null default now()
)`;
await sql`create index if not exists market_bids_auction_amount_idx on market_bids(auction_id, amount_cents desc, created_at)`;
await sql`create table if not exists market_trades (
  id text primary key, proposer_player_id text not null references players(id) on delete restrict,
  counterparty_player_id text not null references players(id) on delete restrict,
  offered_pet_seeds jsonb not null default '[]'::jsonb, requested_pet_seeds jsonb not null default '[]'::jsonb,
  parent_trade_id text, note text not null default '',
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired','countered')),
  created_at timestamp not null default now(), updated_at timestamp not null default now(), expires_at timestamp, settled_at timestamp
)`;
await sql`alter table market_trades add column if not exists parent_trade_id text`;
await sql`alter table market_trades add column if not exists note text not null default ''`;
await sql`alter table market_trades add column if not exists updated_at timestamp not null default now()`;
await sql`alter table market_trades add column if not exists settled_at timestamp`;
await sql`alter table market_trades drop constraint if exists market_trades_status_check`;
await sql`alter table market_trades add constraint market_trades_status_check check (status in ('pending','accepted','declined','cancelled','expired','countered'))`;
await sql`create index if not exists market_trades_proposer_idx on market_trades(proposer_player_id,status,updated_at desc)`;
await sql`create index if not exists market_trades_counterparty_idx on market_trades(counterparty_player_id,status,updated_at desc)`;
await sql`create table if not exists pet_ownership_events (
  id text primary key, pet_seed text not null, sequence integer not null, kind text not null,
  from_player_id text references players(id) on delete restrict, to_player_id text references players(id) on delete restrict,
  reason text not null, settlement_ref text, chain_ref text, amount_cents integer,
  occurred_at timestamp not null default now(), unique(pet_seed, sequence)
)`;
await sql`create index if not exists pet_ownership_events_pet_history_idx on pet_ownership_events(pet_seed, occurred_at)`;
await sql`create table if not exists pet_chain_tokens (
  pet_seed text primary key, token_id text not null unique, adapter text not null, created_at timestamp not null default now()
)`;
await sql`create table if not exists onchain_transfer_outbox (
  id text primary key, ownership_event_id text not null unique, pet_seed text not null,
  from_player_id text not null, to_player_id text not null, reason text not null, settlement_ref text not null,
  status text not null default 'pending' check(status in ('pending','anchored','failed')),
  attempts integer not null default 0, last_error text, next_attempt_at timestamp not null default now(), created_at timestamp not null default now(), anchored_at timestamp
)`;
await sql`create index if not exists onchain_transfer_outbox_pending_idx on onchain_transfer_outbox(status,next_attempt_at)`;
await sql`create unique index if not exists wild_seed_sources_pet_seed_uniq on wild_seed_sources(pet_seed)`;

// Existing earned pets become sequence 1 without changing their ownership or appearance.
await sql`insert into pet_ownership_events (id, pet_seed, sequence, kind, to_player_id, reason, occurred_at)
  select 'own:mint:' || md5(w.pet_seed), w.pet_seed, 1, 'mint', w.player_id, 'earned', w.earned_at
  from wild_seed_sources w on conflict (pet_seed, sequence) do nothing`;

await sql`create or replace function wallet_assert_balanced() returns trigger language plpgsql as $$
declare v_total integer;
begin
  select coalesce(sum(amount_cents),0)::integer into v_total from wallet_entries where transaction_id = coalesce(new.transaction_id, old.transaction_id);
  if v_total <> 0 then raise exception 'wallet transaction is unbalanced by % cents', v_total; end if;
  return null;
end $$`;
await sql`drop trigger if exists wallet_entries_balanced on wallet_entries`;
await sql`create constraint trigger wallet_entries_balanced after insert or update or delete on wallet_entries
  deferrable initially deferred for each row execute function wallet_assert_balanced()`;
await sql`create or replace function reject_ledger_mutation() returns trigger language plpgsql as $$
begin raise exception 'append-only ledger rows cannot be changed'; end $$`;
await sql`drop trigger if exists wallet_entries_immutable on wallet_entries`;
await sql`create trigger wallet_entries_immutable before update or delete on wallet_entries for each row execute function reject_ledger_mutation()`;
await sql`drop trigger if exists ownership_events_immutable on pet_ownership_events`;
await sql`create or replace function protect_ownership_event() returns trigger language plpgsql as $$
begin
  if tg_op='UPDATE' and old.chain_ref is null and new.chain_ref is not null then
    old.chain_ref:=new.chain_ref;
    if new is not distinct from old then return new; end if;
  end if;
  raise exception 'ownership events are immutable except for first chain anchoring';
end $$`;
await sql`create trigger ownership_events_immutable before update or delete on pet_ownership_events for each row execute function protect_ownership_event()`;

await sql`create or replace function ensure_player_wallet(p_player_id text) returns text language plpgsql as $$
declare v_id text := 'wallet:' || p_player_id;
begin
  insert into wallet_accounts(id, player_id) values(v_id, p_player_id) on conflict(id) do nothing;
  return v_id;
end $$`;

await sql`create or replace function enqueue_onchain_transfer(p_event text,p_pet text,p_from text,p_to text,p_reason text,p_settlement text) returns void language plpgsql as $$
begin
  insert into onchain_transfer_outbox(id,ownership_event_id,pet_seed,from_player_id,to_player_id,reason,settlement_ref)
    values('chain:'||md5(p_event),p_event,p_pet,p_from,p_to,p_reason,p_settlement) on conflict(ownership_event_id) do nothing;
end $$`;
await sql`create or replace function complete_onchain_anchor(p_outbox text,p_chain_ref text) returns void language plpgsql as $$
declare o onchain_transfer_outbox%rowtype;
begin
  if coalesce(p_chain_ref,'')='' then raise exception 'chain reference is required'; end if;
  select * into o from onchain_transfer_outbox where id=p_outbox for update;
  if not found then raise exception 'on-chain outbox row not found'; end if;
  if o.status='anchored' then return; end if;
  update pet_ownership_events set chain_ref=p_chain_ref where id=o.ownership_event_id and chain_ref is null;
  update onchain_transfer_outbox set status='anchored',anchored_at=now(),last_error=null where id=o.id;
end $$`;

await sql`create or replace function fund_player_wallet(p_player_id text, p_amount integer, p_idempotency text, p_payment_ref text)
returns table(out_transaction_id text, out_balance_cents integer) language plpgsql as $$
declare v_user text; v_tx text := 'wtx:' || md5(p_idempotency); v_existing text;
begin
  if p_amount < 500 then raise exception 'minimum wallet funding is $5.00'; end if;
  if p_amount > 180000 then raise exception 'maximum wallet transaction is $1,800.00'; end if;
  select id into v_existing from wallet_transactions where idempotency_key = p_idempotency;
  if found then return query select v_existing, balance_cents from wallet_accounts where id = 'wallet:' || p_player_id; return; end if;
  v_user := ensure_player_wallet(p_player_id);
  insert into wallet_accounts(id, allow_negative) values('platform:clearing', true) on conflict(id) do nothing;
  perform 1 from wallet_accounts where id = v_user for update;
  if (select balance_cents from wallet_accounts where id=v_user) + p_amount > 200000 then raise exception 'maximum wallet balance is $2,000.00'; end if;
  insert into wallet_transactions(id,idempotency_key,kind,metadata) values(v_tx,p_idempotency,'funding',jsonb_build_object('paymentRef',p_payment_ref));
  insert into wallet_entries values(v_tx,0,v_user,p_amount),(v_tx,1,'platform:clearing',-p_amount);
  update wallet_accounts set balance_cents=balance_cents+p_amount where id=v_user;
  update wallet_accounts set balance_cents=balance_cents-p_amount where id='platform:clearing';
  return query select v_tx, balance_cents from wallet_accounts where id=v_user;
end $$`;

await sql`create or replace function adjust_wallet_external(p_player_id text,p_amount integer,p_idempotency text,p_kind text,p_reference text,p_force_freeze boolean)
returns table(out_transaction_id text,out_balance_cents integer,out_status text) language plpgsql as $$
declare v_wallet text; v_tx text:='wtx:'||md5(p_idempotency); v_existing text; v_balance integer; v_reserved integer; v_status text;
begin
  if p_amount=0 or abs(p_amount)>180000 then raise exception 'external wallet adjustment is outside the allowed range'; end if;
  select id into v_existing from wallet_transactions where idempotency_key=p_idempotency;
  if found then return query select v_existing,balance_cents,status from wallet_accounts where id='wallet:'||p_player_id; return; end if;
  v_wallet:=ensure_player_wallet(p_player_id); insert into wallet_accounts(id,allow_negative) values('platform:clearing',true) on conflict(id) do nothing;
  perform 1 from wallet_accounts where id in(v_wallet,'platform:clearing') order by id for update;
  select balance_cents,reserved_cents,status into v_balance,v_reserved,v_status from wallet_accounts where id=v_wallet;
  if p_amount>0 and v_balance+p_amount>200000 then p_force_freeze:=true; end if;
  if p_amount<0 and v_balance-v_reserved+p_amount<0 then p_force_freeze:=true; end if;
  insert into wallet_transactions(id,idempotency_key,kind,metadata) values(v_tx,p_idempotency,p_kind,jsonb_build_object('paymentRef',p_reference,'playerId',p_player_id));
  insert into wallet_entries values(v_tx,0,v_wallet,p_amount),(v_tx,1,'platform:clearing',-p_amount);
  update wallet_accounts set balance_cents=balance_cents+p_amount,allow_negative=case when balance_cents+p_amount<0 or reserved_cents>balance_cents+p_amount then true else allow_negative end,
    status=case when p_force_freeze then 'frozen' else status end where id=v_wallet;
  update wallet_accounts set balance_cents=balance_cents-p_amount where id='platform:clearing';
  return query select v_tx,balance_cents,status from wallet_accounts where id=v_wallet;
end $$`;

await sql`create or replace function refresh_pet_inventory(p_player text) returns void language plpgsql as $$
begin
  update players p set
    pets_count=(select count(*)::int from wild_seed_sources w where w.player_id=p_player),
    wild=coalesce((select jsonb_agg(seed) from (select w.pet_seed seed from wild_seed_sources w where w.player_id=p_player order by w.rarity_score desc,w.pet_seed limit 100) s),'[]'::jsonb),
    rarest_pet_score=coalesce((select w.rarity_score from wild_seed_sources w where w.player_id=p_player order by w.rarity_score desc,w.pet_seed limit 1),0),
    rarest_pet_seed=(select w.pet_seed from wild_seed_sources w where w.player_id=p_player order by w.rarity_score desc,w.pet_seed limit 1),
    biggest_pet_size=coalesce((select w.size from wild_seed_sources w where w.player_id=p_player order by w.size desc,w.pet_seed limit 1),0),
    biggest_pet_seed=(select w.pet_seed from wild_seed_sources w where w.player_id=p_player order by w.size desc,w.pet_seed limit 1),
    avatar_seed=case when exists(select 1 from wild_seed_sources w where w.player_id=p_player and w.pet_seed=p.avatar_seed) then p.avatar_seed else (select w.pet_seed from wild_seed_sources w where w.player_id=p_player order by w.rarity_score desc,w.pet_seed limit 1) end,
    showcase_seeds=coalesce((select jsonb_agg(v) from jsonb_array_elements_text(p.showcase_seeds) v where exists(select 1 from wild_seed_sources w where w.player_id=p_player and w.pet_seed=v)),'[]'::jsonb),
    updated_at=now() where p.id=p_player;
end $$`;

await sql`drop function if exists create_market_buy_order(text,text,jsonb,integer,timestamp,text)`;
await sql`create or replace function create_market_buy_order(p_order text,p_buyer text,p_criteria jsonb,p_price integer,p_expires timestamptz,p_idempotency text)
returns table(out_order_id text,out_reservation_id text) language plpgsql as $$
declare v_wallet text; v_reservation text := 'reserve:'||md5(p_idempotency); v_existing text;
begin
  if p_price < 100 or p_price > 180000 then raise exception 'buy order price must be between $1.00 and $1,800.00'; end if;
  if coalesce(p_criteria->>'printingId','') = '' then raise exception 'buy order must identify a printing'; end if;
  select id into v_existing from market_buy_orders where id=p_order;
  if found then return query select v_existing,reservation_id from market_buy_orders where id=v_existing; return; end if;
  v_wallet:=ensure_player_wallet(p_buyer);
  perform 1 from wallet_accounts where id=v_wallet for update;
  if (select status from wallet_accounts where id=v_wallet)<>'active' then raise exception 'wallet is frozen'; end if;
  if (select balance_cents-reserved_cents from wallet_accounts where id=v_wallet) < p_price then raise exception 'insufficient available wallet balance'; end if;
  insert into wallet_reservations(id,idempotency_key,account_id,amount_cents,purpose,expires_at)
    values(v_reservation,p_idempotency,v_wallet,p_price,'market-buy-order:'||p_order,p_expires);
  update wallet_accounts set reserved_cents=reserved_cents+p_price where id=v_wallet;
  insert into market_buy_orders(id,buyer_player_id,criteria,price_cents,reservation_id,expires_at)
    values(p_order,p_buyer,p_criteria,p_price,v_reservation,p_expires);
  return query select p_order,v_reservation;
end $$`;

await sql`create or replace function cancel_market_buy_order(p_order text,p_buyer text) returns void language plpgsql as $$
declare o market_buy_orders%rowtype; r wallet_reservations%rowtype;
begin
  select * into o from market_buy_orders where id=p_order for update;
  if not found or o.buyer_player_id<>p_buyer or o.status<>'active' then raise exception 'active buy order not found'; end if;
  select * into r from wallet_reservations where id=o.reservation_id for update;
  if r.status='active' then
    perform 1 from wallet_accounts where id=r.account_id for update;
    update wallet_accounts set reserved_cents=reserved_cents-r.amount_cents where id=r.account_id;
    update wallet_reservations set status='released' where id=r.id;
  end if;
  update market_buy_orders set status='cancelled',updated_at=now() where id=o.id;
end $$`;

await sql`create or replace function expire_market_buy_orders() returns integer language plpgsql as $$
declare o record; v_count integer:=0;
begin
  for o in select b.id,b.reservation_id,r.account_id,r.amount_cents from market_buy_orders b join wallet_reservations r on r.id=b.reservation_id
    where b.status='active' and r.status='active' and b.expires_at is not null and b.expires_at<=now() for update of b,r skip locked loop
    perform 1 from wallet_accounts where id=o.account_id for update;
    update wallet_accounts set reserved_cents=reserved_cents-o.amount_cents where id=o.account_id;
    update wallet_reservations set status='expired' where id=o.reservation_id and status='active';
    update market_buy_orders set status='expired',updated_at=now() where id=o.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$`;

await sql`create or replace function settle_market_buy_order(p_order text,p_seller text,p_pet text,p_idempotency text)
returns table(out_transaction_id text,out_order_id text,out_pet_seed text,out_buyer text,out_seller text) language plpgsql as $$
declare o market_buy_orders%rowtype; r wallet_reservations%rowtype; w wild_seed_sources%rowtype; v_subject text;
  v_seller_wallet text; v_tx text:='wtx:'||md5(p_idempotency); v_existing text; v_meta jsonb; v_fee integer; v_net integer; v_seq integer;
begin
  select id,metadata into v_existing,v_meta from wallet_transactions where idempotency_key=p_idempotency;
  if found then
    if v_meta->>'orderId' is distinct from p_order or v_meta->>'sellerId' is distinct from p_seller then raise exception 'idempotency key belongs to another buy order'; end if;
    select * into o from market_buy_orders where id=p_order;
    return query select v_existing,p_order,o.pet_seed,o.buyer_player_id,o.seller_player_id; return;
  end if;
  select * into o from market_buy_orders where id=p_order for update;
  if not found or o.status<>'active' or (o.expires_at is not null and o.expires_at<=now()) then raise exception 'buy order is not available'; end if;
  if o.buyer_player_id=p_seller then raise exception 'buyer cannot fill their own order'; end if;
  select * into r from wallet_reservations where id=o.reservation_id for update;
  if not found or r.status<>'active' or r.amount_cents<>o.price_cents then raise exception 'buy order funds are not reserved'; end if;
  select * into w from wild_seed_sources where pet_seed=p_pet for update;
  if not found or w.player_id<>p_seller then raise exception 'seller no longer owns this pet'; end if;
  select subject_id into v_subject from pet_printings where id=w.printing_id;
  if o.criteria->>'printingId' is distinct from w.printing_id then raise exception 'pet does not match the requested printing'; end if;
  if o.criteria ? 'subjectId' and o.criteria->>'subjectId' is distinct from v_subject then raise exception 'pet does not match subject'; end if;
  if o.criteria ? 'finish' and o.criteria->>'finish' is distinct from w.finish then raise exception 'pet does not match finish'; end if;
  if o.criteria ? 'material' and o.criteria->>'material' is distinct from w.material then raise exception 'pet does not match material'; end if;
  if o.criteria ? 'colorway' and o.criteria->>'colorway' is distinct from w.colorway then raise exception 'pet does not match colorway'; end if;
  if o.criteria ? 'pattern' and o.criteria->>'pattern' is distinct from w.copy_pattern then raise exception 'pet does not match pattern'; end if;
  if o.criteria ? 'maxSerial' and (w.serial_number is null or w.serial_number>(o.criteria->>'maxSerial')::integer) then raise exception 'pet serial is outside requested range'; end if;
  v_seller_wallet:=ensure_player_wallet(p_seller);
  insert into wallet_accounts(id) values('platform:revenue') on conflict(id) do nothing;
  perform 1 from wallet_accounts where id in(r.account_id,v_seller_wallet,'platform:revenue') order by id for update;
  if exists(select 1 from wallet_accounts where id in(r.account_id,v_seller_wallet) and status<>'active') then raise exception 'buyer or seller wallet is frozen'; end if;
  if (select balance_cents from wallet_accounts where id=r.account_id)<o.price_cents then raise exception 'reserved buyer balance is unavailable'; end if;
  v_fee:=ceil(o.price_cents*.10)::integer; v_net:=o.price_cents-v_fee;
  if (select balance_cents from wallet_accounts where id=v_seller_wallet)+v_net>200000 then raise exception 'seller wallet would exceed $2,000.00'; end if;
  insert into wallet_transactions(id,idempotency_key,kind,metadata) values(v_tx,p_idempotency,'buy-order-sale',jsonb_build_object('orderId',o.id,'assetId',p_pet,'sellerId',p_seller,'buyerId',o.buyer_player_id));
  insert into wallet_entries values(v_tx,0,r.account_id,-o.price_cents),(v_tx,1,v_seller_wallet,v_net),(v_tx,2,'platform:revenue',v_fee);
  update wallet_accounts set balance_cents=balance_cents-o.price_cents,reserved_cents=reserved_cents-o.price_cents where id=r.account_id;
  update wallet_accounts set balance_cents=balance_cents+v_net where id=v_seller_wallet;
  update wallet_accounts set balance_cents=balance_cents+v_fee where id='platform:revenue';
  update wallet_reservations set status='captured',capture_transaction_id=v_tx where id=r.id;
  update wild_seed_sources set player_id=o.buyer_player_id where pet_seed=p_pet and player_id=p_seller;
  delete from pet_set_display_selections where player_id=p_seller and pet_seed=p_pet;
  update collector_book_slots s set pet_seed=null where pet_seed=p_pet and exists(select 1 from collector_books b where b.id=s.book_id and b.player_id=p_seller);
  update market_listings set status='cancelled',updated_at=now() where pet_seed=p_pet and status='active';
  perform cancel_pet_auction(p_pet);
  update market_trades set status='cancelled',updated_at=now() where status='pending' and (offered_pet_seeds ? p_pet or requested_pet_seeds ? p_pet);
  update market_buy_orders set status='filled',seller_player_id=p_seller,pet_seed=p_pet,filled_at=now(),updated_at=now() where id=o.id;
  select coalesce(max(sequence),0)+1 into v_seq from pet_ownership_events where pet_seed=p_pet;
  insert into pet_ownership_events(id,pet_seed,sequence,kind,from_player_id,to_player_id,reason,settlement_ref,amount_cents)
    values('own:buy-order:'||md5(p_idempotency),p_pet,v_seq,'transfer',p_seller,o.buyer_player_id,'buy-order',p_idempotency,o.price_cents);
  perform enqueue_onchain_transfer('own:buy-order:'||md5(p_idempotency),p_pet,p_seller,o.buyer_player_id,'sale',p_idempotency);
  perform refresh_pet_inventory(p_seller); perform refresh_pet_inventory(o.buyer_player_id);
  return query select v_tx,o.id,p_pet,o.buyer_player_id,p_seller;
end $$`;

await sql`create or replace function cancel_pet_auction(p_pet text) returns void language plpgsql as $$
declare a record; b record;
begin
  for a in select id from market_auctions where pet_seed=p_pet and status='active' for update loop
    for b in select b.id,b.reservation_id,r.account_id,r.amount_cents from market_bids b join wallet_reservations r on r.id=b.reservation_id where b.auction_id=a.id and b.status='active' and r.status='active' for update of b,r loop
      perform 1 from wallet_accounts where id=b.account_id for update;
      update wallet_accounts set reserved_cents=reserved_cents-b.amount_cents where id=b.account_id;
      update wallet_reservations set status='released' where id=b.reservation_id and status='active';
      update market_bids set status='released' where id=b.id;
    end loop;
    update market_auctions set status='cancelled',updated_at=now() where id=a.id;
  end loop;
end $$`;

await sql`create or replace function create_market_auction(p_auction text,p_seller text,p_pet text,p_start integer,p_reserve integer,p_ends timestamptz)
returns text language plpgsql as $$
begin
  if p_start<100 or p_start>180000 then raise exception 'auction start must be between $1.00 and $1,800.00'; end if;
  if p_reserve is not null and (p_reserve<p_start or p_reserve>180000) then raise exception 'reserve must be at least the start and no more than $1,800.00'; end if;
  -- Allow request/transaction latency around the advertised one-hour minimum.
  if p_ends<now()+interval '59 minutes' or p_ends>now()+interval '7 days' then raise exception 'auction duration must be between 1 hour and 7 days'; end if;
  perform 1 from wild_seed_sources where pet_seed=p_pet and player_id=p_seller for update;
  if not found then raise exception 'you do not own this pet'; end if;
  if exists(select 1 from market_listings where pet_seed=p_pet and status='active') or exists(select 1 from market_auctions where pet_seed=p_pet and status='active') then raise exception 'pet already has active market state'; end if;
  insert into market_auctions(id,pet_seed,seller_player_id,start_cents,reserve_cents,ends_at) values(p_auction,p_pet,p_seller,p_start,p_reserve,p_ends);
  return p_auction;
end $$`;

await sql`create or replace function cancel_market_auction(p_auction text,p_seller text) returns void language plpgsql as $$
declare a market_auctions%rowtype;
begin
  select * into a from market_auctions where id=p_auction for update;
  if not found or a.seller_player_id<>p_seller or a.status<>'active' then raise exception 'active auction not found'; end if;
  -- The auction row lock serializes this check against place_market_bid, which locks the
  -- same row before inserting. A bid can therefore never appear between check and cancel.
  if exists(select 1 from market_bids where auction_id=a.id and status='active') then raise exception 'an auction with a live bid cannot be cancelled'; end if;
  update market_auctions set status='cancelled',updated_at=now() where id=a.id;
end $$`;

await sql`create or replace function place_market_bid(p_bid text,p_auction text,p_bidder text,p_amount integer,p_idempotency text)
returns table(out_bid_id text,out_ends_at timestamp,out_extended boolean) language plpgsql as $$
declare a market_auctions%rowtype; v_wallet text; v_reservation text:='reserve:'||md5(p_idempotency); top record; v_extended boolean:=false;
  v_existing text; v_existing_auction text; v_existing_bidder text; v_existing_amount integer;
begin
  select b.id,b.auction_id,b.bidder_player_id,b.amount_cents into v_existing,v_existing_auction,v_existing_bidder,v_existing_amount
    from market_bids b join wallet_reservations r on r.id=b.reservation_id where r.idempotency_key=p_idempotency;
  if found then
    if v_existing_auction<>p_auction or v_existing_bidder<>p_bidder or v_existing_amount<>p_amount then raise exception 'idempotency key belongs to another bid'; end if;
    select * into a from market_auctions where id=p_auction; return query select v_existing,a.ends_at,false; return;
  end if;
  select * into a from market_auctions where id=p_auction for update;
  if not found or a.status<>'active' or a.ends_at<=now() then raise exception 'auction is not open'; end if;
  if a.seller_player_id=p_bidder then raise exception 'seller cannot bid on their auction'; end if;
  if p_amount<a.start_cents or p_amount>180000 then raise exception 'bid is outside the allowed range'; end if;
  select b.id,b.amount_cents,b.reservation_id,r.account_id,r.amount_cents reserved into top from market_bids b join wallet_reservations r on r.id=b.reservation_id
    where b.auction_id=p_auction and b.status='active' order by b.amount_cents desc,b.created_at limit 1 for update of b,r;
  if found and p_amount<top.amount_cents+100 then raise exception 'bid must be at least $1.00 above the leader'; end if;
  v_wallet:=ensure_player_wallet(p_bidder); perform 1 from wallet_accounts where id=v_wallet for update;
  if (select status from wallet_accounts where id=v_wallet)<>'active' then raise exception 'wallet is frozen'; end if;
  if top.id is not null then
    perform 1 from wallet_accounts where id=top.account_id for update;
    update wallet_accounts set reserved_cents=reserved_cents-top.reserved where id=top.account_id;
    update wallet_reservations set status='released' where id=top.reservation_id;
    update market_bids set status='outbid' where id=top.id;
  end if;
  if (select balance_cents-reserved_cents from wallet_accounts where id=v_wallet)<p_amount then raise exception 'insufficient available wallet balance'; end if;
  insert into wallet_reservations(id,idempotency_key,account_id,amount_cents,purpose,expires_at) values(v_reservation,p_idempotency,v_wallet,p_amount,'auction-bid:'||p_auction,a.ends_at);
  update wallet_accounts set reserved_cents=reserved_cents+p_amount where id=v_wallet;
  insert into market_bids(id,auction_id,bidder_player_id,amount_cents,reservation_id) values(p_bid,p_auction,p_bidder,p_amount,v_reservation);
  if a.ends_at<now()+interval '2 minutes' then update market_auctions set ends_at=now()+interval '2 minutes',extension_count=extension_count+1,updated_at=now() where id=a.id returning ends_at into a.ends_at; v_extended:=true; end if;
  return query select p_bid,a.ends_at,v_extended;
end $$`;

await sql`create or replace function settle_market_auction(p_auction text,p_idempotency text)
returns table(out_transaction_id text,out_auction_id text,out_pet_seed text,out_buyer text,out_seller text,out_status text) language plpgsql as $$
declare a market_auctions%rowtype; b market_bids%rowtype; r wallet_reservations%rowtype; v_seller_wallet text;
  v_tx text:='wtx:'||md5(p_idempotency); v_existing text; v_fee integer; v_net integer; v_seq integer;
begin
  select id into v_existing from wallet_transactions where idempotency_key=p_idempotency;
  if found then select * into a from market_auctions where id=p_auction; return query select v_existing,a.id,a.pet_seed,a.winner_player_id,a.seller_player_id,a.status; return; end if;
  select * into a from market_auctions where id=p_auction for update;
  if not found or a.status<>'active' or a.ends_at>now() then raise exception 'auction is not ready to settle'; end if;
  select * into b from market_bids where auction_id=a.id and status='active' order by amount_cents desc,created_at limit 1 for update;
  if not found then update market_auctions set status='expired',updated_at=now(),settled_at=now() where id=a.id; return query select null::text,a.id,a.pet_seed,null::text,a.seller_player_id,'expired'::text; return; end if;
  select * into r from wallet_reservations where id=b.reservation_id for update;
  if a.reserve_cents is not null and b.amount_cents<a.reserve_cents then
    perform 1 from wallet_accounts where id=r.account_id for update; update wallet_accounts set reserved_cents=reserved_cents-r.amount_cents where id=r.account_id;
    update wallet_reservations set status='released' where id=r.id; update market_bids set status='released' where id=b.id;
    update market_auctions set status='expired',final_cents=b.amount_cents,updated_at=now(),settled_at=now() where id=a.id;
    return query select null::text,a.id,a.pet_seed,null::text,a.seller_player_id,'expired'::text; return;
  end if;
  perform 1 from wild_seed_sources where pet_seed=a.pet_seed and player_id=a.seller_player_id for update;
  if not found then raise exception 'seller no longer owns auction pet'; end if;
  v_seller_wallet:=ensure_player_wallet(a.seller_player_id); insert into wallet_accounts(id) values('platform:revenue') on conflict(id) do nothing;
  perform 1 from wallet_accounts where id in(r.account_id,v_seller_wallet,'platform:revenue') order by id for update;
  if exists(select 1 from wallet_accounts where id in(r.account_id,v_seller_wallet) and status<>'active') then raise exception 'buyer or seller wallet is frozen'; end if;
  v_fee:=ceil(b.amount_cents*.10)::integer; v_net:=b.amount_cents-v_fee;
  if (select balance_cents from wallet_accounts where id=v_seller_wallet)+v_net>200000 then raise exception 'seller wallet would exceed $2,000.00'; end if;
  insert into wallet_transactions(id,idempotency_key,kind,metadata) values(v_tx,p_idempotency,'auction-sale',jsonb_build_object('auctionId',a.id,'assetId',a.pet_seed,'buyerId',b.bidder_player_id,'sellerId',a.seller_player_id));
  insert into wallet_entries values(v_tx,0,r.account_id,-b.amount_cents),(v_tx,1,v_seller_wallet,v_net),(v_tx,2,'platform:revenue',v_fee);
  update wallet_accounts set balance_cents=balance_cents-b.amount_cents,reserved_cents=reserved_cents-b.amount_cents where id=r.account_id;
  update wallet_accounts set balance_cents=balance_cents+v_net where id=v_seller_wallet; update wallet_accounts set balance_cents=balance_cents+v_fee where id='platform:revenue';
  update wallet_reservations set status='captured',capture_transaction_id=v_tx where id=r.id; update market_bids set status='won' where id=b.id;
  update wild_seed_sources set player_id=b.bidder_player_id where pet_seed=a.pet_seed and player_id=a.seller_player_id;
  delete from pet_set_display_selections where player_id=a.seller_player_id and pet_seed=a.pet_seed;
  update collector_book_slots s set pet_seed=null where pet_seed=a.pet_seed and exists(select 1 from collector_books c where c.id=s.book_id and c.player_id=a.seller_player_id);
  update market_listings set status='cancelled',updated_at=now() where pet_seed=a.pet_seed and status='active';
  update market_trades set status='cancelled',updated_at=now() where status='pending' and (offered_pet_seeds ? a.pet_seed or requested_pet_seeds ? a.pet_seed);
  update market_auctions set status='settled',winner_player_id=b.bidder_player_id,final_cents=b.amount_cents,updated_at=now(),settled_at=now() where id=a.id;
  select coalesce(max(sequence),0)+1 into v_seq from pet_ownership_events where pet_seed=a.pet_seed;
  insert into pet_ownership_events(id,pet_seed,sequence,kind,from_player_id,to_player_id,reason,settlement_ref,amount_cents)
    values('own:auction:'||md5(p_idempotency),a.pet_seed,v_seq,'transfer',a.seller_player_id,b.bidder_player_id,'auction',p_idempotency,b.amount_cents);
  perform enqueue_onchain_transfer('own:auction:'||md5(p_idempotency),a.pet_seed,a.seller_player_id,b.bidder_player_id,'sale',p_idempotency);
  perform refresh_pet_inventory(a.seller_player_id); perform refresh_pet_inventory(b.bidder_player_id);
  return query select v_tx,a.id,a.pet_seed,b.bidder_player_id,a.seller_player_id,'settled'::text;
end $$`;

await sql`create or replace function settle_market_listing(p_listing text, p_buyer text, p_idempotency text)
returns table(out_transaction_id text, out_pet_seed text, out_seller text, out_buyer text) language plpgsql as $$
declare l market_listings%rowtype; v_buyer_wallet text; v_seller_wallet text; v_tx text := 'wtx:'||md5(p_idempotency);
  v_fee integer; v_net integer; v_seq integer; v_existing text; v_existing_meta jsonb;
begin
  select id,metadata into v_existing,v_existing_meta from wallet_transactions where idempotency_key=p_idempotency;
  if found then
    if v_existing_meta->>'listingId' is distinct from p_listing or v_existing_meta->>'buyerId' is distinct from p_buyer then raise exception 'idempotency key belongs to another settlement'; end if;
    select * into l from market_listings where id=p_listing; return query select v_existing,l.pet_seed,l.seller_player_id,l.buyer_player_id; return;
  end if;
  select * into l from market_listings where id=p_listing for update;
  if not found or l.status <> 'active' or (l.expires_at is not null and l.expires_at <= now()) then raise exception 'listing is not available'; end if;
  if l.seller_player_id=p_buyer then raise exception 'seller cannot buy their own pet'; end if;
  perform 1 from wild_seed_sources where pet_seed=l.pet_seed and player_id=l.seller_player_id for update;
  if not found then raise exception 'seller no longer owns this pet'; end if;
  v_buyer_wallet:=ensure_player_wallet(p_buyer); v_seller_wallet:=ensure_player_wallet(l.seller_player_id);
  insert into wallet_accounts(id) values('platform:revenue') on conflict(id) do nothing;
  perform 1 from wallet_accounts where id in(v_buyer_wallet,v_seller_wallet,'platform:revenue') order by id for update;
  if exists(select 1 from wallet_accounts where id in(v_buyer_wallet,v_seller_wallet) and status<>'active') then raise exception 'buyer or seller wallet is frozen'; end if;
  if (select balance_cents-reserved_cents from wallet_accounts where id=v_buyer_wallet) < l.price_cents then raise exception 'insufficient available wallet balance'; end if;
  v_fee:=ceil(l.price_cents*0.10)::integer; v_net:=l.price_cents-v_fee;
  if (select balance_cents from wallet_accounts where id=v_seller_wallet)+v_net > 200000 then raise exception 'seller wallet would exceed $2,000.00'; end if;
  insert into wallet_transactions(id,idempotency_key,kind,metadata) values(v_tx,p_idempotency,'sale',jsonb_build_object('listingId',l.id,'assetId',l.pet_seed,'buyerId',p_buyer));
  insert into wallet_entries values(v_tx,0,v_buyer_wallet,-l.price_cents),(v_tx,1,v_seller_wallet,v_net),(v_tx,2,'platform:revenue',v_fee);
  update wallet_accounts set balance_cents=balance_cents-l.price_cents where id=v_buyer_wallet;
  update wallet_accounts set balance_cents=balance_cents+v_net where id=v_seller_wallet;
  update wallet_accounts set balance_cents=balance_cents+v_fee where id='platform:revenue';
  update wild_seed_sources set player_id=p_buyer where pet_seed=l.pet_seed and player_id=l.seller_player_id;
  delete from pet_set_display_selections where player_id=l.seller_player_id and pet_seed=l.pet_seed;
  update collector_book_slots s set pet_seed=null where pet_seed=l.pet_seed and exists(select 1 from collector_books b where b.id=s.book_id and b.player_id=l.seller_player_id);
  update market_listings set status='cancelled',updated_at=now() where pet_seed=l.pet_seed and status='active' and id<>l.id;
  perform cancel_pet_auction(l.pet_seed);
  update market_listings set status='sold',buyer_player_id=p_buyer,updated_at=now() where id=l.id;
  select coalesce(max(sequence),0)+1 into v_seq from pet_ownership_events where pet_seed=l.pet_seed;
  insert into pet_ownership_events(id,pet_seed,sequence,kind,from_player_id,to_player_id,reason,settlement_ref,amount_cents)
    values('own:'||md5(p_idempotency),l.pet_seed,v_seq,'transfer',l.seller_player_id,p_buyer,'sale',p_idempotency,l.price_cents);
  perform enqueue_onchain_transfer('own:'||md5(p_idempotency),l.pet_seed,l.seller_player_id,p_buyer,'sale',p_idempotency);
  perform refresh_pet_inventory(l.seller_player_id); perform refresh_pet_inventory(p_buyer);
  return query select v_tx,l.pet_seed,l.seller_player_id,p_buyer;
end $$`;

// A direct trade is one indivisible database transaction: both fees, every ownership
// move, presentation cleanup, provenance event, and inventory refresh commit together.
await sql`create or replace function settle_market_trade(p_trade text, p_actor text, p_idempotency text)
returns table(out_transaction_id text, out_trade_id text, out_status text) language plpgsql as $$
declare t market_trades%rowtype; v_proposer_wallet text; v_counterparty_wallet text; v_tx text := 'wtx:'||md5(p_idempotency);
  v_existing text; v_existing_meta jsonb; v_fee_each integer := 25; v_total_fee integer; v_seq integer; v_seed text;
  v_offered_count integer; v_requested_count integer;
begin
  select id,metadata into v_existing,v_existing_meta from wallet_transactions where idempotency_key=p_idempotency;
  if found then
    if v_existing_meta->>'tradeId' is distinct from p_trade or v_existing_meta->>'actorId' is distinct from p_actor then raise exception 'idempotency key belongs to another trade'; end if;
    select * into t from market_trades where id=p_trade;
    return query select v_existing,p_trade,t.status; return;
  end if;
  select * into t from market_trades where id=p_trade for update;
  if not found or t.status <> 'pending' or (t.expires_at is not null and t.expires_at <= now()) then raise exception 'trade is not available'; end if;
  if t.counterparty_player_id <> p_actor then raise exception 'only the recipient can accept this trade'; end if;
  if t.proposer_player_id=t.counterparty_player_id then raise exception 'cannot trade with yourself'; end if;
  select jsonb_array_length(t.offered_pet_seeds),jsonb_array_length(t.requested_pet_seeds) into v_offered_count,v_requested_count;
  if v_offered_count < 1 or v_offered_count > 10 or v_requested_count > 10 then raise exception 'trade must contain 1-10 offered pets and at most 10 requested pets'; end if;
  if exists(select 1 from jsonb_array_elements_text(t.offered_pet_seeds) a join jsonb_array_elements_text(t.requested_pet_seeds) b on a.value=b.value) then raise exception 'a pet cannot appear on both sides'; end if;
  if (select count(*) from (select value from jsonb_array_elements_text(t.offered_pet_seeds) group by value) x) <> v_offered_count
    or (select count(*) from (select value from jsonb_array_elements_text(t.requested_pet_seeds) group by value) x) <> v_requested_count then raise exception 'trade contains duplicate pets'; end if;
  perform 1 from wild_seed_sources where pet_seed in (
    select value from jsonb_array_elements_text(t.offered_pet_seeds) union select value from jsonb_array_elements_text(t.requested_pet_seeds)
  ) order by pet_seed for update;
  if (select count(*) from wild_seed_sources where player_id=t.proposer_player_id and pet_seed in (select value from jsonb_array_elements_text(t.offered_pet_seeds))) <> v_offered_count then raise exception 'proposer no longer owns every offered pet'; end if;
  if (select count(*) from wild_seed_sources where player_id=t.counterparty_player_id and pet_seed in (select value from jsonb_array_elements_text(t.requested_pet_seeds))) <> v_requested_count then raise exception 'recipient no longer owns every requested pet'; end if;
  v_proposer_wallet:=ensure_player_wallet(t.proposer_player_id); v_counterparty_wallet:=ensure_player_wallet(t.counterparty_player_id);
  insert into wallet_accounts(id) values('platform:revenue') on conflict(id) do nothing;
  perform 1 from wallet_accounts where id in(v_proposer_wallet,v_counterparty_wallet,'platform:revenue') order by id for update;
  if exists(select 1 from wallet_accounts where id in(v_proposer_wallet,v_counterparty_wallet) and status<>'active') then raise exception 'participant wallet is frozen'; end if;
  if (select balance_cents-reserved_cents from wallet_accounts where id=v_proposer_wallet) < v_fee_each then raise exception 'proposer needs $0.25 available'; end if;
  if v_requested_count > 0 and (select balance_cents-reserved_cents from wallet_accounts where id=v_counterparty_wallet) < v_fee_each then raise exception 'recipient needs $0.25 available'; end if;
  v_total_fee:=case when v_requested_count > 0 then v_fee_each*2 else v_fee_each end;
  insert into wallet_transactions(id,idempotency_key,kind,metadata) values(v_tx,p_idempotency,'trade-fee',jsonb_build_object('tradeId',t.id,'actorId',p_actor));
  insert into wallet_entries values(v_tx,0,v_proposer_wallet,-v_fee_each);
  if v_requested_count > 0 then insert into wallet_entries values(v_tx,1,v_counterparty_wallet,-v_fee_each),(v_tx,2,'platform:revenue',v_total_fee);
  else insert into wallet_entries values(v_tx,1,'platform:revenue',v_total_fee); end if;
  update wallet_accounts set balance_cents=balance_cents-v_fee_each where id=v_proposer_wallet;
  if v_requested_count > 0 then update wallet_accounts set balance_cents=balance_cents-v_fee_each where id=v_counterparty_wallet; end if;
  update wallet_accounts set balance_cents=balance_cents+v_total_fee where id='platform:revenue';
  update wild_seed_sources set player_id=t.counterparty_player_id where player_id=t.proposer_player_id and pet_seed in (select value from jsonb_array_elements_text(t.offered_pet_seeds));
  update wild_seed_sources set player_id=t.proposer_player_id where player_id=t.counterparty_player_id and pet_seed in (select value from jsonb_array_elements_text(t.requested_pet_seeds));
  delete from pet_set_display_selections where (player_id=t.proposer_player_id and pet_seed in (select value from jsonb_array_elements_text(t.offered_pet_seeds)))
    or (player_id=t.counterparty_player_id and pet_seed in (select value from jsonb_array_elements_text(t.requested_pet_seeds)));
  update collector_book_slots s set pet_seed=null where (pet_seed in (select value from jsonb_array_elements_text(t.offered_pet_seeds)) and exists(select 1 from collector_books b where b.id=s.book_id and b.player_id=t.proposer_player_id))
    or (pet_seed in (select value from jsonb_array_elements_text(t.requested_pet_seeds)) and exists(select 1 from collector_books b where b.id=s.book_id and b.player_id=t.counterparty_player_id));
  update market_listings set status='cancelled',updated_at=now() where status='active' and pet_seed in (
    select value from jsonb_array_elements_text(t.offered_pet_seeds) union select value from jsonb_array_elements_text(t.requested_pet_seeds));
  for v_seed in select value from jsonb_array_elements_text(t.offered_pet_seeds) union select value from jsonb_array_elements_text(t.requested_pet_seeds) loop perform cancel_pet_auction(v_seed); end loop;
  for v_seed in select value from jsonb_array_elements_text(t.offered_pet_seeds) loop
    select coalesce(max(sequence),0)+1 into v_seq from pet_ownership_events where pet_seed=v_seed;
    insert into pet_ownership_events(id,pet_seed,sequence,kind,from_player_id,to_player_id,reason,settlement_ref)
      values('own:trade:'||md5(p_idempotency||':'||v_seed),v_seed,v_seq,'transfer',t.proposer_player_id,t.counterparty_player_id,'trade',p_idempotency);
    perform enqueue_onchain_transfer('own:trade:'||md5(p_idempotency||':'||v_seed),v_seed,t.proposer_player_id,t.counterparty_player_id,case when v_requested_count=0 then 'gift' else 'trade' end,p_idempotency);
  end loop;
  for v_seed in select value from jsonb_array_elements_text(t.requested_pet_seeds) loop
    select coalesce(max(sequence),0)+1 into v_seq from pet_ownership_events where pet_seed=v_seed;
    insert into pet_ownership_events(id,pet_seed,sequence,kind,from_player_id,to_player_id,reason,settlement_ref)
      values('own:trade:'||md5(p_idempotency||':'||v_seed),v_seed,v_seq,'transfer',t.counterparty_player_id,t.proposer_player_id,'trade',p_idempotency);
    perform enqueue_onchain_transfer('own:trade:'||md5(p_idempotency||':'||v_seed),v_seed,t.counterparty_player_id,t.proposer_player_id,'trade',p_idempotency);
  end loop;
  update market_trades set status='accepted',updated_at=now(),settled_at=now() where id=t.id;
  perform refresh_pet_inventory(t.proposer_player_id); perform refresh_pet_inventory(t.counterparty_player_id);
  return query select v_tx,t.id,'accepted'::text;
end $$`;

console.log("marketplace wallet, orders, auctions, direct trades, provenance, and atomic settlement installed");
