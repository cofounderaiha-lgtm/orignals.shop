-- ============================================================
-- 0024 — SHOPIFY-GRADE CATALOG: product variants + discount engine  (⚠ FROZEN)
--   Written 2026-08-12, validated locally (PGlite), NOT applied to production.
--
-- Two merchant capabilities that lift Orignals toward Shopify-class:
--   (1) PRODUCT VARIANTS — a shop_item ("product") can have option-combinations
--       (Size/Color…) as purchasable variants, each with its own SKU / price /
--       stock. Backward compatible: a product with no variants sells as-is.
--   (2) DISCOUNT ENGINE — real, SERVER-AUTHORITATIVE discounts (codes + automatic),
--       typed (percentage / fixed / free_delivery), with min-spend, total usage
--       limit, per-customer limit, validity window, and IDEMPOTENT redemption.
--       This replaces the hardcoded client-side coupons (js/data.js) — the client
--       can no longer fabricate a discount; the server computes and gates it
--       (closes the client-authoritative-pricing concern for discounts).
-- Ownership is derived server-side from the device via _my_shop() (0005).
-- ============================================================

-- ---------- (1) PRODUCT VARIANTS ----------
create table if not exists product_variants (
  id         text primary key,
  item_id    text not null references shop_items(id) on delete cascade,
  shop_id    text not null,                 -- denormalized (ownership + queries)
  sku        text,
  title      text,                          -- 'M / Red'
  options    jsonb,                         -- {"Size":"M","Color":"Red"}
  price      numeric(10,2) not null check (price >= 0),
  mrp        numeric(10,2),
  in_stock   boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists pv_item_idx on product_variants(item_id, position);
create index if not exists pv_shop_idx on product_variants(shop_id);
create unique index if not exists pv_sku_once on product_variants(shop_id, sku) where sku is not null and sku <> '';
alter table product_variants enable row level security;
-- catalog is public to read (no PII); writes go through variant_set (device-owned)
drop policy if exists pv_read on product_variants;
create policy pv_read on product_variants for select using (true);

-- owner REPLACES the variant set for one of THEIR products
create or replace function variant_set(p_device text, p_item text, p_variants jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_shop text := _my_shop(p_device); v_owner text; v jsonb; n int := 0;
begin
  select shop_id into v_owner from shop_items where id = p_item;
  if v_owner is null then return json_build_object('ok', false, 'reason', 'no_product'); end if;
  if v_owner <> v_shop then return json_build_object('ok', false, 'reason', 'not_your_product'); end if;
  delete from product_variants where item_id = p_item;      -- replace
  for v in select value from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb)) loop
    insert into product_variants(id, item_id, shop_id, sku, title, options, price, mrp, in_stock, position)
    values (coalesce(nullif(v->>'id',''), 'v_' || md5(p_item || coalesce(v->>'title','') || n::text)),
            p_item, v_shop, left(nullif(v->>'sku',''),40), left(v->>'title',80), v->'options',
            greatest(coalesce((v->>'price')::numeric,0),0), nullif(v->>'mrp','')::numeric,
            coalesce((v->>'in_stock')::boolean, true), n);
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'variants', n);
end $$;
grant execute on function variant_set(text, text, jsonb) to anon;

