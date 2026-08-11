# Orignals — Completion Assessment (§53 A–N)

**Date:** 2026-08-11 · Gate deliverable before any production migration. Built from an
evidence-grounded multi-agent audit of the real code (8 of 11 domains completed live;
payments/finance, AI-layer and verticals/trust/auth synthesized from this session's
prior direct reading — flagged where so). **Migrations 0008/0009/0010 remain FROZEN.**

---

## Executive summary
Orignals is **not a demo** — it has a genuinely working spine: a real vanilla-JS PWA with a
correct network-first, PII-bypassing service worker; real Razorpay (server order + signature
verify + webhook); a real cross-device commerce loop (`shop_orders` + `shop_order_status`);
a genuinely strong append-only, conserved, idempotent 3-tier supply chain; real device-keyed
security-definer RPCs. The gap to "operate like a serious company" is **not the UI** — it is
five things: (1) **the client is the authority** for price, order-id and OTP; (2) **money has
no closing** — no real refund execution, no payment↔order coupling, no ledger reconciliation;
(3) **no operational engines** — dispatch/ETA/search/reco/forecast are absent or faked;
(4) **identity is a world-readable bearer token** (`device_key`); (5) **fabricated trust** is
shown on a live consumer app. The through-line: *state and truth live on the device; the server
records rather than decides.* The target inverts that — **server-authoritative, event-sourced,
Postgres-first** — without cargo-culting infrastructure.

---

## §53 dimension assessment (current → target → gap → priority)

**A. Current architecture.** Client-authoritative vanilla-JS PWA; localStorage is the source of
truth, mirrored whole-state to Supabase; PostgREST RPC + Deno edge fns; poll-based updates.
→ **Target:** server-authoritative domain services (RPC), event-sourced order/finance, thin
client. **Gap:** authority inversion. **P0.**

**B. Target architecture (simplest-sufficient, anti-cargo-cult).** Postgres is the system of
record and the queue substrate for now (no Kafka/Redis until measured). One canonical
`events` table (entity-linked) feeds analytics + reco + fraud. Domain RPCs own each write with
validated state machines + audit. Background work via `pg_cron` (reservation expiry, dispatch
timeouts, forecasts, reconciliation, payouts). **pgvector** only when lexical search is proven
insufficient; a **queue/Redis** only when a hot path is measured to need it; **PostGIS**/
`earthdistance` for geo. **Gap:** most of this is unbuilt. **P0–P2 by piece.**

**C. Database.** ~40 tables accreted by hand, **no migration runner**, base files re-declare
permissive policies hardening revoked (durability meta-bug); **two order tables**; three
unreconciled identity spaces (`profile_id`/`device_key`/`ident`); dead wallet/refund ledgers.
→ **Target:** migration-only authoritative schema; ONE order table; ONE identity; RLS matrix
under CI regression. **Gap:** large but mechanical. **P0** (device_key leak, durability) **/ P1.**

**D. API.** Security-definer RPCs derive ownership from `device_key` — right pattern, wrong
key (public). No idempotency keys on writes; client sends authoritative amounts. → **Target:**
server-recomputed money, idempotency keys, typed error contracts, rate limits. **P0** (price/
amount authority) **/ P1.**

**E. Product capability.** Commerce, supply chain, movies/seats, docs are real; rides, search,
reco, dispatch, trust are faked or absent; seed shops are a simulation. → **Target:** every
surfaced control backed end-to-end or removed. **P0** (fabricated trust, phantom rides) **/ P1.**

**F. Algorithms.** Search = client substring filter; reco = none; dispatch = first-come pull;
ETA = straight-line×constant; forecast = flat 14-day mean. → **Target progression:** search
Postgres-FTS+trigram→hybrid/pgvector; reco rules→popularity→co-purchase→LTR; dispatch
weighted-score→matching→optimization; ETA historical-median→feature-model; forecast
moving-avg→exp-smoothing→GBM — **each stage gated by a data-volume trigger.** **P0–P1.**

**G. AI.** Real: on-device intent classifier + rules + (currently-off) server LLM proxy.
Decorative: `cortex/memory/reason/agents` are thin scaffolds, not subsystems. → **Target:** a
grounded **shop-intelligence agent** with deterministic analytical tools over real business
data (get_inventory/get_sales/forecast_demand/recommend_reorder), a merchant digital twin,
tool-permission model (payout/refund = human approval), eval harness. **P2** (after data exists).

