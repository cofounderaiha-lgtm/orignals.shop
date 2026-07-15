-- ============================================================
-- WEEK1 TASK 0 — the bootstrap secret must not live on a
-- world-readable table.
--
-- The chain (verified 2026-07-12):
--   ops_schema.sql:21     → platform_flags gets `select using (true)` for public
--   admin_schema.sql:10   → `alter table platform_flags add column admin_setup_code`
--   RLS SELECT policies are ROW-level, not COLUMN-level
--   ⇒ the public anon key in config.js can read admin_setup_code.
--   admin_claim() then grants L5 to the first caller.
--
-- The race is currently CLOSED (admin_users has 1 active row, and
-- admin_claim() refuses when count(*) > 0). This removes the latent
-- re-open: if admin_users were ever emptied, the code was still readable.
--
-- platform_flags keeps its public read policy — maintenance /
-- payments_enabled / banner are kill switches and SHOULD be public.
-- ============================================================

create table if not exists admin_bootstrap (
  id         int primary key default 1,
  setup_code text,
  constraint one_row check (id = 1)
);
alter table admin_bootstrap enable row level security;
-- deliberately ZERO policies: anon/authenticated cannot see this table at all.
-- admin_claim() is security definer and bypasses RLS.

insert into admin_bootstrap (id, setup_code)
  select 1, admin_setup_code from platform_flags where id = 1
  on conflict (id) do nothing;

alter table platform_flags drop column if exists admin_setup_code;

-- admin_claim now reads the secret from the locked table
create or replace function admin_claim(p_token text, p_code text, p_name text)
returns json language plpgsql security definer set search_path=public as $$
declare v_ident text; v_code text; v_count int;
begin
  select count(*) into v_count from admin_users;
  if v_count > 0 then return json_build_object('ok',false,'reason','already_setup'); end if;
  select ident into v_ident from auth_sessions where token=p_token;
  if v_ident is null then return json_build_object('ok',false,'reason','sign_in_first'); end if;
  select setup_code into v_code from admin_bootstrap where id=1;
  if v_code is null or p_code is null or p_code <> v_code then return json_build_object('ok',false,'reason','bad_code'); end if;
  insert into admin_users(ident, level, name, added_by) values (v_ident,'l5',left(coalesce(p_name,''),60),'bootstrap');
  return json_build_object('ok',true,'level','l5');
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function admin_claim(text,text,text) to anon;

-- ---- proof ----
select 'setup_code column on platform_flags' as check,
       case when exists(select 1 from information_schema.columns
                        where table_schema='public' and table_name='platform_flags'
                          and column_name='admin_setup_code')
            then 'STILL PRESENT — FAIL' else 'REMOVED — PASS' end as result
union all
select 'admin_bootstrap policies (must be 0)',
       (select count(*)::text from pg_policies where schemaname='public' and tablename='admin_bootstrap')
union all
select 'secret preserved in locked table',
       case when (select setup_code from admin_bootstrap where id=1) is null then 'LOST — FAIL' else 'PRESERVED — PASS' end;