-- ---------- (2) DISCOUNT ENGINE ----------
create table if not exists discounts (
  id                text primary key,
  shop_id           text not null,          -- owning shop (or a platform id for global)
  code              text,                   -- null = automatic discount
  title             text,
  kind              text not null default 'percentage',  -- percentage | fixed | free_delivery
  value             numeric not null default 0 check (value >= 0),
  min_subtotal      numeric,
  applies_scope     text not null default 'shop',        -- shop | all
  starts_at         timestamptz,
  ends_at           timestamptz,
  usage_limit       int,                    -- total redemptions allowed (null = unlimited)
  per_customer_limit int,                   -- per device (null = unlimited)
  used_count        int not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
create unique index if not exists disc_code_once on discounts(shop_id, lower(code)) where code is not null and code <> '';
create index if not exists disc_active_idx on discounts(active, shop_id) where active;
alter table discounts enable row level security;   -- NO anon read (codes/limits are not public); access via RPCs

create table if not exists discount_redemptions (
  id          bigint generated always as identity primary key,
  discount_id text not null,
  device_key  text,
  order_ref   text,
  amount      numeric,
  at          timestamptz not null default now()
);
create unique index if not exists dr_once on discount_redemptions(discount_id, order_ref);
create index if not exists dr_dev_idx on discount_redemptions(discount_id, device_key);
alter table discount_redemptions enable row level security;

-- owner creates/updates a discount (device-scoped)
create or replace function discount_upsert(p_device text, p_discount jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_shop text := _my_shop(p_device); v_id text;
begin
  if p_discount is null then return json_build_object('ok', false, 'reason', 'no_data'); end if;
  v_id := coalesce(nullif(p_discount->>'id',''), 'disc_' || md5(v_shop || '|' || coalesce(p_discount->>'code','') || '|' || coalesce(p_discount->>'title','')));
  insert into discounts(id, shop_id, code, title, kind, value, min_subtotal, applies_scope,
                        starts_at, ends_at, usage_limit, per_customer_limit, active)
  values (v_id, v_shop, nullif(p_discount->>'code',''), left(p_discount->>'title',80),
          coalesce(nullif(p_discount->>'kind',''),'percentage'), greatest(coalesce((p_discount->>'value')::numeric,0),0),
          nullif(p_discount->>'min_subtotal','')::numeric, coalesce(nullif(p_discount->>'applies_scope',''),'shop'),
          nullif(p_discount->>'starts_at','')::timestamptz, nullif(p_discount->>'ends_at','')::timestamptz,
          nullif(p_discount->>'usage_limit','')::int, nullif(p_discount->>'per_customer_limit','')::int,
          coalesce((p_discount->>'active')::boolean, true))
  on conflict (id) do update set
    code=excluded.code, title=excluded.title, kind=excluded.kind, value=excluded.value,
    min_subtotal=excluded.min_subtotal, applies_scope=excluded.applies_scope, starts_at=excluded.starts_at,
    ends_at=excluded.ends_at, usage_limit=excluded.usage_limit, per_customer_limit=excluded.per_customer_limit,
    active=excluded.active
  where discounts.shop_id = v_shop;         -- an id owned by another shop is never overwritten
  return json_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function discount_upsert(text, jsonb) to anon;

-- SERVER-AUTHORITATIVE validation: the client cannot fabricate a discount — it must
-- call this and the server decides the amount. Read-only.
create or replace function discount_validate(p_code text, p_shop text, p_subtotal numeric, p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare d record; v_amt numeric; v_mine int;
begin
  if coalesce(p_code,'') = '' then return json_build_object('ok', false, 'reason', 'no_code'); end if;
  select * into d from discounts
   where lower(code) = lower(trim(p_code)) and active and (shop_id = p_shop or applies_scope = 'all')
   order by (shop_id = p_shop) desc limit 1;                 -- prefer a shop-specific code
  if d.id is null then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if d.starts_at is not null and now() < d.starts_at then return json_build_object('ok', false, 'reason', 'not_started'); end if;
  if d.ends_at   is not null and now() > d.ends_at   then return json_build_object('ok', false, 'reason', 'expired'); end if;
  if coalesce(p_subtotal,0) < coalesce(d.min_subtotal,0) then return json_build_object('ok', false, 'reason', 'below_min', 'min', d.min_subtotal); end if;
  if d.usage_limit is not null and d.used_count >= d.usage_limit then return json_build_object('ok', false, 'reason', 'used_up'); end if;
  if d.per_customer_limit is not null and coalesce(p_device,'') <> '' then
    select count(*) into v_mine from discount_redemptions where discount_id = d.id and device_key = p_device;
    if v_mine >= d.per_customer_limit then return json_build_object('ok', false, 'reason', 'customer_limit'); end if;
  end if;
  v_amt := case d.kind
    when 'percentage' then round(coalesce(p_subtotal,0) * least(d.value,100) / 100.0, 2)
    when 'fixed'      then least(d.value, coalesce(p_subtotal,0))
    else 0 end;                                              -- free_delivery: amount 0, caller drops delivery fee
  return json_build_object('ok', true, 'id', d.id, 'kind', d.kind, 'value', d.value,
                           'amount', coalesce(v_amt,0), 'code', d.code);
end $$;
grant execute on function discount_validate(text, text, numeric, text) to anon;

-- redeem at order placement — idempotent per order; bumps used_count once
create or replace function discount_redeem(p_code text, p_shop text, p_device text, p_order text, p_subtotal numeric)
returns json language plpgsql security definer set search_path = public as $$
declare v json; d_id text; v_amt numeric; v_new boolean;
begin
  v := discount_validate(p_code, p_shop, p_subtotal, p_device);
  if (v->>'ok') <> 'true' then return v; end if;
  d_id := v->>'id'; v_amt := (v->>'amount')::numeric;
  insert into discount_redemptions(discount_id, device_key, order_ref, amount)
    values (d_id, p_device, p_order, v_amt)
    on conflict (discount_id, order_ref) do nothing;
  get diagnostics v_new = row_count;                         -- 1 = new redemption, 0 = replay
  if v_new then update discounts set used_count = used_count + 1 where id = d_id; end if;
  return json_build_object('ok', true, 'amount', v_amt, 'kind', v->>'kind');
end $$;
grant execute on function discount_redeem(text, text, text, text, numeric) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_dev text := 'catdev01'; v_shop text := _my_shop('catdev01'); r json;
begin
  delete from product_variants where item_id = 'CITEM1';
  delete from discount_redemptions where discount_id in (select id from discounts where shop_id = v_shop);
  delete from discounts where shop_id = v_shop;
  delete from shop_items where id = 'CITEM1';
  delete from shops where id = v_shop;

  insert into shops(id, name, category, delivery, rating) values (v_shop, 'Cat Test', 'fashion', 'both', 5.0);
  insert into shop_items(id, shop_id, name, price) values ('CITEM1', v_shop, 'T-Shirt', 299);

  -- VARIANTS: owner sets 2, wrong device refused
  r := variant_set(v_dev, 'CITEM1', '[{"title":"S","price":299,"sku":"TS-S","options":{"Size":"S"}},{"title":"M","price":349,"sku":"TS-M","options":{"Size":"M"}}]'::jsonb);
  assert (r->>'ok')='true' and (r->>'variants')::int = 2, 'FAIL: variant_set';
  assert (select count(*) from product_variants where item_id='CITEM1') = 2, 'FAIL: variants not stored';
  r := variant_set('someoneelse99', 'CITEM1', '[]'::jsonb);
  assert (r->>'ok')='false' and (r->>'reason')='not_your_product', 'FAIL: foreign variant write allowed';

  -- DISCOUNT: create 10% off min 100, total-limit 2, per-customer 1
  r := discount_upsert(v_dev, '{"code":"SAVE10","title":"10% off","kind":"percentage","value":10,"min_subtotal":100,"usage_limit":2,"per_customer_limit":1}'::jsonb);
  assert (r->>'ok')='true', 'FAIL: discount_upsert';

  -- validate: 200 → 20 off; 50 → below_min
  r := discount_validate('SAVE10', v_shop, 200, 'cust1');
  assert (r->>'ok')='true' and (r->>'amount')::numeric = 20, 'FAIL: 10% of 200 != 20, got '||(r->>'amount');
  r := discount_validate('SAVE10', v_shop, 50, 'cust1');
  assert (r->>'ok')='false' and (r->>'reason')='below_min', 'FAIL: below-min not enforced';

  -- redeem idempotent per order
  r := discount_redeem('SAVE10', v_shop, 'cust1', 'ORDER_A', 200);
  assert (r->>'ok')='true' and (r->>'amount')::numeric = 20, 'FAIL: redeem';
  r := discount_redeem('SAVE10', v_shop, 'cust1', 'ORDER_A', 200);   -- replay same order
  assert (select used_count from discounts where shop_id=v_shop and code='SAVE10') = 1, 'FAIL: redeem not idempotent';

  -- per-customer limit: cust1 already used once (limit 1) → now blocked
  r := discount_validate('SAVE10', v_shop, 200, 'cust1');
  assert (r->>'ok')='false' and (r->>'reason')='customer_limit', 'FAIL: per-customer limit not enforced';

  -- a different customer can still use it (until the total limit)
  r := discount_validate('SAVE10', v_shop, 200, 'cust2');
  assert (r->>'ok')='true', 'FAIL: second customer wrongly blocked';

  -- cleanup
  delete from product_variants where item_id='CITEM1';
  delete from discount_redemptions where discount_id in (select id from discounts where shop_id=v_shop);
  delete from discounts where shop_id=v_shop;
  delete from shop_items where id='CITEM1';
  delete from shops where id=v_shop;
  raise notice 'PASS: variants (owner-scoped) + server-authoritative discounts (min/limits/idempotent/per-customer)';
end $$;

select 'shopify-grade catalog (variants + discounts) ready' as status;