**H. Security.** **P0:** `device_key` (bearer→whole account via `snapshot_restore`) is
world-readable in bulk on several tables; community-shop authz derives from that public key;
`live_jobs` world-readable incl. live GPS; durability meta-bug. Also: token in localStorage,
no CSP, client-generated OTP. → **Target:** close all `device_key` reads (RPC-only), rotate to
real phone-OTP identity + RBAC, CSP, server OTP. **P0.**

**I. Finance.** **P0:** no refund is ever executed (cancellations only *display* "3–5 days");
payment not coupled to order state (Lane B marks paid on unverified); dead wallet/refund
ledgers; settlement recorded before delivery with no reversal; two money sources unreconciled.
→ **Target:** immutable double-entry-style ledger; real Razorpay refunds edge fn + refunds
ledger; payment↔order coupling; reconciliation job. **P0.**

**J. Operations.** No dispatch, no SLA/auto-cancel, no reassignment; operator boards show
**local device data, not the real marketplace**; backend faults invisible (`exception when
others then ok:false` hides everything). → **Target:** dispatch engine + SLA timers + real
ops dashboards off the event stream + error tracking. **P0** (blind ops) **/ P1.**

**K. Marketing / growth.** Referrals real (now a cash liability); analytics is effectively one
`order` event; a `signups` KPI is permanently 0 (never emitted); no funnel/attribution.
→ **Target:** full event funnel + attribution + experiment flags (never on payment/security).
**P1–P2.**

**L. Testing.** One SQL policy-regression test; no unit/integration/e2e; migrations self-prove
via `assert` blocks only. → **Target:** staging DB + schema/RLS/RPC/order/payment/concurrency/
negative-authz tests before any production migration. **P0 for the migration gate.**

**M. Infrastructure.** Supabase + Vercel + edge fns; no staging DB; no job scheduler wired; no
observability. → **Target:** a disposable staging project, `pg_cron`, structured logs + health
counters. Nothing hyperscale. **P1.**

**N. Migration changes required.** See verdict below.

---

## Migration-gate verdict
- **0008 — KEEP as-is.** Independently reconfirmed by multiple domains: no client reads the
  `orders` table (safe to drop `p_orders_read`); `price_check` fail-closed is correct. Apply
  first once staged. (Becomes moot after order-table unification, but correct meanwhile.)
- **0009 — KEEP + EXTEND.** The state machine + `shop_order_events` audit is the backbone
  dispatch, analytics and finance all build on. Extend: add `status` ENUM/CHECK, index on
  `shop_orders(status)`, a `paid/payment_verified` flag (payment↔order coupling), and
  delivery-failure/return/replacement/partner-cancel transitions.
- **0010 — KEEP as-is.** Self-contained; add `doc_requests` to the policy-regression allowlist.
- **ADD (new, frozen until staged):** `0011` close all `device_key`/`live_jobs` read leaks
  (P0 security); `0012` refunds ledger + Razorpay refund edge fn + payment↔order coupling
  (P0 money); `0013` inventory reservation at checkout (P0 oversell); then dispatch, canonical
  `events`, search, order-table unification.
- **Cleanup:** drop the `order_cancel_refund` trigger that mints phantom `wallet_txns` and the
  world-writable `orders`/`order_events` mirror policies.

**Do not apply anything to production until a staging DB runs the full 0008→latest sequence and
passes schema/RLS/RPC/order/payment/concurrency/negative-authorization tests.**

---

## Build roadmap (strict priority: security → correctness → txn integrity → commerce → ops → …)

**Phase 0 — ship-now, client-safe (no live-payment risk, degrade gracefully)**
1. Remove **fabricated trust/verification** claims (consumer-safety P0).
2. Rides: remove the **phantom live charge** (book without prepay; post a real job; honest copy).
3. `save()` **quota guard** + cap `S.orders`; **collision-safe order IDs**; honor
   `shop_order_status` return; kill the fabricated **RFQ** quote.

**Phase 1 — security (frozen migrations, staged before apply)**
4. `0011` close `device_key`/`live_jobs` read leaks; extend policy-regression; base-file durability.

**Phase 2 — money correctness**
5. `0012` refunds ledger + refund edge fn + payment↔order coupling; drop phantom-refund trigger.

**Phase 3 — transaction integrity**
6. `0013` inventory reservation at checkout (available vs reserved vs sold); collision-safe ids server-side; order-table unification.

**Phase 4 — core commerce engines**
7. Server-side search (FTS+trigram); nearby via `earthdistance`+serviceability; reco (rules→popularity→co-purchase); ranking with real signals.

