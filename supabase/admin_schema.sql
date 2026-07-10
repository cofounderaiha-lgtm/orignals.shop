-- ============================================================
-- ORIGNALS ADMIN RBAC — server-enforced roles for an org of any
-- size (lakhs of employees) across L1–L5. Access is decided in
-- Postgres from the signed-in session, never trusted from the
-- browser. Bootstrapped once with a setup code.
--   l5 Super Admin · l4 Operations · l3 Purity Inspector
--   l2 City Manager · l1 Support
-- ============================================================

alter table platform_flags add column if not exists admin_setup_code text;

create table if not exists admin_users (
  ident text primary key,               -- normalized email or 10-digit phone
  level text not null check (level in ('l1','l2','l3','l4','l5')),
  name text,
  active boolean not null default true,
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_level_idx on admin_users (level, created_at desc);
alter table admin_users enable row level security;   -- RPC-only, no anon access

create or replace function admin_rank(l text) returns int language sql immutable as $$
  select case l when 'l5' then 5 when 'l4' then 4 when 'l3' then 3 when 'l2' then 2 when 'l1' then 1 else 0 end;
$$;

-- helper: resolve the caller's admin level from their session token
create or replace function _admin_level(p_token text) returns text
language sql security definer set search_path=public as $$
  select a.level from auth_sessions s
  join admin_users a on a.ident = s.ident and a.active
  where s.token = p_token limit 1;
$$;

-- who am I (drives what the panel shows)
create or replace function admin_whoami(p_token text)
returns json language plpgsql security definer set search_path=public as $$
declare v_ident text; v_level text; v_name text; v_count int;
begin
  select ident into v_ident from auth_sessions where token=p_token;
  select count(*) into v_count from admin_users where active;
  if v_ident is null then return json_build_object('ok',true,'admin',false,'signed_in',false,'bootstrap',v_count=0); end if;
  select level, name into v_level, v_name from admin_users where ident=v_ident and active;
  return json_build_object('ok',true,'signed_in',true,'admin',v_level is not null,
    'level',v_level,'ident',v_ident,'name',v_name,'bootstrap',v_count=0);
exception when others then return json_build_object('ok',false); end $$;

-- one-time bootstrap: first person with the setup code becomes L5
create or replace function admin_claim(p_token text, p_code text, p_name text)
returns json language plpgsql security definer set search_path=public as $$
declare v_ident text; v_code text; v_count int;
begin
  select count(*) into v_count from admin_users;
  if v_count > 0 then return json_build_object('ok',false,'reason','already_setup'); end if;
  select ident into v_ident from auth_sessions where token=p_token;
  if v_ident is null then return json_build_object('ok',false,'reason','sign_in_first'); end if;
  select admin_setup_code into v_code from platform_flags where id=1;
  if v_code is null or p_code is null or p_code <> v_code then return json_build_object('ok',false,'reason','bad_code'); end if;
  insert into admin_users(ident, level, name, added_by) values (v_ident,'l5',left(coalesce(p_name,''),60),'bootstrap');
  return json_build_object('ok',true,'level','l5');
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- add / promote an employee (caller must outrank the level granted; L4+ only)
create or replace function admin_grant(p_token text, p_ident text, p_level text, p_name text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_id text;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null or admin_rank(v_lvl) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  if p_level not in ('l1','l2','l3','l4','l5') then return json_build_object('ok',false,'reason','bad_level'); end if;
  if admin_rank(p_level) >= admin_rank(v_lvl) and v_lvl <> 'l5' then return json_build_object('ok',false,'reason','cannot_grant_at_or_above'); end if;
  if p_level = 'l5' and v_lvl <> 'l5' then return json_build_object('ok',false,'reason','only_l5_makes_l5'); end if;
  v_id := lower(trim(coalesce(p_ident,'')));
  if position('@' in v_id)=0 then v_id := right(regexp_replace(v_id,'[^0-9]','','g'),10); end if;
  if length(v_id) < 5 then return json_build_object('ok',false,'reason','bad_ident'); end if;
  insert into admin_users(ident, level, name, added_by) values (v_id, p_level, left(coalesce(p_name,''),60), (select ident from auth_sessions where token=p_token))
    on conflict (ident) do update set level=excluded.level, name=coalesce(nullif(excluded.name,''),admin_users.name), active=true, updated_at=now();
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- revoke an employee (L5 only; never remove the last active L5)
create or replace function admin_revoke(p_token text, p_ident text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_id text; v_l5 int;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl <> 'l5' then return json_build_object('ok',false,'reason','forbidden'); end if;
  v_id := lower(trim(coalesce(p_ident,'')));
  if position('@' in v_id)=0 then v_id := right(regexp_replace(v_id,'[^0-9]','','g'),10); end if;
  if (select level from admin_users where ident=v_id) = 'l5' then
    select count(*) into v_l5 from admin_users where level='l5' and active;
    if v_l5 <= 1 then return json_build_object('ok',false,'reason','last_super_admin'); end if;
  end if;
  update admin_users set active=false, updated_at=now() where ident=v_id;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- list employees (L4+); searchable + paged for lakhs of rows
create or replace function admin_list(p_token text, p_q text, p_limit int, p_offset int)
returns setof admin_users language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return; end if;
  return query
    select * from admin_users
    where active and (coalesce(p_q,'')='' or ident ilike '%'||p_q||'%' or coalesce(name,'') ilike '%'||p_q||'%')
    order by admin_rank(level) desc, created_at desc
    limit least(coalesce(p_limit,50),200) offset coalesce(p_offset,0);
end $$;

-- counts by level (dashboard)
create or replace function admin_counts(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false); end if;
  return (select json_object_agg(level, n) from (select level, count(*) n from admin_users where active group by level) t);
exception when others then return json_build_object('ok',false); end $$;

grant execute on function admin_whoami(text) to anon;
grant execute on function admin_claim(text,text,text) to anon;
grant execute on function admin_grant(text,text,text,text) to anon;
grant execute on function admin_revoke(text,text) to anon;
grant execute on function admin_list(text,text,int,int) to anon;
grant execute on function admin_counts(text) to anon;

select 'admin rbac ready' as status;
