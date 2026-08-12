-- ============================================================
-- 0029 — NOTIFICATION PLATFORM  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §42: a centralized notification service —
--   templates, channels (inapp/push/sms/email), per-device preferences, delivery
--   tracking, retries + dead-letter. INTEGRATED: a trigger enqueues an order-status
--   notification to the buyer on every meaningful transition, so notifications are
--   connected to the lifecycle, not a silo. Senders (edge fns) pull the queue and
--   mark delivery; the client reads its own + sets preferences.
-- ============================================================

-- ---------- templates (per key + channel + locale) ----------
create table if not exists notification_templates (
  key     text not null,
  channel text not null,
  locale  text not null default 'en',
  title   text,
  body    text,
  primary key (key, channel, locale)
);
insert into notification_templates(key, channel, title, body) values
  ('order_placed',  'inapp', 'Order {{order}} placed',        '{{shop}} received your order'),
  ('order_accepted','inapp', '{{shop}} is preparing',         'Your order {{order}} was accepted'),
  ('out_for_delivery','inapp','On the way',                   'Your order {{order}} is out for delivery'),
  ('delivered',     'inapp', 'Delivered',                     'Order {{order}} delivered — enjoy!'),
  ('order_rejected','inapp', 'Order could not be taken',      'Order {{order}} — any payment is refunded to your original method'),
  ('refund_issued', 'inapp', 'Refund issued',                 'Refund for order {{order}} is on its way')
on conflict (key, channel, locale) do nothing;

-- ---------- preferences (per device + channel) ----------
create table if not exists notification_prefs (
  device_key text not null,
  channel    text not null,
  enabled    boolean not null default true,
  primary key (device_key, channel)
);
alter table notification_prefs enable row level security;

-- ---------- the queue / log ----------
create table if not exists notifications (
  id           bigint generated always as identity primary key,
  device_key   text not null,
  channel      text not null default 'inapp',
  template_key text,
  title        text,
  body         text,
  url          text,
  status       text not null default 'queued',  -- queued | sent | failed | read
  attempts     int not null default 0,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists notif_device_idx on notifications(device_key, created_at desc);
create index if not exists notif_queue_idx  on notifications(channel, status) where status = 'queued';
alter table notifications enable row level security;

-- {{key}} substitution from a jsonb payload
create or replace function _notif_render(p_tmpl text, p_payload jsonb)
returns text language plpgsql immutable as $$
declare k text; v text; out text := coalesce(p_tmpl, '');
begin
  if p_payload is null then return out; end if;
  for k, v in select key, value from jsonb_each_text(p_payload) loop
    out := replace(out, '{{' || k || '}}', coalesce(v, ''));
  end loop;
  return out;
end $$;

-- enqueue: render the template per channel, respect prefs, insert. INTERNAL — called
-- by triggers / edge fns / server events, NOT the client (no anon grant → no spam).
create or replace function notify_enqueue(p_device text, p_template text, p_payload jsonb, p_channels text[], p_url text)
returns json language plpgsql security definer set search_path = public as $$
declare ch text; t record; n int := 0;
begin
  if coalesce(p_device,'') = '' then return json_build_object('ok', false, 'reason', 'no_device'); end if;
  foreach ch in array coalesce(p_channels, array['inapp']) loop
    if coalesce((select enabled from notification_prefs where device_key = p_device and channel = ch), true) then
      select title, body into t from notification_templates where key = p_template and channel = ch and locale = 'en';
      insert into notifications(device_key, channel, template_key, title, body, url)
      values (p_device, ch, p_template,
              _notif_render(coalesce(t.title, p_template), p_payload),
              _notif_render(t.body, p_payload), p_url);
      n := n + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'enqueued', n);
end $$;

-- sender (edge fn / service) pulls queued for a channel
create or replace function notify_next(p_channel text, p_limit int)
returns setof notifications language sql security definer set search_path = public stable as $$
  select * from notifications where channel = p_channel and status = 'queued'
  order by created_at asc limit least(greatest(coalesce(p_limit,20),1), 100);
$$;

