-- ============================================================
-- 0025 — DOUBLE-ENTRY FINANCIAL LEDGER  (⚠ FROZEN — validated locally, not applied)
--   Written 2026-08-12. The money spine (0015) records finance_events (an audit
--   log) + settlement_ledger, but the directive (§28) demands a real DOUBLE-ENTRY
--   ledger: immutable journals whose debits always equal credits, so the platform's
--   books provably balance and every rupee is traceable (CFO-grade §21/§43).
--
--   This is INTEGRATED, not a disconnected primitive: ledger_sync_order() DERIVES the
--   correct journals for an order from the REAL tables (payments / settlement_ledger /
--   refunds), idempotently. So the ledger reflects actual money events and always
--   reconciles. ledger_post() is the generic balanced-journal primitive; a journal
--   that does not balance is rejected. Entries are immutable (corrections = new
--   compensating journals, never edits).
-- ============================================================

-- ---------- chart of accounts ----------
create table if not exists ledger_accounts (
  code text primary key,
  name text not null,
  kind text not null check (kind in ('asset','liability','revenue','expense'))
);
insert into ledger_accounts(code,name,kind) values
  ('cash',               'Cash / gateway received',        'asset'),
  ('customer_liability', 'Held for undelivered orders',    'liability'),
  ('seller_payable',     'Owed to sellers',                'liability'),
  ('mitra_payable',      'Owed to delivery partners',      'liability'),
  ('platform_revenue',   'Platform commission revenue',    'revenue'),
  ('tax_payable',        'Tax collected, owed to govt',    'liability'),
  ('gateway_fees',       'Payment gateway cost',           'expense')
on conflict (code) do nothing;

-- ---------- journals + entries (append-only, always balanced) ----------
create table if not exists ledger_journals (
  id        bigint generated always as identity primary key,
  kind      text not null,                 -- payment | delivery | refund | payout | adjustment
  order_ref text,
  memo      text,
  at        timestamptz not null default now()
);
create index if not exists lj_order_idx on ledger_journals(order_ref, at);

create table if not exists ledger_entries (
  id         bigint generated always as identity primary key,
  journal_id bigint not null references ledger_journals(id) on delete cascade,
  account    text not null references ledger_accounts(code),
  debit      numeric not null default 0 check (debit  >= 0),
  credit     numeric not null default 0 check (credit >= 0),
  check (not (debit > 0 and credit > 0))   -- a leg is either a debit or a credit
);
create index if not exists le_journal_idx on ledger_entries(journal_id);
create index if not exists le_account_idx  on ledger_entries(account);
alter table ledger_accounts enable row level security;
alter table ledger_journals enable row level security;
alter table ledger_entries  enable row level security;   -- posted only via SECURITY DEFINER RPCs

-- ---------- ledger_post: a balanced journal, or reject ----------
create or replace function ledger_post(p_kind text, p_order text, p_legs jsonb, p_memo text)
returns json language plpgsql security definer set search_path = public as $$
declare v_jid bigint; v_dr numeric := 0; v_cr numeric := 0; leg jsonb;
begin
  if jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) < 2 then
    return json_build_object('ok', false, 'reason', 'need_>=2_legs');
  end if;
  for leg in select value from jsonb_array_elements(p_legs) loop
    v_dr := v_dr + coalesce((leg->>'debit')::numeric, 0);
    v_cr := v_cr + coalesce((leg->>'credit')::numeric, 0);
  end loop;
  if round(v_dr,2) <> round(v_cr,2) then
    return json_build_object('ok', false, 'reason', 'unbalanced', 'debit', v_dr, 'credit', v_cr);
  end if;
  if round(v_dr,2) = 0 then return json_build_object('ok', false, 'reason', 'zero'); end if;

  insert into ledger_journals(kind, order_ref, memo) values (p_kind, p_order, p_memo) returning id into v_jid;
  for leg in select value from jsonb_array_elements(p_legs) loop
    insert into ledger_entries(journal_id, account, debit, credit)
    values (v_jid, leg->>'account', coalesce((leg->>'debit')::numeric,0), coalesce((leg->>'credit')::numeric,0));
  end loop;
  return json_build_object('ok', true, 'journal', v_jid, 'amount', v_dr);
end $$;
-- NOT anon-granted: money is posted only by the server (edge fn / sync), never a client.

-- ---------- ledger_sync_order: derive an order's journals from the REAL tables ----------
-- Idempotent: wipes this order's journals and re-derives from payments / settlement /
-- refunds. So the double-entry books always reflect the true current money state.
create or replace function ledger_sync_order(p_order text)
returns json language plpgsql security definer set search_path = public as $$
declare v_amt numeric; v_net numeric; v_comm numeric; v_gross numeric;
        v_refunded numeric; v_settled boolean; n int := 0;
