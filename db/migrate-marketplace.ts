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
  created_at timestamp not null default now(), expires_at timestamp
)`;
await sql`create index if not exists market_buy_orders_browse_idx on market_buy_orders(status, price_cents desc, created_at)`;
await sql`create table if not exists market_auctions (
  id text primary key, pet_seed text not null, seller_player_id text not null references players(id) on delete restrict,
  start_cents integer not null check (start_cents between 100 and 180000), reserve_cents integer,
  status text not null default 'active' check (status in ('active','settled','cancelled','expired')),
  ends_at timestamp not null, created_at timestamp not null default now()
)`;
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
await sql`create trigger ownership_events_immutable before update or delete on pet_ownership_events for each row execute function reject_ledger_mutation()`;

await sql`create or replace function ensure_player_wallet(p_player_id text) returns text language plpgsql as $$
declare v_id text := 'wallet:' || p_player_id;
begin
  insert into wallet_accounts(id, player_id) values(v_id, p_player_id) on conflict(id) do nothing;
  return v_id;
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
  update market_auctions set status='cancelled' where pet_seed=l.pet_seed and status='active';
  update market_listings set status='sold',buyer_player_id=p_buyer,updated_at=now() where id=l.id;
  select coalesce(max(sequence),0)+1 into v_seq from pet_ownership_events where pet_seed=l.pet_seed;
  insert into pet_ownership_events(id,pet_seed,sequence,kind,from_player_id,to_player_id,reason,settlement_ref,amount_cents)
    values('own:'||md5(p_idempotency),l.pet_seed,v_seq,'transfer',l.seller_player_id,p_buyer,'sale',p_idempotency,l.price_cents);
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
  update market_auctions set status='cancelled' where status='active' and pet_seed in (
    select value from jsonb_array_elements_text(t.offered_pet_seeds) union select value from jsonb_array_elements_text(t.requested_pet_seeds));
  for v_seed in select value from jsonb_array_elements_text(t.offered_pet_seeds) loop
    select coalesce(max(sequence),0)+1 into v_seq from pet_ownership_events where pet_seed=v_seed;
    insert into pet_ownership_events(id,pet_seed,sequence,kind,from_player_id,to_player_id,reason,settlement_ref)
      values('own:trade:'||md5(p_idempotency||':'||v_seed),v_seed,v_seq,'transfer',t.proposer_player_id,t.counterparty_player_id,'trade',p_idempotency);
  end loop;
  for v_seed in select value from jsonb_array_elements_text(t.requested_pet_seeds) loop
    select coalesce(max(sequence),0)+1 into v_seq from pet_ownership_events where pet_seed=v_seed;
    insert into pet_ownership_events(id,pet_seed,sequence,kind,from_player_id,to_player_id,reason,settlement_ref)
      values('own:trade:'||md5(p_idempotency||':'||v_seed),v_seed,v_seq,'transfer',t.counterparty_player_id,t.proposer_player_id,'trade',p_idempotency);
  end loop;
  update market_trades set status='accepted',updated_at=now(),settled_at=now() where id=t.id;
  perform refresh_pet_inventory(t.proposer_player_id); perform refresh_pet_inventory(t.counterparty_player_id);
  return query select v_tx,t.id,'accepted'::text;
end $$`;

console.log("marketplace wallet, orders, auctions, direct trades, provenance, and atomic settlement installed");
