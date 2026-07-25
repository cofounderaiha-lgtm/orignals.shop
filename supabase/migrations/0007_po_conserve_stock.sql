-- ============================================================
-- SUPPLY CHAIN — conserve stock across tiers, idempotently.
--
-- Bug in 0005: po_advance('received') CREDITS the buyer's stock but never
-- DEBITS the supplier's. So goods appeared out of nowhere: a wholesaler could
-- fulfil a 40-sack order to a retailer and still show 40 sacks on hand. The
-- three-tier chain (manufacturer → wholesaler → retailer → customer) was not
-- conserved — every hop invented inventory upstream.
--
-- Fix: the transfer happens atomically at 'received'. Buyer +qty ('purchase'),
-- supplier -qty ('po_out'), same batch, same PO ref. Both idempotent via a
-- partial UNIQUE index — receiving a PO twice moves stock once. (A supplier
-- going negative is meaningful, not a bug: a manufacturer logs production with
-- stock_adjust(+) before shipping; negative = "you shipped more than you logged
-- making".)
--
-- Debit on 'received' (not 'dispatched') keeps it a single conserved event and
-- avoids an in-transit limbo to reconcile if a delivery is never confirmed.
-- ============================================================

-- collapse any pre-existing duplicate PO movements before the constraint
with dupes as (
  select id, row_number() over (
           partition by shop_id, item_name, ref, reason
           order by created_at, id) rn
  from stock_ledger
  where reason in ('purchase','po_out') and coalesce(ref,'') <> ''
)
delete from stock_ledger l using dupes d where l.id = d.id and d.rn > 1;

create unique index if not exists sl_po_once
  on stock_ledger (shop_id, item_name, ref, reason)
  where reason in ('purchase','po_out') and ref is not null and ref <> '';

create or replace function po_advance(p_device text, p_id bigint, p_status text, p_batch text)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop text; r purchase_orders; v_is_buyer boolean; v_is_supplier boolean; v_batch text;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  select * into r from purchase_orders where id = p_id;
  if r.id is null then return json_build_object('ok',false,'reason','not_found'); end if;
  v_is_buyer := (r.buyer_shop = v_shop);
  v_is_supplier := (r.supplier_shop = v_shop);
  if not (v_is_buyer or v_is_supplier) then return json_build_object('ok',false,'reason','not_yours'); end if;
  if r.status in ('received','cancelled') then return json_build_object('ok',false,'reason','already_final'); end if;

  if p_status in ('accepted','dispatched') and not v_is_supplier then
    return json_build_object('ok',false,'reason','supplier_only'); end if;
  if p_status = 'received' and not v_is_buyer then
    return json_build_object('ok',false,'reason','buyer_only'); end if;
  if p_status = 'cancelled' and r.status = 'dispatched' then
    return json_build_object('ok',false,'reason','already_dispatched'); end if;
  if p_status not in ('accepted','dispatched','received','cancelled') then
    return json_build_object('ok',false,'reason','bad_status'); end if;

  update purchase_orders
     set status = p_status, batch = coalesce(nullif(p_batch,''), batch), updated_at = now()
   where id = p_id;

  -- receiving is the single conserved transfer: buyer gains, supplier loses.
  if p_status = 'received' then
    v_batch := coalesce(nullif(p_batch,''), r.batch);

    insert into stock_ledger(shop_id, item_name, delta, reason, ref, batch)
    select r.buyer_shop, left(e->>'name',80), coalesce((e->>'qty')::numeric,0),
           'purchase', 'PO#'||r.id, v_batch
    from jsonb_array_elements(r.items) e
    where coalesce((e->>'qty')::numeric,0) > 0
    on conflict do nothing;

    insert into stock_ledger(shop_id, item_name, delta, reason, ref, batch)
    select r.supplier_shop, left(e->>'name',80), -abs(coalesce((e->>'qty')::numeric,0)),
           'po_out', 'PO#'||r.id, v_batch
    from jsonb_array_elements(r.items) e
    where coalesce((e->>'qty')::numeric,0) > 0
    on conflict do nothing;
  end if;

  return json_build_object('ok',true,'status',p_status);
exception when others then return json_build_object('ok',false,'reason','error','detail',sqlerrm); end $$;

grant execute on function po_advance(text,bigint,text,text) to anon;

select 'po conservation index' as check,
       case when exists (select 1 from pg_indexes where schemaname='public' and indexname='sl_po_once')
            then 'PRESENT — PASS' else 'MISSING — FAIL' end as result;
