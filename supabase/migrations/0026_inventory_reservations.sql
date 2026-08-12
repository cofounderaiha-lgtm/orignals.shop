-- ============================================================
-- 0026 — INVENTORY RESERVATIONS (oversell prevention)  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. The audit found checkout has no reservation → the last unit
--   can be sold twice. The earlier agent draft (0012, DELETED) got this wrong:
--   item_name casing mismatched stock_ledger, anon RPCs derived no ownership, and it
--   would fail-closed for every shop (none track on_hand). This version fixes all of
--   that:
--     · OPT-IN per product: shop_items.track_inventory (default FALSE → unlimited, so
--       nothing breaks; a shop turns tracking on for the SKUs it actually counts).
--     · available = on_hand (stock_ledger sum) − active holds, keyed on item_name in
--       the SAME representation stock_sell writes (left(name,80)).
--     · atomic: advisory lock per shop, then check-ALL-then-hold-ALL.
--     · no double-deduct: a hold is only a checkout gate; the EXISTING stock_sell
--       (0006) still records the sale on delivery; commit/release just stop the hold
--       counting. TTL sweep frees abandoned holds.
-- ============================================================

alter table shop_items add column if not exists track_inventory boolean not null default false;

create table if not exists stock_reservations (
  id         bigint generated always as identity primary key,
  shop_id    text not null,
  item_name  text not null,               -- matches stock_ledger.item_name representation
  order_ref  text not null,
  device_key text,
  qty        numeric not null check (qty >= 0),
  status     text not null default 'held',-- held | committed | released
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index if not exists sr_once on stock_reservations(order_ref, item_name);
create index if not exists sr_avail_idx on stock_reservations(shop_id, item_name) where status = 'held';
alter table stock_reservations enable row level security;   -- writes via the RPCs below

-- available-to-sell = on_hand − active holds (both keyed on item_name)
create or replace function _stock_available(p_shop text, p_item_name text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(delta) from stock_ledger where shop_id = p_shop and item_name = p_item_name), 0)
       - coalesce((select sum(qty) from stock_reservations
                   where shop_id = p_shop and item_name = p_item_name and status = 'held' and expires_at > now()), 0);
$$;

-- reserve stock for an order at checkout. Untracked items are unlimited (ok). For
-- tracked items, ALL must have availability or NONE are held. Idempotent per order.
create or replace function stock_reserve(p_device text, p_order text, p_shop text, p_items jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare it jsonb; v_name text; v_qty numeric; v_tracked boolean; short jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' then return json_build_object('ok', false, 'reason', 'bad_items'); end if;
  perform pg_advisory_xact_lock(hashtext('resv:' || p_shop));       -- serialize this shop's reservations

  -- pass 1: every TRACKED item must have enough (adding back THIS order's own hold so
  -- a re-reserve of the same quantity is idempotent, not a false shortage)
  for it in select value from jsonb_array_elements(p_items) loop
    v_name := left(it->>'name', 80); v_qty := greatest(coalesce((it->>'qty')::numeric, 1), 0);
    select coalesce(track_inventory, false) into v_tracked from shop_items where shop_id = p_shop and name = v_name limit 1;
    if coalesce(v_tracked, false) and v_qty > 0 then
      if (_stock_available(p_shop, v_name)
          + coalesce((select sum(qty) from stock_reservations
                      where order_ref = p_order and item_name = v_name and status = 'held' and expires_at > now()), 0)
         ) < v_qty then
        short := short || jsonb_build_array(jsonb_build_object('name', v_name, 'need', v_qty));
      end if;
    end if;
  end loop;
  if jsonb_array_length(short) > 0 then
    return json_build_object('ok', false, 'reason', 'insufficient_stock', 'items', short);
  end if;

  -- pass 2: (re)create holds for tracked items
  for it in select value from jsonb_array_elements(p_items) loop
    v_name := left(it->>'name', 80); v_qty := greatest(coalesce((it->>'qty')::numeric, 1), 0);
    select coalesce(track_inventory, false) into v_tracked from shop_items where shop_id = p_shop and name = v_name limit 1;
    if coalesce(v_tracked, false) and v_qty > 0 then
      insert into stock_reservations(shop_id, item_name, order_ref, device_key, qty, status, expires_at)
      values (p_shop, v_name, p_order, p_device, v_qty, 'held', now() + interval '15 minutes')
      on conflict (order_ref, item_name) do update set
        qty = excluded.qty, status = 'held', expires_at = excluded.expires_at, device_key = excluded.device_key;
    end if;
  end loop;
  return json_build_object('ok', true);
end $$;
grant execute on function stock_reserve(text, text, text, jsonb) to anon;

-- release an order's holds (cancel / abandonment). Buyer OR the owning shop may release.
create or replace function stock_release(p_device text, p_order text)
returns json language plpgsql security definer set search_path = public as $$
begin
  update stock_reservations set status = 'released'
   where order_ref = p_order and status = 'held'
     and (device_key = p_device or shop_id = _my_shop(p_device));
  return json_build_object('ok', true);
end $$;
grant execute on function stock_release(text, text) to anon;

-- commit an order's holds on fulfilment (the owning shop). The sale itself is still
-- recorded by stock_sell (0006); this only stops the hold counting against available.
create or replace function stock_commit(p_device text, p_order text)
returns json language plpgsql security definer set search_path = public as $$
begin
  update stock_reservations set status = 'committed'
   where order_ref = p_order and status = 'held' and shop_id = _my_shop(p_device);
  return json_build_object('ok', true);
end $$;
grant execute on function stock_commit(text, text) to anon;

-- pg_cron: free abandoned holds past their TTL
create or replace function reservations_sweep()
returns json language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update stock_reservations set status = 'released' where status = 'held' and expires_at <= now();
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'freed', n);
end $$;

