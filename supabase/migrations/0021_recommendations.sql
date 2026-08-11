-- ============================================================
-- 0021 — RECOMMENDATIONS  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- A GROUNDED recommender (§12/§13) — real signals only, no fabricated "AI picks".
-- Read-only. Candidate generation → blended ranking, all in one indexed pass.
--
-- ALGORITHM PROGRESSION (§43, anti-cargo-cult), degrades gracefully as data grows:
--   Stage 1 (THIS): candidates = the live in-stock catalog; score blends
--     · personal REORDER boost   (items this device bought before)
--     · item POPULARITY          (units sold in realised orders, log-damped)
--     · PROXIMITY                 (nearer shop wins)
--     · shop RATING              (quality nudge)
--     With zero order history everything collapses to proximity+rating — i.e. a
--     sensible "nearby, well-rated, in stock" list. NEVER empty, NEVER invented.
--   Stage 2 (trigger: enough baskets that co-purchase is dense): fold co-purchase
--     ("bought together") into home candidates; add category-affinity from the
--     0018 event stream (view_item/add_to_cart). Same SQL shape.
--   Stage 3 (only with real scale + eval): learning-to-rank over the 0018 impression
--     log (reco_shown/reco_click) — which is WHY 0018 logs impressions.
--
-- Money/authoritative truth is never used to fabricate: popularity comes from
-- realised ('done') orders only; out-of-stock / closed / deleted shops are excluded.
-- ============================================================

-- self-contained haversine (consolidation with 0013/0014/0016 haversines at staging)
create or replace function _reco_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$
  select case when a_lat is null or a_lng is null or b_lat is null or b_lng is null then null
    else 2 * 6371 * asin(least(1.0, sqrt(
      power(sin(radians((b_lat - a_lat)/2)),2) +
      cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians((b_lng - a_lng)/2)),2)))) end;
$$;

