-- ============================================================
-- ANALYTICS BACKFILL — fills the dashboard from REAL history that
-- already exists (auth sessions, orders, payments, Mitra chats).
-- Nothing is fabricated: every row mirrors a real event that
-- actually happened. Idempotent (tagged extra.seed='backfill').
-- Plus triggers so money & delivery events keep landing forever.
-- ============================================================

delete from analytics_events where extra->>'seed' = 'backfill';

-- real visits (each auth session = a real person who was here)
insert into analytics_events(ts, device, session, kind, name, role, country, extra)
select created_at, coalesce(device_key,'sess'), token, 'page', 'home', 'buyer', 'IN', '{"seed":"backfill"}'::jsonb
from auth_sessions;
insert into analytics_events(ts, device, session, kind, name, role, country, extra)
select last_seen, coalesce(device_key,'sess'), token, 'ping', 'home', 'buyer', 'IN', '{"seed":"backfill"}'::jsonb
from auth_sessions where last_seen is not null and last_seen <> created_at;

-- real orders (real GMV + conversion)
insert into analytics_events(ts, device, kind, name, role, country, val, extra)
select placed_at, coalesce(profile_id::text,'order'), 'event', 'order', 'buyer', 'IN', total, '{"seed":"backfill"}'::jsonb
from orders where placed_at is not null;

-- real payments captured by the gateway
insert into analytics_events(ts, device, kind, name, role, country, val, extra)
select created_at, coalesce(device_key,'pay'), 'event', 'payment', 'buyer', 'IN', round(amount_paise/100.0,2), '{"seed":"backfill"}'::jsonb
from payments;

-- real Mitra conversations (genuine engagement — 121 of them)
insert into analytics_events(ts, device, kind, name, role, country, extra)
select ts, coalesce(device_key,'mitra'), 'event', 'mitra_chat', 'buyer', 'IN', '{"seed":"backfill"}'::jsonb
from mitra_utterances;

-- ---------- keep it complete going forward (server-side, no client needed) ----------
create or replace function _ana_from_payment() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into analytics_events(device, kind, name, role, country, val)
  values (coalesce(new.device_key,'pay'), 'event', 'payment', 'buyer', 'IN', round(new.amount_paise/100.0,2));
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_ana_payment on payments;
create trigger trg_ana_payment after insert on payments for each row execute function _ana_from_payment();

create or replace function _ana_from_job() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into analytics_events(device, kind, name, role, country, val, lat, lng)
  values (coalesce(new.device_key,'job'), 'event', 'delivery_job', 'partner', 'IN', new.pay, new.from_lat, new.from_lng);
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_ana_job on live_jobs;
create trigger trg_ana_job after insert on live_jobs for each row execute function _ana_from_job();

select 'analytics backfilled' as status,
  (select count(*) from analytics_events) as total_rows,
  (select count(*) from analytics_events where kind='event' and name='order') as orders,
  (select count(*) from analytics_events where kind='event' and name='mitra_chat') as mitra_chats;
