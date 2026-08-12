-- ============================================================
-- END-TO-END SCENARIOS (product-manager-level) — run after the full sequence.
-- The migration proofs test each function in isolation; these test the REAL
-- business flows ACROSS subsystems and assert the whole system is correct.
-- HEALTHY = every 'E2E PASS' notice fires; any assert aborts with the failure.
-- ============================================================

-- ---------- 1. MONEY SPINE: order → accept → deliver → settle → refund → void → audit ----------
do $$
declare v_dev text := 'e2e_buyer_0001'; v_shop text := _my_shop('e2e_shop_0001dev');
        r json; v_due numeric; v_void numeric; v_rec json;
begin
  delete from shop_orders where id='E2E_O1'; delete from settlement_ledger where order_ref='E2E_O1';
  delete from refunds where order_ref='E2E_O1'; delete from payments where ref='E2E_O1';
  delete from finance_events where order_ref='E2E_O1';

  -- buyer places an online-PAID order (verified payment recorded)
  insert into shop_orders(id,shop_id,buyer_device,items,total,status)
    values ('E2E_O1',v_shop,v_dev,'[{"name":"Milk","q":2,"price":30}]'::jsonb,60,'new');
  insert into payments(rzp_order_id,rzp_payment_id,amount_paise,ref,status,verified_at)
    values ('e2e_ord1','e2e_pay1',6000,'E2E_O1','verified',now());

  -- nothing owed to the shop yet (not delivered)
  select coalesce(sum(net),0) into v_due from settlement_ledger where order_ref='E2E_O1' and status='due';
  assert v_due = 0, 'E2E FAIL: settled before delivery';

  -- shop accepts then delivers (state machine: new→prep→done)
  assert shop_order_status('E2E_O1','e2e_shop_0001dev','prep'), 'E2E FAIL: accept refused';
  assert shop_order_status('E2E_O1','e2e_shop_0001dev','done'), 'E2E FAIL: deliver refused';

  -- on delivery the seller payable books at 92% of 60 = 55.20
  select coalesce(sum(net),0) into v_due from settlement_ledger where order_ref='E2E_O1' and status='due';
  assert v_due = 55.20, 'E2E FAIL: settlement not 55.20 on delivery, got '||v_due;

  -- buyer refunds → refund succeeds (device-scoped) AND the seller payable is voided
  r := refund_open('E2E_O1', v_dev, 'damaged');
  assert (r->>'ok')='true' and (r->>'amount_paise')::int = 6000, 'E2E FAIL: refund not opened for full amount';
  select coalesce(sum(net),0) into v_void from settlement_ledger where order_ref='E2E_O1' and status='void';
  assert v_void = 55.20, 'E2E FAIL: settlement not voided on refund';

  -- immutable audit trail captured the whole thing
  assert (select count(*) from finance_events where order_ref='E2E_O1') >= 3, 'E2E FAIL: finance audit incomplete';

  delete from shop_orders where id='E2E_O1'; delete from settlement_ledger where order_ref='E2E_O1';
  delete from refunds where order_ref='E2E_O1'; delete from payments where ref='E2E_O1';
  delete from finance_events where order_ref='E2E_O1';
  raise notice 'E2E PASS: money spine — order→accept→deliver→settle(55.20)→refund→void, fully audited';
end $$;

-- ---------- 2. DISPATCH: post → offer nearest → accept → assign → done → free carrier ----------
do $$
declare r json;
begin
  delete from job_offers where job_id='E2E_J1'; delete from dispatch_events where job_id='E2E_J1'; delete from live_jobs where id='E2E_J1';
  delete from partner_presence where device_key in ('e2e_rider_near','e2e_rider_far');

  perform partner_ping('e2e_rider_near', true, 0.001, 0.0, 'bike','Near',4.9);
  perform partner_ping('e2e_rider_far',  true, 0.02,  0.0, 'bike','Far', 5.0);

  -- posting the job auto-dispatches (trigger) → the NEAR rider gets the offer
  insert into live_jobs(id,device_key,what,jtype,from_lat,from_lng,status)
    values ('E2E_J1','e2e_poster','Tiffin','box',0,0,'open');
  assert exists(select 1 from job_offers where job_id='E2E_J1' and device_key='e2e_rider_near' and status='offered'),
         'E2E FAIL: nearest rider not offered on post';

  -- accept → atomically assigned + carrying set
  r := offer_respond('E2E_J1','e2e_rider_near',true);
  assert (r->>'assigned')='true', 'E2E FAIL: accept did not assign';
  assert (select status from live_jobs where id='E2E_J1')='taken', 'E2E FAIL: job not taken';
  assert (select carrying from partner_presence where device_key='e2e_rider_near')='E2E_J1', 'E2E FAIL: carrier not set';

  -- complete + sweep frees the carrier
  update live_jobs set status='done' where id='E2E_J1';
  perform dispatch_sweep();
  assert (select carrying from partner_presence where device_key='e2e_rider_near') is null, 'E2E FAIL: carrier not freed after done';

  delete from job_offers where job_id='E2E_J1'; delete from dispatch_events where job_id='E2E_J1'; delete from live_jobs where id='E2E_J1';
  delete from partner_presence where device_key in ('e2e_rider_near','e2e_rider_far');
  raise notice 'E2E PASS: dispatch — post→offer-nearest→accept→assign→done→free-carrier';
end $$;

-- ---------- 3. DISCOVERY: search (typo) + recommendations (popularity + co-purchase) ----------
do $$
declare j jsonb;
begin
  delete from shop_orders where id='E2E_RO1'; delete from shop_items where id in ('e2e_milk','e2e_bread'); delete from shops where id='e2e_recoshop';

  insert into shops(id,name,category,is_open,rating,lat,lng) values ('e2e_recoshop','E2E Mart','grocery',true,4.5,28.6,77.2);
  insert into shop_items(id,shop_id,name,price,in_stock) values
    ('e2e_milk','e2e_recoshop','Milk',30,true), ('e2e_bread','e2e_recoshop','Bread',40,true);
  insert into shop_orders(id,shop_id,buyer_device,items,total,status,created_at)
    values ('E2E_RO1','e2e_recoshop','e2e_b','[{"name":"Milk","q":3},{"name":"Bread","q":1}]'::jsonb,130,'done',now()-interval '1 day');

  -- search tolerates a typo ('mikl' → Milk)
  j := search_items('mikl',28.6,77.2,10)::jsonb;
  assert exists(select 1 from jsonb_array_elements(j) e where e->>'name' ilike '%milk%'), 'E2E FAIL: search typo tolerance';

  -- home reco is non-empty and grounded (nearby in-stock)
  j := reco_home('e2e_other',28.6,77.2,10)::jsonb;
  assert jsonb_array_length(j) >= 2, 'E2E FAIL: reco_home empty';

  -- bought-together: Milk → Bread (co-purchased in the realised order)
  j := reco_bought_together('Milk',10)::jsonb;
  assert exists(select 1 from jsonb_array_elements(j) e where e->>'name'='Bread'), 'E2E FAIL: co-purchase Milk→Bread';

  delete from shop_orders where id='E2E_RO1'; delete from shop_items where id in ('e2e_milk','e2e_bread'); delete from shops where id='e2e_recoshop';
  raise notice 'E2E PASS: discovery — search(typo) + reco(popular) + bought-together';
end $$;

select 'e2e scenarios ready' as status;
