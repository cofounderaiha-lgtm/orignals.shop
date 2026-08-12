-- ============================================================
-- 0009 — AUTHORITATIVE ORDER LIFECYCLE  (⚠ written 2026-08-11, NOT YET APPLIED)
--   No live DB this session (Management token cleared), so this is built to be
--   applied + proven in the Supabase SQL editor when access returns. It is
--   additive and backward-compatible: the client's existing calls
--   (shop_order_status / shop_order_cancel / order_statuses / market_stats)
--   keep working — they just become REAL and VALIDATED.
--
-- Why this exists (the "real OMS" the spec demands, §22/§26/§37):
--   The live operational order table is `shop_orders` (buyer's order lands on
--   the shop's device; the shop drives the buyer's tracking). Until now:
--     · status was a FLAT ALLOWLIST — new→done directly was legal; no state
--       machine, so an order could skip prep/handover with no record.
--     · there was NO audit trail — every change overwrote updated_at, so the
--       order's history (who did what, when) was unrecoverable. A marketplace
--       cannot do disputes, refunds, SLA or fraud without this.
--     · `shop_order_cancel` (buyer cancels) and `market_stats` (admin board)
--       were CALLED by the client but defined in NO file — live-DB-only ghosts
--       that a rebuild would silently lose. They are made real + sourced here.
--
-- Also closes a live durability leak (see §3 below): shop_orders_schema.sql
--   recreates `so_read using(true)` — world-readable buyer name/address/GPS +
--   delivery OTP on the REAL order table. Dropped defensively here and removed
--   at source in shop_orders_schema.sql.
-- ============================================================

-- ── 1. append-only audit trail ──────────────────────────────
-- One immutable row per state transition. Never updated, never deleted.
create table if not exists shop_order_events (
  id           bigint generated always as identity primary key,
  order_id     text not null,
  at           timestamptz not null default now(),
  actor        text not null,                 -- 'buyer' | 'shop' | 'partner' | 'system'
  actor_device text,
  from_status  text,
  to_status    text not null,
  note         text
);
create index if not exists idx_soe_order on shop_order_events(order_id, at);

alter table shop_order_events enable row level security;
-- No anon read and no anon write: the log is written ONLY by the security-
-- definer RPCs below (so no one can forge history) and read ONLY via
-- order_timeline() (which authorises buyer-or-owning-shop). Zero anon policies.
drop policy if exists soe_read on shop_order_events;
drop policy if exists soe_write on shop_order_events;

-- ── 2. genesis event: every order starts its history at 'new' ─
create or replace function _shop_order_genesis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into shop_order_events(order_id, actor, actor_device, from_status, to_status, note)
  values (new.id, 'buyer', new.buyer_device, null, coalesce(new.status,'new'), 'order placed');
  return new;
end $$;
drop trigger if exists t_shop_order_genesis on shop_orders;
create trigger t_shop_order_genesis after insert on shop_orders
  for each row execute function _shop_order_genesis();

