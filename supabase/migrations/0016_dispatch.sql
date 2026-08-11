-- ============================================================
-- 0016 — DISPATCH ENGINE  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- Today (COMPLETION-ASSESSMENT §J): live_jobs is a first-come PULL feed. Whoever
-- browses and taps job_claim first wins. There is no server-side partner presence,
-- no candidate generation, no scoring, no push offer, no acceptance timeout, and no
-- reassignment. A parcel/ride can sit unclaimed, or be grabbed by a far partner.
--
-- This adds a PUSH layer ON TOP of live_jobs (the pull feed stays as a fallback):
--   · partner_presence — online/location/vehicle/rating/carrying heartbeat.
--   · dispatch_job()   — pick the best nearby idle partner and OFFER the job to them.
--   · job_offers       — a timed offer (accept within N s or it expires).
--   · offer_respond()  — accept (atomically assign) or decline (re-dispatch next).
--   · dispatch_sweep() — pg_cron: expire stale offers, re-dispatch, free carriers.
--   · dispatch_events  — every decision logged (candidates/offer/accept/expire/...).
--
-- ANTI-CARGO-CULT / PROGRESSION:
--   Stage 1 (THIS): nearest idle online partner within radius, rating tiebreak.
--     A single indexed SELECT. No queue/broker. Correct for one locality's density.
--   Stage 2 (trigger: measurable decline/timeout rate, or multi-offer contention):
--     weighted score (ETA + current load + acceptance-probability + reliability),
--     still one SQL scan. Add columns to partner_presence; keep the RPC signatures.
--   Stage 3 (only at real multi-order density): batch/bipartite matching. Not now.
--
-- Assignment is atomic on live_jobs.status ('open'→'taken'), so an offer-accept and
-- a pull-feed job_claim can never double-assign the same job.
-- ============================================================

-- ---------- partner presence (server-side availability + location) ----------
create table if not exists partner_presence (
  device_key text primary key,
  online     boolean not null default false,
  lat        double precision,
  lng        double precision,
  vehicle    text,
  name       text,
  rating     numeric,
  carrying   text,                       -- live_jobs.id the partner is currently on, or null (idle)
  updated_at timestamptz not null default now()
);
create index if not exists partner_presence_live_idx on partner_presence(online, updated_at desc) where online = true;
alter table partner_presence enable row level security;   -- writes via partner_ping; no anon read

-- ---------- job offers (timed push) ----------
create table if not exists job_offers (
  id         bigint generated always as identity primary key,
  job_id     text not null,
  device_key text not null,
  score      numeric,
  status     text not null default 'offered',   -- offered | accepted | declined | expired
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists job_offers_dev_live_idx on job_offers(device_key, status) where status = 'offered';
create index if not exists job_offers_job_idx on job_offers(job_id, status);
-- at most one LIVE offer per (job, partner)
create unique index if not exists job_offers_one_live on job_offers(job_id, device_key) where status = 'offered';
alter table job_offers enable row level security;

-- ---------- dispatch audit ----------
create table if not exists dispatch_events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  job_id  text,
  device_key text,
  kind    text not null,                 -- no_candidates | offered | accepted | declined | expired | assigned | reassigned | freed
  detail  jsonb
);
create index if not exists dispatch_events_job_idx on dispatch_events(job_id, at);
alter table dispatch_events enable row level security;

create or replace function _disp_event(p_job text, p_dev text, p_kind text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into dispatch_events(job_id, device_key, kind, detail) values (p_job, p_dev, p_kind, p_detail);
$$;

-- haversine km (self-contained; consolidation with 0013/0014 haversines happens at staging)
create or replace function _disp_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$
  select case when a_lat is null or a_lng is null or b_lat is null or b_lng is null then null
    else 2 * 6371 * asin(least(1.0, sqrt(
      power(sin(radians((b_lat - a_lat)/2)),2) +
      cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians((b_lng - a_lng)/2)),2)))) end;
$$;

-- ---------- partner heartbeat (device-scoped) ----------
-- NOTE (systemic, tracked in 0011/§H): p_device is trusted as identity (the public
-- device_key). A caller can therefore set/forge presence for a device they name —
-- the platform-wide "device_key is a bearer token" weakness, to be closed by real
-- phone-auth + RBAC (Phase 7). Practical blast radius here is bounded: winning an
-- offer still requires accepting it AND passing the atomic 'open'→'taken' claim AND
-- delivering with the buyer's OTP. Griefing (marking a real partner offline) is the
-- residual risk until identity is hardened.
create or replace function partner_ping(p_device text, p_online boolean, p_lat double precision,
  p_lng double precision, p_vehicle text, p_name text, p_rating numeric)
