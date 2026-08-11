-- 0013 eta_engine — NOT YET APPLIED (written by full-build)
-- ============================================================
-- 0013 — ETA ENGINE  (⚠ written 2026-08-11, NOT YET APPLIED)
--
-- Today the app fakes an ETA in JS: stage timers are a straight-line
-- distance * a hard-coded constant (core.js:322 `40 + km*16`, capped).
-- It never learns. This migration makes ETA a REAL, self-improving
-- estimate computed server-side from (a) haversine distance, (b) a
-- congestion-aware speed profile (secs/km varies by distance band —
-- short first/last-mile hops are slower per km than long open runs),
-- and (c) the historical MEDIAN secs/km actually observed on the
-- ground for that distance band, once enough samples exist.
--
-- ALGORITHM PROGRESSION (implement the simplest sufficient stage now):
--   Stage 0 (old): haversine * one global constant.                (replaced)
--   Stage 1 (THIS): haversine * per-band speed profile, then blend
--                   toward the per-band historical median secs/km
--                   with a weight that grows as samples accumulate.
--   Stage 2 (next, trigger >= 500 samples/band): swap the median for
--                   a small feature model (hour-of-day, weekday, rain
--                   flag, band) fit in-DB — still just SQL/plpgsql, no
--                   external infra. Add features as columns to
--                   eta_samples; keep this RPC's signature stable.
--
-- Postgres-first, zero external infra. eta_samples is append-only.
-- ============================================================

-- actuals: every completed leg/order records what REALLY happened
create table if not exists eta_samples (
  id    bigint generated always as identity primary key,
  kind  text not null,                 -- prep | pickup | transit | total
  km    numeric not null check (km >= 0),
  secs  int     not null check (secs >= 0),
  at    timestamptz not null default now()
);
-- the hot read is "median secs/km for this kind in this distance band,
-- recent-first" — a (kind, km) index serves the band scan cheaply.
create index if not exists idx_eta_samples_kind_km on eta_samples(kind, km);
create index if not exists idx_eta_samples_at      on eta_samples(at desc);

alter table eta_samples enable row level security;
-- No PII, no money, no device link — pure operational telemetry. But we
-- still route writes through the SECURITY DEFINER RPC (validation +
-- consistency) rather than a blanket anon INSERT policy, and reads go
-- through eta_estimate. So: no anon policies at all.
drop policy if exists eta_read  on eta_samples;
drop policy if exists eta_write on eta_samples;

-- ---- helpers (immutable, pure math) ----

-- great-circle distance in km
create or replace function _eta_haversine(
  a_lat double precision, a_lng double precision,
  b_lat double precision, b_lng double precision)
returns numeric language sql immutable as $$
  select case
    when a_lat is null or a_lng is null or b_lat is null or b_lng is null then 0::numeric
    else round((2 * 6371 * asin(least(1.0, sqrt(
           power(sin(radians((b_lat - a_lat) / 2)), 2) +
           cos(radians(a_lat)) * cos(radians(b_lat)) *
           power(sin(radians((b_lng - a_lng) / 2)), 2)
         ))))::numeric, 3)
  end;
$$;

-- distance band label — coarse buckets that share driving character
create or replace function _eta_band(p_km numeric)
returns text language sql immutable as $$
  select case
    when p_km < 1  then 'b0'      -- last-mile / same-lane
    when p_km < 3  then 'b1'      -- neighbourhood
    when p_km < 6  then 'b2'      -- across-town
    when p_km < 12 then 'b3'      -- edge-of-town
    else                'b4'      -- inter-locality
  end;
$$;

-- default speed profile: seconds per km by band. Deliberately DECREASING
-- with distance (short hops crawl through lanes/lights; long runs open up).
-- Tuned for a tier-2/3 two-wheeler Mitra. This is the deterministic floor
-- used until real data outvotes it.
create or replace function _eta_default_spk(p_km numeric)
returns numeric language sql immutable as $$
  select case _eta_band(p_km)
    when 'b0' then 240::numeric   -- ~15 km/h
    when 'b1' then 180::numeric   -- ~20 km/h
    when 'b2' then 150::numeric   -- ~24 km/h
    when 'b3' then 132::numeric   -- ~27 km/h
    else            120::numeric  -- ~30 km/h
  end;
$$;

-- how many samples in a band before we trust its median at all
create or replace function _eta_min_samples() returns int language sql immutable as $$ select 3; $$;

