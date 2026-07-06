-- ============================================================
-- ORIGNALS COMMUNITY — the last cross-device loops
--  1. reservations : dining bookings land on the restaurant's device
--  2. listings + listing_leads : property enquiries reach the lister
--  3. ref_codes + referrals : referral credit works across devices
-- ============================================================

-- 1 ── dining reservations ─────────────────────────────────
create table if not exists reservations (
  id text primary key,
  created_at timestamptz not null default now(),
  shop_id text not null,
  buyer_device text not null,
  buyer_name text,
  day text, slot text, guests int,
  status text not null default 'reserved'
);
create index if not exists reservations_shop_idx on reservations (shop_id, created_at desc);
alter table reservations enable row level security;
drop policy if exists rz_read on reservations;   create policy rz_read on reservations for select using (true);
drop policy if exists rz_insert on reservations; create policy rz_insert on reservations for insert with check (true);

create or replace function reservation_cancel(p_id text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update reservations set status = 'cancelled'
   where id = p_id and buyer_device = p_device and status = 'reserved';
  return found;
end $$;
grant execute on function reservation_cancel(text, text) to anon;

-- 2 ── property listings + leads ───────────────────────────
create table if not exists listings (
  id text primary key,
  created_at timestamptz not null default now(),
  owner_device text not null,
  kind text, title text, loc text, price numeric, area text, bhk text,
  lat double precision, lng double precision,
  status text not null default 'live'
);
create index if not exists listings_live_idx on listings (status, created_at desc);
alter table listings enable row level security;
drop policy if exists ls_read on listings;   create policy ls_read on listings for select using (true);
drop policy if exists ls_write on listings;  create policy ls_write on listings for insert with check (true);
drop policy if exists ls_upd on listings;    create policy ls_upd on listings for update using (true);

create table if not exists listing_leads (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  listing_id text not null,
  owner_device text not null,
  from_device text,
  kind text,            -- contact | visit
  name text, note text,
  seen boolean not null default false
);
create index if not exists leads_owner_idx on listing_leads (owner_device, created_at desc);
alter table listing_leads enable row level security;
drop policy if exists ld_read on listing_leads;   create policy ld_read on listing_leads for select using (true);
drop policy if exists ld_insert on listing_leads; create policy ld_insert on listing_leads for insert with check (true);

-- 3 ── referrals across devices ────────────────────────────
create table if not exists ref_codes (
  code text primary key,
  owner_device text not null,
  created_at timestamptz not null default now()
);
alter table ref_codes enable row level security;
drop policy if exists rc_read on ref_codes;   create policy rc_read on ref_codes for select using (true);
drop policy if exists rc_write on ref_codes;  create policy rc_write on ref_codes for insert with check (true);

create table if not exists referrals (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  code text not null,
  new_device text unique not null,
  credited_owner boolean not null default false
);
alter table referrals enable row level security;
drop policy if exists rf_read on referrals; create policy rf_read on referrals for select using (true);

-- register / update a device's own referral code
create or replace function ref_register(p_code text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into ref_codes (code, owner_device) values (p_code, p_device)
  on conflict (code) do update set owner_device = excluded.owner_device;
end $$;

-- a new user redeems a friend's code (credits the friend + themselves)
create or replace function redeem_ref(p_code text, p_device text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner text;
begin
  select owner_device into v_owner from ref_codes where code = p_code;
  if v_owner is null then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if v_owner = p_device then return json_build_object('ok', false, 'reason', 'self'); end if;
  insert into referrals (code, new_device) values (p_code, p_device)
    on conflict (new_device) do nothing;
  if not found then return json_build_object('ok', false, 'reason', 'used'); end if;
  return json_build_object('ok', true);
end $$;

-- owner claims pending ₹50 credits (atomic; returns how many)
create or replace function claim_ref_credits(p_device text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with mine as (
    update referrals set credited_owner = true
     where credited_owner = false
       and code in (select code from ref_codes where owner_device = p_device)
    returning 1
  ) select count(*) into n from mine;
  return coalesce(n, 0);
end $$;

grant execute on function ref_register(text, text) to anon;
grant execute on function redeem_ref(text, text) to anon;
grant execute on function claim_ref_credits(text) to anon;

select 'community loops ready' as status;
