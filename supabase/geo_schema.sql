-- ============================================================
-- ORIGNALS GEO — our own places database (the map flywheel)
-- Every address searched, picked, or delivered to becomes OUR
-- hyperlocal India POI data. Safe to run more than once.
-- ============================================================

create extension if not exists pg_trgm;

create table if not exists geo_places (
  id         bigint generated always as identity primary key,
  key        text unique not null,            -- name|lat4|lng4 (dedupe)
  name       text not null,
  sub        text,
  lat        double precision not null,
  lng        double precision not null,
  kind       text not null default 'drop',    -- picked | drop | shop | gps | search
  uses       int not null default 1,          -- popularity → ranking
  device_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_geo_name_trgm on geo_places using gin (name gin_trgm_ops);
create index if not exists idx_geo_sub_trgm  on geo_places using gin (sub gin_trgm_ops);
create index if not exists idx_geo_uses on geo_places (uses desc);

-- upsert-with-popularity: called by the app on every location use
create or replace function geo_touch(p_name text, p_sub text, p_lat double precision,
                                     p_lng double precision, p_kind text, p_device text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into geo_places (key, name, sub, lat, lng, kind, device_key)
  values (lower(p_name || '|' || round(p_lat::numeric, 4) || '|' || round(p_lng::numeric, 4)),
          p_name, p_sub, p_lat, p_lng, coalesce(p_kind, 'drop'), p_device)
  on conflict (key) do update
    set uses = geo_places.uses + 1, updated_at = now(),
        sub = case when length(coalesce(excluded.sub, '')) > length(coalesce(geo_places.sub, ''))
                   then excluded.sub else geo_places.sub end;
end $fn$;

alter table geo_places enable row level security;
do $pol$ begin
  create policy p_geo_read on geo_places for select using (true);
exception when duplicate_object then null;
end $pol$;