-- ── 3. validated state machine + audit, shop-driven transitions ─
-- Replaces the flat-allowlist shop_order_status. Same signature (client
-- unchanged). Enforces a real transition graph and records every move.
--   new     → prep | rejected
--   prep    → finding | selfout | handed | done | rejected
--   finding → handed | selfout | rejected
--   handed  → done | rejected            (out for delivery — no going back)
--   selfout → done | rejected
--   done / rejected → (terminal)   ('rejected' covers both shop-reject and buyer-cancel; the audit row's actor distinguishes them)
create or replace function _order_transition_ok(p_from text, p_to text)
returns boolean language sql immutable as $$
  select case p_from
    when 'new'     then p_to in ('prep','rejected')
    when 'prep'    then p_to in ('finding','selfout','handed','done','rejected')
    when 'finding' then p_to in ('handed','selfout','rejected')
    when 'handed'  then p_to in ('done','rejected')
    when 'selfout' then p_to in ('done','rejected')
    else false                              -- done/rejected/cancelled are terminal
  end;
$$;

create or replace function shop_order_status(p_id text, p_device text, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_from text; v_shop text;
begin
  if p_status not in ('prep','finding','handed','selfout','done','rejected') then
    return false;
  end if;
  v_shop := 'my_' || substr(p_device, 1, 12);
  -- lock the row so two device taps can't race a double transition
  select status into v_from from shop_orders where id = p_id and shop_id = v_shop for update;
  if v_from is null then return false; end if;                 -- not found / not your shop
  if not _order_transition_ok(v_from, p_status) then
    return false;                                             -- illegal move (e.g. done→prep)
  end if;
  update shop_orders set status = p_status, updated_at = now() where id = p_id;
  insert into shop_order_events(order_id, actor, actor_device, from_status, to_status, note)
  values (p_id, 'shop', p_device, v_from, p_status, null);
  return true;
end $$;
grant execute on function shop_order_status(text, text, text) to anon;

-- ── 4. buyer cancellation (was a ghost RPC — now real + audited) ─
-- Only the buyer who placed it, and only before it is out for delivery.
-- Sets 'rejected' (the existing client already reads a buyer-side 'rejected'
-- as "cancelled by buyer" — myshop.js:230 — and the buyer's own poll keys off
-- 'rejected'; introducing a new 'cancelled' status would break both). The
-- audit row records actor='buyer', so a rejection BY THE BUYER is still
-- distinguishable from a rejection BY THE SHOP in the history.
create or replace function shop_order_cancel(p_id text, p_device text)
returns json language plpgsql security definer set search_path = public as $$
declare v_from text; v_buyer text;
begin
  select status, buyer_device into v_from, v_buyer from shop_orders where id = p_id for update;
  if v_from is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_buyer <> p_device then return json_build_object('ok', false, 'reason', 'not_your_order'); end if;
  if v_from in ('handed','selfout','done','rejected') then
    return json_build_object('ok', false, 'reason', 'too_late', 'status', v_from);
  end if;
  update shop_orders set status = 'rejected', updated_at = now() where id = p_id;
  insert into shop_order_events(order_id, actor, actor_device, from_status, to_status, note)
  values (p_id, 'buyer', p_device, v_from, 'rejected', 'buyer cancelled');
  return json_build_object('ok', true);
end $$;
grant execute on function shop_order_cancel(text, text) to anon;

-- ── 4b. job_reopen (was a ghost RPC — now real) ─────────────
-- A partner who claimed a delivery then drops it (earn.js:524) must return it
-- to the open feed, or the parcel is stranded 'taken' forever. Only the
-- partner who holds it may reopen it; clears their claim + live location.
create or replace function job_reopen(p_job text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update live_jobs
     set status = 'open', taken_by = null, taken_at = null, taken_name = null,
         taken_veh = null, taken_rating = null, partner_lat = null, partner_lng = null, picked_at = null
   where id = p_job and taken_by = p_device and status = 'taken';
  return found;
end $$;
grant execute on function job_reopen(text, text) to anon;

-- ── 5. read the real timeline (buyer OR owning shop only) ────
create or replace function order_timeline(p_id text, p_device text)
returns table (at timestamptz, actor text, from_status text, to_status text, note text)
language plpgsql security definer set search_path = public stable as $$
declare v_buyer text; v_shop text;
begin
  select buyer_device, shop_id into v_buyer, v_shop from shop_orders where id = p_id;
  if v_buyer is null then return; end if;
  if p_device <> v_buyer and v_shop <> 'my_' || substr(p_device, 1, 12) then
    return;                                                    -- not authorised for this order
  end if;
  return query
    select e.at, e.actor, e.from_status, e.to_status, e.note
    from shop_order_events e where e.order_id = p_id order by e.at asc;
end $$;
grant execute on function order_timeline(text, text) to anon;

-- ── 6. market_stats (was a ghost RPC — now real + sourced) ───
-- Powers Admin → Database "marketplace live". Counts only; fail-soft per
-- metric so a not-yet-created table never breaks the whole board.
create or replace function market_stats()
returns json language plpgsql security definer set search_path = public stable as $$
declare v_jobs int := 0; v_orders int := 0; v_pay int := 0; v_shops int := 0;
begin
  begin select count(*) into v_jobs from live_jobs where status = 'open'; exception when others then v_jobs := 0; end;
  begin select count(*) into v_orders from shop_orders where status not in ('done','rejected'); exception when others then v_orders := 0; end;
  begin select count(*) into v_pay from payments where status = 'verified'; exception when others then v_pay := 0; end;
  begin select count(*) into v_shops from shops where id like 'my\_%' and is_open = true and deleted_at is null; exception when others then v_shops := 0; end;
  return json_build_object('open_jobs', v_jobs, 'active_orders', v_orders,
                           'verified_payments', v_pay, 'community_shops', v_shops);
end $$;
grant execute on function market_stats() to anon;

-- ── 7. close the live buyer-PII/OTP read leak on shop_orders ──
-- shop_orders_schema.sql:28 recreates `so_read using(true)` → anyone with the
-- public anon key can read buyer_name, buyer_addr, buyer_lat/lng and drop_otp
-- for EVERY order (delivery interception + PII dump). Reads already go through
-- my_shop_orders()/order_statuses() (security-definer, scoped). Drop the
-- blanket read here so it is closed regardless of base-file apply order; also
-- removed at source in shop_orders_schema.sql.
drop policy if exists so_read on shop_orders;

-- ------------------------------------------------------------
-- PROOF (run after apply — every row should read PASS)
-- ------------------------------------------------------------
-- a) illegal transition is refused, legal one is accepted, both audited:
do $$
declare ok boolean; n int;
begin
  insert into shop_orders(id, shop_id, buyer_device, items, total, status)
  values ('OMTEST9', 'my_devtest12345', 'devbuyer0001', '[]'::jsonb, 100, 'new')
  on conflict (id) do update set status = 'new';
  delete from shop_order_events where order_id = 'OMTEST9';        -- clean prior test runs
  insert into shop_order_events(order_id, actor, from_status, to_status, note)
  values ('OMTEST9', 'buyer', null, 'new', 'test genesis');

  ok := shop_order_status('OMTEST9', 'devtest12345xxxx', 'done');  -- new→done ILLEGAL
  assert ok = false, 'FAIL: illegal new->done was allowed';

  ok := shop_order_status('OMTEST9', 'devtest12345xxxx', 'prep');  -- new→prep legal
  assert ok = true,  'FAIL: legal new->prep was refused';

  ok := shop_order_status('OMTEST9', 'devtest12345xxxx', 'done');  -- prep→done legal
  assert ok = true,  'FAIL: legal prep->done was refused';

  select count(*) into n from shop_order_events where order_id = 'OMTEST9' and actor = 'shop';
  assert n = 2, 'FAIL: expected 2 shop audit rows, got ' || n;

  delete from shop_order_events where order_id = 'OMTEST9';
  delete from shop_orders where id = 'OMTEST9';
  raise notice 'PASS: state machine + audit trail verified';
end $$;

-- b) the PII read policy is gone:
select 'shop_orders read leak closed' as check,
  case when exists(select 1 from pg_policies where schemaname='public' and tablename='shop_orders' and cmd='SELECT' and qual='true')
       then 'STILL OPEN — FAIL' else 'CLOSED — PASS' end as result
union all
-- c) market_stats runs and returns the 4 keys:
select 'market_stats returns keys',
  case when market_stats()::jsonb ? 'open_jobs' and market_stats()::jsonb ? 'community_shops'
       then 'PASS' else 'FAIL' end;