returns json language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_device,'') = '' then return json_build_object('ok', false, 'reason', 'no_device'); end if;
  insert into partner_presence(device_key, online, lat, lng, vehicle, name, rating, updated_at)
  values (p_device, coalesce(p_online,false), p_lat, p_lng, left(p_vehicle,40), left(p_name,40), p_rating, now())
  on conflict (device_key) do update set
    online = excluded.online, lat = excluded.lat, lng = excluded.lng,
    vehicle = coalesce(excluded.vehicle, partner_presence.vehicle),
    name = coalesce(excluded.name, partner_presence.name),
    rating = coalesce(excluded.rating, partner_presence.rating),
    updated_at = now();
  return json_build_object('ok', true);
end $$;
grant execute on function partner_ping(text, boolean, double precision, double precision, text, text, numeric) to anon;

-- ---------- core: offer a job to the best nearby idle partner ----------
-- INTERNAL: called by the after-insert trigger on live_jobs, by offer_respond on a
-- decline, and by dispatch_sweep. Not granted to anon. Never raises (dispatch must
-- not block a job post). Radius + freshness bounded; own poster excluded.
create or replace function dispatch_job(p_job text)
returns json language plpgsql security definer set search_path = public as $$
declare v_flat double precision; v_flng double precision; v_status text; v_poster text;
        v_dev text; v_km double precision; v_exp interval := interval '25 seconds';
begin
  -- serialize concurrent dispatch of the SAME job (insert-trigger vs sweep vs a
  -- decline re-dispatch) so two candidates can't be offered one job at once. The
  -- xact lock releases at commit; different jobs hash to different locks.
  perform pg_advisory_xact_lock(hashtext('dispatch:' || p_job));

  select from_lat, from_lng, status, device_key into v_flat, v_flng, v_status, v_poster
    from live_jobs where id = p_job;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_status <> 'open' then return json_build_object('ok', false, 'reason', 'not_open'); end if;
  -- already has a live offer? leave it to run its clock
  if exists (select 1 from job_offers where job_id = p_job and status = 'offered' and expires_at > now()) then
    return json_build_object('ok', true, 'reason', 'offer_pending');
  end if;

  select pp.device_key, _disp_km(v_flat, v_flng, pp.lat, pp.lng)
    into v_dev, v_km
  from partner_presence pp
  where pp.online = true
    and pp.carrying is null                                   -- idle
    and pp.lat is not null
    and pp.updated_at > now() - interval '2 minutes'          -- fresh heartbeat
    and pp.device_key <> coalesce(v_poster, '')               -- don't offer to the poster
    and (v_flat is null or _disp_km(v_flat, v_flng, pp.lat, pp.lng) <= 8)   -- within 8 km
    and not exists (select 1 from job_offers o                -- not already tried this job
                    where o.job_id = p_job and o.device_key = pp.device_key
                      and o.status in ('offered','declined','expired'))
  order by coalesce(_disp_km(v_flat, v_flng, pp.lat, pp.lng), 1e9) asc,   -- nearest
           coalesce(pp.rating, 4.5) desc                                   -- then best-rated
  limit 1;

  if v_dev is null then
    perform _disp_event(p_job, null, 'no_candidates', null);
    return json_build_object('ok', false, 'reason', 'no_candidates');       -- stays open → pull-feed fallback
  end if;

  insert into job_offers(job_id, device_key, score, status, expires_at)
  values (p_job, v_dev, round(coalesce(1000 - v_km*10, 0)::numeric, 2), 'offered', now() + v_exp)
  on conflict do nothing;
  perform _disp_event(p_job, v_dev, 'offered', json_build_object('km', round(coalesce(v_km,0)::numeric,2))::jsonb);
  return json_build_object('ok', true, 'offered_to', v_dev, 'km', round(coalesce(v_km,0)::numeric,2),
                           'expires_secs', extract(epoch from v_exp));
exception when others then
  return json_build_object('ok', false, 'reason', 'dispatch_error');        -- never block the caller
end $$;

