-- ============================================================
-- 0034 — MERCHANT AI AGENT LOOP  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §10/§38: a merchant agent with tools, permissions,
--   audit, and HUMAN-IN-THE-LOOP for high-impact actions. This is GROUNDED, not
--   theatre: agent_run() calls the real shop-intelligence tools (0019) over the
--   shop's actual ledger and produces explainable RECOMMENDATIONS. It never writes
--   stock or money itself — every high-impact action (reorder = spend) is logged as a
--   decision that REQUIRES the merchant's approval (agent_decide). This is the
--   inventory-agent example from §10 (detect low stock → forecast → recommend
--   reorder → obtain approval), with the approval gate enforced. An LLM can later sit
--   ON TOP to phrase/prioritize; the tools + permission model are what matter (§38).
-- ============================================================
create table if not exists agent_decisions (
  id           bigint generated always as identity primary key,
  shop_id      text not null,
  kind         text not null,               -- reorder | promote_slow | restock_alert
  subject      text,                         -- e.g. the item name
  context      jsonb,                        -- the grounded evidence (from 0019)
  recommendation text,
  confidence   numeric,
  requires_approval boolean not null default true,
  status       text not null default 'pending',  -- pending | approved | rejected | executed
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index if not exists ad_shop_idx on agent_decisions(shop_id, status, created_at desc);
-- one PENDING decision per (shop, kind, subject) — the agent won't spam duplicates
create unique index if not exists ad_one_pending on agent_decisions(shop_id, kind, subject) where status = 'pending';
alter table agent_decisions enable row level security;

-- run the merchant agent: gather grounded intelligence → log recommendations
create or replace function agent_run(p_device text)
returns json language plpgsql security definer set search_path = public as $$
declare v_shop text := _my_shop(p_device); reord jsonb; el jsonb; n int := 0;
begin
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;

  -- TOOL: reorder suggestions from the real ledger (0019). Every item that needs
  -- reordering becomes a decision the MERCHANT must approve (spending = high-impact).
  reord := (shop_reorder_suggestions(p_device))::jsonb;
  if (reord->>'ok') = 'true' then
    for el in select value from jsonb_array_elements(coalesce(reord->'items', '[]'::jsonb)) loop
      if coalesce((el->>'needs_reorder')::boolean, false) then
        insert into agent_decisions(shop_id, kind, subject, context, recommendation, confidence, requires_approval)
        values (v_shop, 'reorder', el->>'item_name', el,
                'Reorder ' || coalesce(el->>'item_name','item') || ' — on hand ' ||
                  coalesce(el->>'on_hand','?') || ', suggest ' || coalesce(el->>'suggest_qty','?') || ' units',
                0.8, true)
        on conflict (shop_id, kind, subject) where status = 'pending' do nothing;
        if found then n := n + 1; end if;
      end if;
    end loop;
  end if;

  return json_build_object('ok', true, 'recommendations', n);
end $$;
grant execute on function agent_run(text) to anon;

-- merchant approves / rejects a recommendation (the human-in-the-loop gate)
create or replace function agent_decide(p_device text, p_decision bigint, p_approve boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_shop text; v_status text;
begin
  select shop_id, status into v_shop, v_status from agent_decisions where id = p_decision;
  if v_shop is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_shop <> _my_shop(p_device) then return json_build_object('ok', false, 'reason', 'not_your_shop'); end if;
  if v_status <> 'pending' then return json_build_object('ok', false, 'reason', 'not_pending'); end if;
  update agent_decisions set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now()
   where id = p_decision;
  -- NOTE: execution (e.g. creating the PO via the supply chain) happens only AFTER
  -- approval, as a separate explicit step — the agent itself never spends.
  return json_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;
grant execute on function agent_decide(text, bigint, boolean) to anon;

create or replace function agent_pending(p_device text)
returns setof agent_decisions language sql security definer set search_path = public stable as $$
  select * from agent_decisions where shop_id = _my_shop(p_device) and status = 'pending' order by created_at desc limit 50;
$$;
grant execute on function agent_pending(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_dev text := 'agentdev00001'; v_shop text := _my_shop('agentdev00001'); r json; v_id bigint;
begin
  delete from agent_decisions where shop_id = v_shop;
  delete from stock_ledger where shop_id = v_shop; delete from shops where id = v_shop;
  insert into shops(id,name,category) values (v_shop,'Agent Mart','grocery');
  -- Milk drawn low with real sales velocity → shop_reorder_suggestions flags it
  insert into stock_ledger(shop_id, item_name, delta, reason, created_at) values
    (v_shop,'Milk',20,'purchase', now()-interval '20 days'),
    (v_shop,'Milk',-6,'sale', now()-interval '10 days'),
    (v_shop,'Milk',-6,'sale', now()-interval '6 days'),
    (v_shop,'Milk',-6,'sale', now()-interval '2 days');   -- on_hand 2, high velocity

  -- agent runs → 1 grounded reorder recommendation, requiring approval
  r := agent_run(v_dev);
  assert (r->>'ok')='true' and (r->>'recommendations')::int = 1, 'FAIL: agent produced no recommendation, got '||(r->>'recommendations');
  select id into v_id from agent_decisions where shop_id=v_shop and kind='reorder' and status='pending';
  assert v_id is not null, 'FAIL: no pending decision';
  assert (select requires_approval from agent_decisions where id=v_id) = true, 'FAIL: high-impact not gated on approval';

  -- re-run is idempotent (no duplicate pending)
  r := agent_run(v_dev);
  assert (r->>'recommendations')::int = 0, 'FAIL: duplicate recommendation created';
  assert (select count(*) from agent_decisions where shop_id=v_shop and status='pending') = 1, 'FAIL: duplicate pending';

  -- a foreign shop cannot approve; the owner can
  assert (agent_decide('someoneelse99', v_id, true)->>'ok')='false', 'FAIL: foreign approval allowed';
  assert (agent_decide(v_dev, v_id, true)->>'ok')='true', 'FAIL: owner approval';
  assert (select status from agent_decisions where id=v_id) = 'approved', 'FAIL: not approved';

  delete from agent_decisions where shop_id = v_shop;
  delete from stock_ledger where shop_id = v_shop; delete from shops where id = v_shop;
  raise notice 'PASS: merchant agent — grounded recommendation, approval-gated, idempotent, owner-scoped audit';
end $$;

select 'merchant AI agent loop ready' as status;