-- PAIRED CLIENT CHANGE (when staged): shops.js checkout → rpc/stock_reserve before
-- confirming (block on insufficient_stock); myshop delivery → rpc/stock_commit; cancel
-- → rpc/stock_release; pg_cron → reservations_sweep every minute. Untracked products
-- are unaffected. STAGE-2 note: stock_reserve trusts p_shop; tie anti-griefing to a
-- real order + rate-limit when real auth (Phase 7) lands.

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('invdev000001'); r json;
begin
  delete from stock_reservations where shop_id = v_shop;
  delete from stock_ledger where shop_id = v_shop;
  delete from shop_items where shop_id = v_shop;
  delete from shops where id = v_shop;

  insert into shops(id, name, category, delivery, rating) values (v_shop, 'Inv Test', 'grocery', 'both', 5.0);
  insert into shop_items(id, shop_id, name, price, track_inventory) values
    ('INV_MILK', v_shop, 'Milk', 30, true),      -- tracked
    ('INV_SALT', v_shop, 'Salt', 10, false);     -- NOT tracked (unlimited)
  insert into stock_ledger(shop_id, item_name, delta, reason) values (v_shop, 'Milk', 5, 'purchase');  -- on_hand 5

  -- reserve 3 for order A → ok; 2 remain
  r := stock_reserve('buyerA', 'INV_OA', v_shop, '[{"name":"Milk","qty":3}]'::jsonb);
  assert (r->>'ok')='true', 'FAIL: reserve A';
  assert _stock_available(v_shop,'Milk') = 2, 'FAIL: available != 2, got '||_stock_available(v_shop,'Milk');

  -- order B wants 3 → OVERSELL blocked (only 2 available)
  r := stock_reserve('buyerB', 'INV_OB', v_shop, '[{"name":"Milk","qty":3}]'::jsonb);
  assert (r->>'ok')='false' and (r->>'reason')='insufficient_stock', 'FAIL: oversell not blocked';

  -- order B takes the remaining 2 → ok; now 0 available
  r := stock_reserve('buyerB', 'INV_OB', v_shop, '[{"name":"Milk","qty":2}]'::jsonb);
  assert (r->>'ok')='true', 'FAIL: reserve B 2';
  assert _stock_available(v_shop,'Milk') = 0, 'FAIL: available != 0 after B';

  -- re-reserving B the same 2 is idempotent (still ok, still 0), not a false shortage
  r := stock_reserve('buyerB', 'INV_OB', v_shop, '[{"name":"Milk","qty":2}]'::jsonb);
  assert (r->>'ok')='true', 'FAIL: idempotent re-reserve';
  assert (select count(*) from stock_reservations where order_ref='INV_OB' and status='held') = 1, 'FAIL: duplicate hold';

  -- untracked item is always reservable (unlimited)
  r := stock_reserve('buyerC', 'INV_OC', v_shop, '[{"name":"Salt","qty":999}]'::jsonb);
  assert (r->>'ok')='true', 'FAIL: untracked item blocked';
  assert (select count(*) from stock_reservations where order_ref='INV_OC') = 0, 'FAIL: untracked created a hold';

  -- release A → its 3 free up → available back to 3
  r := stock_release('buyerA', 'INV_OA');
  assert _stock_available(v_shop,'Milk') = 3, 'FAIL: release did not free stock, got '||_stock_available(v_shop,'Milk');

  -- sweep releases expired holds (force-expire B)
  update stock_reservations set expires_at = now() - interval '1 minute' where order_ref = 'INV_OB';
  r := reservations_sweep();
  assert _stock_available(v_shop,'Milk') = 5, 'FAIL: sweep did not free expired hold, got '||_stock_available(v_shop,'Milk');

  delete from stock_reservations where shop_id = v_shop;
  delete from stock_ledger where shop_id = v_shop;
  delete from shop_items where shop_id = v_shop;
  delete from shops where id = v_shop;
  raise notice 'PASS: oversell blocked, idempotent, untracked-unlimited, release + TTL-sweep free stock';
end $$;

select 'inventory reservations ready' as status;
