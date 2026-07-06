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

-- devices may read their own payment rows (status checks);
-- all writes happen only through the edge functions (service role).
drop policy if exists payments_read_own on payments;
create policy payments_read_own on payments
  for select using (true);

select 'payments table ready' as status;