-- ---------- home recommendations (personalized where data exists) ----------
create or replace function reco_home(p_device text, p_lat double precision, p_lng double precision, p_limit int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_lim int := least(greatest(coalesce(p_limit,12),1),30);
begin
  return coalesce((
    with pop as (   -- item-name popularity from REALISED orders (last 30d)
      select lower(trim(i->>'name')) nm, sum(coalesce((i->>'q')::int,1)) qty
      from shop_orders, lateral jsonb_array_elements(case when jsonb_typeof(items)='array' then items else '[]'::jsonb end) i
      where status = 'done' and created_at > now() - interval '30 days'
        and coalesce(i->>'name','') <> ''
      group by 1
    ),
    mine as (       -- what THIS device bought before → reorder boost
      select distinct lower(trim(i->>'name')) nm
      from shop_orders, lateral jsonb_array_elements(case when jsonb_typeof(items)='array' then items else '[]'::jsonb end) i
      where buyer_device = p_device and coalesce(i->>'name','') <> ''
    ),
    cands as (
      select it.id, it.name, it.price, it.qty_label, it.photo_url,
             s.id shop_id, s.name shop_name, s.rating, s.category,
             _reco_km(p_lat, p_lng, s.lat, s.lng) km,
             coalesce(pop.qty,0) pop_qty,
             (mine.nm is not null) reordered
      from shop_items it
      join shops s on s.id = it.shop_id
      left join pop  on pop.nm  = lower(trim(it.name))
      left join mine on mine.nm = lower(trim(it.name))
      where it.in_stock = true and s.is_open = true and s.deleted_at is null
    )
    select json_agg(row_to_json(r) order by r.score desc, r.km asc nulls last) from (
      select id, name, price, qty_label, photo_url, shop_id, shop_name, rating, category,
             round(km::numeric, 2) km, reordered,
             round((
                 (case when reordered then 3.0 else 0 end)      -- personal
               + ln(1 + pop_qty) * 1.2                          -- popularity (log-damped)
               + case when km is null then 0 else 1.5/(1.0+km) end  -- proximity
               + coalesce(rating,0)/5.0 * 0.5                   -- quality
             )::numeric, 4) score,
             (case when reordered then 'reorder' when pop_qty > 0 then 'popular' else 'nearby' end) reason
      from cands
      order by score desc, km asc nulls last
      limit v_lim
    ) r
  ), '[]'::json);
exception when others then return '[]'::json; end $$;
grant execute on function reco_home(text, double precision, double precision, int) to anon;

-- ---------- "bought together" for a product (co-purchase) ----------
create or replace function reco_bought_together(p_item_name text, p_limit int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_nm text := lower(trim(coalesce(p_item_name,''))); v_lim int := least(greatest(coalesce(p_limit,8),1),20);
begin
  if v_nm = '' then return '[]'::json; end if;
  return coalesce((
    with baskets as (   -- realised orders that contained this item
      select distinct o.id
      from shop_orders o, lateral jsonb_array_elements(case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end) i
      where o.status = 'done' and lower(trim(i->>'name')) = v_nm
    ),
    co as (             -- other items in those baskets, by co-occurrence
      select lower(trim(i->>'name')) nm, count(*) n
      from shop_orders o join baskets b on o.id = b.id, lateral jsonb_array_elements(case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end) i
      where lower(trim(i->>'name')) <> v_nm and coalesce(i->>'name','') <> ''
      group by 1 order by n desc limit v_lim
    )
    -- map each co-purchased NAME to one representative in-stock catalog row
    select json_agg(row_to_json(r) order by r.co_count desc) from (
      select distinct on (co.nm) co.nm item_name, co.n co_count,
             it.id, it.name, it.price, it.photo_url, s.id shop_id, s.name shop_name
      from co
      join shop_items it on lower(trim(it.name)) = co.nm and it.in_stock = true
      join shops s on s.id = it.shop_id and s.is_open = true and s.deleted_at is null
      order by co.nm, s.rating desc nulls last
    ) r
  ), '[]'::json);
exception when others then return '[]'::json; end $$;
grant execute on function reco_bought_together(text, int) to anon;

-- PAIRED CLIENT CHANGE (when staged): js/home.js calls rpc/reco_home({p_device,lat,lng})
-- for a "Recommended for you" row (badge each card by its `reason`); the shop/item page
-- calls rpc/reco_bought_together. On each render emit 'reco_shown' (0018) and on tap
-- 'reco_click' — that impression log is what a Stage-3 LTR model trains/evaluates on.

-- ---------- proof (expect PASS) ----------
do $$
declare j json; n int;
begin
  delete from shop_orders where id in ('RC_O1','RC_O2');
  delete from shop_items where id in ('rc_milk','rc_bread','rc_eggs');
  delete from shops where id in ('rc_shop');

  insert into shops(id, name, category, is_open, rating, lat, lng) values ('rc_shop','Reco Mart','grocery',true,4.6,28.6,77.2);
  insert into shop_items(id, shop_id, name, price, in_stock) values
    ('rc_milk','rc_shop','Milk',30,true), ('rc_bread','rc_shop','Bread',40,true), ('rc_eggs','rc_shop','Eggs',60,true);

  -- two realised orders: Milk+Bread bought together twice; Eggs once
  insert into shop_orders(id, shop_id, buyer_device, items, total, status, created_at) values
    ('RC_O1','rc_shop','buyerA','[{"name":"Milk","q":1},{"name":"Bread","q":1}]'::jsonb, 70, 'done', now()-interval '1 day'),
    ('RC_O2','rc_shop','buyerB','[{"name":"Milk","q":2},{"name":"Bread","q":1},{"name":"Eggs","q":1}]'::jsonb, 160, 'done', now()-interval '2 days');

  -- home reco returns in-stock items, most-popular first (Milk sold 3, Bread 2, Eggs 1)
  j := reco_home('someone', 28.6, 77.2, 10);
  assert json_array_length(j) >= 3, 'FAIL: reco_home returned too few';
  assert (j->0->>'name') = 'Milk', 'FAIL: most-popular item not ranked first, got ' || coalesce(j->0->>'name','<null>');

  -- personalization: buyerA reordering sees their prior item boosted
  j := reco_home('buyerA', 28.6, 77.2, 10);
  assert exists(select 1 from json_array_elements(j) e where e->>'reason'='reorder'),
         'FAIL: reorder boost not applied for a returning buyer';

  -- bought-together with Milk surfaces Bread (co-purchased twice)
  j := reco_bought_together('Milk', 10);
  assert exists(select 1 from json_array_elements(j) e where e->>'name'='Bread'),
         'FAIL: bought_together(Milk) did not surface Bread';

  -- graceful: unknown item → empty, not error
  assert reco_bought_together('__nope__', 10)::text = '[]', 'FAIL: unknown item not empty';

  delete from shop_orders where id in ('RC_O1','RC_O2');
  delete from shop_items where id in ('rc_milk','rc_bread','rc_eggs');
  delete from shops where id in ('rc_shop');
  raise notice 'PASS: popularity ranking, reorder personalization, co-purchase, graceful-empty';
end $$;

select 'recommendations ready' as status;
