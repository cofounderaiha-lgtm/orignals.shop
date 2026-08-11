-- ============================================================
-- ORIGNALS SHOP ORDERS — real commerce across devices.
-- A buyer's order on a community shop lands on the owner's phone;
-- the owner's accept/ready/handover drives the buyer's tracking.
-- Only the shop's own device can change an order's status.
-- ============================================================

create table if not exists shop_orders (
  id text primary key,                       -- buyer's OM id
  created_at timestamptz not null default now(),
  shop_id text not null,
  buyer_device text not null,
  buyer_name text,
  buyer_addr text,
  buyer_lat double precision, buyer_lng double precision,
  items jsonb not null,
  total numeric not null,
  note text,
  status text not null default 'new',        -- new|prep|finding|handed|selfout|done|rejected
  updated_at timestamptz not null default now()
);

create index if not exists shop_orders_shop_idx on shop_orders (shop_id, created_at desc);
create index if not exists shop_orders_buyer_idx on shop_orders (buyer_device, created_at desc);

alter table shop_orders enable row level security;
-- ⚠ SECURITY (2026-08-11): NO blanket anon SELECT. This table carries buyer PII
-- (name, address, GPS) and the delivery handover OTP. A `so_read using(true)`
-- policy (previously declared here) let anyone with the PUBLIC anon key read
-- every order's OTP + address → delivery interception at scale. Reads go through
-- security-definer RPCs scoped to the caller: my_shop_orders() (shop reads its
-- own), order_statuses() (buyer polls its own), order_timeline() (either party).
-- See harden_rls.sql and migrations/0009. Do NOT reintroduce so_read.
drop policy if exists so_read on shop_orders;
-- INSERT stays anon: a buyer on any device must be able to place an order onto
-- the shop's device. It is append-only (no anon UPDATE/DELETE); status moves
-- only via shop_order_status()/shop_order_cancel() (device-scoped, audited).
drop policy if exists so_insert on shop_orders;
create policy so_insert on shop_orders for insert with check (true);

-- ONLY the owning shop's device may move an order through its statuses
create or replace function shop_order_status(p_id text, p_device text, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('prep','finding','handed','selfout','done','rejected') then
    return false;
  end if;
  update shop_orders
     set status = p_status, updated_at = now()
   where id = p_id
     and shop_id = 'my_' || substr(p_device, 1, 12)
     and status not in ('done','rejected');
  return found;
end $$;

grant execute on function shop_order_status(text, text, text) to anon;

select 'shop_orders commerce loop ready' as status;
