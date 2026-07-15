-- ============================================================
-- WEEK1 / STEP 1 — close the worst live RLS hole: anyone can rewrite
-- any merchant's shop.
--
-- The chain (verified 2026-07-12 against the live DB):
--   schema.sql   → p_shops_read  SELECT using (deleted_at is null)  ⇒ every shop id is public
--   schema.sql   → p_shops_upd   UPDATE using (true)                ⇒ anyone may update any row
--   cloud.js:117 → client POSTs `shops?on_conflict=id` with Prefer:
--                  resolution=merge-duplicates, sending its OWN id in the payload
--   ⇒ read any shop id with the public anon key, then overwrite that
--     merchant's name / phone / GST / FSSAI / hours / offer. No identity needed.
--
-- Why the policy could not simply be dropped: the upsert NEEDS the UPDATE
-- policy — the vulnerability and the sync are the same mechanism.
-- Why no RLS predicate can fix it: an anon PostgREST request carries no
-- identity to compare a row against. There is nothing trustworthy to check.
--
-- Therefore the write moves behind a security-definer RPC that DERIVES the
-- shop id from the caller's device key and ignores whatever id the client
-- sends. Then the anon INSERT/UPDATE policies are dropped.
--
-- Honest limitation: p_device is still a client-supplied bearer string
-- (see WEEK1 Task 3 — identity is Math.random()). This does NOT fix that.
-- It fixes the far worse property that shop ids are PUBLIC, so today the
-- attack needs no secret at all. After this, an attacker must first steal a
-- specific device key. That is a real reduction in blast radius, not a cure.
-- ============================================================

create or replace function shop_upsert(p_device text, p_shop jsonb, p_items jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop_id text; v_n int := 0;
begin
  if coalesce(p_device,'') = '' or length(p_device) < 8 then
    return json_build_object('ok', false, 'reason', 'bad_device');
  end if;
  if p_shop is null or coalesce(p_shop->>'name','') = '' then
    return json_build_object('ok', false, 'reason', 'no_shop');
  end if;

  -- the id is DERIVED here. Anything the client sent as `id` is ignored.
  v_shop_id := 'my_' || substr(p_device, 1, 12);

  insert into shops (id, name, category, tagline, delivery, pure_veg, gst, fssai,
                     is_open, photo_url, lat, lng, addr, phone, open_from, open_till,
                     offer_label, offer_pct)
  values (v_shop_id,
          left(p_shop->>'name', 80),
          p_shop->>'category',
          left(coalesce(p_shop->>'tagline','Seller on Orignals'), 80),
          coalesce(p_shop->>'delivery','both')::delivery_mode,   -- enum, not text
          coalesce((p_shop->>'pure_veg')::boolean, false),
          nullif(p_shop->>'gst',''), nullif(p_shop->>'fssai',''),
          coalesce((p_shop->>'is_open')::boolean, false),
          nullif(p_shop->>'photo_url',''),
          (p_shop->>'lat')::double precision, (p_shop->>'lng')::double precision,
          nullif(p_shop->>'addr',''), nullif(p_shop->>'phone',''),
          nullif(p_shop->>'open_from',''), nullif(p_shop->>'open_till',''),
          nullif(p_shop->>'offer_label',''), (p_shop->>'offer_pct')::int)
  on conflict (id) do update set
    name=excluded.name, category=excluded.category, tagline=excluded.tagline,
    delivery=excluded.delivery, pure_veg=excluded.pure_veg, gst=excluded.gst,
    fssai=excluded.fssai, is_open=excluded.is_open, photo_url=excluded.photo_url,
    lat=excluded.lat, lng=excluded.lng, addr=excluded.addr, phone=excluded.phone,
    open_from=excluded.open_from, open_till=excluded.open_till,
    offer_label=excluded.offer_label, offer_pct=excluded.offer_pct;

  -- items: shop_id is derived too, so a caller cannot inject items into another shop
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    insert into shop_items (id, shop_id, name, qty_label, price, in_stock, icon, photo_url, section)
    select v_shop_id || '_i' || (ord - 1),
           v_shop_id,
           left(e->>'name', 80),
           nullif(e->>'qty_label',''),
           coalesce((e->>'price')::numeric, 0),
           coalesce((e->>'in_stock')::boolean, true),
           nullif(e->>'icon',''),
           nullif(e->>'photo_url',''),
           nullif(e->>'section','')
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    on conflict (id) do update set
      name=excluded.name, qty_label=excluded.qty_label, price=excluded.price,
      in_stock=excluded.in_stock, icon=excluded.icon,
      photo_url=excluded.photo_url, section=excluded.section;
    get diagnostics v_n = row_count;
  end if;

  return json_build_object('ok', true, 'shop_id', v_shop_id, 'items', v_n);
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

grant execute on function shop_upsert(text, jsonb, jsonb) to anon;

-- Now the anon write policies are no longer needed: the RPC is security definer.
-- SELECT policies stay — buyers must be able to read shops and items.
drop policy if exists p_shops_upd   on shops;
drop policy if exists p_shops_write on shops;
drop policy if exists p_items_upd   on shop_items;
drop policy if exists p_items_write on shop_items;

-- ---- proof ----
select 'shops UPDATE using(true) gone' as check,
       case when exists(select 1 from pg_policies where schemaname='public'
                        and tablename='shops' and cmd='UPDATE' and qual='true')
            then 'STILL OPEN — FAIL' else 'CLOSED — PASS' end as result
union all
select 'shops SELECT still allowed (buyers need it)',
       case when exists(select 1 from pg_policies where schemaname='public'
                        and tablename='shops' and cmd='SELECT')
            then 'PRESENT — PASS' else 'MISSING — FAIL' end
union all
select 'shop_upsert exists + is security definer',
       coalesce((select case when p.prosecdef then 'DEFINER — PASS' else 'INVOKER — FAIL' end
                 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='shop_upsert' limit 1), 'MISSING — FAIL');
