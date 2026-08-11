-- 0011 inventory_reservations — NOT YET APPLIED (written by full-build)
-- ============================================================
-- RESERVATION-AWARE INVENTORY — prevent oversell (P0 transaction integrity)
--
-- The 0005 ledger derives on-hand as sum(delta) per (shop_id, item_name) and
-- 0006 makes the SALE movement idempotent per (shop, item, order ref). That
-- protects against double-DEDUCTION, but not against OVERSELL: between a
-- customer adding the last unit to a cart and the sale actually posting, a
-- second customer can commit to the same unit. Nothing reserved it. Two orders,
-- one unit — the shop is short and one customer is disappointed at handover.
--
-- Fix: a holds layer that sits BETWEEN on-hand and the sale.
--   available(item) = on_hand(sum ledger delta) - sum(active held reservations)
-- stock_reserve() atomically checks availability and, only if EVERY line is
-- available, creates holds — otherwise it creates NONE and fails closed. The
-- check-then-hold is serialized per (shop,item) with a transaction-scoped
-- advisory lock, so two concurrent reserves of the last unit become sequential
-- and exactly one wins. A hold is not a sale: stock_consume() converts holds
-- into the real 0005/0006 sale movement (idempotently, via the existing
-- sl_sale_once index AND the held->consumed transition — belt and suspenders),
-- stock_release() frees them, and reservations_sweep() expires stale holds so a
-- cart abandoned mid-checkout does not sterilize inventory forever.
--
-- Ownership note: unlike the 0005 shop RPCs, the reserving actor is the BUYER
-- (p_device), not the shop — a customer holds stock AT a shop (p_shop). p_shop
-- is therefore a caller-supplied *read target*, not a write to the shop's own
-- protected rows; the only mutation is a hold keyed to the buyer's order, and
-- the oversell invariant (available >= 0) is what actually guards integrity.
--
-- Algorithm progression (anti-cargo-cult): this is the SIMPLEST sufficient
-- stage — synchronous, Postgres-only, correctness by advisory lock. It scales to
-- tens of thousands of users because holds are tiny and short-lived and the hot
-- path touches one small partial index per item. See tail notes for the trigger
-- that would justify the next stage.
-- ============================================================

