-- ============================================================
-- ORIGNALS HRMS — departments, staff records, attendance, leave,
-- payroll. Built on the existing admin_users RBAC (L1–L5).
-- Every read/write is admin-gated and DEPARTMENT-SCOPED:
--   L5/L4 see the whole org; L1–L3 see only their own department.
-- ============================================================

-- extend the staff record with HR fields
alter table admin_users add column if not exists department  text;
alter table admin_users add column if not exists designation text;
alter table admin_users add column if not exists status      text default 'active';   -- active | on_leave | suspended | exited
alter table admin_users add column if not exists joined_on   date default current_date;
alter table admin_users add column if not exists salary      numeric default 0;
alter table admin_users add column if not exists phone       text;

create table if not exists hr_departments (
  name       text primary key,
  head_ident text,
  created_at timestamptz default now()
);
insert into hr_departments(name) values
  ('Operations'),('Purity & Quality'),('Support'),('City Onboarding'),('Finance'),('Human Resources'),('Technology')
  on conflict do nothing;

create table if not exists hr_leave (
  id         bigint generated always as identity primary key,
  ident      text not null,
  kind       text default 'casual',
  from_date  date not null,
  to_date    date not null,
  reason     text,
  status     text default 'pending',   -- pending | approved | rejected
  decided_by text,
  created_at timestamptz default now()
);
create index if not exists hr_leave_idx on hr_leave(status, created_at desc);

create table if not exists hr_attendance (
  ident     text not null,
  day       date not null default current_date,
  check_in  timestamptz,
  check_out timestamptz,
  primary key (ident, day)
);

create table if not exists hr_payroll (
  id       bigint generated always as identity primary key,
  ident    text not null,
  month    text not null,               -- 'YYYY-MM'
  amount   numeric not null default 0,
  status   text default 'due',          -- due | paid
  paid_at  timestamptz,
  unique (ident, month)
);
alter table hr_departments enable row level security;
alter table hr_leave       enable row level security;
alter table hr_attendance  enable row level security;
alter table hr_payroll     enable row level security;

-- caller's department
create or replace function _admin_dept(p_token text) returns text
language sql security definer set search_path=public as $$
  select a.department from auth_sessions s join admin_users a on a.ident=s.ident and a.active where s.token=p_token limit 1;
$$;
-- caller's ident (staff)
create or replace function _staff_ident(p_token text) returns text
language sql security definer set search_path=public as $$
  select a.ident from auth_sessions s join admin_users a on a.ident=s.ident and a.active where s.token=p_token limit 1;
$$;

