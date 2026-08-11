-- ============================================================
-- 0018 — CANONICAL EVENT BACKBONE  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- EXTENDS the LIVE first-party analytics (analytics_schema.sql: analytics_events +
-- track_hit) — it does NOT duplicate it (that is why the agent's 0017_events was
-- deleted). Adds two things the audit (§K/§14/§36) found missing:
--   (1) ENTITY LINKING — analytics_events could not be joined to a shop/product/order,
--       so no funnel and no recommendation training. Adds entity_type/entity_id.
--   (2) A canonical BUSINESS-EVENT emit path + a real FUNNEL. The live table had
--       effectively one event ('order') and a 'signups' KPI stuck at 0 because the
--       event was never emitted.
--
-- ANTI-FORGERY (the lesson from 0017_events, which let anon spoof actor/GMV):
--   emit_event is anon and therefore may ONLY record NON-AUTHORITATIVE UX/impression
--   events from an allowlist (search, view, cart, reco impressions/clicks). It CANNOT
--   emit money/order truth. The funnel counts the TOP from these UX events but the
--   BOTTOM (orders, GMV, payments) from the REAL tables (shop_orders/payments), so a
--   beacon can never inflate revenue. Fields are capped like track_hit.
-- ============================================================

-- ---------- (1) entity linking on the existing table ----------
alter table analytics_events add column if not exists entity_type text;   -- 'shop'|'item'|'order'|'job'|'reco'
alter table analytics_events add column if not exists entity_id   text;
create index if not exists ana_entity_idx on analytics_events(entity_type, entity_id, ts desc);
-- name+entity lookups for funnel/reco training
create index if not exists ana_name_ts_idx on analytics_events(name, ts desc) where kind = 'event';

-- ---------- (2) canonical UX/impression emit (anon, allowlisted) ----------
-- These are the events reco training + funnel need (§14 impression logging). They are
-- NOT money truth. Unknown names are rejected so the stream stays clean.
create or replace function emit_event(
  p_device text, p_session text, p_name text,
  p_entity_type text, p_entity_id text, p_val numeric, p_extra jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  -- allowlist of NON-AUTHORITATIVE UX events. Money/order/payment truth is NEVER
  -- emitted here (it is derived from the real tables in funnel()).
  if coalesce(p_name,'') not in (
      'search','view_shop','view_item','add_to_cart','remove_from_cart',
      'begin_checkout','reco_shown','reco_click','wishlist','share','app_open') then
    return json_build_object('ok', false, 'reason', 'unknown_event');
  end if;
  insert into analytics_events(device, session, kind, name, entity_type, entity_id, val, extra)
  values (
    left(coalesce(p_device,''),64), left(coalesce(p_session,''),64), 'event',
    p_name,
    left(coalesce(p_entity_type,''),16),
    left(coalesce(p_entity_id,''),64),
    p_val,
    case when p_extra is not null and pg_column_size(p_extra) > 2048
         then jsonb_build_object('truncated', true) else p_extra end
  );
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'reason', 'error'); end $$;
grant execute on function emit_event(text, text, text, text, text, numeric, jsonb) to anon;

