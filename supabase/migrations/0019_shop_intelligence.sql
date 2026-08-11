-- 0019 shop_intelligence — NOT YET APPLIED (written by full-build)
-- ============================================================
-- GROUNDED SHOP INTELLIGENCE — analytical TOOLS over REAL data, not a chatbot.
--
-- Every RPC here is READ-ONLY and device-scoped: it derives the caller's shop id
-- server-side (_my_shop(p_device) from migration 0005 -> 'my_'||substr(p_device,1,12))
-- and only ever reads THAT shop's rows. The public anon key is not identity, so
-- these functions never trust a client-supplied shop id.
--
-- TOOL-PERMISSION POSTURE (read this before wiring an agent on top):
--   These are the SAFE half of an agent's toolbelt — describe/measure only.
--   They mint no money, move no stock, change no status. Any WRITE or FINANCIAL
--   action (payout, refund, bank-account change, price override, order status)
--   is EXPLICITLY OUT OF SCOPE here and MUST route through the existing
--   human-approved RPCs (shop_order_status, po_advance, payouts, ...). An agent
--   may reason over merchant_twin() freely; it may not act without human sign-off.
--
-- DATA SOURCES (all already exist — see 0005_supply_chain.sql / shop_orders_schema.sql):
--   • shop_orders(shop_id, items jsonb, total, status, created_at) — realised sales.
--     Revenue counts only status='done' (the fulfilled terminal; stock_sell fires on
--     the same completion, so revenue and stock draw-down stay consistent).
--     Order items jsonb shape (from myshop.js): [{name, price, q}] (q = quantity;
--     'qty' accepted as a fallback key).
--   • stock_ledger(shop_id, item_name, delta, reason, created_at) — append-only.
--     on_hand = sum(delta); sales velocity = -sum(delta) over reason='sale' in a window.
--
-- ALGORITHM PROGRESSION (anti-cargo-cult: simplest sufficient stage is implemented):
--   Stage 1 (NOW): descriptive SQL — trailing-window sums, a moving-average daily
--     draw-down rate, and a textbook reorder point (rate * (lead + safety)).
--   Stage 2 (when a shop has >~8 weeks of daily sales AND visible weekday/seasonal
--     swing): replace the flat moving average feeding shop_reorder_suggestions with
--     single-exponential smoothing  s_t = a*d_t + (1-a)*s_{t-1}  (a~0.3), computed in
--     SQL over daily buckets — no new infra, just a windowed recursion/ordered agg.
--   Stage 3 (only if forecast error stays high after Stage 2 across many shops):
--     a shared demand model (still Postgres; pgvector only if you add item-similarity
--     cold-start). Do NOT reach for queues/ML services at these volumes.
-- ============================================================

-- Index that makes every revenue/velocity scan below shop- and status-selective.
create index if not exists shop_orders_shop_status_created_idx
  on shop_orders (shop_id, status, created_at desc);

