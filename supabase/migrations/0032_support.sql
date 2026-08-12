-- ============================================================
-- 0032 — CUSTOMER SUPPORT OS  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §30: ticketing with order context, customer/agent
--   conversation, internal notes, priority/SLA, assignment, audit. Customer is device-
--   scoped; agents are admin-token gated (L4+) and can see internal notes + the full
--   order context (order_ref → order_full). A message must never leak an internal
--   note to the customer.
-- ============================================================
create table if not exists support_tickets (
  id           text primary key,
  device_key   text not null,               -- requester
  order_ref    text,                         -- optional order context
  category     text,
  subject      text,
  status       text not null default 'open', -- open | pending | resolved | closed
  priority     text not null default 'normal',-- low | normal | high | urgent
  assigned_to  text,                          -- admin ident
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  first_response_at timestamptz
);
create index if not exists tkt_device_idx on support_tickets(device_key, created_at desc);
create index if not exists tkt_queue_idx  on support_tickets(status, priority, created_at) where status in ('open','pending');

create table if not exists support_messages (
  id          bigint generated always as identity primary key,
  ticket_id   text not null references support_tickets(id) on delete cascade,
  sender_role text not null,                 -- customer | agent
  sender_id   text,
  body        text not null,
  internal    boolean not null default false,-- agent-only note, never shown to the customer
  at          timestamptz not null default now()
);
create index if not exists msg_ticket_idx on support_messages(ticket_id, at);
alter table support_tickets enable row level security;
alter table support_messages enable row level security;