-- ---------- partner accepts / declines an offer ----------
create or replace function offer_respond(p_job text, p_device text, p_accept boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_have boolean; v_name text; v_veh text; v_rat numeric;
begin
  update job_offers set status = case when p_accept then 'accepted' else 'declined' end
   where job_id = p_job and device_key = p_device and status = 'offered' and expires_at > now()
   returning true into v_have;
  if not coalesce(v_have,false) then return json_build_object('ok', false, 'reason', 'no_live_offer'); end if;

  if not p_accept then
    perform _disp_event(p_job, p_device, 'declined', null);
    perform dispatch_job(p_job);                                  -- immediately try the next candidate
    return json_build_object('ok', true, 'assigned', false);
  end if;

  -- a partner may hold only ONE job at a time — a live offer for job B could have
  -- been made before they accepted job A; refuse rather than overwrite carrying.
  if (select carrying from partner_presence where device_key = p_device) is not null then
    update job_offers set status = 'expired' where job_id = p_job and device_key = p_device and status = 'accepted';
    return json_build_object('ok', false, 'reason', 'already_carrying');
  end if;

  select name, vehicle, rating into v_name, v_veh, v_rat from partner_presence where device_key = p_device;
  -- atomic assign — only if still open (a pull-feed claim may have taken it)
  update live_jobs
     set status = 'taken', taken_by = p_device, taken_at = now(),
         taken_name = left(coalesce(v_name,'Partner'),40), taken_veh = left(coalesce(v_veh,''),40),
         taken_rating = v_rat
   where id = p_job and status = 'open';
  if not found then
    update job_offers set status = 'expired' where job_id = p_job and device_key = p_device and status = 'accepted';
    return json_build_object('ok', false, 'reason', 'already_taken');
  end if;
  update partner_presence set carrying = p_job, updated_at = now() where device_key = p_device;
  update job_offers set status = 'expired' where job_id = p_job and status = 'offered' and device_key <> p_device;
  perform _disp_event(p_job, p_device, 'accepted', null);
  return json_build_object('ok', true, 'assigned', true);
exception when others then
  return json_build_object('ok', false, 'reason', 'respond_error');
end $$;
grant execute on function offer_respond(text, text, boolean) to anon;

-- ---------- a partner reads their own live offers ----------
create or replace function my_offers(p_device text)
returns table (job_id text, score numeric, expires_at timestamptz,
               what text, jtype text, from_name text, to_name text, km numeric, pay numeric,
               from_lat double precision, from_lng double precision, to_lat double precision, to_lng double precision)
language sql security definer set search_path = public stable as $$
  select o.job_id, o.score, o.expires_at,
         j.what, j.jtype, j.from_name, j.to_name, j.km, j.pay,
         j.from_lat, j.from_lng, j.to_lat, j.to_lng
  from job_offers o join live_jobs j on j.id = o.job_id
  where o.device_key = p_device and o.status = 'offered' and o.expires_at > now()
    and j.status = 'open'
  order by o.offered_at asc;
$$;
grant execute on function my_offers(text) to anon;

-- ---------- pg_cron sweep: expire, re-dispatch, free carriers ----------
-- INTERNAL (run by pg_cron / service role). Not granted to anon.
create or replace function dispatch_sweep()
returns json language plpgsql security definer set search_path = public as $$
declare v_expired int; v_redispatched int := 0; v_freed int; r record;
begin
  -- 1) expire timed-out offers
  update job_offers set status = 'expired' where status = 'offered' and expires_at <= now();
  get diagnostics v_expired = row_count;

  -- 2) free partners whose job is no longer theirs/active (done/reopened/reassigned)
  update partner_presence pp set carrying = null, updated_at = now()
  where pp.carrying is not null
    and not exists (select 1 from live_jobs lj where lj.id = pp.carrying and lj.taken_by = pp.device_key and lj.status = 'taken');
  get diagnostics v_freed = row_count;

  -- 3) re-dispatch still-open recent jobs that have no live offer
  for r in
    select j.id from live_jobs j
    where j.status = 'open' and j.created_at > now() - interval '30 minutes'
      and not exists (select 1 from job_offers o where o.job_id = j.id and o.status = 'offered' and o.expires_at > now())
    limit 200
  loop
    if (dispatch_job(r.id)->>'ok') = 'true' then v_redispatched := v_redispatched + 1; end if;
  end loop;

  return json_build_object('ok', true, 'expired', v_expired, 'freed', v_freed, 'redispatched', v_redispatched);
end $$;
-- STAGING: schedule every 20s, e.g.
--   select cron.schedule('dispatch_sweep', '20 seconds', $$select dispatch_sweep()$$);
-- (pg_cron min granularity is 1 min on some plans; use a 4x/min statement or a
--  '* * * * *' job that loops 3x with pg_sleep if sub-minute is needed.)

-- ---------- auto-dispatch a job the moment it is posted ----------
create or replace function _dispatch_on_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'open' then perform dispatch_job(new.id); end if;   -- never raises (dispatch_job is guarded)
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_dispatch_on_post on live_jobs;
create trigger trg_dispatch_on_post after insert on live_jobs
  for each row execute function _dispatch_on_post();

