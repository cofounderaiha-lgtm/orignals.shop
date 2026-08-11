-- ============================================================
-- 0023 — EXECUTIVE DASHBOARD  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- ONE admin call assembling the CEO/CFO/COO headline metrics (§15/§39/§66) from
-- REAL tables — no fabricated figures, and every number labelled `actual`. Where a
-- source table isn't applied yet, its metric reports null (guarded), never a guess.
-- Read-only, L4+ (finance detail L5). This is a thin AGGREGATION over the real data +
-- the RPC logic already built (settlements, refunds, analytics, dispatch); it invents
-- nothing. "Clearly distinguish actual / estimated / forecast" (§67) → all here are ACTUAL.
-- ============================================================
create or replace function exec_dashboard(p_token text, p_days int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_days int := least(greatest(coalesce(p_days,30),1),90);
        v_since timestamptz; v_lvl text; v_is_l5 boolean;
        v_gmv numeric := null; v_orders int := null; v_active_orders int := null;
        v_paid int := null; v_refunds numeric := null;
        v_due numeric := null; v_paidout numeric := null; v_commission numeric := null;
        v_buyers int := null; v_live int := null; v_fraud int := null;
begin
  v_lvl := _admin_level(p_token);
  if admin_rank(v_lvl) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_is_l5 := (v_lvl = 'l5');
  v_since := now() - (v_days || ' days')::interval;

  -- GMV + orders (authoritative: shop_orders, excluding rejected)
  if to_regclass('public.shop_orders') is not null then
    select count(*), coalesce(sum(total) filter (where status <> 'rejected'),0),
           count(*) filter (where status not in ('done','rejected'))
      into v_orders, v_gmv, v_active_orders
      from shop_orders where created_at > v_since;
  end if;

  -- verified payments
  if to_regclass('public.payments') is not null then
    select count(*) into v_paid from payments where status='verified' and created_at > v_since;
  end if;

  -- refunds issued (0015)
  if to_regclass('public.refunds') is not null then
    select coalesce(sum(amount_paise),0)/100.0 into v_refunds
      from refunds where status='succeeded' and created_at > v_since;
  end if;

  -- settlements (settlements_schema): commission + due/paid to sellers
  if to_regclass('public.settlement_ledger') is not null then
    select coalesce(sum(net) filter (where status='due'),0),
           coalesce(sum(net) filter (where status='paid'),0),
           coalesce(sum(commission) filter (where status in ('due','paid')),0)
      into v_due, v_paidout, v_commission from settlement_ledger;
  end if;

  -- active buyers + live-now (analytics)
  if to_regclass('public.analytics_events') is not null then
    select count(distinct device) into v_buyers from analytics_events where ts > v_since;
    select count(distinct device) into v_live from analytics_events where kind='ping' and ts > now()-interval '70 seconds';
  end if;

  -- open fraud-risk devices (0022) — count only, L4+
  if to_regproc('fraud_risk(text,int)') is not null then
    select coalesce(json_array_length((fraud_risk(p_token, 40))->'devices'),0) into v_fraud;
  end if;

  return json_build_object('ok', true, 'window_days', v_days, 'as_of', now(), 'basis', 'actual',
    'ceo', json_build_object(
      'gmv', v_gmv, 'orders', v_orders, 'verified_payments', v_paid,
      'active_users', v_buyers, 'live_now', v_live),
    'cfo', case when v_is_l5 then json_build_object(
        'commission', v_commission, 'seller_due', v_due, 'seller_paid', v_paidout,
        'refunds_paid', v_refunds,
        'net_take_rate', case when v_gmv > 0 then round(coalesce(v_commission,0)/v_gmv, 4) else null end)
      else json_build_object('detail', 'L5 only') end,
    'coo', json_build_object(
      'active_orders', v_active_orders, 'open_fraud_risk_devices', v_fraud),
    'note', 'all figures ACTUAL from live tables; nulls = source migration not yet applied');
exception when others then return json_build_object('ok', false, 'reason', 'error'); end $$;
grant execute on function exec_dashboard(text, int) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare j json;
begin
  insert into admin_users(ident, level, name, active) values ('__ex_l5__','l5','extest',true)
    on conflict (ident) do update set level='l5', active=true;
  insert into admin_users(ident, level, name, active) values ('__ex_l4__','l4','extest4',true)
    on conflict (ident) do update set level='l4', active=true;
  insert into auth_sessions(token, ident, device_key) values ('__ex_tok5__','__ex_l5__','dev_ex5') on conflict (token) do nothing;
  insert into auth_sessions(token, ident, device_key) values ('__ex_tok4__','__ex_l4__','dev_ex4') on conflict (token) do nothing;

  j := exec_dashboard('__ex_tok5__', 30);
  assert (j->>'ok')='true', 'FAIL: L5 admin denied';
  assert (j->'ceo') ? 'gmv' and (j->'coo') ? 'active_orders', 'FAIL: missing sections';
  assert (j->'cfo') ? 'commission', 'FAIL: L5 should see cfo detail';

  -- L4 sees CEO/COO but NOT cfo finance detail
  j := exec_dashboard('__ex_tok4__', 30);
  assert (j->>'ok')='true' and (j->'cfo'->>'detail') = 'L5 only', 'FAIL: L4 saw finance detail';

  -- non-admin refused
  assert (exec_dashboard('__nope__', 30)->>'ok')='false', 'FAIL: non-admin read exec dashboard';

  delete from auth_sessions where token in ('__ex_tok5__','__ex_tok4__');
  delete from admin_users where ident in ('__ex_l5__','__ex_l4__');
  raise notice 'PASS: exec dashboard assembles CEO/CFO/COO from real tables; L5-gated finance; non-admin refused';
end $$;

select 'exec dashboard ready' as status;
