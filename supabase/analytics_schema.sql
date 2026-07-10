-- ============================================================
-- ORIGNALS ANALYTICS — first-party, precise, privacy-owned.
-- No Google Analytics, no third party. Every hit is our own row.
-- Writes are open (anon beacon); READS are locked to L4+ admins
-- via the same _admin_level(token) gate the rest of the panel uses.
-- Geography (country/city/lat/lng) is filled by the Vercel edge
-- function /api/track from request headers — city-precise, no GPS
-- prompt, no PII. Device is an anonymous per-browser key.
-- ============================================================

create table if not exists analytics_events (
  id       bigint generated always as identity primary key,
  ts       timestamptz not null default now(),
  device   text,                 -- anonymous per-browser key
  session  text,                 -- per-visit id
  kind     text not null,        -- 'page' | 'ping' | 'event'
  name     text,                 -- route (page) or event name
  ref      text,                 -- referrer host (entry)
  role     text,                 -- guest | buyer | partner | shop | staff
  uad      text,                 -- mobile | tablet | desktop
  lang     text,
  country  text,
  region   text,
  city     text,
  lat      double precision,
  lng      double precision,
  val      numeric,              -- event value (e.g. order amount)
  extra    jsonb
);
create index if not exists ana_ts_idx     on analytics_events (ts desc);
create index if not exists ana_kind_ts_idx on analytics_events (kind, ts desc);
create index if not exists ana_dev_idx    on analytics_events (device);
create index if not exists ana_geo_idx    on analytics_events (country, city);
alter table analytics_events enable row level security;   -- RPC-only

-- ---------- WRITE: open beacon (anon), tightly bounded ----------
create or replace function track_hit(
  p_device text, p_session text, p_kind text, p_name text, p_ref text,
  p_role text, p_uad text, p_lang text,
  p_country text, p_region text, p_city text,
  p_lat double precision, p_lng double precision, p_val numeric)
returns json language plpgsql security definer set search_path=public as $$
begin
  if p_kind not in ('page','ping','event') then return json_build_object('ok',false); end if;
  insert into analytics_events(device,session,kind,name,ref,role,uad,lang,country,region,city,lat,lng,val)
  values (left(coalesce(p_device,''),64), left(coalesce(p_session,''),64), p_kind,
          left(coalesce(p_name,''),120), left(coalesce(p_ref,''),120), left(coalesce(p_role,''),16),
          left(coalesce(p_uad,''),12), left(coalesce(p_lang,''),12),
          left(coalesce(p_country,''),4), left(coalesce(p_region,''),64), left(coalesce(p_city,''),80),
          p_lat, p_lng, p_val);
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $$;

-- ---------- READ: full dashboard in one call (L4+) ----------
create or replace function analytics_overview(p_token text, p_days int)
returns json language plpgsql security definer set search_path=public as $$
declare v_since timestamptz; v_days int;
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  v_days := least(greatest(coalesce(p_days,30),1),90);
  v_since := now() - (v_days || ' days')::interval;
  return json_build_object(
    'ok', true,
    'live',    (select count(distinct device) from analytics_events where kind='ping' and ts > now()-interval '70 seconds'),
    'cards', json_build_object(
      'visits_today',  (select count(distinct device) from analytics_events where ts::date = (now() at time zone 'Asia/Kolkata')::date),
      'visits_7d',     (select count(distinct device) from analytics_events where ts > now()-interval '7 days'),
      'visits_30d',    (select count(distinct device) from analytics_events where ts > now()-interval '30 days'),
      'views_today',   (select count(*) from analytics_events where kind='page' and ts::date = (now() at time zone 'Asia/Kolkata')::date),
      'views_window',  (select count(*) from analytics_events where kind='page' and ts > v_since),
      'orders_window', (select count(*) from analytics_events where kind='event' and name='order' and ts > v_since),
      'gmv_window',    (select coalesce(sum(val),0) from analytics_events where kind='event' and name='order' and ts > v_since),
      'signups_window',(select count(*) from analytics_events where kind='event' and name='signup' and ts > v_since)
    ),
    'series', (select coalesce(json_agg(row_to_json(t) order by t.d),'[]'::json) from (
        select to_char(date_trunc('day', ts at time zone 'Asia/Kolkata'),'YYYY-MM-DD') d,
               count(distinct device) visits, count(*) filter (where kind='page') views
        from analytics_events where ts > v_since group by 1) t),
    'pages', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select name, count(*) views, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since and coalesce(name,'')<>'' group by name order by views desc limit 12) t),
    'refs', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select case when coalesce(ref,'')='' then 'direct / app' else ref end ref, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc limit 10) t),
    'devices', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(uad,''),'unknown') uad, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc) t),
    'geo', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(country,''),'—') country, coalesce(nullif(city,''),'—') city,
               count(distinct device) visitors, count(*) views
        from analytics_events where kind='page' and ts > v_since group by 1,2 order by visitors desc limit 20) t),
    'events', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select name, count(*) n, coalesce(sum(val),0) value
        from analytics_events where kind='event' and ts > v_since group by name order by n desc limit 12) t)
  );
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- READ: who is online RIGHT NOW, for the live map (L4+) ----------
create or replace function analytics_live(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,
    'now', (select count(distinct device) from analytics_events where kind='ping' and ts > now()-interval '70 seconds'),
    'people', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
      select distinct on (device) device, name page, city, region, country, uad, role, lat, lng,
             extract(epoch from (now()-ts))::int ago
      from analytics_events
      where ts > now()-interval '5 minutes' and kind in ('page','ping')
      order by device, ts desc limit 300) t)
  );
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- housekeeping: keep the table lean (call from a cron if wanted) ----------
create or replace function analytics_prune(p_token text, p_keep_days int)
returns json language plpgsql security definer set search_path=public as $$
begin
  if _admin_level(p_token) <> 'l5' then return json_build_object('ok',false,'reason','forbidden'); end if;
  delete from analytics_events where ts < now() - (least(greatest(coalesce(p_keep_days,180),7),3650) || ' days')::interval;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $$;

grant execute on function track_hit(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,numeric) to anon;
grant execute on function analytics_overview(text,int) to anon;
grant execute on function analytics_live(text) to anon;
grant execute on function analytics_prune(text,int) to anon;

select 'analytics ready' as status;
