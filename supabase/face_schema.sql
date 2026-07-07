-- ============================================================
-- ORIGNALS FACE 2FA — ported from the founder's edurankai
-- face-2fa-portable module. Client (@vladmandic/face-api) produces
-- a 128-float descriptor; the DISTANCE CHECK IS SERVER-SIDE so a
-- malicious client can't fake a match. Threshold 0.55 (their tuned
-- value). Fully self-hosted: descriptors live in our own Postgres.
-- ============================================================

create table if not exists face_enrollments (
  ident text primary key,
  descriptor double precision[] not null,   -- 128 floats from faceRecognitionNet
  is_active boolean not null default true,
  enrolled_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table face_enrollments enable row level security;   -- RPC-only, no anon read

create table if not exists face_verifications (
  id bigint generated always as identity primary key,
  ident text, distance double precision, passed boolean, method text,
  created_at timestamptz not null default now()
);
alter table face_verifications enable row level security;

-- validity: exactly 128 finite floats, not a blank/black frame
create or replace function face_valid(d double precision[])
returns boolean language sql immutable as $$
  select coalesce(array_length(d,1),0) = 128
     and (select count(*) from unnest(d) v where abs(v) > 1e-6) > 8;
$$;

-- enrol: resolve identity from the session token, store the descriptor
create or replace function face_enroll(p_token text, p_descriptor double precision[])
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_id text;
begin
  select ident into v_id from auth_sessions where token = p_token;
  if v_id is null then return json_build_object('ok',false,'reason','no_session'); end if;
  if not face_valid(p_descriptor) then return json_build_object('ok',false,'reason','bad_descriptor'); end if;
  insert into face_enrollments(ident, descriptor, is_active, enrolled_at)
    values (v_id, p_descriptor, true, now())
    on conflict (ident) do update set descriptor=excluded.descriptor, is_active=true, enrolled_at=now();
  update app_users set face_enrolled=true where ident=v_id;
  insert into face_verifications(ident, distance, passed, method) values (v_id, 0, true, 'enroll');
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

-- verify: SERVER-side euclidean distance vs the stored descriptor
create or replace function face_verify(p_ident text, p_descriptor double precision[])
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_id text; stored double precision[]; dist double precision; ok boolean;
begin
  v_id := lower(trim(coalesce(p_ident,'')));
  if position('@' in v_id)=0 then v_id := right(regexp_replace(v_id,'[^0-9]','','g'),10); end if;
  if not face_valid(p_descriptor) then return json_build_object('ok',false,'reason','bad_descriptor'); end if;
  select descriptor into stored from face_enrollments where ident=v_id and is_active=true limit 1;
  if stored is null then return json_build_object('ok',false,'reason','not_enrolled'); end if;
  select sqrt(coalesce(sum((s.v - d.v)*(s.v - d.v)),0)) into dist
    from unnest(stored) with ordinality s(v,i)
    join unnest(p_descriptor) with ordinality d(v,i) on s.i = d.i;
  ok := dist < 0.55;   -- FACE_MATCH_THRESHOLD (edurankai)
  insert into face_verifications(ident, distance, passed, method) values (v_id, dist, ok, 'login');
  if ok then update face_enrollments set last_used_at=now() where ident=v_id; end if;
  return json_build_object('ok',ok,'distance',round(dist::numeric,4));
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

-- remove enrolment (admin reset / user self-remove)
create or replace function face_remove(p_token text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_id text;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false); end if;
  delete from face_enrollments where ident=v_id;
  update app_users set face_enrolled=false where ident=v_id;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $fn$;

grant execute on function face_enroll(text, double precision[]) to anon;
grant execute on function face_verify(text, double precision[]) to anon;
grant execute on function face_remove(text) to anon;
select 'face 2fa ready' as status;