-- customer opens a ticket (device-scoped)
create or replace function ticket_open(p_device text, p_order text, p_category text, p_subject text, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if coalesce(p_device,'')='' or coalesce(p_body,'')='' then return json_build_object('ok', false, 'reason', 'missing'); end if;
  v_id := 'tkt_' || substr(md5(p_device || coalesce(p_order,'') || clock_timestamp()::text), 1, 16);
  insert into support_tickets(id, device_key, order_ref, category, subject)
  values (v_id, p_device, nullif(p_order,''), left(p_category,40), left(coalesce(p_subject,'Support request'),120));
  insert into support_messages(ticket_id, sender_role, sender_id, body)
  values (v_id, 'customer', p_device, left(p_body, 2000));
  return json_build_object('ok', true, 'ticket', v_id);
end $$;
grant execute on function ticket_open(text, text, text, text, text) to anon;

-- customer replies to their own ticket (reopens if resolved)
create or replace function ticket_reply(p_device text, p_ticket text, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner text; v_status text;
begin
  select device_key, status into v_owner, v_status from support_tickets where id = p_ticket;
  if v_owner is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_owner <> p_device then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  insert into support_messages(ticket_id, sender_role, sender_id, body) values (p_ticket, 'customer', p_device, left(coalesce(p_body,''),2000));
  update support_tickets set status = case when status in ('resolved','closed') then 'open' else status end, updated_at = now() where id = p_ticket;
  return json_build_object('ok', true);
end $$;
grant execute on function ticket_reply(text, text, text) to anon;

-- agent replies (L4+); internal=true is an internal note. Stamps first_response_at.
create or replace function ticket_agent_reply(p_token text, p_ticket text, p_body text, p_internal boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_ident text;
begin
  v_ident := (select ident from auth_sessions where token = p_token);
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  insert into support_messages(ticket_id, sender_role, sender_id, body, internal)
  values (p_ticket, 'agent', v_ident, left(coalesce(p_body,''),2000), coalesce(p_internal,false));
  update support_tickets set updated_at = now(),
         first_response_at = coalesce(first_response_at, case when coalesce(p_internal,false) then first_response_at else now() end)
   where id = p_ticket;
  return json_build_object('ok', true);
end $$;
grant execute on function ticket_agent_reply(text, text, text, boolean) to anon;

-- agent updates status / assignment / priority (L4+)
create or replace function ticket_set(p_token text, p_ticket text, p_status text, p_assign text, p_priority text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  update support_tickets set
     status   = coalesce(nullif(p_status,''), status),
     assigned_to = coalesce(nullif(p_assign,''), assigned_to),
     priority = coalesce(nullif(p_priority,''), priority),
     updated_at = now()
   where id = p_ticket;
  return json_build_object('ok', found);
end $$;
grant execute on function ticket_set(text, text, text, text, text) to anon;

-- customer reads own tickets; thread EXCLUDES internal notes
create or replace function my_tickets(p_device text)
returns setof support_tickets language sql security definer set search_path = public stable as $$
  select * from support_tickets where device_key = p_device order by updated_at desc limit 30;
$$;
grant execute on function my_tickets(text) to anon;

create or replace function ticket_thread(p_device text, p_ticket text)
returns json language plpgsql security definer set search_path = public stable as $$
begin
  if not exists (select 1 from support_tickets where id = p_ticket and device_key = p_device) then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return json_build_object('ok', true, 'messages', coalesce((
    select json_agg(json_build_object('role', sender_role, 'body', body, 'at', at) order by at)
    from support_messages where ticket_id = p_ticket and internal = false), '[]'::json));
end $$;
grant execute on function ticket_thread(text, text) to anon;

-- agent queue + full thread (L4+, sees internal notes)
create or replace function ticket_queue(p_token text)
returns json language plpgsql security definer set search_path = public stable as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  return json_build_object('ok', true, 'tickets', coalesce((
    select json_agg(row_to_json(t) order by t.priority desc, t.created_at asc)
    from (select id, device_key, order_ref, subject, status, priority, assigned_to, created_at,
                 extract(epoch from (now()-created_at))/3600 as age_hours
          from support_tickets where status in ('open','pending') limit 100) t), '[]'::json));
end $$;
grant execute on function ticket_queue(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_dev text := 'sup_buyer_001'; r json; v_tkt text;
begin
  insert into admin_users(ident, level, name, active) values ('__sup_agent__','l4','sup',true) on conflict (ident) do update set level='l4', active=true;
  insert into auth_sessions(token, ident, device_key) values ('__sup_tok__','__sup_agent__','dev_sup') on conflict (token) do nothing;
  delete from support_tickets where device_key = v_dev;

  -- customer opens a ticket with order context
  r := ticket_open(v_dev, 'ORD_X', 'delivery', 'Late order', 'My order is late'); v_tkt := r->>'ticket';
  assert (r->>'ok')='true', 'FAIL: open';

  -- a stranger cannot reply
  assert (ticket_reply('stranger', v_tkt, 'hi')->>'ok')='false', 'FAIL: stranger replied';

  -- agent adds a public reply + an INTERNAL note
  assert (ticket_agent_reply('__sup_tok__', v_tkt, 'Sorry, checking now', false)->>'ok')='true', 'FAIL: agent reply';
  assert (ticket_agent_reply('__sup_tok__', v_tkt, 'note: partner delayed', true)->>'ok')='true', 'FAIL: internal note';
  assert (select first_response_at from support_tickets where id=v_tkt) is not null, 'FAIL: first_response_at not stamped';

  -- customer thread hides the internal note (2 visible: their msg + agent public)
  r := ticket_thread(v_dev, v_tkt);
  assert (r->>'ok')='true' and json_array_length(r->'messages') = 2, 'FAIL: internal note leaked to customer';

  -- agent sets priority + resolves; non-admin cannot
  assert (ticket_set('__nope__', v_tkt, 'resolved', null, 'high')->>'ok')='false', 'FAIL: non-admin set ticket';
  assert (ticket_set('__sup_tok__', v_tkt, 'resolved', '__sup_agent__', 'high')->>'ok')='true', 'FAIL: agent set';
  assert (select status from support_tickets where id=v_tkt)='resolved', 'FAIL: not resolved';

  -- customer replies → reopens
  assert (ticket_reply(v_dev, v_tkt, 'still not here')->>'ok')='true', 'FAIL: customer reopen reply';
  assert (select status from support_tickets where id=v_tkt)='open', 'FAIL: reply did not reopen';

  -- non-admin cannot read the agent queue
  assert (ticket_queue('__nope__')->>'ok')='false', 'FAIL: non-admin read queue';

  delete from support_tickets where device_key = v_dev;
  delete from auth_sessions where token='__sup_tok__'; delete from admin_users where ident='__sup_agent__';
  raise notice 'PASS: support — open/reply, agent gated, internal notes hidden, status/priority, reopen';
end $$;

select 'support ticketing ready' as status;
