-- 0020 observability — NOT YET APPLIED (written by full-build)
-- ============================================================
-- ORIGNALS · minimal backend observability. Today nothing records
-- when an RPC, edge function, or Razorpay webhook throws — failures
-- are invisible until a user complains. This adds one append-only
-- log table + a write RPC any layer (edge/rpc/webhook/client) can
-- fire-and-forget into, plus admin-gated (L4+) health rollups.
--
-- ALGORITHM PROGRESSION (anti-cargo-cult):
--   stage 1 (NOW): plain Postgres table + partial indexes + on-read
--     percentile/rollup aggregation. Sufficient at hundreds→tens of
--     thousands of users; a single op_health() query scans an index,
--     not a fleet of collectors.
--   stage 2 (when sustained write volume makes op_log the hottest
--     table — roughly >5–10M rows/day, or op_health p95 > 500ms):
--     add a rollup table refreshed by pg_cron (5-min buckets) and
--     query that instead of raw rows; add a retention job that
--     TRUNCATEs op_log older than N days.
--   stage 3 (only if you outgrow Postgres for logs — multi-region,
--     >100M events/day): ship to an external APM/log sink. Not now.
-- No Kafka/Redis/ES. A log line must NEVER break the caller.
-- ============================================================

-- ---- table: append-only operational log --------------------
create table if not exists op_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  source     text not null check (source in ('edge','rpc','webhook','client')),
  level      text not null default 'info' check (level in ('info','warn','error')),
  event      text not null,
  ref        text,
  detail     jsonb,
  latency_ms int
);

-- recent-first scans (op_log_recent, dashboards)
create index if not exists op_log_at_idx on op_log (at desc);
-- error-only partial index keeps op_health's hot path tiny even as
-- info volume dominates
create index if not exists op_log_err_idx on op_log (source, at desc) where level = 'error';
-- latency percentiles are computed over rows that carry a latency
create index if not exists op_log_lat_idx on op_log (at desc) where latency_ms is not null;

-- RLS on, ZERO policies → the public anon role can neither SELECT nor
-- write directly. Writes flow through op_log_write (SECURITY DEFINER),
-- reads through the admin-gated RPCs below. No PII lives here beyond a
-- caller-supplied ref, and money is never stored.
alter table op_log enable row level security;

