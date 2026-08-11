# Orignals — remediation & build status

Living record of what is **live in code** vs **written but pending the DB token**.
Referenced by `AUDIT-2.md`. Newest work on top.

---

## 2026-08-11 — Order lifecycle made real + missing RPCs + wallet-lie sweep

Full-codebase map first (real vs hollow), then built the highest-leverage real gaps.

### Live in code now (safe, degrade gracefully; deployed)
- **Authoritative order lifecycle (client-compatible).** The real operational
  order table `shop_orders` now has, in `migrations/0009_order_lifecycle.sql`:
  a **validated state machine** (illegal jumps like new→done are refused), an
  **append-only audit trail** (`shop_order_events`, one immutable row per
  transition — the spine for disputes/refunds/SLA/fraud), a **genesis event** on
  every order, and `order_timeline()` so buyer or shop can read the real history.
  The client's existing `shop_order_status` call is unchanged — it just becomes
  validated + audited.
- **Six ghost RPCs made real** (client called them; they existed in NO sql file,
  so every call silently `.catch`ed and the feature half-worked):
  - `shop_order_cancel` — buyer cancel now actually reaches the shop's row (0009).
  - `market_stats` — Admin→Database "marketplace live" board now has real counts (0009).
  - `job_reopen` — a dropped delivery job returns to the feed instead of stranding (0009).
  - `doc_request_add` / `my_doc_requests` / `doc_request_cancel` — "Papers"
    document requests now persist, sync status, and cancel for real
    (`migrations/0010_doc_requests.sql`, new `doc_requests` table + admin-gated
    `doc_request_advance`).
- **Reconnected the orphaned movie/seat-booking subsystem.** Real cross-device
  seat locking (`seats_book/confirm`) existed with **no entry point**; added a
  **Movies** tab to the events hub (`tickets.js`) — the whole flow is now reachable.
- **Wallet-lie sweep.** The wallet was deleted (2026-07-17) but ~20 user-facing
  strings still promised it — "₹500 free in your wallet", "refunds to your wallet
  instantly", "pay from wallet", and the **legal Terms/Refund policy** described
  stored value that no longer exists. All corrected to the real model (UPI/card
  via Razorpay + COD; refunds to the original payment method). Legal terms now
  state Orignals holds no stored-value balance.

### Pending the Supabase Management token (written, NOT applied)
- `migrations/0009` and `0010` must be run in the SQL editor / CLI. Both carry
  self-proving `do $$ … assert … $$` blocks — apply and keep the PASS output.
- **0009 also closes a live P0 leak:** `shop_orders_schema.sql:28` recreated
  `so_read using(true)` → buyer name/address/GPS + delivery **OTP** world-readable
  on the real order table. Dropped in 0009 and removed at source in the base file.
- Still pending from before: `migrations/0008` (`orders` mirror OTP read +
  `price_check` fail-closed), and wiring `policy_regression.sql` into CI.

### Known real gaps NOT closed this turn (honest)
- **Seed shops are a simulation.** The 14 hardcoded launch shops produce
  timer-driven orders no seller/rider sees — inherent, because no real seller is
  behind them. Real, transactional buy→pay→deliver exists only for **community
  shops** (now strengthened with the audit trail above). Not a bug to patch — it
  resolves as real sellers onboard.
- **Rides post no delivery job** (captain faked, status on a timer). De-faking
  needs the same real-dispatch path as `send` + live testing — deferred until DB
  access so it isn't shipped untested into the live money flow.
- `order_timeline` RPC is built but not yet surfaced in the buyer's track UI
  (progressive enhancement; ready to wire).
