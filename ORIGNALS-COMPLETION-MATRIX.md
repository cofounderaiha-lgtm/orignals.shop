# Orignals — Completion Matrix

Honest, evidence-based status of the platform against the enterprise directive.
Legend:
- **LIVE** — shipped to production (orignals.shop), running now.
- **VALIDATED** — built + its proof/asserts EXECUTE and pass on real Postgres via
  `supabase/tests/local_validate.mjs` (PGlite); FROZEN pending a staging apply (never
  pushed to a live DB, nothing exposed).
- **PARTIAL** — real but incomplete.
- **DESIGNED** — architecture/interface exists, implementation pending.
- **GAP** — not started.

Every VALIDATED item applies cleanly in the runbook order and reconciles; the gate is
`node local_validate.mjs` → "migrations failed: NONE".

---

## Foundation
| Capability | Status | Evidence |
|---|---|---|
| Vanilla-JS PWA, router, state, offline SW | **LIVE** | js/core.js, sw.js (v58) |
| Durable write outbox (no lost orders on a blip) | **LIVE** | cloud.js outbox, v55 |
| Visibility-gated polling (§53 low-bandwidth) | **LIVE** | core.js `_orderTick`, v56 |
| First-party analytics + entity-linked event stream | **LIVE** + **VALIDATED** | analytics_schema; 0018 events |
| Device-key hardening (close bulk-read of bearer token) | **VALIDATED** | 0011 |
| Derive shop/payee identity from caller (close IDOR) | **VALIDATED** | 0017 |
| Real phone-OTP auth + RBAC (device_key→session) | **PARTIAL/DESIGNED** | auth_schema live; full re-key is Phase 7 (staging) |
| Observability (op_log + health, admin) | **VALIDATED** | 0020 |
| Negative-authz + concurrency + E2E test gate | **VALIDATED** | tests/*.sql, local_validate.mjs |

## Commerce core
| Capability | Status | Evidence |
|---|---|---|
| Catalog (shop_items) + community shops | **LIVE** | schema, cloud.js |
| Product VARIANTS / options / SKU | **VALIDATED** | 0024 |
| Server-authoritative DISCOUNT engine (codes/limits/idempotent) | **VALIDATED** | 0024 |
| Cart + client fee model | **LIVE** | core.js cartTotal |
| Server price moderation (fail-closed) | **VALIDATED** | 0008 price_check |
| Inventory RESERVATION (oversell prevention, opt-in tracking) | **VALIDATED** | 0026 |
| 3-tier supply chain (conserved, idempotent ledger) | **LIVE** | 0005/0006/0007 |
| Order state machine + append-only audit | **VALIDATED** | 0009 |
| Connected order (order_full across all subsystems) | **VALIDATED** | 0027 |
| Payments (Razorpay, server verify + webhook) | **LIVE** | cloud.js, functions/razorpay-* |
| Payment↔order coupling + settlement-on-delivery | **VALIDATED** | 0015 |
| Real refund execution (edge fn) | **VALIDATED** | 0015 + functions/razorpay-refund |

## Marketplace / discovery
| Capability | Status | Evidence |
|---|---|---|
| Search: FTS + trigram typo tolerance + synonyms | **VALIDATED** | 0014 |
| Recommendations (reorder/popularity/co-purchase, grounded) | **VALIDATED** | 0021 |
| Nearby/geo (own-first search, OSRM routing) | **LIVE** | geo.js |
| Ratings / reviews | **LIVE** (basic) | ratings_schema |
| Trust: real verification vs fabricated badges | **LIVE** (fabrication removed) | shops.js, §59 audit |
| Buy-box / multi-seller offer selection | **GAP** | future (single seller per shop today) |

## Logistics / fulfilment
| Capability | Status | Evidence |
|---|---|---|
| Delivery jobs + OTP handover + live GPS | **LIVE** | live_delivery, cloud.js |
| DISPATCH engine (presence, offers, timeout, reassign, atomic assign) | **VALIDATED** | 0016 |
| ETA engine (self-learning, per-band median) | **VALIDATED** | 0013 |
| Rides (de-risked: no phantom charge, real job) | **LIVE** | rides.js |
| Warehouse WMS (zones/bins/pick/pack) | **GAP** | needs dark-store/warehouse entity |
| Route optimization (multi-stop VRP) | **GAP** | single-leg today; dispatch is the base |

## Finance
| Capability | Status | Evidence |
|---|---|---|
| Settlement ledger + batch payout | **LIVE** | settlements_schema |
| Immutable finance_events audit | **VALIDATED** | 0015 |
| DOUBLE-ENTRY ledger + trial balance | **VALIDATED** | 0025 |
| Reconciliation (finance_reconcile) | **VALIDATED** | 0015 |
| Refunds ledger (idempotent, COD-safe, device-scoped) | **VALIDATED** | 0015 |

## Intelligence
| Capability | Status | Evidence |
|---|---|---|
| Shop intelligence (read-only analytical tools, device-scoped) | **VALIDATED** | 0019 |
| Fraud risk scoring (explainable, real signals) | **VALIDATED** | 0022 |
| Exec dashboard (CEO/CFO/COO from real tables) | **VALIDATED** | 0023 |
| Mitra on-device intent brain | **LIVE** | brain.js |
| Merchant AI workforce (agents w/ tools+approval) | **DESIGNED** | tools exist (0019); agent loop is next |
| Knowledge graph / vector search | **GAP** | pgvector when lexical proves insufficient |

## Verticals
| Capability | Status | Evidence |
|---|---|---|
| Movies + live cross-device seat booking | **LIVE** | tickets.js, seats_schema |
| Documents ("Papers") workflow | **VALIDATED** | 0010 |
| Services marketplace | **LIVE** | services_schema |
| Property/stays | **PARTIAL** | estate.js (community listings real) |

---

## Migration inventory (all VALIDATED via local_validate.mjs — 27 migrations)
`0001`–`0011` (hardened) · `0013` ETA · `0014` search · `0015` finance/refunds · `0016`
dispatch · `0017` derive-identity · `0018` events · `0019` shop-intel · `0020` obs ·
`0021` reco · `0022` fraud · `0023` exec · `0024` catalog/variants/discounts · `0025`
double-entry ledger · `0026` inventory reservations · `0027` connected order.
(`0012` and the old `0017_events` were reviewed + deleted.)

## The only real blockers (not effort — genuinely external)
1. **Staging Supabase project** — to apply the validated sequence against a live DB
   and run the gate there. Everything is proven to apply cleanly locally; nothing is
   exposed until you choose to connect.
2. **Phone-OTP identity re-key (Phase 7)** — a destructive live-data migration best
   done on staging, not authored blind. `device_key` hardening (0011/0017) mitigates
   the interim.

## Next gaps in the autonomous queue (priority order)
serviceability engine (§46) · notifications platform (§42) · returns/reverse-logistics
(§29) · subscriptions (§48) · then the merchant AI agent loop (§10) and warehouse WMS
(§20) once a dark-store entity is warranted.