-- ---------- the holds layer ----------
create table if not exists stock_reservations (
  id         bigint generated always as identity primary key,
  shop_id    text not null,
  item_key   text not null,                 -- normalized lower(trim(name)); matches ledger via lower(item_name)
  qty        int  not null check (qty > 0),
  order_id   text not null,
  device     text,
  status     text not null default 'held',  -- held | consumed | released
  held_at    timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table stock_reservations enable row level security;   -- RPC-only, no policies (SECURITY DEFINER RPCs are the sole access path)

-- one live hold row per (order, item): lets stock_reserve be a re-runnable upsert
create unique index if not exists sr_order_item_uk on stock_reservations (order_id, item_key);
-- hot path: availability = sum(active holds) for a (shop,item)
create index if not exists sr_active_idx on stock_reservations (shop_id, item_key) where status = 'held';
-- sweep path: find expired live holds cheaply
create index if not exists sr_expiry_idx on stock_reservations (expires_at) where status = 'held';

-- ---------- reserve: atomic, all-or-nothing, fails closed ----------
-- p_items: jsonb array of {name, qty}. Returns ok + per-item availability breakdown.
create or replace function stock_reserve(
  p_device text, p_shop text, p_items jsonb, p_order text, p_ttl_secs int)
returns json language plpgsql security definer set search_path=public as $$
declare
  v_ttl   int;
  v_ok    boolean;
  v_items json;
  r       record;
begin
  if coalesce(p_shop,'') = '' then return json_build_object('ok',false,'reason','bad_shop'); end if;
  if coalesce(p_order,'') = '' then return json_build_object('ok',false,'reason','bad_order'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok',false,'reason','no_items'); end if;
  if not exists (select 1 from shops where id = p_shop and deleted_at is null) then
    return json_build_object('ok',false,'reason','no_shop'); end if;

  v_ttl := least(86400, greatest(30, coalesce(p_ttl_secs, 900)));   -- clamp [30s, 24h], default 15m

  -- Serialize concurrent reserves of the same (shop,item). Lock in sorted
  -- item order so two multi-item carts can never deadlock. Transaction-scoped:
  -- released automatically at commit/rollback.
  for r in
    select distinct lower(trim(e->>'name')) item_key
    from jsonb_array_elements(p_items) e
    where coalesce(trim(e->>'name'),'') <> ''
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(p_shop || chr(31) || r.item_key));
  end loop;

  -- Compute per-item availability under the locks. Exclude THIS order's own
  -- existing holds so a re-run (retry / cart edit) does not count itself short.
  with req as (
    select lower(trim(e->>'name')) item_key,
           greatest(1, ceil(abs(coalesce((e->>'qty')::numeric, 1)))::int) qty
    from jsonb_array_elements(p_items) e
    where coalesce(trim(e->>'name'),'') <> ''
  ),
  req2 as (select item_key, sum(qty)::int qty from req group by item_key),
  calc as (
    select r2.item_key, r2.qty needed,
      coalesce((select sum(l.delta) from stock_ledger l
                 where l.shop_id = p_shop and lower(l.item_name) = r2.item_key), 0)::numeric on_hand,
      coalesce((select sum(h.qty) from stock_reservations h
                 where h.shop_id = p_shop and h.item_key = r2.item_key
                   and h.status = 'held' and h.expires_at > now()
                   and h.order_id <> p_order), 0)::numeric held
    from req2 r2
  ),
  calc2 as (
    select item_key, needed, on_hand, held, (on_hand - held) available,
           ((on_hand - held) >= needed) ok
    from calc
  )
  select bool_and(ok),
         coalesce(json_agg(json_build_object(
           'item', item_key, 'needed', needed, 'on_hand', on_hand,
           'held', held, 'available', available, 'ok', ok) order by item_key), '[]'::json)
  into v_ok, v_items
  from calc2;

  if v_ok is null then
    return json_build_object('ok',false,'reason','no_items');
  end if;

  if not v_ok then
    -- FAIL CLOSED: create no holds at all when any line is short.
    return json_build_object('ok',false,'reason','insufficient_stock','order',p_order,'items',v_items);
  end if;

  -- All available: create/refresh holds. Upsert keeps reserve idempotent per order.
  insert into stock_reservations(shop_id, item_key, qty, order_id, device, status, held_at, expires_at)
  select p_shop, item_key, sum(qty)::int, p_order, p_device, 'held', now(), now() + make_interval(secs => v_ttl)
  from (
    select lower(trim(e->>'name')) item_key,
           greatest(1, ceil(abs(coalesce((e->>'qty')::numeric, 1)))::int) qty
    from jsonb_array_elements(p_items) e
    where coalesce(trim(e->>'name'),'') <> ''
  ) s
  group by item_key
  on conflict (order_id, item_key) do update
    set qty = excluded.qty, status = 'held', held_at = now(), expires_at = excluded.expires_at, device = excluded.device;

  return json_build_object('ok',true,'order',p_order,'ttl_secs',v_ttl,'items',v_items);
exception when others then
  return json_build_object('ok',false,'reason','error','detail',sqlerrm);
end $$;

-- ---------- consume: holds become a real ledger sale (idempotent) ----------
-- Reuses the 0005/0006 'sale' movement + sl_sale_once index. Also idempotent by
-- construction: only 'held' rows are consumed, and the held->consumed transition
-- means a second call finds nothing to post. Never double-deducts.
create or replace function stock_consume(p_order text)
returns json language plpgsql security definer set search_path=public as $$
declare v_rows int := 0; v_holds int := 0;
begin
  if coalesce(p_order,'') = '' then return json_build_object('ok',false,'reason','bad_order'); end if;

  with h as (
    select shop_id, item_key, qty
    from stock_reservations
    where order_id = p_order and status = 'held'
  ),
  ins as (
    insert into stock_ledger(shop_id, item_name, delta, reason, ref)
    select shop_id, item_key, -abs(qty), 'sale', left(p_order, 40) from h
    on conflict do nothing            -- sl_sale_once: same order twice = one deduction
    returning 1
  )
  select count(*) from ins into v_rows;

  update stock_reservations set status = 'consumed'
   where order_id = p_order and status = 'held';
  get diagnostics v_holds = row_count;

  return json_build_object('ok',true,'order',p_order,'sale_rows',v_rows,'holds_consumed',v_holds);
exception when others then
  return json_build_object('ok',false,'reason','error','detail',sqlerrm);
end $$;

-- ---------- release: free a hold (cancel / reject / cart clear) ----------
create or replace function stock_release(p_order text)
returns json language plpgsql security definer set search_path=public as $$
declare v_n int := 0;
begin
  if coalesce(p_order,'') = '' then return json_build_object('ok',false,'reason','bad_order'); end if;
  update stock_reservations set status = 'released'
   where order_id = p_order and status = 'held';
  get diagnostics v_n = row_count;
  return json_build_object('ok',true,'order',p_order,'released',v_n);
exception when others then
  return json_build_object('ok',false,'reason','error','detail',sqlerrm);
end $$;

-- ---------- sweep: expire stale holds (call from cron/edge, e.g. every minute) ----------
create or replace function reservations_sweep()
returns json language plpgsql security definer set search_path=public as $$
declare v_n int := 0;
begin
  update stock_reservations set status = 'released'
   where status = 'held' and expires_at <= now();
  get diagnostics v_n = row_count;
  return json_build_object('ok',true,'expired',v_n);
exception when others then
  return json_build_object('ok',false,'reason','error','detail',sqlerrm);
end $$;

-- ---------- read-only availability probe (client can show "only N left") ----------
create or replace function stock_available(p_shop text, p_items jsonb)
returns json language plpgsql security definer set search_path=public as $$
begin
  if coalesce(p_shop,'') = '' or p_items is null or jsonb_typeof(p_items) <> 'array' then
    return json_build_object('ok',false,'reason','bad_input'); end if;
  return json_build_object('ok',true,'shop',p_shop,'items',
    (with req as (
       select distinct lower(trim(e->>'name')) item_key
       from jsonb_array_elements(p_items) e
       where coalesce(trim(e->>'name'),'') <> ''
     )
     select coalesce(json_agg(json_build_object(
       'item', r.item_key,
       'on_hand', coalesce((select sum(l.delta) from stock_ledger l
                             where l.shop_id = p_shop and lower(l.item_name) = r.item_key),0),
       'held', coalesce((select sum(h.qty) from stock_reservations h
                          where h.shop_id = p_shop and h.item_key = r.item_key
                            and h.status='held' and h.expires_at > now()),0),
       'available', coalesce((select sum(l.delta) from stock_ledger l
                               where l.shop_id = p_shop and lower(l.item_name) = r.item_key),0)
                    - coalesce((select sum(h.qty) from stock_reservations h
                                where h.shop_id = p_shop and h.item_key = r.item_key
                                  and h.status='held' and h.expires_at > now()),0)
       ) order by r.item_key), '[]'::json)
     from req r));
exception when others then return json_build_object('ok',false,'reason','error','detail',sqlerrm); end $$;

grant execute on function stock_reserve(text,text,jsonb,text,int) to anon;
grant execute on function stock_consume(text)                     to anon;
grant execute on function stock_release(text)                     to anon;
grant execute on function reservations_sweep()                    to anon;
grant execute on function stock_available(text,jsonb)             to anon;

-- ============================================================
-- SELF-PROOF: sequential last-unit contention -> exactly one hold wins,
-- fail-closed on shortfall, consume posts exactly one sale, idempotency,
-- release + sweep. Inserts temp rows, asserts, then deletes them.
-- ============================================================
do $$
declare
  v_shop  text := 'my_selftst0011';
  v_dev_a text := 'dev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  v_dev_b text := 'dev_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  v_ord_a text := 'selftest0011_A';
  v_ord_b text := 'selftest0011_B';
  v_ord_c text := 'selftest0011_C';
  v_item  text := 'SelfTest Widget';           -- reserve normalizes to lower(trim(...))
  v_items jsonb := jsonb_build_array(jsonb_build_object('name', v_item, 'qty', 1));
  j       json;
  v_onhand numeric;
  v_sales  int;
begin
  -- fixture: a shop with exactly ONE unit on hand
  insert into shops(id, name, category) values (v_shop, 'Self Test Shop', 'grocery')
    on conflict (id) do nothing;
  insert into stock_ledger(shop_id, item_name, delta, reason, ref)
    values (v_shop, v_item, 1, 'adjust', 'selftest0011_seed');

  -- 1) order A reserves the last unit -> ok
  j := stock_reserve(v_dev_a, v_shop, v_items, v_ord_a, 600);
  assert (j->>'ok')::boolean, 'FAIL: first reserve of last unit should succeed: ' || j::text;

  -- 2) order B reserves the SAME last unit -> fails CLOSED (A holds it).
  --    Under real concurrency the advisory lock serializes A and B into exactly
  --    this order; the loser sees available=0. Exactly one hold wins.
  j := stock_reserve(v_dev_b, v_shop, v_items, v_ord_b, 600);
  assert not (j->>'ok')::boolean, 'FAIL: second reserve of last unit must fail (oversell): ' || j::text;
  assert (j->>'reason') = 'insufficient_stock', 'FAIL: wrong reason on shortfall: ' || j::text;
  assert not exists (select 1 from stock_reservations where order_id = v_ord_b),
    'FAIL: failed reserve must create NO holds (fail closed)';

  -- 3) reserve is idempotent: A re-runs -> still exactly one held row for A
  j := stock_reserve(v_dev_a, v_shop, v_items, v_ord_a, 600);
  assert (j->>'ok')::boolean, 'FAIL: idempotent re-reserve should still succeed';
  assert (select count(*) from stock_reservations where order_id = v_ord_a and status='held') = 1,
    'FAIL: re-reserve must not duplicate the hold';

  -- 4) consume A -> exactly one sale movement, on_hand drops to 0, hold consumed
  j := stock_consume(v_ord_a);
  assert (j->>'ok')::boolean, 'FAIL: consume should succeed';
  assert (j->>'sale_rows')::int = 1, 'FAIL: consume should post exactly one sale row: ' || j::text;
  select coalesce(sum(delta),0) into v_onhand from stock_ledger where shop_id=v_shop and lower(item_name)=lower(v_item);
  assert v_onhand = 0, 'FAIL: on_hand should be 0 after consuming the last unit, got ' || v_onhand;
  assert (select status from stock_reservations where order_id=v_ord_a) = 'consumed',
    'FAIL: hold should be marked consumed';

  -- 5) consume is idempotent: second call posts no new sale (no double-deduct)
  j := stock_consume(v_ord_a);
  assert (j->>'sale_rows')::int = 0, 'FAIL: re-consume must not post another sale: ' || j::text;
  select count(*) into v_sales from stock_ledger where shop_id=v_shop and reason='sale' and ref=v_ord_a;
  assert v_sales = 1, 'FAIL: exactly one sale row must exist for the order, got ' || v_sales;

  -- 6) release frees a live hold; sweep expires a stale one
  insert into stock_ledger(shop_id, item_name, delta, reason, ref) values (v_shop, v_item, 5, 'adjust', 'selftest0011_restock');
  j := stock_reserve(v_dev_b, v_shop, jsonb_build_array(jsonb_build_object('name',v_item,'qty',2)), v_ord_c, 600);
  assert (j->>'ok')::boolean, 'FAIL: reserve after restock should succeed: ' || j::text;
  j := stock_release(v_ord_c);
  assert (j->>'released')::int = 1, 'FAIL: release should free the hold: ' || j::text;
  -- stale hold -> sweep releases it
  insert into stock_reservations(shop_id,item_key,qty,order_id,device,status,expires_at)
    values (v_shop, lower(v_item), 1, 'selftest0011_stale', v_dev_b, 'held', now() - interval '1 minute');
  j := reservations_sweep();
  assert (j->>'expired')::int >= 1, 'FAIL: sweep should expire the stale hold: ' || j::text;
  assert (select status from stock_reservations where order_id='selftest0011_stale') = 'released',
    'FAIL: swept hold should be released';

  -- cleanup
  delete from stock_reservations where order_id in (v_ord_a, v_ord_b, v_ord_c, 'selftest0011_stale');
  delete from stock_ledger where shop_id = v_shop;
  delete from shops where id = v_shop;

  raise notice 'PASS: 0011 inventory_reservations — oversell prevented, fail-closed, idempotent consume, release+sweep verified';
end $$;

select '0011_inventory_reservations ready' as status;
