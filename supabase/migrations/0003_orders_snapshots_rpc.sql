-- ============================================================
-- WEEK1 / STEP 1 (cont.) — close the remaining serious UPDATE holes.
--
-- Verified live 2026-07-12:
--   p_orders_upd  UPDATE using (true)  on orders
--   snap_upd      UPDATE using (true)  on state_snapshots
--
-- Why this is worse than "you must guess an id": PostgREST supports BULK
-- updates. With using(true) a single request such as
--   PATCH /rest/v1/orders?id=like.*        {"total": 0}
--   PATCH /rest/v1/state_snapshots?device_key=like.*   {"state": {}}
-- rewrites EVERY row in the table. No id needed, no key needed — just the
-- public anon key from config.js. That is mass destruction in one call.
--
-- orders had NO ownership column at all, so nothing could be enforced.
-- We add device_key, stamp it server-side, and allow updates only to rows
-- the caller already owns (or that are unclaimed — claim-on-first-write,
-- so the 1 existing legacy row is not orphaned).
--
-- Honest limit: p_device remains a client-supplied bearer string
-- (Week1 Task 3). This removes bulk/anonymous rewriting; it is not identity.
-- ============================================================

alter table orders add column if not exists device_key text;
create index if not exists orders_device_idx on orders(device_key);

-- ---------- snapshots ----------
create or replace function snapshot_save(p_device text, p_state jsonb)
returns json language plpgsql security definer set search_path=public as $$
begin
  if coalesce(p_device,'') = '' or length(p_device) < 8 then
    return json_build_object('ok', false, 'reason', 'bad_device');
  end if;
  if p_state is null then return json_build_object('ok', false, 'reason', 'no_state'); end if;
  insert into state_snapshots (device_key, state, app_ver, updated_at)
  values (p_device, p_state, 'v1', now())
  on conflict (device_key) do update
    set state = excluded.state, app_ver = excluded.app_ver, updated_at = now();
  return json_build_object('ok', true);
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ---------- orders ----------
create or replace function orders_sync(p_device text, p_orders jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare v_n int := 0;
begin
  if coalesce(p_device,'') = '' or length(p_device) < 8 then
    return json_build_object('ok', false, 'reason', 'bad_device');
  end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' then
    return json_build_object('ok', true, 'rows', 0);
  end if;

  insert into orders (id, device_key, kind, flow, shop_id, title, items, total,
                      addr_label, partner_name, partner_veh, otp, rated,
                      cancelled_at, placed_at)
  select left(e->>'id', 40),
         p_device,                                            -- stamped, never trusted
         coalesce(nullif(e->>'kind',''), 'shop')::order_kind,
         nullif(e->>'flow','')::order_flow,
         nullif(e->>'shop_id',''),
         left(coalesce(e->>'title',''), 160),
         coalesce(e->'items', '[]'::jsonb),
         coalesce((e->>'total')::numeric, 0),
         nullif(e->>'addr_label',''),
         nullif(e->>'partner_name',''),
         nullif(e->>'partner_veh',''),
         (e->>'otp')::int,
         (e->>'rated')::int,
         (e->>'cancelled_at')::timestamptz,
         coalesce((e->>'placed_at')::timestamptz, now())
  from jsonb_array_elements(p_orders) e
  where coalesce(e->>'id','') <> ''
  on conflict (id) do update set
    kind = excluded.kind, flow = excluded.flow, shop_id = excluded.shop_id,
    title = excluded.title, items = excluded.items, total = excluded.total,
    addr_label = excluded.addr_label, partner_name = excluded.partner_name,
    partner_veh = excluded.partner_veh, otp = excluded.otp, rated = excluded.rated,
    cancelled_at = excluded.cancelled_at, placed_at = excluded.placed_at,
    device_key = coalesce(orders.device_key, excluded.device_key)   -- claim-on-first-write
  where orders.device_key is null or orders.device_key = p_device;  -- OWNERSHIP GUARD
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'rows', v_n);
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

grant execute on function snapshot_save(text, jsonb) to anon;
grant execute on function orders_sync(text, jsonb) to anon;

-- the anon write policies are now unnecessary — both RPCs are security definer
drop policy if exists snap_upd     on state_snapshots;
drop policy if exists snap_ins     on state_snapshots;
drop policy if exists p_orders_upd on orders;
drop policy if exists p_orders_ins on orders;

-- ---- proof ----
select 'bulk-writable tables remaining' as check,
       coalesce((select string_agg(tablename||'.'||cmd, ', ')
                 from pg_policies where schemaname='public' and qual='true'
                   and cmd in ('UPDATE','DELETE')
                   and tablename in ('orders','state_snapshots','shops','shop_items')), 'NONE — PASS') as result
union all
select 'orders.device_key exists',
       case when exists(select 1 from information_schema.columns
                        where table_schema='public' and table_name='orders' and column_name='device_key')
            then 'YES — PASS' else 'NO — FAIL' end
union all
select 'both RPCs are security definer',
       (select case when count(*) = 2 then 'YES — PASS' else 'NO — FAIL' end
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('snapshot_save','orders_sync') and p.prosecdef);
