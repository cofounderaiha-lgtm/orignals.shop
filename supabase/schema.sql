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
  -- public read of marketplace surfaces
  create policy p_shops_read  on shops  for select using (deleted_at is null);
  create policy p_items_read  on shop_items for select using (true);
  create policy p_props_read  on properties for select using (deleted_at is null);
  create policy p_jobs_read   on jobs   for select using (true);
  create policy p_cats_read   on custom_categories for select using (true);
  create policy p_cats_write  on custom_categories for insert with check (true);
  -- demo-bridge writes (anon): snapshots and mirrors are device-scoped upserts
  create policy p_snap_all    on state_snapshots for all using (true) with check (true);
  create policy p_orders_ins  on orders for insert with check (true);
  create policy p_orders_read on orders for select using (true);
  create policy p_orders_upd  on orders for update using (true) with check (true);
  create policy p_events_ins  on order_events for insert with check (true);
  create policy p_events_read on order_events for select using (true);
  create policy p_shops_write on shops for insert with check (true);
  create policy p_shops_upd   on shops for update using (true) with check (true);
  create policy p_items_write on shop_items for insert with check (true);
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
