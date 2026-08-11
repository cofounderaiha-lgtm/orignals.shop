-- ============================================================
-- CONCURRENCY TEST MATRIX (§8/§48)  ·  staging
--   Two parts:
--   PART A (below, in-SQL): STRUCTURAL check that every concurrency guard actually
--     exists after the full migration sequence. Cheap, deterministic, run in CI.
--     HEALTHY = raises 'ALL CONCURRENCY GUARDS PRESENT'.
--   PART B (documented harness): the TRUE parallel tests — they need N concurrent
--     sessions, so they run via pgbench, not a single transaction. Commands given
--     at the bottom. "The system must produce one authoritative result."
--
--   The invariants each guard protects are ALSO proven functionally in-migration
--   (0006 stock sale-once, 0015 refund idempotency, 0016 atomic assign). This file
--   is the integration-level assertion that the guards survived the full sequence.
-- ============================================================
do $$
declare missing text := '';
  procedure_note text;
begin
  -- 1. REFUND: at most one non-failed refund per order (no double refund on retry/race)
  if to_regclass('public.refunds') is not null
     and not exists (select 1 from pg_indexes where schemaname='public' and tablename='refunds'
                     and indexname='refunds_one_open_per_order') then
    missing := missing || E'\n - refunds_one_open_per_order (double-refund guard, 0015)';
  end if;

  -- 2. STOCK SALE: a sale for the same (shop,item,order) posts once (no double-deduct)
  if to_regclass('public.stock_ledger') is not null
     and not exists (select 1 from pg_indexes where schemaname='public' and tablename='stock_ledger'
                     and indexname='sl_sale_once') then
    missing := missing || E'\n - sl_sale_once (double-deduct guard, 0006)';
  end if;

  -- 3. PO RECEIVE: conserved receive posts once
  if to_regclass('public.stock_ledger') is not null
     and not exists (select 1 from pg_indexes where schemaname='public' and tablename='stock_ledger'
                     and indexname='sl_po_once') then
    missing := missing || E'\n - sl_po_once (double-receive guard, 0007)';
  end if;

  -- 4. SEATS: one seat, one booking per show (no seat race double-book)
  if to_regclass('public.seat_bookings') is not null
     and not exists (
       select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
       where t.relname='seat_bookings' and c.contype='u'
         and pg_get_constraintdef(c.oid) ilike '%show_key%' and pg_get_constraintdef(c.oid) ilike '%seat%'
       union
       select 1 from pg_indexes where schemaname='public' and tablename='seat_bookings'
         and indexdef ilike '%unique%' and indexdef ilike '%show_key%' and indexdef ilike '%seat%') then
    missing := missing || E'\n - unique(seat_bookings show,seat) (seat double-book guard)';
  end if;

  -- 5. DISPATCH: at most one LIVE offer per (job,partner)
  if to_regclass('public.job_offers') is not null
     and not exists (select 1 from pg_indexes where schemaname='public' and tablename='job_offers'
                     and indexname='job_offers_one_live') then
    missing := missing || E'\n - job_offers_one_live (double-offer guard, 0016)';
  end if;

  -- 6. PAYMENTS: one ledger row per Razorpay order (webhook replay can't duplicate)
  if to_regclass('public.payments') is not null
     and not exists (
       select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
       where t.relname='payments' and c.contype in ('u','p')
         and pg_get_constraintdef(c.oid) ilike '%rzp_order_id%') then
    missing := missing || E'\n - unique(payments.rzp_order_id) (webhook-replay guard)';
  end if;

  -- 7. SETTLEMENT: one settlement row per (order,payee)
  if to_regclass('public.settlement_ledger') is not null
     and not exists (
       select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
       where t.relname='settlement_ledger' and c.contype in ('u','p')
         and pg_get_constraintdef(c.oid) ilike '%order_ref%') then
    missing := missing || E'\n - unique(settlement_ledger order_ref,payee) (double-settle guard)';
  end if;

  if missing <> '' then
    raise exception 'CONCURRENCY GUARD(S) MISSING:%', missing;
  end if;
  raise notice 'ALL CONCURRENCY GUARDS PRESENT (refund/stock/PO/seat/offer/payment/settlement)';
end $$;

select 'concurrency structural checks passed' as status;

-- ============================================================
-- PART B — TRUE PARALLEL HARNESS (run these on staging; each must yield ONE result)
-- ============================================================
-- These need real concurrent sessions. Use pgbench against the staging DB. Each
-- script hammers ONE contended resource from many clients; then assert the count.
--
-- (i) 100 concurrent checkouts of the LAST unit — never oversell (once a stock-gated
--     checkout exists; the reservation layer was deferred, see COMPLETION-ASSESSMENT).
--     Placeholder until then: reserve N=1, fire 100 clients, assert <=1 success.
--
-- (ii) DOUBLE REFUND under race — 50 clients call refund_open on ONE paid order:
--     printf 'select refund_open(:oref, :dev, %s);\n' "'race'" > refund.sql
--     pgbench -n -c 50 -t 1 -D oref="'OM_TEST'" -D dev="'dev_test'" -f refund.sql "$STAGING_URL"
--     -- assert: select count(*) from refunds where order_ref='OM_TEST' and status<>'failed';  == 1
--
-- (iii) DOUBLE ASSIGN under race — offer the SAME open job to 20 partners, all accept:
--     -- seed 20 job_offers (offered) for job J, then:
--     printf 'select offer_respond(:job, :dev, true);\n' > accept.sql
--     pgbench -n -c 20 -t 1 -D job="'J'" -D dev="'dev_'||:client_id" -f accept.sql "$STAGING_URL"
--     -- assert: select count(*) from live_jobs where id='J' and status='taken';   == 1
--     -- assert: select count(distinct taken_by) from live_jobs where id='J';       == 1
--
-- (iv) SEAT RACE — 30 clients book the SAME seat for one show:
--     printf 'select seats_book(:show, array[:seat], :dev);\n' > seat.sql
--     pgbench -n -c 30 -t 1 ... -f seat.sql "$STAGING_URL"
--     -- assert: select count(*) from seat_bookings where show_key=:show and seat=:seat; == 1
--
-- (v) WEBHOOK REPLAY — POST the same razorpay-webhook payload 10x (curl loop):
--     -- assert: select count(*) from payments where rzp_order_id=:oid;              == 1
--     -- assert the order is marked paid exactly once; no duplicate settlement.
--
-- PASS CRITERIA: every assertion above returns exactly 1. Any >1 is an oversell /
-- double-charge / double-assign and BLOCKS the production gate (§81).
-- ============================================================
