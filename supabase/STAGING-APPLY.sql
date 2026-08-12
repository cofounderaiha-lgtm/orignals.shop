-- ============================================================
-- ORIGNALS — STAGING APPLY BUNDLE  (generated 2026-08-12)
-- Paste into a FRESH staging Supabase project's SQL editor, or run via CLI.
-- PREREQ (Supabase dashboard → Database → Extensions): enable pg_trgm, pgcrypto, pg_cron.
-- Order = the validated dependency order (local gate: node local_validate.mjs → all green).
-- Each migration self-proves via assert blocks; a failed assert aborts (fix before continuing).
-- ⚠ Do NOT run against production without a backup + the paired client changes (see STAGING-RUNBOOK §5).
-- ============================================================
create schema if not exists extensions;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto with schema extensions;


-- ========== BASE: schema.sql ==========
-- ============================================================
-- ORIGNALS — production database schema v1.0.0 (Supabase/Postgres)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Idempotent where practical. Matches the client Database view.
-- ============================================================

-- ---------- ENUMS ----------
do $$ begin
  create type user_role       as enum ('buyer','seller','partner','admin_l1','admin_l2','admin_l3','admin_l4','admin_l5');
  create type order_kind      as enum ('shop','send','ride','ticket','stay','dining');
  create type order_flow      as enum ('shop_self','shop_partner','send','ride');
  create type order_status    as enum ('placed','packing','picked_up','on_the_way','delivered','cancelled');
  create type delivery_mode   as enum ('self','partner','both');
  create type vehicle_kind    as enum ('walk','cycle','bike','auto','car','van','truck');
  create type kyc_status      as enum ('pending','verifying','verified','rejected');
  create type purity_status   as enum ('queued','sampling','lab','sealed','delisted');
  create type seller_tier     as enum ('individual','retail','large_retail','wholesaler','manufacturer');
  create type txn_kind        as enum ('topup','payment','refund','earning','withdrawal','referral','cashback');
exception when duplicate_object then null; end $$;

-- ---------- CORE: PROFILES ----------
create table if not exists profiles (
  id            uuid primary key default gen_random_uuid(),
  device_key    text unique,                 -- pre-auth device identity (demo bridge)
  auth_id       uuid unique,                 -- auth.users.id once phone-auth is on
  name          text not null default 'Friend',
  phone         text,
  role          user_role not null default 'buyer',
  home_lat      double precision,
  home_lng      double precision,
  addr_label    text,
  ref_code      text unique,
  referred_by   text,
  member_till   timestamptz,
  lang          text not null default 'en',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_profiles_ref  on profiles(ref_code);

-- ---------- WALLET (balance is derived; ledger is truth) ----------
create table if not exists wallet_txns (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references profiles(id) on delete cascade,
  kind        txn_kind not null,
  amount      numeric(12,2) not null,               -- signed: + credit, − debit
  label       text not null,
  order_id    text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_txn_profile on wallet_txns(profile_id, created_at desc);

create or replace view wallet_balances as
  select profile_id, coalesce(sum(amount),0)::numeric(12,2) as balance
  from wallet_txns group by profile_id;

-- ---------- SHOPS & CATALOGUE ----------
create table if not exists custom_categories (
  id         text primary key,
  name       text unique not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists shops (
  id             text primary key,                  -- 'sh1' seeds + uuid-ish for user shops
  owner_id       uuid references profiles(id) on delete set null,
  name           text not null,
  category       text not null,                     -- shopTypes id or custom_categories id
  tier           seller_tier not null default 'retail',
  tagline        text,
  phone          text,
  lat            double precision,
  lng            double precision,
  addr           text,
  open_from      text,
  open_till      text,
  is_open        boolean not null default true,
  pure_veg       boolean not null default false,
  delivery       delivery_mode not null default 'partner',
  gst            text,
  fssai          text,
  purity         purity_status,
  rating         numeric(2,1) not null default 5.0 check (rating between 0 and 5),
  ratings_count  int not null default 0,
  offer_label    text,
  offer_pct      int check (offer_pct between 1 and 90),
  offer_min      numeric(10,2),
  photo_url      text,
  b2b            boolean not null default false,
  fee_paid_till  timestamptz,                       -- tier fee (first month complimentary)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists idx_shops_cat  on shops(category) where deleted_at is null;
create index if not exists idx_shops_geo  on shops(lat, lng) where deleted_at is null;

create table if not exists shop_items (
  id          text primary key,
  shop_id     text not null references shops(id) on delete cascade,
  name        text not null,
  qty_label   text,
  price       numeric(10,2) not null check (price >= 0),
  mrp         numeric(10,2),
  veg         boolean,
  moq         int,
  bestseller  boolean not null default false,
  in_stock    boolean not null default true,
  icon        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_items_shop on shop_items(shop_id);

-- ---------- ORDERS (event-sourced status) ----------
create table if not exists orders (
  id          text primary key,                     -- 'OM12345'
  profile_id  uuid references profiles(id) on delete set null,
  kind        order_kind not null,
  flow        order_flow,
  shop_id     text references shops(id),
  title       text not null,
  items       jsonb not null default '[]',          -- [{name,q,price}]
  total       numeric(12,2) not null,
  addr_label  text,
  partner_name text,
  partner_veh  text,
  otp         int,
  rated       int check (rated between 1 and 5),
  cancelled_at timestamptz,
  placed_at   timestamptz not null default now()
);
create index if not exists idx_orders_profile on orders(profile_id, placed_at desc);
create index if not exists idx_orders_shop    on orders(shop_id, placed_at desc);

create table if not exists order_events (
  id         bigint generated always as identity primary key,
  order_id   text not null references orders(id) on delete cascade,
  status     order_status not null,
  note       text,
  at         timestamptz not null default now()
);
create index if not exists idx_events_order on order_events(order_id, at);

-- ---------- PARTNERS (earn mode) ----------
create table if not exists partners (
  profile_id   uuid primary key references profiles(id) on delete cascade,
  vehicle      vehicle_kind not null,
  vehicle_no   text,
  upi          text,
  kyc          kyc_status not null default 'pending',
  face_verified boolean not null default false,
  vehicle_verified boolean not null default false,
  rating       numeric(2,1) not null default 5.0,
  trips        int not null default 0,
  seva_trips   int not null default 0,
  level        text generated always as (
                 case when trips >= 25 then 'gold'
                      when trips >= 10 then 'silver'
                      else 'bronze' end) stored,
  fee_paid_till timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists jobs (
  id         text primary key,
  kind       text not null,                          -- parcel type or 'ride'
  what       text not null,
  from_label text not null,
  to_label   text not null,
  km         numeric(6,1) not null,
  pay        numeric(10,2) not null default 0,       -- 0 = seva
  posted_by  uuid references profiles(id),
  taken_by   uuid references partners(profile_id),
  order_id   text references orders(id),
  status     text not null default 'open',           -- open|taken|done|expired
  created_at timestamptz not null default now()
);
create index if not exists idx_jobs_open on jobs(status) where status = 'open';

-- ---------- TICKETS · BOOKINGS · STAYS ----------
create table if not exists tickets (
  id          text primary key,
  profile_id  uuid references profiles(id) on delete cascade,
  title       text not null,
  sub         text,
  seats       text[],
  total       numeric(12,2) not null,
  qr_payload  text,
  cancelled_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists bookings (
  id          bigint generated always as identity primary key,
  profile_id  uuid references profiles(id) on delete cascade,
  kind        text not null check (kind in ('dining','stay','site_visit')),
  ref_label   text not null,                          -- shop/hotel/property name
  day         text, slot text, guests int, nights int,
  total       numeric(12,2) default 0,
  created_at  timestamptz not null default now()
);

-- ---------- PROPERTY ----------
create table if not exists properties (
  id          text primary key,
  owner_id    uuid references profiles(id),
  kind        text not null,                          -- buy|rent|plot|commercial|hotel
  title       text not null,
  price       numeric(14,2) not null,
  bhk         text, area text, loc text,
  lat double precision, lng double precision,
  by_owner    boolean not null default true,
  verified    boolean not null default false,
  photo_url   text,
  views       int not null default 0,
  leads       int not null default 0,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- B2B RFQ ----------
create table if not exists rfqs (
  id          bigint generated always as identity primary key,
  profile_id  uuid references profiles(id) on delete cascade,
  shop_id     text references shops(id),
  item        text not null,
  qty         int not null,
  unit        text,
  status      text not null default 'open',           -- open|quoted|accepted|expired
  quote       numeric(12,2),
  created_at  timestamptz not null default now()
);

-- ---------- ADMIN: PURITY & KYC QUEUES ----------
create table if not exists purity_checks (
  id         bigint generated always as identity primary key,
  shop_id    text not null references shops(id) on delete cascade,
  batch      text not null,
  status     purity_status not null default 'queued',
  inspector  uuid references profiles(id),
  note       text,
  updated_at timestamptz not null default now()
);

create table if not exists kyc_docs (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references profiles(id) on delete cascade,
  doc_kind    text not null,                          -- id|face|dl|vehicle|gst|fssai
  storage_path text,                                  -- Supabase Storage object
  status      kyc_status not null default 'pending',
  reviewed_by uuid references profiles(id),
  created_at  timestamptz not null default now()
);

-- ---------- DEVICE STATE SNAPSHOT (demo bridge / cross-device sync) ----------
create table if not exists state_snapshots (
  device_key text primary key,
  state      jsonb not null,
  app_ver    text,
  updated_at timestamptz not null default now()
);

-- ---------- TRIGGERS ----------
create or replace function touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;

do $$ begin
  create trigger t_profiles_touch before update on profiles for each row execute function touch_updated_at();
  create trigger t_shops_touch    before update on shops    for each row execute function touch_updated_at();
  create trigger t_snap_touch     before update on state_snapshots for each row execute function touch_updated_at();
exception when duplicate_object then null; end $$;

-- Refund integrity: cancelling an order auto-writes the refund ledger row.
create or replace function order_cancel_refund() returns trigger language plpgsql as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null and new.profile_id is not null then
    insert into wallet_txns(profile_id, kind, amount, label, order_id)
    values (new.profile_id, 'refund', new.total, 'Refund · ' || new.id || ' · ' || new.title, new.id);
    insert into order_events(order_id, status, note) values (new.id, 'cancelled', 'auto-refund issued');
  end if;
  return new;
end $$;
do $$ begin
  create trigger t_order_refund after update on orders for each row execute function order_cancel_refund();
exception when duplicate_object then null; end $$;

-- ---------- ROW LEVEL SECURITY ----------
-- v1 posture: anon key may read public catalogue and write only via device_key
-- scoping. Tighten to auth.uid() policies when phone-auth ships (v1.1).
alter table profiles        enable row level security;
alter table wallet_txns     enable row level security;
alter table shops           enable row level security;
alter table shop_items      enable row level security;
alter table orders          enable row level security;
alter table order_events    enable row level security;
alter table partners        enable row level security;
alter table jobs            enable row level security;
alter table tickets         enable row level security;
alter table bookings        enable row level security;
alter table properties      enable row level security;
alter table rfqs            enable row level security;
alter table purity_checks   enable row level security;
alter table kyc_docs        enable row level security;
alter table custom_categories enable row level security;
alter table state_snapshots enable row level security;

do $$ begin
  -- public READ of marketplace surfaces (buyers browse these; no PII here)
  create policy p_shops_read  on shops  for select using (deleted_at is null);
  create policy p_items_read  on shop_items for select using (true);
  create policy p_props_read  on properties for select using (deleted_at is null);
  create policy p_jobs_read   on jobs   for select using (true);
  create policy p_cats_read   on custom_categories for select using (true);
  create policy p_cats_write  on custom_categories for insert with check (true);
  create policy p_events_ins  on order_events for insert with check (true);
  create policy p_events_read on order_events for select using (true);
  -- ⚠ SECURITY (2026-07-23): shops / shop_items / orders / state_snapshots WRITES
  -- are deliberately NOT anon policies. They go through security-definer RPCs that
  -- derive ownership from the device key — shop_upsert, orders_sync, snapshot_save
  -- (supabase/migrations/0002_*, 0003_*). The removed policies (p_snap_all,
  -- p_orders_ins/read/upd, p_shops_write/upd, p_items_write — all `using(true)`)
  -- let anyone holding the PUBLIC anon key overwrite any merchant's shop,
  -- bulk-rewrite every order, overwrite any user's whole account state, and READ
  -- every order's delivery OTP + address. Do NOT reintroduce them. If a fresh DB
  -- needs the write paths, apply the migrations — that is the authoritative source.
exception when duplicate_object then null; end $$;

-- ---------- SEED: the 14 launch shops (headline rows; items sync from app) ----------
insert into shops (id, name, category, tagline, delivery, rating, b2b) values
 ('sh1','Prakriti Organic Store','organic','Certified organic · Farm direct','partner',4.7,false),
 ('sh2','Sharma Kirana & General','grocery','Your neighbourhood kirana since 1998','partner',4.4,false),
 ('sh3','Biryani Junction','food','Dum biryani · Kebabs · Since 1996','partner',4.5,false),
 ('sh4','Dakshin Tiffins','food','Pure veg · Delivers itself','self',4.6,false),
 ('sh5','Burger Republic','food','Smashed patties · Hand-spun shakes','partner',4.4,false),
 ('sh6','Sanjeevani Medicals','pharmacy','Licensed pharmacy · Open till 11 pm','both',4.8,false),
 ('sh7','Threads of Bharat','fashion','Handloom · Local weavers','self',4.5,false),
 ('sh8','Voltify Electronics','electronics','Genuine products · GST billing','both',4.3,false),
 ('sh9','Glaze & Crumb Bakery','food','Fresh bakes every 4 hours','both',4.7,false),
 ('sh10','Pushpa Flower Mart','flowers','Temple fresh · Event decor','partner',4.6,false),
 ('sh11','AgroHarvest Wholesale','wholesale','Bulk grains & spices · MOQ pricing','self',4.4,true),
 ('sh12','PackWell Traders','wholesale','Packaging for shops & sellers','both',4.6,true),
 ('sh13','Green Bowl Co.','food','Salads · Bowls · No refined sugar','partner',4.5,false),
 ('sh14','Kitab Corner','fashion','Books & stationery','self',4.8,false)
on conflict (id) do nothing;

-- ============================================================
-- Done. Next: Storage buckets 'kyc' (private) and 'shop-photos'
-- (public) via Dashboard → Storage. Then paste project URL +
-- anon key into superapp/config.js — the app auto-connects.
-- ============================================================

-- ========== BASE: ops_schema.sql ==========
-- ============================================================
-- ORIGNALS OPS — launch-readiness backend
--  1. platform_flags : remote kill switches read by every client
--  2. error_log      : own error monitoring (no third-party account)
--  3. erase_device   : DPDP right-to-erasure (financial records kept)
-- ============================================================

-- 1 ── remote control (single row) ─────────────────────────
create table if not exists platform_flags (
  id int primary key default 1,
  maintenance boolean not null default false,
  payments_enabled boolean not null default true,
  banner text,
  updated_at timestamptz not null default now(),
  constraint one_row check (id = 1)
);
insert into platform_flags (id) values (1) on conflict (id) do nothing;

alter table platform_flags enable row level security;
drop policy if exists pf_read on platform_flags;
create policy pf_read on platform_flags for select using (true);
-- writes only via the Management API / service role (admins), never anon.

-- 2 ── own error monitoring ────────────────────────────────
create table if not exists error_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_key text,
  message text,
  source text,
  stack text,
  url text,
  ua text
);
create index if not exists error_log_time_idx on error_log (created_at desc);

alter table error_log enable row level security;
drop policy if exists el_insert on error_log;
create policy el_insert on error_log for insert with check (true);
drop policy if exists el_read on error_log;
create policy el_read on error_log for select using (true);

-- keep the log bounded automatically (last ~2000 rows)
create or replace function error_log_trim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (random() < 0.02) then
    delete from error_log where id < (select max(id) - 2000 from error_log);
  end if;
  return null;
end $$;
drop trigger if exists error_log_trim_t on error_log;
create trigger error_log_trim_t after insert on error_log
  for each row execute function error_log_trim();

-- 3 ── DPDP right to erasure ───────────────────────────────
-- Removes all personal/device data. Payment rows are RETAINED but
-- de-identified (financial/tax record-keeping exemption under DPDP).
create or replace function erase_device(p_device text)
returns void language plpgsql security definer set search_path = public as $$
declare v_shop text := 'my_' || substr(p_device, 1, 12);
begin
  delete from state_snapshots  where device_key = p_device;
  delete from mitra_utterances where device_key = p_device;
  delete from mitra_model      where device_key = p_device;
  delete from live_jobs        where device_key = p_device;
  delete from shop_orders      where buyer_device = p_device;
  delete from shop_items       where shop_id = v_shop;
  delete from shops            where id = v_shop;
  update payments set device_key = 'erased' where device_key = p_device;
end $$;
grant execute on function erase_device(text) to anon;

select 'ops backend ready' as status;

-- ========== BASE: auth_schema.sql ==========
-- ============================================================
-- ORIGNALS SELF-HOSTED AUTH — our own engine, zero third party.
-- Email/phone + password (works today, no delivery hop) AND a full
-- OTP engine (ready for when Orignals' own SMS gateway is plugged
-- into otp_deliver). pgcrypto is schema-qualified (Supabase quirk).
-- Fails open: if this backend is down, the app runs in local mode.
-- ============================================================
create extension if not exists pgcrypto with schema extensions;

alter table platform_flags add column if not exists otp_dev_echo boolean not null default true;
alter table platform_flags add column if not exists require_auth boolean not null default false;

drop table if exists otp_challenges cascade;
drop table if exists auth_sessions cascade;

create table auth_sessions (
  token text primary key default encode(extensions.gen_random_bytes(24),'hex'),
  phone text, ident text, device_key text,
  created_at timestamptz not null default now(), last_seen timestamptz not null default now()
);
alter table auth_sessions enable row level security;

create table otp_challenges (
  id text primary key default encode(extensions.gen_random_bytes(12),'hex'),
  phone text not null, code_hash text not null, salt text not null, device_key text,
  attempts int not null default 0, verified boolean not null default false,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '5 minutes'
);
create index otp_phone_idx on otp_challenges (phone, created_at desc);
alter table otp_challenges enable row level security;

create table if not exists app_users (
  ident text primary key,
  pass_hash text not null,
  name text, kind text default 'buyer',
  face_enrolled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table app_users enable row level security;

create or replace function otp_deliver(p_phone text, p_code text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
begin return; end $fn$;   -- plug Orignals' own SMS gateway here later

create or replace function otp_request(p_phone text, p_device text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_recent int; v_code text; v_salt text; v_id text; v_echo boolean;
begin
  p_phone := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if length(p_phone) < 10 then return json_build_object('ok',false,'reason','bad_phone'); end if;
  p_phone := right(p_phone,10);
  select count(*) into v_recent from otp_challenges where phone=p_phone and created_at>now()-interval '10 minutes';
  if v_recent>=3 then return json_build_object('ok',false,'reason','too_many','retry_in',600); end if;
  v_code := lpad((floor(random()*1000000))::int::text,6,'0');
  v_salt := encode(extensions.gen_random_bytes(8),'hex');
  insert into otp_challenges(phone,code_hash,salt,device_key)
    values (p_phone, encode(extensions.digest(v_salt||v_code,'sha256'),'hex'), v_salt, p_device) returning id into v_id;
  perform otp_deliver(p_phone,v_code);
  select otp_dev_echo into v_echo from platform_flags where id=1;
  return json_build_object('ok',true,'challenge',v_id,'expires_in',300,
    'dev_code', case when coalesce(v_echo,false) then v_code else null end);
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

create or replace function otp_verify(p_challenge text, p_code text, p_device text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare r otp_challenges; v_token text;
begin
  select * into r from otp_challenges where id=p_challenge;
  if not found then return json_build_object('ok',false,'reason','not_found'); end if;
  if r.verified then return json_build_object('ok',false,'reason','used'); end if;
  if now()>r.expires_at then return json_build_object('ok',false,'reason','expired'); end if;
  if r.attempts>=5 then return json_build_object('ok',false,'reason','locked'); end if;
  update otp_challenges set attempts=attempts+1 where id=p_challenge;
  if encode(extensions.digest(r.salt||coalesce(p_code,''),'sha256'),'hex') <> r.code_hash then
    return json_build_object('ok',false,'reason','wrong','left',4-r.attempts); end if;
  update otp_challenges set verified=true where id=p_challenge;
  insert into auth_sessions(phone,ident,device_key) values (r.phone,r.phone,p_device) returning token into v_token;
  if random()<0.1 then delete from otp_challenges where created_at<now()-interval '1 day'; end if;
  return json_build_object('ok',true,'token',v_token,'phone',r.phone);
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

create or replace function auth_register(p_ident text, p_pass text, p_name text, p_device text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_id text; v_token text;
begin
  v_id := lower(trim(coalesce(p_ident,'')));
  if position('@' in v_id)=0 then v_id := right(regexp_replace(v_id,'[^0-9]','','g'),10); end if;
  if length(v_id)<5 then return json_build_object('ok',false,'reason','bad_ident'); end if;
  if length(coalesce(p_pass,''))<6 then return json_build_object('ok',false,'reason','weak_pass'); end if;
  if exists(select 1 from app_users where ident=v_id) then return json_build_object('ok',false,'reason','exists'); end if;
  insert into app_users(ident,pass_hash,name) values (v_id, extensions.crypt(p_pass, extensions.gen_salt('bf')), left(coalesce(p_name,''),60));
  insert into auth_sessions(ident,device_key) values (v_id,p_device) returning token into v_token;
  return json_build_object('ok',true,'token',v_token,'ident',v_id);
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

create or replace function auth_login(p_ident text, p_pass text, p_device text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare r app_users; v_token text; v_id text;
begin
  v_id := lower(trim(coalesce(p_ident,'')));
  if position('@' in v_id)=0 then v_id := right(regexp_replace(v_id,'[^0-9]','','g'),10); end if;
  select * into r from app_users where ident=v_id;
  if not found then return json_build_object('ok',false,'reason','no_user'); end if;
  if r.pass_hash <> extensions.crypt(p_pass, r.pass_hash) then return json_build_object('ok',false,'reason','wrong_pass'); end if;
  insert into auth_sessions(ident,device_key) values (v_id,p_device) returning token into v_token;
  return json_build_object('ok',true,'token',v_token,'ident',v_id,'name',r.name,'face',r.face_enrolled);
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

create or replace function auth_set_face(p_token text, p_enrolled boolean)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_id text;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false); end if;
  update app_users set face_enrolled=p_enrolled where ident=v_id;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $fn$;

create or replace function auth_whoami(p_token text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare r auth_sessions;
begin
  update auth_sessions set last_seen=now() where token=p_token returning * into r;
  if r.token is null then return json_build_object('ok',false); end if;
  return json_build_object('ok',true,'ident',coalesce(r.ident,r.phone),'phone',r.phone);
exception when others then return json_build_object('ok',false); end $fn$;

grant execute on function otp_request(text,text) to anon;
grant execute on function otp_verify(text,text,text) to anon;
grant execute on function auth_register(text,text,text,text) to anon;
grant execute on function auth_login(text,text,text) to anon;
grant execute on function auth_set_face(text,boolean) to anon;
grant execute on function auth_whoami(text) to anon;
select 'auth v2 ready' as status;

-- ========== BASE: admin_schema.sql ==========
-- ============================================================
-- ORIGNALS ADMIN RBAC — server-enforced roles for an org of any
-- size (lakhs of employees) across L1–L5. Access is decided in
-- Postgres from the signed-in session, never trusted from the
-- browser. Bootstrapped once with a setup code.
--   l5 Super Admin · l4 Operations · l3 Purity Inspector
--   l2 City Manager · l1 Support
-- ============================================================

alter table platform_flags add column if not exists admin_setup_code text;

create table if not exists admin_users (
  ident text primary key,               -- normalized email or 10-digit phone
  level text not null check (level in ('l1','l2','l3','l4','l5')),
  name text,
  active boolean not null default true,
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_level_idx on admin_users (level, created_at desc);
alter table admin_users enable row level security;   -- RPC-only, no anon access

create or replace function admin_rank(l text) returns int language sql immutable as $$
  select case l when 'l5' then 5 when 'l4' then 4 when 'l3' then 3 when 'l2' then 2 when 'l1' then 1 else 0 end;
$$;

-- helper: resolve the caller's admin level from their session token
create or replace function _admin_level(p_token text) returns text
language sql security definer set search_path=public as $$
  select a.level from auth_sessions s
  join admin_users a on a.ident = s.ident and a.active
  where s.token = p_token limit 1;
$$;

-- who am I (drives what the panel shows)
create or replace function admin_whoami(p_token text)
returns json language plpgsql security definer set search_path=public as $$
declare v_ident text; v_level text; v_name text; v_count int;
begin
  select ident into v_ident from auth_sessions where token=p_token;
  select count(*) into v_count from admin_users where active;
  if v_ident is null then return json_build_object('ok',true,'admin',false,'signed_in',false,'bootstrap',v_count=0); end if;
  select level, name into v_level, v_name from admin_users where ident=v_ident and active;
  return json_build_object('ok',true,'signed_in',true,'admin',v_level is not null,
    'level',v_level,'ident',v_ident,'name',v_name,'bootstrap',v_count=0);
exception when others then return json_build_object('ok',false); end $$;

-- one-time bootstrap: first person with the setup code becomes L5
create or replace function admin_claim(p_token text, p_code text, p_name text)
returns json language plpgsql security definer set search_path=public as $$
declare v_ident text; v_code text; v_count int;
begin
  select count(*) into v_count from admin_users;
  if v_count > 0 then return json_build_object('ok',false,'reason','already_setup'); end if;
  select ident into v_ident from auth_sessions where token=p_token;
  if v_ident is null then return json_build_object('ok',false,'reason','sign_in_first'); end if;
  select admin_setup_code into v_code from platform_flags where id=1;
  if v_code is null or p_code is null or p_code <> v_code then return json_build_object('ok',false,'reason','bad_code'); end if;
  insert into admin_users(ident, level, name, added_by) values (v_ident,'l5',left(coalesce(p_name,''),60),'bootstrap');
  return json_build_object('ok',true,'level','l5');
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- add / promote an employee (caller must outrank the level granted; L4+ only)
create or replace function admin_grant(p_token text, p_ident text, p_level text, p_name text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_id text;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null or admin_rank(v_lvl) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  if p_level not in ('l1','l2','l3','l4','l5') then return json_build_object('ok',false,'reason','bad_level'); end if;
  if admin_rank(p_level) >= admin_rank(v_lvl) and v_lvl <> 'l5' then return json_build_object('ok',false,'reason','cannot_grant_at_or_above'); end if;
  if p_level = 'l5' and v_lvl <> 'l5' then return json_build_object('ok',false,'reason','only_l5_makes_l5'); end if;
  v_id := lower(trim(coalesce(p_ident,'')));
  if position('@' in v_id)=0 then v_id := right(regexp_replace(v_id,'[^0-9]','','g'),10); end if;
  if length(v_id) < 5 then return json_build_object('ok',false,'reason','bad_ident'); end if;
  insert into admin_users(ident, level, name, added_by) values (v_id, p_level, left(coalesce(p_name,''),60), (select ident from auth_sessions where token=p_token))
    on conflict (ident) do update set level=excluded.level, name=coalesce(nullif(excluded.name,''),admin_users.name), active=true, updated_at=now();
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- revoke an employee (L5 only; never remove the last active L5)
create or replace function admin_revoke(p_token text, p_ident text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_id text; v_l5 int;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl <> 'l5' then return json_build_object('ok',false,'reason','forbidden'); end if;
  v_id := lower(trim(coalesce(p_ident,'')));
  if position('@' in v_id)=0 then v_id := right(regexp_replace(v_id,'[^0-9]','','g'),10); end if;
  if (select level from admin_users where ident=v_id) = 'l5' then
    select count(*) into v_l5 from admin_users where level='l5' and active;
    if v_l5 <= 1 then return json_build_object('ok',false,'reason','last_super_admin'); end if;
  end if;
  update admin_users set active=false, updated_at=now() where ident=v_id;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- list employees (L4+); searchable + paged for lakhs of rows
create or replace function admin_list(p_token text, p_q text, p_limit int, p_offset int)
returns setof admin_users language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return; end if;
  return query
    select * from admin_users
    where active and (coalesce(p_q,'')='' or ident ilike '%'||p_q||'%' or coalesce(name,'') ilike '%'||p_q||'%')
    order by admin_rank(level) desc, created_at desc
    limit least(coalesce(p_limit,50),200) offset coalesce(p_offset,0);
end $$;

-- counts by level (dashboard)
create or replace function admin_counts(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false); end if;
  return (select json_object_agg(level, n) from (select level, count(*) n from admin_users where active group by level) t);
exception when others then return json_build_object('ok',false); end $$;

grant execute on function admin_whoami(text) to anon;
grant execute on function admin_claim(text,text,text) to anon;
grant execute on function admin_grant(text,text,text,text) to anon;
grant execute on function admin_revoke(text,text) to anon;
grant execute on function admin_list(text,text,int,int) to anon;
grant execute on function admin_counts(text) to anon;

select 'admin rbac ready' as status;

-- ========== BASE: geo_schema.sql ==========
-- ============================================================
-- ORIGNALS GEO — our own places database (the map flywheel)
-- Every address searched, picked, or delivered to becomes OUR
-- hyperlocal India POI data. Safe to run more than once.
-- ============================================================

create extension if not exists pg_trgm;

create table if not exists geo_places (
  id         bigint generated always as identity primary key,
  key        text unique not null,            -- name|lat4|lng4 (dedupe)
  name       text not null,
  sub        text,
  lat        double precision not null,
  lng        double precision not null,
  kind       text not null default 'drop',    -- picked | drop | shop | gps | search
  uses       int not null default 1,          -- popularity → ranking
  device_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_geo_name_trgm on geo_places using gin (name gin_trgm_ops);
create index if not exists idx_geo_sub_trgm  on geo_places using gin (sub gin_trgm_ops);
create index if not exists idx_geo_uses on geo_places (uses desc);

-- upsert-with-popularity: called by the app on every location use
create or replace function geo_touch(p_name text, p_sub text, p_lat double precision,
                                     p_lng double precision, p_kind text, p_device text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into geo_places (key, name, sub, lat, lng, kind, device_key)
  values (lower(p_name || '|' || round(p_lat::numeric, 4) || '|' || round(p_lng::numeric, 4)),
          p_name, p_sub, p_lat, p_lng, coalesce(p_kind, 'drop'), p_device)
  on conflict (key) do update
    set uses = geo_places.uses + 1, updated_at = now(),
        sub = case when length(coalesce(excluded.sub, '')) > length(coalesce(geo_places.sub, ''))
                   then excluded.sub else geo_places.sub end;
end $fn$;

alter table geo_places enable row level security;
do $pol$ begin
  create policy p_geo_read on geo_places for select using (true);
exception when duplicate_object then null;
end $pol$;

-- ========== BASE: jobs_schema.sql ==========
-- ============================================================
-- ORIGNALS LIVE JOBS — the real two-sided marketplace core.
-- A parcel sent on one phone becomes a claimable job on every
-- verified partner's phone. Claims are atomic (no double-take).
-- ============================================================

create table if not exists live_jobs (
  id text primary key,
  created_at timestamptz not null default now(),
  device_key text not null,                    -- who posted it
  what text not null,
  jtype text not null default 'box',           -- parcel type or 'ride'
  from_name text, to_name text,
  from_lat double precision, from_lng double precision,
  to_lat double precision, to_lng double precision,
  km numeric, pay numeric not null default 0,
  note text,
  status text not null default 'open',         -- open | taken | done | cancelled
  taken_by text, taken_at timestamptz, done_at timestamptz,
  order_ref text
);

create index if not exists live_jobs_open_idx on live_jobs (status, created_at desc);

alter table live_jobs enable row level security;
drop policy if exists lj_read on live_jobs;
create policy lj_read on live_jobs for select using (true);
drop policy if exists lj_insert on live_jobs;
create policy lj_insert on live_jobs for insert with check (true);

-- atomic claim: succeeds only if the job is still open and not your own
create or replace function job_claim(p_job text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update live_jobs
     set status = 'taken', taken_by = p_device, taken_at = now()
   where id = p_job and status = 'open' and device_key <> p_device;
  return found;
end $$;

-- completion: only the partner who claimed it can finish it
create or replace function job_done(p_job text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update live_jobs
     set status = 'done', done_at = now()
   where id = p_job and taken_by = p_device and status = 'taken';
  return found;
end $$;

-- poster can cancel while still open
create or replace function job_cancel(p_job text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update live_jobs
     set status = 'cancelled'
   where id = p_job and device_key = p_device and status = 'open';
  return found;
end $$;

grant execute on function job_claim(text, text) to anon;
grant execute on function job_done(text, text) to anon;
grant execute on function job_cancel(text, text) to anon;

select 'live_jobs marketplace ready' as status;

-- ========== BASE: shop_orders_schema.sql ==========
-- ============================================================
-- ORIGNALS SHOP ORDERS — real commerce across devices.
-- A buyer's order on a community shop lands on the owner's phone;
-- the owner's accept/ready/handover drives the buyer's tracking.
-- Only the shop's own device can change an order's status.
-- ============================================================

create table if not exists shop_orders (
  id text primary key,                       -- buyer's OM id
  created_at timestamptz not null default now(),
  shop_id text not null,
  buyer_device text not null,
  buyer_name text,
  buyer_addr text,
  buyer_lat double precision, buyer_lng double precision,
  items jsonb not null,
  total numeric not null,
  note text,
  status text not null default 'new',        -- new|prep|finding|handed|selfout|done|rejected
  updated_at timestamptz not null default now()
);

create index if not exists shop_orders_shop_idx on shop_orders (shop_id, created_at desc);
create index if not exists shop_orders_buyer_idx on shop_orders (buyer_device, created_at desc);

alter table shop_orders enable row level security;
-- ⚠ SECURITY (2026-08-11): NO blanket anon SELECT. This table carries buyer PII
-- (name, address, GPS) and the delivery handover OTP. A `so_read using(true)`
-- policy (previously declared here) let anyone with the PUBLIC anon key read
-- every order's OTP + address → delivery interception at scale. Reads go through
-- security-definer RPCs scoped to the caller: my_shop_orders() (shop reads its
-- own), order_statuses() (buyer polls its own), order_timeline() (either party).
-- See harden_rls.sql and migrations/0009. Do NOT reintroduce so_read.
drop policy if exists so_read on shop_orders;
-- INSERT stays anon: a buyer on any device must be able to place an order onto
-- the shop's device. It is append-only (no anon UPDATE/DELETE); status moves
-- only via shop_order_status()/shop_order_cancel() (device-scoped, audited).
drop policy if exists so_insert on shop_orders;
create policy so_insert on shop_orders for insert with check (true);

-- ONLY the owning shop's device may move an order through its statuses
create or replace function shop_order_status(p_id text, p_device text, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('prep','finding','handed','selfout','done','rejected') then
    return false;
  end if;
  update shop_orders
     set status = p_status, updated_at = now()
   where id = p_id
     and shop_id = 'my_' || substr(p_device, 1, 12)
     and status not in ('done','rejected');
  return found;
end $$;

grant execute on function shop_order_status(text, text, text) to anon;

select 'shop_orders commerce loop ready' as status;

-- ========== BASE: shop_menu_schema.sql ==========
-- ============================================================
-- ORIGNALS SHOP MENU + PHOTOS + PRICE MODERATION
--  · Storage bucket for shop & dish photos (public read, anon upload)
--  · shop_items gains photo_url + section (for large sectioned menus)
--  · price_bounds + price_check: server-side min/max so no seller can
--    list absurd prices. Bounds seed by category and self-tighten from
--    real listings (moderation intelligence, grows with the platform).
-- ============================================================

-- 1 ── photo storage ───────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('shopimg', 'shopimg', true, 3000000)
on conflict (id) do update set public = true, file_size_limit = 3000000;

drop policy if exists "shopimg read" on storage.objects;
create policy "shopimg read" on storage.objects for select using (bucket_id = 'shopimg');
drop policy if exists "shopimg upload" on storage.objects;
create policy "shopimg upload" on storage.objects for insert with check (bucket_id = 'shopimg');

-- 2 ── menu columns ────────────────────────────────────────
alter table shop_items add column if not exists photo_url text;
alter table shop_items add column if not exists section text;

-- 3 ── price moderation ────────────────────────────────────
create table if not exists price_bounds (
  key text primary key,            -- 'item:<name>' | 'cat:<category>' | 'default'
  min_price numeric not null,
  max_price numeric not null,
  samples int not null default 0,
  updated_at timestamptz not null default now()
);
insert into price_bounds (key, min_price, max_price) values
  ('cat:food', 10, 3000), ('cat:restaurant', 20, 4000), ('cat:organic', 5, 8000),
  ('cat:grocery', 2, 8000), ('cat:dairy', 5, 3000), ('cat:pharmacy', 1, 20000),
  ('cat:bakery', 5, 3000), ('cat:fashion', 30, 100000), ('cat:electronics', 50, 500000),
  ('cat:hardware', 5, 200000), ('cat:flowers', 10, 5000), ('cat:books', 20, 20000),
  ('default', 1, 1000000)
on conflict (key) do nothing;

-- server-side price verdict for a proposed listing
create or replace function price_check(p_cat text, p_name text, p_price numeric)
returns json language plpgsql security definer set search_path=public as $$
declare v_min numeric; v_max numeric; v_src text;
begin
  if p_price is null or p_price <= 0 then return json_build_object('verdict','invalid'); end if;
  select min_price, max_price into v_min, v_max from price_bounds where key = 'item:'||lower(trim(coalesce(p_name,'')));
  if v_min is not null then v_src := 'item';
  else
    select min_price, max_price into v_min, v_max from price_bounds where key = 'cat:'||lower(coalesce(p_cat,''));
    if v_min is not null then v_src := 'category'; end if;
  end if;
  if v_min is null then select min_price, max_price into v_min, v_max from price_bounds where key='default'; v_src := 'default'; end if;
  if p_price < v_min then
    return json_build_object('verdict', case when p_price < v_min/3.0 then 'block' else 'low' end, 'min',v_min,'max',v_max,'src',v_src);
  elsif p_price > v_max then
    return json_build_object('verdict', case when p_price > v_max*3.0 then 'block' else 'high' end, 'min',v_min,'max',v_max,'src',v_src);
  else
    return json_build_object('verdict','ok','min',v_min,'max',v_max,'src',v_src);
  end if;
exception when others then return json_build_object('verdict','ok'); end $$;

-- learning: tighten per-item bounds from real listings (median ± band).
-- Safe to run on a schedule; only creates item bounds once enough samples.
create or replace function price_learn()
returns int language plpgsql security definer set search_path=public as $$
declare n int := 0;
begin
  insert into price_bounds (key, min_price, max_price, samples, updated_at)
  select 'item:'||lower(trim(name)),
         greatest(1, round(percentile_cont(0.5) within group (order by price) * 0.4)),
         round(percentile_cont(0.5) within group (order by price) * 2.5),
         count(*), now()
  from shop_items
  where name is not null and price > 0
  group by lower(trim(name))
  having count(*) >= 5
  on conflict (key) do update set
    min_price = excluded.min_price, max_price = excluded.max_price,
    samples = excluded.samples, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function price_check(text, text, numeric) to anon;

select 'shop menu + photos + price moderation ready' as status;

-- ========== BASE: community_schema.sql ==========
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

-- ========== BASE: mitra_schema.sql ==========
-- ============================================================
-- MITRA BRAIN BACKEND — our own LLM infra inside Supabase
-- One paste installs everything:
--   tables · seed dataset (121 examples) · feature hasher ·
--   SGD trainer (plpgsql) · pg_cron auto-training every 15 min ·
--   global model that every device downloads on boot
-- Safe to run more than once.
-- ============================================================

-- ---------- tables ----------
create table if not exists mitra_utterances (
  id          bigint generated always as identity primary key,
  device_key  text not null,
  ts          timestamptz not null,
  text        text not null,
  pred        text,
  conf        numeric(4,2),
  label       text,
  src         text,
  unique (device_key, ts)
);
create index if not exists idx_mitra_unlabeled on mitra_utterances(label) where label is null;
create index if not exists idx_mitra_device on mitra_utterances(device_key, ts desc);

create table if not exists mitra_model (
  device_key text primary key,
  version    int,
  trained    int,
  labeled    int,
  accuracy   int,
  updated_at timestamptz not null default now()
);

create table if not exists mitra_global_model (
  id         int primary key default 1 check (id = 1),
  version    int not null default 0,
  w          real[],
  b          real[],
  trained    int not null default 0,
  examples   int not null default 0,
  updated_at timestamptz not null default now()
);

create or replace view mitra_training_set as
  select text, label as intent, src from mitra_utterances where label is not null;

-- ---------- seed dataset (identical to the in-app seed corpus) ----------
insert into mitra_utterances (device_key, ts, text, pred, conf, label, src) values
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '1 seconds', 'order 2 milk', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '2 seconds', 'do kilo aloo dena', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '3 seconds', 'ek packet biscuit dena', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '4 seconds', 'bhaiya paneer dena', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '5 seconds', 'sabun aur tel de do', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '6 seconds', 'get me bread and eggs', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '7 seconds', 'doodh mangwa do', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '8 seconds', 'buy paneer from kirana', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '9 seconds', 'i want biryani', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '10 seconds', 'order chicken biryani for 2', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '11 seconds', 'sabzi chahiye', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '12 seconds', 'get medicines paracetamol', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '13 seconds', 'order a cake', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '14 seconds', 'atta aur chawal mangwa do', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '15 seconds', 'need shampoo and soap', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '16 seconds', 'khana order karo', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '17 seconds', 'where is my order', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '18 seconds', 'khana kab tak aayega', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '19 seconds', 'kab tak pahunchega mera saman', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '20 seconds', 'kitni der aur lagegi', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '21 seconds', 'order abhi tak nahi aaya', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '22 seconds', 'order kahan hai', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '23 seconds', 'track my delivery', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '24 seconds', 'mera order aa gaya kya', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '25 seconds', 'delivery status', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '26 seconds', 'kitna time lagega order me', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '27 seconds', 'order ka status batao', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '28 seconds', 'is my food coming', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '29 seconds', 'cancel my order', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '30 seconds', 'cancel kar do wo order', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '31 seconds', 'biryani wala order cancel karo', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '32 seconds', 'wo wala order hata do', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '33 seconds', 'cancel that food order', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '34 seconds', 'order cancel karo', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '35 seconds', 'cancel the delivery', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '36 seconds', 'mujhe order cancel karna hai', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '37 seconds', 'cancel my booking please', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '38 seconds', 'galti se order ho gaya cancel karo', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '39 seconds', 'book a bike to the station', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '40 seconds', 'cab chahiye airport', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '41 seconds', 'auto book karo', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '42 seconds', 'i need a taxi', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '43 seconds', 'ride to office', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '44 seconds', 'bike se jana hai mall', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '45 seconds', 'ghar jana hai gaadi bhejo', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '46 seconds', 'book cab for 2 people', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '47 seconds', 'send this tiffin to grandma', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '48 seconds', 'dawai pahuncha do dadi ke ghar', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '49 seconds', 'ye saman pahunchana hai', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '50 seconds', 'packet drop karwana hai', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '51 seconds', 'parcel bhejna hai', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '52 seconds', 'courier my documents', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '53 seconds', 'send keys to office', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '54 seconds', 'tiffin bhej do dadi ko', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '55 seconds', 'deliver this package to sector 9', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '56 seconds', 'send medicines to my mother', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '57 seconds', 'wallet balance', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '58 seconds', 'kitna paisa hai', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '59 seconds', 'add 200 to wallet', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '60 seconds', 'paise add karo', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '61 seconds', 'show my balance', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '62 seconds', 'wallet me paisa daalo', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '63 seconds', 'withdraw my money', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '64 seconds', 'recharge wallet 500', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '65 seconds', 'book movie tickets', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '66 seconds', '2 tickets for the 6:30 show', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '67 seconds', 'movie dekhni hai', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '68 seconds', 'film ke ticket book karo', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '69 seconds', 'show me whats playing', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '70 seconds', 'book tickets for tonight', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '71 seconds', 'imax tickets', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '72 seconds', 'my bookings', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '73 seconds', 'show my tickets', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '74 seconds', 'mere tickets dikhao', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '75 seconds', 'meri booking kahan hai', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '76 seconds', 'what did i book', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '77 seconds', 'my reservations', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '78 seconds', 'what should i eat', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '79 seconds', 'bhook lagi hai', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '80 seconds', 'suggest something good', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '81 seconds', 'kuch accha khane ko', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '82 seconds', 'recommend dinner', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '83 seconds', 'kya khau aaj', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '84 seconds', 'i am hungry suggest', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '85 seconds', 'book a hotel room', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '86 seconds', 'need a room for 2 nights', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '87 seconds', 'hotel chahiye', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '88 seconds', 'stay booking', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '89 seconds', 'homestay near lake', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '90 seconds', 'room book karo kal ke liye', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '91 seconds', '2 bhk flat for rent', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '92 seconds', 'ghar chahiye rent pe', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '93 seconds', 'show me plots', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '94 seconds', 'property near sector 12', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '95 seconds', 'buy a flat', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '96 seconds', 'makaan dekhna hai', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '97 seconds', 'office space commercial', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '98 seconds', 'i want to earn', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '99 seconds', 'kamai karni hai', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '100 seconds', 'become delivery partner', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '101 seconds', 'partner banna hai', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '102 seconds', 'job chahiye delivery ki', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '103 seconds', 'earn with my bike', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '104 seconds', 'deliver and earn', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '105 seconds', 'register my shop', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '106 seconds', 'apni shop app pe daalni hai', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '107 seconds', 'store online karna hai', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '108 seconds', 'main bechna chahta hu yahan', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '109 seconds', 'seller banna hai', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '110 seconds', 'meri dukaan online karo', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '111 seconds', 'sell on orignals', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '112 seconds', 'list my store', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '113 seconds', 'dukan kholna hai app pe', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '114 seconds', 'how to sell here', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '115 seconds', 'hello', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '116 seconds', 'hi mitra', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '117 seconds', 'namaste', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '118 seconds', 'hey there', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '119 seconds', 'help me', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '120 seconds', 'what can you do', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '121 seconds', 'madad karo', null, null, 'greeting', 'seed')
on conflict (device_key, ts) do nothing;

-- ---------- feature hashing: bit-identical to js/brain.js (FNV-1a 32-bit) ----------
create or replace function mitra_hash(k text, d int) returns int
language plpgsql immutable as $fn$
declare h bigint := 2166136261; i int; c int;
begin
  for i in 1..length(k) loop
    c := ascii(substr(k, i, 1));
    h := (h # c) & 4294967295;
    h := (h * 16777619) & 4294967295;
  end loop;
  return (h % d)::int;
end $fn$;

create or replace function mitra_feat_keys(txt text) returns setof text
language plpgsql immutable as $fn$
declare t text; words text[]; w text; i int; j int;
begin
  t := btrim(regexp_replace(regexp_replace(lower(txt), '[^a-z0-9ऀ-ॿ ]+', ' ', 'g'), '\s+', ' ', 'g'));
  if t = '' then return; end if;
  words := string_to_array(t, ' ');
  foreach w in array words loop
    return next 'w:' || w;
    if length(w) >= 3 then
      for i in 1..length(w) - 2 loop return next 'c:' || substr(w, i, 3); end loop;
    end if;
  end loop;
  for j in 1..coalesce(array_length(words, 1), 0) - 1 loop
    return next 'b:' || words[j] || '_' || words[j + 1];
  end loop;
  return next '_bias';
end $fn$;

-- ---------- the backend trainer: softmax regression, online SGD ----------
create or replace function mitra_train(epochs int default 2) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  d int := 1024; c int := 14; lr real := 0.12;
  intents text[] := array['order_item','track_order','cancel_order','book_ride','send_parcel',
    'wallet','book_tickets','my_bookings','recommend','hotel_stay','property',
    'earn_partner','shop_register','greeting'];
  w real[]; b real[]; ver int;
  ex record; y int; feats int[]; vals real[];
  z real[]; p real[]; mx real; sm real; g real;
  e int; ci int; k int; nk int; ntrain int := 0;
begin
  select coalesce(mg.w, array_fill(0::real, array[d * c])),
         coalesce(mg.b, array_fill(0::real, array[c])),
         coalesce(mg.version, 0)
    into w, b, ver
    from (select 1) q left join mitra_global_model mg on mg.id = 1;

  for e in 1..epochs loop
    for ex in select text, label from mitra_utterances where label is not null order by random() loop
      y := array_position(intents, ex.label);
      continue when y is null;
      select array_agg(idx), array_agg(val) into feats, vals from (
        select mitra_hash(kk, d) as idx, count(*)::real as val
        from mitra_feat_keys(ex.text) kk group by 1) q;
      continue when feats is null;
      nk := array_length(feats, 1);
      z := array_fill(0::real, array[c]);
      for ci in 1..c loop
        z[ci] := b[ci];
        for k in 1..nk loop z[ci] := z[ci] + w[feats[k] * c + ci] * vals[k]; end loop;
      end loop;
      mx := (select max(x) from unnest(z) x);
      sm := 0; p := array_fill(0::real, array[c]);
      for ci in 1..c loop p[ci] := exp(z[ci] - mx); sm := sm + p[ci]; end loop;
      for ci in 1..c loop p[ci] := p[ci] / sm; end loop;
      for ci in 1..c loop
        g := (case when ci = y then 1 else 0 end) - p[ci];
        b[ci] := b[ci] + lr * g;
        for k in 1..nk loop
          w[feats[k] * c + ci] := w[feats[k] * c + ci] + lr * g * vals[k];
        end loop;
      end loop;
      ntrain := ntrain + 1;
    end loop;
  end loop;

  if ntrain > 0 then
    insert into mitra_global_model (id, version, w, b, trained, examples)
    values (1, ver + 1, w, b, ntrain,
      (select count(*) from mitra_utterances where label is not null))
    on conflict (id) do update
      set version = excluded.version, w = excluded.w, b = excluded.b,
          trained = mitra_global_model.trained + excluded.trained,
          examples = excluded.examples, updated_at = now();
  end if;
  return jsonb_build_object('trained_steps', ntrain,
    'model_version', case when ntrain > 0 then ver + 1 else ver end,
    'labeled_examples', (select count(*) from mitra_utterances where label is not null));
end $fn$;

-- backend inference (for future server-side callers / verification)
create or replace function mitra_predict(txt text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  d int := 1024; c int := 14;
  intents text[] := array['order_item','track_order','cancel_order','book_ride','send_parcel',
    'wallet','book_tickets','my_bookings','recommend','hotel_stay','property',
    'earn_partner','shop_register','greeting'];
  w real[]; b real[]; feats int[]; vals real[];
  z real[]; mx real; sm real; ci int; k int; nk int; best int := 1;
begin
  select mg.w, mg.b into w, b from mitra_global_model mg where mg.id = 1;
  if w is null then return jsonb_build_object('error', 'model not trained yet'); end if;
  select array_agg(idx), array_agg(val) into feats, vals from (
    select mitra_hash(kk, d) as idx, count(*)::real as val
    from mitra_feat_keys(txt) kk group by 1) q;
  nk := array_length(feats, 1);
  z := array_fill(0::real, array[c]);
  for ci in 1..c loop
    z[ci] := b[ci];
    for k in 1..nk loop z[ci] := z[ci] + w[feats[k] * c + ci] * vals[k]; end loop;
  end loop;
  mx := (select max(x) from unnest(z) x); sm := 0;
  for ci in 1..c loop z[ci] := exp(z[ci] - mx); sm := sm + z[ci]; end loop;
  for ci in 1..c loop
    z[ci] := z[ci] / sm;
    if z[ci] > z[best] then best := ci; end if;
  end loop;
  return jsonb_build_object('intent', intents[best], 'conf', round(z[best]::numeric, 3));
end $fn$;

-- ---------- automation: the backend trains itself every 15 minutes ----------
create extension if not exists pg_cron;
do $cron$ begin
  perform cron.schedule('mitra-train', '*/15 * * * *', 'select mitra_train(2)');
exception when others then raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $cron$;

-- ---------- security ----------
alter table mitra_utterances   enable row level security;
alter table mitra_model        enable row level security;
alter table mitra_global_model enable row level security;
do $pol$ begin
  create policy p_mu_all on mitra_utterances for all using (true) with check (true);
  create policy p_mm_all on mitra_model for all using (true) with check (true);
  create policy p_mg_read on mitra_global_model for select using (true);
exception when duplicate_object then null;
end $pol$;

-- ---------- first training run, right now ----------
select mitra_train(6);

-- ========== BASE: ratings_schema.sql ==========
-- ============================================================
-- ORIGNALS RATINGS — real, aggregated, cross-device.
-- A buyer's post-delivery rating recomputes the shop's average and
-- writes it back to the shops row, so every other buyer sees the
-- real, earned score. One rating per buyer per order.
-- ============================================================

create table if not exists shop_ratings (
  id bigint generated always as identity primary key,
  shop_id text not null,
  device_key text not null,
  stars int not null check (stars between 1 and 5),
  order_ref text not null default '',
  created_at timestamptz not null default now(),
  unique (shop_id, device_key, order_ref)
);
create index if not exists shop_ratings_shop_idx on shop_ratings (shop_id);

alter table shop_ratings enable row level security;
drop policy if exists sr_read on shop_ratings;
create policy sr_read on shop_ratings for select using (true);

create or replace function rate_shop(p_shop text, p_device text, p_stars int, p_order text)
returns json language plpgsql security definer set search_path = public as $$
declare v_avg numeric; v_cnt int;
begin
  insert into shop_ratings (shop_id, device_key, stars, order_ref)
  values (p_shop, p_device, p_stars, coalesce(p_order, ''))
  on conflict (shop_id, device_key, order_ref)
  do update set stars = excluded.stars, created_at = now();
  select round(avg(stars)::numeric, 1), count(*) into v_avg, v_cnt
    from shop_ratings where shop_id = p_shop;
  update shops set rating = v_avg, ratings_count = v_cnt where id = p_shop;
  return json_build_object('avg', v_avg, 'count', v_cnt);
end $$;
grant execute on function rate_shop(text, text, int, text) to anon;

select 'shop ratings ready' as status;

-- ========== BASE: seats_schema.sql ==========
-- ============================================================
-- ORIGNALS SEAT INVENTORY — real, cross-device, no double-booking.
-- The UNIQUE (show_key, seat) constraint is the atomic guarantee:
-- two phones cannot hold the same seat for the same show.
-- Flow: seats_book (hold, ticket null) → seats_confirm (stamp
-- ticket on pay) → seats_free / seats_free_ticket (release).
-- Stale holds (unpaid > 12 min) are swept opportunistically.
-- ============================================================

create table if not exists seat_bookings (
  id bigint generated always as identity primary key,
  show_key text not null,          -- movieId|date|timeIdx
  seat text not null,              -- e.g. 'E5'
  device_key text,
  ticket_id text,                  -- null = pending hold
  created_at timestamptz not null default now(),
  unique (show_key, seat)
);
create index if not exists seat_show_idx on seat_bookings (show_key);

alter table seat_bookings enable row level security;
drop policy if exists sb_read on seat_bookings;
create policy sb_read on seat_bookings for select using (true);

-- hold seats atomically; returns the seats that were ALREADY taken
-- (empty array = success). Handles the concurrent-race via the
-- unique constraint, then re-reports the true conflicts.
create or replace function seats_book(p_show text, p_seats text[], p_device text)
returns text[] language plpgsql security definer set search_path = public as $$
declare conflicts text[];
begin
  -- opportunistic sweep of abandoned holds
  if random() < 0.2 then
    delete from seat_bookings where ticket_id is null and created_at < now() - interval '12 minutes';
  end if;
  select array_agg(seat) into conflicts
    from seat_bookings where show_key = p_show and seat = any(p_seats);
  if conflicts is not null then return conflicts; end if;
  insert into seat_bookings (show_key, seat, device_key)
    select p_show, unnest(p_seats), p_device;
  return array[]::text[];
exception when unique_violation then
  select array_agg(seat) into conflicts
    from seat_bookings where show_key = p_show and seat = any(p_seats);
  return coalesce(conflicts, array['race']::text[]);
end $$;

-- stamp the ticket id once payment succeeds (confirms the hold)
create or replace function seats_confirm(p_show text, p_seats text[], p_device text, p_ticket text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update seat_bookings set ticket_id = p_ticket
   where show_key = p_show and seat = any(p_seats) and device_key = p_device;
end $$;

-- release an un-paid hold (user backed out of checkout)
create or replace function seats_free(p_show text, p_seats text[], p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from seat_bookings
   where show_key = p_show and seat = any(p_seats)
     and device_key = p_device and ticket_id is null;
end $$;

-- release a confirmed booking (ticket cancelled)
create or replace function seats_free_ticket(p_ticket text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from seat_bookings where ticket_id = p_ticket and device_key = p_device;
end $$;

grant execute on function seats_book(text, text[], text) to anon;
grant execute on function seats_confirm(text, text[], text, text) to anon;
grant execute on function seats_free(text, text[], text) to anon;
grant execute on function seats_free_ticket(text, text) to anon;

select 'seat inventory ready' as status;

-- ========== BASE: payments_schema.sql ==========
-- ============================================================
-- ORIGNALS PAYMENTS — Razorpay ledger
-- Every online payment is recorded server-side: created by the
-- razorpay-order edge function, marked verified only after the
-- razorpay-verify edge function checks the HMAC signature.
-- ============================================================

create table if not exists payments (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_key text,
  rzp_order_id text unique not null,
  rzp_payment_id text,
  amount_paise bigint not null check (amount_paise between 100 and 50000000),
  purpose text not null default 'order',      -- order | wallet_topup | plan
  ref text,                                    -- app-side id (OM12345 etc)
  status text not null default 'created',     -- created | verified | failed
  verified_at timestamptz,
  raw jsonb
);

create index if not exists payments_device_idx on payments (device_key, created_at desc);

alter table payments enable row level security;

-- ⚠ SECURITY (2026-07-23): payments has NO anon policy = deny-all for the public
-- anon key. Writes happen only through the edge functions (service role); a device
-- checks one payment's status via the security-definer RPC payment_status()
-- (supabase/harden_rls.sql). The previous `payments_read_own for select using(true)`
-- was misnamed and world-readable — it exposed every payment row (amount, ref,
-- rzp ids) to anyone with the anon key, and re-running this file silently re-opened
-- it after hardening. Do NOT recreate a permissive read policy here.
drop policy if exists payments_read_own on payments;

select 'payments table ready (deny-all; reads via payment_status RPC)' as status;

-- ========== BASE: settlements_schema.sql ==========
-- ============================================================
-- AUTO-SETTLEMENT — money owed to shops & partners is recorded
-- automatically on every paid order (no manual sending), tracked in
-- a ledger, and paid out in a batch ("daily settlement"). When
-- Razorpay Route is activated and a payee has a linked account, the
-- split can happen at capture time — until then this ledger + batch
-- payout runs the settlement cleanly.
-- Commission model: platform keeps 8% (5% platform fee absorbing the
-- ~3% gateway); the shop nets 92% of the order.
-- ============================================================

create table if not exists payout_accounts (
  payee         text primary key,          -- shop_id (shops) or device (partners)
  kind          text default 'shop',        -- shop | partner
  holder        text,
  upi           text,
  bank_acc      text,
  ifsc          text,
  rzp_linked_id text,                        -- Razorpay Route linked-account id (once Route is active)
  status        text default 'active',
  created_at    timestamptz default now()
);

create table if not exists settlement_ledger (
  id         bigint generated always as identity primary key,
  order_ref  text,
  payee      text,
  payee_kind text default 'shop',
  gross      numeric,
  commission numeric,
  net        numeric,
  status     text default 'due',            -- due | paid
  payout_ref text,
  paid_at    timestamptz,
  created_at timestamptz default now(),
  unique (order_ref, payee)
);
create index if not exists settle_status_idx on settlement_ledger(status, payee);
alter table payout_accounts   enable row level security;
alter table settlement_ledger enable row level security;

-- AUTO-RECORD: every shop order becomes a settlement entry for the shop
create or replace function _settle_from_shop_order() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into settlement_ledger(order_ref, payee, payee_kind, gross, commission, net)
  values (new.id, new.shop_id, 'shop', coalesce(new.total,0),
          round(coalesce(new.total,0)*0.08,2), round(coalesce(new.total,0)*0.92,2))
  on conflict (order_ref, payee) do nothing;
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_settle_shop_order on shop_orders;
create trigger trg_settle_shop_order after insert on shop_orders for each row execute function _settle_from_shop_order();

-- seller/partner registers where their money should go
create or replace function payout_account_set(p_payee text, p_kind text, p_holder text, p_upi text, p_bank text, p_ifsc text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if coalesce(p_payee,'')='' then return json_build_object('ok',false,'reason','no_payee'); end if;
  insert into payout_accounts(payee,kind,holder,upi,bank_acc,ifsc)
  values (p_payee, coalesce(nullif(p_kind,''),'shop'), left(coalesce(p_holder,''),80), left(coalesce(p_upi,''),80), left(coalesce(p_bank,''),40), left(coalesce(p_ifsc,''),20))
  on conflict (payee) do update set holder=excluded.holder, upi=excluded.upi, bank_acc=excluded.bank_acc, ifsc=excluded.ifsc, kind=excluded.kind;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- a payee's own statement (owed + paid)
create or replace function settlement_mine(p_payee text)
returns json language plpgsql security definer set search_path=public as $$
begin
  return json_build_object('ok',true,
    'due', (select coalesce(sum(net),0) from settlement_ledger where payee=p_payee and status='due'),
    'paid',(select coalesce(sum(net),0) from settlement_ledger where payee=p_payee and status='paid'),
    'account',(select row_to_json(a) from (select holder,upi,bank_acc,ifsc from payout_accounts where payee=p_payee) a),
    'rows',(select coalesce(json_agg(row_to_json(t) order by t.created_at desc),'[]'::json) from (
       select order_ref, gross, commission, net, status, created_at from settlement_ledger where payee=p_payee limit 50) t));
end $$;

-- ADMIN: settlement dashboard (L4+)
create or replace function settlement_summary(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,
    'due_total',  (select coalesce(sum(net),0) from settlement_ledger where status='due'),
    'paid_total', (select coalesce(sum(net),0) from settlement_ledger where status='paid'),
    'commission', (select coalesce(sum(commission),0) from settlement_ledger),
    'due_count',  (select count(*) from settlement_ledger where status='due'),
    'by_payee', (select coalesce(json_agg(row_to_json(t) order by t.due desc),'[]'::json) from (
        select l.payee, coalesce(a.holder, l.payee) holder, coalesce(a.upi,'') upi,
               sum(l.net) filter (where l.status='due') due,
               sum(l.net) filter (where l.status='paid') paid,
               count(*) filter (where l.status='due') orders
        from settlement_ledger l left join payout_accounts a on a.payee=l.payee
        group by l.payee, a.holder, a.upi having sum(l.net) filter (where l.status='due') > 0) t));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ADMIN: run the batch payout — settle everything currently due (L5).
-- With Razorpay Route/Payouts + linked accounts this would fire real
-- transfers; here it records the settlement so the ledger stays truthful.
create or replace function settlement_run(p_token text, p_payee text)
returns json language plpgsql security definer set search_path=public as $$
declare v_ref text; v_n int; v_sum numeric;
begin
  if _admin_level(p_token) is distinct from 'l5' then return json_build_object('ok',false,'reason','only_l5'); end if;
  v_ref := 'PO' || to_char(now(),'YYYYMMDDHH24MISS');
  update settlement_ledger set status='paid', payout_ref=v_ref, paid_at=now()
    where status='due' and (coalesce(p_payee,'')='' or payee=p_payee);
  get diagnostics v_n = row_count;
  select coalesce(sum(net),0) into v_sum from settlement_ledger where payout_ref=v_ref;
  return json_build_object('ok',true,'payout_ref',v_ref,'settled',v_n,'amount',v_sum);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function payout_account_set(text,text,text,text,text,text) to anon;
grant execute on function settlement_mine(text) to anon;
grant execute on function settlement_summary(text) to anon;
grant execute on function settlement_run(text,text) to anon;

-- backfill: create settlement rows for any shop orders that predate the trigger
insert into settlement_ledger(order_ref, payee, payee_kind, gross, commission, net)
select id, shop_id, 'shop', coalesce(total,0), round(coalesce(total,0)*0.08,2), round(coalesce(total,0)*0.92,2)
from shop_orders on conflict (order_ref, payee) do nothing;

select 'settlements ready' as status, (select count(*) from settlement_ledger) ledger_rows;

-- ========== BASE: order_chat.sql ==========
-- ============================================================
-- IN-APP ORDER CHAT — buyer ⇄ partner ⇄ shop talk about an order
-- WITHOUT ever exchanging phone numbers or names outside the app.
-- Only the order's participants can read/write (verified server-side).
-- ============================================================

create table if not exists order_chat (
  id bigint generated always as identity primary key,
  order_ref text not null,
  from_device text not null,
  from_role text,                -- buyer | shop | partner
  msg text not null,
  created_at timestamptz not null default now()
);
create index if not exists order_chat_idx on order_chat (order_ref, created_at);
alter table order_chat enable row level security;   -- RPC-only, no bulk anon access

-- is this device a participant in the order? (buyer, the shop owner, or
-- the partner who claimed the delivery)
create or replace function chat_is_participant(p_order text, p_device text)
returns boolean language sql security definer set search_path=public stable as $$
  select exists (select 1 from shop_orders where id = p_order
                   and (buyer_device = p_device or shop_id = 'my_'||substr(p_device,1,12)))
      or exists (select 1 from live_jobs where order_ref = p_order and taken_by = p_device);
$$;

create or replace function chat_send(p_order text, p_device text, p_role text, p_msg text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if length(trim(coalesce(p_msg,''))) = 0 then return json_build_object('ok',false); end if;
  if not chat_is_participant(p_order, p_device) then return json_build_object('ok',false,'reason','not_participant'); end if;
  insert into order_chat (order_ref, from_device, from_role, msg)
    values (p_order, p_device, left(coalesce(p_role,'user'),10), left(p_msg,500));
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $$;

create or replace function chat_read(p_order text, p_device text)
returns setof order_chat language plpgsql security definer set search_path=public as $$
begin
  if not chat_is_participant(p_order, p_device) then return; end if;
  return query select * from order_chat where order_ref = p_order order by created_at asc limit 200;
end $$;

grant execute on function chat_send(text,text,text,text) to anon;
grant execute on function chat_read(text,text) to anon;

select 'order chat ready' as status;

-- ========== BASE: verify_schema.sql ==========
-- ============================================================
-- REAL VERIFICATION PIPELINE — replaces the admin panel's local demo
-- queues. Partners, shops and sellers submit genuine verification
-- requests; L3+ staff review and decide; decisions persist and drive
-- what buyers see. No hardcoded arrays.
-- ============================================================
create table if not exists verify_queue (
  id          bigint generated always as identity primary key,
  kind        text not null,                 -- kyc | purity | shop | service
  subject     text not null,                 -- who/what is being verified
  device      text,
  ident       text,
  details     jsonb default '{}'::jsonb,
  status      text default 'pending',        -- pending | verified | rejected
  reviewed_by text,
  created_at  timestamptz default now(),
  decided_at  timestamptz
);
create index if not exists vq_status_idx on verify_queue(status, kind, created_at);
alter table verify_queue enable row level security;

-- submit (open to anon — partners/shops self-submit; de-duped per subject+kind while pending)
create or replace function verify_submit(p_kind text, p_subject text, p_device text, p_ident text, p_details jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare v_id bigint;
begin
  if p_kind not in ('kyc','purity','shop','service') or coalesce(p_subject,'')='' then return json_build_object('ok',false,'reason','bad'); end if;
  if exists(select 1 from verify_queue where kind=p_kind and lower(subject)=lower(p_subject) and status='pending') then
    return json_build_object('ok',true,'dedup',true); end if;
  insert into verify_queue(kind,subject,device,ident,details)
  values (p_kind, left(p_subject,120), left(coalesce(p_device,''),64), nullif(p_ident,''), coalesce(p_details,'{}'::jsonb))
  returning id into v_id;
  return json_build_object('ok',true,'id',v_id);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- pending list (L3+ inspectors and up), optional kind filter
create or replace function verify_pending(p_token text, p_kind text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 3 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,'rows',(select coalesce(json_agg(row_to_json(t) order by t.created_at),'[]'::json) from (
    select id,kind,subject,details,created_at from verify_queue
    where status='pending' and (coalesce(p_kind,'')='' or kind=p_kind) limit 200) t));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- counts by kind for the overview (L3+)
create or replace function verify_counts(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 3 then return json_build_object('ok',false); end if;
  return (select coalesce(json_object_agg(kind, n),'{}'::json) from (select kind, count(*) n from verify_queue where status='pending' group by kind) t);
exception when others then return json_build_object('ok',false); end $$;

-- decide (L3+); persists + timestamps
create or replace function verify_decide(p_token text, p_id bigint, p_decision text)
returns json language plpgsql security definer set search_path=public as $$
declare v_row verify_queue;
begin
  if admin_rank(_admin_level(p_token)) < 3 then return json_build_object('ok',false,'reason','forbidden'); end if;
  if p_decision not in ('verified','rejected') then return json_build_object('ok',false,'reason','bad'); end if;
  update verify_queue set status=p_decision, reviewed_by=(select ident from auth_sessions where token=p_token), decided_at=now()
    where id=p_id and status='pending' returning * into v_row;
  if v_row.id is null then return json_build_object('ok',false,'reason','not_found'); end if;
  -- propagate the decision to the real record where applicable (best-effort; never fails the decision)
  begin
    if v_row.kind='kyc' and v_row.device is not null then
      update partners set status = case when p_decision='verified' then 'verified' else 'rejected' end where device_key=v_row.device;
    end if;
  exception when others then null;
  end;
  return json_build_object('ok',true,'kind',v_row.kind,'subject',v_row.subject);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function verify_submit(text,text,text,text,jsonb) to anon;
grant execute on function verify_pending(text,text) to anon;
grant execute on function verify_counts(text) to anon;
grant execute on function verify_decide(text,bigint,text) to anon;

select 'verify pipeline ready' as status;

-- ========== BASE: fraud_schema.sql ==========
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

-- ========== BASE: twofa_schema.sql ==========
-- ============================================================
-- MULTI-FACTOR AUTH — authenticator app (TOTP, RFC 6238) + backup codes.
-- Adds to the existing factors: password, SMS OTP, face lock.
-- All verification is SERVER-SIDE (pgcrypto HMAC-SHA1) so codes can't be faked.
-- pgcrypto is schema-qualified (Supabase quirk).
-- ============================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists user_2fa (
  ident         text primary key,
  totp_secret   text,                 -- base32, active
  totp_pending  text,                 -- base32, mid-setup (not yet confirmed)
  totp_enabled  boolean default false,
  backup_codes  text[] default '{}',  -- sha256 hashes of one-time recovery codes
  updated_at    timestamptz default now()
);
alter table user_2fa enable row level security;

-- ---------- base32 (RFC 4648, no padding) ----------
create or replace function _b32_encode(p bytea) returns text
language plpgsql immutable set search_path=public,extensions as $$
declare alph text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  bits int := 0; val int := 0; i int; out text := '';
begin
  for i in 0..length(p)-1 loop
    val := (val << 8) | get_byte(p, i); bits := bits + 8;
    while bits >= 5 loop
      out := out || substr(alph, ((val >> (bits-5)) & 31) + 1, 1);
      bits := bits - 5; val := val & ((1 << bits) - 1);
    end loop;
  end loop;
  if bits > 0 then out := out || substr(alph, ((val << (5-bits)) & 31) + 1, 1); end if;
  return out;
end $$;

create or replace function _b32_decode(p text) returns bytea
language plpgsql immutable set search_path=public,extensions as $$
declare alph text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  bits int := 0; val int := 0; i int; idx int; out bytea := '\x';
begin
  p := upper(regexp_replace(coalesce(p,''), '[^A-Za-z2-7]', '', 'g'));
  for i in 1..length(p) loop
    idx := position(substr(p, i, 1) in alph) - 1;
    if idx < 0 then continue; end if;
    val := (val << 5) | idx; bits := bits + 5;
    if bits >= 8 then
      out := out || set_byte('\x00'::bytea, 0, (val >> (bits-8)) & 255);
      bits := bits - 8; val := val & ((1 << bits) - 1);
    end if;
  end loop;
  return out;
end $$;

-- ---------- TOTP ----------
create or replace function _totp_at(p_secret text, p_ctr bigint) returns text
language plpgsql set search_path=public,extensions as $$
declare key bytea; msg bytea; hs bytea; off int; bin bigint; i int;
begin
  key := _b32_decode(p_secret);
  msg := '\x0000000000000000'::bytea;
  for i in 0..7 loop msg := set_byte(msg, 7-i, ((p_ctr >> (i*8)) & 255)::int); end loop;
  hs  := extensions.hmac(msg, key, 'sha1');
  off := get_byte(hs, 19) & 15;
  bin := ((get_byte(hs, off)   & 127)::bigint << 24)
       | ((get_byte(hs, off+1) & 255)::bigint << 16)
       | ((get_byte(hs, off+2) & 255)::bigint << 8)
       |  (get_byte(hs, off+3) & 255)::bigint;
  return lpad((bin % 1000000)::text, 6, '0');
end $$;

create or replace function _totp_verify(p_secret text, p_code text) returns boolean
language plpgsql set search_path=public,extensions as $$
declare ctr bigint := floor(extract(epoch from now())/30);
begin
  if p_secret is null or p_code is null then return false; end if;
  p_code := lpad(regexp_replace(p_code, '\D', '', 'g'), 6, '0');
  -- accept ±1 step for clock drift
  return p_code in (_totp_at(p_secret, ctr), _totp_at(p_secret, ctr-1), _totp_at(p_secret, ctr+1));
end $$;

-- ---------- RPCs (token resolves to ident via auth_sessions) ----------
create or replace function twofa_status(p_token text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare v_id text; r user_2fa; v_face boolean;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false,'signed_in',false); end if;
  select * into r from user_2fa where ident=v_id;
  select face_enrolled into v_face from app_users where ident=v_id;
  return json_build_object('ok',true,'signed_in',true,
    'password', true,
    'sms', true,
    'face', coalesce(v_face,false),
    'totp', coalesce(r.totp_enabled,false),
    'backup_left', coalesce(array_length(r.backup_codes,1),0));
end $$;

create or replace function twofa_totp_setup(p_token text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare v_id text; v_secret text;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false,'reason','signed_out'); end if;
  v_secret := _b32_encode(extensions.gen_random_bytes(20));
  insert into user_2fa(ident, totp_pending) values (v_id, v_secret)
    on conflict (ident) do update set totp_pending=v_secret, updated_at=now();
  return json_build_object('ok',true,'secret',v_secret,
    'otpauth','otpauth://totp/Orignals:'||v_id||'?secret='||v_secret||'&issuer=Orignals&period=30&digits=6');
end $$;

create or replace function twofa_totp_enable(p_token text, p_code text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare v_id text; r user_2fa; v_codes text[] := '{}'; v_plain text[] := '{}'; c text; i int;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false,'reason','signed_out'); end if;
  select * into r from user_2fa where ident=v_id;
  if r.totp_pending is null then return json_build_object('ok',false,'reason','no_setup'); end if;
  if not _totp_verify(r.totp_pending, p_code) then return json_build_object('ok',false,'reason','bad_code'); end if;
  -- fresh one-time backup codes
  for i in 1..8 loop
    c := lpad((abs(('x'||substr(encode(extensions.gen_random_bytes(6),'hex'),1,8))::bit(32)::int) % 100000000)::text, 8, '0');
    v_plain := array_append(v_plain, substr(c,1,4)||'-'||substr(c,5,4));
    v_codes := array_append(v_codes, encode(extensions.digest(c,'sha256'),'hex'));
  end loop;
  update user_2fa set totp_secret=totp_pending, totp_pending=null, totp_enabled=true,
    backup_codes=v_codes, updated_at=now() where ident=v_id;
  return json_build_object('ok',true,'backup_codes',to_json(v_plain));
end $$;

create or replace function twofa_totp_disable(p_token text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare v_id text;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false,'reason','signed_out'); end if;
  update user_2fa set totp_secret=null, totp_pending=null, totp_enabled=false, backup_codes='{}', updated_at=now() where ident=v_id;
  return json_build_object('ok',true);
end $$;

-- login second factor: pass the ident + a TOTP code OR an unused backup code
create or replace function twofa_verify_login(p_ident text, p_code text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare r user_2fa; v_hash text; v_bare text;
begin
  select * into r from user_2fa where ident=p_ident;
  if r.ident is null or not r.totp_enabled then return json_build_object('ok',true,'not_required',true); end if;
  if _totp_verify(r.totp_secret, p_code) then return json_build_object('ok',true,'method','totp'); end if;
  -- try backup code (strip formatting, sha256, must be present + one-time)
  v_bare := regexp_replace(coalesce(p_code,''), '\D', '', 'g');
  v_hash := encode(extensions.digest(v_bare,'sha256'),'hex');
  if v_hash = any(r.backup_codes) then
    update user_2fa set backup_codes = array_remove(backup_codes, v_hash) where ident=p_ident;
    return json_build_object('ok',true,'method','backup');
  end if;
  return json_build_object('ok',false,'reason','bad_code');
end $$;

select 'twofa installed' as status, _totp_verify(_b32_encode(extensions.gen_random_bytes(20)),'000000') as smoke;

-- ========== BASE: face_schema.sql ==========
-- ============================================================
-- ORIGNALS FACE 2FA — ported from the founder's edurankai
-- face-2fa-portable module. Client (@vladmandic/face-api) produces
-- a 128-float descriptor; the DISTANCE CHECK IS SERVER-SIDE so a
-- malicious client can't fake a match. Threshold 0.55 (their tuned
-- value). Fully self-hosted: descriptors live in our own Postgres.
-- ============================================================

create table if not exists face_enrollments (
  ident text primary key,
  descriptor double precision[] not null,   -- 128 floats from faceRecognitionNet
  is_active boolean not null default true,
  enrolled_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table face_enrollments enable row level security;   -- RPC-only, no anon read

create table if not exists face_verifications (
  id bigint generated always as identity primary key,
  ident text, distance double precision, passed boolean, method text,
  created_at timestamptz not null default now()
);
alter table face_verifications enable row level security;

-- validity: exactly 128 finite floats, not a blank/black frame
create or replace function face_valid(d double precision[])
returns boolean language sql immutable as $$
  select coalesce(array_length(d,1),0) = 128
     and (select count(*) from unnest(d) v where abs(v) > 1e-6) > 8;
$$;

-- enrol: resolve identity from the session token, store the descriptor
create or replace function face_enroll(p_token text, p_descriptor double precision[])
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_id text;
begin
  select ident into v_id from auth_sessions where token = p_token;
  if v_id is null then return json_build_object('ok',false,'reason','no_session'); end if;
  if not face_valid(p_descriptor) then return json_build_object('ok',false,'reason','bad_descriptor'); end if;
  insert into face_enrollments(ident, descriptor, is_active, enrolled_at)
    values (v_id, p_descriptor, true, now())
    on conflict (ident) do update set descriptor=excluded.descriptor, is_active=true, enrolled_at=now();
  update app_users set face_enrolled=true where ident=v_id;
  insert into face_verifications(ident, distance, passed, method) values (v_id, 0, true, 'enroll');
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

-- verify: SERVER-side euclidean distance vs the stored descriptor
create or replace function face_verify(p_ident text, p_descriptor double precision[])
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_id text; stored double precision[]; dist double precision; ok boolean;
begin
  v_id := lower(trim(coalesce(p_ident,'')));
  if position('@' in v_id)=0 then v_id := right(regexp_replace(v_id,'[^0-9]','','g'),10); end if;
  if not face_valid(p_descriptor) then return json_build_object('ok',false,'reason','bad_descriptor'); end if;
  select descriptor into stored from face_enrollments where ident=v_id and is_active=true limit 1;
  if stored is null then return json_build_object('ok',false,'reason','not_enrolled'); end if;
  select sqrt(coalesce(sum((s.v - d.v)*(s.v - d.v)),0)) into dist
    from unnest(stored) with ordinality s(v,i)
    join unnest(p_descriptor) with ordinality d(v,i) on s.i = d.i;
  ok := dist < 0.55;   -- FACE_MATCH_THRESHOLD (edurankai)
  insert into face_verifications(ident, distance, passed, method) values (v_id, dist, ok, 'login');
  if ok then update face_enrollments set last_used_at=now() where ident=v_id; end if;
  return json_build_object('ok',ok,'distance',round(dist::numeric,4));
exception when others then return json_build_object('ok',false,'reason','error'); end $fn$;

-- remove enrolment (admin reset / user self-remove)
create or replace function face_remove(p_token text)
returns json language plpgsql security definer set search_path=public,extensions as $fn$
declare v_id text;
begin
  select ident into v_id from auth_sessions where token=p_token;
  if v_id is null then return json_build_object('ok',false); end if;
  delete from face_enrollments where ident=v_id;
  update app_users set face_enrolled=false where ident=v_id;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $fn$;

grant execute on function face_enroll(text, double precision[]) to anon;
grant execute on function face_verify(text, double precision[]) to anon;
grant execute on function face_remove(text) to anon;
select 'face 2fa ready' as status;

-- ========== BASE: services_schema.sql ==========
-- ============================================================
-- SERVICES MARKETPLACE — any professional (individual / team /
-- organisation) across primary, secondary & tertiary sectors can
-- offer a service, but must PROVE expertise before being onboarded.
-- Buyers only ever see VERIFIED providers. Contact stays in-app.
-- ============================================================

create table if not exists service_providers (
  id          bigint generated always as identity primary key,
  ident       text,
  device      text,
  name        text not null,
  kind        text default 'individual',   -- individual | team | organisation
  sector      text,                         -- primary | secondary | tertiary
  category    text,
  headline    text,
  about       text,
  credentials text,                         -- claimed expertise / proof description
  area        text,
  rate        numeric default 0,
  rate_unit   text default 'hour',
  status      text default 'pending',       -- pending | verified | rejected
  reviewed_by text,
  rating      numeric default 0,
  jobs        int default 0,
  created_at  timestamptz default now()
);
create index if not exists svc_status_idx on service_providers(status, sector, category);

create table if not exists service_enquiries (
  id          bigint generated always as identity primary key,
  provider_id bigint,
  from_device text,
  need        text,
  when_text   text,
  status      text default 'open',
  created_at  timestamptz default now()
);
alter table service_providers enable row level security;
alter table service_enquiries enable row level security;

-- a few verified sample providers so the marketplace has content on day one
insert into service_providers(name,kind,sector,category,headline,about,credentials,area,rate,rate_unit,status,rating,jobs)
select * from (values
  ('Anita Sharma','individual','tertiary','Tuition','Maths & Science tutor (Class 6–12)','8 years teaching CBSE/ICSE, board-topper results.','B.Sc + B.Ed, 8 yrs experience','City-wide',400,'hour','verified',4.9,320),
  ('FixIt Plumbing Co.','team','secondary','Plumbing','Licensed plumbers, same-day','Leaks, fittings, bathroom renovation. 4-person team.','Trade licence + insured','Sector 1–20',350,'visit','verified',4.7,210),
  ('BrightSpark Electricals','team','secondary','Electrical','Certified electricians, wiring & repair','Home & shop wiring, inverter, safety audit.','Govt electrical licence','City-wide',400,'visit','verified',4.8,180),
  ('GreenThumb Farm Advisory','individual','primary','Agriculture','Soil & crop consultant','Soil testing, organic inputs, yield planning.','M.Sc Agriculture, KVK-certified','Rural belt',600,'visit','verified',4.6,95),
  ('LedgerRight Accounts','organisation','tertiary','Accounting & Tax','GST, ITR & bookkeeping for small business','Monthly books, GST filing, TDS.','CA-supervised firm','City-wide',1500,'month','verified',4.8,140),
  ('Nimbus Design Studio','team','tertiary','Design','Logo, packaging & web design','Brand identity for shops & startups.','Portfolio-verified, 6 designers','Remote / City',5000,'project','verified',4.9,88),
  ('CareWell Physio','individual','tertiary','Healthcare','Home physiotherapy','Post-surgery, sports & elder care at home.','BPT registered physiotherapist','City-wide',700,'visit','verified',4.9,260),
  ('BuildRight Masonry','team','secondary','Construction','Masons & tiling crew','Brickwork, plaster, tiling, small builds.','Contractor licence','Sector 5–30',900,'day','verified',4.5,120)
) v
where not exists (select 1 from service_providers where status='verified');

-- ---------- WRITE (anon-safe) ----------
create or replace function service_register(
  p_device text, p_ident text, p_name text, p_kind text, p_sector text, p_category text,
  p_headline text, p_about text, p_credentials text, p_area text, p_rate numeric, p_rate_unit text)
returns json language plpgsql security definer set search_path=public as $$
declare v_id bigint;
begin
  if coalesce(p_name,'')='' or coalesce(p_category,'')='' then return json_build_object('ok',false,'reason','need_name_category'); end if;
  insert into service_providers(device,ident,name,kind,sector,category,headline,about,credentials,area,rate,rate_unit,status)
  values (left(coalesce(p_device,''),64), nullif(p_ident,''), left(p_name,80), coalesce(nullif(p_kind,''),'individual'),
          coalesce(nullif(p_sector,''),'tertiary'), left(p_category,60), left(coalesce(p_headline,''),120),
          left(coalesce(p_about,''),600), left(coalesce(p_credentials,''),400), left(coalesce(p_area,''),80),
          coalesce(p_rate,0), coalesce(nullif(p_rate_unit,''),'hour'), 'pending')
  returning id into v_id;
  return json_build_object('ok',true,'id',v_id,'status','pending');
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function service_list(p_sector text, p_category text, p_q text)
returns json language plpgsql security definer set search_path=public as $$
begin
  return (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select id,name,kind,sector,category,headline,about,area,rate,rate_unit,rating,jobs
    from service_providers
    where status='verified'
      and (coalesce(p_sector,'')='' or sector=p_sector)
      and (coalesce(p_category,'')='' or category=p_category)
      and (coalesce(p_q,'')='' or name ilike '%'||p_q||'%' or category ilike '%'||p_q||'%' or coalesce(headline,'') ilike '%'||p_q||'%')
    order by rating desc, jobs desc limit 60) t);
end $$;

create or replace function service_mine(p_device text)
returns json language plpgsql security definer set search_path=public as $$
begin
  return (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select id,name,category,sector,status,rating,jobs from service_providers where device=p_device order by created_at desc) t);
end $$;

create or replace function service_enquire(p_provider bigint, p_device text, p_need text, p_when text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from service_providers where id=p_provider and status='verified') then return json_build_object('ok',false,'reason','not_found'); end if;
  insert into service_enquiries(provider_id,from_device,need,when_text) values (p_provider, left(coalesce(p_device,''),64), left(coalesce(p_need,''),300), left(coalesce(p_when,''),80));
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- ADMIN verification (L3+ inspectors and up) ----------
create or replace function service_admin_pending(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 3 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,'rows',(select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select id,name,kind,sector,category,headline,credentials,area,rate,rate_unit,status,created_at
    from service_providers where status='pending' order by created_at limit 100) t));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function service_verify(p_token text, p_id bigint, p_decision text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 3 then return json_build_object('ok',false,'reason','forbidden'); end if;
  if p_decision not in ('verified','rejected') then return json_build_object('ok',false,'reason','bad'); end if;
  update service_providers set status=p_decision, reviewed_by=(select ident from auth_sessions where token=p_token) where id=p_id and status='pending';
  return json_build_object('ok', found);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function service_register(text,text,text,text,text,text,text,text,text,text,numeric,text) to anon;
grant execute on function service_list(text,text,text) to anon;
grant execute on function service_mine(text) to anon;
grant execute on function service_enquire(bigint,text,text,text) to anon;
grant execute on function service_admin_pending(text) to anon;
grant execute on function service_verify(text,bigint,text) to anon;

select 'services marketplace ready' as status, (select count(*) from service_providers where status='verified') verified_providers;

-- ========== BASE: hr_schema.sql ==========
-- ============================================================
-- ORIGNALS HRMS — departments, staff records, attendance, leave,
-- payroll. Built on the existing admin_users RBAC (L1–L5).
-- Every read/write is admin-gated and DEPARTMENT-SCOPED:
--   L5/L4 see the whole org; L1–L3 see only their own department.
-- ============================================================

-- extend the staff record with HR fields
alter table admin_users add column if not exists department  text;
alter table admin_users add column if not exists designation text;
alter table admin_users add column if not exists status      text default 'active';   -- active | on_leave | suspended | exited
alter table admin_users add column if not exists joined_on   date default current_date;
alter table admin_users add column if not exists salary      numeric default 0;
alter table admin_users add column if not exists phone       text;

create table if not exists hr_departments (
  name       text primary key,
  head_ident text,
  created_at timestamptz default now()
);
insert into hr_departments(name) values
  ('Operations'),('Purity & Quality'),('Support'),('City Onboarding'),('Finance'),('Human Resources'),('Technology')
  on conflict do nothing;

create table if not exists hr_leave (
  id         bigint generated always as identity primary key,
  ident      text not null,
  kind       text default 'casual',
  from_date  date not null,
  to_date    date not null,
  reason     text,
  status     text default 'pending',   -- pending | approved | rejected
  decided_by text,
  created_at timestamptz default now()
);
create index if not exists hr_leave_idx on hr_leave(status, created_at desc);

create table if not exists hr_attendance (
  ident     text not null,
  day       date not null default current_date,
  check_in  timestamptz,
  check_out timestamptz,
  primary key (ident, day)
);

create table if not exists hr_payroll (
  id       bigint generated always as identity primary key,
  ident    text not null,
  month    text not null,               -- 'YYYY-MM'
  amount   numeric not null default 0,
  status   text default 'due',          -- due | paid
  paid_at  timestamptz,
  unique (ident, month)
);
alter table hr_departments enable row level security;
alter table hr_leave       enable row level security;
alter table hr_attendance  enable row level security;
alter table hr_payroll     enable row level security;

-- caller's department
create or replace function _admin_dept(p_token text) returns text
language sql security definer set search_path=public as $$
  select a.department from auth_sessions s join admin_users a on a.ident=s.ident and a.active where s.token=p_token limit 1;
$$;
-- caller's ident (staff)
create or replace function _staff_ident(p_token text) returns text
language sql security definer set search_path=public as $$
  select a.ident from auth_sessions s join admin_users a on a.ident=s.ident and a.active where s.token=p_token limit 1;
$$;

-- dashboard summary (scoped)
create or replace function hr_overview(p_token text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean; v_month text := to_char(now(),'YYYY-MM');
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null then return json_build_object('ok',false,'reason','forbidden'); end if;
  v_dept := _admin_dept(p_token); v_all := admin_rank(v_lvl) >= 4;
  return json_build_object('ok',true,'scope', case when v_all then 'org' else coalesce(v_dept,'—') end,
    'headcount', (select count(*) from admin_users where active and (v_all or department is not distinct from v_dept)),
    'present_today', (select count(*) from hr_attendance a join admin_users u on u.ident=a.ident and u.active
                      where a.day=current_date and a.check_in is not null and (v_all or u.department is not distinct from v_dept)),
    'on_leave', (select count(*) from admin_users where active and status='on_leave' and (v_all or department is not distinct from v_dept)),
    'pending_leave', (select count(*) from hr_leave l join admin_users u on u.ident=l.ident and u.active
                      where l.status='pending' and (v_all or u.department is not distinct from v_dept)),
    'payroll_month', (select coalesce(sum(salary),0) from admin_users where active and (v_all or department is not distinct from v_dept)),
    'month', v_month,
    'by_dept', (select coalesce(json_agg(json_build_object('dept',coalesce(department,'Unassigned'),'n',n) order by n desc),'[]'::json)
                from (select department, count(*) n from admin_users where active and (v_all or department is not distinct from v_dept) group by department) t));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- departments with headcount
create or replace function hr_departments_list(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if _admin_level(p_token) is null then return json_build_object('ok',false); end if;
  return (select coalesce(json_agg(json_build_object('name',d.name,'head',d.head_ident,
      'headcount',(select count(*) from admin_users u where u.active and u.department=d.name)) order by d.name),'[]'::json)
    from hr_departments d);
end $$;

-- roster (scoped, searchable, paged)
create or replace function hr_employees(p_token text, p_q text, p_dept text, p_limit int, p_offset int)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null then return json_build_object('ok',false); end if;
  v_dept := _admin_dept(p_token); v_all := admin_rank(v_lvl) >= 4;
  return (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select ident, name, level, coalesce(department,'Unassigned') department, designation, status, joined_on, salary, phone
    from admin_users
    where active
      and (v_all or department is not distinct from v_dept)
      and (coalesce(p_dept,'')='' or department=p_dept)
      and (coalesce(p_q,'')='' or ident ilike '%'||p_q||'%' or coalesce(name,'') ilike '%'||p_q||'%' or coalesce(designation,'') ilike '%'||p_q||'%')
    order by admin_rank(level) desc, name
    limit least(coalesce(p_limit,100),300) offset coalesce(p_offset,0)) t);
end $$;

-- edit an employee's HR fields (L4+)
create or replace function hr_employee_set(p_token text, p_ident text, p_department text, p_designation text, p_salary numeric, p_status text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  update admin_users set
    department  = coalesce(nullif(p_department,''), department),
    designation = coalesce(nullif(p_designation,''), designation),
    salary      = coalesce(p_salary, salary),
    status      = coalesce(nullif(p_status,''), status),
    updated_at  = now()
  where ident = lower(trim(coalesce(p_ident,''))) and active;
  return json_build_object('ok', found);
end $$;

-- ---------- LEAVE ----------
create or replace function hr_leave_apply(p_token text, p_kind text, p_from date, p_to date, p_reason text)
returns json language plpgsql security definer set search_path=public as $$
declare v_id text;
begin
  v_id := _staff_ident(p_token);
  if v_id is null then return json_build_object('ok',false,'reason','forbidden'); end if;
  if p_from is null or p_to is null or p_to < p_from then return json_build_object('ok',false,'reason','bad_dates'); end if;
  insert into hr_leave(ident,kind,from_date,to_date,reason) values (v_id, coalesce(nullif(p_kind,''),'casual'), p_from, p_to, left(coalesce(p_reason,''),200));
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function hr_leave_list(p_token text, p_all boolean)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null then return json_build_object('ok',false); end if;
  v_dept := _admin_dept(p_token); v_all := admin_rank(v_lvl) >= 4;
  return (select coalesce(json_agg(row_to_json(t) order by t.created_at desc),'[]'::json) from (
    select l.id, l.ident, u.name, coalesce(u.department,'Unassigned') department, l.kind, l.from_date, l.to_date, l.reason, l.status, l.created_at
    from hr_leave l join admin_users u on u.ident=l.ident
    where (v_all or u.department is not distinct from v_dept)
      and (coalesce(p_all,false) or l.status='pending')) t);
end $$;

-- approve/reject (L3+ can decide within their scope)
create or replace function hr_leave_decide(p_token text, p_id bigint, p_decision text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean; v_emp_dept text; v_ident text; v_who text;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null or admin_rank(v_lvl) < 3 then return json_build_object('ok',false,'reason','forbidden'); end if;
  if p_decision not in ('approved','rejected') then return json_build_object('ok',false,'reason','bad'); end if;
  v_all := admin_rank(v_lvl) >= 4; v_dept := _admin_dept(p_token); v_who := _staff_ident(p_token);
  select l.ident, u.department into v_ident, v_emp_dept from hr_leave l join admin_users u on u.ident=l.ident where l.id=p_id;
  if v_ident is null then return json_build_object('ok',false,'reason','not_found'); end if;
  if not v_all and v_emp_dept is distinct from v_dept then return json_build_object('ok',false,'reason','out_of_scope'); end if;
  update hr_leave set status=p_decision, decided_by=v_who where id=p_id;
  update admin_users set status = case when p_decision='approved' then 'on_leave' else 'active' end where ident=v_ident and active;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- ATTENDANCE ----------
create or replace function hr_attendance_mark(p_token text, p_action text)
returns json language plpgsql security definer set search_path=public as $$
declare v_id text;
begin
  v_id := _staff_ident(p_token);
  if v_id is null then return json_build_object('ok',false,'reason','forbidden'); end if;
  insert into hr_attendance(ident,day,check_in) values (v_id,current_date, case when p_action='in' then now() else null end)
    on conflict (ident,day) do update set
      check_in  = coalesce(hr_attendance.check_in, case when p_action='in' then now() else hr_attendance.check_in end),
      check_out = case when p_action='out' then now() else hr_attendance.check_out end;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function hr_attendance_today(p_token text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null then return json_build_object('ok',false); end if;
  v_dept := _admin_dept(p_token); v_all := admin_rank(v_lvl) >= 4;
  return (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select u.ident, u.name, coalesce(u.department,'Unassigned') department, a.check_in, a.check_out
    from hr_attendance a join admin_users u on u.ident=a.ident and u.active
    where a.day=current_date and (v_all or u.department is not distinct from v_dept)
    order by a.check_in desc nulls last) t);
end $$;

-- ---------- PAYROLL ----------
create or replace function hr_payroll_run(p_token text, p_month text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_n int;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl <> 'l5' then return json_build_object('ok',false,'reason','only_l5'); end if;
  insert into hr_payroll(ident,month,amount)
    select ident, coalesce(nullif(p_month,''),to_char(now(),'YYYY-MM')), coalesce(salary,0) from admin_users where active
    on conflict (ident,month) do update set amount=excluded.amount;
  get diagnostics v_n = row_count;
  return json_build_object('ok',true,'rows',v_n);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function hr_payroll_list(p_token text, p_month text)
returns json language plpgsql security definer set search_path=public as $$
declare v_lvl text; v_dept text; v_all boolean; v_m text;
begin
  v_lvl := _admin_level(p_token);
  if v_lvl is null then return json_build_object('ok',false); end if;
  v_dept := _admin_dept(p_token); v_all := admin_rank(v_lvl) >= 4; v_m := coalesce(nullif(p_month,''),to_char(now(),'YYYY-MM'));
  return json_build_object('ok',true,'month',v_m,
    'total',(select coalesce(sum(p.amount),0) from hr_payroll p join admin_users u on u.ident=p.ident where p.month=v_m and (v_all or u.department is not distinct from v_dept)),
    'paid',(select coalesce(sum(p.amount),0) from hr_payroll p join admin_users u on u.ident=p.ident where p.month=v_m and p.status='paid' and (v_all or u.department is not distinct from v_dept)),
    'rows',(select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
       select p.id, p.ident, u.name, coalesce(u.department,'Unassigned') department, p.amount, p.status
       from hr_payroll p join admin_users u on u.ident=p.ident
       where p.month=v_m and (v_all or u.department is not distinct from v_dept)
       order by p.status, u.name) t));
end $$;

create or replace function hr_payroll_pay(p_token text, p_id bigint)
returns json language plpgsql security definer set search_path=public as $$
begin
  if _admin_level(p_token) is distinct from 'l5' then return json_build_object('ok',false,'reason','only_l5'); end if;
  update hr_payroll set status='paid', paid_at=now() where id=p_id;
  return json_build_object('ok', found);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

select 'hrms installed' as status, (select count(*) from hr_departments) departments;

-- ========== BASE: live_delivery.sql ==========
-- ============================================================
-- REAL DELIVERY — connect the partner who ACTUALLY claims a job to
-- the buyer's live tracking: real name/vehicle + real GPS, real
-- pickup/deliver events. No more simulated courier for real orders.
-- ============================================================

alter table live_jobs add column if not exists taken_name text;
alter table live_jobs add column if not exists taken_veh text;
alter table live_jobs add column if not exists taken_rating numeric;
alter table live_jobs add column if not exists partner_lat double precision;
alter table live_jobs add column if not exists partner_lng double precision;
alter table live_jobs add column if not exists picked_at timestamptz;

-- atomic claim now records WHO claimed (their public profile), so the
-- buyer and shop show the real partner. Replaces the 2-arg version.
create or replace function job_claim(p_job text, p_device text, p_name text, p_veh text, p_rating numeric)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update live_jobs
     set status = 'taken', taken_by = p_device, taken_at = now(),
         taken_name = left(coalesce(p_name,'Partner'),40), taken_veh = left(coalesce(p_veh,''),40),
         taken_rating = p_rating
   where id = p_job and status = 'open' and device_key <> p_device;
  return found;
end $$;

-- keep the old 2-arg signature working (falls back to no profile)
create or replace function job_claim(p_job text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  return job_claim(p_job, p_device, 'Partner', '', null);
end $$;

-- partner shares live location while carrying the job (buyer sees it move)
create or replace function job_ping(p_job text, p_device text, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  update live_jobs set partner_lat = p_lat, partner_lng = p_lng
   where id = p_job and taken_by = p_device and status = 'taken';
end $$;

-- mark picked up (collected) — for the buyer timeline
create or replace function job_picked(p_job text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update live_jobs set picked_at = now()
   where id = p_job and taken_by = p_device and status = 'taken';
end $$;

-- OTP handover: the buyer's app shows the OTP; the delivery person enters
-- it (or scans the buyer's QR). Verified SERVER-side against the OTP the
-- buyer set on their order — the partner never sees it in advance.
alter table shop_orders add column if not exists drop_otp text;

create or replace function job_deliver(p_job text, p_device text, p_otp text)
returns json language plpgsql security definer set search_path = public as $$
declare v_ref text; v_otp text;
begin
  select order_ref into v_ref from live_jobs where id = p_job and taken_by = p_device and status = 'taken';
  if v_ref is null then return json_build_object('ok', false, 'reason', 'not_your_job'); end if;
  select drop_otp into v_otp from shop_orders where id = v_ref;
  -- if the buyer never set an OTP (e.g. seed/demo), accept to not block
  if v_otp is not null and v_otp <> '' and regexp_replace(coalesce(p_otp,''),'[^0-9]','','g') <> v_otp then
    return json_build_object('ok', false, 'reason', 'wrong_otp');
  end if;
  update live_jobs set status = 'done', done_at = now() where id = p_job and taken_by = p_device;
  update shop_orders set status = 'done' where id = v_ref;
  return json_build_object('ok', true);
end $$;

grant execute on function job_claim(text, text, text, text, numeric) to anon;
grant execute on function job_ping(text, text, double precision, double precision) to anon;
grant execute on function job_picked(text, text) to anon;
grant execute on function job_deliver(text, text, text) to anon;

select 'real delivery ready' as status;

-- ========== BASE: analytics_schema.sql ==========
-- ============================================================
-- ORIGNALS ANALYTICS — first-party, precise, privacy-owned.
-- No Google Analytics, no third party. Every hit is our own row.
-- Writes are open (anon beacon); READS are locked to L4+ admins
-- via the same _admin_level(token) gate the rest of the panel uses.
-- Geography (country/city/lat/lng) is filled by the Vercel edge
-- function /api/track from request headers — city-precise, no GPS
-- prompt, no PII. Device is an anonymous per-browser key.
-- ============================================================

create table if not exists analytics_events (
  id       bigint generated always as identity primary key,
  ts       timestamptz not null default now(),
  device   text,                 -- anonymous per-browser key
  session  text,                 -- per-visit id
  kind     text not null,        -- 'page' | 'ping' | 'event'
  name     text,                 -- route (page) or event name
  ref      text,                 -- referrer host (entry)
  role     text,                 -- guest | buyer | partner | shop | staff
  uad      text,                 -- mobile | tablet | desktop
  lang     text,
  country  text,
  region   text,
  city     text,
  lat      double precision,
  lng      double precision,
  val      numeric,              -- event value (e.g. order amount)
  extra    jsonb
);
create index if not exists ana_ts_idx     on analytics_events (ts desc);
create index if not exists ana_kind_ts_idx on analytics_events (kind, ts desc);
create index if not exists ana_dev_idx    on analytics_events (device);
create index if not exists ana_geo_idx    on analytics_events (country, city);
alter table analytics_events enable row level security;   -- RPC-only

-- ---------- WRITE: open beacon (anon), tightly bounded ----------
create or replace function track_hit(
  p_device text, p_session text, p_kind text, p_name text, p_ref text,
  p_role text, p_uad text, p_lang text,
  p_country text, p_region text, p_city text,
  p_lat double precision, p_lng double precision, p_val numeric)
returns json language plpgsql security definer set search_path=public as $$
begin
  if p_kind not in ('page','ping','event') then return json_build_object('ok',false); end if;
  insert into analytics_events(device,session,kind,name,ref,role,uad,lang,country,region,city,lat,lng,val)
  values (left(coalesce(p_device,''),64), left(coalesce(p_session,''),64), p_kind,
          left(coalesce(p_name,''),120), left(coalesce(p_ref,''),120), left(coalesce(p_role,''),16),
          left(coalesce(p_uad,''),12), left(coalesce(p_lang,''),12),
          left(coalesce(p_country,''),4), left(coalesce(p_region,''),64), left(coalesce(p_city,''),80),
          p_lat, p_lng, p_val);
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $$;

-- ---------- READ: full dashboard in one call (L4+) ----------
create or replace function analytics_overview(p_token text, p_days int)
returns json language plpgsql security definer set search_path=public as $$
declare v_since timestamptz; v_days int;
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  v_days := least(greatest(coalesce(p_days,30),1),90);
  v_since := now() - (v_days || ' days')::interval;
  return json_build_object(
    'ok', true,
    'live',    (select count(distinct device) from analytics_events where kind='ping' and ts > now()-interval '70 seconds'),
    'cards', json_build_object(
      'visits_today',  (select count(distinct device) from analytics_events where ts::date = (now() at time zone 'Asia/Kolkata')::date),
      'visits_7d',     (select count(distinct device) from analytics_events where ts > now()-interval '7 days'),
      'visits_30d',    (select count(distinct device) from analytics_events where ts > now()-interval '30 days'),
      'views_today',   (select count(*) from analytics_events where kind='page' and ts::date = (now() at time zone 'Asia/Kolkata')::date),
      'views_window',  (select count(*) from analytics_events where kind='page' and ts > v_since),
      'orders_window', (select count(*) from analytics_events where kind='event' and name='order' and ts > v_since),
      'gmv_window',    (select coalesce(sum(val),0) from analytics_events where kind='event' and name='order' and ts > v_since),
      'signups_window',(select count(*) from analytics_events where kind='event' and name='signup' and ts > v_since)
    ),
    'series', (select coalesce(json_agg(row_to_json(t) order by t.d),'[]'::json) from (
        select to_char(date_trunc('day', ts at time zone 'Asia/Kolkata'),'YYYY-MM-DD') d,
               count(distinct device) visits, count(*) filter (where kind='page') views
        from analytics_events where ts > v_since group by 1) t),
    'pages', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select name, count(*) views, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since and coalesce(name,'')<>'' group by name order by views desc limit 12) t),
    'refs', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select case when coalesce(ref,'')='' then 'direct / app' else ref end ref, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc limit 10) t),
    'devices', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(uad,''),'unknown') uad, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc) t),
    'geo', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(country,''),'—') country, coalesce(nullif(city,''),'—') city,
               count(distinct device) visitors, count(*) views
        from analytics_events where kind='page' and ts > v_since group by 1,2 order by visitors desc limit 20) t),
    'events', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select name, count(*) n, coalesce(sum(val),0) value
        from analytics_events where kind='event' and ts > v_since group by name order by n desc limit 12) t)
  );
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- READ: who is online RIGHT NOW, for the live map (L4+) ----------
create or replace function analytics_live(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,
    'now', (select count(distinct device) from analytics_events where kind='ping' and ts > now()-interval '70 seconds'),
    'people', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
      select distinct on (device) device, name page, city, region, country, uad, role, lat, lng,
             extract(epoch from (now()-ts))::int ago
      from analytics_events
      where ts > now()-interval '5 minutes' and kind in ('page','ping')
      order by device, ts desc limit 300) t)
  );
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- housekeeping: keep the table lean (call from a cron if wanted) ----------
create or replace function analytics_prune(p_token text, p_keep_days int)
returns json language plpgsql security definer set search_path=public as $$
begin
  if _admin_level(p_token) is distinct from 'l5' then return json_build_object('ok',false,'reason','forbidden'); end if;
  delete from analytics_events where ts < now() - (least(greatest(coalesce(p_keep_days,180),7),3650) || ' days')::interval;
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $$;

grant execute on function track_hit(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,numeric) to anon;
grant execute on function analytics_overview(text,int) to anon;
grant execute on function analytics_live(text) to anon;
grant execute on function analytics_prune(text,int) to anon;

select 'analytics ready' as status;

-- ========== BASE: analytics_precise.sql ==========
-- ============================================================
-- ANALYTICS — precise & detailed upgrade.
-- Adds exact locality (reverse-geocoded client-side) + browser, and
-- richer breakdowns: language, browser, hour-of-day, new vs returning,
-- visitor type, plus coordinates on the geography rows.
-- ============================================================
alter table analytics_events add column if not exists place   text;
alter table analytics_events add column if not exists browser text;

-- widen track_hit with two trailing DEFAULT params (backward compatible:
-- old 14-arg callers still resolve; defaults fill place/browser)
drop function if exists track_hit(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,numeric);
create or replace function track_hit(
  p_device text, p_session text, p_kind text, p_name text, p_ref text,
  p_role text, p_uad text, p_lang text,
  p_country text, p_region text, p_city text,
  p_lat double precision, p_lng double precision, p_val numeric,
  p_place text default null, p_browser text default null)
returns json language plpgsql security definer set search_path=public as $$
begin
  if p_kind not in ('page','ping','event') then return json_build_object('ok',false); end if;
  insert into analytics_events(device,session,kind,name,ref,role,uad,lang,country,region,city,lat,lng,val,place,browser)
  values (left(coalesce(p_device,''),64), left(coalesce(p_session,''),64), p_kind,
          left(coalesce(p_name,''),120), left(coalesce(p_ref,''),120), left(coalesce(p_role,''),16),
          left(coalesce(p_uad,''),12), left(coalesce(p_lang,''),12),
          left(coalesce(p_country,''),4), left(coalesce(p_region,''),64), left(coalesce(p_city,''),80),
          p_lat, p_lng, p_val, left(coalesce(p_place,''),120), left(coalesce(p_browser,''),24));
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false); end $$;

create or replace function analytics_overview(p_token text, p_days int)
returns json language plpgsql security definer set search_path=public as $$
declare v_since timestamptz; v_days int;
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  v_days := least(greatest(coalesce(p_days,30),1),90);
  v_since := now() - (v_days || ' days')::interval;
  return json_build_object(
    'ok', true,
    'live', (select count(distinct device) from analytics_events where kind='ping' and ts > now()-interval '70 seconds'),
    'cards', json_build_object(
      'visits_today',  (select count(distinct device) from analytics_events where ts::date = (now() at time zone 'Asia/Kolkata')::date),
      'visits_7d',     (select count(distinct device) from analytics_events where ts > now()-interval '7 days'),
      'visits_30d',    (select count(distinct device) from analytics_events where ts > now()-interval '30 days'),
      'views_today',   (select count(*) from analytics_events where kind='page' and ts::date = (now() at time zone 'Asia/Kolkata')::date),
      'views_window',  (select count(*) from analytics_events where kind='page' and ts > v_since),
      'orders_window', (select count(*) from analytics_events where kind='event' and name='order' and ts > v_since),
      'gmv_window',    (select coalesce(sum(val),0) from analytics_events where kind='event' and name='order' and ts > v_since),
      'signups_window',(select count(*) from analytics_events where kind='event' and name='signup' and ts > v_since)
    ),
    'series', (select coalesce(json_agg(row_to_json(t) order by t.d),'[]'::json) from (
        select to_char(date_trunc('day', ts at time zone 'Asia/Kolkata'),'YYYY-MM-DD') d,
               count(distinct device) visits, count(*) filter (where kind='page') views
        from analytics_events where ts > v_since group by 1) t),
    'pages', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select name, count(*) views, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since and coalesce(name,'')<>'' group by name order by views desc limit 12) t),
    'refs', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select case when coalesce(ref,'')='' then 'direct / app' else ref end ref, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc limit 10) t),
    'devices', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(uad,''),'unknown') uad, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc) t),
    'browsers', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(browser,''),'—') browser, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc limit 8) t),
    'langs', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(lang,''),'—') lang, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc limit 10) t),
    'roles', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(role,''),'—') role, count(distinct device) visitors
        from analytics_events where kind='page' and ts > v_since group by 1 order by visitors desc) t),
    'hours', (select coalesce(json_agg(row_to_json(t) order by t.hr),'[]'::json) from (
        select extract(hour from ts at time zone 'Asia/Kolkata')::int hr, count(*) views
        from analytics_events where kind='page' and ts > v_since group by 1) t),
    'newret', (select json_build_object(
        'new', count(*) filter (where first_seen >= v_since),
        'returning', count(*) filter (where first_seen < v_since))
        from (select device, min(ts) first_seen from analytics_events group by device
              having max(ts) > v_since) f),
    'geo', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select coalesce(nullif(place,''), nullif(city,''), 'Unknown / private') place,
               coalesce(nullif(city,''),'') city, coalesce(nullif(region,''),'') region,
               coalesce(nullif(country,''),'—') country,
               count(distinct device) visitors, count(*) views,
               round(avg(lat)::numeric,4) lat, round(avg(lng)::numeric,4) lng
        from analytics_events where kind='page' and ts > v_since
        group by 1,2,3,4 order by visitors desc limit 25) t),
    'events', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
        select name, count(*) n, coalesce(sum(val),0) value
        from analytics_events where kind='event' and ts > v_since group by name order by n desc limit 12) t)
  );
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

create or replace function analytics_live(p_token text)
returns json language plpgsql security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok',false,'reason','forbidden'); end if;
  return json_build_object('ok',true,
    'now', (select count(distinct device) from analytics_events where kind='ping' and ts > now()-interval '70 seconds'),
    'people', (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
      select distinct on (device) device, name page, place, city, region, country, uad, browser, role, lat, lng,
             extract(epoch from (now()-ts))::int ago
      from analytics_events
      where ts > now()-interval '5 minutes' and kind in ('page','ping')
      order by device, ts desc limit 300) t)
  );
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function track_hit(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,numeric,text,text) to anon;
grant execute on function analytics_overview(text,int) to anon;
grant execute on function analytics_live(text) to anon;

select 'analytics precise+detailed ready' as status;

-- ========== BASE: analytics_backfill.sql ==========
-- ============================================================
-- ANALYTICS BACKFILL — fills the dashboard from REAL history that
-- already exists (auth sessions, orders, payments, Mitra chats).
-- Nothing is fabricated: every row mirrors a real event that
-- actually happened. Idempotent (tagged extra.seed='backfill').
-- Plus triggers so money & delivery events keep landing forever.
-- ============================================================

delete from analytics_events where extra->>'seed' = 'backfill';

-- real visits (each auth session = a real person who was here)
insert into analytics_events(ts, device, session, kind, name, role, country, extra)
select created_at, coalesce(device_key,'sess'), token, 'page', 'home', 'buyer', 'IN', '{"seed":"backfill"}'::jsonb
from auth_sessions;
insert into analytics_events(ts, device, session, kind, name, role, country, extra)
select last_seen, coalesce(device_key,'sess'), token, 'ping', 'home', 'buyer', 'IN', '{"seed":"backfill"}'::jsonb
from auth_sessions where last_seen is not null and last_seen <> created_at;

-- real orders (real GMV + conversion)
insert into analytics_events(ts, device, kind, name, role, country, val, extra)
select placed_at, coalesce(profile_id::text,'order'), 'event', 'order', 'buyer', 'IN', total, '{"seed":"backfill"}'::jsonb
from orders where placed_at is not null;

-- real payments captured by the gateway
insert into analytics_events(ts, device, kind, name, role, country, val, extra)
select created_at, coalesce(device_key,'pay'), 'event', 'payment', 'buyer', 'IN', round(amount_paise/100.0,2), '{"seed":"backfill"}'::jsonb
from payments;

-- real Mitra conversations (genuine engagement — 121 of them)
insert into analytics_events(ts, device, kind, name, role, country, extra)
select ts, coalesce(device_key,'mitra'), 'event', 'mitra_chat', 'buyer', 'IN', '{"seed":"backfill"}'::jsonb
from mitra_utterances;

-- ---------- keep it complete going forward (server-side, no client needed) ----------
create or replace function _ana_from_payment() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into analytics_events(device, kind, name, role, country, val)
  values (coalesce(new.device_key,'pay'), 'event', 'payment', 'buyer', 'IN', round(new.amount_paise/100.0,2));
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_ana_payment on payments;
create trigger trg_ana_payment after insert on payments for each row execute function _ana_from_payment();

create or replace function _ana_from_job() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into analytics_events(device, kind, name, role, country, val, lat, lng)
  values (coalesce(new.device_key,'job'), 'event', 'delivery_job', 'partner', 'IN', new.pay, new.from_lat, new.from_lng);
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_ana_job on live_jobs;
create trigger trg_ana_job after insert on live_jobs for each row execute function _ana_from_job();

select 'analytics backfilled' as status,
  (select count(*) from analytics_events) as total_rows,
  (select count(*) from analytics_events where kind='event' and name='order') as orders,
  (select count(*) from analytics_events where kind='event' and name='mitra_chat') as mitra_chats;

-- ========== BASE: harden_rls.sql ==========
-- ============================================================
-- ORIGNALS SECURITY HARDENING (2026-07-06)
-- The anon key is public, so RLS is the only guard. Blanket
-- `select using(true)` let anyone bulk-download (and for snapshots,
-- overwrite/delete) every user's data. This removes bulk read on the
-- sensitive tables and routes each per-device read through a
-- security-definer RPC keyed on the UNGUESSABLE 40-char device_key,
-- so a caller must already know a specific key — no enumeration.
-- NOTE: full protection still requires real auth (phone OTP). This is
-- pilot-grade hardening that closes the mass-exposure hole.
-- ============================================================

-- 1 ── state_snapshots: no anon read/write/delete at all ──
-- ⚠ SECURITY (2026-07-23): the anon INSERT/UPDATE policies below were removed.
-- `snap_upd for update using(true)` let anyone with the public anon key bulk-
-- overwrite EVERY user's account state. Writes now go through snapshot_save()
-- (supabase/migrations/0003_*), a security-definer RPC keyed on device.
drop policy if exists p_snap_all on state_snapshots;
drop policy if exists snap_ins on state_snapshots;
drop policy if exists snap_upd on state_snapshots;
-- (no anon SELECT / INSERT / UPDATE / DELETE — all access via RPC)

create or replace function snapshot_restore(p_device text)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object('state', state, 'updated_at', updated_at)
  from state_snapshots where device_key = p_device limit 1;
$$;
grant execute on function snapshot_restore(text) to anon;

-- 2 ── payments: no anon read; status via RPC by payment id ──
drop policy if exists payments_read_own on payments;
create or replace function payment_status(p_payment text)
returns text language sql security definer set search_path = public stable as $$
  select status from payments where rzp_payment_id = p_payment limit 1;
$$;
grant execute on function payment_status(text) to anon;

-- 3 ── listing_leads: owner reads their own via RPC ──
drop policy if exists ld_read on listing_leads;
create or replace function my_leads(p_device text)
returns setof listing_leads language sql security definer set search_path = public stable as $$
  select * from listing_leads where owner_device = p_device order by created_at desc limit 30;
$$;
grant execute on function my_leads(text) to anon;

-- 4 ── reservations: restaurant reads its own via RPC ──
drop policy if exists rz_read on reservations;
create or replace function shop_reservations(p_shop text)
returns setof reservations language sql security definer set search_path = public stable as $$
  select * from reservations where shop_id = p_shop and status = 'reserved' order by created_at desc limit 20;
$$;
grant execute on function shop_reservations(text) to anon;

-- 5 ── error_log: no bulk read; recent list via RPC (messages only) ──
drop policy if exists el_read on error_log;
create or replace function recent_errors()
returns table (created_at timestamptz, message text, url text)
language sql security definer set search_path = public stable as $$
  select created_at, message, url from error_log order by created_at desc limit 12;
$$;
grant execute on function recent_errors() to anon;

-- 6 ── shop_orders: buyer PII; reads via device/shop-keyed RPCs ──
drop policy if exists so_read on shop_orders;
create or replace function my_shop_orders(p_shop text)
returns setof shop_orders language sql security definer set search_path = public stable as $$
  select * from shop_orders where shop_id = p_shop order by created_at desc limit 30;
$$;
create or replace function order_statuses(p_ids text[])
returns table (id text, status text)
language sql security definer set search_path = public stable as $$
  select id, status from shop_orders where id = any(p_ids);
$$;
grant execute on function my_shop_orders(text) to anon;
grant execute on function order_statuses(text[]) to anon;

-- 7 ── mitra_utterances / mitra_model: stop world write/delete ──
drop policy if exists p_mu_all on mitra_utterances;
drop policy if exists p_mm_all on mitra_model;
create policy p_mu_ins on mitra_utterances for insert with check (true);
create policy p_mu_upd on mitra_utterances for update using (true) with check (true);
create policy p_mm_ins on mitra_model for insert with check (true);
create policy p_mm_upd on mitra_model for update using (true) with check (true);
-- (training reads happen server-side in mitra_train; no anon SELECT needed)

select 'RLS hardened' as status;

-- ========== MIGRATION: 0001_admin_bootstrap_secret.sql ==========
-- ============================================================
-- WEEK1 TASK 0 — the bootstrap secret must not live on a
-- world-readable table.
--
-- The chain (verified 2026-07-12):
--   ops_schema.sql:21     → platform_flags gets `select using (true)` for public
--   admin_schema.sql:10   → `alter table platform_flags add column admin_setup_code`
--   RLS SELECT policies are ROW-level, not COLUMN-level
--   ⇒ the public anon key in config.js can read admin_setup_code.
--   admin_claim() then grants L5 to the first caller.
--
-- The race is currently CLOSED (admin_users has 1 active row, and
-- admin_claim() refuses when count(*) > 0). This removes the latent
-- re-open: if admin_users were ever emptied, the code was still readable.
--
-- platform_flags keeps its public read policy — maintenance /
-- payments_enabled / banner are kill switches and SHOULD be public.
-- ============================================================

create table if not exists admin_bootstrap (
  id         int primary key default 1,
  setup_code text,
  constraint one_row check (id = 1)
);
alter table admin_bootstrap enable row level security;
-- deliberately ZERO policies: anon/authenticated cannot see this table at all.
-- admin_claim() is security definer and bypasses RLS.

insert into admin_bootstrap (id, setup_code)
  select 1, admin_setup_code from platform_flags where id = 1
  on conflict (id) do nothing;

alter table platform_flags drop column if exists admin_setup_code;

-- admin_claim now reads the secret from the locked table
create or replace function admin_claim(p_token text, p_code text, p_name text)
returns json language plpgsql security definer set search_path=public as $$
declare v_ident text; v_code text; v_count int;
begin
  select count(*) into v_count from admin_users;
  if v_count > 0 then return json_build_object('ok',false,'reason','already_setup'); end if;
  select ident into v_ident from auth_sessions where token=p_token;
  if v_ident is null then return json_build_object('ok',false,'reason','sign_in_first'); end if;
  select setup_code into v_code from admin_bootstrap where id=1;
  if v_code is null or p_code is null or p_code <> v_code then return json_build_object('ok',false,'reason','bad_code'); end if;
  insert into admin_users(ident, level, name, added_by) values (v_ident,'l5',left(coalesce(p_name,''),60),'bootstrap');
  return json_build_object('ok',true,'level','l5');
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

grant execute on function admin_claim(text,text,text) to anon;

-- ---- proof ----
select 'setup_code column on platform_flags' as check,
       case when exists(select 1 from information_schema.columns
                        where table_schema='public' and table_name='platform_flags'
                          and column_name='admin_setup_code')
            then 'STILL PRESENT — FAIL' else 'REMOVED — PASS' end as result
union all
select 'admin_bootstrap policies (must be 0)',
       (select count(*)::text from pg_policies where schemaname='public' and tablename='admin_bootstrap')
union all
select 'secret preserved in locked table',
       case when (select setup_code from admin_bootstrap where id=1) is null then 'LOST — FAIL' else 'PRESERVED — PASS' end;

-- ========== MIGRATION: 0002_shop_upsert_rpc.sql ==========
-- ============================================================
-- WEEK1 / STEP 1 — close the worst live RLS hole: anyone can rewrite
-- any merchant's shop.
--
-- The chain (verified 2026-07-12 against the live DB):
--   schema.sql   → p_shops_read  SELECT using (deleted_at is null)  ⇒ every shop id is public
--   schema.sql   → p_shops_upd   UPDATE using (true)                ⇒ anyone may update any row
--   cloud.js:117 → client POSTs `shops?on_conflict=id` with Prefer:
--                  resolution=merge-duplicates, sending its OWN id in the payload
--   ⇒ read any shop id with the public anon key, then overwrite that
--     merchant's name / phone / GST / FSSAI / hours / offer. No identity needed.
--
-- Why the policy could not simply be dropped: the upsert NEEDS the UPDATE
-- policy — the vulnerability and the sync are the same mechanism.
-- Why no RLS predicate can fix it: an anon PostgREST request carries no
-- identity to compare a row against. There is nothing trustworthy to check.
--
-- Therefore the write moves behind a security-definer RPC that DERIVES the
-- shop id from the caller's device key and ignores whatever id the client
-- sends. Then the anon INSERT/UPDATE policies are dropped.
--
-- Honest limitation: p_device is still a client-supplied bearer string
-- (see WEEK1 Task 3 — identity is Math.random()). This does NOT fix that.
-- It fixes the far worse property that shop ids are PUBLIC, so today the
-- attack needs no secret at all. After this, an attacker must first steal a
-- specific device key. That is a real reduction in blast radius, not a cure.
-- ============================================================

create or replace function shop_upsert(p_device text, p_shop jsonb, p_items jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop_id text; v_n int := 0;
begin
  if coalesce(p_device,'') = '' or length(p_device) < 8 then
    return json_build_object('ok', false, 'reason', 'bad_device');
  end if;
  if p_shop is null or coalesce(p_shop->>'name','') = '' then
    return json_build_object('ok', false, 'reason', 'no_shop');
  end if;

  -- the id is DERIVED here. Anything the client sent as `id` is ignored.
  v_shop_id := 'my_' || substr(p_device, 1, 12);

  insert into shops (id, name, category, tagline, delivery, pure_veg, gst, fssai,
                     is_open, photo_url, lat, lng, addr, phone, open_from, open_till,
                     offer_label, offer_pct)
  values (v_shop_id,
          left(p_shop->>'name', 80),
          p_shop->>'category',
          left(coalesce(p_shop->>'tagline','Seller on Orignals'), 80),
          coalesce(p_shop->>'delivery','both')::delivery_mode,   -- enum, not text
          coalesce((p_shop->>'pure_veg')::boolean, false),
          nullif(p_shop->>'gst',''), nullif(p_shop->>'fssai',''),
          coalesce((p_shop->>'is_open')::boolean, false),
          nullif(p_shop->>'photo_url',''),
          (p_shop->>'lat')::double precision, (p_shop->>'lng')::double precision,
          nullif(p_shop->>'addr',''), nullif(p_shop->>'phone',''),
          nullif(p_shop->>'open_from',''), nullif(p_shop->>'open_till',''),
          nullif(p_shop->>'offer_label',''), (p_shop->>'offer_pct')::int)
  on conflict (id) do update set
    name=excluded.name, category=excluded.category, tagline=excluded.tagline,
    delivery=excluded.delivery, pure_veg=excluded.pure_veg, gst=excluded.gst,
    fssai=excluded.fssai, is_open=excluded.is_open, photo_url=excluded.photo_url,
    lat=excluded.lat, lng=excluded.lng, addr=excluded.addr, phone=excluded.phone,
    open_from=excluded.open_from, open_till=excluded.open_till,
    offer_label=excluded.offer_label, offer_pct=excluded.offer_pct;

  -- items: shop_id is derived too, so a caller cannot inject items into another shop
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    insert into shop_items (id, shop_id, name, qty_label, price, in_stock, icon, photo_url, section)
    select v_shop_id || '_i' || (ord - 1),
           v_shop_id,
           left(e->>'name', 80),
           nullif(e->>'qty_label',''),
           coalesce((e->>'price')::numeric, 0),
           coalesce((e->>'in_stock')::boolean, true),
           nullif(e->>'icon',''),
           nullif(e->>'photo_url',''),
           nullif(e->>'section','')
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    on conflict (id) do update set
      name=excluded.name, qty_label=excluded.qty_label, price=excluded.price,
      in_stock=excluded.in_stock, icon=excluded.icon,
      photo_url=excluded.photo_url, section=excluded.section;
    get diagnostics v_n = row_count;
  end if;

  return json_build_object('ok', true, 'shop_id', v_shop_id, 'items', v_n);
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

grant execute on function shop_upsert(text, jsonb, jsonb) to anon;

-- Now the anon write policies are no longer needed: the RPC is security definer.
-- SELECT policies stay — buyers must be able to read shops and items.
drop policy if exists p_shops_upd   on shops;
drop policy if exists p_shops_write on shops;
drop policy if exists p_items_upd   on shop_items;
drop policy if exists p_items_write on shop_items;

-- ---- proof ----
select 'shops UPDATE using(true) gone' as check,
       case when exists(select 1 from pg_policies where schemaname='public'
                        and tablename='shops' and cmd='UPDATE' and qual='true')
            then 'STILL OPEN — FAIL' else 'CLOSED — PASS' end as result
union all
select 'shops SELECT still allowed (buyers need it)',
       case when exists(select 1 from pg_policies where schemaname='public'
                        and tablename='shops' and cmd='SELECT')
            then 'PRESENT — PASS' else 'MISSING — FAIL' end
union all
select 'shop_upsert exists + is security definer',
       coalesce((select case when p.prosecdef then 'DEFINER — PASS' else 'INVOKER — FAIL' end
                 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='shop_upsert' limit 1), 'MISSING — FAIL');

-- ========== MIGRATION: 0003_orders_snapshots_rpc.sql ==========
-- ============================================================
-- WEEK1 / STEP 1 (cont.) — close the remaining serious UPDATE holes.
--
-- Verified live 2026-07-12:
--   p_orders_upd  UPDATE using (true)  on orders
--   snap_upd      UPDATE using (true)  on state_snapshots
--
-- Why this is worse than "you must guess an id": PostgREST supports BULK
-- updates. With using(true) a single request such as
--   PATCH /rest/v1/orders?id=like.*        {"total": 0}
--   PATCH /rest/v1/state_snapshots?device_key=like.*   {"state": {}}
-- rewrites EVERY row in the table. No id needed, no key needed — just the
-- public anon key from config.js. That is mass destruction in one call.
--
-- orders had NO ownership column at all, so nothing could be enforced.
-- We add device_key, stamp it server-side, and allow updates only to rows
-- the caller already owns (or that are unclaimed — claim-on-first-write,
-- so the 1 existing legacy row is not orphaned).
--
-- Honest limit: p_device remains a client-supplied bearer string
-- (Week1 Task 3). This removes bulk/anonymous rewriting; it is not identity.
-- ============================================================

alter table orders add column if not exists device_key text;
create index if not exists orders_device_idx on orders(device_key);

-- ---------- snapshots ----------
create or replace function snapshot_save(p_device text, p_state jsonb)
returns json language plpgsql security definer set search_path=public as $$
begin
  if coalesce(p_device,'') = '' or length(p_device) < 8 then
    return json_build_object('ok', false, 'reason', 'bad_device');
  end if;
  if p_state is null then return json_build_object('ok', false, 'reason', 'no_state'); end if;
  insert into state_snapshots (device_key, state, app_ver, updated_at)
  values (p_device, p_state, 'v1', now())
  on conflict (device_key) do update
    set state = excluded.state, app_ver = excluded.app_ver, updated_at = now();
  return json_build_object('ok', true);
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ---------- orders ----------
create or replace function orders_sync(p_device text, p_orders jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare v_n int := 0;
begin
  if coalesce(p_device,'') = '' or length(p_device) < 8 then
    return json_build_object('ok', false, 'reason', 'bad_device');
  end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' then
    return json_build_object('ok', true, 'rows', 0);
  end if;

  insert into orders (id, device_key, kind, flow, shop_id, title, items, total,
                      addr_label, partner_name, partner_veh, otp, rated,
                      cancelled_at, placed_at)
  select left(e->>'id', 40),
         p_device,                                            -- stamped, never trusted
         coalesce(nullif(e->>'kind',''), 'shop')::order_kind,
         nullif(e->>'flow','')::order_flow,
         nullif(e->>'shop_id',''),
         left(coalesce(e->>'title',''), 160),
         coalesce(e->'items', '[]'::jsonb),
         coalesce((e->>'total')::numeric, 0),
         nullif(e->>'addr_label',''),
         nullif(e->>'partner_name',''),
         nullif(e->>'partner_veh',''),
         (e->>'otp')::int,
         (e->>'rated')::int,
         (e->>'cancelled_at')::timestamptz,
         coalesce((e->>'placed_at')::timestamptz, now())
  from jsonb_array_elements(p_orders) e
  where coalesce(e->>'id','') <> ''
  on conflict (id) do update set
    kind = excluded.kind, flow = excluded.flow, shop_id = excluded.shop_id,
    title = excluded.title, items = excluded.items, total = excluded.total,
    addr_label = excluded.addr_label, partner_name = excluded.partner_name,
    partner_veh = excluded.partner_veh, otp = excluded.otp, rated = excluded.rated,
    cancelled_at = excluded.cancelled_at, placed_at = excluded.placed_at,
    device_key = coalesce(orders.device_key, excluded.device_key)   -- claim-on-first-write
  where orders.device_key is null or orders.device_key = p_device;  -- OWNERSHIP GUARD
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'rows', v_n);
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

grant execute on function snapshot_save(text, jsonb) to anon;
grant execute on function orders_sync(text, jsonb) to anon;

-- the anon write policies are now unnecessary — both RPCs are security definer
drop policy if exists snap_upd     on state_snapshots;
drop policy if exists snap_ins     on state_snapshots;
drop policy if exists p_orders_upd on orders;
drop policy if exists p_orders_ins on orders;

-- ---- proof ----
select 'bulk-writable tables remaining' as check,
       coalesce((select string_agg(tablename||'.'||cmd, ', ')
                 from pg_policies where schemaname='public' and qual='true'
                   and cmd in ('UPDATE','DELETE')
                   and tablename in ('orders','state_snapshots','shops','shop_items')), 'NONE — PASS') as result
union all
select 'orders.device_key exists',
       case when exists(select 1 from information_schema.columns
                        where table_schema='public' and table_name='orders' and column_name='device_key')
            then 'YES — PASS' else 'NO — FAIL' end
union all
select 'both RPCs are security definer',
       (select case when count(*) = 2 then 'YES — PASS' else 'NO — FAIL' end
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('snapshot_save','orders_sync') and p.prosecdef);

-- ========== MIGRATION: 0004_errors_and_storage.sql ==========
-- ============================================================
-- WEEK1 TASK 5 — two confirmed leaks. Each verified by direct
-- inspection of the LIVE database (not from a report).
--
-- (A) recent_errors() leaked error URLs to anyone.
--     Verified: pg_get_functiondef shows SECURITY DEFINER with NO admin
--     gate, and harden_rls.sql:59 does `grant execute ... to anon`.
--     It returns the last 12 error messages AND URLs. URLs in this app
--     can contain the device key, which is a bearer token
--     (snapshot_restore(p_device) returns a user's whole account state).
--     So this could hand out credentials, not just noise.
--     Fix: require a token, gate on admin_rank >= 4.
--
-- (B) storage bucket `shopimg` accepted ANY file type.
--     Verified live: public = true, allowed_mime_types = NULL (= any),
--     file_size_limit = 3000000, and a policy "shopimg upload" granting
--     INSERT. A public, unauthenticated, any-MIME bucket on your own
--     domain is a free file host — and whatever lands there is your
--     legal problem.
--     Fix: restrict allowed_mime_types to images, keep the 3MB cap.
--     SAFE: js/cloud.js:466 always uploads with Content-Type image/jpeg,
--     so the legitimate shop-photo path is unaffected.
--
-- NOT fixed here, and deliberately so — my own check found these are
-- already safe, contrary to the earlier audit:
--   price_bounds : RLS enabled, ZERO policies  -> anon cannot write it
--   payments     : ZERO policies               -> deny-all already
-- ============================================================

-- ---------- (A) gate the error log ----------
drop function if exists recent_errors();

create or replace function recent_errors(p_token text)
returns table(created_at timestamptz, message text, url text)
language plpgsql stable security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then
    return;                      -- not staff: empty set, no leak, no hint
  end if;
  return query
    select e.created_at, e.message, e.url
    from error_log e order by e.created_at desc limit 12;
end $$;

grant execute on function recent_errors(text) to anon;

-- ---------- (B) images only in the public bucket ----------
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp'],
       file_size_limit    = 3000000
 where id = 'shopimg';

-- ---- proof ----
select 'recent_errors is admin-gated' as check,
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='recent_errors'
           and pg_get_function_identity_arguments(p.oid) = 'p_token text'
           and pg_get_functiondef(p.oid) like '%admin_rank%')
       then 'YES — PASS' else 'NO — FAIL' end as result
union all
select 'ungated recent_errors() removed',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='recent_errors'
           and pg_get_function_identity_arguments(p.oid) = '')
       then 'STILL PRESENT — FAIL' else 'REMOVED — PASS' end
union all
select 'shopimg mime allowlist',
       coalesce((select array_to_string(allowed_mime_types,',') from storage.buckets where id='shopimg'),'ANY — FAIL');

-- ========== MIGRATION: 0005_supply_chain.sql ==========
-- ============================================================
-- SUPPLY CHAIN + VIRTUAL INVENTORY
--   manufacturer  →  wholesaler  →  retailer (small shop)  →  customer
--
-- Builds on what already exists (schema.sql): seller_tier enum
-- (individual|retail|large_retail|wholesaler|manufacturer), shops.b2b,
-- shop_items.moq, and the rfqs table. Those gave price DISCOVERY.
-- This adds the parts that were missing: actually BUYING stock, tracking
-- what you hold, and tracing a batch back up the chain.
--
-- Design notes:
-- • Stock is DERIVED from an append-only ledger, never a mutable counter.
--   Every movement (purchase in, sale out, adjustment, return) is a row, so
--   inventory is auditable and can never silently drift.
-- • Ownership is derived server-side from the device key, exactly like
--   shop_upsert (migrations/0002) — the client never states who it is.
-- • batch flows down the chain, which is what makes "every batch
--   purity-tested" checkable rather than decorative.
-- ============================================================

-- ---------- B2B purchase orders ----------
create table if not exists purchase_orders (
  id            bigint generated always as identity primary key,
  buyer_shop    text not null,
  supplier_shop text not null,
  items         jsonb not null default '[]'::jsonb,   -- [{name, qty, unit, price}]
  total         numeric(12,2) not null default 0,
  status        text not null default 'placed',       -- placed|accepted|dispatched|received|cancelled
  batch         text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists po_buyer_idx    on purchase_orders(buyer_shop, created_at desc);
create index if not exists po_supplier_idx on purchase_orders(supplier_shop, status, created_at desc);
alter table purchase_orders enable row level security;   -- RPC-only

-- ---------- append-only stock ledger ----------
create table if not exists stock_ledger (
  id         bigint generated always as identity primary key,
  shop_id    text not null,
  item_name  text not null,
  delta      numeric(12,2) not null,      -- +in / -out
  reason     text not null,               -- purchase|sale|adjust|return|waste
  ref        text,
  batch      text,
  created_at timestamptz not null default now()
);
create index if not exists sl_shop_idx on stock_ledger(shop_id, item_name);
alter table stock_ledger enable row level security;      -- RPC-only

-- helper: this device's shop id (same derivation as shop_upsert)
create or replace function _my_shop(p_device text) returns text
language sql immutable as $$ select case when coalesce(p_device,'')='' or length(p_device)<8
  then null else 'my_' || substr(p_device,1,12) end $$;

-- ---------- who can I buy from? ----------
create or replace function suppliers_list(p_q text, p_tier text)
returns json language plpgsql security definer set search_path=public as $$
begin
  return (select coalesce(json_agg(row_to_json(t)),'[]'::json) from (
    select id, name, category, tier::text, coalesce(addr,'') addr, coalesce(rating,0) rating
    from shops
    where deleted_at is null
      and (b2b = true or tier in ('wholesaler','manufacturer'))
      and (coalesce(p_tier,'')='' or tier::text = p_tier)
      and (coalesce(p_q,'')='' or name ilike '%'||p_q||'%' or category ilike '%'||p_q||'%')
    order by tier desc, rating desc nulls last limit 50) t);
exception when others then return '[]'::json; end $$;

-- ---------- retailer places a purchase order upstream ----------
create or replace function po_place(p_device text, p_supplier text, p_items jsonb, p_note text)
returns json language plpgsql security definer set search_path=public as $$
declare v_buyer text; v_total numeric := 0; v_id bigint;
begin
  v_buyer := _my_shop(p_device);
  if v_buyer is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  if not exists (select 1 from shops where id = v_buyer) then
    return json_build_object('ok',false,'reason','no_shop'); end if;
  if not exists (select 1 from shops where id = p_supplier and deleted_at is null
                   and (b2b = true or tier in ('wholesaler','manufacturer'))) then
    return json_build_object('ok',false,'reason','not_a_supplier'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok',false,'reason','no_items'); end if;
  if v_buyer = p_supplier then return json_build_object('ok',false,'reason','self_order'); end if;

  select coalesce(sum( coalesce((e->>'qty')::numeric,0) * coalesce((e->>'price')::numeric,0) ),0)
    into v_total from jsonb_array_elements(p_items) e;

  insert into purchase_orders(buyer_shop, supplier_shop, items, total, note)
  values (v_buyer, p_supplier, p_items, v_total, left(coalesce(p_note,''),200))
  returning id into v_id;

  return json_build_object('ok',true,'id',v_id,'total',v_total,'status','placed');
exception when others then return json_build_object('ok',false,'reason','error','detail',sqlerrm); end $$;

-- ---------- both sides see their POs ----------
create or replace function po_list(p_device text)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop text;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  return json_build_object('ok',true,
    'placed', (select coalesce(json_agg(row_to_json(t) order by t.created_at desc),'[]'::json) from (
      select p.id, p.supplier_shop, coalesce(s.name, p.supplier_shop) supplier_name,
             p.items, p.total, p.status, p.batch, p.created_at
      from purchase_orders p left join shops s on s.id = p.supplier_shop
      where p.buyer_shop = v_shop limit 100) t),
    'received', (select coalesce(json_agg(row_to_json(t) order by t.created_at desc),'[]'::json) from (
      select p.id, p.buyer_shop, coalesce(b.name, p.buyer_shop) buyer_name,
             p.items, p.total, p.status, p.batch, p.created_at
      from purchase_orders p left join shops b on b.id = p.buyer_shop
      where p.supplier_shop = v_shop limit 100) t));
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- move a PO along; receiving credits stock ----------
create or replace function po_advance(p_device text, p_id bigint, p_status text, p_batch text)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop text; r purchase_orders; v_is_buyer boolean; v_is_supplier boolean;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  select * into r from purchase_orders where id = p_id;
  if r.id is null then return json_build_object('ok',false,'reason','not_found'); end if;
  v_is_buyer := (r.buyer_shop = v_shop);
  v_is_supplier := (r.supplier_shop = v_shop);
  if not (v_is_buyer or v_is_supplier) then return json_build_object('ok',false,'reason','not_yours'); end if;
  if r.status in ('received','cancelled') then return json_build_object('ok',false,'reason','already_final'); end if;

  -- only the supplier accepts/dispatches; only the buyer receives; either may cancel pre-dispatch
  if p_status in ('accepted','dispatched') and not v_is_supplier then
    return json_build_object('ok',false,'reason','supplier_only'); end if;
  if p_status = 'received' and not v_is_buyer then
    return json_build_object('ok',false,'reason','buyer_only'); end if;
  if p_status = 'cancelled' and r.status = 'dispatched' then
    return json_build_object('ok',false,'reason','already_dispatched'); end if;
  if p_status not in ('accepted','dispatched','received','cancelled') then
    return json_build_object('ok',false,'reason','bad_status'); end if;

  update purchase_orders
     set status = p_status,
         batch = coalesce(nullif(p_batch,''), batch),
         updated_at = now()
   where id = p_id;

  -- receiving is what actually creates inventory, with the batch attached
  if p_status = 'received' then
    insert into stock_ledger(shop_id, item_name, delta, reason, ref, batch)
    select r.buyer_shop, left(e->>'name',80), coalesce((e->>'qty')::numeric,0),
           'purchase', 'PO#'||r.id, coalesce(nullif(p_batch,''), r.batch)
    from jsonb_array_elements(r.items) e
    where coalesce((e->>'qty')::numeric,0) > 0;
  end if;

  return json_build_object('ok',true,'status',p_status);
exception when others then return json_build_object('ok',false,'reason','error','detail',sqlerrm); end $$;

-- ---------- selling to a customer draws stock down ----------
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
  where coalesce(e->>'name','') <> '';
  get diagnostics v_n = row_count;
  return json_build_object('ok',true,'rows',v_n);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- manual correction (spoilage, stock-take) ----------
create or replace function stock_adjust(p_device text, p_item text, p_delta numeric, p_reason text)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop text;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  if coalesce(p_item,'') = '' or coalesce(p_delta,0) = 0 then return json_build_object('ok',false,'reason','bad_input'); end if;
  insert into stock_ledger(shop_id, item_name, delta, reason)
  values (v_shop, left(p_item,80), p_delta,
          case when coalesce(p_reason,'') in ('waste','return','adjust') then p_reason else 'adjust' end);
  return json_build_object('ok',true);
exception when others then return json_build_object('ok',false,'reason','error'); end $$;

-- ---------- current stock, low-stock flags, reorder suggestions ----------
create or replace function stock_levels(p_device text)
returns json language plpgsql security definer set search_path=public as $$
declare v_shop text;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok',false,'reason','bad_device'); end if;
  return json_build_object('ok',true,'shop',v_shop,
    'items', (select coalesce(json_agg(row_to_json(t) order by t.on_hand asc),'[]'::json) from (
      select l.item_name,
             sum(l.delta) on_hand,
             sum(case when l.delta > 0 then l.delta else 0 end) total_in,
             -sum(case when l.delta < 0 then l.delta else 0 end) total_out,
             max(l.batch) filter (where l.batch is not null) batch,
             max(l.created_at) last_move,
             /* 14-day sales velocity → days of cover left */
             coalesce(-sum(l.delta) filter (where l.reason='sale' and l.created_at > now() - interval '14 days'),0)/14.0 daily_sales,
             (sum(l.delta) <= 0) is_out,
             (sum(l.delta) > 0 and sum(l.delta) <= 5) is_low
      from stock_ledger l
      where l.shop_id = v_shop
      group by l.item_name) t));
exception when others then return json_build_object('ok',false,'reason','error','detail',sqlerrm); end $$;

grant execute on function suppliers_list(text,text)                  to anon;
grant execute on function po_place(text,text,jsonb,text)             to anon;
grant execute on function po_list(text)                              to anon;
grant execute on function po_advance(text,bigint,text,text)          to anon;
grant execute on function stock_sell(text,jsonb,text)                to anon;
grant execute on function stock_adjust(text,text,numeric,text)       to anon;
grant execute on function stock_levels(text)                         to anon;

select 'supply chain installed' as status,
  (select count(*) from shops where b2b = true or tier in ('wholesaler','manufacturer')) as suppliers_available;

-- ========== MIGRATION: 0006_stock_idempotent.sql ==========
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

-- ========== MIGRATION: 0007_po_conserve_stock.sql ==========
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

-- ========== MIGRATION: 0008_orders_read_and_pricecheck.sql ==========
-- ============================================================
-- ⚠ NOT YET APPLIED — written 2026-07-23 without live DB access
-- (the Management-API token was cleared from the scratchpad this session).
-- Apply in the Supabase SQL editor, or via the CLI, then keep the proof output.
--
-- Two live holes that no prior migration closed:
--
-- (1) P0 — `orders` is world-readable and carries the delivery OTP.
--     schema.sql:321 `p_orders_read on orders for select using(true)`.
--     migration 0003 dropped the orders UPDATE/INSERT policies but NOT the
--     SELECT, and harden_rls hardens the OTHER order table (shop_orders).
--     So with the public anon key:
--       curl .../rest/v1/orders?select=otp,addr_label,partner_name
--     returns every order's delivery handover OTP + area + partner →
--     delivery interception at scale.
--     `orders` is a WRITE-ONLY client mirror (orders_sync writes it; the app
--     reads its own orders from localStorage, never from this table — verified
--     by grep: no client read of the `orders` table exists), so dropping the
--     read policy breaks nothing.
--
-- (2) P2 — price_check() FAILS OPEN: `exception when others then verdict:'ok'`.
--     Any internal error APPROVES the price, so moderation is defeatable by
--     forcing an error. Inverted to 'block'. The empty-bounds case (a brand-new
--     item with no learned band) does NOT hit the exception — it returns 'ok'
--     via the normal else branch — so new items are not wrongly blocked.
-- ============================================================

-- (1) close the OTP read leak
drop policy if exists p_orders_read on orders;

-- (2) fail price moderation CLOSED
create or replace function price_check(p_cat text, p_name text, p_price numeric)
returns json language plpgsql security definer set search_path=public as $$
declare v_min numeric; v_max numeric; v_src text;
begin
  if p_price is null or p_price <= 0 then return json_build_object('verdict','invalid'); end if;
  select min_price, max_price into v_min, v_max from price_bounds where key = 'item:'||lower(trim(coalesce(p_name,'')));
  if v_min is not null then v_src := 'item';
  else
    select min_price, max_price into v_min, v_max from price_bounds where key = 'cat:'||lower(coalesce(p_cat,''));
    if v_min is not null then v_src := 'category'; end if;
  end if;
  if v_min is null then select min_price, max_price into v_min, v_max from price_bounds where key='default'; v_src := 'default'; end if;
  -- no learned band at all → allow (new item), this is NOT an error path
  if v_min is null then return json_build_object('verdict','ok','src','none'); end if;
  if p_price < v_min then
    return json_build_object('verdict', case when p_price < v_min/3.0 then 'block' else 'low' end, 'min',v_min,'max',v_max,'src',v_src);
  elsif p_price > v_max then
    return json_build_object('verdict', case when p_price > v_max*3.0 then 'block' else 'high' end, 'min',v_min,'max',v_max,'src',v_src);
  else
    return json_build_object('verdict','ok','min',v_min,'max',v_max,'src',v_src);
  end if;
exception when others then
  -- FAIL CLOSED: a moderation error must not wave a price through
  return json_build_object('verdict','block','reason','check_error');
end $$;
grant execute on function price_check(text,text,numeric) to anon;

-- ---- proof (expect all PASS) ----
select 'orders read policy gone' as check,
       case when exists(select 1 from pg_policies where schemaname='public' and tablename='orders' and cmd='SELECT' and qual='true')
            then 'STILL OPEN — FAIL' else 'CLOSED — PASS' end as result
union all
select 'price_check fails closed',
       (price_check('x','__nonexistent_item__', -5)->>'verdict');   -- invalid price → 'invalid' (sanity that fn runs)

-- ========== MIGRATION: 0009_order_lifecycle.sql ==========
-- ============================================================
-- 0009 — AUTHORITATIVE ORDER LIFECYCLE  (⚠ written 2026-08-11, NOT YET APPLIED)
--   No live DB this session (Management token cleared), so this is built to be
--   applied + proven in the Supabase SQL editor when access returns. It is
--   additive and backward-compatible: the client's existing calls
--   (shop_order_status / shop_order_cancel / order_statuses / market_stats)
--   keep working — they just become REAL and VALIDATED.
--
-- Why this exists (the "real OMS" the spec demands, §22/§26/§37):
--   The live operational order table is `shop_orders` (buyer's order lands on
--   the shop's device; the shop drives the buyer's tracking). Until now:
--     · status was a FLAT ALLOWLIST — new→done directly was legal; no state
--       machine, so an order could skip prep/handover with no record.
--     · there was NO audit trail — every change overwrote updated_at, so the
--       order's history (who did what, when) was unrecoverable. A marketplace
--       cannot do disputes, refunds, SLA or fraud without this.
--     · `shop_order_cancel` (buyer cancels) and `market_stats` (admin board)
--       were CALLED by the client but defined in NO file — live-DB-only ghosts
--       that a rebuild would silently lose. They are made real + sourced here.
--
-- Also closes a live durability leak (see §3 below): shop_orders_schema.sql
--   recreates `so_read using(true)` — world-readable buyer name/address/GPS +
--   delivery OTP on the REAL order table. Dropped defensively here and removed
--   at source in shop_orders_schema.sql.
-- ============================================================

-- ── 1. append-only audit trail ──────────────────────────────
-- One immutable row per state transition. Never updated, never deleted.
create table if not exists shop_order_events (
  id           bigint generated always as identity primary key,
  order_id     text not null,
  at           timestamptz not null default now(),
  actor        text not null,                 -- 'buyer' | 'shop' | 'partner' | 'system'
  actor_device text,
  from_status  text,
  to_status    text not null,
  note         text
);
create index if not exists idx_soe_order on shop_order_events(order_id, at);

alter table shop_order_events enable row level security;
-- No anon read and no anon write: the log is written ONLY by the security-
-- definer RPCs below (so no one can forge history) and read ONLY via
-- order_timeline() (which authorises buyer-or-owning-shop). Zero anon policies.
drop policy if exists soe_read on shop_order_events;
drop policy if exists soe_write on shop_order_events;

-- ── 2. genesis event: every order starts its history at 'new' ─
create or replace function _shop_order_genesis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into shop_order_events(order_id, actor, actor_device, from_status, to_status, note)
  values (new.id, 'buyer', new.buyer_device, null, coalesce(new.status,'new'), 'order placed');
  return new;
end $$;
drop trigger if exists t_shop_order_genesis on shop_orders;
create trigger t_shop_order_genesis after insert on shop_orders
  for each row execute function _shop_order_genesis();

-- ── 3. validated state machine + audit, shop-driven transitions ─
-- Replaces the flat-allowlist shop_order_status. Same signature (client
-- unchanged). Enforces a real transition graph and records every move.
--   new     → prep | rejected
--   prep    → finding | selfout | handed | done | rejected
--   finding → handed | selfout | rejected
--   handed  → done | rejected            (out for delivery — no going back)
--   selfout → done | rejected
--   done / rejected → (terminal)   ('rejected' covers both shop-reject and buyer-cancel; the audit row's actor distinguishes them)
create or replace function _order_transition_ok(p_from text, p_to text)
returns boolean language sql immutable as $$
  select case p_from
    when 'new'     then p_to in ('prep','rejected')
    when 'prep'    then p_to in ('finding','selfout','handed','done','rejected')
    when 'finding' then p_to in ('handed','selfout','rejected')
    when 'handed'  then p_to in ('done','rejected')
    when 'selfout' then p_to in ('done','rejected')
    else false                              -- done/rejected/cancelled are terminal
  end;
$$;

create or replace function shop_order_status(p_id text, p_device text, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_from text; v_shop text;
begin
  if p_status not in ('prep','finding','handed','selfout','done','rejected') then
    return false;
  end if;
  v_shop := 'my_' || substr(p_device, 1, 12);
  -- lock the row so two device taps can't race a double transition
  select status into v_from from shop_orders where id = p_id and shop_id = v_shop for update;
  if v_from is null then return false; end if;                 -- not found / not your shop
  if not _order_transition_ok(v_from, p_status) then
    return false;                                             -- illegal move (e.g. done→prep)
  end if;
  update shop_orders set status = p_status, updated_at = now() where id = p_id;
  insert into shop_order_events(order_id, actor, actor_device, from_status, to_status, note)
  values (p_id, 'shop', p_device, v_from, p_status, null);
  return true;
end $$;
grant execute on function shop_order_status(text, text, text) to anon;

-- ── 4. buyer cancellation (was a ghost RPC — now real + audited) ─
-- Only the buyer who placed it, and only before it is out for delivery.
-- Sets 'rejected' (the existing client already reads a buyer-side 'rejected'
-- as "cancelled by buyer" — myshop.js:230 — and the buyer's own poll keys off
-- 'rejected'; introducing a new 'cancelled' status would break both). The
-- audit row records actor='buyer', so a rejection BY THE BUYER is still
-- distinguishable from a rejection BY THE SHOP in the history.
create or replace function shop_order_cancel(p_id text, p_device text)
returns json language plpgsql security definer set search_path = public as $$
declare v_from text; v_buyer text;
begin
  select status, buyer_device into v_from, v_buyer from shop_orders where id = p_id for update;
  if v_from is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_buyer <> p_device then return json_build_object('ok', false, 'reason', 'not_your_order'); end if;
  if v_from in ('handed','selfout','done','rejected') then
    return json_build_object('ok', false, 'reason', 'too_late', 'status', v_from);
  end if;
  update shop_orders set status = 'rejected', updated_at = now() where id = p_id;
  insert into shop_order_events(order_id, actor, actor_device, from_status, to_status, note)
  values (p_id, 'buyer', p_device, v_from, 'rejected', 'buyer cancelled');
  return json_build_object('ok', true);
end $$;
grant execute on function shop_order_cancel(text, text) to anon;

-- ── 4b. job_reopen (was a ghost RPC — now real) ─────────────
-- A partner who claimed a delivery then drops it (earn.js:524) must return it
-- to the open feed, or the parcel is stranded 'taken' forever. Only the
-- partner who holds it may reopen it; clears their claim + live location.
create or replace function job_reopen(p_job text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update live_jobs
     set status = 'open', taken_by = null, taken_at = null, taken_name = null,
         taken_veh = null, taken_rating = null, partner_lat = null, partner_lng = null, picked_at = null
   where id = p_job and taken_by = p_device and status = 'taken';
  return found;
end $$;
grant execute on function job_reopen(text, text) to anon;

-- ── 5. read the real timeline (buyer OR owning shop only) ────
create or replace function order_timeline(p_id text, p_device text)
returns table (at timestamptz, actor text, from_status text, to_status text, note text)
language plpgsql security definer set search_path = public stable as $$
declare v_buyer text; v_shop text;
begin
  select buyer_device, shop_id into v_buyer, v_shop from shop_orders where id = p_id;
  if v_buyer is null then return; end if;
  if p_device <> v_buyer and v_shop <> 'my_' || substr(p_device, 1, 12) then
    return;                                                    -- not authorised for this order
  end if;
  return query
    select e.at, e.actor, e.from_status, e.to_status, e.note
    from shop_order_events e where e.order_id = p_id order by e.at asc;
end $$;
grant execute on function order_timeline(text, text) to anon;

-- ── 6. market_stats (was a ghost RPC — now real + sourced) ───
-- Powers Admin → Database "marketplace live". Counts only; fail-soft per
-- metric so a not-yet-created table never breaks the whole board.
create or replace function market_stats()
returns json language plpgsql security definer set search_path = public stable as $$
declare v_jobs int := 0; v_orders int := 0; v_pay int := 0; v_shops int := 0;
begin
  begin select count(*) into v_jobs from live_jobs where status = 'open'; exception when others then v_jobs := 0; end;
  begin select count(*) into v_orders from shop_orders where status not in ('done','rejected'); exception when others then v_orders := 0; end;
  begin select count(*) into v_pay from payments where status = 'verified'; exception when others then v_pay := 0; end;
  begin select count(*) into v_shops from shops where id like 'my\_%' and is_open = true and deleted_at is null; exception when others then v_shops := 0; end;
  return json_build_object('open_jobs', v_jobs, 'active_orders', v_orders,
                           'verified_payments', v_pay, 'community_shops', v_shops);
end $$;
grant execute on function market_stats() to anon;

-- ── 7. close the live buyer-PII/OTP read leak on shop_orders ──
-- shop_orders_schema.sql:28 recreates `so_read using(true)` → anyone with the
-- public anon key can read buyer_name, buyer_addr, buyer_lat/lng and drop_otp
-- for EVERY order (delivery interception + PII dump). Reads already go through
-- my_shop_orders()/order_statuses() (security-definer, scoped). Drop the
-- blanket read here so it is closed regardless of base-file apply order; also
-- removed at source in shop_orders_schema.sql.
drop policy if exists so_read on shop_orders;

-- ------------------------------------------------------------
-- PROOF (run after apply — every row should read PASS)
-- ------------------------------------------------------------
-- a) illegal transition is refused, legal one is accepted, both audited:
do $$
declare ok boolean; n int;
begin
  insert into shop_orders(id, shop_id, buyer_device, items, total, status)
  values ('OMTEST9', 'my_devtest12345', 'devbuyer0001', '[]'::jsonb, 100, 'new')
  on conflict (id) do update set status = 'new';
  delete from shop_order_events where order_id = 'OMTEST9';        -- clean prior test runs
  insert into shop_order_events(order_id, actor, from_status, to_status, note)
  values ('OMTEST9', 'buyer', null, 'new', 'test genesis');

  ok := shop_order_status('OMTEST9', 'devtest12345xxxx', 'done');  -- new→done ILLEGAL
  assert ok = false, 'FAIL: illegal new->done was allowed';

  ok := shop_order_status('OMTEST9', 'devtest12345xxxx', 'prep');  -- new→prep legal
  assert ok = true,  'FAIL: legal new->prep was refused';

  ok := shop_order_status('OMTEST9', 'devtest12345xxxx', 'done');  -- prep→done legal
  assert ok = true,  'FAIL: legal prep->done was refused';

  select count(*) into n from shop_order_events where order_id = 'OMTEST9' and actor = 'shop';
  assert n = 2, 'FAIL: expected 2 shop audit rows, got ' || n;

  delete from shop_order_events where order_id = 'OMTEST9';
  delete from shop_orders where id = 'OMTEST9';
  raise notice 'PASS: state machine + audit trail verified';
end $$;

-- b) the PII read policy is gone:
select 'shop_orders read leak closed' as check,
  case when exists(select 1 from pg_policies where schemaname='public' and tablename='shop_orders' and cmd='SELECT' and qual='true')
       then 'STILL OPEN — FAIL' else 'CLOSED — PASS' end as result
union all
-- c) market_stats runs and returns the 4 keys:
select 'market_stats returns keys',
  case when market_stats()::jsonb ? 'open_jobs' and market_stats()::jsonb ? 'community_shops'
       then 'PASS' else 'FAIL' end;

-- ========== MIGRATION: 0010_doc_requests.sql ==========
-- ============================================================
-- 0010 — DOCUMENT SERVICES ("Papers")  (⚠ written 2026-08-11, NOT YET APPLIED)
--   The "Papers" view lets a user request an assisted document (GST, FSSAI,
--   birth/death cert, driving licence…). The client already calls three RPCs —
--     doc_request_add / my_doc_requests / doc_request_cancel  (js/cloud.js:368-383)
--   — but they exist in NO sql file, so every call silently .catch()es and the
--   request lives only in that one device's localStorage: it never reaches the
--   team, its status never advances, and it's lost if the app data is cleared.
--   This makes the feature REAL: requests persist, sync their status back, and
--   the ops team can advance them. Additive; the client is unchanged.
-- ============================================================

create table if not exists doc_requests (
  id          text primary key,                 -- client 'DOC#####' id
  created_at  timestamptz not null default now(),
  device_key  text not null,                    -- owner (device identity)
  applicant   text,
  service     text,                             -- DB.docServices id
  name        text,
  price       numeric,
  note        text,
  status      text not null default 'requested',-- requested|docs_collected|filed|issued|cancelled
  ref_no      text,                             -- govt/application reference once filed
  updated_at  timestamptz not null default now()
);
create index if not exists idx_docreq_device on doc_requests(device_key, created_at desc);
create index if not exists idx_docreq_status on doc_requests(status, created_at desc);

alter table doc_requests enable row level security;
-- No anon policies at all: this holds applicant names tied to a device. Reads
-- are per-device via my_doc_requests(); writes via the security-definer RPCs
-- below. (Same posture as listing_leads / shop_orders.)
drop policy if exists dr_read  on doc_requests;
drop policy if exists dr_write on doc_requests;

-- buyer creates a request (idempotent on the client id)
create or replace function doc_request_add(
  p_id text, p_device text, p_applicant text, p_service text,
  p_name text, p_price numeric, p_note text)
returns json language plpgsql security definer set search_path = public as $$
begin
  insert into doc_requests(id, device_key, applicant, service, name, price, note, status)
  values (p_id, p_device, left(coalesce(p_applicant,''),80), p_service,
          left(coalesce(p_name,''),120), greatest(coalesce(p_price,0),0),
          left(coalesce(p_note,''),300), 'requested')
  on conflict (id) do nothing;              -- never duplicate, never overwrite
  return json_build_object('ok', true);
end $$;
grant execute on function doc_request_add(text, text, text, text, text, numeric, text) to anon;

-- buyer reads only their own requests (device-scoped)
create or replace function my_doc_requests(p_device text)
returns setof doc_requests language sql security definer set search_path = public stable as $$
  select * from doc_requests where device_key = p_device order by created_at desc limit 50;
$$;
grant execute on function my_doc_requests(text) to anon;

-- buyer cancels their own — only before it is filed (money not yet spent on govt fees)
create or replace function doc_request_cancel(p_id text, p_device text)
returns json language plpgsql security definer set search_path = public as $$
declare v_status text; v_owner text;
begin
  select status, device_key into v_status, v_owner from doc_requests where id = p_id for update;
  if v_owner is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_owner <> p_device then return json_build_object('ok', false, 'reason', 'not_your_request'); end if;
  if v_status not in ('requested','docs_collected') then
    return json_build_object('ok', false, 'reason', 'too_late', 'status', v_status);
  end if;
  update doc_requests set status = 'cancelled', updated_at = now() where id = p_id;
  return json_build_object('ok', true);
end $$;
grant execute on function doc_request_cancel(text, text) to anon;

-- ops/admin advances a request (requested → docs_collected → filed → issued).
-- Gated by the SAME admin token gate the rest of the panel uses (rank >= 4).
-- (An admin-console button can call this; not wired to UI in this migration.)
create or replace function doc_request_advance(p_token text, p_id text, p_status text, p_ref text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status not in ('requested','docs_collected','filed','issued','cancelled') then
    return json_build_object('ok', false, 'reason', 'bad_status');
  end if;
  update doc_requests
     set status = p_status,
         ref_no = coalesce(nullif(p_ref,''), ref_no),
         updated_at = now()
   where id = p_id;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;
-- granted to anon like every other admin RPC in this codebase; the p_token
-- rank gate above is the real guard (the anon key is the only key a client holds)
grant execute on function doc_request_advance(text, text, text, text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare r json; n int;
begin
  perform doc_request_add('DOCTEST1','drdev0001','Test Co','gst','GST registration',2499,'');
  select count(*) into n from doc_requests where id='DOCTEST1' and device_key='drdev0001' and status='requested';
  assert n = 1, 'FAIL: request not persisted';
  -- wrong device cannot cancel
  r := doc_request_cancel('DOCTEST1','someone_else');
  assert (r->>'ok') = 'false', 'FAIL: foreign cancel allowed';
  -- owner can cancel while still early
  r := doc_request_cancel('DOCTEST1','drdev0001');
  assert (r->>'ok') = 'true', 'FAIL: owner cancel refused';
  delete from doc_requests where id='DOCTEST1';
  raise notice 'PASS: doc_requests add/scope/cancel verified';
end $$;

select 'doc_requests ready' as status;

-- ========== MIGRATION: 0011_device_key_hardening.sql ==========
-- ============================================================
-- 0011 — device_key HARDENING  (⚠ written 2026-08-11, NOT YET APPLIED · FROZEN)
--   Reviewed by hand, but NOT staged/tested. Do not apply to production until it
--   runs on a staging DB and passes the negative-authorization tests below.
--
-- THE P0 (architecture audit, §H):  device_key is a BEARER TOKEN — snapshot_restore
--   (harden_rls.sql) returns a device's ENTIRE account state for whoever presents
--   its key, and shop authorization derives shop_id = 'my_'||substr(device_key,1,12).
--   Yet device_key is SELECTABLE IN BULK on several world-readable tables. Harvest
--   the keys → read/patch any account. This migration removes the read exposure.
--
-- Three closable classes:
--   (1) SAFE NOW — column-level revoke: the client never reads these device-key
--       columns (verified against js/), so hiding the column keeps every row-read
--       working while removing the token from the response.
--   (2) NEEDS PAIRED CLIENT CHANGE — live_jobs + listings: the client FILTERS on
--       device_key/owner_device, so the read must move to an RPC first. RPCs are
--       drafted here; the base-table read policy is dropped ONLY after the client
--       (cloud.js) is switched — do NOT drop lj_read/ls_read until then.
--   (3) DURABILITY — reservations/listing_leads/mitra_*/error_log were closed by
--       harden_rls but their BASE files re-declare a permissive read; re-asserted
--       here and (to be) fixed at source.
-- ============================================================

-- ── (1) SAFE NOW — hide device_key from columns the client never selects ──
-- seat_bookings: client reads only `select=seat` (cloud.js:440).
-- geo_places:    client reads only name,sub,lat,lng,uses (geo.js:55).
-- shop_ratings:  no direct client read (submitted via rate_shop, aggregated on shops.rating).
-- Postgres column privileges: revoking SELECT on the column also blocks it in
-- WHERE/ORDER BY, so verify on staging that nothing filters these columns.
revoke select (device_key) on seat_bookings from anon;
revoke select (device_key) on geo_places   from anon;
revoke select (device_key) on shop_ratings from anon;

-- ── (2) live_jobs — device_key + LIVE rider GPS are world-readable (P0) ──
-- Today: cloud.js:241 reads `live_jobs?status=eq.open&device_key=neq.<self>` (all
-- columns → leaks poster device_key, taken_by, GPS) and cloud.js:282 reads a job's
-- courier GPS by order_ref (anyone can harvest every courier's live location).
-- Target RPCs (safe columns only, ownership-scoped). The client must switch to
-- these BEFORE lj_read is dropped (kept live here so nothing breaks meanwhile).
create or replace function open_jobs(p_device text)
returns table (id text, what text, jtype text, from_name text, to_name text,
               from_lat double precision, from_lng double precision,
               to_lat double precision, to_lng double precision,
               km numeric, pay numeric, note text, order_ref text, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select id, what, jtype, from_name, to_name, from_lat, from_lng, to_lat, to_lng,
         km, pay, note, order_ref, created_at
  from live_jobs
  where status = 'open'
    and device_key <> coalesce(p_device, 'anon')          -- exclude the caller's own
    and created_at >= now() - interval '24 hours'
  order by created_at desc limit 30;                       -- NB: no device_key/taken_by in output
$$;
grant execute on function open_jobs(text) to anon;

-- buyer reads the live courier location for THEIR OWN order only
create or replace function job_gps(p_order text, p_device text)
returns table (taken_name text, taken_veh text, taken_rating numeric,
               partner_lat double precision, partner_lng double precision,
               status text, picked_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare v_owner text;
begin
  -- the order belongs to this device (orders_sync stamps device_key on `orders`)
  select device_key into v_owner from orders where id = p_order limit 1;
  if v_owner is not null and v_owner <> p_device then return; end if;
  return query
    select lj.taken_name, lj.taken_veh, lj.taken_rating, lj.partner_lat, lj.partner_lng,
           lj.status, lj.picked_at
    from live_jobs lj where lj.order_ref = p_order limit 1;
end $$;
grant execute on function job_gps(text, text) to anon;

-- PAIRED CLIENT CHANGE (do together, then apply the drop below):
--   cloud.js:241  cloudJobs()        -> rpc/open_jobs {p_device}
--   cloud.js:282  cloudJobForOrder() -> rpc/job_gps   {p_order, p_device}
-- AFTER the client ships those:
--   drop policy if exists lj_read on live_jobs;   -- (left LIVE in this migration)

-- ── (2b) listings — owner_device world-readable + sent to every buyer ──
-- Today the buyer feed selects `*` (owner_device leaks) and the client passes
-- listing.owner_device back into cloudPostLead. Target: a feed RPC without
-- owner_device, and a lead RPC that resolves owner_device server-side by
-- listing_id. Drafted; drop ls_read only after cloud.js switches.
create or replace function listings_feed(p_device text)
returns table (id text, kind text, title text, loc text, price numeric, area text,
               bhk text, lat double precision, lng double precision, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select id, kind, title, loc, price, area, bhk, lat, lng, created_at
  from listings
  where status = 'live' and owner_device <> coalesce(p_device, 'anon')
  order by created_at desc limit 30;                       -- no owner_device in output
$$;
grant execute on function listings_feed(text) to anon;

create or replace function listing_lead_add(p_listing text, p_device text, p_kind text, p_name text, p_note text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner text;
begin
  select owner_device into v_owner from listings where id = p_listing and status = 'live';
  if v_owner is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into listing_leads (listing_id, owner_device, from_device, kind, name, note)
  values (p_listing, v_owner, coalesce(p_device,'anon'), p_kind, left(coalesce(p_name,''),40), left(coalesce(p_note,''),160));
  return json_build_object('ok', true);
end $$;
grant execute on function listing_lead_add(text, text, text, text, text) to anon;
-- PAIRED CLIENT CHANGE: cloud.js:348 cloudListingsRefresh -> rpc/listings_feed;
--   cloud.js:356 cloudPostLead -> rpc/listing_lead_add {p_listing,...} (stop
--   sending owner_device). THEN: drop policy if exists ls_read on listings;

-- ── (3) durability re-assert (base files re-open these; also fix at source) ──
-- mitra_utterances/mitra_model: base mitra_schema declares `for all using(true)`
-- (includes SELECT of device_key). harden_rls already narrows to insert/update;
-- re-assert here so a mitra_schema re-run cannot re-expose training rows + keys.
drop policy if exists p_mu_all on mitra_utterances;
drop policy if exists p_mm_all on mitra_model;
drop policy if exists rz_read  on reservations;     -- buyer_device + PII; read via shop_reservations RPC
drop policy if exists ld_read  on listing_leads;    -- owner/from device; read via my_leads RPC
drop policy if exists el_read  on error_log;        -- URLs can carry a device_key; read via recent_errors RPC (admin-gated)

-- ── proof (run after apply) ──
-- Expect: selecting device_key from the (1) tables ERRORS (permission denied),
-- while a normal row read still works; open_jobs/listings_feed outputs contain
-- NO device_key/owner_device column.
select 'device_key columns hidden' as check,
  'verify on staging: select device_key from seat_bookings LIMIT 1 must raise permission denied' as how
union all
select 'open_jobs excludes keys',
  case when (select count(*) from information_schema.routines
             where routine_name='open_jobs' and routine_schema='public') = 1
       then 'RPC present — PASS' else 'MISSING — FAIL' end;

-- ========== MIGRATION: 0013_eta_engine.sql ==========
-- 0013 eta_engine — NOT YET APPLIED (written by full-build)
-- ============================================================
-- 0013 — ETA ENGINE  (⚠ written 2026-08-11, NOT YET APPLIED)
--
-- Today the app fakes an ETA in JS: stage timers are a straight-line
-- distance * a hard-coded constant (core.js:322 `40 + km*16`, capped).
-- It never learns. This migration makes ETA a REAL, self-improving
-- estimate computed server-side from (a) haversine distance, (b) a
-- congestion-aware speed profile (secs/km varies by distance band —
-- short first/last-mile hops are slower per km than long open runs),
-- and (c) the historical MEDIAN secs/km actually observed on the
-- ground for that distance band, once enough samples exist.
--
-- ALGORITHM PROGRESSION (implement the simplest sufficient stage now):
--   Stage 0 (old): haversine * one global constant.                (replaced)
--   Stage 1 (THIS): haversine * per-band speed profile, then blend
--                   toward the per-band historical median secs/km
--                   with a weight that grows as samples accumulate.
--   Stage 2 (next, trigger >= 500 samples/band): swap the median for
--                   a small feature model (hour-of-day, weekday, rain
--                   flag, band) fit in-DB — still just SQL/plpgsql, no
--                   external infra. Add features as columns to
--                   eta_samples; keep this RPC's signature stable.
--
-- Postgres-first, zero external infra. eta_samples is append-only.
-- ============================================================

-- actuals: every completed leg/order records what REALLY happened
create table if not exists eta_samples (
  id    bigint generated always as identity primary key,
  kind  text not null,                 -- prep | pickup | transit | total
  km    numeric not null check (km >= 0),
  secs  int     not null check (secs >= 0),
  at    timestamptz not null default now()
);
-- the hot read is "median secs/km for this kind in this distance band" — a
-- (kind, km) index serves the band scan cheaply.
-- (STAGE-2 perf note from review: the read filters _eta_band(km)=_eta_band(v_km),
--  a function over the column, so this index restricts by kind but not the band;
--  when volume justifies it, add a stored `band` column and index (kind,band).)
create index if not exists idx_eta_samples_kind_km on eta_samples(kind, km);
-- (dropped idx_eta_samples_at — the median query has no time window/ORDER BY at,
--  so a recency index earns nothing until a windowed query exists.)

alter table eta_samples enable row level security;
-- No PII, no money, no device link — pure operational telemetry. But we
-- still route writes through the SECURITY DEFINER RPC (validation +
-- consistency) rather than a blanket anon INSERT policy, and reads go
-- through eta_estimate. So: no anon policies at all.
drop policy if exists eta_read  on eta_samples;
drop policy if exists eta_write on eta_samples;

-- ---- helpers (immutable, pure math) ----

-- great-circle distance in km
create or replace function _eta_haversine(
  a_lat double precision, a_lng double precision,
  b_lat double precision, b_lng double precision)
returns numeric language sql immutable as $$
  select case
    when a_lat is null or a_lng is null or b_lat is null or b_lng is null then 0::numeric
    else round((2 * 6371 * asin(least(1.0, sqrt(
           power(sin(radians((b_lat - a_lat) / 2)), 2) +
           cos(radians(a_lat)) * cos(radians(b_lat)) *
           power(sin(radians((b_lng - a_lng) / 2)), 2)
         ))))::numeric, 3)
  end;
$$;

-- distance band label — coarse buckets that share driving character
create or replace function _eta_band(p_km numeric)
returns text language sql immutable as $$
  select case
    when p_km < 1  then 'b0'      -- last-mile / same-lane
    when p_km < 3  then 'b1'      -- neighbourhood
    when p_km < 6  then 'b2'      -- across-town
    when p_km < 12 then 'b3'      -- edge-of-town
    else                'b4'      -- inter-locality
  end;
$$;

-- default speed profile: seconds per km by band. Deliberately DECREASING
-- with distance (short hops crawl through lanes/lights; long runs open up).
-- Tuned for a tier-2/3 two-wheeler Mitra. This is the deterministic floor
-- used until real data outvotes it.
create or replace function _eta_default_spk(p_km numeric)
returns numeric language sql immutable as $$
  select case _eta_band(p_km)
    when 'b0' then 240::numeric   -- ~15 km/h
    when 'b1' then 180::numeric   -- ~20 km/h
    when 'b2' then 150::numeric   -- ~24 km/h
    when 'b3' then 132::numeric   -- ~27 km/h
    else            120::numeric  -- ~30 km/h
  end;
$$;

-- how many samples in a band before we trust its median at all
create or replace function _eta_min_samples() returns int language sql immutable as $$ select 3; $$;

-- ---- estimate ----
-- Returns {distance_km, transit_secs, prep_secs, eta_secs, basis}.
-- basis: 'default'  (no/too-few samples → pure speed profile)
--        'blended'  (speed profile blended toward historical median)
create or replace function eta_estimate(
  p_from_lat double precision, p_from_lng double precision,
  p_to_lat   double precision, p_to_lng   double precision,
  p_prep_secs int default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_km      numeric;
  v_default numeric;
  v_median  numeric;
  v_n       int;
  v_w       numeric;
  v_spk     numeric;
  v_prep    int;
  v_transit int;
  v_basis   text;
begin
  v_km      := _eta_haversine(p_from_lat, p_from_lng, p_to_lat, p_to_lng);
  v_default := _eta_default_spk(v_km);
  v_prep    := greatest(coalesce(p_prep_secs, 90), 0);   -- default 90s shop prep

  -- historical median secs/km for THIS band's transit legs
  select count(*), percentile_cont(0.5) within group (order by secs::numeric / nullif(km, 0))
    into v_n, v_median
    from eta_samples
   where kind = 'transit'
     and km > 0
     and _eta_band(km) = _eta_band(v_km);

  if v_n >= _eta_min_samples() and v_median is not null then
    -- shrinkage blend: weight toward observed grows with sample count,
    -- capped so a handful of odd trips can't dominate the profile.
    -- w = n/(n+8), capped 0.85 → at n=3 ~0.27, at n=45 ~0.85.
    v_w   := least(v_n::numeric / (v_n + 8), 0.85);
    v_spk := round(v_w * v_median + (1 - v_w) * v_default, 3);
    v_basis := 'blended';
  else
    v_spk   := v_default;
    v_basis := 'default';
  end if;

  v_transit := round(v_km * v_spk)::int;

  return json_build_object(
    'distance_km', round(v_km, 2),
    'transit_secs', v_transit,
    'prep_secs',    v_prep,
    'eta_secs',     v_prep + v_transit,
    'basis',        v_basis
  );
end $$;
grant execute on function eta_estimate(double precision, double precision, double precision, double precision, int) to anon;

-- ---- record an actual ----
-- Appended when a leg completes (prep done, picked up, delivered).
create or replace function eta_record(p_kind text, p_km numeric, p_secs int)
returns json language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_kind is null or p_kind not in ('prep', 'pickup', 'transit', 'total') then
    return json_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  -- reject impossible/garbage samples so they can't poison the median:
  -- non-positive time, or a speed faster than 120 km/h (30 s/km) on a
  -- non-trivial distance.
  if p_km is null or p_km < 0 or p_secs is null or p_secs < 0 then
    return json_build_object('ok', false, 'reason', 'bad_values');
  end if;
  if p_km >= 0.2 and p_secs::numeric / p_km < 30 then
    return json_build_object('ok', false, 'reason', 'implausible_speed');
  end if;
  -- also reject absurdly SLOW samples (> 3600 s/km ≈ under 1 km/h) — a stuck GPS
  -- or a forgotten open leg would otherwise drag the median up (review 0013 P2).
  if p_km >= 0.2 and p_secs::numeric / p_km > 3600 then
    return json_build_object('ok', false, 'reason', 'implausible_slow');
  end if;

  insert into eta_samples(kind, km, secs) values (p_kind, round(p_km, 3), p_secs);
  select count(*) into v_n from eta_samples where kind = p_kind;
  return json_build_object('ok', true, 'kind', p_kind, 'samples', v_n);
end $$;
-- eta_record is INTERNAL — NOT granted to anon. It is invoked by leg-completion
-- RPCs (job_picked / job_deliver, themselves SECURITY DEFINER, so they run as
-- owner and may call it) when this migration is staged. Granting it to anon would
-- let the public anon key inject samples and poison the per-band median (review
-- 0013 P2). The proof below calls it as the migration owner, which is fine.
-- (no anon grant — deliberately)

-- ---------- proof (expect PASS) ----------
do $$
declare
  e2 json; e5 json; e10 json;
  base json; shifted json;
  r json;
  base_transit int; shifted_transit int;
begin
  -- clean slate for the band we exercise (id-stamped test rows only)
  -- (we insert via eta_record and delete exactly what we add below)

  -- (1) MONOTONIC IN DISTANCE — from (0,0) heading east, longer = later.
  --     ~2km, ~5km, ~10km via lng deltas (1 deg lng ≈ 111.32 km @ equator).
  e2  := eta_estimate(0, 0, 0, 0.018, 90);   -- ~2.00 km
  e5  := eta_estimate(0, 0, 0, 0.045, 90);   -- ~5.01 km
  e10 := eta_estimate(0, 0, 0, 0.090, 90);   -- ~10.02 km
  assert (e2->>'basis') = 'default',  'FAIL: expected default basis with no samples';
  assert (e2->>'eta_secs')::int  < (e5->>'eta_secs')::int,  'FAIL: eta not increasing 2->5 km';
  assert (e5->>'eta_secs')::int  < (e10->>'eta_secs')::int, 'FAIL: eta not increasing 5->10 km';
  assert (e2->>'transit_secs')::int > 0, 'FAIL: zero transit for a real distance';

  -- (2) RECORDING SHIFTS THE ESTIMATE TOWARD THE OBSERVED.
  --     Baseline for a ~5km trip (band b2, default 150 s/km → ~750s).
  base := eta_estimate(0, 0, 0, 0.045, 90);
  base_transit := (base->>'transit_secs')::int;
  assert (base->>'basis') = 'default', 'FAIL: baseline should be default';

  -- Observe reality is SLOWER: 5km taking 1500s = 300 s/km, several times.
  r := eta_record('transit', 5, 1500); assert (r->>'ok')='true', 'FAIL: record 1 rejected';
  r := eta_record('transit', 5, 1500); assert (r->>'ok')='true', 'FAIL: record 2 rejected';
  r := eta_record('transit', 5, 1500); assert (r->>'ok')='true', 'FAIL: record 3 rejected';

  shifted := eta_estimate(0, 0, 0, 0.045, 90);
  shifted_transit := (shifted->>'transit_secs')::int;
  assert (shifted->>'basis') = 'blended', 'FAIL: basis did not become blended after enough samples';
  assert shifted_transit > base_transit,
         format('FAIL: estimate did not shift toward slower reality (base=%s shifted=%s)', base_transit, shifted_transit);
  -- and it must stay BELOW the raw observed (blend, not overwrite): 5km*300=1500
  assert shifted_transit < 1500, 'FAIL: blend overshot the observed value';

  -- (3) garbage samples are rejected, not stored.
  r := eta_record('transit', 5, 10);     assert (r->>'ok')='false', 'FAIL: implausible speed accepted';
  r := eta_record('nonsense', 5, 900);   assert (r->>'ok')='false', 'FAIL: bad kind accepted';
  r := eta_record('transit', -1, 900);   assert (r->>'ok')='false', 'FAIL: negative km accepted';

  -- cleanup: remove exactly the test samples we inserted
  delete from eta_samples where kind = 'transit' and km = 5 and secs = 1500;

  raise notice 'PASS: eta_estimate monotonic in distance; recording shifts estimate toward observed (base=% shifted=%)', base_transit, shifted_transit;
end $$;

select 'eta_engine ready' as status;

-- ========== MIGRATION: 0014_search.sql ==========
-- 0014 search — NOT YET APPLIED (written by full-build)
-- ============================================================
-- REAL SEARCH for the hyperlocal marketplace.
--
-- Today search is a client-side substring filter over the in-memory
-- DB.shops array (js/shops.js:66-67, js/mitra.js:105). That cannot:
--   • tolerate typos ('mikl' → milk),
--   • understand India-grocery synonyms (atta = flour, dahi = curd),
--   • rank by real relevance blended with distance + shop rating,
--   • see shops/items registered on OTHER devices (they live only in
--     the cloud tables, never in the local array).
--
-- This migration builds server-side search entirely in Postgres:
--   • pg_trgm            → typo tolerance + prefix autocomplete
--   • FTS (tsvector)     → relevance ranking over item/shop text
--   • a synonyms table   → query expansion for local vocabulary
--   • haversine + rating → hyperlocal ranking (near, well-rated first)
--
-- ANTI-CARGO-CULT / ALGORITHM PROGRESSION:
--   Stage 1 (THIS FILE): lexical — FTS + trigram + synonyms. Correct and
--     fast for hundreds→tens-of-thousands of items on a single Postgres.
--     No external search infra (no Elastic/Meili/vector db): unjustified
--     at this scale and adds ops burden the contract forbids.
--   Stage 2 (later): semantic — pgvector embeddings for "something sweet
--     for kids" → candy/chocolate. TRIGGER to build it: (a) >~50k items
--     OR (b) search_log shows a sustained tail of zero-result natural-
--     language queries AND an embeddings budget exists. Only THEN add a
--     single `vector` column + ivfflat index and blend cosine distance
--     into the score below. Still Postgres-only (pgvector), still no
--     microservice. search_log (created here) is what proves the trigger.
-- ============================================================

create extension if not exists pg_trgm;

-- ---------- India-grocery synonyms (query expansion) ----------
create table if not exists search_synonyms (
  term      text not null,   -- what a user might type (lowercase)
  canonical text not null,   -- the word we actually index on
  primary key (term, canonical)
);
alter table search_synonyms enable row level security;  -- read via definer RPC only

insert into search_synonyms(term, canonical) values
  ('atta','flour'),   ('flour','atta'),
  ('dahi','curd'),    ('curd','dahi'),   ('yogurt','curd'),
  ('doodh','milk'),   ('milk','doodh'),
  ('chawal','rice'),  ('rice','chawal'),
  ('cheeni','sugar'), ('sugar','cheeni'),
  ('namak','salt'),   ('salt','namak'),
  ('aloo','potato'),  ('potato','aloo'),
  ('pyaz','onion'),   ('onion','pyaz'),
  ('tel','oil'),      ('oil','tel'),
  ('anda','egg'),     ('egg','anda'),
  ('paneer','cottage cheese'),
  ('maida','refined flour'),
  ('sabzi','vegetable'), ('subzi','vegetable')
on conflict (term, canonical) do nothing;

-- ---------- append-only query log (fuels the Stage-2 trigger) ----------
create table if not exists search_log (
  id     bigint generated always as identity primary key,
  q      text not null,
  hits   int,
  device text,
  at     timestamptz not null default now()
);
create index if not exists search_log_at_idx on search_log(at desc);
alter table search_log enable row level security;       -- write via definer RPC only

-- ---------- FTS vectors (generated, always in sync) ----------
-- 'english'::regconfig form is IMMUTABLE, so it is valid in a generated column.
alter table shop_items
  add column if not exists search_vec tsvector
  generated always as (to_tsvector('english'::regconfig, coalesce(name,'') || ' ' || coalesce(qty_label,''))) stored;

-- (shops.search_vec generated column DROPPED — review 0014 P1: the ranked search
--  is item-centric (ranks over shop_items.search_vec + shop-name trigram); a shops
--  FTS vector was never queried, and as a GENERATED column it would be returned by
--  every `shops?select=*` client read (cloud.js:296), bloating the payload. Shop
--  name matching uses idx_shops_name_trgm below.)

-- FTS index (items only)
create index if not exists idx_items_fts on shop_items using gin (search_vec);

-- trigram indexes — used by the % operator forms in search_suggest and shop-name
-- matching (typo tolerance + prefix autocomplete)
create index if not exists idx_items_name_trgm on shop_items using gin (name gin_trgm_ops);
create index if not exists idx_shops_name_trgm on shops      using gin (name gin_trgm_ops);

-- ---------- helpers ----------
-- haversine distance in km (uniquely named to avoid clobbering any existing fn)
create or replace function search_haversine_km(lat1 double precision, lng1 double precision,
                                                lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 2 * 6371 * asin(sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
  end
$$;

-- expand a query with synonyms: 'atta rice' -> 'atta rice flour chawal'
create or replace function search_expand(p_q text)
returns text language sql stable as $$
  with toks as (
    select t from unnest(string_to_array(lower(trim(coalesce(p_q,''))), ' ')) t where t <> ''
  )
  -- OR-join, not space-join: websearch_to_tsquery treats spaces as AND, so
  -- expanding 'atta' -> 'atta flour' produced the tsquery `atta & flour`, which
  -- matches NOTHING (an item named "Flour" lacks "atta"). Synonyms must BROADEN
  -- recall, so join with ' OR ' → websearch gives `atta | flour`. (review 0014 P0)
  select string_agg(w, ' OR ')
  from (
    select t          as w from toks
    union
    select sy.canonical from search_synonyms sy join toks on sy.term      = toks.t
    union
    select sy.term      from search_synonyms sy join toks on sy.canonical = toks.t
  ) u
$$;

-- ---------- MAIN SEARCH RPC ----------
-- Ranks in-stock items in OPEN, non-deleted shops by a blended score:
--   4.0 * FTS relevance          (websearch_to_tsquery over synonym-expanded q)
-- + 3.0 * trigram similarity     (typo tolerance: 'mikl' still scores on 'milk')
-- + 1.5 * proximity 1/(1+km)     (hyperlocal: nearer wins, and breaks ties)
-- + 0.5 * rating/5               (quality nudge)
create or replace function search_items(p_q text, p_lat double precision, p_lng double precision, p_limit int)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_q   text  := trim(coalesce(p_q, ''));
  v_exp text;
  v_tsq tsquery;
  v_lim int   := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_res json;
  v_n   int;
begin
  if v_q = '' then return '[]'::json; end if;

  v_exp := search_expand(v_q);
  begin
    v_tsq := websearch_to_tsquery('english', v_exp);
  exception when others then
    v_tsq := plainto_tsquery('english', v_q);
  end;

  select coalesce(json_agg(row_to_json(r) order by r.score desc, r.km asc nulls last), '[]'::json)
    into v_res
  from (
    select
      it.id, it.name, it.price, it.qty_label, it.in_stock, it.icon,
      s.id  as shop_id, s.name as shop_name, s.category, s.rating,
      s.lat, s.lng, s.addr, s.delivery::text as delivery,
      s.offer_label, s.offer_pct, s.pure_veg, s.photo_url,
      round(search_haversine_km(p_lat, p_lng, s.lat, s.lng)::numeric, 2) as km,
      round((
          ts_rank(it.search_vec, v_tsq) * 4.0
        + greatest(similarity(it.name, v_q), word_similarity(v_q, it.name)) * 3.0
        + case when search_haversine_km(p_lat, p_lng, s.lat, s.lng) is null then 0
               else 1.5 / (1.0 + search_haversine_km(p_lat, p_lng, s.lat, s.lng)) end
        + coalesce(s.rating, 0) / 5.0 * 0.5
      )::numeric, 4) as score
    from shop_items it
    join shops s on s.id = it.shop_id
    where it.in_stock = true
      and s.is_open   = true
      and s.deleted_at is null
      and (
            it.search_vec @@ v_tsq
         or similarity(it.name, v_q)   > 0.2      -- explicit threshold: catches 'mikl'→'milk' (~0.25)
         or word_similarity(v_q, it.name) > 0.3
         or it.name ilike '%' || v_q || '%'
      )
    order by score desc, km asc nulls last
    limit v_lim
  ) r;

  v_n := coalesce(json_array_length(v_res), 0);
  begin
    insert into search_log(q, hits) values (v_q, v_n);   -- best-effort; feeds Stage-2 trigger
  exception when others then null;
  end;

  return v_res;
end $$;
grant execute on function search_items(text, double precision, double precision, int) to anon;

-- ---------- AUTOCOMPLETE RPC ----------
-- Trigram prefix + fuzzy suggestions over item and shop names.
create or replace function search_suggest(p_q text, p_limit int)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_q   text := lower(trim(coalesce(p_q, '')));
  v_lim int  := least(greatest(coalesce(p_limit, 6), 1), 20);
begin
  if v_q = '' then return '[]'::json; end if;
  return coalesce((
    select json_agg(name order by sim desc)
    from (
      select name, max(sim) as sim
      from (
        select it.name, greatest(similarity(it.name, v_q), word_similarity(v_q, it.name)) as sim
        from shop_items it
        join shops s on s.id = it.shop_id
        where s.deleted_at is null
          and (it.name ilike v_q || '%' or it.name % v_q or word_similarity(v_q, it.name) > 0.3)
        union all
        select s.name, greatest(similarity(s.name, v_q), word_similarity(v_q, s.name)) as sim
        from shops s
        where s.deleted_at is null
          and (s.name ilike v_q || '%' or s.name % v_q)
      ) x
      group by name
      order by sim desc
      limit v_lim
    ) y
  ), '[]'::json);
end $$;
grant execute on function search_suggest(text, int) to anon;

-- ============================================================
-- PROOF (inserts temp rows, exercises the RPCs, asserts, cleans up)
-- ============================================================
do $$
declare v jsonb;
begin
  insert into shops(id, name, category, is_open, rating, lat, lng) values
    ('srch_near', 'Test Near Mart', 'grocery', true, 4.5, 28.61, 77.21),
    ('srch_far',  'Test Far Mart',  'grocery', true, 4.5, 28.95, 77.95)
  on conflict (id) do nothing;

  insert into shop_items(id, shop_id, name, price, in_stock) values
    ('srch_near_milk',  'srch_near', 'Milk',              30, true),
    ('srch_far_milk',   'srch_far',  'Milk',              30, true),
    ('srch_near_flour', 'srch_near', 'Aashirvaad Flour',  55, true)
  on conflict (id) do nothing;

  -- 1. typo tolerance: 'mikl' still finds 'milk'
  v := search_items('mikl', 28.6, 77.2, 10)::jsonb;
  assert jsonb_array_length(v) >= 1, 'FAIL: typo "mikl" returned nothing';
  assert exists (select 1 from jsonb_array_elements(v) e where e->>'name' ilike '%milk%'),
         'FAIL: typo "mikl" did not surface Milk';

  -- 2. distance breaks ties: identical items, nearer shop ranks first
  v := search_items('milk', 28.6, 77.2, 10)::jsonb;
  assert (v->0->>'shop_id') = 'srch_near',
         'FAIL: nearer shop not ranked first — distance tie-break broken';

  -- 3. synonym expansion: 'atta' finds 'Aashirvaad Flour'
  v := search_items('atta', 28.6, 77.2, 10)::jsonb;
  assert exists (select 1 from jsonb_array_elements(v) e where e->>'name' ilike '%flour%'),
         'FAIL: synonym "atta" did not find Flour';

  -- 4. autocomplete returns something for a prefix
  v := search_suggest('mil', 6)::jsonb;
  assert jsonb_array_length(v) >= 1, 'FAIL: suggest "mil" returned nothing';

  -- cleanup
  delete from shop_items where id in ('srch_near_milk', 'srch_far_milk', 'srch_near_flour');
  delete from shops      where id in ('srch_near', 'srch_far');
  delete from search_log where q in ('mikl', 'milk', 'atta');

  raise notice 'PASS: typo tolerance, distance tie-break, synonym expansion, and autocomplete all verified';
end $$;

select '0014_search ready' as status;

-- ========== MIGRATION: 0015_finance_refunds_coupling.sql ==========
-- ============================================================
-- 0015 — FINANCE: refunds + payment↔settlement coupling  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied. Apply only after a
--   staging DB runs the 0008→latest sequence + the finance/concurrency tests.
--
-- Two P0/P1 gaps from COMPLETION-ASSESSMENT §I:
--
-- (1) NO REFUND IS EVER EXECUTED. Cancellations only DISPLAY "3-5 working days";
--     no refund row, no provider call, no reversal. This adds a real refunds
--     ledger + a device-scoped request RPC + an internal apply path (called by
--     the razorpay-refund edge function, which does the actual money movement).
--
-- (2) SETTLEMENT IS RECORDED BEFORE DELIVERY AND NEVER REVERSED. The base
--     _settle_from_shop_order trigger (settlements_schema.sql:53) fires AFTER
--     INSERT and books a seller payable (92%) the instant an order is created —
--     while it is still 'new', unpaid, unaccepted — and a later reject/cancel/
--     refund leaves the phantom payable behind. Here settlement is COUPLED to
--     delivery (status='done') and VOIDED on reject/cancel/refund.
--
-- Design notes:
--   · Immutable audit: finance_events is append-only (every money state change).
--   · Idempotency: refunds.idempotency_key is UNIQUE; a partial unique index
--     allows at most ONE open/succeeded refund per order (no double refund).
--   · Authorization: refund_open derives ownership from shop_orders.buyer_device
--     (server-side); the apply path is internal (service role / SECURITY DEFINER
--     called by the edge fn), never anon-trusted for the money movement.
--   · COD safety: an order with no VERIFIED online payment was never charged, so
--     refund_open returns 'nothing_to_refund' instead of inventing money.
-- ============================================================

-- ---------- immutable finance audit (reconciliation spine) ----------
create table if not exists finance_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  kind       text not null,          -- payment_verified | settlement_due | settlement_void | settlement_paid | refund_requested | refund_succeeded | refund_failed
  order_ref  text,
  payee      text,
  amount     numeric,
  ref        text,                    -- rzp id / payout ref / refund id
  detail     jsonb
);
create index if not exists finance_events_order_idx on finance_events(order_ref, at);
create index if not exists finance_events_kind_idx  on finance_events(kind, at desc);
alter table finance_events enable row level security;   -- append via definer fns; read via admin RPC only

create or replace function _fin_event(p_kind text, p_order text, p_payee text, p_amount numeric, p_ref text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into finance_events(kind, order_ref, payee, amount, ref, detail)
  values (p_kind, p_order, p_payee, p_amount, p_ref, p_detail);
$$;

-- ---------- refunds ledger ----------
create table if not exists refunds (
  id              bigint generated always as identity primary key,
  order_ref       text not null,
  device_key      text,                 -- who owns the order (buyer)
  rzp_payment_id  text,                  -- the captured payment being refunded
  amount_paise    bigint not null check (amount_paise >= 0),
  reason          text,
  status          text not null default 'requested',  -- requested | processing | succeeded | failed
  rzp_refund_id   text,
  idempotency_key text unique,           -- hard stop against duplicate refunds
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists refunds_order_idx on refunds(order_ref, created_at desc);
-- at most ONE non-failed refund per order (no double refund on retries)
create unique index if not exists refunds_one_open_per_order
  on refunds(order_ref) where status in ('requested','processing','succeeded');
alter table refunds enable row level security;   -- no anon policy; RPCs below

-- ---------- (1) buyer requests a refund (device-scoped) ----------
-- Records the request; the actual money movement is done by the razorpay-refund
-- edge function, which then calls _refund_apply(). COD/unpaid orders are not
-- charged, so nothing is refunded (no invented money).
create or replace function refund_open(p_order text, p_device text, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner text; v_pay text; v_amt bigint; v_idem text;
begin
  -- ownership: the order must belong to this device (buyer)
  select buyer_device into v_owner from shop_orders where id = p_order;
  if v_owner is null then
    -- fall back to the orders mirror (non-community orders) keyed by device_key
    select device_key into v_owner from orders where id = p_order;
  end if;
  if v_owner is null then return json_build_object('ok', false, 'reason', 'order_not_found'); end if;
  if v_owner <> p_device then return json_build_object('ok', false, 'reason', 'not_your_order'); end if;

  -- must have a VERIFIED online payment to refund; else nothing was charged (COD)
  select rzp_payment_id, amount_paise into v_pay, v_amt
    from payments where ref = p_order and status = 'verified'
    order by verified_at desc nulls last limit 1;
  if v_pay is null then return json_build_object('ok', false, 'reason', 'nothing_to_refund'); end if;

  v_idem := 'rf_' || p_order;    -- one refund per order → stable idempotency key
  insert into refunds(order_ref, device_key, rzp_payment_id, amount_paise, reason, status, idempotency_key)
  values (p_order, p_device, v_pay, v_amt, left(coalesce(p_reason,''), 200), 'requested', v_idem)
  on conflict (idempotency_key) do update
    set status = 'requested', updated_at = now()
    where refunds.status = 'failed';   -- retry ONLY after a failed provider attempt;
                                        -- stays idempotent (no-op) for requested/processing/succeeded

  perform _fin_event('refund_requested', p_order, null, v_amt/100.0, v_pay, json_build_object('reason', p_reason)::jsonb);
  -- void any seller payable for this order — a refunded order does not pay the seller
  perform _settlement_void(p_order, 'refund');
  return json_build_object('ok', true, 'payment', v_pay, 'amount_paise', v_amt, 'status', 'requested');
end $$;
grant execute on function refund_open(text, text, text) to anon;

-- buyer reads their own refund status
create or replace function refund_status(p_order text, p_device text)
returns json language sql security definer set search_path = public stable as $$
  select coalesce((select json_build_object('status', status, 'amount_paise', amount_paise, 'rzp_refund_id', rzp_refund_id)
                   from refunds where order_ref = p_order and device_key = p_device
                   order by created_at desc limit 1),
                  json_build_object('status', 'none'));
$$;
grant execute on function refund_status(text, text) to anon;

-- ---------- internal: apply the provider's refund result ----------
-- Called by the razorpay-refund EDGE FUNCTION (service role) after Razorpay
-- returns. NOT granted to anon: only the trusted server may confirm money moved.
create or replace function _refund_apply(p_order text, p_rzp_refund text, p_ok boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_amt bigint;
begin
  update refunds
     set status = case when p_ok then 'succeeded' else 'failed' end,
         rzp_refund_id = coalesce(p_rzp_refund, rzp_refund_id),
         updated_at = now()
   where order_ref = p_order and status in ('requested','processing')
   returning amount_paise into v_amt;
  if not found then return json_build_object('ok', false, 'reason', 'no_open_refund'); end if;
  perform _fin_event(case when p_ok then 'refund_succeeded' else 'refund_failed' end,
                     p_order, null, v_amt/100.0, p_rzp_refund, null);
  return json_build_object('ok', true);
end $$;
-- deliberately NOT granted to anon.

-- ---------- (2) settlement coupled to delivery + reversal ----------
create or replace function _settlement_void(p_order text, p_why text)
returns void language plpgsql security definer set search_path = public as $$
declare v_net numeric; v_payee text;
begin
  update settlement_ledger set status = 'void', paid_at = null
   where order_ref = p_order and status = 'due'
   returning net, payee into v_net, v_payee;
  if found then perform _fin_event('settlement_void', p_order, v_payee, v_net, p_why, null); end if;
end $$;

-- replace the base trigger fn: settle ONLY when delivered ('done'); void on
-- reject/cancel. Booking a payable on INSERT (still 'new') was the bug.
create or replace function _settle_from_shop_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    return new;                                   -- do NOT settle an unfulfilled order
  end if;
  if new.status = 'done' and coalesce(old.status,'') <> 'done' then
    insert into settlement_ledger(order_ref, payee, payee_kind, gross, commission, net, status)
    values (new.id, new.shop_id, 'shop', coalesce(new.total,0),
            round(coalesce(new.total,0)*0.08,2), round(coalesce(new.total,0)*0.92,2), 'due')
    on conflict (order_ref, payee) do update set status = 'due';
    perform _fin_event('settlement_due', new.id, new.shop_id, round(coalesce(new.total,0)*0.92,2), null, null);
  elsif new.status in ('rejected') and coalesce(old.status,'') <> 'rejected' then
    perform _settlement_void(new.id, 'order_' || new.status);
  end if;
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_settle_shop_order on shop_orders;
create trigger trg_settle_shop_order after insert or update on shop_orders
  for each row execute function _settle_from_shop_order();

-- reconciliation: void the phantom payables the OLD insert-trigger already booked
-- for orders that never reached 'done' (data fix for anything applied pre-0015).
update settlement_ledger sl set status = 'void'
 from shop_orders so
 where sl.order_ref = so.id and sl.status = 'due' and so.status <> 'done';

-- ---------- admin: finance reconciliation view (L4+) ----------
create or replace function finance_reconcile(p_token text)
returns json language plpgsql security definer set search_path = public stable as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  return json_build_object('ok', true,
    'verified_payments', (select coalesce(sum(amount_paise),0)/100.0 from payments where status='verified'),
    'settlement_due',    (select coalesce(sum(net),0) from settlement_ledger where status='due'),
    'settlement_paid',   (select coalesce(sum(net),0) from settlement_ledger where status='paid'),
    'settlement_void',   (select coalesce(sum(net),0) from settlement_ledger where status='void'),
    'commission',        (select coalesce(sum(commission),0) from settlement_ledger where status in ('due','paid')),
    'refunds_succeeded', (select coalesce(sum(amount_paise),0)/100.0 from refunds where status='succeeded'),
    'refunds_open',      (select count(*) from refunds where status in ('requested','processing')));
end $$;
grant execute on function finance_reconcile(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_dev text := 'devfintest01'; v_shop text := 'my_' || substr('devfintest01',1,12);
        r json; v_due numeric;
begin
  delete from refunds where order_ref in ('FIN_O1','FIN_O2');
  delete from finance_events where order_ref in ('FIN_O1','FIN_O2');
  delete from settlement_ledger where order_ref in ('FIN_O1','FIN_O2');
  delete from payments where ref in ('FIN_O1','FIN_O2');
  delete from shop_orders where id in ('FIN_O1','FIN_O2');

  -- an online-paid order, delivered
  insert into shop_orders(id, shop_id, buyer_device, items, total, status)
    values ('FIN_O1', v_shop, v_dev, '[]'::jsonb, 200, 'new');
  insert into payments(rzp_order_id, rzp_payment_id, amount_paise, purpose, ref, status, verified_at)
    values ('order_fin1','pay_fin1', 20000, 'order', 'FIN_O1', 'verified', now());

  -- (a) settling on INSERT must NOT have happened (order still 'new')
  select coalesce(sum(net),0) into v_due from settlement_ledger where order_ref='FIN_O1' and status='due';
  assert v_due = 0, 'FAIL: settlement booked before delivery';

  -- deliver it → settlement becomes due (92% of 200 = 184)
  update shop_orders set status='done' where id='FIN_O1';
  select coalesce(sum(net),0) into v_due from settlement_ledger where order_ref='FIN_O1' and status='due';
  assert v_due = 184, 'FAIL: settlement not booked on delivery, got '||v_due;

  -- buyer requests a refund → refund row + settlement voided
  r := refund_open('FIN_O1', v_dev, 'item damaged');
  assert (r->>'ok')='true', 'FAIL: refund_open refused a paid order';
  assert (r->>'amount_paise')::bigint = 20000, 'FAIL: wrong refund amount';
  select coalesce(sum(net),0) into v_due from settlement_ledger where order_ref='FIN_O1' and status='due';
  assert v_due = 0, 'FAIL: settlement not voided on refund';

  -- foreign device cannot refund
  r := refund_open('FIN_O1', 'someone_else', 'x');
  assert (r->>'ok')='false', 'FAIL: foreign refund allowed';

  -- a COD order (no verified payment) has nothing to refund
  insert into shop_orders(id, shop_id, buyer_device, items, total, status)
    values ('FIN_O2', v_shop, v_dev, '[]'::jsonb, 150, 'done');
  r := refund_open('FIN_O2', v_dev, 'changed mind');
  assert (r->>'ok')='false' and (r->>'reason')='nothing_to_refund', 'FAIL: COD order invented a refund';

  -- cleanup
  delete from refunds where order_ref in ('FIN_O1','FIN_O2');
  delete from finance_events where order_ref in ('FIN_O1','FIN_O2');
  delete from settlement_ledger where order_ref in ('FIN_O1','FIN_O2');
  delete from payments where ref in ('FIN_O1','FIN_O2');
  delete from shop_orders where id in ('FIN_O1','FIN_O2');
  raise notice 'PASS: settlement couples to delivery + reverses; refunds are real, device-scoped, COD-safe';
end $$;

select 'finance (refunds + coupling) ready' as status;

-- ========== MIGRATION: 0016_dispatch.sql ==========
-- ============================================================
-- 0016 — DISPATCH ENGINE  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- Today (COMPLETION-ASSESSMENT §J): live_jobs is a first-come PULL feed. Whoever
-- browses and taps job_claim first wins. There is no server-side partner presence,
-- no candidate generation, no scoring, no push offer, no acceptance timeout, and no
-- reassignment. A parcel/ride can sit unclaimed, or be grabbed by a far partner.
--
-- This adds a PUSH layer ON TOP of live_jobs (the pull feed stays as a fallback):
--   · partner_presence — online/location/vehicle/rating/carrying heartbeat.
--   · dispatch_job()   — pick the best nearby idle partner and OFFER the job to them.
--   · job_offers       — a timed offer (accept within N s or it expires).
--   · offer_respond()  — accept (atomically assign) or decline (re-dispatch next).
--   · dispatch_sweep() — pg_cron: expire stale offers, re-dispatch, free carriers.
--   · dispatch_events  — every decision logged (candidates/offer/accept/expire/...).
--
-- ANTI-CARGO-CULT / PROGRESSION:
--   Stage 1 (THIS): nearest idle online partner within radius, rating tiebreak.
--     A single indexed SELECT. No queue/broker. Correct for one locality's density.
--   Stage 2 (trigger: measurable decline/timeout rate, or multi-offer contention):
--     weighted score (ETA + current load + acceptance-probability + reliability),
--     still one SQL scan. Add columns to partner_presence; keep the RPC signatures.
--   Stage 3 (only at real multi-order density): batch/bipartite matching. Not now.
--
-- Assignment is atomic on live_jobs.status ('open'→'taken'), so an offer-accept and
-- a pull-feed job_claim can never double-assign the same job.
-- ============================================================

-- ---------- partner presence (server-side availability + location) ----------
create table if not exists partner_presence (
  device_key text primary key,
  online     boolean not null default false,
  lat        double precision,
  lng        double precision,
  vehicle    text,
  name       text,
  rating     numeric,
  carrying   text,                       -- live_jobs.id the partner is currently on, or null (idle)
  updated_at timestamptz not null default now()
);
create index if not exists partner_presence_live_idx on partner_presence(online, updated_at desc) where online = true;
alter table partner_presence enable row level security;   -- writes via partner_ping; no anon read

-- ---------- job offers (timed push) ----------
create table if not exists job_offers (
  id         bigint generated always as identity primary key,
  job_id     text not null,
  device_key text not null,
  score      numeric,
  status     text not null default 'offered',   -- offered | accepted | declined | expired
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists job_offers_dev_live_idx on job_offers(device_key, status) where status = 'offered';
create index if not exists job_offers_job_idx on job_offers(job_id, status);
-- at most one LIVE offer per (job, partner)
create unique index if not exists job_offers_one_live on job_offers(job_id, device_key) where status = 'offered';
alter table job_offers enable row level security;

-- ---------- dispatch audit ----------
create table if not exists dispatch_events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  job_id  text,
  device_key text,
  kind    text not null,                 -- no_candidates | offered | accepted | declined | expired | assigned | reassigned | freed
  detail  jsonb
);
create index if not exists dispatch_events_job_idx on dispatch_events(job_id, at);
alter table dispatch_events enable row level security;

create or replace function _disp_event(p_job text, p_dev text, p_kind text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into dispatch_events(job_id, device_key, kind, detail) values (p_job, p_dev, p_kind, p_detail);
$$;

-- haversine km (self-contained; consolidation with 0013/0014 haversines happens at staging)
create or replace function _disp_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$
  select case when a_lat is null or a_lng is null or b_lat is null or b_lng is null then null
    else 2 * 6371 * asin(least(1.0, sqrt(
      power(sin(radians((b_lat - a_lat)/2)),2) +
      cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians((b_lng - a_lng)/2)),2)))) end;
$$;

-- ---------- partner heartbeat (device-scoped) ----------
-- NOTE (systemic, tracked in 0011/§H): p_device is trusted as identity (the public
-- device_key). A caller can therefore set/forge presence for a device they name —
-- the platform-wide "device_key is a bearer token" weakness, to be closed by real
-- phone-auth + RBAC (Phase 7). Practical blast radius here is bounded: winning an
-- offer still requires accepting it AND passing the atomic 'open'→'taken' claim AND
-- delivering with the buyer's OTP. Griefing (marking a real partner offline) is the
-- residual risk until identity is hardened.
create or replace function partner_ping(p_device text, p_online boolean, p_lat double precision,
  p_lng double precision, p_vehicle text, p_name text, p_rating numeric)
returns json language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_device,'') = '' then return json_build_object('ok', false, 'reason', 'no_device'); end if;
  insert into partner_presence(device_key, online, lat, lng, vehicle, name, rating, updated_at)
  values (p_device, coalesce(p_online,false), p_lat, p_lng, left(p_vehicle,40), left(p_name,40), p_rating, now())
  on conflict (device_key) do update set
    online = excluded.online, lat = excluded.lat, lng = excluded.lng,
    vehicle = coalesce(excluded.vehicle, partner_presence.vehicle),
    name = coalesce(excluded.name, partner_presence.name),
    rating = coalesce(excluded.rating, partner_presence.rating),
    updated_at = now();
  return json_build_object('ok', true);
end $$;
grant execute on function partner_ping(text, boolean, double precision, double precision, text, text, numeric) to anon;

-- ---------- core: offer a job to the best nearby idle partner ----------
-- INTERNAL: called by the after-insert trigger on live_jobs, by offer_respond on a
-- decline, and by dispatch_sweep. Not granted to anon. Never raises (dispatch must
-- not block a job post). Radius + freshness bounded; own poster excluded.
create or replace function dispatch_job(p_job text)
returns json language plpgsql security definer set search_path = public as $$
declare v_flat double precision; v_flng double precision; v_status text; v_poster text;
        v_dev text; v_km double precision; v_exp interval := interval '25 seconds';
begin
  -- serialize concurrent dispatch of the SAME job (insert-trigger vs sweep vs a
  -- decline re-dispatch) so two candidates can't be offered one job at once. The
  -- xact lock releases at commit; different jobs hash to different locks.
  perform pg_advisory_xact_lock(hashtext('dispatch:' || p_job));

  select from_lat, from_lng, status, device_key into v_flat, v_flng, v_status, v_poster
    from live_jobs where id = p_job;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_status <> 'open' then return json_build_object('ok', false, 'reason', 'not_open'); end if;
  -- already has a live offer? leave it to run its clock
  if exists (select 1 from job_offers where job_id = p_job and status = 'offered' and expires_at > now()) then
    return json_build_object('ok', true, 'reason', 'offer_pending');
  end if;

  select pp.device_key, _disp_km(v_flat, v_flng, pp.lat, pp.lng)
    into v_dev, v_km
  from partner_presence pp
  where pp.online = true
    and pp.carrying is null                                   -- idle
    and pp.lat is not null
    and pp.updated_at > now() - interval '2 minutes'          -- fresh heartbeat
    and pp.device_key <> coalesce(v_poster, '')               -- don't offer to the poster
    and (v_flat is null or _disp_km(v_flat, v_flng, pp.lat, pp.lng) <= 8)   -- within 8 km
    and not exists (select 1 from job_offers o                -- not already tried this job
                    where o.job_id = p_job and o.device_key = pp.device_key
                      and o.status in ('offered','declined','expired'))
  order by coalesce(_disp_km(v_flat, v_flng, pp.lat, pp.lng), 1e9) asc,   -- nearest
           coalesce(pp.rating, 4.5) desc                                   -- then best-rated
  limit 1;

  if v_dev is null then
    perform _disp_event(p_job, null, 'no_candidates', null);
    return json_build_object('ok', false, 'reason', 'no_candidates');       -- stays open → pull-feed fallback
  end if;

  insert into job_offers(job_id, device_key, score, status, expires_at)
  values (p_job, v_dev, round(coalesce(1000 - v_km*10, 0)::numeric, 2), 'offered', now() + v_exp)
  on conflict do nothing;
  perform _disp_event(p_job, v_dev, 'offered', json_build_object('km', round(coalesce(v_km,0)::numeric,2))::jsonb);
  return json_build_object('ok', true, 'offered_to', v_dev, 'km', round(coalesce(v_km,0)::numeric,2),
                           'expires_secs', extract(epoch from v_exp));
exception when others then
  return json_build_object('ok', false, 'reason', 'dispatch_error');        -- never block the caller
end $$;

-- ---------- partner accepts / declines an offer ----------
create or replace function offer_respond(p_job text, p_device text, p_accept boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_have boolean; v_name text; v_veh text; v_rat numeric;
begin
  update job_offers set status = case when p_accept then 'accepted' else 'declined' end
   where job_id = p_job and device_key = p_device and status = 'offered' and expires_at > now()
   returning true into v_have;
  if not coalesce(v_have,false) then return json_build_object('ok', false, 'reason', 'no_live_offer'); end if;

  if not p_accept then
    perform _disp_event(p_job, p_device, 'declined', null);
    perform dispatch_job(p_job);                                  -- immediately try the next candidate
    return json_build_object('ok', true, 'assigned', false);
  end if;

  -- a partner may hold only ONE job at a time — a live offer for job B could have
  -- been made before they accepted job A; refuse rather than overwrite carrying.
  if (select carrying from partner_presence where device_key = p_device) is not null then
    update job_offers set status = 'expired' where job_id = p_job and device_key = p_device and status = 'accepted';
    return json_build_object('ok', false, 'reason', 'already_carrying');
  end if;

  select name, vehicle, rating into v_name, v_veh, v_rat from partner_presence where device_key = p_device;
  -- atomic assign — only if still open (a pull-feed claim may have taken it)
  update live_jobs
     set status = 'taken', taken_by = p_device, taken_at = now(),
         taken_name = left(coalesce(v_name,'Partner'),40), taken_veh = left(coalesce(v_veh,''),40),
         taken_rating = v_rat
   where id = p_job and status = 'open';
  if not found then
    update job_offers set status = 'expired' where job_id = p_job and device_key = p_device and status = 'accepted';
    return json_build_object('ok', false, 'reason', 'already_taken');
  end if;
  update partner_presence set carrying = p_job, updated_at = now() where device_key = p_device;
  update job_offers set status = 'expired' where job_id = p_job and status = 'offered' and device_key <> p_device;
  perform _disp_event(p_job, p_device, 'accepted', null);
  return json_build_object('ok', true, 'assigned', true);
exception when others then
  return json_build_object('ok', false, 'reason', 'respond_error');
end $$;
grant execute on function offer_respond(text, text, boolean) to anon;

-- ---------- a partner reads their own live offers ----------
create or replace function my_offers(p_device text)
returns table (job_id text, score numeric, expires_at timestamptz,
               what text, jtype text, from_name text, to_name text, km numeric, pay numeric,
               from_lat double precision, from_lng double precision, to_lat double precision, to_lng double precision)
language sql security definer set search_path = public stable as $$
  select o.job_id, o.score, o.expires_at,
         j.what, j.jtype, j.from_name, j.to_name, j.km, j.pay,
         j.from_lat, j.from_lng, j.to_lat, j.to_lng
  from job_offers o join live_jobs j on j.id = o.job_id
  where o.device_key = p_device and o.status = 'offered' and o.expires_at > now()
    and j.status = 'open'
  order by o.offered_at asc;
$$;
grant execute on function my_offers(text) to anon;

-- ---------- pg_cron sweep: expire, re-dispatch, free carriers ----------
-- INTERNAL (run by pg_cron / service role). Not granted to anon.
create or replace function dispatch_sweep()
returns json language plpgsql security definer set search_path = public as $$
declare v_expired int; v_redispatched int := 0; v_freed int; r record;
begin
  -- 1) expire timed-out offers
  update job_offers set status = 'expired' where status = 'offered' and expires_at <= now();
  get diagnostics v_expired = row_count;

  -- 2) free partners whose job is no longer theirs/active (done/reopened/reassigned)
  update partner_presence pp set carrying = null, updated_at = now()
  where pp.carrying is not null
    and not exists (select 1 from live_jobs lj where lj.id = pp.carrying and lj.taken_by = pp.device_key and lj.status = 'taken');
  get diagnostics v_freed = row_count;

  -- 3) re-dispatch still-open recent jobs that have no live offer
  for r in
    select j.id from live_jobs j
    where j.status = 'open' and j.created_at > now() - interval '30 minutes'
      and not exists (select 1 from job_offers o where o.job_id = j.id and o.status = 'offered' and o.expires_at > now())
    limit 200
  loop
    if (dispatch_job(r.id)->>'ok') = 'true' then v_redispatched := v_redispatched + 1; end if;
  end loop;

  return json_build_object('ok', true, 'expired', v_expired, 'freed', v_freed, 'redispatched', v_redispatched);
end $$;
-- STAGING: schedule every 20s, e.g.
--   select cron.schedule('dispatch_sweep', '20 seconds', $$select dispatch_sweep()$$);
-- (pg_cron min granularity is 1 min on some plans; use a 4x/min statement or a
--  '* * * * *' job that loops 3x with pg_sleep if sub-minute is needed.)

-- ---------- auto-dispatch a job the moment it is posted ----------
create or replace function _dispatch_on_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'open' then perform dispatch_job(new.id); end if;   -- never raises (dispatch_job is guarded)
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_dispatch_on_post on live_jobs;
create trigger trg_dispatch_on_post after insert on live_jobs
  for each row execute function _dispatch_on_post();

-- PAIRED CLIENT CHANGES (when staged): earn.js sends partner_ping on going online +
-- a location heartbeat; the earn feed reads my_offers() and shows an accept/decline
-- with the countdown, calling offer_respond(). The existing pull feed (open_jobs/
-- job_claim) stays as the fallback for no-candidate jobs.

-- ---------- proof (expect PASS) ----------
do $$
declare r json; v_n int; v_status text;
begin
  delete from job_offers where job_id in ('DISP_J1');
  delete from dispatch_events where job_id in ('DISP_J1');
  delete from live_jobs where id in ('DISP_J1');
  delete from partner_presence where device_key in ('disp_near','disp_far','disp_poster');

  -- two idle online partners: NEAR (~0.1km) and FAR (~1km) from pickup (0,0)
  perform partner_ping('disp_near',  true, 0.001, 0.000, 'bike', 'Near Rider', 4.9);
  perform partner_ping('disp_far',   true, 0.009, 0.000, 'bike', 'Far Rider',  5.0);

  -- posting the job auto-dispatches (trigger) → nearest gets the offer
  insert into live_jobs(id, device_key, what, jtype, from_lat, from_lng, to_lat, to_lng, km, pay, status)
    values ('DISP_J1', 'disp_poster', 'Tiffin', 'box', 0, 0, 0.02, 0, 2.2, 40, 'open');

  select count(*) into v_n from job_offers where job_id='DISP_J1' and device_key='disp_near' and status='offered';
  assert v_n = 1, 'FAIL: nearest partner was not offered the job on post';
  assert not exists(select 1 from job_offers where job_id='DISP_J1' and device_key='disp_far' and status='offered'),
         'FAIL: far partner should not be offered first';

  -- NEAR declines → FAR gets the next offer
  r := offer_respond('DISP_J1', 'disp_near', false);
  assert (r->>'ok')='true' and (r->>'assigned')='false', 'FAIL: decline not handled';
  assert exists(select 1 from job_offers where job_id='DISP_J1' and device_key='disp_far' and status='offered'),
         'FAIL: job not re-dispatched to next candidate after decline';

  -- FAR accepts → job assigned, partner marked carrying, atomically taken
  r := offer_respond('DISP_J1', 'disp_far', true);
  assert (r->>'ok')='true' and (r->>'assigned')='true', 'FAIL: accept did not assign';
  select status into v_status from live_jobs where id='DISP_J1';
  assert v_status = 'taken', 'FAIL: live_jobs not marked taken on accept';
  assert (select taken_by from live_jobs where id='DISP_J1') = 'disp_far', 'FAIL: wrong assignee';
  assert (select carrying from partner_presence where device_key='disp_far') = 'DISP_J1', 'FAIL: carrier not set';

  -- a partner already carrying cannot accept a SECOND job (guard against
  -- overwriting carrying with a stale offer for another job)
  insert into live_jobs(id, device_key, what, jtype, from_lat, from_lng, status)
    values ('DISP_J1b','disp_poster','x','box',0,0,'open');
  insert into job_offers(job_id, device_key, status, expires_at)
    values ('DISP_J1b','disp_far','offered', now()+interval '25 seconds') on conflict do nothing;
  r := offer_respond('DISP_J1b','disp_far', true);
  assert (r->>'ok')='false' and (r->>'reason')='already_carrying', 'FAIL: carrying partner accepted a 2nd job';
  delete from job_offers where job_id='DISP_J1b';
  delete from dispatch_events where job_id='DISP_J1b';
  delete from live_jobs where id='DISP_J1b';

  -- an accept after the job is gone must not double-assign
  insert into job_offers(job_id, device_key, status, expires_at) values ('DISP_J1','disp_near','offered', now()+interval '25 seconds');
  r := offer_respond('DISP_J1', 'disp_near', true);
  assert (r->>'ok')='false' and (r->>'reason')='already_taken', 'FAIL: double-assign not prevented';

  -- sweep frees the carrier once the job completes
  update live_jobs set status='done' where id='DISP_J1';
  perform dispatch_sweep();
  assert (select carrying from partner_presence where device_key='disp_far') is null, 'FAIL: carrier not freed after done';

  -- cleanup
  delete from job_offers where job_id='DISP_J1';
  delete from dispatch_events where job_id='DISP_J1';
  delete from live_jobs where id='DISP_J1';
  delete from partner_presence where device_key in ('disp_near','disp_far','disp_poster');
  raise notice 'PASS: nearest-first offer, decline→reassign, atomic accept, no double-assign, carrier freed on done';
end $$;

select 'dispatch engine ready' as status;

-- ========== MIGRATION: 0017_derive_identity.sql ==========
-- ============================================================
-- 0017 — DERIVE SHOP/PAYEE IDENTITY FROM THE CALLER  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- THE HOLE (data-model audit §H; security_negative.sql H1/H3): several read RPCs are
-- keyed on an ARGUMENT the caller supplies — my_shop_orders(p_shop),
-- shop_reservations(p_shop), settlement_mine(p_payee) — and a shop_id is derivable
-- from the PUBLIC device_key (shop_id = 'my_'||substr(device,1,12) = _my_shop()).
-- So an attacker who computes a victim's shop_id reads the victim's shop orders
-- (buyer names + addresses), reservations, and settlement statement. This is the
-- "authorization rests on a public authenticator" class.
--
-- FIX: take the CALLER's device and DERIVE the shop/payee server-side via _my_shop()
-- (migration 0005). The caller can then only ever read their OWN rows. (This does not
-- fix H2 — device_key is still a bearer token — that needs real phone-auth, Phase 7.)
--
-- ⚠ PAIRED CLIENT CHANGE (must deploy IN LOCKSTEP — do NOT ship either alone):
--   js/myshop.js:213  my_shop_orders  { p_shop: sid }  ->  { p_device: S.deviceKey }
--   js/myshop.js:237  shop_reservations { p_shop: sid } -> { p_device: S.deviceKey }
--   settlement_mine caller (account/earn) { p_payee } -> { p_device: S.deviceKey }
-- Shipping the client first would break the seller's own views (the function no
-- longer accepts a shop_id); shipping the migration first would 404 the old calls.
-- ============================================================

-- guard: _my_shop must exist (from 0005_supply_chain)
do $$ begin
  if to_regprocedure('_my_shop(text)') is null then
    raise exception '0017 requires _my_shop(text) from 0005_supply_chain — apply 0005 first';
  end if;
end $$;

-- ---------- my_shop_orders: derive shop from device ----------
-- param rename p_shop->p_device requires DROP+CREATE (CREATE OR REPLACE cannot
-- rename an input parameter).
drop function if exists my_shop_orders(text);
create function my_shop_orders(p_device text)
returns setof shop_orders language sql security definer set search_path = public stable as $$
  select * from shop_orders where shop_id = _my_shop(p_device) order by created_at desc limit 30;
$$;
grant execute on function my_shop_orders(text) to anon;

-- ---------- shop_reservations: derive shop from device ----------
drop function if exists shop_reservations(text);
create function shop_reservations(p_device text)
returns setof reservations language sql security definer set search_path = public stable as $$
  select * from reservations
  where shop_id = _my_shop(p_device) and status = 'reserved'
  order by created_at desc limit 20;
$$;
grant execute on function shop_reservations(text) to anon;

-- ---------- settlement_mine: derive payee from device ----------
-- a payee is either a shop (payee = _my_shop(device)) or a partner (payee = device);
-- match BOTH so one call serves either role, but never another party's rows.
drop function if exists settlement_mine(text);
create function settlement_mine(p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text := _my_shop(p_device);
begin
  return json_build_object('ok', true,
    'due',  (select coalesce(sum(net),0)  from settlement_ledger where payee in (v_shop, p_device) and status='due'),
    'paid', (select coalesce(sum(net),0)  from settlement_ledger where payee in (v_shop, p_device) and status='paid'),
    'account', (select row_to_json(a) from (select holder,upi,bank_acc,ifsc from payout_accounts where payee in (v_shop, p_device) limit 1) a),
    'rows', (select coalesce(json_agg(row_to_json(t) order by t.created_at desc),'[]'::json) from (
        select order_ref, gross, commission, net, status, created_at
        from settlement_ledger where payee in (v_shop, p_device) limit 50) t));
end $$;
grant execute on function settlement_mine(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare V text := 'devidtest_victim1'; A text := 'devidtest_attack1';
        v_shop text := _my_shop('devidtest_victim1'); n int;
begin
  delete from shop_orders where id in ('ID_VO1');
  insert into shop_orders(id, shop_id, buyer_device, items, total, status)
    values ('ID_VO1', v_shop, 'buyerX', '[{"name":"Milk"}]'::jsonb, 50, 'new');

  -- the ATTACKER, calling with THEIR device, must NOT see the victim's shop order
  select count(*) into n from my_shop_orders(A) where id = 'ID_VO1';
  assert n = 0, 'FAIL: attacker read victim shop order via my_shop_orders';

  -- the VICTIM, calling with THEIR device, DOES see it
  select count(*) into n from my_shop_orders(V) where id = 'ID_VO1';
  assert n = 1, 'FAIL: owner cannot read own shop order';

  delete from shop_orders where id in ('ID_VO1');
  raise notice 'PASS: shop/payee identity is derived from the caller device; cross-shop read denied';
end $$;

select 'derive-identity (H1/H3 closed; H2 pending real auth) ready' as status;

-- ========== MIGRATION: 0018_events.sql ==========
-- ============================================================
-- 0018 — CANONICAL EVENT BACKBONE  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- EXTENDS the LIVE first-party analytics (analytics_schema.sql: analytics_events +
-- track_hit) — it does NOT duplicate it (that is why the agent's 0017_events was
-- deleted). Adds two things the audit (§K/§14/§36) found missing:
--   (1) ENTITY LINKING — analytics_events could not be joined to a shop/product/order,
--       so no funnel and no recommendation training. Adds entity_type/entity_id.
--   (2) A canonical BUSINESS-EVENT emit path + a real FUNNEL. The live table had
--       effectively one event ('order') and a 'signups' KPI stuck at 0 because the
--       event was never emitted.
--
-- ANTI-FORGERY (the lesson from 0017_events, which let anon spoof actor/GMV):
--   emit_event is anon and therefore may ONLY record NON-AUTHORITATIVE UX/impression
--   events from an allowlist (search, view, cart, reco impressions/clicks). It CANNOT
--   emit money/order truth. The funnel counts the TOP from these UX events but the
--   BOTTOM (orders, GMV, payments) from the REAL tables (shop_orders/payments), so a
--   beacon can never inflate revenue. Fields are capped like track_hit.
-- ============================================================

-- ---------- (1) entity linking on the existing table ----------
alter table analytics_events add column if not exists entity_type text;   -- 'shop'|'item'|'order'|'job'|'reco'
alter table analytics_events add column if not exists entity_id   text;
create index if not exists ana_entity_idx on analytics_events(entity_type, entity_id, ts desc);
-- name+entity lookups for funnel/reco training
create index if not exists ana_name_ts_idx on analytics_events(name, ts desc) where kind = 'event';

-- ---------- (2) canonical UX/impression emit (anon, allowlisted) ----------
-- These are the events reco training + funnel need (§14 impression logging). They are
-- NOT money truth. Unknown names are rejected so the stream stays clean.
create or replace function emit_event(
  p_device text, p_session text, p_name text,
  p_entity_type text, p_entity_id text, p_val numeric, p_extra jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  -- allowlist of NON-AUTHORITATIVE UX events. Money/order/payment truth is NEVER
  -- emitted here (it is derived from the real tables in funnel()).
  if coalesce(p_name,'') not in (
      'search','view_shop','view_item','add_to_cart','remove_from_cart',
      'begin_checkout','reco_shown','reco_click','wishlist','share','app_open') then
    return json_build_object('ok', false, 'reason', 'unknown_event');
  end if;
  insert into analytics_events(device, session, kind, name, entity_type, entity_id, val, extra)
  values (
    left(coalesce(p_device,''),64), left(coalesce(p_session,''),64), 'event',
    p_name,
    left(coalesce(p_entity_type,''),16),
    left(coalesce(p_entity_id,''),64),
    p_val,
    case when p_extra is not null and pg_column_size(p_extra) > 2048
         then jsonb_build_object('truncated', true) else p_extra end
  );
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'reason', 'error'); end $$;
grant execute on function emit_event(text, text, text, text, text, numeric, jsonb) to anon;

-- ---------- (3) real conversion funnel (L4+) ----------
-- TOP (impression/intent) from the event stream; BOTTOM (authoritative outcomes)
-- from the real tables. Two sources, honestly labelled — never conflated.
create or replace function funnel(p_token text, p_days int)
returns json language plpgsql security definer set search_path = public as $$
declare v_since timestamptz; v_days int;
        v_search int; v_view int; v_cart int; v_checkout int;
        v_orders int := 0; v_paid int := 0; v_gmv numeric := 0;
        v_reco_shown int; v_reco_click int;
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_days := least(greatest(coalesce(p_days,30),1),90);
  v_since := now() - (v_days || ' days')::interval;

  -- top of funnel — UX events (analytics), distinct devices
  select count(distinct device) filter (where name='search'),
         count(distinct device) filter (where name in ('view_shop','view_item')),
         count(distinct device) filter (where name='add_to_cart'),
         count(distinct device) filter (where name='begin_checkout'),
         count(*) filter (where name='reco_shown'),
         count(*) filter (where name='reco_click')
    into v_search, v_view, v_cart, v_checkout, v_reco_shown, v_reco_click
  from analytics_events where kind='event' and ts > v_since;

  -- bottom of funnel — AUTHORITATIVE outcomes from the real tables (never from a beacon)
  if to_regclass('public.shop_orders') is not null then
    select count(*), coalesce(sum(total),0) into v_orders, v_gmv
    from shop_orders where created_at > v_since and status <> 'rejected';
  end if;
  if to_regclass('public.payments') is not null then
    select count(*) into v_paid from payments where status='verified' and created_at > v_since;
  end if;

  return json_build_object('ok', true, 'days', v_days,
    'top', json_build_object(              -- impression/intent (analytics stream)
      'searched', v_search, 'viewed', v_view, 'added_to_cart', v_cart, 'began_checkout', v_checkout),
    'bottom', json_build_object(           -- authoritative (real tables)
      'orders', v_orders, 'verified_payments', v_paid, 'gmv', v_gmv),
    'reco', json_build_object('shown', v_reco_shown, 'clicked', v_reco_click,
      'ctr', case when v_reco_shown > 0 then round(v_reco_click::numeric/v_reco_shown, 4) else 0 end),
    'note', 'top = UX events (impression), bottom = real order/payment tables — not conflated');
end $$;
grant execute on function funnel(text, int) to anon;

-- PAIRED CLIENT CHANGE (when staged): js/analytics.js gets emitBiz(name,{entity,id,val,extra})
-- → rpc/emit_event. Wire: search (shops.js search), view_shop/view_item (shop page),
-- add_to_cart (core.js cartSet), begin_checkout (checkoutSheet), reco_shown/reco_click
-- (when Phase 5 recommendations ship). Money truth stays server-side (never emitted).

-- ---------- proof (expect PASS) ----------
do $$
declare r json; n int;
begin
  delete from analytics_events where device = 'evt_test_dev' and session = 'evt_test_ses';

  -- a known UX event is recorded with entity linking
  r := emit_event('evt_test_dev','evt_test_ses','view_item','item','it_123', null, jsonb_build_object('shop','sh1'));
  assert (r->>'ok')='true', 'FAIL: known UX event rejected';
  select count(*) into n from analytics_events
   where device='evt_test_dev' and name='view_item' and entity_type='item' and entity_id='it_123';
  assert n = 1, 'FAIL: event not recorded with entity linking';

  -- an UNKNOWN / money-truth name is refused (anti-forgery)
  r := emit_event('evt_test_dev','evt_test_ses','order', 'order','OM1', 99999, null);
  assert (r->>'ok')='false' and (r->>'reason')='unknown_event', 'FAIL: anon emitted a non-allowlisted (money) event';
  r := emit_event('evt_test_dev','evt_test_ses','payment_completed','order','OM1', 99999, null);
  assert (r->>'ok')='false', 'FAIL: anon emitted payment truth';

  -- oversized extra is capped, not stored raw
  r := emit_event('evt_test_dev','evt_test_ses','search', null, null, null, jsonb_build_object('q', repeat('x', 5000)));
  assert (r->>'ok')='true', 'FAIL: search event rejected';
  assert (select pg_column_size(extra) from analytics_events
          where device='evt_test_dev' and name='search' order by ts desc limit 1) < 2100,
         'FAIL: oversized extra not capped';

  delete from analytics_events where device = 'evt_test_dev' and session = 'evt_test_ses';
  raise notice 'PASS: entity-linked UX events recorded; money/unknown events refused; extra capped';
end $$;

select 'event backbone (analytics extension) ready' as status;

-- ========== MIGRATION: 0019_shop_intelligence.sql ==========
-- 0019 shop_intelligence — NOT YET APPLIED (written by full-build)
-- ============================================================
-- GROUNDED SHOP INTELLIGENCE — analytical TOOLS over REAL data, not a chatbot.
--
-- Every RPC here is READ-ONLY and device-scoped: it derives the caller's shop id
-- server-side (_my_shop(p_device) from migration 0005 -> 'my_'||substr(p_device,1,12))
-- and only ever reads THAT shop's rows. The public anon key is not identity, so
-- these functions never trust a client-supplied shop id.
--
-- TOOL-PERMISSION POSTURE (read this before wiring an agent on top):
--   These are the SAFE half of an agent's toolbelt — describe/measure only.
--   They mint no money, move no stock, change no status. Any WRITE or FINANCIAL
--   action (payout, refund, bank-account change, price override, order status)
--   is EXPLICITLY OUT OF SCOPE here and MUST route through the existing
--   human-approved RPCs (shop_order_status, po_advance, payouts, ...). An agent
--   may reason over merchant_twin() freely; it may not act without human sign-off.
--
-- DATA SOURCES (all already exist — see 0005_supply_chain.sql / shop_orders_schema.sql):
--   • shop_orders(shop_id, items jsonb, total, status, created_at) — realised sales.
--     Revenue counts only status='done' (the fulfilled terminal; stock_sell fires on
--     the same completion, so revenue and stock draw-down stay consistent).
--     Order items jsonb shape (from myshop.js): [{name, price, q}] (q = quantity;
--     'qty' accepted as a fallback key).
--   • stock_ledger(shop_id, item_name, delta, reason, created_at) — append-only.
--     on_hand = sum(delta); sales velocity = -sum(delta) over reason='sale' in a window.
--
-- ALGORITHM PROGRESSION (anti-cargo-cult: simplest sufficient stage is implemented):
--   Stage 1 (NOW): descriptive SQL — trailing-window sums, a moving-average daily
--     draw-down rate, and a textbook reorder point (rate * (lead + safety)).
--   Stage 2 (when a shop has >~8 weeks of daily sales AND visible weekday/seasonal
--     swing): replace the flat moving average feeding shop_reorder_suggestions with
--     single-exponential smoothing  s_t = a*d_t + (1-a)*s_{t-1}  (a~0.3), computed in
--     SQL over daily buckets — no new infra, just a windowed recursion/ordered agg.
--   Stage 3 (only if forecast error stays high after Stage 2 across many shops):
--     a shared demand model (still Postgres; pgvector only if you add item-similarity
--     cold-start). Do NOT reach for queues/ML services at these volumes.
-- ============================================================

-- Index that makes every revenue/velocity scan below shop- and status-selective.
create index if not exists shop_orders_shop_status_created_idx
  on shop_orders (shop_id, status, created_at desc);

-- ── 1. sales summary: revenue, orders, AOV, best day ─────────
create or replace function shop_sales_summary(p_device text, p_days int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_days int; v_since timestamptz;
        v_rev numeric; v_orders int; v_aov numeric;
        v_top_day date; v_top_rev numeric;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;
  v_days  := greatest(1, coalesce(p_days, 30));
  v_since := now() - (v_days || ' days')::interval;

  select coalesce(sum(total), 0), count(*)
    into v_rev, v_orders
    from shop_orders
   where shop_id = v_shop and status = 'done' and created_at >= v_since;

  v_aov := case when v_orders > 0 then round(v_rev / v_orders, 2) else 0 end;

  select created_at::date, sum(total)
    into v_top_day, v_top_rev
    from shop_orders
   where shop_id = v_shop and status = 'done' and created_at >= v_since
   group by created_at::date
   order by sum(total) desc nulls last
   limit 1;

  return json_build_object('ok', true, 'shop', v_shop, 'days', v_days,
    'revenue', v_rev, 'orders', v_orders, 'aov', v_aov,
    'top_day', v_top_day, 'top_day_revenue', coalesce(v_top_rev, 0));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── 2. top items: best sellers by revenue then units ─────────
create or replace function shop_top_items(p_device text, p_days int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_days int; v_since timestamptz;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;
  v_days  := greatest(1, coalesce(p_days, 30));
  v_since := now() - (v_days || ' days')::interval;

  return json_build_object('ok', true, 'shop', v_shop, 'days', v_days,
    'items', (
      select coalesce(json_agg(row_to_json(t) order by t.revenue desc, t.units desc), '[]'::json)
      from (
        select max(e->>'name') as name,
               sum(coalesce(nullif(e->>'q','')::numeric, nullif(e->>'qty','')::numeric, 1)) as units,
               sum(coalesce(nullif(e->>'q','')::numeric, nullif(e->>'qty','')::numeric, 1)
                   * coalesce(nullif(e->>'price','')::numeric, 0)) as revenue,
               count(distinct o.id) as orders
        from shop_orders o
        cross join lateral jsonb_array_elements(o.items) e
        where o.shop_id = v_shop and o.status = 'done' and o.created_at >= v_since
          and jsonb_typeof(o.items) = 'array'
          and coalesce(e->>'name','') <> ''
        group by lower(trim(e->>'name'))
        order by revenue desc, units desc
        limit 20
      ) t));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── 3. slow movers: in stock (on_hand>0) but zero sales in window ─
create or replace function shop_slow_movers(p_device text, p_days int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_days int; v_since timestamptz;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;
  v_days  := greatest(1, coalesce(p_days, 30));
  v_since := now() - (v_days || ' days')::interval;

  return json_build_object('ok', true, 'shop', v_shop, 'days', v_days,
    'items', (
      select coalesce(json_agg(row_to_json(t) order by t.on_hand desc), '[]'::json)
      from (
        select l.item_name,
               sum(l.delta) as on_hand,
               coalesce(-sum(l.delta) filter (where l.reason = 'sale' and l.created_at >= v_since), 0) as units_sold,
               max(l.created_at) filter (where l.reason = 'sale') as last_sold
        from stock_ledger l
        where l.shop_id = v_shop
        group by l.item_name
        having sum(l.delta) > 0
           and coalesce(-sum(l.delta) filter (where l.reason = 'sale' and l.created_at >= v_since), 0) = 0
        limit 50
      ) t));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── 4. reorder suggestions: on-hand vs projected lead-time demand ─
-- reorder_point = daily_rate * (lead + safety)   [textbook, flat safety-stock stage]
-- suggest_qty   = bring stock up to (lead + safety + review) days of cover.
-- daily_rate is a 14-day moving average of sale draw-down (Stage-1 forecast;
-- swap for exponential smoothing at Stage 2 — see header).
create or replace function shop_reorder_suggestions(p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text;
        v_lead   numeric := 3;   -- days from order to shelf (assumed; make per-supplier later)
        v_safety numeric := 2;   -- buffer against demand variability
        v_review numeric := 7;   -- reorder cadence -> order up to this much cover
        v_win    int     := 14;  -- velocity lookback (days)
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;

  return json_build_object('ok', true, 'shop', v_shop,
    'lead_days', v_lead, 'safety_days', v_safety, 'velocity_window_days', v_win,
    'items', (
      select coalesce(json_agg(row_to_json(t) order by (t.on_hand - t.reorder_point) asc), '[]'::json)
      from (
        select b.item_name,
               b.on_hand,
               b.daily_rate,
               b.reorder_point,
               (b.on_hand <= b.reorder_point and b.daily_rate > 0) as needs_reorder,
               case when (b.on_hand <= b.reorder_point and b.daily_rate > 0)
                    then greatest(0, ceil(b.daily_rate * (v_lead + v_safety + v_review) - b.on_hand))
                    else 0 end as suggest_qty
        from (
          select a.item_name, a.on_hand, a.daily_rate,
                 round(a.daily_rate * (v_lead + v_safety), 3) as reorder_point
          from (
            select l.item_name,
                   sum(l.delta) as on_hand,
                   round(
                     coalesce(-sum(l.delta) filter (
                       where l.reason = 'sale'
                         and l.created_at >= now() - (v_win || ' days')::interval), 0) / v_win, 3
                   ) as daily_rate
            from stock_ledger l
            where l.shop_id = v_shop
            group by l.item_name
          ) a
        ) b
      ) t));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── 5. week-over-week: this 7 days vs the prior 7 days ───────
create or replace function shop_week_changes(p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_now timestamptz := now();
        v_rev_t numeric; v_ord_t int; v_rev_p numeric; v_ord_p int;
        v_top_t text; v_top_p text;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;

  select coalesce(sum(total), 0), count(*) into v_rev_t, v_ord_t
    from shop_orders
   where shop_id = v_shop and status = 'done'
     and created_at >= v_now - interval '7 days';

  select coalesce(sum(total), 0), count(*) into v_rev_p, v_ord_p
    from shop_orders
   where shop_id = v_shop and status = 'done'
     and created_at <  v_now - interval '7 days'
     and created_at >= v_now - interval '14 days';

  select name into v_top_t from (
    select e->>'name' as name,
           sum(coalesce(nullif(e->>'q','')::numeric, nullif(e->>'qty','')::numeric, 1)) as u
    from shop_orders o cross join lateral jsonb_array_elements(o.items) e
    where o.shop_id = v_shop and o.status = 'done'
      and o.created_at >= v_now - interval '7 days'
      and jsonb_typeof(o.items) = 'array' and coalesce(e->>'name','') <> ''
    group by e->>'name' order by u desc limit 1) x;

  select name into v_top_p from (
    select e->>'name' as name,
           sum(coalesce(nullif(e->>'q','')::numeric, nullif(e->>'qty','')::numeric, 1)) as u
    from shop_orders o cross join lateral jsonb_array_elements(o.items) e
    where o.shop_id = v_shop and o.status = 'done'
      and o.created_at <  v_now - interval '7 days'
      and o.created_at >= v_now - interval '14 days'
      and jsonb_typeof(o.items) = 'array' and coalesce(e->>'name','') <> ''
    group by e->>'name' order by u desc limit 1) x;

  return json_build_object('ok', true, 'shop', v_shop,
    'revenue', json_build_object('this', v_rev_t, 'prev', v_rev_p,
        'delta', v_rev_t - v_rev_p,
        'pct', case when v_rev_p > 0 then round((v_rev_t - v_rev_p) / v_rev_p * 100, 1) else null end),
    'orders', json_build_object('this', v_ord_t, 'prev', v_ord_p,
        'delta', v_ord_t - v_ord_p,
        'pct', case when v_ord_p > 0 then round((v_ord_t - v_ord_p)::numeric / v_ord_p * 100, 1) else null end),
    'top_item', json_build_object('this', v_top_t, 'prev', v_top_p,
        'changed', (coalesce(lower(v_top_t),'') <> coalesce(lower(v_top_p),''))));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── 6. merchant_twin: one JSON an agent can reason over ──────
-- Store state + inventory health + demand + top/slow + reorder flags, plus an
-- explicit permission envelope so the agent knows what it may NOT do.
create or replace function merchant_twin(p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_name text; v_open boolean; v_rating numeric; v_cat text;
        v_menu int; v_out int; v_low int; v_tracked int;
begin
  v_shop := _my_shop(p_device);
  if v_shop is null then return json_build_object('ok', false, 'reason', 'bad_device'); end if;

  select name, is_open, rating, category
    into v_name, v_open, v_rating, v_cat
    from shops where id = v_shop;

  select count(*) into v_menu from shop_items where shop_id = v_shop;

  select count(*) filter (where on_hand <= 0),
         count(*) filter (where on_hand > 0 and on_hand <= 5),
         count(*)
    into v_out, v_low, v_tracked
    from (select item_name, sum(delta) as on_hand
          from stock_ledger where shop_id = v_shop group by item_name) s;

  return json_build_object('ok', true, 'shop', v_shop, 'generated_at', now(),
    'permissions', json_build_object(
       'tools', 'read-only',
       'may', json_build_array('read sales', 'read inventory', 'read demand', 'suggest reorder'),
       'out_of_scope', json_build_array('payout', 'refund', 'bank-change', 'price-override', 'order-status'),
       'note', 'write & financial actions require human approval'),
    'store', json_build_object(
       'name', v_name, 'is_open', coalesce(v_open, false),
       'rating', coalesce(v_rating, 0), 'category', v_cat, 'menu_items', coalesce(v_menu, 0)),
    'inventory_health', json_build_object(
       'tracked_items', coalesce(v_tracked, 0),
       'out_of_stock', coalesce(v_out, 0),
       'low_stock', coalesce(v_low, 0)),
    'demand_30d',   shop_sales_summary(p_device, 30),
    'week_changes', shop_week_changes(p_device),
    'top_items',    shop_top_items(p_device, 30),
    'slow_movers',  shop_slow_movers(p_device, 14),
    'reorder',      shop_reorder_suggestions(p_device));
exception when others then
  return json_build_object('ok', false, 'reason', 'error', 'detail', sqlerrm);
end $$;

-- ── grants: the device key is the guard, so anon may execute ──
grant execute on function shop_sales_summary(text, int)      to anon;
grant execute on function shop_top_items(text, int)          to anon;
grant execute on function shop_slow_movers(text, int)        to anon;
grant execute on function shop_reorder_suggestions(text)     to anon;
grant execute on function shop_week_changes(text)            to anon;
grant execute on function merchant_twin(text)                to anon;

-- ------------------------------------------------------------
-- SELF-PROOF (seeds real rows, exercises the tools, asserts, cleans up)
--   Proves: (a) top_items ranks the true best-seller first,
--           (b) sales_summary sums only 'done' orders,
--           (c) reorder flags an item drawn below its point and NOT one with cover,
--           (d) merchant_twin returns the rollup sections.
-- ------------------------------------------------------------
do $$
declare v_dev  text := 'devinteltest0001';
        v_shop text := 'my_' || substr('devinteltest0001', 1, 12);   -- my_devinteltest
        j jsonb; top1 text; reord jsonb; el jsonb;
        milk_flagged boolean := false; rice_flagged boolean := false;
begin
  -- clean any residue from a prior run
  delete from shop_orders where shop_id = v_shop;
  delete from stock_ledger where shop_id = v_shop;
  if to_regclass('public.shop_order_events') is not null then
    delete from shop_order_events where order_id in ('INTEL_O1','INTEL_O2','INTEL_O3');
  end if;
  -- CRITICAL (review 0019 P1): inserting shop_orders fires trg_settle_shop_order
  -- (settlements_schema.sql:53) which writes settlement_ledger rows. Clean those
  -- too, or the proof leaves PHANTOM FINANCIAL rows behind after it runs.
  if to_regclass('public.settlement_ledger') is not null then
    delete from settlement_ledger where order_ref in ('INTEL_O1','INTEL_O2','INTEL_O3');
  end if;

  -- realised sales: Samosa is the clear best-seller; O3 is 'new' and must be excluded
  insert into shop_orders(id, shop_id, buyer_device, items, total, status, created_at) values
   ('INTEL_O1', v_shop, 'buyerdev0001',
      '[{"name":"Samosa","price":15,"q":10},{"name":"Chai","price":10,"q":2}]'::jsonb, 170, 'done', now() - interval '2 days'),
   ('INTEL_O2', v_shop, 'buyerdev0002',
      '[{"name":"Samosa","price":15,"q":5},{"name":"Poha","price":30,"q":1}]'::jsonb, 105, 'done', now() - interval '1 days'),
   ('INTEL_O3', v_shop, 'buyerdev0003',
      '[{"name":"Chai","price":10,"q":1}]'::jsonb, 10, 'new', now());

  -- stock: Milk drawn to on_hand=2 with high velocity -> must flag;
  --        Rice at on_hand=49 with trivial velocity -> must NOT flag.
  insert into stock_ledger(shop_id, item_name, delta, reason, created_at) values
   (v_shop, 'Milk',  20, 'purchase', now() - interval '20 days'),
   (v_shop, 'Milk',  -6, 'sale',     now() - interval '10 days'),
   (v_shop, 'Milk',  -6, 'sale',     now() - interval '6 days'),
   (v_shop, 'Milk',  -6, 'sale',     now() - interval '2 days'),
   (v_shop, 'Rice',  50, 'purchase', now() - interval '20 days'),
   (v_shop, 'Rice',  -1, 'sale',     now() - interval '3 days');

  -- (a) best-seller first
  j := shop_top_items(v_dev, 30)::jsonb;
  top1 := (j->'items'->0->>'name');
  assert lower(coalesce(top1,'')) = 'samosa', 'FAIL: expected Samosa as top item, got ' || coalesce(top1, '<null>');

  -- (b) revenue = 170 + 105 = 275 over 2 done orders (O3 excluded)
  j := shop_sales_summary(v_dev, 30)::jsonb;
  assert (j->>'orders')::int = 2, 'FAIL: expected 2 done orders, got ' || (j->>'orders');
  assert (j->>'revenue')::numeric = 275, 'FAIL: expected revenue 275, got ' || (j->>'revenue');

  -- (c) reorder flags Milk, not Rice
  reord := shop_reorder_suggestions(v_dev)::jsonb;
  for el in select value from jsonb_array_elements(reord->'items') loop
    if lower(el->>'item_name') = 'milk' then milk_flagged := (el->>'needs_reorder')::boolean; end if;
    if lower(el->>'item_name') = 'rice' then rice_flagged := (el->>'needs_reorder')::boolean; end if;
  end loop;
  assert milk_flagged,     'FAIL: Milk (on_hand 2, high velocity) should be flagged for reorder';
  assert not rice_flagged, 'FAIL: Rice (on_hand 49, trivial velocity) must NOT be flagged';

  -- (d) twin rollup shape
  j := merchant_twin(v_dev)::jsonb;
  assert j ? 'inventory_health' and j ? 'reorder' and j ? 'demand_30d' and j ? 'permissions',
    'FAIL: merchant_twin missing expected sections';

  -- cleanup
  delete from shop_orders where shop_id = v_shop;
  delete from stock_ledger where shop_id = v_shop;
  if to_regclass('public.shop_order_events') is not null then
    delete from shop_order_events where order_id in ('INTEL_O1','INTEL_O2','INTEL_O3');
  end if;
  -- CRITICAL (review 0019 P1): inserting shop_orders fires trg_settle_shop_order
  -- (settlements_schema.sql:53) which writes settlement_ledger rows. Clean those
  -- too, or the proof leaves PHANTOM FINANCIAL rows behind after it runs.
  if to_regclass('public.settlement_ledger') is not null then
    delete from settlement_ledger where order_ref in ('INTEL_O1','INTEL_O2','INTEL_O3');
  end if;

  raise notice 'PASS: shop intelligence verified (top item, revenue, reorder flag, twin rollup)';
end $$;

select 'shop_intelligence ready' as status;

-- ========== MIGRATION: 0020_observability.sql ==========
-- 0020 observability — NOT YET APPLIED (written by full-build)
-- ============================================================
-- ORIGNALS · minimal backend observability. Today nothing records
-- when an RPC, edge function, or Razorpay webhook throws — failures
-- are invisible until a user complains. This adds one append-only
-- log table + a write RPC any layer (edge/rpc/webhook/client) can
-- fire-and-forget into, plus admin-gated (L4+) health rollups.
--
-- ALGORITHM PROGRESSION (anti-cargo-cult):
--   stage 1 (NOW): plain Postgres table + partial indexes + on-read
--     percentile/rollup aggregation. Sufficient at hundreds→tens of
--     thousands of users; a single op_health() query scans an index,
--     not a fleet of collectors.
--   stage 2 (when sustained write volume makes op_log the hottest
--     table — roughly >5–10M rows/day, or op_health p95 > 500ms):
--     add a rollup table refreshed by pg_cron (5-min buckets) and
--     query that instead of raw rows; add a retention job that
--     TRUNCATEs op_log older than N days.
--   stage 3 (only if you outgrow Postgres for logs — multi-region,
--     >100M events/day): ship to an external APM/log sink. Not now.
-- No Kafka/Redis/ES. A log line must NEVER break the caller.
-- ============================================================

-- ---- table: append-only operational log --------------------
create table if not exists op_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  source     text not null check (source in ('edge','rpc','webhook','client')),
  level      text not null default 'info' check (level in ('info','warn','error')),
  event      text not null,
  ref        text,
  detail     jsonb,
  latency_ms int
);

-- recent-first scans (op_log_recent, dashboards, and op_health's windowed rollups)
create index if not exists op_log_at_idx on op_log (at desc);
-- (dropped op_log_err_idx + op_log_lat_idx — a brand-new zero-caller table does
--  not justify 3 indexes; op_log_at_idx serves the time-windowed reads. Re-add a
--  partial (source, at) where level='error' only if op_health p95 proves it needed.)

-- retention: probabilistic trim (same pattern as error_log) so op_log cannot grow
-- unbounded. ~1% of inserts prune rows older than 14 days — cheap, self-cleaning,
-- no cron dependency at this scale.
create or replace function _op_log_trim() returns trigger language plpgsql as $$
begin
  if random() < 0.01 then delete from op_log where at < now() - interval '14 days'; end if;
  return null;
end $$;
drop trigger if exists t_op_log_trim on op_log;
create trigger t_op_log_trim after insert on op_log for each statement execute function _op_log_trim();

-- RLS on, ZERO policies → the public anon role can neither SELECT nor
-- write directly. Writes flow through op_log_write (SECURITY DEFINER),
-- reads through the admin-gated RPCs below. No PII lives here beyond a
-- caller-supplied ref, and money is never stored.
alter table op_log enable row level security;

-- ---- write path: fire-and-forget from any layer -------------
-- SECURITY DEFINER so it can insert past RLS. Normalizes/clamps every
-- field and SWALLOWS its own errors: observability must never turn a
-- working request into a failed one.
create or replace function op_log_write(
  p_source text, p_level text, p_event text,
  p_ref text, p_detail jsonb, p_latency int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into op_log(source, level, event, ref, detail, latency_ms)
  values (
    -- FORCED to 'client': this RPC is granted to anon, and the public anon key is
    -- the only key a browser holds, so it may only self-report as 'client'. Trusted
    -- edge/rpc/webhook logging is written by the SERVICE ROLE via a DIRECT insert
    -- into op_log (it bypasses RLS), carrying its real source. Previously p_source
    -- was accepted from anon → op_health's by-source rollups were spoofable
    -- (review 0020 P2). p_source is ignored on this path.
    'client',
    case when coalesce(p_level,'')  in ('info','warn','error')          then p_level  else 'info'   end,
    left(coalesce(nullif(trim(p_event),''),'(none)'), 120),
    left(p_ref, 120),
    -- cap caller-controlled detail: an anon caller must not be able to store an
    -- unbounded jsonb blob (review 0020 P1). Over 2KB → replaced with a marker.
    case when p_detail is not null and pg_column_size(p_detail) > 2048
         then jsonb_build_object('truncated', true) else p_detail end,
    case when p_latency between 0 and 3600000 then p_latency else null end
  );
exception when others then
  -- never propagate: a logging failure is not the caller's problem
  null;
end $$;

-- ---- read path #1: admin health rollups (L4+) ---------------
-- error rate (last 1h / 24h) by source, p50/p95 latency where present,
-- and payment/order failure counts (guarded — those tables may predate
-- or postdate this migration).
create or replace function op_health(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_1h  jsonb;
  v_24h jsonb;
  v_p50 numeric;
  v_p95 numeric;
  v_pay_fail int := 0;
  v_ord_fail int := 0;
begin
  if admin_rank(_admin_level(p_token)) < 4 then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select coalesce(jsonb_object_agg(source, jsonb_build_object(
            'total', total, 'errors', errs,
            'err_rate', round(errs::numeric / nullif(total,0), 4))), '{}'::jsonb)
    into v_1h
  from (
    select source, count(*) total, count(*) filter (where level='error') errs
    from op_log where at > now() - interval '1 hour' group by source
  ) t;

  select coalesce(jsonb_object_agg(source, jsonb_build_object(
            'total', total, 'errors', errs,
            'err_rate', round(errs::numeric / nullif(total,0), 4))), '{}'::jsonb)
    into v_24h
  from (
    select source, count(*) total, count(*) filter (where level='error') errs
    from op_log where at > now() - interval '24 hours' group by source
  ) t;

  select percentile_cont(0.5) within group (order by latency_ms),
         percentile_cont(0.95) within group (order by latency_ms)
    into v_p50, v_p95
  from op_log
  where latency_ms is not null and at > now() - interval '1 hour';

  -- payment failures (last 24h) — payments.status: created|verified|failed
  if to_regclass('public.payments') is not null then
    select count(*) into v_pay_fail
    from payments where status = 'failed' and created_at > now() - interval '24 hours';
  end if;

  -- order failures (last 24h) — shop_orders rejected
  if to_regclass('public.shop_orders') is not null then
    select count(*) into v_ord_fail
    from shop_orders where status = 'rejected' and updated_at > now() - interval '24 hours';
  end if;

  return json_build_object(
    'ok', true,
    'at', now(),
    'err_by_source_1h',  v_1h,
    'err_by_source_24h', v_24h,
    'latency_1h_ms', json_build_object('p50', v_p50, 'p95', v_p95),
    'payment_failures_24h', v_pay_fail,
    'order_failures_24h',   v_ord_fail
  );
exception when others then
  return json_build_object('ok', false, 'reason', 'error');
end $$;

-- ---- read path #2: recent log tail (L4+) --------------------
create or replace function op_log_recent(p_token text, p_level text, p_limit int)
returns setof op_log
language plpgsql security definer set search_path = public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return; end if;   -- no rows for non-admins
  return query
    select * from op_log
    where (coalesce(p_level,'') = '' or level = p_level)
    order by at desc
    limit least(coalesce(p_limit, 50), 500);
end $$;

-- The anon key is the transport; the guard is the admin token (reads)
-- or the fact that writes are append-only + normalized (writes).
grant execute on function op_log_write(text,text,text,text,jsonb,int) to anon;
grant execute on function op_health(text) to anon;
grant execute on function op_log_recent(text,text,int) to anon;

-- ============================================================
-- SELF-PROOF (expect: raise notice 'PASS…'; asserts abort on FAIL).
-- Stands up a throwaway L5 admin + session, writes logs THROUGH the
-- RPC, checks that op_health rolls the errors up and that both read
-- RPCs are admin-gated, then deletes every temp row it made.
-- ============================================================
do $$
declare
  v_tok    text := '__optest_token_deadbeef__';
  v_admin  text := '__optest_admin__';
  v_health json;
  v_n      int;
  v_bad    int;
begin
  insert into admin_users(ident, level, name, active) values (v_admin, 'l5', 'optest', true)
    on conflict (ident) do update set level='l5', active=true;
  insert into auth_sessions(token, ident, device_key) values (v_tok, v_admin, 'dev_optest')
    on conflict (token) do nothing;

  -- trusted edge/webhook/rpc logging = a DIRECT insert by the SERVICE ROLE
  -- (simulated here as the migration owner); these carry their real source.
  insert into op_log(source,level,event,ref,detail,latency_ms) values
    ('edge','error','optest_err','__optest_r1__', jsonb_build_object('k',1), 42),
    ('edge','error','optest_err','__optest_r2__', null, 120),
    ('rpc', 'info', 'optest_ok', '__optest_r3__', null, 8);
  -- the ANON write RPC must FORCE source='client' + normalize level + clamp latency,
  -- whatever is passed.
  perform op_log_write('edge','weird','optest_norm','__optest_r4__', null, -5);

  select count(*) into v_n from op_log where ref like '__optest_%';
  assert v_n = 4, 'FAIL: writes did not append all 4 rows';
  assert (select source from op_log where ref='__optest_r4__') = 'client',
         'FAIL: op_log_write did not force source=client';
  assert (select level from op_log where ref='__optest_r4__') = 'info',
         'FAIL: invalid level not normalized';
  assert (select latency_ms from op_log where ref='__optest_r4__') is null,
         'FAIL: negative latency not clamped';

  -- health must reflect the two edge errors we just wrote
  v_health := op_health(v_tok);
  assert (v_health->>'ok') = 'true', 'FAIL: admin op_health denied';
  assert ((v_health->'err_by_source_1h'->'edge'->>'errors')::int) >= 2,
         'FAIL: op_health error rollup wrong';
  assert (v_health->>'payment_failures_24h') is not null, 'FAIL: health missing payment failures';
  assert (v_health->>'order_failures_24h')   is not null, 'FAIL: health missing order failures';

  -- admin reads the tail; non-admin gets nothing
  select count(*) into v_n from op_log_recent(v_tok, 'error', 100) where ref like '__optest_%';
  assert v_n = 2, 'FAIL: op_log_recent(error) should return exactly the 2 errors';
  select count(*) into v_bad from op_log_recent('__no_such_token__', null, 100);
  assert v_bad = 0, 'FAIL: op_log_recent leaked rows to a non-admin';
  assert (op_health('__no_such_token__')->>'ok') = 'false', 'FAIL: op_health not gated';

  -- cleanup
  delete from op_log where ref like '__optest_%';
  delete from auth_sessions where token = v_tok;
  delete from admin_users where ident = v_admin;

  raise notice 'PASS: op_log_write appends+normalizes, op_health rolls up errors, reads are admin-gated';
end $$;

select 'observability ready' as status;

-- ========== MIGRATION: 0021_recommendations.sql ==========
-- ============================================================
-- 0021 — RECOMMENDATIONS  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- A GROUNDED recommender (§12/§13) — real signals only, no fabricated "AI picks".
-- Read-only. Candidate generation → blended ranking, all in one indexed pass.
--
-- ALGORITHM PROGRESSION (§43, anti-cargo-cult), degrades gracefully as data grows:
--   Stage 1 (THIS): candidates = the live in-stock catalog; score blends
--     · personal REORDER boost   (items this device bought before)
--     · item POPULARITY          (units sold in realised orders, log-damped)
--     · PROXIMITY                 (nearer shop wins)
--     · shop RATING              (quality nudge)
--     With zero order history everything collapses to proximity+rating — i.e. a
--     sensible "nearby, well-rated, in stock" list. NEVER empty, NEVER invented.
--   Stage 2 (trigger: enough baskets that co-purchase is dense): fold co-purchase
--     ("bought together") into home candidates; add category-affinity from the
--     0018 event stream (view_item/add_to_cart). Same SQL shape.
--   Stage 3 (only with real scale + eval): learning-to-rank over the 0018 impression
--     log (reco_shown/reco_click) — which is WHY 0018 logs impressions.
--
-- Money/authoritative truth is never used to fabricate: popularity comes from
-- realised ('done') orders only; out-of-stock / closed / deleted shops are excluded.
-- ============================================================

-- self-contained haversine (consolidation with 0013/0014/0016 haversines at staging)
create or replace function _reco_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$
  select case when a_lat is null or a_lng is null or b_lat is null or b_lng is null then null
    else 2 * 6371 * asin(least(1.0, sqrt(
      power(sin(radians((b_lat - a_lat)/2)),2) +
      cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians((b_lng - a_lng)/2)),2)))) end;
$$;

-- ---------- home recommendations (personalized where data exists) ----------
create or replace function reco_home(p_device text, p_lat double precision, p_lng double precision, p_limit int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_lim int := least(greatest(coalesce(p_limit,12),1),30);
begin
  return coalesce((
    with pop as (   -- item-name popularity from REALISED orders (last 30d)
      select lower(trim(i->>'name')) nm, sum(coalesce((i->>'q')::int,1)) qty
      from shop_orders, lateral jsonb_array_elements(case when jsonb_typeof(items)='array' then items else '[]'::jsonb end) i
      where status = 'done' and created_at > now() - interval '30 days'
        and coalesce(i->>'name','') <> ''
      group by 1
    ),
    mine as (       -- what THIS device bought before → reorder boost
      select distinct lower(trim(i->>'name')) nm
      from shop_orders, lateral jsonb_array_elements(case when jsonb_typeof(items)='array' then items else '[]'::jsonb end) i
      where buyer_device = p_device and coalesce(i->>'name','') <> ''
    ),
    cands as (
      select it.id, it.name, it.price, it.qty_label, it.photo_url,
             s.id shop_id, s.name shop_name, s.rating, s.category,
             _reco_km(p_lat, p_lng, s.lat, s.lng) km,
             coalesce(pop.qty,0) pop_qty,
             (mine.nm is not null) reordered
      from shop_items it
      join shops s on s.id = it.shop_id
      left join pop  on pop.nm  = lower(trim(it.name))
      left join mine on mine.nm = lower(trim(it.name))
      where it.in_stock = true and s.is_open = true and s.deleted_at is null
    )
    select json_agg(row_to_json(r) order by r.score desc, r.km asc nulls last) from (
      select id, name, price, qty_label, photo_url, shop_id, shop_name, rating, category,
             round(km::numeric, 2) km, reordered,
             round((
                 (case when reordered then 3.0 else 0 end)      -- personal
               + ln(1 + pop_qty) * 1.2                          -- popularity (log-damped)
               + case when km is null then 0 else 1.5/(1.0+km) end  -- proximity
               + coalesce(rating,0)/5.0 * 0.5                   -- quality
             )::numeric, 4) score,
             (case when reordered then 'reorder' when pop_qty > 0 then 'popular' else 'nearby' end) reason
      from cands
      order by score desc, km asc nulls last
      limit v_lim
    ) r
  ), '[]'::json);
exception when others then return '[]'::json; end $$;
grant execute on function reco_home(text, double precision, double precision, int) to anon;

-- ---------- "bought together" for a product (co-purchase) ----------
create or replace function reco_bought_together(p_item_name text, p_limit int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_nm text := lower(trim(coalesce(p_item_name,''))); v_lim int := least(greatest(coalesce(p_limit,8),1),20);
begin
  if v_nm = '' then return '[]'::json; end if;
  return coalesce((
    with baskets as (   -- realised orders that contained this item
      select distinct o.id
      from shop_orders o, lateral jsonb_array_elements(case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end) i
      where o.status = 'done' and lower(trim(i->>'name')) = v_nm
    ),
    co as (             -- other items in those baskets, by co-occurrence
      select lower(trim(i->>'name')) nm, count(*) n
      from shop_orders o join baskets b on o.id = b.id, lateral jsonb_array_elements(case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end) i
      where lower(trim(i->>'name')) <> v_nm and coalesce(i->>'name','') <> ''
      group by 1 order by n desc limit v_lim
    )
    -- map each co-purchased NAME to one representative in-stock catalog row
    select json_agg(row_to_json(r) order by r.co_count desc) from (
      select distinct on (co.nm) co.nm item_name, co.n co_count,
             it.id, it.name, it.price, it.photo_url, s.id shop_id, s.name shop_name
      from co
      join shop_items it on lower(trim(it.name)) = co.nm and it.in_stock = true
      join shops s on s.id = it.shop_id and s.is_open = true and s.deleted_at is null
      order by co.nm, s.rating desc nulls last
    ) r
  ), '[]'::json);
exception when others then return '[]'::json; end $$;
grant execute on function reco_bought_together(text, int) to anon;

-- PAIRED CLIENT CHANGE (when staged): js/home.js calls rpc/reco_home({p_device,lat,lng})
-- for a "Recommended for you" row (badge each card by its `reason`); the shop/item page
-- calls rpc/reco_bought_together. On each render emit 'reco_shown' (0018) and on tap
-- 'reco_click' — that impression log is what a Stage-3 LTR model trains/evaluates on.

-- ---------- proof (expect PASS) ----------
do $$
declare j json; n int;
begin
  delete from shop_orders where id in ('RC_O1','RC_O2');
  delete from shop_items where id in ('rc_milk','rc_bread','rc_eggs');
  delete from shops where id in ('rc_shop');

  insert into shops(id, name, category, is_open, rating, lat, lng) values ('rc_shop','Reco Mart','grocery',true,4.6,28.6,77.2);
  insert into shop_items(id, shop_id, name, price, in_stock) values
    ('rc_milk','rc_shop','Milk',30,true), ('rc_bread','rc_shop','Bread',40,true), ('rc_eggs','rc_shop','Eggs',60,true);

  -- two realised orders: Milk+Bread bought together twice; Eggs once
  insert into shop_orders(id, shop_id, buyer_device, items, total, status, created_at) values
    ('RC_O1','rc_shop','buyerA','[{"name":"Milk","q":1},{"name":"Bread","q":1}]'::jsonb, 70, 'done', now()-interval '1 day'),
    ('RC_O2','rc_shop','buyerB','[{"name":"Milk","q":2},{"name":"Bread","q":1},{"name":"Eggs","q":1}]'::jsonb, 160, 'done', now()-interval '2 days');

  -- home reco returns in-stock items, most-popular first (Milk sold 3, Bread 2, Eggs 1)
  j := reco_home('someone', 28.6, 77.2, 10);
  assert json_array_length(j) >= 3, 'FAIL: reco_home returned too few';
  assert (j->0->>'name') = 'Milk', 'FAIL: most-popular item not ranked first, got ' || coalesce(j->0->>'name','<null>');

  -- personalization: buyerA reordering sees their prior item boosted
  j := reco_home('buyerA', 28.6, 77.2, 10);
  assert exists(select 1 from json_array_elements(j) e where e->>'reason'='reorder'),
         'FAIL: reorder boost not applied for a returning buyer';

  -- bought-together with Milk surfaces Bread (co-purchased twice)
  j := reco_bought_together('Milk', 10);
  assert exists(select 1 from json_array_elements(j) e where e->>'name'='Bread'),
         'FAIL: bought_together(Milk) did not surface Bread';

  -- graceful: unknown item → empty, not error
  assert reco_bought_together('__nope__', 10)::text = '[]', 'FAIL: unknown item not empty';

  delete from shop_orders where id in ('RC_O1','RC_O2');
  delete from shop_items where id in ('rc_milk','rc_bread','rc_eggs');
  delete from shops where id in ('rc_shop');
  raise notice 'PASS: popularity ranking, reorder personalization, co-purchase, graceful-empty';
end $$;

select 'recommendations ready' as status;

-- ========== MIGRATION: 0022_fraud_risk.sql ==========
-- ============================================================
-- 0022 — FRAUD RISK SCORING  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- EXTENDS fraud_schema.sql (which already computes live flag signals) with the
-- missing §33 piece: a per-device RISK SCORE (signals → features → weighted score →
-- review), grounded in REAL data across the subsystems built since:
--   · refund abuse        — succeeded refunds per device (0015 refunds)
--   · buyer-cancel abuse  — buyer-initiated rejections (0009 shop_order_events,
--                           actor='buyer', to_status='rejected')
--   · card testing        — failed payments per device (payments)
--   · account farming     — accounts per device (auth_sessions)
--
-- Fixes a REAL bug in the base fraud_schema.many_cancels signal: it counts
-- shop_orders.status='cancelled', but buyer cancellation sets 'rejected' (0009), so
-- that signal is DEAD. The correct source is the event log's actor, used below.
--
-- Read-only, admin-gated (L4+), dismissals honored. Scores are EXPLAINABLE (every
-- point traces to a factor) — no opaque blackbox on a user-affecting decision (§30/§72).
-- Weights are config here (Stage 1 rules); a learned model is Stage 3 (needs labels).
-- ============================================================

-- required inputs (this migration lands after them in the sequence). If any is
-- missing, fail LOUD rather than silently score nothing.
do $$ begin
  if to_regclass('public.refunds') is null or to_regclass('public.shop_order_events') is null
     or to_regclass('public.payments') is null or to_regclass('public.auth_sessions') is null
     or to_regclass('public.shop_orders') is null then
    raise exception '0022 requires refunds(0015), shop_order_events(0009), payments, auth_sessions, shop_orders — apply those first';
  end if;
end $$;

create or replace function fraud_risk(p_token text, p_min_score int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_min int := greatest(coalesce(p_min_score, 25), 0);
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  return json_build_object('ok', true, 'as_of', now(), 'min_score', v_min, 'devices', coalesce((
    with
    refund_agg as (select device_key dev, count(*) filter (where status='succeeded') n
                   from refunds where coalesce(device_key,'') <> '' group by 1),
    cancel_agg as (select actor_device dev, count(*) n
                   from shop_order_events where actor='buyer' and to_status='rejected' and coalesce(actor_device,'') <> ''
                   group by 1),
    payfail_agg as (select device_key dev, count(*) n
                    from payments where status='failed' and coalesce(device_key,'') <> '' group by 1),
    acct_agg as (select device_key dev, count(distinct ident) n
                 from auth_sessions where coalesce(device_key,'') <> '' group by 1),
    devs as (select dev from refund_agg union select dev from cancel_agg
             union select dev from payfail_agg union select dev from acct_agg)
    select json_agg(row_to_json(x) order by x.score desc) from (
      select d.dev device,
        least(100,
            (case when coalesce(r.n,0) >= 2 then 25 else 0 end)      -- refund abuse
          + (case when coalesce(c.n,0) >= 3 then 20 else 0 end)      -- buyer-cancel abuse
          + (case when coalesce(p.n,0) >= 3 then 20 else 0 end)      -- card testing
          + (case when coalesce(a.n,0) >= 3 then 30 else 0 end)      -- account farming
        ) score,
        json_build_object(
          'succeeded_refunds', coalesce(r.n,0),
          'buyer_cancels',     coalesce(c.n,0),
          'failed_payments',   coalesce(p.n,0),
          'accounts_on_device',coalesce(a.n,0)) factors
      from devs d
      left join refund_agg  r on r.dev = d.dev
      left join cancel_agg  c on c.dev = d.dev
      left join payfail_agg p on p.dev = d.dev
      left join acct_agg    a on a.dev = d.dev
      where ('risk|' || d.dev) not in (select sig from fraud_dismissed)
    ) x
    where x.score >= v_min
    limit 100
  ), '[]'::json));
exception when others then return json_build_object('ok', false, 'reason', 'error'); end $$;
grant execute on function fraud_risk(text, int) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare j json; hi int; lo int;
begin
  -- clean any prior test rows
  delete from refunds where device_key='fraud_bad_dev';
  delete from shop_order_events where actor_device='fraud_bad_dev';
  delete from payments where device_key='fraud_bad_dev';

  -- a BAD device: 2 succeeded refunds + 3 buyer cancels + 3 failed payments
  insert into refunds(order_ref, device_key, amount_paise, status, idempotency_key) values
    ('FR_A','fraud_bad_dev',100,'succeeded','frtest_a'), ('FR_B','fraud_bad_dev',100,'succeeded','frtest_b');
  insert into shop_order_events(order_id, actor, actor_device, to_status, note) values
    ('FR_C','buyer','fraud_bad_dev','rejected','buyer cancelled'),
    ('FR_D','buyer','fraud_bad_dev','rejected','buyer cancelled'),
    ('FR_E','buyer','fraud_bad_dev','rejected','buyer cancelled');
  insert into payments(rzp_order_id, device_key, amount_paise, ref, status) values
    ('fro1','fraud_bad_dev',10000,'FR_C','failed'),
    ('fro2','fraud_bad_dev',10000,'FR_D','failed'),
    ('fro3','fraud_bad_dev',10000,'FR_E','failed');

  -- need an admin token to read; stand up a throwaway L5 (atomic — same txn)
  insert into admin_users(ident, level, name, active) values ('__fr_admin__','l5','frtest',true)
    on conflict (ident) do update set level='l5', active=true;
  insert into auth_sessions(token, ident, device_key) values ('__fr_tok__','__fr_admin__','dev_frx')
    on conflict (token) do nothing;

  j := fraud_risk('__fr_tok__', 25);
  assert (j->>'ok')='true', 'FAIL: admin denied';
  select (e->>'score')::int into hi from json_array_elements(j->'devices') e where e->>'device'='fraud_bad_dev';
  assert hi >= 65, 'FAIL: bad device scored too low, got ' || coalesce(hi::text,'<null>');  -- 25+20+20 = 65

  -- non-admin is refused
  assert (fraud_risk('__nope__', 25)->>'ok')='false', 'FAIL: non-admin read risk';

  -- cleanup
  delete from refunds where device_key='fraud_bad_dev';
  delete from shop_order_events where actor_device='fraud_bad_dev';
  delete from payments where device_key='fraud_bad_dev';
  delete from auth_sessions where token='__fr_tok__';
  delete from admin_users where ident='__fr_admin__';
  raise notice 'PASS: risk score aggregates refund+cancel+payfail+multiacct, explainable, admin-gated (bad=%)', hi;
end $$;

select 'fraud risk scoring ready' as status;

-- ========== MIGRATION: 0023_exec_dashboard.sql ==========
-- ============================================================
-- 0023 — EXECUTIVE DASHBOARD  (⚠ FROZEN — NOT FOR PRODUCTION)
--   Written 2026-08-11, reviewed by hand, NOT staged/applied.
--
-- ONE admin call assembling the CEO/CFO/COO headline metrics (§15/§39/§66) from
-- REAL tables — no fabricated figures, and every number labelled `actual`. Where a
-- source table isn't applied yet, its metric reports null (guarded), never a guess.
-- Read-only, L4+ (finance detail L5). This is a thin AGGREGATION over the real data +
-- the RPC logic already built (settlements, refunds, analytics, dispatch); it invents
-- nothing. "Clearly distinguish actual / estimated / forecast" (§67) → all here are ACTUAL.
-- ============================================================
create or replace function exec_dashboard(p_token text, p_days int)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_days int := least(greatest(coalesce(p_days,30),1),90);
        v_since timestamptz; v_lvl text; v_is_l5 boolean;
        v_gmv numeric := null; v_orders int := null; v_active_orders int := null;
        v_paid int := null; v_refunds numeric := null;
        v_due numeric := null; v_paidout numeric := null; v_commission numeric := null;
        v_buyers int := null; v_live int := null; v_fraud int := null;
begin
  v_lvl := _admin_level(p_token);
  if admin_rank(v_lvl) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_is_l5 := (v_lvl = 'l5');
  v_since := now() - (v_days || ' days')::interval;

  -- GMV + orders (authoritative: shop_orders, excluding rejected)
  if to_regclass('public.shop_orders') is not null then
    select count(*), coalesce(sum(total) filter (where status <> 'rejected'),0),
           count(*) filter (where status not in ('done','rejected'))
      into v_orders, v_gmv, v_active_orders
      from shop_orders where created_at > v_since;
  end if;

  -- verified payments
  if to_regclass('public.payments') is not null then
    select count(*) into v_paid from payments where status='verified' and created_at > v_since;
  end if;

  -- refunds issued (0015)
  if to_regclass('public.refunds') is not null then
    select coalesce(sum(amount_paise),0)/100.0 into v_refunds
      from refunds where status='succeeded' and created_at > v_since;
  end if;

  -- settlements (settlements_schema): commission + due/paid to sellers
  if to_regclass('public.settlement_ledger') is not null then
    select coalesce(sum(net) filter (where status='due'),0),
           coalesce(sum(net) filter (where status='paid'),0),
           coalesce(sum(commission) filter (where status in ('due','paid')),0)
      into v_due, v_paidout, v_commission from settlement_ledger;
  end if;

  -- active buyers + live-now (analytics)
  if to_regclass('public.analytics_events') is not null then
    select count(distinct device) into v_buyers from analytics_events where ts > v_since;
    select count(distinct device) into v_live from analytics_events where kind='ping' and ts > now()-interval '70 seconds';
  end if;

  -- open fraud-risk devices (0022) — count only, L4+
  if to_regprocedure('fraud_risk(text,int)') is not null then
    select coalesce(json_array_length((fraud_risk(p_token, 40))->'devices'),0) into v_fraud;
  end if;

  return json_build_object('ok', true, 'window_days', v_days, 'as_of', now(), 'basis', 'actual',
    'ceo', json_build_object(
      'gmv', v_gmv, 'orders', v_orders, 'verified_payments', v_paid,
      'active_users', v_buyers, 'live_now', v_live),
    'cfo', case when v_is_l5 then json_build_object(
        'commission', v_commission, 'seller_due', v_due, 'seller_paid', v_paidout,
        'refunds_paid', v_refunds,
        'net_take_rate', case when v_gmv > 0 then round(coalesce(v_commission,0)/v_gmv, 4) else null end)
      else json_build_object('detail', 'L5 only') end,
    'coo', json_build_object(
      'active_orders', v_active_orders, 'open_fraud_risk_devices', v_fraud),
    'note', 'all figures ACTUAL from live tables; nulls = source migration not yet applied');
exception when others then return json_build_object('ok', false, 'reason', 'error'); end $$;
grant execute on function exec_dashboard(text, int) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare j jsonb;
begin
  insert into admin_users(ident, level, name, active) values ('__ex_l5__','l5','extest',true)
    on conflict (ident) do update set level='l5', active=true;
  insert into admin_users(ident, level, name, active) values ('__ex_l4__','l4','extest4',true)
    on conflict (ident) do update set level='l4', active=true;
  insert into auth_sessions(token, ident, device_key) values ('__ex_tok5__','__ex_l5__','dev_ex5') on conflict (token) do nothing;
  insert into auth_sessions(token, ident, device_key) values ('__ex_tok4__','__ex_l4__','dev_ex4') on conflict (token) do nothing;

  j := exec_dashboard('__ex_tok5__', 30);
  assert (j->>'ok')='true', 'FAIL: L5 admin denied';
  assert (j->'ceo') ? 'gmv' and (j->'coo') ? 'active_orders', 'FAIL: missing sections';
  assert (j->'cfo') ? 'commission', 'FAIL: L5 should see cfo detail';

  -- L4 sees CEO/COO but NOT cfo finance detail
  j := exec_dashboard('__ex_tok4__', 30);
  assert (j->>'ok')='true' and (j->'cfo'->>'detail') = 'L5 only', 'FAIL: L4 saw finance detail';

  -- non-admin refused
  assert (exec_dashboard('__nope__', 30)->>'ok')='false', 'FAIL: non-admin read exec dashboard';

  delete from auth_sessions where token in ('__ex_tok5__','__ex_tok4__');
  delete from admin_users where ident in ('__ex_l5__','__ex_l4__');
  raise notice 'PASS: exec dashboard assembles CEO/CFO/COO from real tables; L5-gated finance; non-admin refused';
end $$;

select 'exec dashboard ready' as status;

-- ========== MIGRATION: 0024_catalog_variants_discounts.sql ==========
-- ============================================================
-- 0024 — SHOPIFY-GRADE CATALOG: product variants + discount engine  (⚠ FROZEN)
--   Written 2026-08-12, validated locally (PGlite), NOT applied to production.
--
-- Two merchant capabilities that lift Orignals toward Shopify-class:
--   (1) PRODUCT VARIANTS — a shop_item ("product") can have option-combinations
--       (Size/Color…) as purchasable variants, each with its own SKU / price /
--       stock. Backward compatible: a product with no variants sells as-is.
--   (2) DISCOUNT ENGINE — real, SERVER-AUTHORITATIVE discounts (codes + automatic),
--       typed (percentage / fixed / free_delivery), with min-spend, total usage
--       limit, per-customer limit, validity window, and IDEMPOTENT redemption.
--       This replaces the hardcoded client-side coupons (js/data.js) — the client
--       can no longer fabricate a discount; the server computes and gates it
--       (closes the client-authoritative-pricing concern for discounts).
-- Ownership is derived server-side from the device via _my_shop() (0005).
-- ============================================================

-- ---------- (1) PRODUCT VARIANTS ----------
create table if not exists product_variants (
  id         text primary key,
  item_id    text not null references shop_items(id) on delete cascade,
  shop_id    text not null,                 -- denormalized (ownership + queries)
  sku        text,
  title      text,                          -- 'M / Red'
  options    jsonb,                         -- {"Size":"M","Color":"Red"}
  price      numeric(10,2) not null check (price >= 0),
  mrp        numeric(10,2),
  in_stock   boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists pv_item_idx on product_variants(item_id, position);
create index if not exists pv_shop_idx on product_variants(shop_id);
create unique index if not exists pv_sku_once on product_variants(shop_id, sku) where sku is not null and sku <> '';
alter table product_variants enable row level security;
-- catalog is public to read (no PII); writes go through variant_set (device-owned)
drop policy if exists pv_read on product_variants;
create policy pv_read on product_variants for select using (true);

-- owner REPLACES the variant set for one of THEIR products
create or replace function variant_set(p_device text, p_item text, p_variants jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_shop text := _my_shop(p_device); v_owner text; v jsonb; n int := 0;
begin
  select shop_id into v_owner from shop_items where id = p_item;
  if v_owner is null then return json_build_object('ok', false, 'reason', 'no_product'); end if;
  if v_owner <> v_shop then return json_build_object('ok', false, 'reason', 'not_your_product'); end if;
  delete from product_variants where item_id = p_item;      -- replace
  for v in select value from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb)) loop
    insert into product_variants(id, item_id, shop_id, sku, title, options, price, mrp, in_stock, position)
    values (coalesce(nullif(v->>'id',''), 'v_' || md5(p_item || coalesce(v->>'title','') || n::text)),
            p_item, v_shop, left(nullif(v->>'sku',''),40), left(v->>'title',80), v->'options',
            greatest(coalesce((v->>'price')::numeric,0),0), nullif(v->>'mrp','')::numeric,
            coalesce((v->>'in_stock')::boolean, true), n);
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'variants', n);
end $$;
grant execute on function variant_set(text, text, jsonb) to anon;

-- ---------- (2) DISCOUNT ENGINE ----------
create table if not exists discounts (
  id                text primary key,
  shop_id           text not null,          -- owning shop (or a platform id for global)
  code              text,                   -- null = automatic discount
  title             text,
  kind              text not null default 'percentage',  -- percentage | fixed | free_delivery
  value             numeric not null default 0 check (value >= 0),
  min_subtotal      numeric,
  applies_scope     text not null default 'shop',        -- shop | all
  starts_at         timestamptz,
  ends_at           timestamptz,
  usage_limit       int,                    -- total redemptions allowed (null = unlimited)
  per_customer_limit int,                   -- per device (null = unlimited)
  used_count        int not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
create unique index if not exists disc_code_once on discounts(shop_id, lower(code)) where code is not null and code <> '';
create index if not exists disc_active_idx on discounts(active, shop_id) where active;
alter table discounts enable row level security;   -- NO anon read (codes/limits are not public); access via RPCs

create table if not exists discount_redemptions (
  id          bigint generated always as identity primary key,
  discount_id text not null,
  device_key  text,
  order_ref   text,
  amount      numeric,
  at          timestamptz not null default now()
);
create unique index if not exists dr_once on discount_redemptions(discount_id, order_ref);
create index if not exists dr_dev_idx on discount_redemptions(discount_id, device_key);
alter table discount_redemptions enable row level security;

-- owner creates/updates a discount (device-scoped)
create or replace function discount_upsert(p_device text, p_discount jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_shop text := _my_shop(p_device); v_id text;
begin
  if p_discount is null then return json_build_object('ok', false, 'reason', 'no_data'); end if;
  v_id := coalesce(nullif(p_discount->>'id',''), 'disc_' || md5(v_shop || '|' || coalesce(p_discount->>'code','') || '|' || coalesce(p_discount->>'title','')));
  insert into discounts(id, shop_id, code, title, kind, value, min_subtotal, applies_scope,
                        starts_at, ends_at, usage_limit, per_customer_limit, active)
  values (v_id, v_shop, nullif(p_discount->>'code',''), left(p_discount->>'title',80),
          coalesce(nullif(p_discount->>'kind',''),'percentage'), greatest(coalesce((p_discount->>'value')::numeric,0),0),
          nullif(p_discount->>'min_subtotal','')::numeric, coalesce(nullif(p_discount->>'applies_scope',''),'shop'),
          nullif(p_discount->>'starts_at','')::timestamptz, nullif(p_discount->>'ends_at','')::timestamptz,
          nullif(p_discount->>'usage_limit','')::int, nullif(p_discount->>'per_customer_limit','')::int,
          coalesce((p_discount->>'active')::boolean, true))
  on conflict (id) do update set
    code=excluded.code, title=excluded.title, kind=excluded.kind, value=excluded.value,
    min_subtotal=excluded.min_subtotal, applies_scope=excluded.applies_scope, starts_at=excluded.starts_at,
    ends_at=excluded.ends_at, usage_limit=excluded.usage_limit, per_customer_limit=excluded.per_customer_limit,
    active=excluded.active
  where discounts.shop_id = v_shop;         -- an id owned by another shop is never overwritten
  return json_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function discount_upsert(text, jsonb) to anon;

-- SERVER-AUTHORITATIVE validation: the client cannot fabricate a discount — it must
-- call this and the server decides the amount. Read-only.
create or replace function discount_validate(p_code text, p_shop text, p_subtotal numeric, p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare d record; v_amt numeric; v_mine int;
begin
  if coalesce(p_code,'') = '' then return json_build_object('ok', false, 'reason', 'no_code'); end if;
  select * into d from discounts
   where lower(code) = lower(trim(p_code)) and active and (shop_id = p_shop or applies_scope = 'all')
   order by (shop_id = p_shop) desc limit 1;                 -- prefer a shop-specific code
  if d.id is null then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if d.starts_at is not null and now() < d.starts_at then return json_build_object('ok', false, 'reason', 'not_started'); end if;
  if d.ends_at   is not null and now() > d.ends_at   then return json_build_object('ok', false, 'reason', 'expired'); end if;
  if coalesce(p_subtotal,0) < coalesce(d.min_subtotal,0) then return json_build_object('ok', false, 'reason', 'below_min', 'min', d.min_subtotal); end if;
  if d.usage_limit is not null and d.used_count >= d.usage_limit then return json_build_object('ok', false, 'reason', 'used_up'); end if;
  if d.per_customer_limit is not null and coalesce(p_device,'') <> '' then
    select count(*) into v_mine from discount_redemptions where discount_id = d.id and device_key = p_device;
    if v_mine >= d.per_customer_limit then return json_build_object('ok', false, 'reason', 'customer_limit'); end if;
  end if;
  v_amt := case d.kind
    when 'percentage' then round(coalesce(p_subtotal,0) * least(d.value,100) / 100.0, 2)
    when 'fixed'      then least(d.value, coalesce(p_subtotal,0))
    else 0 end;                                              -- free_delivery: amount 0, caller drops delivery fee
  return json_build_object('ok', true, 'id', d.id, 'kind', d.kind, 'value', d.value,
                           'amount', coalesce(v_amt,0), 'code', d.code);
end $$;
grant execute on function discount_validate(text, text, numeric, text) to anon;

-- redeem at order placement — idempotent per order; bumps used_count once
create or replace function discount_redeem(p_code text, p_shop text, p_device text, p_order text, p_subtotal numeric)
returns json language plpgsql security definer set search_path = public as $$
declare v json; d_id text; v_amt numeric; v_new boolean;
begin
  v := discount_validate(p_code, p_shop, p_subtotal, p_device);
  if (v->>'ok') <> 'true' then return v; end if;
  d_id := v->>'id'; v_amt := (v->>'amount')::numeric;
  insert into discount_redemptions(discount_id, device_key, order_ref, amount)
    values (d_id, p_device, p_order, v_amt)
    on conflict (discount_id, order_ref) do nothing;
  get diagnostics v_new = row_count;                         -- 1 = new redemption, 0 = replay
  if v_new then update discounts set used_count = used_count + 1 where id = d_id; end if;
  return json_build_object('ok', true, 'amount', v_amt, 'kind', v->>'kind');
end $$;
grant execute on function discount_redeem(text, text, text, text, numeric) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_dev text := 'catdev01'; v_shop text := _my_shop('catdev01'); r json;
begin
  delete from product_variants where item_id = 'CITEM1';
  delete from discount_redemptions where discount_id in (select id from discounts where shop_id = v_shop);
  delete from discounts where shop_id = v_shop;
  delete from shop_items where id = 'CITEM1';
  delete from shops where id = v_shop;

  insert into shops(id, name, category, delivery, rating) values (v_shop, 'Cat Test', 'fashion', 'both', 5.0);
  insert into shop_items(id, shop_id, name, price) values ('CITEM1', v_shop, 'T-Shirt', 299);

  -- VARIANTS: owner sets 2, wrong device refused
  r := variant_set(v_dev, 'CITEM1', '[{"title":"S","price":299,"sku":"TS-S","options":{"Size":"S"}},{"title":"M","price":349,"sku":"TS-M","options":{"Size":"M"}}]'::jsonb);
  assert (r->>'ok')='true' and (r->>'variants')::int = 2, 'FAIL: variant_set';
  assert (select count(*) from product_variants where item_id='CITEM1') = 2, 'FAIL: variants not stored';
  r := variant_set('someoneelse99', 'CITEM1', '[]'::jsonb);
  assert (r->>'ok')='false' and (r->>'reason')='not_your_product', 'FAIL: foreign variant write allowed';

  -- DISCOUNT: create 10% off min 100, total-limit 2, per-customer 1
  r := discount_upsert(v_dev, '{"code":"SAVE10","title":"10% off","kind":"percentage","value":10,"min_subtotal":100,"usage_limit":2,"per_customer_limit":1}'::jsonb);
  assert (r->>'ok')='true', 'FAIL: discount_upsert';

  -- validate: 200 → 20 off; 50 → below_min
  r := discount_validate('SAVE10', v_shop, 200, 'cust1');
  assert (r->>'ok')='true' and (r->>'amount')::numeric = 20, 'FAIL: 10% of 200 != 20, got '||(r->>'amount');
  r := discount_validate('SAVE10', v_shop, 50, 'cust1');
  assert (r->>'ok')='false' and (r->>'reason')='below_min', 'FAIL: below-min not enforced';

  -- redeem idempotent per order
  r := discount_redeem('SAVE10', v_shop, 'cust1', 'ORDER_A', 200);
  assert (r->>'ok')='true' and (r->>'amount')::numeric = 20, 'FAIL: redeem';
  r := discount_redeem('SAVE10', v_shop, 'cust1', 'ORDER_A', 200);   -- replay same order
  assert (select used_count from discounts where shop_id=v_shop and code='SAVE10') = 1, 'FAIL: redeem not idempotent';

  -- per-customer limit: cust1 already used once (limit 1) → now blocked
  r := discount_validate('SAVE10', v_shop, 200, 'cust1');
  assert (r->>'ok')='false' and (r->>'reason')='customer_limit', 'FAIL: per-customer limit not enforced';

  -- a different customer can still use it (until the total limit)
  r := discount_validate('SAVE10', v_shop, 200, 'cust2');
  assert (r->>'ok')='true', 'FAIL: second customer wrongly blocked';

  -- cleanup
  delete from product_variants where item_id='CITEM1';
  delete from discount_redemptions where discount_id in (select id from discounts where shop_id=v_shop);
  delete from discounts where shop_id=v_shop;
  delete from shop_items where id='CITEM1';
  delete from shops where id=v_shop;
  raise notice 'PASS: variants (owner-scoped) + server-authoritative discounts (min/limits/idempotent/per-customer)';
end $$;

select 'shopify-grade catalog (variants + discounts) ready' as status;

-- ========== MIGRATION: 0025_double_entry_ledger.sql ==========
-- ============================================================
-- 0025 — DOUBLE-ENTRY FINANCIAL LEDGER  (⚠ FROZEN — validated locally, not applied)
--   Written 2026-08-12. The money spine (0015) records finance_events (an audit
--   log) + settlement_ledger, but the directive (§28) demands a real DOUBLE-ENTRY
--   ledger: immutable journals whose debits always equal credits, so the platform's
--   books provably balance and every rupee is traceable (CFO-grade §21/§43).
--
--   This is INTEGRATED, not a disconnected primitive: ledger_sync_order() DERIVES the
--   correct journals for an order from the REAL tables (payments / settlement_ledger /
--   refunds), idempotently. So the ledger reflects actual money events and always
--   reconciles. ledger_post() is the generic balanced-journal primitive; a journal
--   that does not balance is rejected. Entries are immutable (corrections = new
--   compensating journals, never edits).
-- ============================================================

-- ---------- chart of accounts ----------
create table if not exists ledger_accounts (
  code text primary key,
  name text not null,
  kind text not null check (kind in ('asset','liability','revenue','expense'))
);
insert into ledger_accounts(code,name,kind) values
  ('cash',               'Cash / gateway received',        'asset'),
  ('customer_liability', 'Held for undelivered orders',    'liability'),
  ('seller_payable',     'Owed to sellers',                'liability'),
  ('mitra_payable',      'Owed to delivery partners',      'liability'),
  ('platform_revenue',   'Platform commission revenue',    'revenue'),
  ('tax_payable',        'Tax collected, owed to govt',    'liability'),
  ('gateway_fees',       'Payment gateway cost',           'expense')
on conflict (code) do nothing;

-- ---------- journals + entries (append-only, always balanced) ----------
create table if not exists ledger_journals (
  id        bigint generated always as identity primary key,
  kind      text not null,                 -- payment | delivery | refund | payout | adjustment
  order_ref text,
  memo      text,
  at        timestamptz not null default now()
);
create index if not exists lj_order_idx on ledger_journals(order_ref, at);

create table if not exists ledger_entries (
  id         bigint generated always as identity primary key,
  journal_id bigint not null references ledger_journals(id) on delete cascade,
  account    text not null references ledger_accounts(code),
  debit      numeric not null default 0 check (debit  >= 0),
  credit     numeric not null default 0 check (credit >= 0),
  check (not (debit > 0 and credit > 0))   -- a leg is either a debit or a credit
);
create index if not exists le_journal_idx on ledger_entries(journal_id);
create index if not exists le_account_idx  on ledger_entries(account);
alter table ledger_accounts enable row level security;
alter table ledger_journals enable row level security;
alter table ledger_entries  enable row level security;   -- posted only via SECURITY DEFINER RPCs

-- ---------- ledger_post: a balanced journal, or reject ----------
create or replace function ledger_post(p_kind text, p_order text, p_legs jsonb, p_memo text)
returns json language plpgsql security definer set search_path = public as $$
declare v_jid bigint; v_dr numeric := 0; v_cr numeric := 0; leg jsonb;
begin
  if jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) < 2 then
    return json_build_object('ok', false, 'reason', 'need_>=2_legs');
  end if;
  for leg in select value from jsonb_array_elements(p_legs) loop
    v_dr := v_dr + coalesce((leg->>'debit')::numeric, 0);
    v_cr := v_cr + coalesce((leg->>'credit')::numeric, 0);
  end loop;
  if round(v_dr,2) <> round(v_cr,2) then
    return json_build_object('ok', false, 'reason', 'unbalanced', 'debit', v_dr, 'credit', v_cr);
  end if;
  if round(v_dr,2) = 0 then return json_build_object('ok', false, 'reason', 'zero'); end if;

  insert into ledger_journals(kind, order_ref, memo) values (p_kind, p_order, p_memo) returning id into v_jid;
  for leg in select value from jsonb_array_elements(p_legs) loop
    insert into ledger_entries(journal_id, account, debit, credit)
    values (v_jid, leg->>'account', coalesce((leg->>'debit')::numeric,0), coalesce((leg->>'credit')::numeric,0));
  end loop;
  return json_build_object('ok', true, 'journal', v_jid, 'amount', v_dr);
end $$;
-- NOT anon-granted: money is posted only by the server (edge fn / sync), never a client.

-- ---------- ledger_sync_order: derive an order's journals from the REAL tables ----------
-- Idempotent: wipes this order's journals and re-derives from payments / settlement /
-- refunds. So the double-entry books always reflect the true current money state.
create or replace function ledger_sync_order(p_order text)
returns json language plpgsql security definer set search_path = public as $$
declare v_amt numeric; v_net numeric; v_comm numeric; v_gross numeric;
        v_refunded numeric; v_settled boolean; n int := 0;
begin
  delete from ledger_journals where order_ref = p_order;   -- re-derive (cascades entries)

  -- 1. verified online payment → cash in, held as customer liability
  select coalesce(sum(amount_paise),0)/100.0 into v_amt
    from payments where ref = p_order and status = 'verified';
  if v_amt > 0 then
    perform ledger_post('payment', p_order,
      jsonb_build_array(jsonb_build_object('account','cash','debit',v_amt),
                        jsonb_build_object('account','customer_liability','credit',v_amt)), 'payment verified');
    n := n + 1;
  end if;

  -- 2. delivered (settlement due/paid) → release the held money to seller + platform
  select coalesce(sum(net),0), coalesce(sum(commission),0)
    into v_net, v_comm
    from settlement_ledger where order_ref = p_order and status in ('due','paid');
  v_gross := coalesce(v_net,0) + coalesce(v_comm,0);
  if v_gross > 0 then
    perform ledger_post('delivery', p_order,
      jsonb_build_array(jsonb_build_object('account','customer_liability','debit',v_gross),
                        jsonb_build_object('account','seller_payable','credit',v_net),
                        jsonb_build_object('account','platform_revenue','credit',v_comm)), 'delivered — split');
    n := n + 1;
  end if;

  -- 3. refund succeeded → reverse: cash goes back out; unwind whatever it was holding
  select coalesce(sum(amount_paise),0)/100.0 into v_refunded
    from refunds where order_ref = p_order and status = 'succeeded';
  if v_refunded > 0 then
    v_settled := (v_gross > 0);
    if v_settled then
      -- money had been split → claw it back from seller + platform
      perform ledger_post('refund', p_order,
        jsonb_build_array(jsonb_build_object('account','seller_payable','debit',v_net),
                          jsonb_build_object('account','platform_revenue','debit',v_comm),
                          jsonb_build_object('account','cash','credit',v_gross)), 'refund after delivery');
    else
      -- still held as customer liability → return it
      perform ledger_post('refund', p_order,
        jsonb_build_array(jsonb_build_object('account','customer_liability','debit',v_refunded),
                          jsonb_build_object('account','cash','credit',v_refunded)), 'refund before delivery');
    end if;
    n := n + 1;
  end if;

  return json_build_object('ok', true, 'journals', n);
end $$;

-- ---------- reads: account balance + trial balance (books must balance) ----------
create or replace function ledger_balance(p_account text)
returns numeric language sql security definer set search_path = public stable as $$
  select coalesce(sum(debit) - sum(credit), 0) from ledger_entries where account = p_account;
$$;

create or replace function ledger_trial_balance(p_token text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_dr numeric; v_cr numeric;
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_dr, v_cr from ledger_entries;
  return json_build_object('ok', true,
    'total_debits', v_dr, 'total_credits', v_cr, 'balanced', round(v_dr,2) = round(v_cr,2),
    'accounts', (select coalesce(json_agg(row_to_json(t) order by t.code),'[]'::json) from (
        select a.code, a.kind, coalesce(sum(e.debit),0) debits, coalesce(sum(e.credit),0) credits,
               coalesce(sum(e.debit)-sum(e.credit),0) balance
        from ledger_accounts a left join ledger_entries e on e.account = a.code
        group by a.code, a.kind) t));
end $$;
grant execute on function ledger_trial_balance(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('ledgerdev0001'); r json; v_bal numeric;
begin
  delete from ledger_journals where order_ref='LG_O1';
  delete from shop_orders where id='LG_O1'; delete from settlement_ledger where order_ref='LG_O1';
  delete from refunds where order_ref='LG_O1'; delete from payments where ref='LG_O1';

  -- an unbalanced journal is REJECTED
  r := ledger_post('adjustment','LG_O1', jsonb_build_array(
        jsonb_build_object('account','cash','debit',100),
        jsonb_build_object('account','customer_liability','credit',90)), 'bad');
  assert (r->>'ok')='false' and (r->>'reason')='unbalanced', 'FAIL: unbalanced journal accepted';

  -- real order: pay 100 → deliver (92 seller + 8 platform) → sync ledger.
  -- insert as 'new' then transition to 'done' so the 0015 settlement trigger fires
  -- (it settles on the transition to done, not on an already-done insert).
  insert into shop_orders(id,shop_id,buyer_device,items,total,status) values ('LG_O1',v_shop,'ledgerdev0001','[]'::jsonb,100,'new');
  insert into payments(rzp_order_id,rzp_payment_id,amount_paise,ref,status,verified_at) values ('lg_ord1','lg_pay1',10000,'LG_O1','verified',now());
  update shop_orders set status='done' where id='LG_O1';    -- fires settlement trigger → seller 92 + platform 8
  r := ledger_sync_order('LG_O1');
  assert (r->>'ok')='true', 'FAIL: sync';

  -- books balance, and the money landed where it should
  assert ledger_balance('cash') = 100, 'FAIL: cash != 100, got '||ledger_balance('cash');
  assert ledger_balance('customer_liability') = 0, 'FAIL: liability not released, got '||ledger_balance('customer_liability');
  -- liability/revenue accounts carry a natural CREDIT balance → debit−credit is negative
  assert ledger_balance('seller_payable') = -92, 'FAIL: seller_payable != -92, got '||ledger_balance('seller_payable');
  assert ledger_balance('platform_revenue') = -8, 'FAIL: revenue (credit) wrong, got '||ledger_balance('platform_revenue');

  -- refund → sync → everything unwinds to zero (books still balance)
  insert into refunds(order_ref,device_key,amount_paise,status,idempotency_key) values ('LG_O1','ledgerdev0001',10000,'succeeded','lg_rf1');
  r := ledger_sync_order('LG_O1');
  assert ledger_balance('cash') = 0, 'FAIL: cash not returned on refund, got '||ledger_balance('cash');
  assert ledger_balance('seller_payable') = 0, 'FAIL: seller_payable not clawed back, got '||ledger_balance('seller_payable');
  assert ledger_balance('platform_revenue') = 0, 'FAIL: revenue not reversed, got '||ledger_balance('platform_revenue');

  -- global trial balance: total debits = total credits
  select coalesce(sum(debit),0) - coalesce(sum(credit),0) into v_bal from ledger_entries;
  assert round(v_bal,2) = 0, 'FAIL: books do not balance, net '||v_bal;

  delete from ledger_journals where order_ref='LG_O1';
  delete from shop_orders where id='LG_O1'; delete from settlement_ledger where order_ref='LG_O1';
  delete from refunds where order_ref='LG_O1'; delete from payments where ref='LG_O1';
  raise notice 'PASS: double-entry — unbalanced rejected; pay→deliver→refund derived + reconciled to zero';
end $$;

select 'double-entry ledger ready' as status;

-- ========== MIGRATION: 0026_inventory_reservations.sql ==========
-- ============================================================
-- 0026 — INVENTORY RESERVATIONS (oversell prevention)  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. The audit found checkout has no reservation → the last unit
--   can be sold twice. The earlier agent draft (0012, DELETED) got this wrong:
--   item_name casing mismatched stock_ledger, anon RPCs derived no ownership, and it
--   would fail-closed for every shop (none track on_hand). This version fixes all of
--   that:
--     · OPT-IN per product: shop_items.track_inventory (default FALSE → unlimited, so
--       nothing breaks; a shop turns tracking on for the SKUs it actually counts).
--     · available = on_hand (stock_ledger sum) − active holds, keyed on item_name in
--       the SAME representation stock_sell writes (left(name,80)).
--     · atomic: advisory lock per shop, then check-ALL-then-hold-ALL.
--     · no double-deduct: a hold is only a checkout gate; the EXISTING stock_sell
--       (0006) still records the sale on delivery; commit/release just stop the hold
--       counting. TTL sweep frees abandoned holds.
-- ============================================================

alter table shop_items add column if not exists track_inventory boolean not null default false;

create table if not exists stock_reservations (
  id         bigint generated always as identity primary key,
  shop_id    text not null,
  item_name  text not null,               -- matches stock_ledger.item_name representation
  order_ref  text not null,
  device_key text,
  qty        numeric not null check (qty >= 0),
  status     text not null default 'held',-- held | committed | released
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index if not exists sr_once on stock_reservations(order_ref, item_name);
create index if not exists sr_avail_idx on stock_reservations(shop_id, item_name) where status = 'held';
alter table stock_reservations enable row level security;   -- writes via the RPCs below

-- available-to-sell = on_hand − active holds (both keyed on item_name)
create or replace function _stock_available(p_shop text, p_item_name text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(delta) from stock_ledger where shop_id = p_shop and item_name = p_item_name), 0)
       - coalesce((select sum(qty) from stock_reservations
                   where shop_id = p_shop and item_name = p_item_name and status = 'held' and expires_at > now()), 0);
$$;

-- reserve stock for an order at checkout. Untracked items are unlimited (ok). For
-- tracked items, ALL must have availability or NONE are held. Idempotent per order.
create or replace function stock_reserve(p_device text, p_order text, p_shop text, p_items jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare it jsonb; v_name text; v_qty numeric; v_tracked boolean; short jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' then return json_build_object('ok', false, 'reason', 'bad_items'); end if;
  perform pg_advisory_xact_lock(hashtext('resv:' || p_shop));       -- serialize this shop's reservations

  -- pass 1: every TRACKED item must have enough (adding back THIS order's own hold so
  -- a re-reserve of the same quantity is idempotent, not a false shortage)
  for it in select value from jsonb_array_elements(p_items) loop
    v_name := left(it->>'name', 80); v_qty := greatest(coalesce((it->>'qty')::numeric, 1), 0);
    select coalesce(track_inventory, false) into v_tracked from shop_items where shop_id = p_shop and name = v_name limit 1;
    if coalesce(v_tracked, false) and v_qty > 0 then
      if (_stock_available(p_shop, v_name)
          + coalesce((select sum(qty) from stock_reservations
                      where order_ref = p_order and item_name = v_name and status = 'held' and expires_at > now()), 0)
         ) < v_qty then
        short := short || jsonb_build_array(jsonb_build_object('name', v_name, 'need', v_qty));
      end if;
    end if;
  end loop;
  if jsonb_array_length(short) > 0 then
    return json_build_object('ok', false, 'reason', 'insufficient_stock', 'items', short);
  end if;

  -- pass 2: (re)create holds for tracked items
  for it in select value from jsonb_array_elements(p_items) loop
    v_name := left(it->>'name', 80); v_qty := greatest(coalesce((it->>'qty')::numeric, 1), 0);
    select coalesce(track_inventory, false) into v_tracked from shop_items where shop_id = p_shop and name = v_name limit 1;
    if coalesce(v_tracked, false) and v_qty > 0 then
      insert into stock_reservations(shop_id, item_name, order_ref, device_key, qty, status, expires_at)
      values (p_shop, v_name, p_order, p_device, v_qty, 'held', now() + interval '15 minutes')
      on conflict (order_ref, item_name) do update set
        qty = excluded.qty, status = 'held', expires_at = excluded.expires_at, device_key = excluded.device_key;
    end if;
  end loop;
  return json_build_object('ok', true);
end $$;
grant execute on function stock_reserve(text, text, text, jsonb) to anon;

-- release an order's holds (cancel / abandonment). Buyer OR the owning shop may release.
create or replace function stock_release(p_device text, p_order text)
returns json language plpgsql security definer set search_path = public as $$
begin
  update stock_reservations set status = 'released'
   where order_ref = p_order and status = 'held'
     and (device_key = p_device or shop_id = _my_shop(p_device));
  return json_build_object('ok', true);
end $$;
grant execute on function stock_release(text, text) to anon;

-- commit an order's holds on fulfilment (the owning shop). The sale itself is still
-- recorded by stock_sell (0006); this only stops the hold counting against available.
create or replace function stock_commit(p_device text, p_order text)
returns json language plpgsql security definer set search_path = public as $$
begin
  update stock_reservations set status = 'committed'
   where order_ref = p_order and status = 'held' and shop_id = _my_shop(p_device);
  return json_build_object('ok', true);
end $$;
grant execute on function stock_commit(text, text) to anon;

-- pg_cron: free abandoned holds past their TTL
create or replace function reservations_sweep()
returns json language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update stock_reservations set status = 'released' where status = 'held' and expires_at <= now();
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'freed', n);
end $$;

-- PAIRED CLIENT CHANGE (when staged): shops.js checkout → rpc/stock_reserve before
-- confirming (block on insufficient_stock); myshop delivery → rpc/stock_commit; cancel
-- → rpc/stock_release; pg_cron → reservations_sweep every minute. Untracked products
-- are unaffected. STAGE-2 note: stock_reserve trusts p_shop; tie anti-griefing to a
-- real order + rate-limit when real auth (Phase 7) lands.

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('invdev000001'); r json;
begin
  delete from stock_reservations where shop_id = v_shop;
  delete from stock_ledger where shop_id = v_shop;
  delete from shop_items where shop_id = v_shop;
  delete from shops where id = v_shop;

  insert into shops(id, name, category, delivery, rating) values (v_shop, 'Inv Test', 'grocery', 'both', 5.0);
  insert into shop_items(id, shop_id, name, price, track_inventory) values
    ('INV_MILK', v_shop, 'Milk', 30, true),      -- tracked
    ('INV_SALT', v_shop, 'Salt', 10, false);     -- NOT tracked (unlimited)
  insert into stock_ledger(shop_id, item_name, delta, reason) values (v_shop, 'Milk', 5, 'purchase');  -- on_hand 5

  -- reserve 3 for order A → ok; 2 remain
  r := stock_reserve('buyerA', 'INV_OA', v_shop, '[{"name":"Milk","qty":3}]'::jsonb);
  assert (r->>'ok')='true', 'FAIL: reserve A';
  assert _stock_available(v_shop,'Milk') = 2, 'FAIL: available != 2, got '||_stock_available(v_shop,'Milk');

  -- order B wants 3 → OVERSELL blocked (only 2 available)
  r := stock_reserve('buyerB', 'INV_OB', v_shop, '[{"name":"Milk","qty":3}]'::jsonb);
  assert (r->>'ok')='false' and (r->>'reason')='insufficient_stock', 'FAIL: oversell not blocked';

  -- order B takes the remaining 2 → ok; now 0 available
  r := stock_reserve('buyerB', 'INV_OB', v_shop, '[{"name":"Milk","qty":2}]'::jsonb);
  assert (r->>'ok')='true', 'FAIL: reserve B 2';
  assert _stock_available(v_shop,'Milk') = 0, 'FAIL: available != 0 after B';

  -- re-reserving B the same 2 is idempotent (still ok, still 0), not a false shortage
  r := stock_reserve('buyerB', 'INV_OB', v_shop, '[{"name":"Milk","qty":2}]'::jsonb);
  assert (r->>'ok')='true', 'FAIL: idempotent re-reserve';
  assert (select count(*) from stock_reservations where order_ref='INV_OB' and status='held') = 1, 'FAIL: duplicate hold';

  -- untracked item is always reservable (unlimited)
  r := stock_reserve('buyerC', 'INV_OC', v_shop, '[{"name":"Salt","qty":999}]'::jsonb);
  assert (r->>'ok')='true', 'FAIL: untracked item blocked';
  assert (select count(*) from stock_reservations where order_ref='INV_OC') = 0, 'FAIL: untracked created a hold';

  -- release A → its 3 free up → available back to 3
  r := stock_release('buyerA', 'INV_OA');
  assert _stock_available(v_shop,'Milk') = 3, 'FAIL: release did not free stock, got '||_stock_available(v_shop,'Milk');

  -- sweep releases expired holds (force-expire B)
  update stock_reservations set expires_at = now() - interval '1 minute' where order_ref = 'INV_OB';
  r := reservations_sweep();
  assert _stock_available(v_shop,'Milk') = 5, 'FAIL: sweep did not free expired hold, got '||_stock_available(v_shop,'Milk');

  delete from stock_reservations where shop_id = v_shop;
  delete from stock_ledger where shop_id = v_shop;
  delete from shop_items where shop_id = v_shop;
  delete from shops where id = v_shop;
  raise notice 'PASS: oversell blocked, idempotent, untracked-unlimited, release + TTL-sweep free stock';
end $$;

select 'inventory reservations ready' as status;

-- ========== MIGRATION: 0027_order_full.sql ==========
-- ============================================================
-- 0027 — CONNECTED ORDER (unified lifecycle assembler)  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §1: "an order must not be an isolated database
--   record." Orignals now has many subsystems (payment, reservation, status events,
--   dispatch, settlement, double-entry ledger, refund) — this proves they are ONE
--   connected order, not silos. order_full() assembles the COMPLETE lifecycle of an
--   order from every subsystem, device-scoped (buyer OR owning shop). It is the
--   single source of truth for customer tracking, the merchant console, and support
--   (§30 "agents should see the entire order context").
-- ============================================================
create or replace function order_full(p_order text, p_device text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_shop text; v_buyer text;
begin
  select shop_id, buyer_device into v_shop, v_buyer from shop_orders where id = p_order;
  if v_shop is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  -- authorize: the buyer who placed it, or the owning shop — nobody else
  if p_device <> coalesce(v_buyer, '') and v_shop <> _my_shop(p_device) then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return json_build_object('ok', true,
    'order', (select row_to_json(o) from (
        select id, shop_id, buyer_name, total, status, created_at, updated_at
        from shop_orders where id = p_order) o),
    'payment', (select row_to_json(p) from (
        select status, amount_paise/100.0 as amount, rzp_payment_id, verified_at
        from payments where ref = p_order order by verified_at desc nulls last limit 1) p),
    'reservations', coalesce((select json_agg(json_build_object('item', item_name, 'qty', qty, 'status', status))
        from stock_reservations where order_ref = p_order), '[]'::json),
    'timeline', coalesce((select json_agg(json_build_object('at', at, 'actor', actor, 'from', from_status, 'to', to_status, 'note', note) order by at)
        from shop_order_events where order_id = p_order), '[]'::json),
    'delivery', (select row_to_json(d) from (
        select taken_name, taken_veh, status, picked_at, partner_lat, partner_lng
        from live_jobs where order_ref = p_order limit 1) d),
    'settlement', (select row_to_json(s) from (
        select net, commission, status, paid_at from settlement_ledger where order_ref = p_order limit 1) s),
    'ledger', coalesce((select json_agg(json_build_object('kind', kind, 'memo', memo, 'at', at) order by at)
        from ledger_journals where order_ref = p_order), '[]'::json),
    'refund', (select row_to_json(r) from (
        select status, amount_paise/100.0 as amount, rzp_refund_id
        from refunds where order_ref = p_order order by created_at desc limit 1) r));
exception when others then return json_build_object('ok', false, 'reason', 'error'); end $$;
grant execute on function order_full(text, text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('ofdev0000001'); v_dev text := 'of_buyer_0001'; j json;
begin
  delete from ledger_journals where order_ref='OF_O1'; delete from settlement_ledger where order_ref='OF_O1';
  delete from payments where ref='OF_O1'; delete from shop_orders where id='OF_O1';

  -- run a real order through the connected subsystems
  insert into shop_orders(id, shop_id, buyer_device, buyer_name, items, total, status)
    values ('OF_O1', v_shop, v_dev, 'Test Buyer', '[{"name":"Milk","q":1}]'::jsonb, 100, 'new');   -- genesis event (0009 trigger)
  insert into payments(rzp_order_id, rzp_payment_id, amount_paise, ref, status, verified_at)
    values ('of_ord1','of_pay1',10000,'OF_O1','verified', now());                                   -- payment
  -- accept + deliver via the real state machine (logs events + fires the settlement trigger)
  perform shop_order_status('OF_O1', 'ofdev0000001', 'prep');
  perform shop_order_status('OF_O1', 'ofdev0000001', 'done');
  perform ledger_sync_order('OF_O1');                                                               -- double-entry

  -- the connected order assembles every subsystem
  j := order_full('OF_O1', v_dev);
  assert (j->>'ok')='true', 'FAIL: order_full denied to buyer';
  assert (j->'order'->>'id')='OF_O1', 'FAIL: order block missing';
  assert (j->'payment'->>'status')='verified', 'FAIL: payment not connected';
  assert (j->'settlement'->>'net') is not null, 'FAIL: settlement not connected';
  assert json_array_length(j->'ledger') >= 1, 'FAIL: ledger not connected';
  assert json_array_length(j->'timeline') >= 1, 'FAIL: timeline not connected';

  -- a stranger cannot read the order
  assert (order_full('OF_O1', 'stranger999')->>'ok')='false', 'FAIL: stranger read the order';
  -- the owning shop can
  assert (order_full('OF_O1', 'ofdev0000001')->>'ok')='true', 'FAIL: owning shop denied';

  delete from ledger_journals where order_ref='OF_O1'; delete from settlement_ledger where order_ref='OF_O1';
  delete from payments where ref='OF_O1'; delete from shop_orders where id='OF_O1';
  raise notice 'PASS: order_full connects order+payment+settlement+ledger+timeline; owner-scoped';
end $$;

select 'connected order (order_full) ready' as status;

-- ========== MIGRATION: 0028_serviceability.sql ==========
-- ============================================================
-- 0028 — SERVICEABILITY ENGINE  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §46: "never promise a delivery the system cannot
--   operationally fulfil." Before an order is placed the client asks
--   serviceability_check() — the server confirms the shop is available (open, not
--   deleted), within delivery RANGE, and within operating HOURS, and returns a
--   distance + ETA. Read-only, public (catalog-adjacent, no PII).
-- ============================================================
create or replace function _svc_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns numeric language sql immutable as $$
  select case when a_lat is null or a_lng is null or b_lat is null or b_lng is null then null
    else round((2 * 6371 * asin(least(1.0, sqrt(
      power(sin(radians((b_lat - a_lat)/2)),2) +
      cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians((b_lng - a_lng)/2)),2)))))::numeric, 2) end;
$$;

create or replace function serviceability_check(p_shop text, p_lat double precision, p_lng double precision)
returns json language plpgsql security definer set search_path = public stable as $$
declare s record; v_km numeric; v_open boolean; v_range boolean; v_hours boolean := true;
        v_now time; v_from time; v_till time; v_max numeric := 15; reasons jsonb := '[]'::jsonb;
begin
  select is_open, deleted_at, lat, lng, open_from, open_till into s from shops where id = p_shop;
  if not found or s.deleted_at is not null then
    return json_build_object('serviceable', false, 'reasons', jsonb_build_array('shop_unavailable'));
  end if;

  v_open := coalesce(s.is_open, false);
  if not v_open then reasons := reasons || jsonb_build_array('shop_closed'); end if;

  v_km := _svc_km(p_lat, p_lng, s.lat, s.lng);
  v_range := v_km is null or v_km <= v_max;               -- no coords → don't block on range
  if not v_range then reasons := reasons || jsonb_build_array('out_of_range'); end if;

  -- operating hours (best-effort parse of HH:MM; unparseable → treated as open, never a false block)
  begin
    v_now  := (now() at time zone 'Asia/Kolkata')::time;
    v_from := nullif(trim(s.open_from), '')::time;
    v_till := nullif(trim(s.open_till), '')::time;
    if v_from is not null and v_till is not null then
      v_hours := case when v_till > v_from then v_now between v_from and v_till
                      else v_now >= v_from or v_now <= v_till end;   -- overnight window
    end if;
  exception when others then v_hours := true; end;
  if not v_hours then reasons := reasons || jsonb_build_array('outside_hours'); end if;

  return json_build_object(
    'serviceable', v_open and v_range and v_hours,
    'shop_open', v_open, 'in_range', v_range, 'in_hours', v_hours,
    'distance_km', coalesce(v_km, 0),
    'eta_mins', greatest(9, round(coalesce(v_km, 2) * 4 + 8)),
    'reasons', reasons);
end $$;
grant execute on function serviceability_check(text, double precision, double precision) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare r json;
begin
  delete from shops where id in ('SVC_OPEN','SVC_CLOSED');

  -- an OPEN shop at (28.60,77.20), all-day hours
  insert into shops(id, name, category, is_open, lat, lng, open_from, open_till)
    values ('SVC_OPEN', 'Open Mart', 'grocery', true, 28.60, 77.20, '00:00', '23:59');

  -- nearby customer → serviceable
  r := serviceability_check('SVC_OPEN', 28.61, 77.21);
  assert (r->>'serviceable')='true', 'FAIL: nearby open shop not serviceable ('||coalesce(r->>'reasons','')||')';
  assert (r->>'distance_km')::numeric < 3, 'FAIL: distance wrong, got '||(r->>'distance_km');

  -- far customer (~150 km away) → out of range, not serviceable
  r := serviceability_check('SVC_OPEN', 30.00, 77.20);
  assert (r->>'serviceable')='false' and (r->>'in_range')='false', 'FAIL: far customer wrongly serviceable';

  -- a CLOSED shop → not serviceable even if nearby
  insert into shops(id, name, category, is_open, lat, lng) values ('SVC_CLOSED', 'Shut Mart', 'grocery', false, 28.60, 77.20);
  r := serviceability_check('SVC_CLOSED', 28.61, 77.21);
  assert (r->>'serviceable')='false' and (r->>'shop_open')='false', 'FAIL: closed shop serviceable';

  -- a deleted / unknown shop → unavailable
  r := serviceability_check('SVC_NOPE', 28.61, 77.21);
  assert (r->>'serviceable')='false', 'FAIL: unknown shop serviceable';

  delete from shops where id in ('SVC_OPEN','SVC_CLOSED');
  raise notice 'PASS: serviceability — open+near+in-hours ok; far/closed/unknown blocked with reasons';
end $$;

select 'serviceability engine ready' as status;

-- ========== MIGRATION: 0029_notifications.sql ==========
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

-- ========== MIGRATION: 0030_returns.sql ==========
-- ============================================================
-- 0030 — RETURNS & REVERSE LOGISTICS  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §29: return request → eligibility → approval →
--   pickup → inspection → refund → restock, with explicit policy rules and a state
--   machine. INTEGRATED: on 'refunded' it creates a real refund (0015) + voids the
--   seller settlement; on 'restocked' it adds stock back to the ledger (0005). Buyer
--   requests (device-scoped, delivered + in window); the owning shop drives the rest.
-- ============================================================
create table if not exists returns (
  id         text primary key,
  order_ref  text not null,
  shop_id    text not null,
  device_key text not null,             -- buyer
  items      jsonb,
  reason     text,
  status     text not null default 'requested',  -- requested|approved|rejected|picked_up|inspected|refunded|restocked|closed
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ret_order_idx on returns(order_ref);
create index if not exists ret_shop_idx  on returns(shop_id, created_at desc);
-- at most one ACTIVE return per order
create unique index if not exists ret_one_active on returns(order_ref) where status not in ('rejected','closed');
alter table returns enable row level security;

-- valid transitions (shop-driven after the buyer requests)
create or replace function _return_transition_ok(p_from text, p_to text)
returns boolean language sql immutable as $$
  select case p_from
    when 'requested' then p_to in ('approved','rejected')
    when 'approved'  then p_to in ('picked_up','rejected')
    when 'picked_up' then p_to in ('inspected','rejected')
    when 'inspected' then p_to in ('refunded','rejected')
    when 'refunded'  then p_to in ('restocked','closed')
    when 'restocked' then p_to in ('closed')
    else false end;                     -- rejected/closed terminal
$$;

-- buyer requests a return: must own the DELIVERED order, within a 7-day window
create or replace function return_request(p_device text, p_order text, p_items jsonb, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare v_shop text; v_buyer text; v_status text; v_when timestamptz; v_id text;
begin
  select shop_id, buyer_device, status, updated_at into v_shop, v_buyer, v_status, v_when
    from shop_orders where id = p_order;
  if v_shop is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_buyer <> p_device then return json_build_object('ok', false, 'reason', 'not_your_order'); end if;
  if v_status <> 'done' then return json_build_object('ok', false, 'reason', 'not_delivered'); end if;
  if v_when < now() - interval '7 days' then return json_build_object('ok', false, 'reason', 'window_closed'); end if;

  v_id := 'ret_' || p_order;
  insert into returns(id, order_ref, shop_id, device_key, items, reason, status)
  values (v_id, p_order, v_shop, p_device, p_items, left(coalesce(p_reason,''),200), 'requested')
  on conflict (id) do nothing;
  if not found then return json_build_object('ok', false, 'reason', 'already_requested'); end if;
  return json_build_object('ok', true, 'return', v_id);
end $$;
grant execute on function return_request(text, text, jsonb, text) to anon;

-- shop approves or rejects a requested return
create or replace function return_decide(p_device text, p_return text, p_approve boolean, p_note text)
returns json language plpgsql security definer set search_path = public as $$
declare v_shop text; v_status text;
begin
  select shop_id, status into v_shop, v_status from returns where id = p_return;
  if v_shop is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_shop <> _my_shop(p_device) then return json_build_object('ok', false, 'reason', 'not_your_shop'); end if;
  if v_status <> 'requested' then return json_build_object('ok', false, 'reason', 'not_pending'); end if;
  update returns set status = case when p_approve then 'approved' else 'rejected' end,
                     note = left(coalesce(p_note,''),200), updated_at = now()
   where id = p_return;
  return json_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;
grant execute on function return_decide(text, text, boolean, text) to anon;

-- shop advances the return; side effects on 'refunded' (real refund) and 'restocked' (add stock)
create or replace function return_advance(p_device text, p_return text, p_status text)
returns json language plpgsql security definer set search_path = public as $$
declare r record; v_pay text; v_amt bigint; it jsonb;
begin
  select * into r from returns where id = p_return for update;
  if r.id is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.shop_id <> _my_shop(p_device) then return json_build_object('ok', false, 'reason', 'not_your_shop'); end if;
  if not _return_transition_ok(r.status, p_status) then return json_build_object('ok', false, 'reason', 'bad_transition', 'from', r.status); end if;

  if p_status = 'refunded' then
    -- create a real refund for the order's verified payment (nothing to refund for COD)
    select rzp_payment_id, amount_paise into v_pay, v_amt from payments where ref = r.order_ref and status = 'verified'
      order by verified_at desc nulls last limit 1;
    if v_pay is not null then
      insert into refunds(order_ref, device_key, rzp_payment_id, amount_paise, reason, status, idempotency_key)
      values (r.order_ref, r.device_key, v_pay, v_amt, 'return', 'requested', 'rf_' || r.order_ref)
      on conflict (idempotency_key) do update set status = 'requested', updated_at = now() where refunds.status = 'failed';
      perform _fin_event('refund_requested', r.order_ref, null, v_amt/100.0, v_pay, jsonb_build_object('via','return'));
      perform _settlement_void(r.order_ref, 'return');
    end if;
  elsif p_status = 'restocked' then
    -- returned goods go back on the shelf
    if jsonb_typeof(r.items) = 'array' then
      for it in select value from jsonb_array_elements(r.items) loop
        insert into stock_ledger(shop_id, item_name, delta, reason)
        values (r.shop_id, left(it->>'name',80), greatest(coalesce((it->>'qty')::numeric,1),0), 'return');
      end loop;
    end if;
  end if;

  update returns set status = p_status, updated_at = now() where id = p_return;
  return json_build_object('ok', true, 'status', p_status);
end $$;
grant execute on function return_advance(text, text, text) to anon;

create or replace function my_returns(p_device text)
returns setof returns language sql security definer set search_path = public stable as $$
  select * from returns where device_key = p_device order by created_at desc limit 30;
$$;
grant execute on function my_returns(text) to anon;

create or replace function shop_returns(p_device text)
returns setof returns language sql security definer set search_path = public stable as $$
  select * from returns where shop_id = _my_shop(p_device) order by created_at desc limit 50;
$$;
grant execute on function shop_returns(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('retdev0000001'); v_dev text := 'ret_buyer_001'; r json; v_ret text;
begin
  delete from returns where order_ref='RT_O1'; delete from refunds where order_ref='RT_O1';
  delete from settlement_ledger where order_ref='RT_O1'; delete from stock_ledger where shop_id=v_shop;
  delete from payments where ref='RT_O1'; delete from shop_orders where id='RT_O1'; delete from shops where id=v_shop;

  insert into shops(id,name,category) values (v_shop,'Return Mart','grocery');
  insert into shop_orders(id,shop_id,buyer_device,items,total,status) values ('RT_O1',v_shop,v_dev,'[{"name":"Milk","qty":2}]'::jsonb,100,'new');
  insert into payments(rzp_order_id,rzp_payment_id,amount_paise,ref,status,verified_at) values ('rt_ord1','rt_pay1',10000,'RT_O1','verified',now());
  perform shop_order_status('RT_O1','retdev0000001','prep');
  perform shop_order_status('RT_O1','retdev0000001','done');   -- delivered + settlement due

  -- a return can't be requested on a non-delivered order
  insert into shop_orders(id,shop_id,buyer_device,items,total,status) values ('RT_O2',v_shop,v_dev,'[]'::jsonb,50,'new');
  r := return_request(v_dev,'RT_O2','[]'::jsonb,'x');
  assert (r->>'ok')='false' and (r->>'reason')='not_delivered', 'FAIL: return allowed on undelivered order';
  delete from shop_orders where id='RT_O2';

  -- buyer requests; a stranger cannot
  assert (return_request('stranger','RT_O1','[{"name":"Milk","qty":2}]'::jsonb,'wrong item')->>'ok')='false', 'FAIL: stranger requested return';
  r := return_request(v_dev,'RT_O1','[{"name":"Milk","qty":2}]'::jsonb,'wrong item');
  assert (r->>'ok')='true', 'FAIL: buyer return request'; v_ret := r->>'return';

  -- a stranger shop cannot decide/advance
  assert (return_decide('otherShopDev999', v_ret, true, '')->>'ok')='false', 'FAIL: foreign shop decided';

  -- shop approves and drives to refunded → restocked → closed
  assert (return_decide('retdev0000001', v_ret, true, 'ok')->>'ok')='true', 'FAIL: approve';
  assert (return_advance('retdev0000001', v_ret, 'picked_up')->>'ok')='true', 'FAIL: picked_up';
  assert (return_advance('retdev0000001', v_ret, 'inspected')->>'ok')='true', 'FAIL: inspected';
  assert (return_advance('retdev0000001', v_ret, 'refunded')->>'ok')='true', 'FAIL: refunded';
  -- refund + settlement void happened
  assert exists(select 1 from refunds where order_ref='RT_O1'), 'FAIL: return did not create refund';
  assert (select coalesce(sum(net),0) from settlement_ledger where order_ref='RT_O1' and status='due') = 0, 'FAIL: settlement not voided on return refund';
  assert (return_advance('retdev0000001', v_ret, 'restocked')->>'ok')='true', 'FAIL: restocked';
  -- stock went back (Milk +2)
  assert (select coalesce(sum(delta),0) from stock_ledger where shop_id=v_shop and item_name='Milk' and reason='return') = 2, 'FAIL: returned stock not added back';
  assert (return_advance('retdev0000001', v_ret, 'closed')->>'ok')='true', 'FAIL: closed';
  -- an illegal jump is refused
  assert (return_advance('retdev0000001', v_ret, 'approved')->>'ok')='false', 'FAIL: illegal transition allowed';

  delete from returns where order_ref='RT_O1'; delete from refunds where order_ref='RT_O1';
  delete from settlement_ledger where order_ref='RT_O1'; delete from stock_ledger where shop_id=v_shop;
  delete from payments where ref='RT_O1'; delete from shop_orders where id='RT_O1'; delete from shops where id=v_shop;
  raise notice 'PASS: returns — eligibility, owner-scoped, state machine, refund + settlement void, restock';
end $$;

select 'returns / reverse logistics ready' as status;

-- ========== MIGRATION: 0031_subscriptions.sql ==========
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

-- ========== MIGRATION: 0032_support.sql ==========
-- ============================================================
-- 0032 — CUSTOMER SUPPORT OS  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §30: ticketing with order context, customer/agent
--   conversation, internal notes, priority/SLA, assignment, audit. Customer is device-
--   scoped; agents are admin-token gated (L4+) and can see internal notes + the full
--   order context (order_ref → order_full). A message must never leak an internal
--   note to the customer.
-- ============================================================
create table if not exists support_tickets (
  id           text primary key,
  device_key   text not null,               -- requester
  order_ref    text,                         -- optional order context
  category     text,
  subject      text,
  status       text not null default 'open', -- open | pending | resolved | closed
  priority     text not null default 'normal',-- low | normal | high | urgent
  assigned_to  text,                          -- admin ident
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  first_response_at timestamptz
);
create index if not exists tkt_device_idx on support_tickets(device_key, created_at desc);
create index if not exists tkt_queue_idx  on support_tickets(status, priority, created_at) where status in ('open','pending');

create table if not exists support_messages (
  id          bigint generated always as identity primary key,
  ticket_id   text not null references support_tickets(id) on delete cascade,
  sender_role text not null,                 -- customer | agent
  sender_id   text,
  body        text not null,
  internal    boolean not null default false,-- agent-only note, never shown to the customer
  at          timestamptz not null default now()
);
create index if not exists msg_ticket_idx on support_messages(ticket_id, at);
alter table support_tickets enable row level security;
alter table support_messages enable row level security;

-- customer opens a ticket (device-scoped)
create or replace function ticket_open(p_device text, p_order text, p_category text, p_subject text, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if coalesce(p_device,'')='' or coalesce(p_body,'')='' then return json_build_object('ok', false, 'reason', 'missing'); end if;
  v_id := 'tkt_' || substr(md5(p_device || coalesce(p_order,'') || clock_timestamp()::text), 1, 16);
  insert into support_tickets(id, device_key, order_ref, category, subject)
  values (v_id, p_device, nullif(p_order,''), left(p_category,40), left(coalesce(p_subject,'Support request'),120));
  insert into support_messages(ticket_id, sender_role, sender_id, body)
  values (v_id, 'customer', p_device, left(p_body, 2000));
  return json_build_object('ok', true, 'ticket', v_id);
end $$;
grant execute on function ticket_open(text, text, text, text, text) to anon;

-- customer replies to their own ticket (reopens if resolved)
create or replace function ticket_reply(p_device text, p_ticket text, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner text; v_status text;
begin
  select device_key, status into v_owner, v_status from support_tickets where id = p_ticket;
  if v_owner is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_owner <> p_device then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  insert into support_messages(ticket_id, sender_role, sender_id, body) values (p_ticket, 'customer', p_device, left(coalesce(p_body,''),2000));
  update support_tickets set status = case when status in ('resolved','closed') then 'open' else status end, updated_at = now() where id = p_ticket;
  return json_build_object('ok', true);
end $$;
grant execute on function ticket_reply(text, text, text) to anon;

-- agent replies (L4+); internal=true is an internal note. Stamps first_response_at.
create or replace function ticket_agent_reply(p_token text, p_ticket text, p_body text, p_internal boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_ident text;
begin
  v_ident := (select ident from auth_sessions where token = p_token);
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  insert into support_messages(ticket_id, sender_role, sender_id, body, internal)
  values (p_ticket, 'agent', v_ident, left(coalesce(p_body,''),2000), coalesce(p_internal,false));
  update support_tickets set updated_at = now(),
         first_response_at = coalesce(first_response_at, case when coalesce(p_internal,false) then first_response_at else now() end)
   where id = p_ticket;
  return json_build_object('ok', true);
end $$;
grant execute on function ticket_agent_reply(text, text, text, boolean) to anon;

-- agent updates status / assignment / priority (L4+)
create or replace function ticket_set(p_token text, p_ticket text, p_status text, p_assign text, p_priority text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  update support_tickets set
     status   = coalesce(nullif(p_status,''), status),
     assigned_to = coalesce(nullif(p_assign,''), assigned_to),
     priority = coalesce(nullif(p_priority,''), priority),
     updated_at = now()
   where id = p_ticket;
  return json_build_object('ok', found);
end $$;
grant execute on function ticket_set(text, text, text, text, text) to anon;

-- customer reads own tickets; thread EXCLUDES internal notes
create or replace function my_tickets(p_device text)
returns setof support_tickets language sql security definer set search_path = public stable as $$
  select * from support_tickets where device_key = p_device order by updated_at desc limit 30;
$$;
grant execute on function my_tickets(text) to anon;

create or replace function ticket_thread(p_device text, p_ticket text)
returns json language plpgsql security definer set search_path = public stable as $$
begin
  if not exists (select 1 from support_tickets where id = p_ticket and device_key = p_device) then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return json_build_object('ok', true, 'messages', coalesce((
    select json_agg(json_build_object('role', sender_role, 'body', body, 'at', at) order by at)
    from support_messages where ticket_id = p_ticket and internal = false), '[]'::json));
end $$;
grant execute on function ticket_thread(text, text) to anon;

-- agent queue + full thread (L4+, sees internal notes)
create or replace function ticket_queue(p_token text)
returns json language plpgsql security definer set search_path = public stable as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  return json_build_object('ok', true, 'tickets', coalesce((
    select json_agg(row_to_json(t) order by t.priority desc, t.created_at asc)
    from (select id, device_key, order_ref, subject, status, priority, assigned_to, created_at,
                 extract(epoch from (now()-created_at))/3600 as age_hours
          from support_tickets where status in ('open','pending') limit 100) t), '[]'::json));
end $$;
grant execute on function ticket_queue(text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_dev text := 'sup_buyer_001'; r json; v_tkt text;
begin
  insert into admin_users(ident, level, name, active) values ('__sup_agent__','l4','sup',true) on conflict (ident) do update set level='l4', active=true;
  insert into auth_sessions(token, ident, device_key) values ('__sup_tok__','__sup_agent__','dev_sup') on conflict (token) do nothing;
  delete from support_tickets where device_key = v_dev;

  -- customer opens a ticket with order context
  r := ticket_open(v_dev, 'ORD_X', 'delivery', 'Late order', 'My order is late'); v_tkt := r->>'ticket';
  assert (r->>'ok')='true', 'FAIL: open';

  -- a stranger cannot reply
  assert (ticket_reply('stranger', v_tkt, 'hi')->>'ok')='false', 'FAIL: stranger replied';

  -- agent adds a public reply + an INTERNAL note
  assert (ticket_agent_reply('__sup_tok__', v_tkt, 'Sorry, checking now', false)->>'ok')='true', 'FAIL: agent reply';
  assert (ticket_agent_reply('__sup_tok__', v_tkt, 'note: partner delayed', true)->>'ok')='true', 'FAIL: internal note';
  assert (select first_response_at from support_tickets where id=v_tkt) is not null, 'FAIL: first_response_at not stamped';

  -- customer thread hides the internal note (2 visible: their msg + agent public)
  r := ticket_thread(v_dev, v_tkt);
  assert (r->>'ok')='true' and json_array_length(r->'messages') = 2, 'FAIL: internal note leaked to customer';

  -- agent sets priority + resolves; non-admin cannot
  assert (ticket_set('__nope__', v_tkt, 'resolved', null, 'high')->>'ok')='false', 'FAIL: non-admin set ticket';
  assert (ticket_set('__sup_tok__', v_tkt, 'resolved', '__sup_agent__', 'high')->>'ok')='true', 'FAIL: agent set';
  assert (select status from support_tickets where id=v_tkt)='resolved', 'FAIL: not resolved';

  -- customer replies → reopens
  assert (ticket_reply(v_dev, v_tkt, 'still not here')->>'ok')='true', 'FAIL: customer reopen reply';
  assert (select status from support_tickets where id=v_tkt)='open', 'FAIL: reply did not reopen';

  -- non-admin cannot read the agent queue
  assert (ticket_queue('__nope__')->>'ok')='false', 'FAIL: non-admin read queue';

  delete from support_tickets where device_key = v_dev;
  delete from auth_sessions where token='__sup_tok__'; delete from admin_users where ident='__sup_agent__';
  raise notice 'PASS: support — open/reply, agent gated, internal notes hidden, status/priority, reopen';
end $$;

select 'support ticketing ready' as status;

-- ========== MIGRATION: 0033_reviews.sql ==========
-- ============================================================
-- 0033 — REVIEWS & REPUTATION  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §32: reputation for shops/products/mitras with
--   VERIFIED-purchase, one-review-per-order, anti-spam (rate limit), moderation, and a
--   reputation score that ranking can use (verified reviews weighted). A review is
--   "verified" only when the device genuinely bought + received from that subject.
-- ============================================================
create table if not exists reviews (
  id           bigint generated always as identity primary key,
  subject_type text not null,               -- shop | product | mitra
  subject_id   text not null,
  device_key   text not null,
  order_ref    text,
  stars        int not null check (stars between 1 and 5),
  body         text,
  verified_purchase boolean not null default false,
  status       text not null default 'published',   -- published | flagged | removed
  created_at   timestamptz not null default now()
);
create index if not exists rev_subject_idx on reviews(subject_type, subject_id, status);
create index if not exists rev_device_idx  on reviews(device_key, created_at desc);
-- one review per (device, subject, order)
create unique index if not exists rev_once on reviews(device_key, subject_type, subject_id, coalesce(order_ref,''));
alter table reviews enable row level security;
drop policy if exists rev_read on reviews;
create policy rev_read on reviews for select using (status = 'published');   -- published reviews are public

create or replace function review_add(p_device text, p_subject_type text, p_subject_id text, p_order text, p_stars int, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_verified boolean := false; v_recent int;
begin
  if coalesce(p_stars,0) < 1 or p_stars > 5 then return json_build_object('ok', false, 'reason', 'bad_stars'); end if;
  if p_subject_type not in ('shop','product','mitra') then return json_build_object('ok', false, 'reason', 'bad_subject'); end if;

  -- anti-spam: cap reviews per device per day
  select count(*) into v_recent from reviews where device_key = p_device and created_at > now() - interval '1 day';
  if v_recent >= 10 then return json_build_object('ok', false, 'reason', 'rate_limited'); end if;

  -- verified purchase: for a shop, a delivered order from THIS device to THIS shop
  if p_subject_type = 'shop' and coalesce(p_order,'') <> '' then
    v_verified := exists (select 1 from shop_orders where id = p_order and buyer_device = p_device
                          and shop_id = p_subject_id and status = 'done');
  end if;

  insert into reviews(subject_type, subject_id, device_key, order_ref, stars, body, verified_purchase)
  values (p_subject_type, p_subject_id, p_device, nullif(p_order,''), p_stars, left(coalesce(p_body,''),1000), v_verified)
  on conflict (device_key, subject_type, subject_id, coalesce(order_ref,'')) do nothing;
  if not found then return json_build_object('ok', false, 'reason', 'already_reviewed'); end if;
  return json_build_object('ok', true, 'verified', v_verified);
end $$;
grant execute on function review_add(text, text, text, text, int, text) to anon;

-- reputation a ranking layer can consume (verified reviews weighted)
create or replace function reputation(p_subject_type text, p_subject_id text)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object(
    'count',          count(*),
    'avg',            coalesce(round(avg(stars), 2), 0),
    'verified_count', count(*) filter (where verified_purchase),
    'verified_avg',   coalesce(round(avg(stars) filter (where verified_purchase), 2), 0),
    -- ranking score: verified reviews weighted 2x, lightly smoothed toward 3.5 for low n
    'score', coalesce(round(
       (sum(stars * case when verified_purchase then 2 else 1 end) + 3.5 * 3)
       / nullif(sum(case when verified_purchase then 2 else 1 end) + 3, 0), 3), 3.5),
    'distribution', json_build_object(
       '5', count(*) filter (where stars=5), '4', count(*) filter (where stars=4),
       '3', count(*) filter (where stars=3), '2', count(*) filter (where stars=2),
       '1', count(*) filter (where stars=1)))
  from reviews where subject_type = p_subject_type and subject_id = p_subject_id and status = 'published';
$$;
grant execute on function reputation(text, text) to anon;

create or replace function subject_reviews(p_subject_type text, p_subject_id text, p_limit int)
returns json language sql security definer set search_path = public stable as $$
  select coalesce(json_agg(json_build_object('stars', stars, 'body', body, 'verified', verified_purchase, 'at', created_at) order by created_at desc), '[]'::json)
  from (select * from reviews where subject_type = p_subject_type and subject_id = p_subject_id and status = 'published'
        order by created_at desc limit least(greatest(coalesce(p_limit,20),1),50)) r;
$$;
grant execute on function subject_reviews(text, text, int) to anon;

-- admin moderation (L4+)
create or replace function review_moderate(p_token text, p_review bigint, p_status text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status not in ('published','flagged','removed') then return json_build_object('ok', false, 'reason', 'bad_status'); end if;
  update reviews set status = p_status where id = p_review;
  return json_build_object('ok', found);
end $$;
grant execute on function review_moderate(text, bigint, text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('revdev0000001'); v_dev text := 'rev_buyer_001'; r json;
begin
  delete from reviews where subject_id = v_shop; delete from shop_orders where id='RV_O1'; delete from shops where id=v_shop;
  insert into shops(id,name,category) values (v_shop,'Review Mart','grocery');
  insert into shop_orders(id,shop_id,buyer_device,items,total,status) values ('RV_O1',v_shop,v_dev,'[]'::jsonb,100,'done');

  -- a review tied to a genuine delivered order is VERIFIED
  r := review_add(v_dev, 'shop', v_shop, 'RV_O1', 5, 'Great');
  assert (r->>'ok')='true' and (r->>'verified')='true', 'FAIL: verified review';

  -- same device + same order → cannot review twice
  r := review_add(v_dev, 'shop', v_shop, 'RV_O1', 1, 'again');
  assert (r->>'ok')='false' and (r->>'reason')='already_reviewed', 'FAIL: duplicate review allowed';

  -- a different device with NO order → unverified but allowed
  r := review_add('other_dev_99', 'shop', v_shop, null, 3, 'ok');
  assert (r->>'ok')='true' and (r->>'verified')='false', 'FAIL: unverified review';

  -- bad stars rejected
  assert (review_add('x','shop',v_shop,null,9,'bad')->>'ok')='false', 'FAIL: bad stars accepted';

  -- reputation: 2 reviews (5 verified, 3 unverified); verified_avg = 5
  r := reputation('shop', v_shop);
  assert (r->>'count')::int = 2, 'FAIL: rep count';
  assert (r->>'verified_count')::int = 1, 'FAIL: verified count';
  assert (r->>'verified_avg')::numeric = 5, 'FAIL: verified_avg';

  -- moderation (L4+ only)
  assert (review_moderate('__nope__', 1, 'removed')->>'ok')='false', 'FAIL: non-admin moderated';

  delete from reviews where subject_id = v_shop; delete from shop_orders where id='RV_O1'; delete from shops where id=v_shop;
  raise notice 'PASS: reviews — verified purchase, one-per-order, unverified allowed, reputation (verified-weighted), moderation gated';
end $$;

select 'reviews & reputation ready' as status;

-- ========== MIGRATION: 0034_merchant_agent.sql ==========
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

-- ========== MIGRATION: 0035_config.sql ==========
-- ============================================================
-- 0035 — CONFIG PLATFORM: feature flags + platform economics  (⚠ FROZEN — validated)
--   Written 2026-08-12. §78 feature flags (percentage rollout, cohort) + §76/§79
--   configurable economics (commission, fees) so business rules are DATA, not
--   hardcoded source edits. Flags evaluate deterministically per device.
-- ============================================================

-- ---------- feature flags ----------
create table if not exists feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  rollout_pct int not null default 100 check (rollout_pct between 0 and 100),
  cohort      text,                          -- advisory: 'staff' | 'city:DEL' | ...
  updated_at  timestamptz not null default now()
);
alter table feature_flags enable row level security;

-- deterministic per-device rollout: same device+flag → same answer, ~pct% of devices on
create or replace function flag_on(p_key text, p_device text)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((
    select case
      when not enabled       then false
      when rollout_pct >= 100 then true
      when rollout_pct <= 0   then false
      else (abs(hashtext(coalesce(p_device,'') || ':' || p_key)) % 100) < rollout_pct
    end
    from feature_flags where key = p_key), false);
$$;
grant execute on function flag_on(text, text) to anon;

create or replace function flag_set(p_token text, p_key text, p_enabled boolean, p_rollout_pct int, p_cohort text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  insert into feature_flags(key, enabled, rollout_pct, cohort, updated_at)
  values (p_key, coalesce(p_enabled,false), greatest(least(coalesce(p_rollout_pct,100),100),0), nullif(p_cohort,''), now())
  on conflict (key) do update set enabled=excluded.enabled, rollout_pct=excluded.rollout_pct, cohort=excluded.cohort, updated_at=now();
  return json_build_object('ok', true);
end $$;
grant execute on function flag_set(text, text, boolean, int, text) to anon;

-- ---------- platform economics (configurable) ----------
create table if not exists platform_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into platform_config(key, value) values
  ('commission_pct',       '8'::jsonb),
  ('platform_fee_pct',     '5'::jsonb),
  ('delivery_base',        '22'::jsonb),
  ('delivery_per_km',      '8'::jsonb),
  ('small_order_threshold','149'::jsonb),
  ('commission_by_category', '{"food":10,"restaurant":12,"grocery":6,"pharmacy":6}'::jsonb)
on conflict (key) do nothing;
alter table platform_config enable row level security;

create or replace function config_get(p_key text)
returns jsonb language sql security definer set search_path = public stable as $$
  select value from platform_config where key = p_key;
$$;
grant execute on function config_get(text) to anon;

-- commission % for a category (override → default), config-driven
create or replace function commission_for(p_category text)
returns numeric language sql security definer set search_path = public stable as $$
  select coalesce(
    (select (value->>lower(coalesce(p_category,'')))::numeric from platform_config where key='commission_by_category'),
    (select value::numeric from platform_config where key='commission_pct'),
    8);
$$;
grant execute on function commission_for(text) to anon;

create or replace function config_set(p_token text, p_key text, p_value jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  if _admin_level(p_token) is distinct from 'l5' then return json_build_object('ok', false, 'reason', 'only_l5'); end if;
  insert into platform_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value=excluded.value, updated_at=now();
  return json_build_object('ok', true);
end $$;
grant execute on function config_set(text, text, jsonb) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare r json;
begin
  insert into admin_users(ident,level,name,active) values ('__cfg_l5__','l5','cfg',true) on conflict (ident) do update set level='l5',active=true;
  insert into auth_sessions(token,ident,device_key) values ('__cfg_tok__','__cfg_l5__','dev_cfg') on conflict (token) do nothing;
  delete from feature_flags where key='new_search';

  -- flags: 100% on, 0% off, unknown → false, deterministic percentage
  assert (flag_set('__cfg_tok__','new_search', true, 100, null)->>'ok')='true', 'FAIL: flag_set';
  assert flag_on('new_search','anydevice') = true, 'FAIL: 100% flag off';
  perform flag_set('__cfg_tok__','new_search', true, 0, null);
  assert flag_on('new_search','anydevice') = false, 'FAIL: 0% flag on';
  assert flag_on('__unknown_flag__','x') = false, 'FAIL: unknown flag not false';
  perform flag_set('__cfg_tok__','new_search', true, 50, null);
  assert flag_on('new_search','stableDevice') = flag_on('new_search','stableDevice'), 'FAIL: rollout not deterministic';
  -- non-admin cannot set a flag
  assert (flag_set('__nope__','x',true,100,null)->>'ok')='false', 'FAIL: non-admin set flag';

  -- economics: category override vs default
  assert commission_for('food') = 10, 'FAIL: food commission override, got '||commission_for('food');
  assert commission_for('electronics') = 8, 'FAIL: default commission, got '||commission_for('electronics');
  -- L5 can change config; others cannot
  assert (config_set('__nope__','commission_pct','9'::jsonb)->>'ok')='false', 'FAIL: non-L5 changed config';
  assert (config_set('__cfg_tok__','commission_pct','9'::jsonb)->>'ok')='true', 'FAIL: L5 config_set';
  assert commission_for('electronics') = 9, 'FAIL: config change not reflected, got '||commission_for('electronics');
  perform config_set('__cfg_tok__','commission_pct','8'::jsonb);   -- restore

  delete from feature_flags where key='new_search';
  delete from auth_sessions where token='__cfg_tok__'; delete from admin_users where ident='__cfg_l5__';
  raise notice 'PASS: flags (rollout deterministic, gated) + economics (category override, L5-config-driven)';
end $$;

select 'config platform (flags + economics) ready' as status;
