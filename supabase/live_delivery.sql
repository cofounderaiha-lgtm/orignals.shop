-- ============================================================
-- REAL DELIVERY — connect the partner who ACTUALLY claims a job to
-- the buyer's live tracking: real name/vehicle + real GPS, real
-- pickup/deliver events. No more simulated courier for real orders.
-- ============================================================

alter table live_jobs add column if not exists taken_name text;
alter table live_jobs add column if not exists taken_veh text;
alter table live_jobs add column if not exists taken_rating numeric;
alter table live_jobs add column if not exists partner_lat double precision;
alter table live_jobs add column if not exists partner_lng double precision;
alter table live_jobs add column if not exists picked_at timestamptz;

-- atomic claim now records WHO claimed (their public profile), so the
-- buyer and shop show the real partner. Replaces the 2-arg version.
create or replace function job_claim(p_job text, p_device text, p_name text, p_veh text, p_rating numeric)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update live_jobs
     set status = 'taken', taken_by = p_device, taken_at = now(),
         taken_name = left(coalesce(p_name,'Partner'),40), taken_veh = left(coalesce(p_veh,''),40),
         taken_rating = p_rating
   where id = p_job and status = 'open' and device_key <> p_device;
  return found;
end $$;

-- keep the old 2-arg signature working (falls back to no profile)
create or replace function job_claim(p_job text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  return job_claim(p_job, p_device, 'Partner', '', null);
end $$;

-- partner shares live location while carrying the job (buyer sees it move)
create or replace function job_ping(p_job text, p_device text, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  update live_jobs set partner_lat = p_lat, partner_lng = p_lng
   where id = p_job and taken_by = p_device and status = 'taken';
end $$;

-- mark picked up (collected) — for the buyer timeline
create or replace function job_picked(p_job text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update live_jobs set picked_at = now()
   where id = p_job and taken_by = p_device and status = 'taken';
end $$;

-- OTP handover: the buyer's app shows the OTP; the delivery person enters
-- it (or scans the buyer's QR). Verified SERVER-side against the OTP the
-- buyer set on their order — the partner never sees it in advance.
alter table shop_orders add column if not exists drop_otp text;

create or replace function job_deliver(p_job text, p_device text, p_otp text)
returns json language plpgsql security definer set search_path = public as $$
declare v_ref text; v_otp text;
begin
  select order_ref into v_ref from live_jobs where id = p_job and taken_by = p_device and status = 'taken';
  if v_ref is null then return json_build_object('ok', false, 'reason', 'not_your_job'); end if;
  select drop_otp into v_otp from shop_orders where id = v_ref;
  -- if the buyer never set an OTP (e.g. seed/demo), accept to not block
  if v_otp is not null and v_otp <> '' and regexp_replace(coalesce(p_otp,''),'[^0-9]','','g') <> v_otp then
    return json_build_object('ok', false, 'reason', 'wrong_otp');
  end if;
  update live_jobs set status = 'done', done_at = now() where id = p_job and taken_by = p_device;
  update shop_orders set status = 'done' where id = v_ref;
  return json_build_object('ok', true);
end $$;

grant execute on function job_claim(text, text, text, text, numeric) to anon;
grant execute on function job_ping(text, text, double precision, double precision) to anon;
grant execute on function job_picked(text, text) to anon;
grant execute on function job_deliver(text, text, text) to anon;

select 'real delivery ready' as status;
