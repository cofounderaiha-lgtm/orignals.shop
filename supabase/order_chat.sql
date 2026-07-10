-- ============================================================
-- IN-APP ORDER CHAT — buyer ⇄ partner ⇄ shop talk about an order
-- WITHOUT ever exchanging phone numbers or names outside the app.
-- Only the order's participants can read/write (verified server-side).
-- ============================================================

create table if not exists order_chat (
  id bigint generated always as identity primary key,
  order_ref text not null,
  from_device text not null,
  from_role text,                -- buyer | shop | partner
  msg text not null,
  created_at timestamptz not null default now()
);
create index if not exists order_chat_idx on order_chat (order_ref, created_at);
alter table order_chat enable row level security;   -- RPC-only, no bulk anon access

-- is this device a participant in the order? (buyer, the shop owner, or
-- the partner who claimed the delivery)
create or replace function chat_is_participant(p_order text, p_device text)
returns boolean language sql security definer set search_path=public stable as $$
  select exists (select 1 from shop_orders where id = p_order
                   and (buyer_device = p_device or shop_id = 'my_'||substr(p_device,1,12)))
      or exists (select 1 from live_jobs where order_ref = p_order and taken_by = p_device);
$$;

create or replace function chat_send(p_order text, p_device text, p_role text, p_msg text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if length(trim(coalesce(p_msg,''))) = 0 then return json_build_object('ok',false); end if;
  if not chat_is_participant(p_order, p_device) then return json_build_object('ok',false,'reason','not_participant'); end if;
  insert into order_chat (order_ref, from_device, from_role, msg)
    values (p_order, p_device, left(coalesce(p_role,'user'),10), left(p_msg,500));
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $$;

create or replace function chat_read(p_order text, p_device text)
returns setof order_chat language plpgsql security definer set search_path=public as $$
begin
  if not chat_is_participant(p_order, p_device) then return; end if;
  return query select * from order_chat where order_ref = p_order order by created_at asc limit 200;
end $$;

grant execute on function chat_send(text,text,text,text) to anon;
grant execute on function chat_read(text,text) to anon;

select 'order chat ready' as status;
