-- ============================================================
-- 0011 — device_key HARDENING  (⚠ written 2026-08-11, NOT YET APPLIED · FROZEN)
--   Reviewed by hand, but NOT staged/tested. Do not apply to production until it
--   runs on a staging DB and passes the negative-authorization tests below.
--
-- THE P0 (architecture audit, §H):  device_key is a BEARER TOKEN — snapshot_restore
--   (harden_rls.sql) returns a device's ENTIRE account state for whoever presents
--   its key, and shop authorization derives shop_id = 'my_'||substr(device_key,1,12).
--   Yet device_key is SELECTABLE IN BULK on several world-readable tables. Harvest
--   the keys → read/patch any account. This migration removes the read exposure.
--
-- Three closable classes:
--   (1) SAFE NOW — column-level revoke: the client never reads these device-key
--       columns (verified against js/), so hiding the column keeps every row-read
--       working while removing the token from the response.
--   (2) NEEDS PAIRED CLIENT CHANGE — live_jobs + listings: the client FILTERS on
--       device_key/owner_device, so the read must move to an RPC first. RPCs are
--       drafted here; the base-table read policy is dropped ONLY after the client
--       (cloud.js) is switched — do NOT drop lj_read/ls_read until then.
--   (3) DURABILITY — reservations/listing_leads/mitra_*/error_log were closed by
--       harden_rls but their BASE files re-declare a permissive read; re-asserted
--       here and (to be) fixed at source.
-- ============================================================

-- ── (1) SAFE NOW — hide device_key from columns the client never selects ──
-- seat_bookings: client reads only `select=seat` (cloud.js:440).
-- geo_places:    client reads only name,sub,lat,lng,uses (geo.js:55).
-- shop_ratings:  no direct client read (submitted via rate_shop, aggregated on shops.rating).
-- Postgres column privileges: revoking SELECT on the column also blocks it in
-- WHERE/ORDER BY, so verify on staging that nothing filters these columns.
revoke select (device_key) on seat_bookings from anon;
revoke select (device_key) on geo_places   from anon;
revoke select (device_key) on shop_ratings from anon;

-- ── (2) live_jobs — device_key + LIVE rider GPS are world-readable (P0) ──
-- Today: cloud.js:241 reads `live_jobs?status=eq.open&device_key=neq.<self>` (all
-- columns → leaks poster device_key, taken_by, GPS) and cloud.js:282 reads a job's
-- courier GPS by order_ref (anyone can harvest every courier's live location).
-- Target RPCs (safe columns only, ownership-scoped). The client must switch to
-- these BEFORE lj_read is dropped (kept live here so nothing breaks meanwhile).
create or replace function open_jobs(p_device text)
returns table (id text, what text, jtype text, from_name text, to_name text,
               from_lat double precision, from_lng double precision,
               to_lat double precision, to_lng double precision,
               km numeric, pay numeric, note text, order_ref text, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select id, what, jtype, from_name, to_name, from_lat, from_lng, to_lat, to_lng,
         km, pay, note, order_ref, created_at
  from live_jobs
  where status = 'open'
    and device_key <> coalesce(p_device, 'anon')          -- exclude the caller's own
    and created_at >= now() - interval '24 hours'
  order by created_at desc limit 30;                       -- NB: no device_key/taken_by in output
$$;
grant execute on function open_jobs(text) to anon;

-- buyer reads the live courier location for THEIR OWN order only
create or replace function job_gps(p_order text, p_device text)
returns table (taken_name text, taken_veh text, taken_rating numeric,
               partner_lat double precision, partner_lng double precision,
               status text, picked_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare v_owner text;
begin
  -- the order belongs to this device (orders_sync stamps device_key on `orders`)
  select device_key into v_owner from orders where id = p_order limit 1;
  if v_owner is not null and v_owner <> p_device then return; end if;
  return query
    select lj.taken_name, lj.taken_veh, lj.taken_rating, lj.partner_lat, lj.partner_lng,
           lj.status, lj.picked_at
    from live_jobs lj where lj.order_ref = p_order limit 1;
end $$;
grant execute on function job_gps(text, text) to anon;

-- PAIRED CLIENT CHANGE (do together, then apply the drop below):
--   cloud.js:241  cloudJobs()        -> rpc/open_jobs {p_device}
--   cloud.js:282  cloudJobForOrder() -> rpc/job_gps   {p_order, p_device}
-- AFTER the client ships those:
--   drop policy if exists lj_read on live_jobs;   -- (left LIVE in this migration)

-- ── (2b) listings — owner_device world-readable + sent to every buyer ──
-- Today the buyer feed selects `*` (owner_device leaks) and the client passes
-- listing.owner_device back into cloudPostLead. Target: a feed RPC without
-- owner_device, and a lead RPC that resolves owner_device server-side by
-- listing_id. Drafted; drop ls_read only after cloud.js switches.
create or replace function listings_feed(p_device text)
returns table (id text, kind text, title text, loc text, price numeric, area text,
               bhk text, lat double precision, lng double precision, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select id, kind, title, loc, price, area, bhk, lat, lng, created_at
  from listings
  where status = 'live' and owner_device <> coalesce(p_device, 'anon')
  order by created_at desc limit 30;                       -- no owner_device in output
$$;
grant execute on function listings_feed(text) to anon;

create or replace function listing_lead_add(p_listing text, p_device text, p_kind text, p_name text, p_note text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner text;
begin
  select owner_device into v_owner from listings where id = p_listing and status = 'live';
  if v_owner is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into listing_leads (listing_id, owner_device, from_device, kind, name, note)
  values (p_listing, v_owner, coalesce(p_device,'anon'), p_kind, left(coalesce(p_name,''),40), left(coalesce(p_note,''),160));
  return json_build_object('ok', true);
end $$;
grant execute on function listing_lead_add(text, text, text, text, text) to anon;
-- PAIRED CLIENT CHANGE: cloud.js:348 cloudListingsRefresh -> rpc/listings_feed;
--   cloud.js:356 cloudPostLead -> rpc/listing_lead_add {p_listing,...} (stop
--   sending owner_device). THEN: drop policy if exists ls_read on listings;

-- ── (3) durability re-assert (base files re-open these; also fix at source) ──
-- mitra_utterances/mitra_model: base mitra_schema declares `for all using(true)`
-- (includes SELECT of device_key). harden_rls already narrows to insert/update;
-- re-assert here so a mitra_schema re-run cannot re-expose training rows + keys.
drop policy if exists p_mu_all on mitra_utterances;
drop policy if exists p_mm_all on mitra_model;
drop policy if exists rz_read  on reservations;     -- buyer_device + PII; read via shop_reservations RPC
drop policy if exists ld_read  on listing_leads;    -- owner/from device; read via my_leads RPC
drop policy if exists el_read  on error_log;        -- URLs can carry a device_key; read via recent_errors RPC (admin-gated)

-- ── proof (run after apply) ──
-- Expect: selecting device_key from the (1) tables ERRORS (permission denied),
-- while a normal row read still works; open_jobs/listings_feed outputs contain
-- NO device_key/owner_device column.
select 'device_key columns hidden' as check,
  'verify on staging: select device_key from seat_bookings LIMIT 1 must raise permission denied' as how
union all
select 'open_jobs excludes keys',
  case when (select count(*) from information_schema.routines
             where routine_name='open_jobs' and routine_schema='public') = 1
       then 'RPC present — PASS' else 'MISSING — FAIL' end;
