-- ============================================================
-- 0031 — SUBSCRIPTIONS (recurring commerce)  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §48: recurring groceries/services — billing cycle,
--   pause/resume/cancel, due-run, idempotent order creation. INTEGRATED: a due run
--   creates a real shop_order (connected to the order + notification pipeline). Owner-
--   scoped (device). Prepaid retry-on-failure is noted for Phase 7 (needs saved
--   payment method); today a run places the order like any other (pay on delivery /
--   the app's normal checkout on first setup).
-- ============================================================
create table if not exists subscriptions (
  id           text primary key,
  device_key   text not null,
  shop_id      text not null,
  items        jsonb not null,
  total        numeric,
  interval_days int not null check (interval_days between 1 and 365),
  next_run     date not null,
  status       text not null default 'active',   -- active | paused | cancelled
  runs         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sub_device_idx on subscriptions(device_key, created_at desc);
create index if not exists sub_due_idx on subscriptions(next_run) where status = 'active';
alter table subscriptions enable row level security;

create or replace function subscription_create(p_device text, p_shop text, p_items jsonb, p_total numeric, p_interval_days int, p_start date)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if coalesce(p_device,'')='' or coalesce(p_shop,'')='' then return json_build_object('ok', false, 'reason', 'missing'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then return json_build_object('ok', false, 'reason', 'no_items'); end if;
  v_id := 'sub_' || substr(md5(p_device || p_shop || (p_items)::text || clock_timestamp()::text), 1, 16);
  insert into subscriptions(id, device_key, shop_id, items, total, interval_days, next_run)
  values (v_id, p_device, p_shop, p_items, p_total,
          greatest(least(coalesce(p_interval_days,7),365),1),
          coalesce(p_start, (now() at time zone 'Asia/Kolkata')::date));
  return json_build_object('ok', true, 'id', v_id, 'next_run', (select next_run from subscriptions where id=v_id));
end $$;
grant execute on function subscription_create(text, text, jsonb, numeric, int, date) to anon;

-- pause / resume / cancel — device-scoped
create or replace function subscription_set(p_device text, p_sub text, p_action text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner text; v_new text;
begin
  select device_key into v_owner from subscriptions where id = p_sub;
  if v_owner is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_owner <> p_device then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  v_new := case p_action when 'pause' then 'paused' when 'resume' then 'active' when 'cancel' then 'cancelled' else null end;
  if v_new is null then return json_build_object('ok', false, 'reason', 'bad_action'); end if;
  update subscriptions set status = v_new, updated_at = now() where id = p_sub and status <> 'cancelled';
  return json_build_object('ok', found, 'status', v_new);
end $$;
grant execute on function subscription_set(text, text, text) to anon;

-- worker: which subscriptions are due today (service/cron — not anon)
create or replace function subscriptions_due()
returns setof subscriptions language sql security definer set search_path = public stable as $$
  select * from subscriptions where status = 'active' and next_run <= (now() at time zone 'Asia/Kolkata')::date
  order by next_run asc limit 500;
$$;

-- run one due subscription: create its order (idempotent per cycle) + advance next_run
create or replace function subscription_run(p_sub text)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v_oid text; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into s from subscriptions where id = p_sub for update;
  if s.id is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.status <> 'active' then return json_build_object('ok', false, 'reason', 'not_active'); end if;
  if s.next_run > v_today then return json_build_object('ok', false, 'reason', 'not_due', 'next_run', s.next_run); end if;

  v_oid := 'SUB' || substr(replace(s.id,'sub_',''),1,10) || to_char(s.next_run,'YYYYMMDD');   -- one order per cycle
  insert into shop_orders(id, shop_id, buyer_device, items, total, status)
  values (v_oid, s.shop_id, s.device_key, s.items, coalesce(s.total,0), 'new')
  on conflict (id) do nothing;                       -- idempotent: a re-run for the same cycle won't duplicate

  update subscriptions set next_run = s.next_run + s.interval_days, runs = runs + 1, updated_at = now() where id = p_sub;
  return json_build_object('ok', true, 'order', v_oid, 'next_run', s.next_run + s.interval_days);
end $$;

create or replace function my_subscriptions(p_device text)
returns setof subscriptions language sql security definer set search_path = public stable as $$
  select * from subscriptions where device_key = p_device and status <> 'cancelled' order by created_at desc limit 30;
$$;
grant execute on function my_subscriptions(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('subdev0000001'); v_dev text := 'sub_buyer_001'; r json; v_sub text; v_next date;
begin
  delete from shop_orders where id like 'SUB%'; delete from subscriptions where device_key = v_dev; delete from shops where id = v_shop;
  insert into shops(id,name,category) values (v_shop,'Sub Mart','grocery');

  -- create a weekly subscription starting today
  r := subscription_create(v_dev, v_shop, '[{"name":"Milk","qty":1}]'::jsonb, 30, 7, (now() at time zone 'Asia/Kolkata')::date);
  assert (r->>'ok')='true', 'FAIL: create'; v_sub := r->>'id';

  -- due today → run creates an order and advances next_run +7
  assert exists(select 1 from subscriptions_due() d where d.id = v_sub), 'FAIL: not due today';
  r := subscription_run(v_sub);
  assert (r->>'ok')='true', 'FAIL: run';
  assert (select count(*) from shop_orders where buyer_device = v_dev) = 1, 'FAIL: run did not create an order';
  select next_run into v_next from subscriptions where id = v_sub;
  assert v_next = (now() at time zone 'Asia/Kolkata')::date + 7, 'FAIL: next_run not advanced +7';
  assert (select runs from subscriptions where id = v_sub) = 1, 'FAIL: runs != 1';

  -- running again now → not due (idempotent; no duplicate order)
  r := subscription_run(v_sub);
  assert (r->>'ok')='false' and (r->>'reason')='not_due', 'FAIL: ran before due';
  assert (select count(*) from shop_orders where buyer_device = v_dev) = 1, 'FAIL: duplicate order created';

  -- pause removes it from due; a stranger cannot touch it
  assert (subscription_set('stranger', v_sub, 'pause')->>'ok')='false', 'FAIL: stranger paused';
  assert (subscription_set(v_dev, v_sub, 'pause')->>'ok')='true', 'FAIL: pause';
  assert not exists(select 1 from subscriptions_due() d where d.id = v_sub), 'FAIL: paused sub still due';
  assert (subscription_set(v_dev, v_sub, 'resume')->>'ok')='true', 'FAIL: resume';

  delete from shop_orders where id like 'SUB%'; delete from subscriptions where device_key = v_dev; delete from shops where id = v_shop;
  raise notice 'PASS: subscriptions — create, due-run creates order + advances cycle, idempotent, pause/resume, owner-scoped';
end $$;

select 'subscriptions ready' as status;