-- PAIRED CLIENT CHANGES (when staged): earn.js sends partner_ping on going online +
-- a location heartbeat; the earn feed reads my_offers() and shows an accept/decline
-- with the countdown, calling offer_respond(). The existing pull feed (open_jobs/
-- job_claim) stays as the fallback for no-candidate jobs.

-- ---------- proof (expect PASS) ----------
do $$
declare r json; v_n int; v_status text;
begin
  delete from job_offers where job_id in ('DISP_J1');
  delete from dispatch_events where job_id in ('DISP_J1');
  delete from live_jobs where id in ('DISP_J1');
  delete from partner_presence where device_key in ('disp_near','disp_far','disp_poster');

  -- two idle online partners: NEAR (~0.1km) and FAR (~1km) from pickup (0,0)
  perform partner_ping('disp_near',  true, 0.001, 0.000, 'bike', 'Near Rider', 4.9);
  perform partner_ping('disp_far',   true, 0.009, 0.000, 'bike', 'Far Rider',  5.0);

  -- posting the job auto-dispatches (trigger) → nearest gets the offer
  insert into live_jobs(id, device_key, what, jtype, from_lat, from_lng, to_lat, to_lng, km, pay, status)
    values ('DISP_J1', 'disp_poster', 'Tiffin', 'box', 0, 0, 0.02, 0, 2.2, 40, 'open');

  select count(*) into v_n from job_offers where job_id='DISP_J1' and device_key='disp_near' and status='offered';
  assert v_n = 1, 'FAIL: nearest partner was not offered the job on post';
  assert not exists(select 1 from job_offers where job_id='DISP_J1' and device_key='disp_far' and status='offered'),
         'FAIL: far partner should not be offered first';

  -- NEAR declines → FAR gets the next offer
  r := offer_respond('DISP_J1', 'disp_near', false);
  assert (r->>'ok')='true' and (r->>'assigned')='false', 'FAIL: decline not handled';
  assert exists(select 1 from job_offers where job_id='DISP_J1' and device_key='disp_far' and status='offered'),
         'FAIL: job not re-dispatched to next candidate after decline';

  -- FAR accepts → job assigned, partner marked carrying, atomically taken
  r := offer_respond('DISP_J1', 'disp_far', true);
  assert (r->>'ok')='true' and (r->>'assigned')='true', 'FAIL: accept did not assign';
  select status into v_status from live_jobs where id='DISP_J1';
  assert v_status = 'taken', 'FAIL: live_jobs not marked taken on accept';
  assert (select taken_by from live_jobs where id='DISP_J1') = 'disp_far', 'FAIL: wrong assignee';
  assert (select carrying from partner_presence where device_key='disp_far') = 'DISP_J1', 'FAIL: carrier not set';

  -- a partner already carrying cannot accept a SECOND job (guard against
  -- overwriting carrying with a stale offer for another job)
  insert into live_jobs(id, device_key, what, jtype, from_lat, from_lng, status)
    values ('DISP_J1b','disp_poster','x','box',0,0,'open');
  insert into job_offers(job_id, device_key, status, expires_at)
    values ('DISP_J1b','disp_far','offered', now()+interval '25 seconds') on conflict do nothing;
  r := offer_respond('DISP_J1b','disp_far', true);
  assert (r->>'ok')='false' and (r->>'reason')='already_carrying', 'FAIL: carrying partner accepted a 2nd job';
  delete from job_offers where job_id='DISP_J1b';
  delete from dispatch_events where job_id='DISP_J1b';
  delete from live_jobs where id='DISP_J1b';

  -- an accept after the job is gone must not double-assign
  insert into job_offers(job_id, device_key, status, expires_at) values ('DISP_J1','disp_near','offered', now()+interval '25 seconds');
  r := offer_respond('DISP_J1', 'disp_near', true);
  assert (r->>'ok')='false' and (r->>'reason')='already_taken', 'FAIL: double-assign not prevented';

  -- sweep frees the carrier once the job completes
  update live_jobs set status='done' where id='DISP_J1';
  perform dispatch_sweep();
  assert (select carrying from partner_presence where device_key='disp_far') is null, 'FAIL: carrier not freed after done';

  -- cleanup
  delete from job_offers where job_id='DISP_J1';
  delete from dispatch_events where job_id='DISP_J1';
  delete from live_jobs where id='DISP_J1';
  delete from partner_presence where device_key in ('disp_near','disp_far','disp_poster');
  raise notice 'PASS: nearest-first offer, decline→reassign, atomic accept, no double-assign, carrier freed on done';
end $$;

select 'dispatch engine ready' as status;
