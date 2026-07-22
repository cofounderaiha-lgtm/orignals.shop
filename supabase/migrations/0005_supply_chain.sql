-- ============================================================
-- SUPPLY CHAIN + VIRTUAL INVENTORY
--   manufacturer  →  wholesaler  →  retailer (small shop)  →  customer
--
-- Builds on what already exists (schema.sql): seller_tier enum
-- (individual|retail|large_retail|wholesaler|manufacturer), shops.b2b,
-- shop_items.moq, and the rfqs table. Those gave price DISCOVERY.
-- This adds the parts that were missing: actually BUYING stock, tracking
-- what you hold, and tracing a batch back up the chain.
--
-- Design notes:
-- • Stock is DERIVED from an append-only ledger, never a mutable counter.
--   Every movement (purchase in, sale out, adjustment, return) is a row, so
--   inventory is auditable and can never silently drift.
-- • Ownership is derived server-side from the device key, exactly like
--   shop_upsert (migrations/0002) — the client never states who it is.
-- • batch flows down the chain, which is what makes "every batch
--   purity-tested" checkable rather than decorative.
-- ============================================================

-- ---------- B2B purchase orders ----------
create table if not exists purchase_orders (
  id            bigint generated always as identity primary key,
  buyer_shop    text not null,
  supplier_shop text not null,
  items         jsonb not null default '[]'::jsonb,   -- [{name, qty, unit, price}]
  total         numeric(12,2) not null default 0,
  status        text not null default 'placed',       -- placed|accepted|dispatched|received|cancelled
  batch         text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists po_buyer_idx    on purchase_orders(buyer_shop, created_at desc);
create index if not exists po_supplier_idx on purchase_orders(supplier_shop, status, created_at desc);
alter table purchase_orders enable row level security;   -- RPC-only

-- ---------- append-only stock ledger ----------
create table if not exists stock_ledger (
  id         bigint generated always as identity primary key,
  shop_id    text not null,
  item_name  text not null,
  delta      numeric(12,2) not null,      -- +in / -out
  reason     text not null,               -- purchase|sale|adjust|return|waste
  ref        text,
  batch      text,
  created_at timestamptz not null default now()
);
create index if not exists sl_shop_idx on stock_ledger(shop_id, item_name);
alter table stock_ledger enable row level security;      -- RPC-only

-- helper: this device's shop id (same derivation as shop_upsert)
create or replace function _my_shop(p_device text) returns text
language sql immutable as $$ select case when coalesce(p_device,'')='' or length(p_device)<8
  then null else 'my_' || substr(p_device,1,12) end $$;

-- ---------- who can I buy from? ----------
create or replace function suppliers_list(p_q text, p_tier text)
returns json language plpgsql security definer set search_path=public as $$
begin
  return (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select id, name, category, tier::text, coalesce(addr,'') addr, coalesce(rating,0) rating
    from shops
    where deleted_at is null
      and (b2b = true or tier in ('wholesaler','manufacturer'))
      and (coalesce(p_tier,'')='' or tier::text = p_tier)
      and (coalesce(p_q,'')='' or name ilike '%'||p_q||'%' or category ilike '%'||p_q||'%')
    order by tier desc, rating desc nulls last limit 50) t);
exception when others then return '[]'::json; end $$;

