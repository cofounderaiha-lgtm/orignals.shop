-- ============================================================
-- 0027 — CONNECTED ORDER (unified lifecycle assembler)  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §1: "an order must not be an isolated database
--   record." Orignals now has many subsystems (payment, reservation, status events,
--   dispatch, settlement, double-entry ledger, refund) — this proves they are ONE
--   connected order, not silos. order_full() assembles the COMPLETE lifecycle of an
--   order from every subsystem, device-scoped (buyer OR owning shop). It is the
--   single source of truth for customer tracking, the merchant console, and support
--   (§30 "agents should see the entire order context").
-- ============================================================
create or replace function order_full(p_order text, p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_buyer text;
begin
  select shop_id, buyer_device into v_shop, v_buyer from shop_orders where id = p_order;
  if v_shop is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  -- authorize: the buyer who placed it, or the owning shop — nobody else
  if p_device <> coalesce(v_buyer, '') and v_shop <> _my_shop(p_device) then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return json_build_object('ok', true,
    'order', (select row_to_json(o) from (
        select id, shop_id, buyer_name, total, status, created_at, updated_at
        from shop_orders where id = p_order) o),
    'payment', (select row_to_json(p) from (
        select status, amount_paise/100.0 as amount, rzp_payment_id, verified_at
        from payments where ref = p_order order by verified_at desc nulls last limit 1) p),
    'reservations', coalesce((select json_agg(json_build_object('item', item_name, 'qty', qty, 'status', status))
        from stock_reservations where order_ref = p_order), '[]'::json),
    'timeline', coalesce((select json_agg(json_build_object('at', at, 'actor', actor, 'from', from_status, 'to', to_status, 'note', note) order by at)
        from shop_order_events where order_id = p_order), '[]'::json),
    'delivery', (select row_to_json(d) from (
        select taken_name, taken_veh, status, picked_at, partner_lat, partner_lng
        from live_jobs where order_ref = p_order limit 1) d),
    'settlement', (select row_to_json(s) from (
        select net, commission, status, paid_at from settlement_ledger where order_ref = p_order limit 1) s),
    'ledger', coalesce((select json_agg(json_build_object('kind', kind, 'memo', memo, 'at', at) order by at)
        from ledger_journals where order_ref = p_order), '[]'::json),
    'refund', (select row_to_json(r) from (
        select status, amount_paise/100.0 as amount, rzp_refund_id
        from refunds where order_ref = p_order order by created_at desc limit 1) r));
exception when others then return json_build_object('ok', false, 'reason', 'error'); end $$;
grant execute on function order_full(text, text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('ofdev0000001'); v_dev text := 'of_buyer_0001'; j json;
begin
  delete from ledger_journals where order_ref='OF_O1'; delete from settlement_ledger where order_ref='OF_O1';
  delete from payments where ref='OF_O1'; delete from shop_orders where id='OF_O1';

  -- run a real order through the connected subsystems
  insert into shop_orders(id, shop_id, buyer_device, buyer_name, items, total, status)
    values ('OF_O1', v_shop, v_dev, 'Test Buyer', '[{"name":"Milk","q":1}]'::jsonb, 100, 'new');   -- genesis event (0009 trigger)
  insert into payments(rzp_order_id, rzp_payment_id, amount_paise, ref, status, verified_at)
    values ('of_ord1','of_pay1',10000,'OF_O1','verified', now());                                   -- payment
  -- accept + deliver via the real state machine (logs events + fires the settlement trigger)
  perform shop_order_status('OF_O1', 'ofdev0000001', 'prep');
  perform shop_order_status('OF_O1', 'ofdev0000001', 'done');
  perform ledger_sync_order('OF_O1');                                                               -- double-entry

  -- the connected order assembles every subsystem
  j := order_full('OF_O1', v_dev);
  assert (j->>'ok')='true', 'FAIL: order_full denied to buyer';
  assert (j->'order'->>'id')='OF_O1', 'FAIL: order block missing';
  assert (j->'payment'->>'status')='verified', 'FAIL: payment not connected';
  assert (j->'settlement'->>'net') is not null, 'FAIL: settlement not connected';
  assert json_array_length(j->'ledger') >= 1, 'FAIL: ledger not connected';
  assert json_array_length(j->'timeline') >= 1, 'FAIL: timeline not connected';

  -- a stranger cannot read the order
  assert (order_full('OF_O1', 'stranger999')->>'ok')='false', 'FAIL: stranger read the order';
  -- the owning shop can
  assert (order_full('OF_O1', 'ofdev0000001')->>'ok')='true', 'FAIL: owning shop denied';

  delete from ledger_journals where order_ref='OF_O1'; delete from settlement_ledger where order_ref='OF_O1';
  delete from payments where ref='OF_O1'; delete from shop_orders where id='OF_O1';
  raise notice 'PASS: order_full connects order+payment+settlement+ledger+timeline; owner-scoped';
end $$;

select 'connected order (order_full) ready' as status;
