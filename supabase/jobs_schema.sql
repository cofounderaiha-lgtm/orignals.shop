-- ============================================================
-- ORIGNALS LIVE JOBS — the real two-sided marketplace core.
-- A parcel sent on one phone becomes a claimable job on every
-- verified partner's phone. Claims are atomic (no double-take).
-- ============================================================

create table if not exists live_jobs (
  id text primary key,
  created_at timestamptz not null default now(),
  device_key text not null,                    -- who posted it
  what text not null,
  jtype text not null default 'box',           -- parcel type or 'ride'
  from_name text, to_name text,
  from_lat double precision, from_lng double precision,
  to_lat double precision, to_lng double precision,
  km numeric, pay numeric not null default 0,
  note text,
  status text not null default 'open',         -- open | taken | done | cancelled
  taken_by text, taken_at timestamptz, done_at timestamptz,
  order_ref text
);

create index if not exists live_jobs_open_idx on live_jobs (status, created_at desc);

alter table live_jobs enable row level security;
drop policy if exists lj_read on live_jobs;
create policy lj_read on live_jobs for select using (true);
drop policy if exists lj_insert on live_jobs;
create policy lj_insert on live_jobs for insert with check (true);

-- atomic claim: succeeds only if the job is still open and not your own
create or replace function job_claim(p_job text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update live_jobs
     set status = 'taken', taken_by = p_device, taken_at = now()
   where id = p_job and status = 'open' and device_key <> p_device;
  return found;
end $$;

-- completion: only the partner who claimed it can finish it
create or replace function job_done(p_job text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update live_jobs
     set status = 'done', done_at = now()
   where id = p_job and taken_by = p_device and status = 'taken';
  return found;
end $$;

-- poster can cancel while still open
create or replace function job_cancel(p_job text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update live_jobs
     set status = 'cancelled'
   where id = p_job and device_key = p_device and status = 'open';
  return found;
end $$;

grant execute on function job_claim(text, text) to anon;
grant execute on function job_done(text, text) to anon;
grant execute on function job_cancel(text, text) to anon;

select 'live_jobs marketplace ready' as status;
