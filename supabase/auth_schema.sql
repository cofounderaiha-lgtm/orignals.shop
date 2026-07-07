-- ============================================================
-- ORIGNALS SELF-HOSTED AUTH — our own engine, zero third party.
-- Email/phone + password (works today, no delivery hop) AND a full
-- OTP engine (ready for when Orignals' own SMS gateway is plugged
-- into otp_deliver). pgcrypto is schema-qualified (Supabase quirk).
-- Fails open: if this backend is down, the app runs in local mode.
-- ============================================================
create extension if not exists pgcrypto with schema extensions;

alter table platform_flags add column if not exists otp_dev_echo boolean not null default true;
alter table platform_flags add column if not exists require_auth boolean not null default false;

drop table if exists otp_challenges cascade;
drop table if exists auth_sessions cascade;

create table auth_sessions (
  token text primary key default encode(extensions.gen_random_bytes(24),'hex'),
  phone text, ident text, device_key text,
  created_at timestamptz not null default now(), last_seen timestamptz not null default now()
);
alter table auth_sessions enable row level security;

create table otp_challenges (
  id text primary key default encode(extensions.gen_random_bytes(12),'hex'),
  phone text not null, code_hash text not null, salt text not null, device_key text,
  attempts int not null default 0, verified boolean not null default false,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '5 minutes'
);
create index otp_phone_idx on otp_challenges (phone, created_at desc);
alter table otp_challenges enable row level security;

create table if not exists app_users (
  ident text primary key,
  pass_hash text not null,
  name text, kind text default 'buyer',
  face_enrolled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table app_users enable row level security;

create or replace function otp_deliver(p_phone text, p_code text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
begin return; end $fn$;   -- plug Orignals' own SMS gateway here later

create or replace function otp_request(p_phone text, p_device text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_recent int; v_code text; v_salt text; v_id text; v_echo boolean;
begin
  p_phone := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if length(p_phone) < 10 then return json_build_object('ok',false,'reason','bad_phone'); end if;
  p_phone := right(p_phone,10);
  select count(*) into v_recent from otp_challenges where phone=p_phone and created_at>now()-interval '10 minutes';
  if v_recent>=3 then return json_build_object('ok',false,'reason','too_many','retry_in',600); end if;
  v_code := lpad((floor(random()*1000000))::int::text,6,'0');
  v_salt := encode(extensions.gen_random_bytes(8),'hex');
  insert into otp_challenges(phone,code_hash,salt,device_key)
    values (p_phone, encode(extensions.digest(v_salt||v_code,'sha256'),'hex'), v_salt, p_device) returning id into v_id;
  perform otp_deliver(p_phone,v_code);
  select otp_dev_echo into v_echo from platform_flags where id=1;
  return json_build_object('ok',true,'challenge',v_id,'expires_in',300,
    'dev_code', case when coalesce(v_echo,false) then v_code else null end);
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

create or replace function otp_verify(p_challenge text, p_code text, p_device text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare r otp_challenges; v_token text;
begin
  select * into r from otp_challenges where id=p_challenge;
  if not found then return json_build_object('ok',false,'reason','not_found'); end if;
  if r.verified then return json_build_object('ok',false,'reason','used'); end if;
  if now()>r.expires_at then return json_build_object('ok',false,'reason','expired'); end if;
  if r.attempts>=5 then return json_build_object('ok',false,'reason','locked'); end if;
  update otp_challenges set attempts=attempts+1 where id=p_challenge;
  if encode(extensions.digest(r.salt||coalesce(p_code,''),'sha256'),'hex') <> r.code_hash then
    return json_build_object('ok',false,'reason','wrong','left',4-r.attempts); end if;
  update otp_challenges set verified=true where id=p_challenge;
  insert into auth_sessions(phone,ident,device_key) values (r.phone,r.phone,p_device) returning token into v_token;
  if random()<0.1 then delete from otp_challenges where created_at<now()-interval '1 day'; end if;
  return json_build_object('ok',true,'token',v_token,'phone',r.phone);
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

create or replace function auth_register(p_ident text, p_pass text, p_name text, p_device text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_id text; v_token text;
begin
  v_id := lower(trim(coalesce(p_ident,'')));
  if position('@' in v_id)=0 then v_id := right(regexp_replace(v_id,'[^0-9]','','g'),10); end if;
  if length(v_id)<5 then return json_build_object('ok',false,'reason','bad_ident'); end if;
  if length(coalesce(p_pass,''))<6 then return json_build_object('ok',false,'reason','weak_pass'); end if;
  if exists(select 1 from app_users where ident=v_id) then return json_build_object('ok',false,'reason','exists'); end if;
  insert into app_users(ident,pass_hash,name) values (v_id, extensions.crypt(p_pass, extensions.gen_salt('bf')), left(coalesce(p_name,''),60));
  insert into auth_sessions(ident,device_key) values (v_id,p_device) returning token into v_token;
  return json_build_object('ok',true,'token',v_token,'ident',v_id);
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

create or replace function auth_login(p_ident text, p_pass text, p_device text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare r app_users; v_token text; v_id text;
begin
  v_id := lower(trim(coalesce(p_ident,'')));
  if position('@' in v_id)=0 then v_id := right(regexp_replace(v_id,'[^0-9]','','g'),10); end if;
  select * into r from app_users where ident=v_id;
  if not found then return json_build_object('ok',false,'reason','no_user'); end if;
  if r.pass_hash <> extensions.crypt(p_pass, r.pass_hash) then return json_build_object('ok',false,'reason','wrong_pass'); end if;
  insert into auth_sessions(ident,device_key) values (v_id,p_device) returning token into v_token;
  return json_build_object('ok',true,'token',v_token,'ident',v_id,'name',r.name,'face',r.face_enrolled);
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

create or replace function auth_set_face(p_token text, p_enrolled boolean)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_id text;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false); end if;
  update app_users set face_enrolled=p_enrolled where ident=v_id;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $fn$;

create or replace function auth_whoami(p_token text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare r auth_sessions;
begin
  update auth_sessions set last_seen=now() where token=p_token returning * into r;
  if r.token is null then return json_build_object('ok',false); end if;
  return json_build_object('ok',true,'ident',coalesce(r.ident,r.phone),'phone',r.phone);
exception when others then return json_build_object('ok',false); end $fn$;

grant execute on function otp_request(text,text) to anon;
grant execute on function otp_verify(text,text,text) to anon;
grant execute on function auth_register(text,text,text,text) to anon;
grant execute on function auth_login(text,text,text) to anon;
grant execute on function auth_set_face(text,boolean) to anon;
grant execute on function auth_whoami(text) to anon;
select 'auth v2 ready' as status;
