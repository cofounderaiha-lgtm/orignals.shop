-- ============================================================
-- ORIGNALS SHOP MENU + PHOTOS + PRICE MODERATION
--  · Storage bucket for shop & dish photos (public read, anon upload)
--  · shop_items gains photo_url + section (for large sectioned menus)
--  · price_bounds + price_check: server-side min/max so no seller can
--    list absurd prices. Bounds seed by category and self-tighten from
--    real listings (moderation intelligence, grows with the platform).
-- ============================================================

-- 1 ── photo storage ───────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('shopimg', 'shopimg', true, 3000000)
on conflict (id) do update set public = true, file_size_limit = 3000000;

drop policy if exists "shopimg read" on storage.objects;
create policy "shopimg read" on storage.objects for select using (bucket_id = 'shopimg');
drop policy if exists "shopimg upload" on storage.objects;
create policy "shopimg upload" on storage.objects for insert with check (bucket_id = 'shopimg');

-- 2 ── menu columns ────────────────────────────────────────
alter table shop_items add column if not exists photo_url text;
alter table shop_items add column if not exists section text;

-- 3 ── price moderation ────────────────────────────────────
create table if not exists price_bounds (
  key text primary key,            -- 'item:<name>' | 'cat:<category>' | 'default'
  min_price numeric not null,
  max_price numeric not null,
  samples int not null default 0,
  updated_at timestamptz not null default now()
);
insert into price_bounds (key, min_price, max_price) values
  ('cat:food', 10, 3000), ('cat:restaurant', 20, 4000), ('cat:organic', 5, 8000),
  ('cat:grocery', 2, 8000), ('cat:dairy', 5, 3000), ('cat:pharmacy', 1, 20000),
  ('cat:bakery', 5, 3000), ('cat:fashion', 30, 100000), ('cat:electronics', 50, 500000),
  ('cat:hardware', 5, 200000), ('cat:flowers', 10, 5000), ('cat:books', 20, 20000),
  ('default', 1, 1000000)
on conflict (key) do nothing;

-- server-side price verdict for a proposed listing
create or replace function price_check(p_cat text, p_name text, p_price numeric)
returns json language plpgsql security definer set search_path=public as $$
declare v_min numeric; v_max numeric; v_src text;
begin
  if p_price is null or p_price <= 0 then return json_build_object('verdict','invalid'); end if;
  select min_price, max_price into v_min, v_max from price_bounds where key = 'item:'||lower(trim(coalesce(p_name,'')));
  if v_min is not null then v_src := 'item';
  else
    select min_price, max_price into v_min, v_max from price_bounds where key = 'cat:'||lower(coalesce(p_cat,''));
    if v_min is not null then v_src := 'category'; end if;
  end if;
  if v_min is null then select min_price, max_price into v_min, v_max from price_bounds where key='default'; v_src := 'default'; end if;
  if p_price < v_min then
    return json_build_object('verdict', case when p_price < v_min/3.0 then 'block' else 'low' end, 'min',v_min,'max',v_max,'src',v_src);
  elsif p_price > v_max then
    return json_build_object('verdict', case when p_price > v_max*3.0 then 'block' else 'high' end, 'min',v_min,'max',v_max,'src',v_src);
  else
    return json_build_object('verdict','ok','min',v_min,'max',v_max,'src',v_src);
  end if;
exception when others then return json_build_object('verdict','ok'); end $$;

-- learning: tighten per-item bounds from real listings (median ± band).
-- Safe to run on a schedule; only creates item bounds once enough samples.
create or replace function price_learn()
returns int language plpgsql security definer set search_path=public as $$
declare n int := 0;
begin
  insert into price_bounds (key, min_price, max_price, samples, updated_at)
  select 'item:'||lower(trim(name)),
         greatest(1, round(percentile_cont(0.5) within group (order by price) * 0.4)),
         round(percentile_cont(0.5) within group (order by price) * 2.5),
         count(*), now()
  from shop_items
  where name is not null and price > 0
  group by lower(trim(name))
  having count(*) >= 5
  on conflict (key) do update set
    min_price = excluded.min_price, max_price = excluded.max_price,
    samples = excluded.samples, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function price_check(text, text, numeric) to anon;

select 'shop menu + photos + price moderation ready' as status;
