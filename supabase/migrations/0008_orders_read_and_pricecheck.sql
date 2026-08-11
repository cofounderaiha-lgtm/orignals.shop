-- ============================================================
-- ⚠ NOT YET APPLIED — written 2026-07-23 without live DB access
-- (the Management-API token was cleared from the scratchpad this session).
-- Apply in the Supabase SQL editor, or via the CLI, then keep the proof output.
--
-- Two live holes that no prior migration closed:
--
-- (1) P0 — `orders` is world-readable and carries the delivery OTP.
--     schema.sql:321 `p_orders_read on orders for select using(true)`.
--     migration 0003 dropped the orders UPDATE/INSERT policies but NOT the
--     SELECT, and harden_rls hardens the OTHER order table (shop_orders).
--     So with the public anon key:
--       curl .../rest/v1/orders?select=otp,addr_label,partner_name
--     returns every order's delivery handover OTP + area + partner →
--     delivery interception at scale.
--     `orders` is a WRITE-ONLY client mirror (orders_sync writes it; the app
--     reads its own orders from localStorage, never from this table — verified
--     by grep: no client read of the `orders` table exists), so dropping the
--     read policy breaks nothing.
--
-- (2) P2 — price_check() FAILS OPEN: `exception when others then verdict:'ok'`.
--     Any internal error APPROVES the price, so moderation is defeatable by
--     forcing an error. Inverted to 'block'. The empty-bounds case (a brand-new
--     item with no learned band) does NOT hit the exception — it returns 'ok'
--     via the normal else branch — so new items are not wrongly blocked.
-- ============================================================

-- (1) close the OTP read leak
drop policy if exists p_orders_read on orders;

-- (2) fail price moderation CLOSED
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
  -- no learned band at all → allow (new item), this is NOT an error path
  if v_min is null then return json_build_object('verdict','ok','src','none'); end if;
  if p_price < v_min then
    return json_build_object('verdict', case when p_price < v_min/3.0 then 'block' else 'low' end, 'min',v_min,'max',v_max,'src',v_src);
  elsif p_price > v_max then
    return json_build_object('verdict', case when p_price > v_max*3.0 then 'block' else 'high' end, 'min',v_min,'max',v_max,'src',v_src);
  else
    return json_build_object('verdict','ok','min',v_min,'max',v_max,'src',v_src);
  end if;
exception when others then
  -- FAIL CLOSED: a moderation error must not wave a price through
  return json_build_object('verdict','block','reason','check_error');
end $$;
grant execute on function price_check(text,text,numeric) to anon;

-- ---- proof (expect all PASS) ----
select 'orders read policy gone' as check,
       case when exists(select 1 from pg_policies where schemaname='public' and tablename='orders' and cmd='SELECT' and qual='true')
            then 'STILL OPEN — FAIL' else 'CLOSED — PASS' end as result
union all
select 'price_check fails closed',
       (price_check('x','__nonexistent_item__', -5)->>'verdict');   -- invalid price → 'invalid' (sanity that fn runs)
