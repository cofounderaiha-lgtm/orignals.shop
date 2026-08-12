-- ============================================================
-- 0035 — CONFIG PLATFORM: feature flags + platform economics  (⚠ FROZEN — validated)
--   Written 2026-08-12. §78 feature flags (percentage rollout, cohort) + §76/§79
--   configurable economics (commission, fees) so business rules are DATA, not
--   hardcoded source edits. Flags evaluate deterministically per device.
-- ============================================================

-- ---------- feature flags ----------
create table if not exists feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  rollout_pct int not null default 100 check (rollout_pct between 0 and 100),
  cohort      text,                          -- advisory: 'staff' | 'city:DEL' | ...
  updated_at  timestamptz not null default now()
);
alter table feature_flags enable row level security;

-- deterministic per-device rollout: same device+flag → same answer, ~pct% of devices on
create or replace function flag_on(p_key text, p_device text)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((
    select case
      when not enabled       then false
      when rollout_pct >= 100 then true
      when rollout_pct <= 0   then false
      else (abs(hashtext(coalesce(p_device,'') || ':' || p_key)) % 100) < rollout_pct
    end
    from feature_flags where key = p_key), false);
$$;
grant execute on function flag_on(text, text) to anon;

create or replace function flag_set(p_token text, p_key text, p_enabled boolean, p_rollout_pct int, p_cohort text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  insert into feature_flags(key, enabled, rollout_pct, cohort, updated_at)
  values (p_key, coalesce(p_enabled,false), greatest(least(coalesce(p_rollout_pct,100),100),0), nullif(p_cohort,''), now())
  on conflict (key) do update set enabled=excluded.enabled, rollout_pct=excluded.rollout_pct, cohort=excluded.cohort, updated_at=now();
  return json_build_object('ok', true);
end $$;
grant execute on function flag_set(text, text, boolean, int, text) to anon;

-- ---------- platform economics (configurable) ----------
create table if not exists platform_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into platform_config(key, value) values
  ('commission_pct',       '8'::jsonb),
  ('platform_fee_pct',     '5'::jsonb),
  ('delivery_base',        '22'::jsonb),
  ('delivery_per_km',      '8'::jsonb),
  ('small_order_threshold','149'::jsonb),
  ('commission_by_category', '{"food":10,"restaurant":12,"grocery":6,"pharmacy":6}'::jsonb)
on conflict (key) do nothing;
alter table platform_config enable row level security;

create or replace function config_get(p_key text)
returns jsonb language sql security definer set search_path = public stable as $$
  select value from platform_config where key = p_key;
$$;
grant execute on function config_get(text) to anon;

-- commission % for a category (override → default), config-driven
create or replace function commission_for(p_category text)
returns numeric language sql security definer set search_path = public stable as $$
  select coalesce(
    (select (value->>lower(coalesce(p_category,'')))::numeric from platform_config where key='commission_by_category'),
    (select value::numeric from platform_config where key='commission_pct'),
    8);
$$;
grant execute on function commission_for(text) to anon;

create or replace function config_set(p_token text, p_key text, p_value jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  if _admin_level(p_token) is distinct from 'l5' then return json_build_object('ok', false, 'reason', 'only_l5'); end if;
  insert into platform_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value=excluded.value, updated_at=now();
  return json_build_object('ok', true);
end $$;
grant execute on function config_set(text, text, jsonb) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare r json;
begin
  insert into admin_users(ident,level,name,active) values ('__cfg_l5__','l5','cfg',true) on conflict (ident) do update set level='l5',active=true;
  insert into auth_sessions(token,ident,device_key) values ('__cfg_tok__','__cfg_l5__','dev_cfg') on conflict (token) do nothing;
  delete from feature_flags where key='new_search';

  -- flags: 100% on, 0% off, unknown → false, deterministic percentage
  assert (flag_set('__cfg_tok__','new_search', true, 100, null)->>'ok')='true', 'FAIL: flag_set';
  assert flag_on('new_search','anydevice') = true, 'FAIL: 100% flag off';
  perform flag_set('__cfg_tok__','new_search', true, 0, null);
  assert flag_on('new_search','anydevice') = false, 'FAIL: 0% flag on';
  assert flag_on('__unknown_flag__','x') = false, 'FAIL: unknown flag not false';
  perform flag_set('__cfg_tok__','new_search', true, 50, null);
  assert flag_on('new_search','stableDevice') = flag_on('new_search','stableDevice'), 'FAIL: rollout not deterministic';
  -- non-admin cannot set a flag
  assert (flag_set('__nope__','x',true,100,null)->>'ok')='false', 'FAIL: non-admin set flag';

  -- economics: category override vs default
  assert commission_for('food') = 10, 'FAIL: food commission override, got '||commission_for('food');
  assert commission_for('electronics') = 8, 'FAIL: default commission, got '||commission_for('electronics');
  -- L5 can change config; others cannot
  assert (config_set('__nope__','commission_pct','9'::jsonb)->>'ok')='false', 'FAIL: non-L5 changed config';
  assert (config_set('__cfg_tok__','commission_pct','9'::jsonb)->>'ok')='true', 'FAIL: L5 config_set';
  assert commission_for('electronics') = 9, 'FAIL: config change not reflected, got '||commission_for('electronics');
  perform config_set('__cfg_tok__','commission_pct','8'::jsonb);   -- restore

  delete from feature_flags where key='new_search';
  delete from auth_sessions where token='__cfg_tok__'; delete from admin_users where ident='__cfg_l5__';
  raise notice 'PASS: flags (rollout deterministic, gated) + economics (category override, L5-config-driven)';
end $$;

select 'config platform (flags + economics) ready' as status;
