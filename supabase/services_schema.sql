-- ============================================================
-- SERVICES MARKETPLACE — any professional (individual / team /
-- organisation) across primary, secondary & tertiary sectors can
-- offer a service, but must PROVE expertise before being onboarded.
-- Buyers only ever see VERIFIED providers. Contact stays in-app.
-- ============================================================

create table if not exists service_providers (
  id          bigint generated always as identity primary key,
  ident       text,
  device      text,
  name        text not null,
  kind        text default 'individual',   -- individual | team | organisation
  sector      text,                         -- primary | secondary | tertiary
  category    text,
  headline    text,
  about       text,
  credentials text,                         -- claimed expertise / proof description
  area        text,
  rate        numeric default 0,
  rate_unit   text default 'hour',
  status      text default 'pending',       -- pending | verified | rejected
  reviewed_by text,
  rating      numeric default 0,
  jobs        int default 0,
  created_at  timestamptz default now()
);
create index if not exists svc_status_idx on service_providers(status, sector, category);

create table if not exists service_enquiries (
  id          bigint generated always as identity primary key,
  provider_id bigint,
  from_device text,
  need        text,
  when_text   text,
  status      text default 'open',
  created_at  timestamptz default now()
);
alter table service_providers enable row level security;
alter table service_enquiries enable row level security;

-- a few verified sample providers so the marketplace has content on day one
insert into service_providers(name,kind,sector,category,headline,about,credentials,area,rate,rate_unit,status,rating,jobs)
select * from (values
  ('Anita Sharma','individual','tertiary','Tuition','Maths & Science tutor (Class 6–12)','8 years teaching CBSE/ICSE, board-topper results.','B.Sc + B.Ed, 8 yrs experience','City-wide',400,'hour','verified',4.9,320),
  ('FixIt Plumbing Co.','team','secondary','Plumbing','Licensed plumbers, same-day','Leaks, fittings, bathroom renovation. 4-person team.','Trade licence + insured','Sector 1–20',350,'visit','verified',4.7,210),
  ('BrightSpark Electricals','team','secondary','Electrical','Certified electricians, wiring & repair','Home & shop wiring, inverter, safety audit.','Govt electrical licence','City-wide',400,'visit','verified',4.8,180),
  ('GreenThumb Farm Advisory','individual','primary','Agriculture','Soil & crop consultant','Soil testing, organic inputs, yield planning.','M.Sc Agriculture, KVK-certified','Rural belt',600,'visit','verified',4.6,95),
  ('LedgerRight Accounts','organisation','tertiary','Accounting & Tax','GST, ITR & bookkeeping for small business','Monthly books, GST filing, TDS.','CA-supervised firm','City-wide',1500,'month','verified',4.8,140),
  ('Nimbus Design Studio','team','tertiary','Design','Logo, packaging & web design','Brand identity for shops & startups.','Portfolio-verified, 6 designers','Remote / City',5000,'project','verified',4.9,88),
  ('CareWell Physio','individual','tertiary','Healthcare','Home physiotherapy','Post-surgery, sports & elder care at home.','BPT registered physiotherapist','City-wide',700,'visit','verified',4.9,260),
  ('BuildRight Masonry','team','secondary','Construction','Masons & tiling crew','Brickwork, plaster, tiling, small builds.','Contractor licence','Sector 5–30',900,'day','verified',4.5,120)
) v
where not exists (select 1 from service_providers where status='verified');

-- ---------- WRITE (anon-safe) ----------
create or replace function service_register(
  p_device text, p_ident text, p_name text, p_kind text, p_sector text, p_category text,
  p_headline text, p_about text, p_credentials text, p_area text, p_rate numeric, p_rate_unit text)
returns json language plpgsql security definer set search_path=public as $$
declare v_id bigint;
begin
  if coalesce(p_name,'')='' or coalesce(p_category,'')='' then return json_build_object('ok',false,'reason','need_name_category'); end if;
  insert into service_providers(device,ident,name,kind,sector,category,headline,about,credentials,area,rate,rate_unit,status)
  values (left(coalesce(p_device,''),64), nullif(p_ident,''), left(p_name,80), coalesce(nullif(p_kind,''),'individual'),
          coalesce(nullif(p_sector,''),'tertiary'), left(p_category,60), left(coalesce(p_headline,''),120),
          left(coalesce(p_about,''),600), left(coalesce(p_credentials,''),400), left(coalesce(p_area,''),80),
          coalesce(p_rate,0), coalesce(nullif(p_rate_unit,''),'hour'), 'pending')
  returning id into v_id;
  return json_build_object('ok',true,'id',v_id,'status','pending');
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function service_list(p_sector text, p_category text, p_q text)
returns json language plpgsql security definer set search_path=public as $$
begin
  return (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select id,name,kind,sector,category,headline,about,area,rate,rate_unit,rating,jobs
    from service_providers
    where status='verified'
      and (coalesce(p_sector,'')='' or sector=p_sector)
      and (coalesce(p_category,'')='' or category=p_category)
      and (coalesce(p_q,'')='' or name ilike '%'||p_q||'%' or category ilike '%'||p_q||'%' or coalesce(headline,'') ilike '%'||p_q||'%')
    order by rating desc, jobs desc limit 60) t);
end $$;

create or replace function service_mine(p_device text)
returns json language plpgsql security definer set search_path=public as $$
begin
  return (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select id,name,category,sector,status,rating,jobs from service_providers where device=p_device order by created_at desc) t);
end $$;

create or replace function service_enquire(p_provider bigint, p_device text, p_need text, p_when text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from service_providers where id=p_provider and status='verified') then return json_build_object('ok',false,'reason','not_found'); end if;
  insert into service_enquiries(provider_id,from_device,need,when_text) values (p_provider, left(coalesce(p_device,''),64), left(coalesce(p_need,''),300), left(coalesce(p_when,''),80));
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- ADMIN verification (L3+ inspectors and up) ----------
create or replace function service_admin_pending(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 3 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,'rows',(select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select id,name,kind,sector,category,headline,credentials,area,rate,rate_unit,status,created_at
    from service_providers where status='pending' order by created_at limit 100) t));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function service_verify(p_token text, p_id bigint, p_decision text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 3 then return json_build_object('ok',false,'reason','forbidden'); end if;
  if p_decision not in ('verified','rejected') then return json_build_object('ok',false,'reason','bad'); end if;
  update service_providers set status=p_decision, reviewed_by=(select ident from auth_sessions where token=p_token) where id=p_id and status='pending';
  return json_build_object('ok', found);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function service_register(text,text,text,text,text,text,text,text,text,text,numeric,text) to anon;
grant execute on function service_list(text,text,text) to anon;
grant execute on function service_mine(text) to anon;
grant execute on function service_enquire(bigint,text,text,text) to anon;
grant execute on function service_admin_pending(text) to anon;
grant execute on function service_verify(text,bigint,text) to anon;

select 'services marketplace ready' as status, (select count(*) from service_providers where status='verified') verified_providers;
