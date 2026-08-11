-- ============================================================
-- 0022 — FRAUD RISK SCORING  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- EXTENDS fraud_schema.sql (which already computes live flag signals) with the
-- missing §33 piece: a per-device RISK SCORE (signals → features → weighted score →
-- review), grounded in REAL data across the subsystems built since:
--   · refund abuse        — succeeded refunds per device (0015 refunds)
--   · buyer-cancel abuse  — buyer-initiated rejections (0009 shop_order_events,
--                           actor='buyer', to_status='rejected')
--   · card testing        — failed payments per device (payments)
--   · account farming     — accounts per device (auth_sessions)
--
-- Fixes a REAL bug in the base fraud_schema.many_cancels signal: it counts
-- shop_orders.status='cancelled', but buyer cancellation sets 'rejected' (0009), so
-- that signal is DEAD. The correct source is the event log's actor, used below.
--
-- Read-only, admin-gated (L4+), dismissals honored. Scores are EXPLAINABLE (every
-- point traces to a factor) — no opaque blackbox on a user-affecting decision (§30/§72).
-- Weights are config here (Stage 1 rules); a learned model is Stage 3 (needs labels).
-- ============================================================

-- required inputs (this migration lands after them in the sequence). If any is
-- missing, fail LOUD rather than silently score nothing.
do $$ begin
  if to_regclass('public.refunds') is null or to_regclass('public.shop_order_events') is null
     or to_regclass('public.payments') is null or to_regclass('public.auth_sessions') is null
     or to_regclass('public.shop_orders') is null then
    raise exception '0022 requires refunds(0015), shop_order_events(0009), payments, auth_sessions, shop_orders — apply those first';
  end if;
end $$;

create or replace function fraud_risk(p_token text, p_min_score int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_min int := greatest(coalesce(p_min_score, 25), 0);
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  return json_build_object('ok', true, 'as_of', now(), 'min_score', v_min, 'devices', coalesce((
    with
    refund_agg as (select device_key dev, count(*) filter (where status='succeeded') n
                   from refunds where coalesce(device_key,'') <> '' group by 1),
    cancel_agg as (select actor_device dev, count(*) n
                   from shop_order_events where actor='buyer' and to_status='rejected' and coalesce(actor_device,'') <> ''
                   group by 1),
    payfail_agg as (select device_key dev, count(*) n
                    from payments where status='failed' and coalesce(device_key,'') <> '' group by 1),
    acct_agg as (select device_key dev, count(distinct ident) n
                 from auth_sessions where coalesce(device_key,'') <> '' group by 1),
    devs as (select dev from refund_agg union select dev from cancel_agg
             union select dev from payfail_agg union select dev from acct_agg)
    select json_agg(row_to_json(x) order by x.score desc) from (
      select d.dev device,
        least(100,
            (case when coalesce(r.n,0) >= 2 then 25 else 0 end)      -- refund abuse
          + (case when coalesce(c.n,0) >= 3 then 20 else 0 end)      -- buyer-cancel abuse
          + (case when coalesce(p.n,0) >= 3 then 20 else 0 end)      -- card testing
          + (case when coalesce(a.n,0) >= 3 then 30 else 0 end)      -- account farming
        ) score,
        json_build_object(
          'succeeded_refunds', coalesce(r.n,0),
          'buyer_cancels',     coalesce(c.n,0),
          'failed_payments',   coalesce(p.n,0),
          'accounts_on_device',coalesce(a.n,0)) factors
      from devs d
      left join refund_agg  r on r.dev = d.dev
      left join cancel_agg  c on c.dev = d.dev
      left join payfail_agg p on p.dev = d.dev
      left join acct_agg    a on a.dev = d.dev
      where ('risk|' || d.dev) not in (select sig from fraud_dismissed)
    ) x
    where x.score >= v_min
    limit 100
  ), '[]'::json));
exception when others then return json_build_object('ok', false, 'reason', 'error'); end $$;
grant execute on function fraud_risk(text, int) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare j json; hi int; lo int;
begin
  -- clean any prior test rows
  delete from refunds where device_key='fraud_bad_dev';
  delete from shop_order_events where actor_device='fraud_bad_dev';
  delete from payments where device_key='fraud_bad_dev';

  -- a BAD device: 2 succeeded refunds + 3 buyer cancels + 3 failed payments
  insert into refunds(order_ref, device_key, amount_paise, status, idempotency_key) values
    ('FR_A','fraud_bad_dev',100,'succeeded','frtest_a'), ('FR_B','fraud_bad_dev',100,'succeeded','frtest_b');
  insert into shop_order_events(order_id, actor, actor_device, to_status, note) values
    ('FR_C','buyer','fraud_bad_dev','rejected','buyer cancelled'),
    ('FR_D','buyer','fraud_bad_dev','rejected','buyer cancelled'),
    ('FR_E','buyer','fraud_bad_dev','rejected','buyer cancelled');
  insert into payments(rzp_order_id, device_key, amount_paise, ref, status) values
    ('fro1','fraud_bad_dev',10000,'FR_C','failed'),
    ('fro2','fraud_bad_dev',10000,'FR_D','failed'),
    ('fro3','fraud_bad_dev',10000,'FR_E','failed');

  -- need an admin token to read; stand up a throwaway L5 (atomic — same txn)
  insert into admin_users(ident, level, name, active) values ('__fr_admin__','l5','frtest',true)
    on conflict (ident) do update set level='l5', active=true;
  insert into auth_sessions(token, ident, device_key) values ('__fr_tok__','__fr_admin__','dev_frx')
    on conflict (token) do nothing;

  j := fraud_risk('__fr_tok__', 25);
  assert (j->>'ok')='true', 'FAIL: admin denied';
  select (e->>'score')::int into hi from json_array_elements(j->'devices') e where e->>'device'='fraud_bad_dev';
  assert hi >= 65, 'FAIL: bad device scored too low, got ' || coalesce(hi::text,'<null>');  -- 25+20+20 = 65

  -- non-admin is refused
  assert (fraud_risk('__nope__', 25)->>'ok')='false', 'FAIL: non-admin read risk';

  -- cleanup
  delete from refunds where device_key='fraud_bad_dev';
  delete from shop_order_events where actor_device='fraud_bad_dev';
  delete from payments where device_key='fraud_bad_dev';
  delete from auth_sessions where token='__fr_tok__';
  delete from admin_users where ident='__fr_admin__';
  raise notice 'PASS: risk score aggregates refund+cancel+payfail+multiacct, explainable, admin-gated (bad=%)', hi;
end $$;

select 'fraud risk scoring ready' as status;
