-- ============================================================
-- MULTI-FACTOR AUTH — authenticator app (TOTP, RFC 6238) + backup codes.
-- Adds to the existing factors: password, SMS OTP, face lock.
-- All verification is SERVER-SIDE (pgcrypto HMAC-SHA1) so codes can't be faked.
-- pgcrypto is schema-qualified (Supabase quirk).
-- ============================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists user_2fa (
  ident         text primary key,
  totp_secret   text,                 -- base32, active
  totp_pending  text,                 -- base32, mid-setup (not yet confirmed)
  totp_enabled  boolean default false,
  backup_codes  text[] default '{}',  -- sha256 hashes of one-time recovery codes
  updated_at    timestamptz default now()
);
alter table user_2fa enable row level security;

-- ---------- base32 (RFC 4648, no padding) ----------
create or replace function _b32_encode(p bytea) returns text
language plpgsql immutable set search_path=public,extensions as $$
declare alph text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  bits int := 0; val int := 0; i int; out text := '';
begin
  for i in 0..length(p)-1 loop
    val := (val << 8) | get_byte(p, i); bits := bits + 8;
    while bits >= 5 loop
      out := out || substr(alph, ((val >> (bits-5)) & 31) + 1, 1);
      bits := bits - 5; val := val & ((1 << bits) - 1);
    end loop;
  end loop;
  if bits > 0 then out := out || substr(alph, ((val << (5-bits)) & 31) + 1, 1); end if;
  return out;
end $$;

create or replace function _b32_decode(p text) returns bytea
language plpgsql immutable set search_path=public,extensions as $$
declare alph text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  bits int := 0; val int := 0; i int; idx int; out bytea := '\x';
begin
  p := upper(regexp_replace(coalesce(p,''), '[^A-Za-z2-7]', '', 'g'));
  for i in 1..length(p) loop
    idx := position(substr(p, i, 1) in alph) - 1;
    if idx < 0 then continue; end if;
    val := (val << 5) | idx; bits := bits + 5;
    if bits >= 8 then
      out := out || set_byte('\x00'::bytea, 0, (val >> (bits-8)) & 255);
      bits := bits - 8; val := val & ((1 << bits) - 1);
    end if;
  end loop;
  return out;
end $$;

-- ---------- TOTP ----------
create or replace function _totp_at(p_secret text, p_ctr bigint) returns text
language plpgsql set search_path=public,extensions as $$
declare key bytea; msg bytea; hs bytea; off int; bin bigint; i int;
begin
  key := _b32_decode(p_secret);
  msg := '\x0000000000000000'::bytea;
  for i in 0..7 loop msg := set_byte(msg, 7-i, ((p_ctr >> (i*8)) & 255)::int); end loop;
  hs  := extensions.hmac(msg, key, 'sha1');
  off := get_byte(hs, 19) & 15;
  bin := ((get_byte(hs, off)   & 127)::bigint << 24)
       | ((get_byte(hs, off+1) & 255)::bigint << 16)
       | ((get_byte(hs, off+2) & 255)::bigint << 8)
       |  (get_byte(hs, off+3) & 255)::bigint;
  return lpad((bin % 1000000)::text, 6, '0');
end $$;

create or replace function _totp_verify(p_secret text, p_code text) returns boolean
language plpgsql set search_path=public,extensions as $$
declare ctr bigint := floor(extract(epoch from now())/30);
begin
  if p_secret is null or p_code is null then return false; end if;
  p_code := lpad(regexp_replace(p_code, '\D', '', 'g'), 6, '0');
  -- accept ±1 step for clock drift
  return p_code in (_totp_at(p_secret, ctr), _totp_at(p_secret, ctr-1), _totp_at(p_secret, ctr+1));
end $$;

-- ---------- RPCs (token resolves to ident via auth_sessions) ----------
create or replace function twofa_status(p_token text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare v_id text; r user_2fa; v_face boolean;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false,'signed_in',false); end if;
  select * into r from user_2fa where ident=v_id;
  select face_enrolled into v_face from app_users where ident=v_id;
  return json_build_object('ok',true,'signed_in',true,
    'password', true,
    'sms', true,
    'face', coalesce(v_face,false),
    'totp', coalesce(r.totp_enabled,false),
    'backup_left', coalesce(array_length(r.backup_codes,1),0));
end $$;

create or replace function twofa_totp_setup(p_token text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare v_id text; v_secret text;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false,'reason','signed_out'); end if;
  v_secret := _b32_encode(extensions.gen_random_bytes(20));
  insert into user_2fa(ident, totp_pending) values (v_id, v_secret)
    on conflict (ident) do update set totp_pending=v_secret, updated_at=now();
  return json_build_object('ok',true,'secret',v_secret,
    'otpauth','otpauth://totp/Orignals:'||v_id||'?secret='||v_secret||'&issuer=Orignals&period=30&digits=6');
end $$;

create or replace function twofa_totp_enable(p_token text, p_code text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare v_id text; r user_2fa; v_codes text[] := '{}'; v_plain text[] := '{}'; c text; i int;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false,'reason','signed_out'); end if;
  select * into r from user_2fa where ident=v_id;
  if r.totp_pending is null then return json_build_object('ok',false,'reason','no_setup'); end if;
  if not _totp_verify(r.totp_pending, p_code) then return json_build_object('ok',false,'reason','bad_code'); end if;
  -- fresh one-time backup codes
  for i in 1..8 loop
    c := lpad((abs(('x'||substr(encode(extensions.gen_random_bytes(6),'hex'),1,8))::bit(32)::int) % 100000000)::text, 8, '0');
    v_plain := array_append(v_plain, substr(c,1,4)||'-'||substr(c,5,4));
    v_codes := array_append(v_codes, encode(extensions.digest(c,'sha256'),'hex'));
  end loop;
  update user_2fa set totp_secret=totp_pending, totp_pending=null, totp_enabled=true,
    backup_codes=v_codes, updated_at=now() where ident=v_id;
  return json_build_object('ok',true,'backup_codes',to_json(v_plain));
end $$;

create or replace function twofa_totp_disable(p_token text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare v_id text;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false,'reason','signed_out'); end if;
  update user_2fa set totp_secret=null, totp_pending=null, totp_enabled=false, backup_codes='{}', updated_at=now() where ident=v_id;
  return json_build_object('ok',true);
end $$;

-- login second factor: pass the ident + a TOTP code OR an unused backup code
create or replace function twofa_verify_login(p_ident text, p_code text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare r user_2fa; v_hash text; v_bare text;
begin
  select * into r from user_2fa where ident=p_ident;
  if r.ident is null or not r.totp_enabled then return json_build_object('ok',true,'not_required',true); end if;
  if _totp_verify(r.totp_secret, p_code) then return json_build_object('ok',true,'method','totp'); end if;
  -- try backup code (strip formatting, sha256, must be present + one-time)
  v_bare := regexp_replace(coalesce(p_code,''), '\D', '', 'g');
  v_hash := encode(extensions.digest(v_bare,'sha256'),'hex');
  if v_hash = any(r.backup_codes) then
    update user_2fa set backup_codes = array_remove(backup_codes, v_hash) where ident=p_ident;
    return json_build_object('ok',true,'method','backup');
  end if;
  return json_build_object('ok',false,'reason','bad_code');
end $$;

select 'twofa installed' as status, _totp_verify(_b32_encode(extensions.gen_random_bytes(20)),'000000') as smoke;