-- ---- estimate ----
-- Returns {distance_km, transit_secs, prep_secs, eta_secs, basis}.
-- basis: 'default'  (no/too-few samples → pure speed profile)
--        'blended'  (speed profile blended toward historical median)
create or replace function eta_estimate(
  p_from_lat double precision, p_from_lng double precision,
  p_to_lat   double precision, p_to_lng   double precision,
  p_prep_secs int default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_km      numeric;
  v_default numeric;
  v_median  numeric;
  v_n       int;
  v_w       numeric;
  v_spk     numeric;
  v_prep    int;
  v_transit int;
  v_basis   text;
begin
  v_km      := _eta_haversine(p_from_lat, p_from_lng, p_to_lat, p_to_lng);
  v_default := _eta_default_spk(v_km);
  v_prep    := greatest(coalesce(p_prep_secs, 90), 0);   -- default 90s shop prep

  -- historical median secs/km for THIS band's transit legs
  select count(*), percentile_cont(0.5) within group (order by secs::numeric / nullif(km, 0))
    into v_n, v_median
    from eta_samples
   where kind = 'transit'
     and km > 0
     and _eta_band(km) = _eta_band(v_km);

  if v_n >= _eta_min_samples() and v_median is not null then
    -- shrinkage blend: weight toward observed grows with sample count,
    -- capped so a handful of odd trips can't dominate the profile.
    -- w = n/(n+8), capped 0.85 → at n=3 ~0.27, at n=45 ~0.85.
    v_w   := least(v_n::numeric / (v_n + 8), 0.85);
    v_spk := round(v_w * v_median + (1 - v_w) * v_default, 3);
    v_basis := 'blended';
  else
    v_spk   := v_default;
    v_basis := 'default';
  end if;

  v_transit := round(v_km * v_spk)::int;

  return json_build_object(
    'distance_km', round(v_km, 2),
    'transit_secs', v_transit,
    'prep_secs',    v_prep,
    'eta_secs',     v_prep + v_transit,
    'basis',        v_basis
  );
end $$;
grant execute on function eta_estimate(double precision, double precision, double precision, double precision, int) to anon;

-- ---- record an actual ----
-- Appended when a leg completes (prep done, picked up, delivered).
create or replace function eta_record(p_kind text, p_km numeric, p_secs int)
returns json language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_kind is null or p_kind not in ('prep', 'pickup', 'transit', 'total') then
    return json_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  -- reject impossible/garbage samples so they can't poison the median:
  -- non-positive time, or a speed faster than 120 km/h (30 s/km) on a
  -- non-trivial distance.
  if p_km is null or p_km < 0 or p_secs is null or p_secs < 0 then
    return json_build_object('ok', false, 'reason', 'bad_values');
  end if;
  if p_km >= 0.2 and p_secs::numeric / p_km < 30 then
    return json_build_object('ok', false, 'reason', 'implausible_speed');
  end if;

  insert into eta_samples(kind, km, secs) values (p_kind, round(p_km, 3), p_secs);
  select count(*) into v_n from eta_samples where kind = p_kind;
  return json_build_object('ok', true, 'kind', p_kind, 'samples', v_n);
end $$;
grant execute on function eta_record(text, numeric, int) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare
  e2 json; e5 json; e10 json;
  base json; shifted json;
  r json;
  base_transit int; shifted_transit int;
begin
  -- clean slate for the band we exercise (id-stamped test rows only)
  -- (we insert via eta_record and delete exactly what we add below)

  -- (1) MONOTONIC IN DISTANCE — from (0,0) heading east, longer = later.
  --     ~2km, ~5km, ~10km via lng deltas (1 deg lng ≈ 111.32 km @ equator).
  e2  := eta_estimate(0, 0, 0, 0.018, 90);   -- ~2.00 km
  e5  := eta_estimate(0, 0, 0, 0.045, 90);   -- ~5.01 km
  e10 := eta_estimate(0, 0, 0, 0.090, 90);   -- ~10.02 km
  assert (e2->>'basis') = 'default',  'FAIL: expected default basis with no samples';
  assert (e2->>'eta_secs')::int  < (e5->>'eta_secs')::int,  'FAIL: eta not increasing 2->5 km';
  assert (e5->>'eta_secs')::int  < (e10->>'eta_secs')::int, 'FAIL: eta not increasing 5->10 km';
  assert (e2->>'transit_secs')::int > 0, 'FAIL: zero transit for a real distance';

  -- (2) RECORDING SHIFTS THE ESTIMATE TOWARD THE OBSERVED.
  --     Baseline for a ~5km trip (band b2, default 150 s/km → ~750s).
  base := eta_estimate(0, 0, 0, 0.045, 90);
  base_transit := (base->>'transit_secs')::int;
  assert (base->>'basis') = 'default', 'FAIL: baseline should be default';

  -- Observe reality is SLOWER: 5km taking 1500s = 300 s/km, several times.
  r := eta_record('transit', 5, 1500); assert (r->>'ok')='true', 'FAIL: record 1 rejected';
  r := eta_record('transit', 5, 1500); assert (r->>'ok')='true', 'FAIL: record 2 rejected';
  r := eta_record('transit', 5, 1500); assert (r->>'ok')='true', 'FAIL: record 3 rejected';

  shifted := eta_estimate(0, 0, 0, 0.045, 90);
  shifted_transit := (shifted->>'transit_secs')::int;
  assert (shifted->>'basis') = 'blended', 'FAIL: basis did not become blended after enough samples';
  assert shifted_transit > base_transit,
         format('FAIL: estimate did not shift toward slower reality (base=%s shifted=%s)', base_transit, shifted_transit);
  -- and it must stay BELOW the raw observed (blend, not overwrite): 5km*300=1500
  assert shifted_transit < 1500, 'FAIL: blend overshot the observed value';

  -- (3) garbage samples are rejected, not stored.
  r := eta_record('transit', 5, 10);     assert (r->>'ok')='false', 'FAIL: implausible speed accepted';
  r := eta_record('nonsense', 5, 900);   assert (r->>'ok')='false', 'FAIL: bad kind accepted';
  r := eta_record('transit', -1, 900);   assert (r->>'ok')='false', 'FAIL: negative km accepted';

  -- cleanup: remove exactly the test samples we inserted
  delete from eta_samples where kind = 'transit' and km = 5 and secs = 1500;

  raise notice 'PASS: eta_estimate monotonic in distance; recording shifts estimate toward observed (base=% shifted=%)', base_transit, shifted_transit;
end $$;

select 'eta_engine ready' as status;