**Phase 5 — operations**
8. Dispatch engine (candidate→score→assign→timeout→reassign) + ETA (historical median) + SLA timers; real ops dashboards off the event stream; error tracking.

**Phase 6 — intelligence & growth**
9. Canonical `events` table + funnel/attribution; grounded shop-intelligence agent + digital twin + tool permissions + eval; demand forecast → reorder.

**Phase 7 — hardening**
10. Real phone-OTP identity + RBAC; CSP + SRI/self-host; `pg_cron` jobs; staging→prod discipline; observability SLOs.

---

## Agent-drafted target migrations — REVIEWED (adversarial, line-by-line 2026-08-11)
Each agent draft was reviewed by a dedicated adversarial reviewer against the real
schema + client. Outcome:
- **`0012_inventory_reservations` → DELETED.** Dead (zero client callers), unnecessary
  for the current human-accept order model, and would break checkout marketplace-wide
  if wired (community shops never credit on_hand, so reserve fails closed). Also had a
  P1 item_name-casing double-deduct vs 0005-0007 and P1 anon RPCs with no ownership.
  A reservation layer returns only when a real stock-gated checkout exists.
- **`0017_events` → DELETED.** Dead; duplicated the live `analytics_events`/`track_hit`
  subsystem; false header "contract" claim; anon `emit_event` could spoof actor.
  (The `0017` number was then reused for `0017_derive_identity` — the H1/H3 argument-
  trust fix — since the events file is gone. Final numbering is reconciled at the
  staging consolidation step, §78.)

### Net-new frozen migrations + edge fn built after the review
- **`0015_finance_refunds_coupling`** — real refunds ledger (idempotent, device-scoped,
  COD-safe), settlement coupled to delivery + reversible, immutable `finance_events`,
  `finance_reconcile`. Paired edge fn `functions/razorpay-refund` (real Razorpay refund,
  service-role) + client `cloudRequestRefund`. Self-reviewed + hardened (failed-refund retry).
- **`0016_dispatch`** — push dispatch over `live_jobs`: `partner_presence`, timed
  `job_offers`, nearest-first `dispatch_job` (advisory-locked against double-offer),
  atomic `offer_respond` (one-job-per-partner guard), `dispatch_sweep`, full audit.
- **`0017_derive_identity`** — `my_shop_orders`/`shop_reservations`/`settlement_mine`
  derive the shop/payee from the caller's device (closes cross-shop PII read H1/H3).

### Staging test package (run after the full sequence, on staging)
`tests/policy_regression.sql` (permissive-policy + device_key-column guard),
`tests/security_negative.sql` (§30 cross-tenant deny matrix), `tests/concurrency.sql`
(§48 guard-presence + pgbench harness for double-refund/assign/seat/webhook races).
- **`0013_eta_engine` → KEPT + FIXED.** Removed the anon grant on `eta_record`
  (median-poisoning), dropped a dead index, added an upper-bound sample validator.
  Sound ETA math. Still dead until the client (core.js) and leg-completion RPCs call it.
- **`0014_search` → KEPT + FIXED.** P0: synonym expansion AND-combined (search returned
  nothing) → now OR-joined. Dropped the dead `shops.search_vec` generated column + 2
  unused indexes. Dead until js/shops.js calls `rpc/search_items`.
- **`0019_shop_intelligence` → KEPT + FIXED.** P1: self-proof inserted real `shop_orders`
  which fired the settlement trigger and left phantom `settlement_ledger` rows — now
  cleaned up. Read-only, device-scoped tools. Dead until a myshop insights panel calls it.
- **`0020_observability` → KEPT + FIXED.** P1: anon `op_log_write` forced to
  `source='client'` (was forgeable) and its jsonb detail capped; dropped 2 speculative
  indexes; added retention. Dead until edge fns + ops.js call it.
All KEPT drafts remain **FROZEN — NOT FOR PRODUCTION**, each with its named paired
client change and remaining Stage-2 notes inline. Lower-priority review items (0013
sargable band index; 0014 down-migration; 0019 revenue-basis consistency; 0020 self-
proof isolation) are documented in each file for the staging pass.

## Biggest risks (fix-first)
1. **`device_key` world-readable** → account takeover. (Phase 1)
2. **No refund execution** on paid cancellations → real money owed, silently. (Phase 2)
3. **Fabricated trust/verification** on a live consumer app → deception/liability. (Phase 0, now)
4. **Rides charge for phantom fulfillment** → paying for a service that never happens. (Phase 0, now)
5. **Oversell** (no checkout reservation) + **silent order loss** (id collision). (Phase 0/3)
