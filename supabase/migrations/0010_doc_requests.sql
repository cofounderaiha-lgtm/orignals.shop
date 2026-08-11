-- ============================================================
-- 0010 — DOCUMENT SERVICES ("Papers")  (⚠ written 2026-08-11, NOT YET APPLIED)
--   The "Papers" view lets a user request an assisted document (GST, FSSAI,
--   birth/death cert, driving licence…). The client already calls three RPCs —
--     doc_request_add / my_doc_requests / doc_request_cancel  (js/cloud.js:368-383)
--   — but they exist in NO sql file, so every call silently .catch()es and the
--   request lives only in that one device's localStorage: it never reaches the
--   team, its status never advances, and it's lost if the app data is cleared.
--   This makes the feature REAL: requests persist, sync their status back, and
--   the ops team can advance them. Additive; the client is unchanged.
-- ============================================================

create table if not exists doc_requests (
  id          text primary key,                 -- client 'DOC#####' id
  created_at  timestamptz not null default now(),
  device_key  text not null,                    -- owner (device identity)
  applicant   text,
  service     text,                             -- DB.docServices id
  name        text,
  price       numeric,
  note        text,
  status      text not null default 'requested',-- requested|docs_collected|filed|issued|cancelled
  ref_no      text,                             -- govt/application reference once filed
  updated_at  timestamptz not null default now()
);
create index if not exists idx_docreq_device on doc_requests(device_key, created_at desc);
create index if not exists idx_docreq_status on doc_requests(status, created_at desc);

alter table doc_requests enable row level security;
-- No anon policies at all: this holds applicant names tied to a device. Reads
-- are per-device via my_doc_requests(); writes via the security-definer RPCs
-- below. (Same posture as listing_leads / shop_orders.)
drop policy if exists dr_read  on doc_requests;
drop policy if exists dr_write on doc_requests;

-- buyer creates a request (idempotent on the client id)
create or replace function doc_request_add(
  p_id text, p_device text, p_applicant text, p_service text,
  p_name text, p_price numeric, p_note text)
returns json language plpgsql security definer set search_path = public as $$
begin
  insert into doc_requests(id, device_key, applicant, service, name, price, note, status)
  values (p_id, p_device, left(coalesce(p_applicant,''),80), p_service,
          left(coalesce(p_name,''),120), greatest(coalesce(p_price,0),0),
          left(coalesce(p_note,''),300), 'requested')
  on conflict (id) do nothing;              -- never duplicate, never overwrite
  return json_build_object('ok', true);
end $$;
grant execute on function doc_request_add(text, text, text, text, text, numeric, text) to anon;

-- buyer reads only their own requests (device-scoped)
create or replace function my_doc_requests(p_device text)
returns setof doc_requests language sql security definer set search_path = public stable as $$
  select * from doc_requests where device_key = p_device order by created_at desc limit 50;
$$;
grant execute on function my_doc_requests(text) to anon;

-- buyer cancels their own — only before it is filed (money not yet spent on govt fees)
create or replace function doc_request_cancel(p_id text, p_device text)
returns json language plpgsql security definer set search_path = public as $$
declare v_status text; v_owner text;
begin
  select status, device_key into v_status, v_owner from doc_requests where id = p_id for update;
  if v_owner is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_owner <> p_device then return json_build_object('ok', false, 'reason', 'not_your_request'); end if;
  if v_status not in ('requested','docs_collected') then
    return json_build_object('ok', false, 'reason', 'too_late', 'status', v_status);
  end if;
  update doc_requests set status = 'cancelled', updated_at = now() where id = p_id;
  return json_build_object('ok', true);
end $$;
grant execute on function doc_request_cancel(text, text) to anon;

-- ops/admin advances a request (requested → docs_collected → filed → issued).
-- Gated by the SAME admin token gate the rest of the panel uses (rank >= 4).
-- (An admin-console button can call this; not wired to UI in this migration.)
create or replace function doc_request_advance(p_token text, p_id text, p_status text, p_ref text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status not in ('requested','docs_collected','filed','issued','cancelled') then
    return json_build_object('ok', false, 'reason', 'bad_status');
  end if;
  update doc_requests
     set status = p_status,
         ref_no = coalesce(nullif(p_ref,''), ref_no),
         updated_at = now()
   where id = p_id;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;
-- granted to anon like every other admin RPC in this codebase; the p_token
-- rank gate above is the real guard (the anon key is the only key a client holds)
grant execute on function doc_request_advance(text, text, text, text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare r json; n int;
begin
  perform doc_request_add('DOCTEST1','drdev0001','Test Co','gst','GST registration',2499,'');
  select count(*) into n from doc_requests where id='DOCTEST1' and device_key='drdev0001' and status='requested';
  assert n = 1, 'FAIL: request not persisted';
  -- wrong device cannot cancel
  r := doc_request_cancel('DOCTEST1','someone_else');
  assert (r->>'ok') = 'false', 'FAIL: foreign cancel allowed';
  -- owner can cancel while still early
  r := doc_request_cancel('DOCTEST1','drdev0001');
  assert (r->>'ok') = 'true', 'FAIL: owner cancel refused';
  delete from doc_requests where id='DOCTEST1';
  raise notice 'PASS: doc_requests add/scope/cancel verified';
end $$;

select 'doc_requests ready' as status;
