-- ============================================================
-- ANALYTICS — precise & detailed upgrade.
-- Adds exact locality (reverse-geocoded client-side) + browser, and
-- richer breakdowns: language, browser, hour-of-day, new vs returning,
-- visitor type, plus coordinates on the geography rows.
-- ============================================================
alter table analytics_events add column if not exists place   text;
alter table analytics_events add column if not exists browser text;

-- widen track_hit with two trailing DEFAULT params (backward compatible:
-- old 14-arg callers still resolve; defaults fill place/browser)
drop function if exists track_hit(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,numeric);
create or replace function track_hit(
  p_device text, p_session text, p_kind text, p_name text, p_ref text,
  p_role text, p_uad text, p_lang text,
  p_country text, p_region text, p_city text,
  p_lat double precision, p_lng double precision, p_val numeric,
  p_place text default null, p_browser text default null)
returns json language plpgsql security definer set search_path=public as $$
begin
  if p_kind not in ('page','ping','event') then return json_build_object('ok',false); end if;
  insert into analytics_events(device,session,kind,name,ref,role,uad,lang,country,region,city,lat,lng,val,place,browser)
  values (left(coalesce(p_device,''),64), left(coalesce(p_session,''),64), p_kind,
          left(coalesce(p_name,''),120), left(coalesce(p_ref,''),120), left(coalesce(p_role,''),16),
          left(coalesce(p_uad,''),12), left(coalesce(p_lang,''),12),
          left(coalesce(p_country,''),4), left(coalesce(p_region,''),64), left(coalesce(p_city,''),80),
          p_lat, p_lng, p_val, left(coalesce(p_place,''),120), left(coalesce(p_browser,''),24));
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $$;

create or replace function analytics_overview(p_token text, p_days int)
returns json language plpgsql security definer set search_path=public as $$
declare v_since timestamptz; v_days int;
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  v_days := least(greatest(coalesce(p_days,30),1),90);
  v_since := now() - (v_days || ' days')::interval;
  return json_build_object(
    'ok', true,
    'live', (select count(distinct device) from analytics_events where kind='ping' and ts > now()-interval '70 seconds'),
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
    'browsers', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(browser,''),'—') browser, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc limit 8) t),
    'langs', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(lang,''),'—') lang, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc limit 10) t),
    'roles', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(role,''),'—') role, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc) t),
    'hours', (select coalesce(json_agg(row_to_json(t) order by t.hr),'[]'::json) from (
        select extract(hour from ts at time zone 'Asia/Kolkata')::int hr, count(*) views
        from analytics_events where kind='page' and ts > v_since group by 1) t),
    'newret', (select json_build_object(
        'new', count(*) filter (where first_seen >= v_since),
        'returning', count(*) filter (where first_seen < v_since))
        from (select device, min(ts) first_seen from analytics_events group by device
              having max(ts) > v_since) f),
    'geo', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(place,''), nullif(city,''), 'Unknown / private') place,
               coalesce(nullif(city,''),'') city, coalesce(nullif(region,''),'') region,
               coalesce(nullif(country,''),'—') country,
               count(distinct device) visitors, count(*) views,
               round(avg(lat)::numeric,4) lat, round(avg(lng)::numeric,4) lng
        from analytics_events where kind='page' and ts > v_since
        group by 1,2,3,4 order by visitors desc limit 25) t),
    'events', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select name, count(*) n, coalesce(sum(val),0) value
        from analytics_events where kind='event' and ts > v_since group by name order by n desc limit 12) t)
  );
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function analytics_live(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,
    'now', (select count(distinct device) from analytics_events where kind='ping' and ts > now()-interval '70 seconds'),
    'people', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
      select distinct on (device) device, name page, place, city, region, country, uad, browser, role, lat, lng,
             extract(epoch from (now()-ts))::int ago
      from analytics_events
      where ts > now()-interval '5 minutes' and kind in ('page','ping')
      order by device, ts desc limit 300) t)
  );
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function track_hit(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,numeric,text,text) to anon;
grant execute on function analytics_overview(text,int) to anon;
grant execute on function analytics_live(text) to anon;

select 'analytics precise+detailed ready' as status;
