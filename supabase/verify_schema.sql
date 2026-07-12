-- ============================================================
-- REAL VERIFICATION PIPELINE — replaces the admin panel's local demo
-- queues. Partners, shops and sellers submit genuine verification
-- requests; L3+ staff review and decide; decisions persist and drive
-- what buyers see. No hardcoded arrays.
-- ============================================================
create table if not exists verify_queue (
  id          bigint generated always as identity primary key,
  kind        text not null,                 -- kyc | purity | shop | service
  subject     text not null,                 -- who/what is being verified
  device      text,
  ident       text,
  details     jsonb default '{}'::jsonb,
  status      text default 'pending',        -- pending | verified | rejected
  reviewed_by text,
  created_at  timestamptz default now(),
  decided_at  timestamptz
);
create index if not exists vq_status_idx on verify_queue(status, kind, created_at);
alter table verify_queue enable row level security;

-- submit (open to anon — partners/shops self-submit; de-duped per subject+kind while pending)
create or replace function verify_submit(p_kind text, p_subject text, p_device text, p_ident text, p_details jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare v_id bigint;
begin
  if p_kind not in ('kyc','purity','shop','service') or coalesce(p_subject,'')='' then return json_build_object('ok',false,'reason','bad'); end if;
  if exists(select 1 from verify_queue where kind=p_kind and lower(subject)=lower(p_subject) and status='pending') then
    return json_build_object('ok',true,'dedup',true); end if;
  insert into verify_queue(kind,subject,device,ident,details)
  values (p_kind, left(p_subject,120), left(coalesce(p_device,''),64), nullif(p_ident,''), coalesce(p_details,'{}'::jsonb))
  returning id into v_id;
  return json_build_object('ok',true,'id',v_id);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- pending list (L3+ inspectors and up), optional kind filter
create or replace function verify_pending(p_token text, p_kind text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 3 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,'rows',(select coalesce(json_agg(row_to_json(t) order by t.created_at),'[]'::json) from (
    select id,kind,subject,details,created_at from verify_queue
    where status='pending' and (coalesce(p_kind,'')='' or kind=p_kind) limit 200) t));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- counts by kind for the overview (L3+)
create or replace function verify_counts(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 3 then return json_build_object('ok',false); end if;
  return (select coalesce(json_object_agg(kind, n),'{}'::json) from (select kind, count(*) n from verify_queue where status='pending' group by kind) t);
exception when others then return json_build_object('ok',false); end $$;

-- decide (L3+); persists + timestamps
create or replace function verify_decide(p_token text, p_id bigint, p_decision text)
returns json language plpgsql security definer set search_path=public as $$
declare v_row verify_queue;
begin
  if admin_rank(_admin_level(p_token)) < 3 then return json_build_object('ok',false,'reason','forbidden'); end if;
  if p_decision not in ('verified','rejected') then return json_build_object('ok',false,'reason','bad'); end if;
  update verify_queue set status=p_decision, reviewed_by=(select ident from auth_sessions where token=p_token), decided_at=now()
    where id=p_id and status='pending' returning * into v_row;
  if v_row.id is null then return json_build_object('ok',false,'reason','not_found'); end if;
  -- propagate the decision to the real record where applicable (best-effort; never fails the decision)
  begin
    if v_row.kind='kyc' and v_row.device is not null then
      update partners set status = case when p_decision='verified' then 'verified' else 'rejected' end where device_key=v_row.device;
    end if;
  exception when others then null;
  end;
  return json_build_object('ok',true,'kind',v_row.kind,'subject',v_row.subject);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function verify_submit(text,text,text,text,jsonb) to anon;
grant execute on function verify_pending(text,text) to anon;
grant execute on function verify_counts(text) to anon;
grant execute on function verify_decide(text,bigint,text) to anon;

select 'verify pipeline ready' as status;