-- sender marks delivery; dead-letter after 5 attempts
create or replace function notify_mark(p_id bigint, p_ok boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  update notifications
     set status  = case when p_ok then 'sent' when attempts + 1 >= 5 then 'failed' else 'queued' end,
         attempts = attempts + 1,
         sent_at  = case when p_ok then now() else sent_at end
   where id = p_id;
  return json_build_object('ok', true);
end $$;

-- client: read own inapp notifications + set prefs
create or replace function my_notifications(p_device text, p_limit int)
returns setof notifications language sql security definer set search_path = public stable as $$
  select * from notifications where device_key = p_device and channel = 'inapp'
  order by created_at desc limit least(greatest(coalesce(p_limit,30),1), 100);
$$;
grant execute on function my_notifications(text, int) to anon;

create or replace function notify_prefs_set(p_device text, p_channel text, p_enabled boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  insert into notification_prefs(device_key, channel, enabled) values (p_device, p_channel, coalesce(p_enabled,true))
  on conflict (device_key, channel) do update set enabled = excluded.enabled;
  return json_build_object('ok', true);
end $$;
grant execute on function notify_prefs_set(text, text, boolean) to anon;

-- ---------- INTEGRATION: enqueue on order status change ----------
create or replace function _notify_on_order_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tmpl text; v_shop text;
begin
  if new.status is distinct from old.status and coalesce(new.buyer_device,'') <> '' then
    v_tmpl := case new.status
      when 'prep'     then 'order_accepted'
      when 'handed'   then 'out_for_delivery'
      when 'selfout'  then 'out_for_delivery'
      when 'done'     then 'delivered'
      when 'rejected' then 'order_rejected'
      else null end;
    if v_tmpl is not null then
      perform notify_enqueue(new.buyer_device, v_tmpl,
        jsonb_build_object('order', new.id, 'shop', coalesce((select name from shops where id = new.shop_id), 'the shop')),
        array['inapp'], '#/track/' || new.id);
    end if;
  end if;
  return new;
exception when others then return new; end $$;   -- a notification must never block an order update
drop trigger if exists trg_notify_order_status on shop_orders;
create trigger trg_notify_order_status after update on shop_orders
  for each row execute function _notify_on_order_status();

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('notifydev0001'); v_dev text := 'notify_buyer01'; r json; n int;
begin
  delete from notifications where device_key = v_dev; delete from notification_prefs where device_key = v_dev;
  delete from shop_orders where id = 'NT_O1'; delete from shops where id = v_shop;
  insert into shops(id, name, category) values (v_shop, 'Notify Mart', 'grocery');

  -- placing + advancing an order enqueues connected notifications to the buyer
  insert into shop_orders(id, shop_id, buyer_device, items, total, status) values ('NT_O1', v_shop, v_dev, '[]'::jsonb, 100, 'new');
  perform shop_order_status('NT_O1', 'notifydev0001', 'prep');   -- → order_accepted
  perform shop_order_status('NT_O1', 'notifydev0001', 'done');   -- new->prep->done: prep then... need handed? no: prep->done valid → delivered
  select count(*) into n from notifications where device_key = v_dev;
  assert n >= 2, 'FAIL: order status did not enqueue notifications, got '||n;
  assert exists(select 1 from notifications where device_key=v_dev and template_key='delivered'
                and body ilike '%NT_O1%'), 'FAIL: delivered notification not rendered with order id';

  -- sender lifecycle: pull → mark sent
  r := notify_mark((select id from notifications where device_key=v_dev order by id limit 1), true);
  assert (select status from notifications where device_key=v_dev order by id limit 1) = 'sent', 'FAIL: mark sent';

  -- preferences suppress a channel
  perform notify_prefs_set(v_dev, 'sms', false);
  r := notify_enqueue(v_dev, 'delivered', jsonb_build_object('order','NT_O1'), array['sms'], null);
  assert (r->>'enqueued')::int = 0, 'FAIL: disabled channel still enqueued';

  delete from notifications where device_key = v_dev; delete from notification_prefs where device_key = v_dev;
  delete from shop_orders where id = 'NT_O1'; delete from shops where id = v_shop;
  raise notice 'PASS: templates render, order-status trigger enqueues, sender marks, prefs suppress';
end $$;

select 'notification platform ready' as status;
