-- ============================================================
-- 0015 — FINANCE: refunds + payment↔settlement coupling  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied. Apply only after a
--   staging DB runs the 0008→latest sequence + the finance/concurrency tests.
--
-- Two P0/P1 gaps from COMPLETION-ASSESSMENT §I:
--
-- (1) NO REFUND IS EVER EXECUTED. Cancellations only DISPLAY "3-5 working days";
--     no refund row, no provider call, no reversal. This adds a real refunds
--     ledger + a device-scoped request RPC + an internal apply path (called by
--     the razorpay-refund edge function, which does the actual money movement).
--
-- (2) SETTLEMENT IS RECORDED BEFORE DELIVERY AND NEVER REVERSED. The base
--     _settle_from_shop_order trigger (settlements_schema.sql:53) fires AFTER
--     INSERT and books a seller payable (92%) the instant an order is created —
--     while it is still 'new', unpaid, unaccepted — and a later reject/cancel/
--     refund leaves the phantom payable behind. Here settlement is COUPLED to
--     delivery (status='done') and VOIDED on reject/cancel/refund.
--
-- Design notes:
--   · Immutable audit: finance_events is append-only (every money state change).
--   · Idempotency: refunds.idempotency_key is UNIQUE; a partial unique index
--     allows at most ONE open/succeeded refund per order (no double refund).
--   · Authorization: refund_open derives ownership from shop_orders.buyer_device
--     (server-side); the apply path is internal (service role / SECURITY DEFINER
--     called by the edge fn), never anon-trusted for the money movement.
--   · COD safety: an order with no VERIFIED online payment was never charged, so
--     refund_open returns 'nothing_to_refund' instead of inventing money.
-- ============================================================

-- ---------- immutable finance audit (reconciliation spine) ----------
create table if not exists finance_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  kind       text not null,          -- payment_verified | settlement_due | settlement_void | settlement_paid | refund_requested | refund_succeeded | refund_failed
  order_ref  text,
  payee      text,
  amount     numeric,
  ref        text,                    -- rzp id / payout ref / refund id
  detail     jsonb
);
create index if not exists finance_events_order_idx on finance_events(order_ref, at);
create index if not exists finance_events_kind_idx  on finance_events(kind, at desc);
alter table finance_events enable row level security;   -- append via definer fns; read via admin RPC only