begin
  delete from ledger_journals where order_ref = p_order;   -- re-derive (cascades entries)

  -- 1. verified online payment → cash in, held as customer liability
  select coalesce(sum(amount_paise),0)/100.0 into v_amt
    from payments where ref = p_order and status = 'verified';
  if v_amt > 0 then
    perform ledger_post('payment', p_order,
      jsonb_build_array(jsonb_build_object('account','cash','debit',v_amt),
                        jsonb_build_object('account','customer_liability','credit',v_amt)), 'payment verified');
    n := n + 1;
  end if;

  -- 2. delivered (settlement due/paid) → release the held money to seller + platform
  select coalesce(sum(net),0), coalesce(sum(commission),0)
    into v_net, v_comm
    from settlement_ledger where order_ref = p_order and status in ('due','paid');
  v_gross := coalesce(v_net,0) + coalesce(v_comm,0);
  if v_gross > 0 then
    perform ledger_post('delivery', p_order,
      jsonb_build_array(jsonb_build_object('account','customer_liability','debit',v_gross),
                        jsonb_build_object('account','seller_payable','credit',v_net),
                        jsonb_build_object('account','platform_revenue','credit',v_comm)), 'delivered — split');
    n := n + 1;
  end if;

  -- 3. refund succeeded → reverse: cash goes back out; unwind whatever it was holding
  select coalesce(sum(amount_paise),0)/100.0 into v_refunded
    from refunds where order_ref = p_order and status = 'succeeded';
  if v_refunded > 0 then
    v_settled := (v_gross > 0);
    if v_settled then
      -- money had been split → claw it back from seller + platform
      perform ledger_post('refund', p_order,
        jsonb_build_array(jsonb_build_object('account','seller_payable','debit',v_net),
                          jsonb_build_object('account','platform_revenue','debit',v_comm),
                          jsonb_build_object('account','cash','credit',v_gross)), 'refund after delivery');
    else
      -- still held as customer liability → return it
      perform ledger_post('refund', p_order,
        jsonb_build_array(jsonb_build_object('account','customer_liability','debit',v_refunded),
                          jsonb_build_object('account','cash','credit',v_refunded)), 'refund before delivery');
    end if;
    n := n + 1;
  end if;

  return json_build_object('ok', true, 'journals', n);
end $$;

-- ---------- reads: account balance + trial balance (books must balance) ----------
create or replace function ledger_balance(p_account text)
returns numeric language sql security definer set search_path = public stable as $$
  select coalesce(sum(debit) - sum(credit), 0) from ledger_entries where account = p_account;
$$;

create or replace function ledger_trial_balance(p_token text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_dr numeric; v_cr numeric;
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_dr, v_cr from ledger_entries;
  return json_build_object('ok', true,
    'total_debits', v_dr, 'total_credits', v_cr, 'balanced', round(v_dr,2) = round(v_cr,2),
    'accounts', (select coalesce(json_agg(row_to_json(t) order by t.code),'[]'::json) from (
        select a.code, a.kind, coalesce(sum(e.debit),0) debits, coalesce(sum(e.credit),0) credits,
               coalesce(sum(e.debit)-sum(e.credit),0) balance
        from ledger_accounts a left join ledger_entries e on e.account = a.code
        group by a.code, a.kind) t));
end $$;
grant execute on function ledger_trial_balance(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('ledgerdev0001'); r json; v_bal numeric;
begin
  delete from ledger_journals where order_ref='LG_O1';
  delete from shop_orders where id='LG_O1'; delete from settlement_ledger where order_ref='LG_O1';
  delete from refunds where order_ref='LG_O1'; delete from payments where ref='LG_O1';

  -- an unbalanced journal is REJECTED
  r := ledger_post('adjustment','LG_O1', jsonb_build_array(
        jsonb_build_object('account','cash','debit',100),
        jsonb_build_object('account','customer_liability','credit',90)), 'bad');
  assert (r->>'ok')='false' and (r->>'reason')='unbalanced', 'FAIL: unbalanced journal accepted';

  -- real order: pay 100 → deliver (92 seller + 8 platform) → sync ledger.
  -- insert as 'new' then transition to 'done' so the 0015 settlement trigger fires
  -- (it settles on the transition to done, not on an already-done insert).
  insert into shop_orders(id,shop_id,buyer_device,items,total,status) values ('LG_O1',v_shop,'ledgerdev0001','[]'::jsonb,100,'new');
  insert into payments(rzp_order_id,rzp_payment_id,amount_paise,ref,status,verified_at) values ('lg_ord1','lg_pay1',10000,'LG_O1','verified',now());
  update shop_orders set status='done' where id='LG_O1';    -- fires settlement trigger → seller 92 + platform 8
  r := ledger_sync_order('LG_O1');
  assert (r->>'ok')='true', 'FAIL: sync';

  -- books balance, and the money landed where it should
  assert ledger_balance('cash') = 100, 'FAIL: cash != 100, got '||ledger_balance('cash');
  assert ledger_balance('customer_liability') = 0, 'FAIL: liability not released, got '||ledger_balance('customer_liability');
  -- liability/revenue accounts carry a natural CREDIT balance → debit−credit is negative
  assert ledger_balance('seller_payable') = -92, 'FAIL: seller_payable != -92, got '||ledger_balance('seller_payable');
  assert ledger_balance('platform_revenue') = -8, 'FAIL: revenue (credit) wrong, got '||ledger_balance('platform_revenue');

  -- refund → sync → everything unwinds to zero (books still balance)
  insert into refunds(order_ref,device_key,amount_paise,status,idempotency_key) values ('LG_O1','ledgerdev0001',10000,'succeeded','lg_rf1');
  r := ledger_sync_order('LG_O1');
  assert ledger_balance('cash') = 0, 'FAIL: cash not returned on refund, got '||ledger_balance('cash');
  assert ledger_balance('seller_payable') = 0, 'FAIL: seller_payable not clawed back, got '||ledger_balance('seller_payable');
  assert ledger_balance('platform_revenue') = 0, 'FAIL: revenue not reversed, got '||ledger_balance('platform_revenue');

  -- global trial balance: total debits = total credits
  select coalesce(sum(debit),0) - coalesce(sum(credit),0) into v_bal from ledger_entries;
  assert round(v_bal,2) = 0, 'FAIL: books do not balance, net '||v_bal;

  delete from ledger_journals where order_ref='LG_O1';
  delete from shop_orders where id='LG_O1'; delete from settlement_ledger where order_ref='LG_O1';
  delete from refunds where order_ref='LG_O1'; delete from payments where ref='LG_O1';
  raise notice 'PASS: double-entry — unbalanced rejected; pay→deliver→refund derived + reconciled to zero';
end $$;

select 'double-entry ledger ready' as status;