-- ── 1. sales summary: revenue, orders, AOV, best day ─────────
create or replace function shop_sales_summary(p_device text, p_days int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_days int; v_since timestamptz;
        v_rev numeric; v_orders int; v_aov numeric;
        v_top_day date; v_top_rev numeric;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;
  v_days  := greatest(1, coalesce(p_days, 30));
  v_since := now() - (v_days || ' days')::interval;

  select coalesce(sum(total), 0), count(*)
    into v_rev, v_orders
    from shop_orders
   where shop_id = v_shop and status = 'done' and created_at >= v_since;

  v_aov := case when v_orders > 0 then round(v_rev / v_orders, 2) else 0 end;

  select created_at::date, sum(total)
    into v_top_day, v_top_rev
    from shop_orders
   where shop_id = v_shop and status = 'done' and created_at >= v_since
   group by created_at::date
   order by sum(total) desc nulls last
   limit 1;

  return json_build_object('ok', true, 'shop', v_shop, 'days', v_days,
    'revenue', v_rev, 'orders', v_orders, 'aov', v_aov,
    'top_day', v_top_day, 'top_day_revenue', coalesce(v_top_rev, 0));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── 2. top items: best sellers by revenue then units ─────────
create or replace function shop_top_items(p_device text, p_days int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_days int; v_since timestamptz;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;
  v_days  := greatest(1, coalesce(p_days, 30));
  v_since := now() - (v_days || ' days')::interval;

  return json_build_object('ok', true, 'shop', v_shop, 'days', v_days,
    'items', (
      select coalesce(json_agg(row_to_json(t) order by t.revenue desc, t.units desc), '[]'::json)
      from (
        select max(e->>'name') as name,
               sum(coalesce(nullif(e->>'q','')::numeric, nullif(e->>'qty','')::numeric, 1)) as units,
               sum(coalesce(nullif(e->>'q','')::numeric, nullif(e->>'qty','')::numeric, 1)
                   * coalesce(nullif(e->>'price','')::numeric, 0)) as revenue,
               count(distinct o.id) as orders
        from shop_orders o
        cross join lateral jsonb_array_elements(o.items) e
        where o.shop_id = v_shop and o.status = 'done' and o.created_at >= v_since
          and jsonb_typeof(o.items) = 'array'
          and coalesce(e->>'name','') <> ''
        group by lower(trim(e->>'name'))
        order by revenue desc, units desc
        limit 20
      ) t));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── 3. slow movers: in stock (on_hand>0) but zero sales in window ─
create or replace function shop_slow_movers(p_device text, p_days int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_days int; v_since timestamptz;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;
  v_days  := greatest(1, coalesce(p_days, 30));
  v_since := now() - (v_days || ' days')::interval;

  return json_build_object('ok', true, 'shop', v_shop, 'days', v_days,
    'items', (
      select coalesce(json_agg(row_to_json(t) order by t.on_hand desc), '[]'::json)
      from (
        select l.item_name,
               sum(l.delta) as on_hand,
               coalesce(-sum(l.delta) filter (where l.reason = 'sale' and l.created_at >= v_since), 0) as units_sold,
               max(l.created_at) filter (where l.reason = 'sale') as last_sold
        from stock_ledger l
        where l.shop_id = v_shop
        group by l.item_name
        having sum(l.delta) > 0
           and coalesce(-sum(l.delta) filter (where l.reason = 'sale' and l.created_at >= v_since), 0) = 0
        limit 50
      ) t));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── 4. reorder suggestions: on-hand vs projected lead-time demand ─
-- reorder_point = daily_rate * (lead + safety)   [textbook, flat safety-stock stage]
-- suggest_qty   = bring stock up to (lead + safety + review) days of cover.
-- daily_rate is a 14-day moving average of sale draw-down (Stage-1 forecast;
-- swap for exponential smoothing at Stage 2 — see header).
create or replace function shop_reorder_suggestions(p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text;
        v_lead   numeric := 3;   -- days from order to shelf (assumed; make per-supplier later)
        v_safety numeric := 2;   -- buffer against demand variability
        v_review numeric := 7;   -- reorder cadence -> order up to this much cover
        v_win    int     := 14;  -- velocity lookback (days)
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;

  return json_build_object('ok', true, 'shop', v_shop,
    'lead_days', v_lead, 'safety_days', v_safety, 'velocity_window_days', v_win,
    'items', (
      select coalesce(json_agg(row_to_json(t) order by (t.on_hand - t.reorder_point) asc), '[]'::json)
      from (
        select b.item_name,
               b.on_hand,
               b.daily_rate,
               b.reorder_point,
               (b.on_hand <= b.reorder_point and b.daily_rate > 0) as needs_reorder,
               case when (b.on_hand <= b.reorder_point and b.daily_rate > 0)
                    then greatest(0, ceil(b.daily_rate * (v_lead + v_safety + v_review) - b.on_hand))
                    else 0 end as suggest_qty
        from (
          select a.item_name, a.on_hand, a.daily_rate,
                 round(a.daily_rate * (v_lead + v_safety), 3) as reorder_point
          from (
            select l.item_name,
                   sum(l.delta) as on_hand,
                   round(
                     coalesce(-sum(l.delta) filter (
                       where l.reason = 'sale'
                         and l.created_at >= now() - (v_win || ' days')::interval), 0) / v_win, 3
                   ) as daily_rate
            from stock_ledger l
            where l.shop_id = v_shop
            group by l.item_name
          ) a
        ) b
      ) t));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── 5. week-over-week: this 7 days vs the prior 7 days ───────
create or replace function shop_week_changes(p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_now timestamptz := now();
        v_rev_t numeric; v_ord_t int; v_rev_p numeric; v_ord_p int;
        v_top_t text; v_top_p text;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;

  select coalesce(sum(total), 0), count(*) into v_rev_t, v_ord_t
    from shop_orders
   where shop_id = v_shop and status = 'done'
     and created_at >= v_now - interval '7 days';

  select coalesce(sum(total), 0), count(*) into v_rev_p, v_ord_p
    from shop_orders
   where shop_id = v_shop and status = 'done'
     and created_at <  v_now - interval '7 days'
     and created_at >= v_now - interval '14 days';

  select name into v_top_t from (
    select e->>'name' as name,
           sum(coalesce(nullif(e->>'q','')::numeric, nullif(e->>'qty','')::numeric, 1)) as u
    from shop_orders o cross join lateral jsonb_array_elements(o.items) e
    where o.shop_id = v_shop and o.status = 'done'
      and o.created_at >= v_now - interval '7 days'
      and jsonb_typeof(o.items) = 'array' and coalesce(e->>'name','') <> ''
    group by e->>'name' order by u desc limit 1) x;

  select name into v_top_p from (
    select e->>'name' as name,
           sum(coalesce(nullif(e->>'q','')::numeric, nullif(e->>'qty','')::numeric, 1)) as u
    from shop_orders o cross join lateral jsonb_array_elements(o.items) e
    where o.shop_id = v_shop and o.status = 'done'
      and o.created_at <  v_now - interval '7 days'
      and o.created_at >= v_now - interval '14 days'
      and jsonb_typeof(o.items) = 'array' and coalesce(e->>'name','') <> ''
    group by e->>'name' order by u desc limit 1) x;

  return json_build_object('ok', true, 'shop', v_shop,
    'revenue', json_build_object('this', v_rev_t, 'prev', v_rev_p,
        'delta', v_rev_t - v_rev_p,
        'pct', case when v_rev_p > 0 then round((v_rev_t - v_rev_p) / v_rev_p * 100, 1) else null end),
    'orders', json_build_object('this', v_ord_t, 'prev', v_ord_p,
        'delta', v_ord_t - v_ord_p,
        'pct', case when v_ord_p > 0 then round((v_ord_t - v_ord_p)::numeric / v_ord_p * 100, 1) else null end),
    'top_item', json_build_object('this', v_top_t, 'prev', v_top_p,
        'changed', (coalesce(lower(v_top_t),'') <> coalesce(lower(v_top_p),''))));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── 6. merchant_twin: one JSON an agent can reason over ──────
-- Store state + inventory health + demand + top/slow + reorder flags, plus an
-- explicit permission envelope so the agent knows what it may NOT do.
create or replace function merchant_twin(p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_name text; v_open boolean; v_rating numeric; v_cat text;
        v_menu int; v_out int; v_low int; v_tracked int;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;

  select name, is_open, rating, category
    into v_name, v_open, v_rating, v_cat
    from shops where id = v_shop;

  select count(*) into v_menu from shop_items where shop_id = v_shop;

  select count(*) filter (where on_hand <= 0),
         count(*) filter (where on_hand > 0 and on_hand <= 5),
         count(*)
    into v_out, v_low, v_tracked
    from (select item_name, sum(delta) as on_hand
          from stock_ledger where shop_id = v_shop group by item_name) s;

  return json_build_object('ok', true, 'shop', v_shop, 'generated_at', now(),
    'permissions', json_build_object(
       'tools', 'read-only',
       'may', json_build_array('read sales', 'read inventory', 'read demand', 'suggest reorder'),
       'out_of_scope', json_build_array('payout', 'refund', 'bank-change', 'price-override', 'order-status'),
       'note', 'write & financial actions require human approval'),
    'store', json_build_object(
       'name', v_name, 'is_open', coalesce(v_open, false),
       'rating', coalesce(v_rating, 0), 'category', v_cat, 'menu_items', coalesce(v_menu, 0)),
    'inventory_health', json_build_object(
       'tracked_items', coalesce(v_tracked, 0),
       'out_of_stock', coalesce(v_out, 0),
       'low_stock', coalesce(v_low, 0)),
    'demand_30d',   shop_sales_summary(p_device, 30),
    'week_changes', shop_week_changes(p_device),
    'top_items',    shop_top_items(p_device, 30),
    'slow_movers',  shop_slow_movers(p_device, 14),
    'reorder',      shop_reorder_suggestions(p_device));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── grants: the device key is the guard, so anon may execute ──
grant execute on function shop_sales_summary(text, int)      to anon;
grant execute on function shop_top_items(text, int)          to anon;
grant execute on function shop_slow_movers(text, int)        to anon;
grant execute on function shop_reorder_suggestions(text)     to anon;
grant execute on function shop_week_changes(text)            to anon;
grant execute on function merchant_twin(text)                to anon;

-- ------------------------------------------------------------
-- SELF-PROOF (seeds real rows, exercises the tools, asserts, cleans up)
--   Proves: (a) top_items ranks the true best-seller first,
--           (b) sales_summary sums only 'done' orders,
--           (c) reorder flags an item drawn below its point and NOT one with cover,
--           (d) merchant_twin returns the rollup sections.
-- ------------------------------------------------------------
do $$
declare v_dev  text := 'devinteltest0001';
        v_shop text := 'my_' || substr('devinteltest0001', 1, 12);   -- my_devinteltest
        j jsonb; top1 text; reord jsonb; el jsonb;
        milk_flagged boolean := false; rice_flagged boolean := false;
begin
  -- clean any residue from a prior run
  delete from shop_orders where shop_id = v_shop;
  delete from stock_ledger where shop_id = v_shop;
  if to_regclass('public.shop_order_events') is not null then
    delete from shop_order_events where order_id in ('INTEL_O1','INTEL_O2','INTEL_O3');
  end if;
  -- CRITICAL (review 0019 P1): inserting shop_orders fires trg_settle_shop_order
  -- (settlements_schema.sql:53) which writes settlement_ledger rows. Clean those
  -- too, or the proof leaves PHANTOM FINANCIAL rows behind after it runs.
  if to_regclass('public.settlement_ledger') is not null then
    delete from settlement_ledger where order_ref in ('INTEL_O1','INTEL_O2','INTEL_O3');
  end if;

  -- realised sales: Samosa is the clear best-seller; O3 is 'new' and must be excluded
  insert into shop_orders(id, shop_id, buyer_device, items, total, status, created_at) values
   ('INTEL_O1', v_shop, 'buyerdev0001',
      '[{"name":"Samosa","price":15,"q":10},{"name":"Chai","price":10,"q":2}]'::jsonb, 170, 'done', now() - interval '2 days'),
   ('INTEL_O2', v_shop, 'buyerdev0002',
      '[{"name":"Samosa","price":15,"q":5},{"name":"Poha","price":30,"q":1}]'::jsonb, 105, 'done', now() - interval '1 days'),
   ('INTEL_O3', v_shop, 'buyerdev0003',
      '[{"name":"Chai","price":10,"q":1}]'::jsonb, 10, 'new', now());

  -- stock: Milk drawn to on_hand=2 with high velocity -> must flag;
  --        Rice at on_hand=49 with trivial velocity -> must NOT flag.
  insert into stock_ledger(shop_id, item_name, delta, reason, created_at) values
   (v_shop, 'Milk',  20, 'purchase', now() - interval '20 days'),
   (v_shop, 'Milk',  -6, 'sale',     now() - interval '10 days'),
   (v_shop, 'Milk',  -6, 'sale',     now() - interval '6 days'),
   (v_shop, 'Milk',  -6, 'sale',     now() - interval '2 days'),
   (v_shop, 'Rice',  50, 'purchase', now() - interval '20 days'),
   (v_shop, 'Rice',  -1, 'sale',     now() - interval '3 days');

  -- (a) best-seller first
  j := shop_top_items(v_dev, 30)::jsonb;
  top1 := (j->'items'->0->>'name');
  assert lower(coalesce(top1,'')) = 'samosa', 'FAIL: expected Samosa as top item, got ' || coalesce(top1, '<null>');

  -- (b) revenue = 170 + 105 = 275 over 2 done orders (O3 excluded)
  j := shop_sales_summary(v_dev, 30)::jsonb;
  assert (j->>'orders')::int = 2, 'FAIL: expected 2 done orders, got ' || (j->>'orders');
  assert (j->>'revenue')::numeric = 275, 'FAIL: expected revenue 275, got ' || (j->>'revenue');

  -- (c) reorder flags Milk, not Rice
  reord := shop_reorder_suggestions(v_dev)::jsonb;
  for el in select value from jsonb_array_elements(reord->'items') loop
    if lower(el->>'item_name') = 'milk' then milk_flagged := (el->>'needs_reorder')::boolean; end if;
    if lower(el->>'item_name') = 'rice' then rice_flagged := (el->>'needs_reorder')::boolean; end if;
  end loop;
  assert milk_flagged,     'FAIL: Milk (on_hand 2, high velocity) should be flagged for reorder';
  assert not rice_flagged, 'FAIL: Rice (on_hand 49, trivial velocity) must NOT be flagged';

  -- (d) twin rollup shape
  j := merchant_twin(v_dev)::jsonb;
  assert j ? 'inventory_health' and j ? 'reorder' and j ? 'demand_30d' and j ? 'permissions',
    'FAIL: merchant_twin missing expected sections';

  -- cleanup
  delete from shop_orders where shop_id = v_shop;
  delete from stock_ledger where shop_id = v_shop;
  if to_regclass('public.shop_order_events') is not null then
    delete from shop_order_events where order_id in ('INTEL_O1','INTEL_O2','INTEL_O3');
  end if;
  -- CRITICAL (review 0019 P1): inserting shop_orders fires trg_settle_shop_order
  -- (settlements_schema.sql:53) which writes settlement_ledger rows. Clean those
  -- too, or the proof leaves PHANTOM FINANCIAL rows behind after it runs.
  if to_regclass('public.settlement_ledger') is not null then
    delete from settlement_ledger where order_ref in ('INTEL_O1','INTEL_O2','INTEL_O3');
  end if;

  raise notice 'PASS: shop intelligence verified (top item, revenue, reorder flag, twin rollup)';
end $$;

select 'shop_intelligence ready' as status;
