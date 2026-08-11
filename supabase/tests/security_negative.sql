-- ============================================================
-- NEGATIVE-AUTHORIZATION TEST MATRIX (§30)  ·  staging acceptance criteria
--   Run on a STAGING db AFTER the full 0001→latest migration sequence.
--   HEALTHY = raises 'ALL NEGATIVE-AUTHZ TESTS PASSED'. Any assert aborts with the
--   failing case. Each test is guarded so a not-yet-applied migration SKIPS (notice)
--   rather than errors. Uses only throwaway ids (stg_* / STG_*); never real data.
--
--   Principle: a caller who names another party's id must NOT gain access. Ownership
--   must be derived server-side from the caller's device/token — never trusted from
--   the argument.
-- ============================================================
do $$
declare
  A text := 'stg_attacker_dev_1';                 -- attacker device
  V text := 'stg_victim_dev_1';                    -- victim device
  A_shop text := 'my_' || substr('stg_attacker_dev_1',1,12);
  V_shop text := 'my_' || substr('stg_victim_dev_1',1,12);
  r json; n int; skipped text := '';
begin
  -- ---------- fixtures (idempotent) ----------
  if to_regclass('public.shop_orders') is not null then
    delete from shop_orders where id in ('STG_VO1','STG_AO1');
    insert into shop_orders(id, shop_id, buyer_device, items, total, status)
      values ('STG_VO1', V_shop, V, '[]'::jsonb, 100, 'new'),      -- victim's order
             ('STG_AO1', A_shop, A, '[]'::jsonb, 100, 'new');      -- attacker's own order
  end if;

  -- ==========================================================
  -- 1. SELLER A cannot advance SELLER B's order (shop_order_status derives shop
  --    from the CALLER's device, so naming the victim's order id must fail). [0009]
  -- ==========================================================
  if to_regproc('shop_order_status(text,text,text)') is not null then
    -- attacker (A's device) tries to move the victim's order to 'prep'
    if shop_order_status('STG_VO1', A, 'prep') = true then
      raise exception 'AUTHZ FAIL 1: seller A advanced seller B''s order';
    end if;
    -- sanity: the owner CAN advance their own
    assert shop_order_status('STG_AO1', A, 'prep') = true, 'FAIL 1b: owner could not advance own order';
  else skipped := skipped || ' [1:shop_order_status]'; end if;

  -- ==========================================================
  -- 2. BUYER A cannot cancel BUYER B's order. [0009]
  -- ==========================================================
  if to_regproc('shop_order_cancel(text,text)') is not null then
    r := shop_order_cancel('STG_VO1', A);
    assert (r->>'ok') = 'false', 'AUTHZ FAIL 2: buyer A cancelled buyer B''s order';
  else skipped := skipped || ' [2:shop_order_cancel]'; end if;

  -- ==========================================================
  -- 3. BUYER A cannot read BUYER B's order timeline. [0009]
  -- ==========================================================
  if to_regproc('order_timeline(text,text)') is not null then
    select count(*) into n from order_timeline('STG_VO1', A);
    assert n = 0, 'AUTHZ FAIL 3: buyer A read buyer B''s order history';
  else skipped := skipped || ' [3:order_timeline]'; end if;

  -- ==========================================================
  -- 4. BUYER A cannot refund BUYER B's order. [0015]
  -- ==========================================================
  if to_regproc('refund_open(text,text,text)') is not null then
    r := refund_open('STG_VO1', A, 'x');
    assert (r->>'ok') = 'false', 'AUTHZ FAIL 4: buyer A opened a refund on buyer B''s order';
  else skipped := skipped || ' [4:refund_open]'; end if;

  -- ==========================================================
  -- 5. MITRA A cannot accept an offer made to MITRA B. [0016]
  -- ==========================================================
  if to_regproc('offer_respond(text,text,boolean)') is not null
     and to_regclass('public.job_offers') is not null and to_regclass('public.live_jobs') is not null then
    delete from job_offers where job_id = 'STG_J1';
    delete from live_jobs where id = 'STG_J1';
    insert into live_jobs(id, device_key, what, jtype, from_lat, from_lng, status)
      values ('STG_J1', 'stg_poster', 'x', 'box', 0, 0, 'open');
    insert into job_offers(job_id, device_key, status, expires_at)
      values ('STG_J1', V, 'offered', now() + interval '25 seconds');   -- offered to VICTIM
    r := offer_respond('STG_J1', A, true);                              -- ATTACKER tries to accept
    assert (r->>'ok') = 'false', 'AUTHZ FAIL 5: mitra A accepted mitra B''s offer';
    assert (select status from live_jobs where id='STG_J1') = 'open', 'AUTHZ FAIL 5b: job wrongly assigned';
    delete from job_offers where job_id = 'STG_J1';
    delete from live_jobs where id = 'STG_J1';
  else skipped := skipped || ' [5:offer_respond]'; end if;

  -- ==========================================================
  -- 6. MITRA A cannot complete-deliver MITRA B's job. [live_delivery]
  -- ==========================================================
  if to_regproc('job_deliver(text,text,text)') is not null and to_regclass('public.live_jobs') is not null then
    delete from live_jobs where id = 'STG_J2';
    insert into live_jobs(id, device_key, what, jtype, status, taken_by, taken_at)
      values ('STG_J2', 'stg_poster', 'x', 'box', 'taken', V, now());   -- taken by VICTIM
    r := job_deliver('STG_J2', A, '0000');                              -- ATTACKER tries to deliver
    assert (r->>'ok') = 'false', 'AUTHZ FAIL 6: mitra A completed mitra B''s delivery';
    delete from live_jobs where id = 'STG_J2';
  else skipped := skipped || ' [6:job_deliver]'; end if;

  -- ==========================================================
  -- 7. A non-admin token cannot read admin surfaces. [settlements / 0020]
  -- ==========================================================
  if to_regproc('settlement_summary(text)') is not null then
    assert (settlement_summary('stg_not_a_token')->>'ok') = 'false', 'AUTHZ FAIL 7: non-admin read settlement_summary';
  else skipped := skipped || ' [7:settlement_summary]'; end if;
  if to_regproc('op_health(text)') is not null then
    assert (op_health('stg_not_a_token')->>'ok') = 'false', 'AUTHZ FAIL 7b: non-admin read op_health';
  else skipped := skipped || ' [7b:op_health]'; end if;
  if to_regproc('finance_reconcile(text)') is not null then
    assert (finance_reconcile('stg_not_a_token')->>'ok') = 'false', 'AUTHZ FAIL 7c: non-admin read finance_reconcile';
  else skipped := skipped || ' [7c:finance_reconcile]'; end if;

  -- ---------- cleanup ----------
  if to_regclass('public.shop_orders') is not null then
    delete from shop_orders where id in ('STG_VO1','STG_AO1');
    if to_regclass('public.settlement_ledger') is not null then delete from settlement_ledger where order_ref in ('STG_VO1','STG_AO1'); end if;
    if to_regclass('public.shop_order_events') is not null then delete from shop_order_events where order_id in ('STG_VO1','STG_AO1'); end if;
  end if;

  raise notice 'ALL NEGATIVE-AUTHZ TESTS PASSED%',
    case when skipped = '' then '' else ' (skipped, migration not applied:' || skipped || ')' end;
end $$;

-- ============================================================
-- KNOWN HOLES — these are ACCEPTANCE CRITERIA for fixes NOT yet made. They are
-- documented (not asserted) so this suite stays green on the current schema while
-- the fixes are pending. Convert each to a hard assert above once its fix lands.
--
--  H1. my_shop_orders(p_shop) is keyed on the ARGUMENT shop_id, and shop_id is
--      derivable from the PUBLIC device_key ('my_'||substr(device,1,12)). So an
--      attacker who computes a victim's shop_id can read the victim's shop orders
--      (buyer names/addresses). FIX: derive the shop from the CALLER's device
--      (my_shop_orders(p_device) → _my_shop(p_device)); drop the p_shop form.
--  H2. snapshot_restore(p_device) returns a device's ENTIRE account state to whoever
--      presents its key. device_key is a bearer token. FIX: real phone-auth + rotate
--      to session tokens (Phase 7); until then keep device_key un-enumerable (0011).
--  H3. shop_reservations(p_shop) / settlement_mine(p_payee) — same p_shop/p_payee
--      argument-trust pattern as H1. FIX: derive payee/shop from the caller.
-- ============================================================
select 'security_negative matrix ready (run on staging after full migration sequence)' as status;
