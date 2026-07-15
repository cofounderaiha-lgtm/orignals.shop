# Orignals — Build Report

## PHASE 0 — GATE: **FAILED (both halves)**

**Stopping here. Not proceeding to Phase 1.** Per the instruction: *"If either fails,
stop and report — do not proceed to Phase 1 on optimism."* This is that case.

Verified at commit `50397c4`, live DB, 2026-07-12.

---

### 0a — Is Week 1 shipped? **NO**

```
grep -rn "walletAdd\|walletPay\|wallet.bal" js/   →  42 hits   (must be 0)
```

**The client-side wallet is fully alive.** Week 1 Task 1 was never executed. The
money-inventing paths are all still in production:

| file:line | what it does |
|---|---|
| `js/core.js:85` | `wallet: { bal: 500, txns: [{ label: 'Welcome gift 🎉', amt: +500 }] }` — every new device is granted ₹500 |
| `js/core.js:210-214` | `walletAdd()` — `S.wallet.bal += amt`, localStorage only, no server |
| `js/core.js:215-218` | `walletPay()` — decrements the same local integer |
| `js/core.js:405,422,431` | checkout offers **"Orignals Wallet"** as a payment method and settles against it |
| `js/core.js:348` | cancellation **mints** the refund into the local balance |
| `js/mitra.js:224` | `walletAdd(amt, 'Added via Mitra · UPI')` — up to ₹10,000 from a chat message, labelled as a UPI payment |
| `js/account.js:45` | payment-failure fallback credits **"Complimentary credit (pre-launch)"** anyway |
| `js/account.js:209`, `js/cloud.js:390` | referral bonuses mint ₹50 |
| `js/cloud.js:538` | shop-rejection refund mints the order total |
| `js/admin.js:872` | `adminTestWallet()` — one tap mints ₹500 |

Spread: **5 files, 42 references.** This is not a one-line removal; `checkoutSheet()`
has wallet as a first-class payment rail (`core.js:405-431`), so removing it changes the
checkout contract every vertical calls.

**Why this blocks the build, not just annoys:** Phase 3 asks me to make the order
pipeline "bulletproof" and reconcile `payments.status='verified'` against the order.
There is nothing to reconcile — an order paid by wallet has **no `payments` row at all**.
I would be building idempotency, reconciliation and refunds on top of a ledger that is a
number in `localStorage` that the user can edit in devtools. Every one of those would be
rebuilt the moment the wallet dies. The instruction is right: *building features onto a
fake ledger means rebuilding them later against a real one.*

**SQL half of 0a — PASSES:**

| check | result |
|---|---|
| `select count(*) from admin_users where active` | **1** — PASS (>0; the takeover race is closed) |
| permissive `SELECT ... using(true)` on `payments`, `shop_orders`, `listing_leads`, `reservations` | **NONE** — PASS (zero rows) |

---

### 0b — Is the wedge chosen? **NO**

```
02-WEDGE.md   → NOT FOUND
01-SECURITY.md → NOT FOUND
WEEK1-REPORT.md → NOT FOUND
```

**The founder has not made the decision.** I will not pick it for him by deleting five
verticals — Phase 1 is destructive (`send.js`, `rides.js`, `tickets.js`, `estate.js`,
`services.js` + schemas + Mitra intents + admin tabs), and doing that on my own read of
the code would be me choosing the company's strategy in a commit.

**What the code argues, for the record — the founder should confirm or overrule:**

- **Depth:** `js/shops.js` (598) + `js/myshop.js` (848) = **1,446 LOC**, the deepest
  vertical by a wide margin. Next is `js/tickets.js` at 511, which is already dead
  (removed from nav, `js/core.js:452`).
- **The pipeline was built for food:** `verify_queue.kind` accepts `'purity'`
  (`supabase/verify_schema.sql:11`), and `purity_checks(shop_id, batch, status,
  inspector, note)` exists in `supabase/schema.sql`. Nobody builds a batch/inspector
  table for a rides business.