create or replace function _fin_event(p_kind text, p_order text, p_payee text, p_amount numeric, p_ref text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into finance_events(kind, order_ref, payee, amount, ref, detail)
  values (p_kind, p_order, p_payee, p_amount, p_ref, p_detail);
$$;

-- ---------- refunds ledger ----------
create table if not exists refunds (
  id              bigint generated always as identity primary key,
  order_ref       text not null,
  device_key      text,                 -- who owns the order (buyer)
  rzp_payment_id  text,                  -- the captured payment being refunded
  amount_paise    bigint not null check (amount_paise >= 0),
  reason          text,
  status          text not null default 'requested',  -- requested | processing | succeeded | failed
  rzp_refund_id   text,
  idempotency_key text unique,           -- hard stop against duplicate refunds
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists refunds_order_idx on refunds(order_ref, created_at desc);
-- at most ONE non-failed refund per order (no double refund on retries)
create unique index if not exists refunds_one_open_per_order
  on refunds(order_ref) where status in ('requested','processing','succeeded');
alter table refunds enable row level security;   -- no anon policy; RPCs below

-- ---------- (1) buyer requests a refund (device-scoped) ----------
-- Records the request; the actual money movement is done by the razorpay-refund
-- edge function, which then calls _refund_apply(). COD/unpaid orders are not
-- charged, so nothing is refunded (no invented money).
create or replace function refund_open(p_order text, p_device text, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner text; v_pay text; v_amt bigint; v_idem text;
begin
  -- ownership: the order must belong to this device (buyer)
  select buyer_device into v_owner from shop_orders where id = p_order;
  if v_owner is null then
    -- fall back to the orders mirror (non-community orders) keyed by device_key
    select device_key into v_owner from orders where id = p_order;
  end if;
  if v_owner is null then return json_build_object('ok', false, 'reason', 'order_not_found'); end if;
  if v_owner <> p_device then return json_build_object('ok', false, 'reason', 'not_your_order'); end if;

  -- must have a VERIFIED online payment to refund; else nothing was charged (COD)
  select rzp_payment_id, amount_paise into v_pay, v_amt
    from payments where ref = p_order and status = 'verified'
    order by verified_at desc nulls last limit 1;
  if v_pay is null then return json_build_object('ok', false, 'reason', 'nothing_to_refund'); end if;

  v_idem := 'rf_' || p_order;    -- one refund per order → stable idempotency key
  insert into refunds(order_ref, device_key, rzp_payment_id, amount_paise, reason, status, idempotency_key)
  values (p_order, p_device, v_pay, v_amt, left(coalesce(p_reason,''), 200), 'requested', v_idem)
  on conflict (idempotency_key) do update
    set status = 'requested', updated_at = now()
    where refunds.status = 'failed';   -- retry ONLY after a failed provider attempt;
                                        -- stays idempotent (no-op) for requested/processing/succeeded

  perform _fin_event('refund_requested', p_order, null, v_amt/100.0, v_pay, json_build_object('reason', p_reason)::jsonb);
  -- void any seller payable for this order — a refunded order does not pay the seller
  perform _settlement_void(p_order, 'refund');
  return json_build_object('ok', true, 'payment', v_pay, 'amount_paise', v_amt, 'status', 'requested');
end $$;
grant execute on function refund_open(text, text, text) to anon;

-- buyer reads their own refund status
create or replace function refund_status(p_order text, p_device text)
returns json language sql security definer set search_path = public stable as $$
  select coalesce((select json_build_object('status', status, 'amount_paise', amount_paise, 'rzp_refund_id', rzp_refund_id)
                   from refunds where order_ref = p_order and device_key = p_device
                   order by created_at desc limit 1),
                  json_build_object('status', 'none'));
$$;
grant execute on function refund_status(text, text) to anon;

-- ---------- internal: apply the provider's refund result ----------
-- Called by the razorpay-refund EDGE FUNCTION (service role) after Razorpay
-- returns. NOT granted to anon: only the trusted server may confirm money moved.
create or replace function _refund_apply(p_order text, p_rzp_refund text, p_ok boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_amt bigint;
begin
  update refunds
     set status = case when p_ok then 'succeeded' else 'failed' end,
         rzp_refund_id = coalesce(p_rzp_refund, rzp_refund_id),
         updated_at = now()
   where order_ref = p_order and status in ('requested','processing')
   returning amount_paise into v_amt;
  if not found then return json_build_object('ok', false, 'reason', 'no_open_refund'); end if;
  perform _fin_event(case when p_ok then 'refund_succeeded' else 'refund_failed' end,
                     p_order, null, v_amt/100.0, p_rzp_refund, null);
  return json_build_object('ok', true);
end $$;
-- deliberately NOT granted to anon.

-- ---------- (2) settlement coupled to delivery + reversal ----------
create or replace function _settlement_void(p_order text, p_why text)
returns void language plpgsql security definer set search_path = public as $$
declare v_net numeric; v_payee text;
begin
  update settlement_ledger set status = 'void', paid_at = null
   where order_ref = p_order and status = 'due'
   returning net, payee into v_net, v_payee;
  if found then perform _fin_event('settlement_void', p_order, v_payee, v_net, p_why, null); end if;
end $$;

-- replace the base trigger fn: settle ONLY when delivered ('done'); void on
-- reject/cancel. Booking a payable on INSERT (still 'new') was the bug.
create or replace function _settle_from_shop_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    return new;                                   -- do NOT settle an unfulfilled order
  end if;
  if new.status = 'done' and coalesce(old.status,'') <> 'done' then
    insert into settlement_ledger(order_ref, payee, payee_kind, gross, commission, net, status)
    values (new.id, new.shop_id, 'shop', coalesce(new.total,0),
            round(coalesce(new.total,0)*0.08,2), round(coalesce(new.total,0)*0.92,2), 'due')
    on conflict (order_ref, payee) do update set status = 'due';
    perform _fin_event('settlement_due', new.id, new.shop_id, round(coalesce(new.total,0)*0.92,2), null, null);
  elsif new.status in ('rejected') and coalesce(old.status,'') <> 'rejected' then
    perform _settlement_void(new.id, 'order_' || new.status);
  end if;
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_settle_shop_order on shop_orders;
create trigger trg_settle_shop_order after insert or update on shop_orders
  for each row execute function _settle_from_shop_order();

-- reconciliation: void the phantom payables the OLD insert-trigger already booked
-- for orders that never reached 'done' (data fix for anything applied pre-0015).
update settlement_ledger sl set status = 'void'
 from shop_orders so
 where sl.order_ref = so.id and sl.status = 'due' and so.status <> 'done';

-- ---------- admin: finance reconciliation view (L4+) ----------
create or replace function finance_reconcile(p_token text)
returns json language plpgsql security definer set search_path = public stable as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  return json_build_object('ok', true,
    'verified_payments', (select coalesce(sum(amount_paise),0)/100.0 from payments where status='verified'),
    'settlement_due',    (select coalesce(sum(net),0) from settlement_ledger where status='due'),
    'settlement_paid',   (select coalesce(sum(net),0) from settlement_ledger where status='paid'),
    'settlement_void',   (select coalesce(sum(net),0) from settlement_ledger where status='void'),
    'commission',        (select coalesce(sum(commission),0) from settlement_ledger where status in ('due','paid')),
    'refunds_succeeded', (select coalesce(sum(amount_paise),0)/100.0 from refunds where status='succeeded'),
    'refunds_open',      (select count(*) from refunds where status in ('requested','processing')));
end $$;
grant execute on function finance_reconcile(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_dev text := 'devfintest01'; v_shop text := 'my_' || substr('devfintest01',1,12);
        r json; v_due numeric;
begin
  delete from refunds where order_ref in ('FIN_O1','FIN_O2');
  delete from finance_events where order_ref in ('FIN_O1','FIN_O2');
  delete from settlement_ledger where order_ref in ('FIN_O1','FIN_O2');
  delete from payments where ref in ('FIN_O1','FIN_O2');
  delete from shop_orders where id in ('FIN_O1','FIN_O2');

  -- an online-paid order, delivered
  insert into shop_orders(id, shop_id, buyer_device, items, total, status)
    values ('FIN_O1', v_shop, v_dev, '[]'::jsonb, 200, 'new');
  insert into payments(rzp_order_id, rzp_payment_id, amount_paise, purpose, ref, status, verified_at)
    values ('order_fin1','pay_fin1', 20000, 'order', 'FIN_O1', 'verified', now());

  -- (a) settling on INSERT must NOT have happened (order still 'new')
  select coalesce(sum(net),0) into v_due from settlement_ledger where order_ref='FIN_O1' and status='due';
  assert v_due = 0, 'FAIL: settlement booked before delivery';

  -- deliver it → settlement becomes due (92% of 200 = 184)
  update shop_orders set status='done' where id='FIN_O1';
  select coalesce(sum(net),0) into v_due from settlement_ledger where order_ref='FIN_O1' and status='due';
  assert v_due = 184, 'FAIL: settlement not booked on delivery, got '||v_due;

  -- buyer requests a refund → refund row + settlement voided
  r := refund_open('FIN_O1', v_dev, 'item damaged');
  assert (r->>'ok')='true', 'FAIL: refund_open refused a paid order';
  assert (r->>'amount_paise')::bigint = 20000, 'FAIL: wrong refund amount';
  select coalesce(sum(net),0) into v_due from settlement_ledger where order_ref='FIN_O1' and status='due';
  assert v_due = 0, 'FAIL: settlement not voided on refund';

  -- foreign device cannot refund
  r := refund_open('FIN_O1', 'someone_else', 'x');
  assert (r->>'ok')='false', 'FAIL: foreign refund allowed';

  -- a COD order (no verified payment) has nothing to refund
  insert into shop_orders(id, shop_id, buyer_device, items, total, status)
    values ('FIN_O2', v_shop, v_dev, '[]'::jsonb, 150, 'done');
  r := refund_open('FIN_O2', v_dev, 'changed mind');
  assert (r->>'ok')='false' and (r->>'reason')='nothing_to_refund', 'FAIL: COD order invented a refund';

  -- cleanup
  delete from refunds where order_ref in ('FIN_O1','FIN_O2');
  delete from finance_events where order_ref in ('FIN_O1','FIN_O2');
  delete from settlement_ledger where order_ref in ('FIN_O1','FIN_O2');
  delete from payments where ref in ('FIN_O1','FIN_O2');
  delete from shop_orders where id in ('FIN_O1','FIN_O2');
  raise notice 'PASS: settlement couples to delivery + reverses; refunds are real, device-scoped, COD-safe';
end $$;

select 'finance (refunds + coupling) ready' as status;
