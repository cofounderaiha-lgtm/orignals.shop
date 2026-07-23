-- ============================================================
-- STOCK LEDGER — make sales idempotent.
--
-- Why: migrations/0005 claims stock "cannot silently drift". That claim is
-- only true if a sale can be recorded at most once. It wasn't.
-- Both completion paths call stock_sell (js/myshop.js:260 partner-delivered
-- and :471 counter sale), each guarded only by the CLIENT-side check
-- `o.status !== 'done'`. Client state is per-device and restorable
-- (snapshot_restore), so the same order could be completed again on another
-- device or after a restore — and the stock would be deducted twice, for a
-- sale that happened once. Silent drift, exactly what the ledger is meant to
-- prevent.
--
-- Fix: one sale movement per (shop, item, order ref). Enforced by a partial
-- UNIQUE INDEX in the database, not by client discipline — the client is not
-- a trustworthy place to enforce accounting.
--
-- Purchases are deliberately NOT covered by this: po_advance already refuses
-- to act on an order that is already 'received' (status guard), and a shop may
-- legitimately buy the same item from the same PO number twice across time.
-- ============================================================

-- collapse any pre-existing duplicate sale rows before adding the constraint
with dupes as (
  select id, row_number() over (
           partition by shop_id, item_name, ref
           order by created_at, id) rn
  from stock_ledger
  where reason = 'sale' and coalesce(ref,'') <> ''
)
delete from stock_ledger l using dupes d
 where l.id = d.id and d.rn > 1;

create unique index if not exists sl_sale_once
  on stock_ledger (shop_id, item_name, ref)
  where reason = 'sale' and ref is not null and ref <> '';

-- record a sale at most once per order ref
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
  where coalesce(e->>'name','') <> ''
  on conflict do nothing;                      -- same order twice = one deduction

  get diagnostics v_n = row_count;
  return json_build_object('ok',true,'rows',v_n,'deduped',(v_n = 0));
exception when others then return json_build_object('ok',false,'reason','error','detail',sqlerrm); end $$;

grant execute on function stock_sell(text,jsonb,text) to anon;

select 'sale idempotency index' as check,
       case when exists (select 1 from pg_indexes where schemaname='public' and indexname='sl_sale_once')
            then 'PRESENT — PASS' else 'MISSING — FAIL' end as result;