-- dashboard summary (scoped)
create or replace function hr_overview(p_token text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean; v_month text := to_char(now(),'YYYY-MM');
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null then return json_build_object('ok',false,'reason','forbidden'); end if;
  v_dept := _admin_dept(p_token); v_all := admin_rank(v_lvl) >= 4;
  return json_build_object('ok',true,'scope', case when v_all then 'org' else coalesce(v_dept,'—') end,
    'headcount', (select count(*) from admin_users where active and (v_all or department is not distinct from v_dept)),
    'present_today', (select count(*) from hr_attendance a join admin_users u on u.ident=a.ident and u.active
                      where a.day=current_date and a.check_in is not null and (v_all or u.department is not distinct from v_dept)),
    'on_leave', (select count(*) from admin_users where active and status='on_leave' and (v_all or department is not distinct from v_dept)),
    'pending_leave', (select count(*) from hr_leave l join admin_users u on u.ident=l.ident and u.active
                      where l.status='pending' and (v_all or u.department is not distinct from v_dept)),
    'payroll_month', (select coalesce(sum(salary),0) from admin_users where active and (v_all or department is not distinct from v_dept)),
    'month', v_month,
    'by_dept', (select coalesce(json_agg(json_build_object('dept',coalesce(department,'Unassigned'),'n',n) order by n desc),'[]'::json)
                from (select department, count(*) n from admin_users where active and (v_all or department is not distinct from v_dept) group by department) t));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- departments with headcount
create or replace function hr_departments_list(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if _admin_level(p_token) is null then return json_build_object('ok',false); end if;
  return (select coalesce(json_agg(json_build_object('name',d.name,'head',d.head_ident,
      'headcount',(select count(*) from admin_users u where u.active and u.department=d.name)) order by d.name),'[]'::json)
    from hr_departments d);
end $$;

-- roster (scoped, searchable, paged)
create or replace function hr_employees(p_token text, p_q text, p_dept text, p_limit int, p_offset int)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null then return json_build_object('ok',false); end if;
  v_dept := _admin_dept(p_token); v_all := admin_rank(v_lvl) >= 4;
  return (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select ident, name, level, coalesce(department,'Unassigned') department, designation, status, joined_on, salary, phone
    from admin_users
    where active
      and (v_all or department is not distinct from v_dept)
      and (coalesce(p_dept,'')='' or department=p_dept)
      and (coalesce(p_q,'')='' or ident ilike '%'||p_q||'%' or coalesce(name,'') ilike '%'||p_q||'%' or coalesce(designation,'') ilike '%'||p_q||'%')
    order by admin_rank(level) desc, name
    limit least(coalesce(p_limit,100),300) offset coalesce(p_offset,0)) t);
end $$;

-- edit an employee's HR fields (L4+)
create or replace function hr_employee_set(p_token text, p_ident text, p_department text, p_designation text, p_salary numeric, p_status text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  update admin_users set
    department  = coalesce(nullif(p_department,''), department),
    designation = coalesce(nullif(p_designation,''), designation),
    salary      = coalesce(p_salary, salary),
    status      = coalesce(nullif(p_status,''), status),
    updated_at  = now()
  where ident = lower(trim(coalesce(p_ident,''))) and active;
  return json_build_object('ok', found);
end $$;

-- ---------- LEAVE ----------
create or replace function hr_leave_apply(p_token text, p_kind text, p_from date, p_to date, p_reason text)
returns json language plpgsql security definer set search_path=public as $$
declare v_id text;
begin
  v_id := _staff_ident(p_token);
  if v_id is null then return json_build_object('ok',false,'reason','forbidden'); end if;
  if p_from is null or p_to is null or p_to < p_from then return json_build_object('ok',false,'reason','bad_dates'); end if;
  insert into hr_leave(ident,kind,from_date,to_date,reason) values (v_id, coalesce(nullif(p_kind,''),'casual'), p_from, p_to, left(coalesce(p_reason,''),200));
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function hr_leave_list(p_token text, p_all boolean)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null then return json_build_object('ok',false); end if;
  v_dept := _admin_dept(p_token); v_all := admin_rank(v_lvl) >= 4;
  return (select coalesce(json_agg(row_to_json(t) order by t.created_at desc),'[]'::json) from (
    select l.id, l.ident, u.name, coalesce(u.department,'Unassigned') department, l.kind, l.from_date, l.to_date, l.reason, l.status, l.created_at
    from hr_leave l join admin_users u on u.ident=l.ident
    where (v_all or u.department is not distinct from v_dept)
      and (coalesce(p_all,false) or l.status='pending')) t);
end $$;

-- approve/reject (L3+ can decide within their scope)
create or replace function hr_leave_decide(p_token text, p_id bigint, p_decision text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean; v_emp_dept text; v_ident text; v_who text;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null or admin_rank(v_lvl) < 3 then return json_build_object('ok',false,'reason','forbidden'); end if;
  if p_decision not in ('approved','rejected') then return json_build_object('ok',false,'reason','bad'); end if;
  v_all := admin_rank(v_lvl) >= 4; v_dept := _admin_dept(p_token); v_who := _staff_ident(p_token);
  select l.ident, u.department into v_ident, v_emp_dept from hr_leave l join admin_users u on u.ident=l.ident where l.id=p_id;
  if v_ident is null then return json_build_object('ok',false,'reason','not_found'); end if;
  if not v_all and v_emp_dept is distinct from v_dept then return json_build_object('ok',false,'reason','out_of_scope'); end if;
  update hr_leave set status=p_decision, decided_by=v_who where id=p_id;
  update admin_users set status = case when p_decision='approved' then 'on_leave' else 'active' end where ident=v_ident and active;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- ATTENDANCE ----------
create or replace function hr_attendance_mark(p_token text, p_action text)
returns json language plpgsql security definer set search_path=public as $$
declare v_id text;
begin
  v_id := _staff_ident(p_token);
  if v_id is null then return json_build_object('ok',false,'reason','forbidden'); end if;
  insert into hr_attendance(ident,day,check_in) values (v_id,current_date, case when p_action='in' then now() else null end)
    on conflict (ident,day) do update set
      check_in  = coalesce(hr_attendance.check_in, case when p_action='in' then now() else hr_attendance.check_in end),
      check_out = case when p_action='out' then now() else hr_attendance.check_out end;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function hr_attendance_today(p_token text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null then return json_build_object('ok',false); end if;
  v_dept := _admin_dept(p_token); v_all := admin_rank(v_lvl) >= 4;
  return (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select u.ident, u.name, coalesce(u.department,'Unassigned') department, a.check_in, a.check_out
    from hr_attendance a join admin_users u on u.ident=a.ident and u.active
    where a.day=current_date and (v_all or u.department is not distinct from v_dept)
    order by a.check_in desc nulls last) t);
end $$;

-- ---------- PAYROLL ----------
create or replace function hr_payroll_run(p_token text, p_month text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_n int;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl <> 'l5' then return json_build_object('ok',false,'reason','only_l5'); end if;
  insert into hr_payroll(ident,month,amount)
    select ident, coalesce(nullif(p_month,''),to_char(now(),'YYYY-MM')), coalesce(salary,0) from admin_users where active
    on conflict (ident,month) do update set amount=excluded.amount;
  get diagnostics v_n = row_count;
  return json_build_object('ok',true,'rows',v_n);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function hr_payroll_list(p_token text, p_month text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean; v_m text;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null then return json_build_object('ok',false); end if;
  v_dept := _admin_dept(p_token); v_all := admin_rank(v_lvl) >= 4; v_m := coalesce(nullif(p_month,''),to_char(now(),'YYYY-MM'));
  return json_build_object('ok',true,'month',v_m,
    'total',(select coalesce(sum(p.amount),0) from hr_payroll p join admin_users u on u.ident=p.ident where p.month=v_m and (v_all or u.department is not distinct from v_dept)),
    'paid',(select coalesce(sum(p.amount),0) from hr_payroll p join admin_users u on u.ident=p.ident where p.month=v_m and p.status='paid' and (v_all or u.department is not distinct from v_dept)),
    'rows',(select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
       select p.id, p.ident, u.name, coalesce(u.department,'Unassigned') department, p.amount, p.status
       from hr_payroll p join admin_users u on u.ident=p.ident
       where p.month=v_m and (v_all or u.department is not distinct from v_dept)
       order by p.status, u.name) t));
end $$;

create or replace function hr_payroll_pay(p_token text, p_id bigint)
returns json language plpgsql security definer set search_path=public as $$
begin
  if _admin_level(p_token) <> 'l5' then return json_build_object('ok',false,'reason','only_l5'); end if;
  update hr_payroll set status='paid', paid_at=now() where id=p_id;
  return json_build_object('ok', found);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

select 'hrms installed' as status, (select count(*) from hr_departments) departments;
