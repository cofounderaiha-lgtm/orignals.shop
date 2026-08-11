# Orignals — Staging Runbook (§78/§79/§80)

The executable plan to bring the FROZEN work up on a **staging** Supabase project,
prove it, and only then gate production. **Nothing here runs against production.**
Do not request the production Management token until every gate below is green.

> Golden rule (the durability meta-bug): apply each **base `*_schema.sql` once**,
> then the **migrations in numeric order**, and **never re-run a base file after a
> migration** — base files re-declare permissive policies that migrations harden, so
> a re-run silently re-opens closed holes (device_key reads, order OTP, etc.).

---

## 0. Provision
1. Create a **throwaway** Supabase project (staging). Never point it at production data.
2. Set env/secrets on staging: `RZP_KEY_ID`, `RZP_KEY_SECRET` (Razorpay **test** keys),
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, VAPID keys. Use **test-mode** Razorpay.
3. Enable extensions used by the migrations: `pg_trgm` (0014). `pg_cron` if you will
   schedule `dispatch_sweep`/prune (optional at first).

## 1. Apply order — base schema (ONCE, in this order)
Dependencies flow downward; apply top to bottom. (Names are the files in `supabase/`.)
```
schema.sql                 -- core: profiles, shops, shop_items, orders(+order_events), custom_categories, RLS
admin_schema.sql           -- admin_users, _admin_level(), admin_rank()   [gate used everywhere]
auth_schema.sql            -- app_users, auth_sessions, otp_challenges
geo_schema.sql             -- geo_places
ops_schema.sql             -- platform_flags, error_log
jobs_schema.sql            -- live_jobs (base)              [needed by live_delivery, 0016]
shop_orders_schema.sql     -- shop_orders (the operational order table)   [0009,0015,0019]
shop_menu_schema.sql       -- shop_items photo/section, price_bounds, price_check
community_schema.sql       -- reservations, listings, listing_leads, ref_codes, referrals   [0017]
mitra_schema.sql           -- mitra_utterances/model
ratings_schema.sql         -- shop_ratings
seats_schema.sql           -- seat_bookings (unique show_key,seat)
payments_schema.sql        -- payments (deny-all)          [0015]
settlements_schema.sql     -- payout_accounts, settlement_ledger, _settle_from_shop_order  [0015,0017,0019]
order_chat.sql · verify_schema.sql · fraud_schema.sql · twofa_schema.sql · face_schema.sql · services_schema.sql · hr_schema.sql · live_delivery.sql · analytics_schema.sql · analytics_precise.sql · analytics_backfill.sql
harden_rls.sql             -- HARDENING LAYER — APPLY LAST of the base files
```
`live_delivery.sql` extends `live_jobs` (taken_*, GPS, job_deliver) — apply after
`jobs_schema.sql`. `analytics_backfill.sql` is a one-time backfill (after
`analytics_schema.sql`).

**`harden_rls.sql` must be applied AFTER every base table it hardens** (state_snapshots,
payments, listing_leads, reservations, error_log, shop_orders, mitra_*) and **before
the migrations**. It drops the blanket read policies those base files declare and
routes reads through security-definer RPCs (`snapshot_restore`, `payment_status`,
`my_leads`, `shop_reservations`, `my_shop_orders`, `order_statuses`, …). Migration
0017 then *redefines* `my_shop_orders`/`shop_reservations`/`settlement_mine` to derive
identity from the device — so 0017 correctly lands after harden_rls. Applying
harden_rls out of order (before those base files) leaves the permissive policies live.

## 2. Apply order — migrations (numeric, after ALL base files)
| # | file | depends on (must already be applied) | what it does |
|---|---|---|---|
| 0001 | admin_bootstrap_secret | admin_schema | move setup code off world-readable flags |
| 0002 | shop_upsert_rpc | schema, shop_menu | shop hijack fix (server-derived id) |
| 0003 | orders_snapshots_rpc | schema | orders.device_key + orders_sync/snapshot_save |
| 0004 | errors_and_storage | ops, shop_menu | recent_errors gate, shopimg MIME |
| 0005 | supply_chain | schema | `_my_shop()`, stock_ledger, PO chain |
| 0006 | stock_idempotent | 0005 | `sl_sale_once` (double-deduct guard) |
| 0007 | po_conserve_stock | 0005,0006 | `sl_po_once`, conserved receive |
| 0008 | orders_read_and_pricecheck | schema | **drop orders OTP read leak**; price_check fail-closed |
| 0009 | order_lifecycle | shop_orders_schema | state machine + `shop_order_events` + shop_order_cancel/market_stats/job_reopen; **drop shop_orders so_read leak** |
| 0010 | doc_requests | — | document-services RPCs |
| 0011 | device_key_hardening | seats, geo, ratings, jobs, community, mitra, ops | revoke device_key columns; open_jobs/job_gps/listings_feed drafts |
| 0013 | eta_engine | — | ETA (eta_estimate; eta_record internal) |
| 0014 | search | schema, shop_menu, `pg_trgm` | FTS+trigram search_items/search_suggest |
| 0015 | finance_refunds_coupling | payments, settlements, shop_orders, 0003, 0009 | **refunds ledger + settlement coupling + finance_events** |
| 0016 | dispatch | jobs, live_delivery | partner_presence + offers + dispatch |
| 0017 | derive_identity | 0005, community, settlements | my_shop_orders/shop_reservations/settlement_mine derive from device |
| 0018 | events | analytics_schema, shop_orders, payments | entity-link analytics_events + emit_event (allowlisted UX) + funnel |
| 0019 | shop_intelligence | 0005, 0009, settlements | read-only merchant analytics |
| 0020 | observability | admin_schema | op_log + op_health |
| 0021 | recommendations | schema (shops, shop_items), shop_orders | reco_home + reco_bought_together (grounded in realised orders) |
| 0022 | fraud_risk | fraud_schema, 0009, 0015, payments, auth_schema | per-device explainable risk score (refund/cancel/payfail/multi-acct) |