-- ---- write path: fire-and-forget from any layer -------------
-- SECURITY DEFINER so it can insert past RLS. Normalizes/clamps every
-- field and SWALLOWS its own errors: observability must never turn a
-- working request into a failed one.
create or replace function op_log_write(
  p_source text, p_level text, p_event text,
  p_ref text, p_detail jsonb, p_latency int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into op_log(source, level, event, ref, detail, latency_ms)
  values (
    case when coalesce(p_source,'') in ('edge','rpc','webhook','client') then p_source else 'client' end,
    case when coalesce(p_level,'')  in ('info','warn','error')          then p_level  else 'info'   end,
    left(coalesce(nullif(trim(p_event),''),'(none)'), 120),
    left(p_ref, 120),
    p_detail,
    case when p_latency between 0 and 3600000 then p_latency else null end
  );
exception when others then
  -- never propagate: a logging failure is not the caller's problem
  null;
end $$;

-- ---- read path #1: admin health rollups (L4+) ---------------
-- error rate (last 1h / 24h) by source, p50/p95 latency where present,
-- and payment/order failure counts (guarded — those tables may predate
-- or postdate this migration).
create or replace function op_health(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_1h  jsonb;
  v_24h jsonb;
  v_p50 numeric;
  v_p95 numeric;
  v_pay_fail int := 0;
  v_ord_fail int := 0;
begin
  if admin_rank(_admin_level(p_token)) < 4 then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select coalesce(jsonb_object_agg(source, jsonb_build_object(
            'total', total, 'errors', errs,
            'err_rate', round(errs::numeric / nullif(total,0), 4))), '{}'::jsonb)
    into v_1h
  from (
    select source, count(*) total, count(*) filter (where level='error') errs
    from op_log where at > now() - interval '1 hour' group by source
  ) t;

  select coalesce(jsonb_object_agg(source, jsonb_build_object(
            'total', total, 'errors', errs,
            'err_rate', round(errs::numeric / nullif(total,0), 4))), '{}'::jsonb)
    into v_24h
  from (
    select source, count(*) total, count(*) filter (where level='error') errs
    from op_log where at > now() - interval '24 hours' group by source
  ) t;

  select percentile_cont(0.5) within group (order by latency_ms),
         percentile_cont(0.95) within group (order by latency_ms)
    into v_p50, v_p95
  from op_log
  where latency_ms is not null and at > now() - interval '1 hour';

  -- payment failures (last 24h) — payments.status: created|verified|failed
  if to_regclass('public.payments') is not null then
    select count(*) into v_pay_fail
    from payments where status = 'failed' and created_at > now() - interval '24 hours';
  end if;

  -- order failures (last 24h) — shop_orders rejected
  if to_regclass('public.shop_orders') is not null then
    select count(*) into v_ord_fail
    from shop_orders where status = 'rejected' and updated_at > now() - interval '24 hours';
  end if;

  return json_build_object(
    'ok', true,
    'at', now(),
    'err_by_source_1h',  v_1h,
    'err_by_source_24h', v_24h,
    'latency_1h_ms', json_build_object('p50', v_p50, 'p95', v_p95),
    'payment_failures_24h', v_pay_fail,
    'order_failures_24h',   v_ord_fail
  );
exception when others then
  return json_build_object('ok', false, 'reason', 'error');
end $$;

-- ---- read path #2: recent log tail (L4+) --------------------
create or replace function op_log_recent(p_token text, p_level text, p_limit int)
returns setof op_log
language plpgsql security definer set search_path = public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return; end if;   -- no rows for non-admins
  return query
    select * from op_log
    where (coalesce(p_level,'') = '' or level = p_level)
    order by at desc
    limit least(coalesce(p_limit, 50), 500);
end $$;

-- The anon key is the transport; the guard is the admin token (reads)
-- or the fact that writes are append-only + normalized (writes).
grant execute on function op_log_write(text,text,text,text,jsonb,int) to anon;
grant execute on function op_health(text) to anon;
grant execute on function op_log_recent(text,text,int) to anon;

-- ============================================================
-- SELF-PROOF (expect: raise notice 'PASS…'; asserts abort on FAIL).
-- Stands up a throwaway L5 admin + session, writes logs THROUGH the
-- RPC, checks that op_health rolls the errors up and that both read
-- RPCs are admin-gated, then deletes every temp row it made.
-- ============================================================
do $$
declare
  v_tok    text := '__optest_token_deadbeef__';
  v_admin  text := '__optest_admin__';
  v_health json;
  v_n      int;
  v_bad    int;
begin
  insert into admin_users(ident, level, name, active) values (v_admin, 'l5', 'optest', true)
    on conflict (ident) do update set level='l5', active=true;
  insert into auth_sessions(token, ident, device_key) values (v_tok, v_admin, 'dev_optest')
    on conflict (token) do nothing;

  -- exercise the real write RPC (what edge/rpc/webhook/client will call)
  perform op_log_write('edge','error','optest_err','__optest_r1__', jsonb_build_object('k',1), 42);
  perform op_log_write('edge','error','optest_err','__optest_r2__', null, 120);
  perform op_log_write('rpc', 'info', 'optest_ok', '__optest_r3__', null, 8);
  -- garbage source/level normalized, negative latency clamped to null
  perform op_log_write('nonsense','weird','optest_norm','__optest_r4__', null, -5);

  select count(*) into v_n from op_log where ref like '__optest_%';
  assert v_n = 4, 'FAIL: op_log_write did not append all 4 rows';
  assert (select level from op_log where ref='__optest_r4__') = 'info',
         'FAIL: invalid level not normalized';
  assert (select latency_ms from op_log where ref='__optest_r4__') is null,
         'FAIL: negative latency not clamped';

  -- health must reflect the two edge errors we just wrote
  v_health := op_health(v_tok);
  assert (v_health->>'ok') = 'true', 'FAIL: admin op_health denied';
  assert ((v_health->'err_by_source_1h'->'edge'->>'errors')::int) >= 2,
         'FAIL: op_health error rollup wrong';
  assert (v_health->>'payment_failures_24h') is not null, 'FAIL: health missing payment failures';
  assert (v_health->>'order_failures_24h')   is not null, 'FAIL: health missing order failures';

  -- admin reads the tail; non-admin gets nothing
  select count(*) into v_n from op_log_recent(v_tok, 'error', 100) where ref like '__optest_%';
  assert v_n = 2, 'FAIL: op_log_recent(error) should return exactly the 2 errors';
  select count(*) into v_bad from op_log_recent('__no_such_token__', null, 100);
  assert v_bad = 0, 'FAIL: op_log_recent leaked rows to a non-admin';
  assert (op_health('__no_such_token__')->>'ok') = 'false', 'FAIL: op_health not gated';

  -- cleanup
  delete from op_log where ref like '__optest_%';
  delete from auth_sessions where token = v_tok;
  delete from admin_users where ident = v_admin;

  raise notice 'PASS: op_log_write appends+normalizes, op_health rolls up errors, reads are admin-gated';
end $$;

select 'observability ready' as status;
