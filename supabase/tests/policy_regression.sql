-- ============================================================
-- POLICY REGRESSION TEST — the guard against silent re-opens.
-- Run against the live DB (needs the Management token / SQL editor).
-- HEALTHY = returns ZERO rows. Any row = a permissive anon policy has
-- reappeared on a sensitive table (a base-file re-run reverted a fix).
-- Wire this into CI so a re-open FAILS THE BUILD, per AUDIT-2 finding #1.
-- Extend the table lists as new PII / core tables are added.
-- ============================================================

-- (a) no permissive SELECT (using true) on any table that holds PII / money
select 'permissive SELECT' as violation, tablename, policyname
from pg_policies
where schemaname='public' and roles::text like '%public%'
  and cmd='SELECT' and qual='true'
  and tablename in ('payments','shop_orders','orders','order_events','auth_sessions',
                    'app_users','listing_leads','reservations','error_log','verify_queue',
                    'partners','state_snapshots','kyc_docs','face_enrollments','wallet_txns',
                    'wallet_balances','purchase_orders','stock_ledger','otp_challenges',
                    'mitra_utterances','mitra_model','doc_requests')

union all
-- (b) no permissive UPDATE/DELETE (using true) on any core / ownable table
select 'permissive '||cmd, tablename, policyname
from pg_policies
where schemaname='public' and roles::text like '%public%'
  and cmd in ('UPDATE','DELETE') and qual='true'
  and tablename in ('shops','shop_items','orders','state_snapshots','listings',
                    'mitra_utterances','mitra_model','push_subscriptions','purchase_orders',
                    'stock_ledger','payments','shop_orders','verify_queue','partners',
                    'listing_leads','reservations','admin_users','admin_bootstrap')

union all
-- (c) the bootstrap secret must never be column-readable on a public table
select 'setup_code exposed', 'platform_flags', column_name
from information_schema.columns
where table_schema='public' and table_name='platform_flags' and column_name='admin_setup_code'

union all
-- (d) device_key / owner_device must not be anon-SELECTable on the column-protected
-- tables (migration 0011 revokes these). live_jobs/listings are excluded here: they
-- keep a public row read until the client switches to open_jobs/listings_feed, at
-- which point add them and drop their read policies.
select 'device_key column anon-readable', table_name, column_name
from information_schema.column_privileges
where grantee='anon' and privilege_type='SELECT' and table_schema='public'
  and column_name in ('device_key','owner_device','buyer_device')
  and table_name in ('seat_bookings','geo_places','shop_ratings')

order by 1,2;
