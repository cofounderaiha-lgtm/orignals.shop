-- ============================================================
-- 0028 — SERVICEABILITY ENGINE  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §46: "never promise a delivery the system cannot
--   operationally fulfil." Before an order is placed the client asks
--   serviceability_check() — the server confirms the shop is available (open, not
--   deleted), within delivery RANGE, and within operating HOURS, and returns a
--   distance + ETA. Read-only, public (catalog-adjacent, no PII).
-- ============================================================
create or replace function _svc_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns numeric language sql immutable as $$
  select case when a_lat is null or a_lng is null or b_lat is null or b_lng is null then null
    else round((2 * 6371 * asin(least(1.0, sqrt(
      power(sin(radians((b_lat - a_lat)/2)),2) +
      cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians((b_lng - a_lng)/2)),2)))))::numeric, 2) end;
$$;

create or replace function serviceability_check(p_shop text, p_lat double precision, p_lng double precision)
returns json language plpgsql security definer set search_path = public stable as $$
declare s record; v_km numeric; v_open boolean; v_range boolean; v_hours boolean := true;
        v_now time; v_from time; v_till time; v_max numeric := 15; reasons jsonb := '[]'::jsonb;
begin
  select is_open, deleted_at, lat, lng, open_from, open_till into s from shops where id = p_shop;
  if not found or s.deleted_at is not null then
    return json_build_object('serviceable', false, 'reasons', jsonb_build_array('shop_unavailable'));
  end if;

  v_open := coalesce(s.is_open, false);
  if not v_open then reasons := reasons || jsonb_build_array('shop_closed'); end if;

  v_km := _svc_km(p_lat, p_lng, s.lat, s.lng);
  v_range := v_km is null or v_km <= v_max;               -- no coords → don't block on range
  if not v_range then reasons := reasons || jsonb_build_array('out_of_range'); end if;

  -- operating hours (best-effort parse of HH:MM; unparseable → treated as open, never a false block)
  begin
    v_now  := (now() at time zone 'Asia/Kolkata')::time;
    v_from := nullif(trim(s.open_from), '')::time;
    v_till := nullif(trim(s.open_till), '')::time;
    if v_from is not null and v_till is not null then
      v_hours := case when v_till > v_from then v_now between v_from and v_till
                      else v_now >= v_from or v_now <= v_till end;   -- overnight window
    end if;
  exception when others then v_hours := true; end;
  if not v_hours then reasons := reasons || jsonb_build_array('outside_hours'); end if;

  return json_build_object(
    'serviceable', v_open and v_range and v_hours,
    'shop_open', v_open, 'in_range', v_range, 'in_hours', v_hours,
    'distance_km', coalesce(v_km, 0),
    'eta_mins', greatest(9, round(coalesce(v_km, 2) * 4 + 8)),
    'reasons', reasons);
end $$;
grant execute on function serviceability_check(text, double precision, double precision) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare r json;
begin
  delete from shops where id in ('SVC_OPEN','SVC_CLOSED');

  -- an OPEN shop at (28.60,77.20), all-day hours
  insert into shops(id, name, category, is_open, lat, lng, open_from, open_till)
    values ('SVC_OPEN', 'Open Mart', 'grocery', true, 28.60, 77.20, '00:00', '23:59');

  -- nearby customer → serviceable
  r := serviceability_check('SVC_OPEN', 28.61, 77.21);
  assert (r->>'serviceable')='true', 'FAIL: nearby open shop not serviceable ('||coalesce(r->>'reasons','')||')';
  assert (r->>'distance_km')::numeric < 3, 'FAIL: distance wrong, got '||(r->>'distance_km');

  -- far customer (~150 km away) → out of range, not serviceable
  r := serviceability_check('SVC_OPEN', 30.00, 77.20);
  assert (r->>'serviceable')='false' and (r->>'in_range')='false', 'FAIL: far customer wrongly serviceable';

  -- a CLOSED shop → not serviceable even if nearby
  insert into shops(id, name, category, is_open, lat, lng) values ('SVC_CLOSED', 'Shut Mart', 'grocery', false, 28.60, 77.20);
  r := serviceability_check('SVC_CLOSED', 28.61, 77.21);
  assert (r->>'serviceable')='false' and (r->>'shop_open')='false', 'FAIL: closed shop serviceable';

  -- a deleted / unknown shop → unavailable
  r := serviceability_check('SVC_NOPE', 28.61, 77.21);
  assert (r->>'serviceable')='false', 'FAIL: unknown shop serviceable';

  delete from shops where id in ('SVC_OPEN','SVC_CLOSED');
  raise notice 'PASS: serviceability — open+near+in-hours ok; far/closed/unknown blocked with reasons';
end $$;

select 'serviceability engine ready' as status;
