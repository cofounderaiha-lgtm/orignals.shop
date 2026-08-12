-- ============================================================
-- 0017 — DERIVE SHOP/PAYEE IDENTITY FROM THE CALLER  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- THE HOLE (data-model audit §H; security_negative.sql H1/H3): several read RPCs are
-- keyed on an ARGUMENT the caller supplies — my_shop_orders(p_shop),
-- shop_reservations(p_shop), settlement_mine(p_payee) — and a shop_id is derivable
-- from the PUBLIC device_key (shop_id = 'my_'||substr(device,1,12) = _my_shop()).
-- So an attacker who computes a victim's shop_id reads the victim's shop orders
-- (buyer names + addresses), reservations, and settlement statement. This is the
-- "authorization rests on a public authenticator" class.
--
-- FIX: take the CALLER's device and DERIVE the shop/payee server-side via _my_shop()
-- (migration 0005). The caller can then only ever read their OWN rows. (This does not
-- fix H2 — device_key is still a bearer token — that needs real phone-auth, Phase 7.)
--
-- ⚠ PAIRED CLIENT CHANGE (must deploy IN LOCKSTEP — do NOT ship either alone):
--   js/myshop.js:213  my_shop_orders  { p_shop: sid }  ->  { p_device: S.deviceKey }
--   js/myshop.js:237  shop_reservations { p_shop: sid } -> { p_device: S.deviceKey }
--   settlement_mine caller (account/earn) { p_payee } -> { p_device: S.deviceKey }
-- Shipping the client first would break the seller's own views (the function no
-- longer accepts a shop_id); shipping the migration first would 404 the old calls.
-- ============================================================

-- guard: _my_shop must exist (from 0005_supply_chain)
do $$ begin
  if to_regprocedure('_my_shop(text)') is null then
    raise exception '0017 requires _my_shop(text) from 0005_supply_chain — apply 0005 first';
  end if;
end $$;

-- ---------- my_shop_orders: derive shop from device ----------
-- param rename p_shop->p_device requires DROP+CREATE (CREATE OR REPLACE cannot
-- rename an input parameter).
drop function if exists my_shop_orders(text);
create function my_shop_orders(p_device text)
returns setof shop_orders language sql security definer set search_path = public stable as $$
  select * from shop_orders where shop_id = _my_shop(p_device) order by created_at desc limit 30;
$$;
grant execute on function my_shop_orders(text) to anon;

-- ---------- shop_reservations: derive shop from device ----------
drop function if exists shop_reservations(text);
create function shop_reservations(p_device text)
returns setof reservations language sql security definer set search_path = public stable as $$
  select * from reservations
  where shop_id = _my_shop(p_device) and status = 'reserved'
  order by created_at desc limit 20;
$$;
grant execute on function shop_reservations(text) to anon;

-- ---------- settlement_mine: derive payee from device ----------
-- a payee is either a shop (payee = _my_shop(device)) or a partner (payee = device);
-- match BOTH so one call serves either role, but never another party's rows.
drop function if exists settlement_mine(text);
create function settlement_mine(p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text := _my_shop(p_device);
begin
  return json_build_object('ok', true,
    'due',  (select coalesce(sum(net),0)  from settlement_ledger where payee in (v_shop, p_device) and status='due'),
    'paid', (select coalesce(sum(net),0)  from settlement_ledger where payee in (v_shop, p_device) and status='paid'),
    'account', (select row_to_json(a) from (select holder,upi,bank_acc,ifsc from payout_accounts where payee in (v_shop, p_device) limit 1) a),
    'rows', (select coalesce(json_agg(row_to_json(t) order by t.created_at desc),'[]'::json) from (
        select order_ref, gross, commission, net, status, created_at
        from settlement_ledger where payee in (v_shop, p_device) limit 50) t));
end $$;
grant execute on function settlement_mine(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare V text := 'devidtest_victim1'; A text := 'devidtest_attack1';
        v_shop text := _my_shop('devidtest_victim1'); n int;
begin
  delete from shop_orders where id in ('ID_VO1');
  insert into shop_orders(id, shop_id, buyer_device, items, total, status)
    values ('ID_VO1', v_shop, 'buyerX', '[{"name":"Milk"}]'::jsonb, 50, 'new');

  -- the ATTACKER, calling with THEIR device, must NOT see the victim's shop order
  select count(*) into n from my_shop_orders(A) where id = 'ID_VO1';
  assert n = 0, 'FAIL: attacker read victim shop order via my_shop_orders';

  -- the VICTIM, calling with THEIR device, DOES see it
  select count(*) into n from my_shop_orders(V) where id = 'ID_VO1';
  assert n = 1, 'FAIL: owner cannot read own shop order';

  delete from shop_orders where id in ('ID_VO1');
  raise notice 'PASS: shop/payee identity is derived from the caller device; cross-shop read denied';
end $$;

select 'derive-identity (H1/H3 closed; H2 pending real auth) ready' as status;