-- ---------- retailer places a purchase order upstream ----------
create or replace function po_place(p_device text, p_supplier text, p_items jsonb, p_note text)
returns json language plpgsql security definer set search_path=public as $$
declare v_buyer text; v_total numeric := 0; v_id bigint;
begin
  v_buyer := _my_shop(p_device);
  if v_buyer is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  if not exists (select 1 from shops where id = v_buyer) then
    return json_build_object('ok',false,'reason','no_shop'); end if;
  if not exists (select 1 from shops where id = p_supplier and deleted_at is null
                   and (b2b = true or tier in ('wholesaler','manufacturer'))) then
    return json_build_object('ok',false,'reason','not_a_supplier'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok',false,'reason','no_items'); end if;
  if v_buyer = p_supplier then return json_build_object('ok',false,'reason','self_order'); end if;

  select coalesce(sum( coalesce((e->>'qty')::numeric,0) * coalesce((e->>'price')::numeric,0) ),0)
    into v_total from jsonb_array_elements(p_items) e;

  insert into purchase_orders(buyer_shop, supplier_shop, items, total, note)
  values (v_buyer, p_supplier, p_items, v_total, left(coalesce(p_note,''),200))
  returning id into v_id;

  return json_build_object('ok',true,'id',v_id,'total',v_total,'status','placed');
exception when others then return json_build_object('ok',false,'reason','error','detail',sqlerrm); end $$;

-- ---------- both sides see their POs ----------
create or replace function po_list(p_device text)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop text;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  return json_build_object('ok',true,
    'placed', (select coalesce(json_agg(row_to_json(t) order by t.created_at desc),'[]'::json) from (
      select p.id, p.supplier_shop, coalesce(s.name, p.supplier_shop) supplier_name,
             p.items, p.total, p.status, p.batch, p.created_at
      from purchase_orders p left join shops s on s.id = p.supplier_shop
      where p.buyer_shop = v_shop limit 100) t),
    'received', (select coalesce(json_agg(row_to_json(t) order by t.created_at desc),'[]'::json) from (
      select p.id, p.buyer_shop, coalesce(b.name, p.buyer_shop) buyer_name,
             p.items, p.total, p.status, p.batch, p.created_at
      from purchase_orders p left join shops b on b.id = p.buyer_shop
      where p.supplier_shop = v_shop limit 100) t));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- move a PO along; receiving credits stock ----------
create or replace function po_advance(p_device text, p_id bigint, p_status text, p_batch text)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop text; r purchase_orders; v_is_buyer boolean; v_is_supplier boolean;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  select * into r from purchase_orders where id = p_id;
  if r.id is null then return json_build_object('ok',false,'reason','not_found'); end if;
  v_is_buyer := (r.buyer_shop = v_shop);
  v_is_supplier := (r.supplier_shop = v_shop);
  if not (v_is_buyer or v_is_supplier) then return json_build_object('ok',false,'reason','not_yours'); end if;
  if r.status in ('received','cancelled') then return json_build_object('ok',false,'reason','already_final'); end if;

  -- only the supplier accepts/dispatches; only the buyer receives; either may cancel pre-dispatch
  if p_status in ('accepted','dispatched') and not v_is_supplier then
    return json_build_object('ok',false,'reason','supplier_only'); end if;
  if p_status = 'received' and not v_is_buyer then
    return json_build_object('ok',false,'reason','buyer_only'); end if;
  if p_status = 'cancelled' and r.status = 'dispatched' then
    return json_build_object('ok',false,'reason','already_dispatched'); end if;
  if p_status not in ('accepted','dispatched','received','cancelled') then
    return json_build_object('ok',false,'reason','bad_status'); end if;

  update purchase_orders
     set status = p_status,
         batch = coalesce(nullif(p_batch,''), batch),
         updated_at = now()
   where id = p_id;

  -- receiving is what actually creates inventory, with the batch attached
  if p_status = 'received' then
    insert into stock_ledger(shop_id, item_name, delta, reason, ref, batch)
    select r.buyer_shop, left(e->>'name',80), coalesce((e->>'qty')::numeric,0),
           'purchase', 'PO#'||r.id, coalesce(nullif(p_batch,''), r.batch)
    from jsonb_array_elements(r.items) e
    where coalesce((e->>'qty')::numeric,0) > 0;
  end if;

  return json_build_object('ok',true,'status',p_status);
exception when others then return json_build_object('ok',false,'reason','error','detail',sqlerrm); end $$;

-- ---------- selling to a customer draws stock down ----------
create or replace function stock_sell(p_device text, p_items jsonb, p_ref text)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop text; v_n int := 0;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return json_build_object('ok',true,'rows',0); end if;
  insert into stock_ledger(shop_id, item_name, delta, reason, ref)
  select v_shop, left(e->>'name',80), -abs(coalesce((e->>'qty')::numeric,1)), 'sale', left(coalesce(p_ref,''),40)
  from jsonb_array_elements(p_items) e
  where coalesce(e->>'name','') <> '';
  get diagnostics v_n = row_count;
  return json_build_object('ok',true,'rows',v_n);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- manual correction (spoilage, stock-take) ----------
create or replace function stock_adjust(p_device text, p_item text, p_delta numeric, p_reason text)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop text;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  if coalesce(p_item,'') = '' or coalesce(p_delta,0) = 0 then return json_build_object('ok',false,'reason','bad_input'); end if;
  insert into stock_ledger(shop_id, item_name, delta, reason)
  values (v_shop, left(p_item,80), p_delta,
          case when coalesce(p_reason,'') in ('waste','return','adjust') then p_reason else 'adjust' end);
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- current stock, low-stock flags, reorder suggestions ----------
create or replace function stock_levels(p_device text)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop text;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  return json_build_object('ok',true,'shop',v_shop,
    'items', (select coalesce(json_agg(row_to_json(t) order by t.on_hand asc),'[]'::json) from (
      select l.item_name,
             sum(l.delta) on_hand,
             sum(case when l.delta > 0 then l.delta else 0 end) total_in,
             -sum(case when l.delta < 0 then l.delta else 0 end) total_out,
             max(l.batch) filter (where l.batch is not null) batch,
             max(l.created_at) last_move,
             /* 14-day sales velocity → days of cover left */
             coalesce(-sum(l.delta) filter (where l.reason='sale' and l.created_at > now() - interval '14 days'),0)/14.0 daily_sales,
             (sum(l.delta) <= 0) is_out,
             (sum(l.delta) > 0 and sum(l.delta) <= 5) is_low
      from stock_ledger l
      where l.shop_id = v_shop
      group by l.item_name) t));
exception when others then return json_build_object('ok',false,'reason','error','detail',sqlerrm); end $$;

grant execute on function suppliers_list(text,text)                  to anon;
grant execute on function po_place(text,text,jsonb,text)             to anon;
grant execute on function po_list(text)                              to anon;
grant execute on function po_advance(text,bigint,text,text)          to anon;
grant execute on function stock_sell(text,jsonb,text)                to anon;
grant execute on function stock_adjust(text,text,numeric,text)       to anon;
grant execute on function stock_levels(text)                         to anon;

select 'supply chain installed' as status,
  (select count(*) from shops where b2b = true or tier in ('wholesaler','manufacturer')) as suppliers_available;