- **The trust wedge is a food wedge:** *"No adulterated ghee. No fake paneer. Every batch
  purity-tested"* (`js/home.js:56`) buys **nothing** in rides, parcels or property. The
  sharpest sentence on the site only cuts in one vertical.
- **Frequency:** groceries are daily. `js/tickets.js` books a movie once a month.
- The freshness pledge (`js/shops.js:168`, `js/myshop.js`) and `price_bounds` moderation
  (`supabase/shop_menu_schema.sql`) are both food-shaped.

**Cost of the cut, measured (from the audit):** ~1,260 LOC deletes cleanly
(`tickets.js` 511 + `estate.js` 322 + `send.js` 216 + `rides.js` 106 + `services.js`
105). Entangled: `js/earn.js` (607) is shared by grocery/send/rides and must be
untangled, not deleted; `js/data.js` mixes all verticals' seed data in one object;
`js/admin.js` interleaves per-vertical tabs; `js/mitra.js` has a branch per vertical.

---

## NEW FINDING — my own audit was wrong, and this is live

`AUDIT-DOSSIER.md` §C/§L states *"RLS enabled on all 56 tables… no anon policies… the
default is deny."* **That is wrong.** I checked `pg_class.relrowsecurity` (RLS *enabled*)
and never checked the *policies*. RLS-on with a permissive policy is not protection.

Verified live:

```sql
select tablename from pg_policies
where schemaname='public' and cmd='UPDATE' and qual='true';
--  orders, shops, listings, state_snapshots,
--  mitra_utterances, mitra_model, push_subscriptions
```

**With the public anon key from `config.js`, anyone can `UPDATE` any row in those
tables.** Concretely:
- `orders` — rewrite any order (totals, status).
- `shops` — rewrite any merchant's shop.
- `state_snapshots` — **overwrite any user's entire account state.**

Also confirmed: `platform_flags` carried `pf_read` (`SELECT`, `roles={public}`,
`qual=true`) **with `admin_setup_code` as a column on it** — RLS SELECT policies are
row-level, not column-level, so the anon key could read the bootstrap secret. **Fixed
this session** (`supabase/migrations/0001_admin_bootstrap_secret.sql`): secret moved to
`admin_bootstrap` (RLS on, **zero policies**), column dropped from `platform_flags`,
`admin_claim()` reads it as `security definer`. Verified: column `REMOVED — PASS`,
secret `PRESERVED — PASS`, claim path regression-tested (`already_setup`, not an error).

**Safe to fix the UPDATE holes:** I verified **no client code uses `PATCH`** — every
write goes through an RPC, and the writers I checked (`snapshot_restore`, `job_claim`,
`job_ping`, `job_deliver`, `shop_order_status`, `mitra_train`) are all `security definer`
and bypass RLS. Dropping those anon UPDATE policies should not break the app.

**Seam note (what the instruction predicted):** every one of these lived *between* files.
`admin_setup_code` is a policy in `ops_schema.sql:21` and a column in
`admin_schema.sql:10`. Neither file is wrong alone. No single-file read catches it.

---

## What must be true before Phase 1 runs

1. **Delete the client wallet** (Week 1 Task 1) — 42 references, 5 files. Until then
   there is no honest rupee to build a pipeline around.
2. **Decide the wedge** — write `02-WEDGE.md`, or tell me "food, confirmed" and I'll
   record it and cut.

Nothing in Phases 1–8 is safe to start before those two. Phase 1 deletes five verticals;
Phase 3 builds reconciliation against a ledger that doesn't exist yet.

## Recommended order (my read, if you want it)

1. **Close the `UPDATE using(true)` holes now** — one migration, verified safe, live
   exploitable today.
2. **Week 1 Task 1** — kill the wallet. This is the gate.
3. **Wedge decision** — one sentence from the founder.
4. Then Phase 1.

LOC before: **14,819** (js 9,591 / sql 2,910 / css 1,580 / html 156).
LOC after: **unchanged — Phase 1 did not run.**