(0012 and the old 0017_events were **deleted** in review. Numbering consolidation into
a single clean sequence is a pre-production step, §78. Note: the base
`fraud_schema.many_cancels` signal is DEAD — it matches `status='cancelled'` but buyer
cancel sets `'rejected'` (0009); 0022's `fraud_risk` uses the event log's `actor`
instead, and the base signal should be corrected or dropped at consolidation.)

Each migration ends with a self-proving `do $$ … assert … $$` block — a failed assert
aborts the apply. **A migration that aborts = a bug to fix before proceeding.**

## 3. Deploy edge functions (staging)
`supabase functions deploy razorpay-order razorpay-verify razorpay-webhook push-send razorpay-refund`
- `razorpay-refund` is NEW (pairs with 0015). Verify it can reach the DB (service role)
  and Razorpay test API.

## 4. Test gates (run after the full apply; all must be green)
1. **Every migration proof** already ran during apply (step 2). Re-run any by hand if unsure.
2. `psql -f supabase/tests/policy_regression.sql` → **zero rows** (no permissive policy /
   readable device_key column on a sensitive table).
3. `psql -f supabase/tests/security_negative.sql` → `ALL NEGATIVE-AUTHZ TESTS PASSED`.
4. `psql -f supabase/tests/concurrency.sql` (Part A) → `ALL CONCURRENCY GUARDS PRESENT`.
5. **True concurrency (Part B, pgbench)** — double-refund / double-assign / seat-race /
   webhook-replay each yield **exactly 1**. Any `>1` blocks production.
6. **Payment sandbox** — a Razorpay test-mode order → verify → webhook → `payments.verified`
   → settlement books on delivery → `refund_open` → `razorpay-refund` → refund succeeds →
   settlement voided. Trace it in `finance_events`.

## 5. Paired client changes (deploy WITH the matching migration — never before)
These are documented in each migration and **not yet shipped** (shipping the client
before its migration breaks the live app):
- **0011** — `js/cloud.js`: `cloudJobs()`→`rpc/open_jobs`, `cloudJobForOrder()`→`rpc/job_gps`;
  `cloudListingsRefresh`→`rpc/listings_feed`, `cloudPostLead`→`rpc/listing_lead_add`
  (stop sending owner_device). THEN drop `lj_read`/`ls_read`.
- **0013** — `js/core.js:338`: replace `40 + o.km*16` with `rpc/eta_estimate`; wire
  `eta_record` inside `job_picked`/`job_deliver`.
- **0014** — `js/shops.js`: when `_shopQ` set and cloud on, call `rpc/search_items`.
- **0016** — `js/earn.js`: `partner_ping` heartbeat on going online + location; render
  `my_offers()` with a countdown → `offer_respond()`. Pull feed stays as fallback.
- **0017** — `js/myshop.js:213/237`: `my_shop_orders`/`shop_reservations` pass
  `{p_device: S.deviceKey}` (was `{p_shop}`); settlement caller `{p_device}`.
- **0019** — a `js/myshop.js` insights panel calling `merchant_twin`/`shop_*`.
- **0015** — already wired (`cloudRequestRefund` + `cancelOrder`); it degrades until
  0015 + `razorpay-refund` are live.

## 6. Production gate (§81) — ALL must be PASS before touching production
```
migration apply (staging)      concurrency (pgbench)
every proof green              payment sandbox e2e
policy_regression (0 rows)     backup taken
security_negative (pass)       rollback plan written
```
Rollback per migration = drop the objects it created (all are additive
`create ... if not exists` / `create or replace` + a few `drop policy`); no base table
is destroyed. The two behavior changes to note on rollback: 0015 replaces
`_settle_from_shop_order` (restore the base version) and 0016 adds a live_jobs insert
trigger (drop `trg_dispatch_on_post`).

## 7. Only then
Apply the reconciled sequence to production **in the same order**, re-run the test
gates against production, then continue hardening (Phase 7 auth/RBAC, reco, fraud).
