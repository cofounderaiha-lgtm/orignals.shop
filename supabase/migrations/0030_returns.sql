-- ============================================================
-- 0030 — RETURNS & REVERSE LOGISTICS  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §29: return request → eligibility → approval →
--   pickup → inspection → refund → restock, with explicit policy rules and a state
--   machine. INTEGRATED: on 'refunded' it creates a real refund (0015) + voids the
--   seller settlement; on 'restocked' it adds stock back to the ledger (0005). Buyer
--   requests (device-scoped, delivered + in window); the owning shop drives the rest.
-- ============================================================
create table if not exists returns (
  id         text primary key,
  order_ref  text not null,
  shop_id    text not null,
  device_key text not null,             -- buyer
  items      jsonb,
  reason     text,
  status     text not null default 'requested',  -- requested|approved|rejected|picked_up|inspected|refunded|restocked|closed
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ret_order_idx on returns(order_ref);
create index if not exists ret_shop_idx  on returns(shop_id, created_at desc);
-- at most one ACTIVE return per order
create unique index if not exists ret_one_active on returns(order_ref) where status not in ('rejected','closed');
alter table returns enable row level security;

-- valid transitions (shop-driven after the buyer requests)
create or replace function _return_transition_ok(p_from text, p_to text)
returns boolean language sql immutable as $$
  select case p_from
    when 'requested' then p_to in ('approved','rejected')
    when 'approved'  then p_to in ('picked_up','rejected')
    when 'picked_up' then p_to in ('inspected','rejected')
    when 'inspected' then p_to in ('refunded','rejected')
    when 'refunded'  then p_to in ('restocked','closed')
    when 'restocked' then p_to in ('closed')
    else false end;                     -- rejected/closed terminal
$$;

-- buyer requests a return: must own the DELIVERED order, within a 7-day window
create or replace function return_request(p_device text, p_order text, p_items jsonb, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare v_shop text; v_buyer text; v_status text; v_when timestamptz; v_id text;
begin
  select shop_id, buyer_device, status, updated_at into v_shop, v_buyer, v_status, v_when
    from shop_orders where id = p_order;
  if v_shop is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_buyer <> p_device then return json_build_object('ok', false, 'reason', 'not_your_order'); end if;
  if v_status <> 'done' then return json_build_object('ok', false, 'reason', 'not_delivered'); end if;
  if v_when < now() - interval '7 days' then return json_build_object('ok', false, 'reason', 'window_closed'); end if;

  v_id := 'ret_' || p_order;
  insert into returns(id, order_ref, shop_id, device_key, items, reason, status)
  values (v_id, p_order, v_shop, p_device, p_items, left(coalesce(p_reason,''),200), 'requested')
  on conflict (id) do nothing;
  if not found then return json_build_object('ok', false, 'reason', 'already_requested'); end if;
  return json_build_object('ok', true, 'return', v_id);
end $$;
grant execute on function return_request(text, text, jsonb, text) to anon;

-- shop approves or rejects a requested return
create or replace function return_decide(p_device text, p_return text, p_approve boolean, p_note text)
returns json language plpgsql security definer set search_path = public as $$
declare v_shop text; v_status text;
begin
  select shop_id, status into v_shop, v_status from returns where id = p_return;
  if v_shop is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_shop <> _my_shop(p_device) then return json_build_object('ok', false, 'reason', 'not_your_shop'); end if;
  if v_status <> 'requested' then return json_build_object('ok', false, 'reason', 'not_pending'); end if;
  update returns set status = case when p_approve then 'approved' else 'rejected' end,
                     note = left(coalesce(p_note,''),200), updated_at = now()
   where id = p_return;
  return json_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;
grant execute on function return_decide(text, text, boolean, text) to anon;

-- shop advances the return; side effects on 'refunded' (real refund) and 'restocked' (add stock)
create or replace function return_advance(p_device text, p_return text, p_status text)
returns json language plpgsql security definer set search_path = public as $$
declare r record; v_pay text; v_amt bigint; it jsonb;
begin
  select * into r from returns where id = p_return for update;
  if r.id is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.shop_id <> _my_shop(p_device) then return json_build_object('ok', false, 'reason', 'not_your_shop'); end if;
  if not _return_transition_ok(r.status, p_status) then return json_build_object('ok', false, 'reason', 'bad_transition', 'from', r.status); end if;

  if p_status = 'refunded' then
    -- create a real refund for the order's verified payment (nothing to refund for COD)
    select rzp_payment_id, amount_paise into v_pay, v_amt from payments where ref = r.order_ref and status = 'verified'
      order by verified_at desc nulls last limit 1;
    if v_pay is not null then
      insert into refunds(order_ref, device_key, rzp_payment_id, amount_paise, reason, status, idempotency_key)
      values (r.order_ref, r.device_key, v_pay, v_amt, 'return', 'requested', 'rf_' || r.order_ref)
      on conflict (idempotency_key) do update set status = 'requested', updated_at = now() where refunds.status = 'failed';
      perform _fin_event('refund_requested', r.order_ref, null, v_amt/100.0, v_pay, jsonb_build_object('via','return'));
      perform _settlement_void(r.order_ref, 'return');
    end if;
  elsif p_status = 'restocked' then
    -- returned goods go back on the shelf
    if jsonb_typeof(r.items) = 'array' then
      for it in select value from jsonb_array_elements(r.items) loop
        insert into stock_ledger(shop_id, item_name, delta, reason)
        values (r.shop_id, left(it->>'name',80), greatest(coalesce((it->>'qty')::numeric,1),0), 'return');
      end loop;
    end if;
  end if;

  update returns set status = p_status, updated_at = now() where id = p_return;
  return json_build_object('ok', true, 'status', p_status);
end $$;
grant execute on function return_advance(text, text, text) to anon;

create or replace function my_returns(p_device text)
returns setof returns language sql security definer set search_path = public stable as $$
  select * from returns where device_key = p_device order by created_at desc limit 30;
$$;
grant execute on function my_returns(text) to anon;

create or replace function shop_returns(p_device text)
returns setof returns language sql security definer set search_path = public stable as $$
  select * from returns where shop_id = _my_shop(p_device) order by created_at desc limit 50;
$$;
grant execute on function shop_returns(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('retdev0000001'); v_dev text := 'ret_buyer_001'; r json; v_ret text;
begin
  delete from returns where order_ref='RT_O1'; delete from refunds where order_ref='RT_O1';
  delete from settlement_ledger where order_ref='RT_O1'; delete from stock_ledger where shop_id=v_shop;
  delete from payments where ref='RT_O1'; delete from shop_orders where id='RT_O1'; delete from shops where id=v_shop;

  insert into shops(id,name,category) values (v_shop,'Return Mart','grocery');
  insert into shop_orders(id,shop_id,buyer_device,items,total,status) values ('RT_O1',v_shop,v_dev,'[{"name":"Milk","qty":2}]'::jsonb,100,'new');
  insert into payments(rzp_order_id,rzp_payment_id,amount_paise,ref,status,verified_at) values ('rt_ord1','rt_pay1',10000,'RT_O1','verified',now());
  perform shop_order_status('RT_O1','retdev0000001','prep');
  perform shop_order_status('RT_O1','retdev0000001','done');   -- delivered + settlement due

  -- a return can't be requested on a non-delivered order
  insert into shop_orders(id,shop_id,buyer_device,items,total,status) values ('RT_O2',v_shop,v_dev,'[]'::jsonb,50,'new');
  r := return_request(v_dev,'RT_O2','[]'::jsonb,'x');
  assert (r->>'ok')='false' and (r->>'reason')='not_delivered', 'FAIL: return allowed on undelivered order';
  delete from shop_orders where id='RT_O2';

  -- buyer requests; a stranger cannot
  assert (return_request('stranger','RT_O1','[{"name":"Milk","qty":2}]'::jsonb,'wrong item')->>'ok')='false', 'FAIL: stranger requested return';
  r := return_request(v_dev,'RT_O1','[{"name":"Milk","qty":2}]'::jsonb,'wrong item');
  assert (r->>'ok')='true', 'FAIL: buyer return request'; v_ret := r->>'return';

  -- a stranger shop cannot decide/advance
  assert (return_decide('otherShopDev999', v_ret, true, '')->>'ok')='false', 'FAIL: foreign shop decided';

  -- shop approves and drives to refunded → restocked → closed
  assert (return_decide('retdev0000001', v_ret, true, 'ok')->>'ok')='true', 'FAIL: approve';
  assert (return_advance('retdev0000001', v_ret, 'picked_up')->>'ok')='true', 'FAIL: picked_up';
  assert (return_advance('retdev0000001', v_ret, 'inspected')->>'ok')='true', 'FAIL: inspected';
  assert (return_advance('retdev0000001', v_ret, 'refunded')->>'ok')='true', 'FAIL: refunded';
  -- refund + settlement void happened
  assert exists(select 1 from refunds where order_ref='RT_O1'), 'FAIL: return did not create refund';
  assert (select coalesce(sum(net),0) from settlement_ledger where order_ref='RT_O1' and status='due') = 0, 'FAIL: settlement not voided on return refund';
  assert (return_advance('retdev0000001', v_ret, 'restocked')->>'ok')='true', 'FAIL: restocked';
  -- stock went back (Milk +2)
  assert (select coalesce(sum(delta),0) from stock_ledger where shop_id=v_shop and item_name='Milk' and reason='return') = 2, 'FAIL: returned stock not added back';
  assert (return_advance('retdev0000001', v_ret, 'closed')->>'ok')='true', 'FAIL: closed';
  -- an illegal jump is refused
  assert (return_advance('retdev0000001', v_ret, 'approved')->>'ok')='false', 'FAIL: illegal transition allowed';

  delete from returns where order_ref='RT_O1'; delete from refunds where order_ref='RT_O1';
  delete from settlement_ledger where order_ref='RT_O1'; delete from stock_ledger where shop_id=v_shop;
  delete from payments where ref='RT_O1'; delete from shop_orders where id='RT_O1'; delete from shops where id=v_shop;
  raise notice 'PASS: returns — eligibility, owner-scoped, state machine, refund + settlement void, restock';
end $$;

select 'returns / reverse logistics ready' as status;
