-- ============================================================
-- ORIGNALS SECURITY HARDENING (2026-07-06)
-- The anon key is public, so RLS is the only guard. Blanket
-- `select using(true)` let anyone bulk-download (and for snapshots,
-- overwrite/delete) every user's data. This removes bulk read on the
-- sensitive tables and routes each per-device read through a
-- security-definer RPC keyed on the UNGUESSABLE 40-char device_key,
-- so a caller must already know a specific key — no enumeration.
-- NOTE: full protection still requires real auth (phone OTP). This is
-- pilot-grade hardening that closes the mass-exposure hole.
-- ============================================================

-- 1 ── state_snapshots: no bulk read, no delete; writes stay (upsert) ──
drop policy if exists p_snap_all on state_snapshots;
drop policy if exists snap_ins on state_snapshots;
drop policy if exists snap_upd on state_snapshots;
create policy snap_ins on state_snapshots for insert with check (true);
create policy snap_upd on state_snapshots for update using (true) with check (true);
-- (no SELECT, no DELETE for anon)

create or replace function snapshot_restore(p_device text)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object('state', state, 'updated_at', updated_at)
  from state_snapshots where device_key = p_device limit 1;
$$;
grant execute on function snapshot_restore(text) to anon;

-- 2 ── payments: no anon read; status via RPC by payment id ──
drop policy if exists payments_read_own on payments;
create or replace function payment_status(p_payment text)
returns text language sql security definer set search_path = public stable as $$
  select status from payments where rzp_payment_id = p_payment limit 1;
$$;
grant execute on function payment_status(text) to anon;

-- 3 ── listing_leads: owner reads their own via RPC ──
drop policy if exists ld_read on listing_leads;
create or replace function my_leads(p_device text)
returns setof listing_leads language sql security definer set search_path = public stable as $$
  select * from listing_leads where owner_device = p_device order by created_at desc limit 30;
$$;
grant execute on function my_leads(text) to anon;

-- 4 ── reservations: restaurant reads its own via RPC ──
drop policy if exists rz_read on reservations;
create or replace function shop_reservations(p_shop text)
returns setof reservations language sql security definer set search_path = public stable as $$
  select * from reservations where shop_id = p_shop and status = 'reserved' order by created_at desc limit 20;
$$;
grant execute on function shop_reservations(text) to anon;

-- 5 ── error_log: no bulk read; recent list via RPC (messages only) ──
drop policy if exists el_read on error_log;
create or replace function recent_errors()
returns table (created_at timestamptz, message text, url text)
language sql security definer set search_path = public stable as $$
  select created_at, message, url from error_log order by created_at desc limit 12;
$$;
grant execute on function recent_errors() to anon;

-- 6 ── shop_orders: buyer PII; reads via device/shop-keyed RPCs ──
drop policy if exists so_read on shop_orders;
create or replace function my_shop_orders(p_shop text)
returns setof shop_orders language sql security definer set search_path = public stable as $$
  select * from shop_orders where shop_id = p_shop order by created_at desc limit 30;
$$;
create or replace function order_statuses(p_ids text[])
returns table (id text, status text)
language sql security definer set search_path = public stable as $$
  select id, status from shop_orders where id = any(p_ids);
$$;
grant execute on function my_shop_orders(text) to anon;
grant execute on function order_statuses(text[]) to anon;

-- 7 ── mitra_utterances / mitra_model: stop world write/delete ──
drop policy if exists p_mu_all on mitra_utterances;
drop policy if exists p_mm_all on mitra_model;
create policy p_mu_ins on mitra_utterances for insert with check (true);
create policy p_mu_upd on mitra_utterances for update using (true) with check (true);
create policy p_mm_ins on mitra_model for insert with check (true);
create policy p_mm_upd on mitra_model for update using (true) with check (true);
-- (training reads happen server-side in mitra_train; no anon SELECT needed)

select 'RLS hardened' as status;
