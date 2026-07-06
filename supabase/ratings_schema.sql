-- ============================================================
-- ORIGNALS RATINGS — real, aggregated, cross-device.
-- A buyer's post-delivery rating recomputes the shop's average and
-- writes it back to the shops row, so every other buyer sees the
-- real, earned score. One rating per buyer per order.
-- ============================================================

create table if not exists shop_ratings (
  id bigint generated always as identity primary key,
  shop_id text not null,
  device_key text not null,
  stars int not null check (stars between 1 and 5),
  order_ref text not null default '',
  created_at timestamptz not null default now(),
  unique (shop_id, device_key, order_ref)
);
create index if not exists shop_ratings_shop_idx on shop_ratings (shop_id);

alter table shop_ratings enable row level security;
drop policy if exists sr_read on shop_ratings;
create policy sr_read on shop_ratings for select using (true);

create or replace function rate_shop(p_shop text, p_device text, p_stars int, p_order text)
returns json language plpgsql security definer set search_path = public as $$
declare v_avg numeric; v_cnt int;
begin
  insert into shop_ratings (shop_id, device_key, stars, order_ref)
  values (p_shop, p_device, p_stars, coalesce(p_order, ''))
  on conflict (shop_id, device_key, order_ref)
  do update set stars = excluded.stars, created_at = now();
  select round(avg(stars)::numeric, 1), count(*) into v_avg, v_cnt
    from shop_ratings where shop_id = p_shop;
  update shops set rating = v_avg, ratings_count = v_cnt where id = p_shop;
  return json_build_object('avg', v_avg, 'count', v_cnt);
end $$;
grant execute on function rate_shop(text, text, int, text) to anon;

select 'shop ratings ready' as status;
