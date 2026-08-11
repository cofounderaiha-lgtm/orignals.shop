-- 0017 events — NOT YET APPLIED (written by full-build)
-- ============================================================
-- CANONICAL EVENT BACKBONE.
--   Today analytics is ad-hoc: each feature counts things its own way
--   (order rows, payment rows, snapshots) and there is no single, uniform
--   place that records "something meaningful happened". This migration
--   introduces ONE append-only stream — the events table — plus the single
--   write path emit_event() and an admin read RPC events_recent().
--
--   Every other migration references THIS exact shape (pinned in the
--   engineering contract) and emits through emit_event(), guarding the call
--   with to_regclass('public.events') so it is safe to apply before 0017.
--
-- CANONICAL KIND TAXONOMY (dot.namespaced; keep this list authoritative).
--   Identity / discovery
--     user.created            — a new device/actor first seen
--     search.performed        — a query ran (props: {q, results})
--     product.viewed          — a shop_item detail opened (entity=shop_item)
--   Cart / checkout
--     cart.updated            — line added/removed/qty changed
--     checkout.started        — buyer entered checkout
--     payment.completed       — Razorpay verified (entity=payment)
--   Order lifecycle (entity=order, entity_id=shop_orders.id)
--     order.created           — order placed
--     order.confirmed         — shop accepted (status prep)
--     order.cancelled         — buyer/shop cancelled
--   Inventory (entity=shop_item)
--     inventory.reserved      — stock held for an order
--     inventory.released      — hold freed (cancel/timeout)
--   Fulfilment
--     mitra.assigned          — a live_job was taken (entity=job)
--     delivery.completed      — order handed to buyer
--   After-sale
--     refund.created          — money returned (entity=payment)
--     review.created          — buyer left a rating (entity=shop|shop_item)
--
--   NOTE (extensibility): kind is free-text on purpose so a new feature can
--   emit a new kind WITHOUT a migration. The list above is the agreed
--   vocabulary; new kinds should stay <namespace>.<verb> and be added here.
--
-- ALGORITHM PROGRESSION (anti-cargo-cult; Postgres-first).
--   Stage 1 (NOW): one narrow append-only table + btree indexes. At
--     hundreds→low-tens-of-thousands of users this answers every analytics
--     question with plain SQL (count/group-by over an index). No queue, no
--     warehouse, no stream processor — none are justified at this volume.
--   Stage 2 (TRIGGER: events table sustains >~5M rows OR dashboard group-bys
--     scan too much): add rollup tables refreshed on a pg_cron schedule
--     (daily/hourly aggregates) and query those; optionally BRIN on (at) and
--     monthly range PARTITIONS of events, dropping old partitions to prune.
--   Stage 3 (TRIGGER: cross-service fan-out or sub-second reactions needed):
--     add LISTEN/NOTIFY on insert, or logical replication to a downstream —
--     still no Kafka until many independent consumers + >100k events/s.
-- ============================================================

-- ---------- table (EXACT contract shape) ----------
create table if not exists events (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  device    text,                 -- device key of the actor's device (may be null for system events)
  actor     text,                 -- logical role: buyer|shop|mitra|admin|system
  kind      text not null,        -- canonical taxonomy above (<namespace>.<verb>)
  entity    text,                 -- entity type the event is about: order|payment|shop|shop_item|job|user…
  entity_id text,                 -- id of that entity
  props     jsonb                 -- free-form event payload
);

-- ---------- indexes (contract-mandated access paths) ----------
create index if not exists idx_events_kind_at   on events (kind, at desc);      -- "recent events of kind X"
create index if not exists idx_events_device_at on events (device, at desc);    -- "this device's activity"
create index if not exists idx_events_entity    on events (entity, entity_id);  -- "everything about entity Y"

-- ---------- RLS: sealed. No anon SELECT, no anon INSERT. ----------
-- The ONLY write path is emit_event() (security definer). The ONLY read path
-- is events_recent() (security definer, admin-gated). With RLS enabled and no
-- policies, a raw anon SELECT/INSERT returns zero rows / is denied — same
-- posture as shop_orders / doc_requests.
alter table events enable row level security;
drop policy if exists events_read  on events;
drop policy if exists events_write on events;

-- ---------- emit_event: the single write path ----------
-- Fire-and-forget. Never throws to the caller (an analytics write must never
-- break a real transaction) — swallows and no-ops on error. kind is required;
-- an empty/blank kind is dropped rather than storing a garbage row.
create or replace function emit_event(
  p_device text, p_actor text, p_kind text,
  p_entity text, p_entity_id text, p_props jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind is null or btrim(p_kind) = '' then return; end if;
  insert into events(device, actor, kind, entity, entity_id, props)
  values (nullif(p_device,''), nullif(p_actor,''), btrim(p_kind),
          nullif(p_entity,''), nullif(p_entity_id,''), p_props);
exception when others then
  return;  -- analytics must never break the caller
end $$;
grant execute on function emit_event(text, text, text, text, text, jsonb) to anon;

-- ---------- events_recent: admin-only read ----------
-- Gated by admin_rank(_admin_level(p_token)) >= 4 (Operations / L4+), exactly
-- like every other admin RPC. Granted to anon; the token IS the guard.
-- p_kind null/'' => any kind. Returns newest first, capped at 500.
create or replace function events_recent(p_token text, p_kind text, p_limit int)
returns setof events language plpgsql security definer set search_path = public stable as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return; end if;
  return query
    select * from events
    where (coalesce(p_kind,'') = '' or kind = p_kind)
    order by at desc, id desc
    limit least(coalesce(p_limit, 100), 500);
end $$;
grant execute on function events_recent(text, text, int) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare
  n int;
  v_token text := 'evt_proof_token_0017';
  v_ident text := 'evt_proof_admin_0017@example.com';
  v_rows  int;
begin
  -- 1) emit_event writes exactly one row
  perform emit_event('dev_evtproof0000000000000000000000','buyer','order.created','order','EVTPROOF#1',
                     jsonb_build_object('total',199));
  select count(*) into n from events where entity='order' and entity_id='EVTPROOF#1' and kind='order.created';
  assert n = 1, 'FAIL: emit_event did not write a row';

  -- 2) blank kind is dropped (no garbage rows)
  perform emit_event('dev_evtproof0000000000000000000000','buyer','   ','order','EVTPROOF#2',null);
  select count(*) into n from events where entity_id='EVTPROOF#2';
  assert n = 0, 'FAIL: blank-kind event was stored';

  -- 3) events_recent with a BAD token returns nothing (admin gate holds)
  select count(*) into v_rows from events_recent('not_a_real_token','order.created',50);
  assert v_rows = 0, 'FAIL: events_recent leaked rows to an invalid token';

  -- 4) events_recent with a VALID L4 token returns the row.
  --    Stand up a temporary L4 admin + session, exercise, then tear down.
  insert into admin_users(ident, level, name, added_by)
    values (v_ident, 'l4', 'evt proof', 'proof') on conflict (ident) do nothing;
  insert into auth_sessions(token, ident, device_key)
    values (v_token, v_ident, 'dev_evtproof0000000000000000000000') on conflict (token) do nothing;
  select count(*) into v_rows from events_recent(v_token,'order.created',50);
  assert v_rows >= 1, 'FAIL: valid admin token could not read events';

  -- cleanup (leave no trace)
  delete from auth_sessions where token = v_token;
  delete from admin_users   where ident = v_ident;
  delete from events where entity_id in ('EVTPROOF#1','EVTPROOF#2');

  raise notice 'PASS: events emit/seal/gate verified';
end $$;

select 'events ready' as status;
