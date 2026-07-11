-- ============================================================
-- AUTO-SETTLEMENT — money owed to shops & partners is recorded
-- automatically on every paid order (no manual sending), tracked in
-- a ledger, and paid out in a batch ("daily settlement"). When
-- Razorpay Route is activated and a payee has a linked account, the
-- split can happen at capture time — until then this ledger + batch
-- payout runs the settlement cleanly.
-- Commission model: platform keeps 8% (5% platform fee absorbing the
-- ~3% gateway); the shop nets 92% of the order.
-- ============================================================

create table if not exists payout_accounts (
  payee         text primary key,          -- shop_id (shops) or device (partners)
  kind          text default 'shop',        -- shop | partner
  holder        text,
  upi           text,
  bank_acc      text,
  ifsc          text,
  rzp_linked_id text,                        -- Razorpay Route linked-account id (once Route is active)
  status        text default 'active',
  created_at    timestamptz default now()
);

create table if not exists settlement_ledger (
  id         bigint generated always as identity primary key,
  order_ref  text,
  payee      text,
  payee_kind text default 'shop',
  gross      numeric,
  commission numeric,
  net        numeric,
  status     text default 'due',            -- due | paid
  payout_ref text,
  paid_at    timestamptz,
  created_at timestamptz default now(),
  unique (order_ref, payee)
);
create index if not exists settle_status_idx on settlement_ledger(status, payee);
alter table payout_accounts   enable row level security;
alter table settlement_ledger enable row level security;

-- AUTO-RECORD: every shop order becomes a settlement entry for the shop
create or replace function _settle_from_shop_order() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into settlement_ledger(order_ref, payee, payee_kind, gross, commission, net)
  values (new.id, new.shop_id, 'shop', coalesce(new.total,0),
          round(coalesce(new.total,0)*0.08,2), round(coalesce(new.total,0)*0.92,2))
  on conflict (order_ref, payee) do nothing;
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_settle_shop_order on shop_orders;
create trigger trg_settle_shop_order after insert on shop_orders for each row execute function _settle_from_shop_order();

-- seller/partner registers where their money should go
create or replace function payout_account_set(p_payee text, p_kind text, p_holder text, p_upi text, p_bank text, p_ifsc text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if coalesce(p_payee,'')='' then return json_build_object('ok',false,'reason','no_payee'); end if;
  insert into payout_accounts(payee,kind,holder,upi,bank_acc,ifsc)
  values (p_payee, coalesce(nullif(p_kind,''),'shop'), left(coalesce(p_holder,''),80), left(coalesce(p_upi,''),80), left(coalesce(p_bank,''),40), left(coalesce(p_ifsc,''),20))
  on conflict (payee) do update set holder=excluded.holder, upi=excluded.upi, bank_acc=excluded.bank_acc, ifsc=excluded.ifsc, kind=excluded.kind;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- a payee's own statement (owed + paid)
create or replace function settlement_mine(p_payee text)
returns json language plpgsql security definer set search_path=public as $$
begin
  return json_build_object('ok',true,
    'due', (select coalesce(sum(net),0) from settlement_ledger where payee=p_payee and status='due'),
    'paid',(select coalesce(sum(net),0) from settlement_ledger where payee=p_payee and status='paid'),
    'account',(select row_to_json(a) from (select holder,upi,bank_acc,ifsc from payout_accounts where payee=p_payee) a),
    'rows',(select coalesce(json_agg(row_to_json(t) order by t.created_at desc),'[]'::json) from (
       select order_ref, gross, commission, net, status, created_at from settlement_ledger where payee=p_payee limit 50) t));
end $$;

-- ADMIN: settlement dashboard (L4+)
create or replace function settlement_summary(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,
    'due_total',  (select coalesce(sum(net),0) from settlement_ledger where status='due'),
    'paid_total', (select coalesce(sum(net),0) from settlement_ledger where status='paid'),
    'commission', (select coalesce(sum(commission),0) from settlement_ledger),
    'due_count',  (select count(*) from settlement_ledger where status='due'),
    'by_payee', (select coalesce(json_agg(row_to_json(t) order by t.due desc),'[]'::json) from (
        select l.payee, coalesce(a.holder, l.payee) holder, coalesce(a.upi,'') upi,
               sum(l.net) filter (where l.status='due') due,
               sum(l.net) filter (where l.status='paid') paid,
               count(*) filter (where l.status='due') orders
        from settlement_ledger l left join payout_accounts a on a.payee=l.payee
        group by l.payee, a.holder, a.upi having sum(l.net) filter (where l.status='due') > 0) t));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ADMIN: run the batch payout — settle everything currently due (L5).
-- With Razorpay Route/Payouts + linked accounts this would fire real
-- transfers; here it records the settlement so the ledger stays truthful.
create or replace function settlement_run(p_token text, p_payee text)
returns json language plpgsql security definer set search_path=public as $$
declare v_ref text; v_n int; v_sum numeric;
begin
  if _admin_level(p_token) <> 'l5' then return json_build_object('ok',false,'reason','only_l5'); end if;
  v_ref := 'PO' || to_char(now(),'YYYYMMDDHH24MISS');
  update settlement_ledger set status='paid', payout_ref=v_ref, paid_at=now()
    where status='due' and (coalesce(p_payee,'')='' or payee=p_payee);
  get diagnostics v_n = row_count;
  select coalesce(sum(net),0) into v_sum from settlement_ledger where payout_ref=v_ref;
  return json_build_object('ok',true,'payout_ref',v_ref,'settled',v_n,'amount',v_sum);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function payout_account_set(text,text,text,text,text,text) to anon;
grant execute on function settlement_mine(text) to anon;
grant execute on function settlement_summary(text) to anon;
grant execute on function settlement_run(text,text) to anon;

-- backfill: create settlement rows for any shop orders that predate the trigger
insert into settlement_ledger(order_ref, payee, payee_kind, gross, commission, net)
select id, shop_id, 'shop', coalesce(total,0), round(coalesce(total,0)*0.08,2), round(coalesce(total,0)*0.92,2)
from shop_orders on conflict (order_ref, payee) do nothing;

select 'settlements ready' as status, (select count(*) from settlement_ledger) ledger_rows;
