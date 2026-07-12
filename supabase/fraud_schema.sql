-- ============================================================
-- REAL FRAUD DETECTION — replaces the admin panel's demo flags.
-- Risk signals are COMPUTED LIVE from real data: many accounts on one
-- device, failed-payment bursts, price outliers vs learned bounds, and
-- cancellation abuse. Reviewed signals can be dismissed. L4+ only.
-- ============================================================
create table if not exists fraud_dismissed (
  sig text primary key,
  by  text,
  at  timestamptz default now()
);
alter table fraud_dismissed enable row level security;

create or replace function fraud_signals(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,'flags', (
    select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
      select * from (
        -- many accounts created on a single device (fake-account farming)
        select 'high' level, 'multi_account' kind,
               (count(distinct ident) || ' accounts on one device') what,
               ('device ' || left(device_key,10)) who,
               ('multi_account|' || device_key) sig
        from auth_sessions where coalesce(device_key,'') <> '' group by device_key having count(distinct ident) >= 3

        union all
        -- repeated failed / errored payments from one device (card testing)
        select 'med', 'payment_fail',
               (count(*) || ' failed payments'), ('device ' || left(device_key,10)),
               ('payment_fail|' || device_key)
        from payments where status in ('failed','error') and coalesce(device_key,'') <> ''
        group by device_key having count(*) >= 3

        union all
        -- item priced far outside the learned price band (counterfeit / bait)
        select 'med', 'price_outlier',
               (i.name || ' @ ' || i.price::text || ' vs band ' || b.min_price || '-' || b.max_price),
               ('shop ' || left(i.shop_id,10)),
               ('price_outlier|' || i.id)
        from shop_items i join price_bounds b on b.key = lower(trim(i.name))
        where b.samples >= 3 and i.price > 0 and (i.price > b.max_price * 1.8 or i.price < b.min_price * 0.4)

        union all
        -- cancellation abuse from one buyer device
        select 'high', 'many_cancels',
               (count(*) || ' cancellations'), ('device ' || left(buyer_device,10)),
               ('many_cancels|' || buyer_device)
        from shop_orders where status = 'cancelled' and coalesce(buyer_device,'') <> ''
        group by buyer_device having count(*) >= 3
      ) s
      where s.sig not in (select sig from fraud_dismissed)
      order by case s.level when 'high' then 0 when 'med' then 1 else 2 end
      limit 60
    ) t
  ));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function fraud_dismiss(p_token text, p_sig text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  insert into fraud_dismissed(sig, by) values (left(p_sig,200), (select ident from auth_sessions where token=p_token))
    on conflict (sig) do nothing;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function fraud_signals(text) to anon;
grant execute on function fraud_dismiss(text,text) to anon;

select 'fraud detection ready' as status;