-- ---------- (3) real conversion funnel (L4+) ----------
-- TOP (impression/intent) from the event stream; BOTTOM (authoritative outcomes)
-- from the real tables. Two sources, honestly labelled — never conflated.
create or replace function funnel(p_token text, p_days int)
returns json language plpgsql security definer set search_path = public as $$
declare v_since timestamptz; v_days int;
        v_search int; v_view int; v_cart int; v_checkout int;
        v_orders int := 0; v_paid int := 0; v_gmv numeric := 0;
        v_reco_shown int; v_reco_click int;
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_days := least(greatest(coalesce(p_days,30),1),90);
  v_since := now() - (v_days || ' days')::interval;

  -- top of funnel — UX events (analytics), distinct devices
  select count(distinct device) filter (where name='search'),
         count(distinct device) filter (where name in ('view_shop','view_item')),
         count(distinct device) filter (where name='add_to_cart'),
         count(distinct device) filter (where name='begin_checkout'),
         count(*) filter (where name='reco_shown'),
         count(*) filter (where name='reco_click')
    into v_search, v_view, v_cart, v_checkout, v_reco_shown, v_reco_click
  from analytics_events where kind='event' and ts > v_since;

  -- bottom of funnel — AUTHORITATIVE outcomes from the real tables (never from a beacon)
  if to_regclass('public.shop_orders') is not null then
    select count(*), coalesce(sum(total),0) into v_orders, v_gmv
    from shop_orders where created_at > v_since and status <> 'rejected';
  end if;
  if to_regclass('public.payments') is not null then
    select count(*) into v_paid from payments where status='verified' and created_at > v_since;
  end if;

  return json_build_object('ok', true, 'days', v_days,
    'top', json_build_object(              -- impression/intent (analytics stream)
      'searched', v_search, 'viewed', v_view, 'added_to_cart', v_cart, 'began_checkout', v_checkout),
    'bottom', json_build_object(           -- authoritative (real tables)
      'orders', v_orders, 'verified_payments', v_paid, 'gmv', v_gmv),
    'reco', json_build_object('shown', v_reco_shown, 'clicked', v_reco_click,
      'ctr', case when v_reco_shown > 0 then round(v_reco_click::numeric/v_reco_shown, 4) else 0 end),
    'note', 'top = UX events (impression), bottom = real order/payment tables — not conflated');
end $$;
grant execute on function funnel(text, int) to anon;

-- PAIRED CLIENT CHANGE (when staged): js/analytics.js gets emitBiz(name,{entity,id,val,extra})
-- → rpc/emit_event. Wire: search (shops.js search), view_shop/view_item (shop page),
-- add_to_cart (core.js cartSet), begin_checkout (checkoutSheet), reco_shown/reco_click
-- (when Phase 5 recommendations ship). Money truth stays server-side (never emitted).

-- ---------- proof (expect PASS) ----------
do $$
declare r json; n int;
begin
  delete from analytics_events where device = 'evt_test_dev' and session = 'evt_test_ses';

  -- a known UX event is recorded with entity linking
  r := emit_event('evt_test_dev','evt_test_ses','view_item','item','it_123', null, jsonb_build_object('shop','sh1'));
  assert (r->>'ok')='true', 'FAIL: known UX event rejected';
  select count(*) into n from analytics_events
   where device='evt_test_dev' and name='view_item' and entity_type='item' and entity_id='it_123';
  assert n = 1, 'FAIL: event not recorded with entity linking';

  -- an UNKNOWN / money-truth name is refused (anti-forgery)
  r := emit_event('evt_test_dev','evt_test_ses','order', 'order','OM1', 99999, null);
  assert (r->>'ok')='false' and (r->>'reason')='unknown_event', 'FAIL: anon emitted a non-allowlisted (money) event';
  r := emit_event('evt_test_dev','evt_test_ses','payment_completed','order','OM1', 99999, null);
  assert (r->>'ok')='false', 'FAIL: anon emitted payment truth';

  -- oversized extra is capped, not stored raw
  r := emit_event('evt_test_dev','evt_test_ses','search', null, null, null, jsonb_build_object('q', repeat('x', 5000)));
  assert (r->>'ok')='true', 'FAIL: search event rejected';
  assert (select pg_column_size(extra) from analytics_events
          where device='evt_test_dev' and name='search' order by ts desc limit 1) < 2100,
         'FAIL: oversized extra not capped';

  delete from analytics_events where device = 'evt_test_dev' and session = 'evt_test_ses';
  raise notice 'PASS: entity-linked UX events recorded; money/unknown events refused; extra capped';
end $$;

select 'event backbone (analytics extension) ready' as status;
