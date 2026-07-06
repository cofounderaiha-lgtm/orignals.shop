-- ============================================================
-- ORIGNALS OPS — launch-readiness backend
--  1. platform_flags : remote kill switches read by every client
--  2. error_log      : own error monitoring (no third-party account)
--  3. erase_device   : DPDP right-to-erasure (financial records kept)
-- ============================================================

-- 1 ── remote control (single row) ─────────────────────────
create table if not exists platform_flags (
  id int primary key default 1,
  maintenance boolean not null default false,
  payments_enabled boolean not null default true,
  banner text,
  updated_at timestamptz not null default now(),
  constraint one_row check (id = 1)
);
insert into platform_flags (id) values (1) on conflict (id) do nothing;

alter table platform_flags enable row level security;
drop policy if exists pf_read on platform_flags;
create policy pf_read on platform_flags for select using (true);
-- writes only via the Management API / service role (admins), never anon.

-- 2 ── own error monitoring ────────────────────────────────
create table if not exists error_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_key text,
  message text,
  source text,
  stack text,
  url text,
  ua text
);
create index if not exists error_log_time_idx on error_log (created_at desc);

alter table error_log enable row level security;
drop policy if exists el_insert on error_log;
create policy el_insert on error_log for insert with check (true);
drop policy if exists el_read on error_log;
create policy el_read on error_log for select using (true);

-- keep the log bounded automatically (last ~2000 rows)
create or replace function error_log_trim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (random() < 0.02) then
    delete from error_log where id < (select max(id) - 2000 from error_log);
  end if;
  return null;
end $$;
drop trigger if exists error_log_trim_t on error_log;
create trigger error_log_trim_t after insert on error_log
  for each row execute function error_log_trim();

-- 3 ── DPDP right to erasure ───────────────────────────────
-- Removes all personal/device data. Payment rows are RETAINED but
-- de-identified (financial/tax record-keeping exemption under DPDP).
create or replace function erase_device(p_device text)
returns void language plpgsql security definer set search_path = public as $$
declare v_shop text := 'my_' || substr(p_device, 1, 12);
begin
  delete from state_snapshots  where device_key = p_device;
  delete from mitra_utterances where device_key = p_device;
  delete from mitra_model      where device_key = p_device;
  delete from live_jobs        where device_key = p_device;
  delete from shop_orders      where buyer_device = p_device;
  delete from shop_items       where shop_id = v_shop;
  delete from shops            where id = v_shop;
  update payments set device_key = 'erased' where device_key = p_device;
end $$;
grant execute on function erase_device(text) to anon;

select 'ops backend ready' as status;
