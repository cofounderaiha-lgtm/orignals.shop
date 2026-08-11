# Orignals — Audit II (post wallet-removal + supply-chain + Week-1 security)

**Date:** 2026-07-23 · **Commit:** `0e84009` · **Auditor's own prior errors corrected below.**

## Verification limits — read first
The Supabase Management-API tool (`supa_run.py` + its token) was cleared from the
scratchpad this session, so **I could not re-query `pg_policies` live this turn.**
Every claim below is sourced one of three ways, and I label which:
- **[VERIFIED-LIVE]** — I ran it against the live DB earlier *this session* (with the date).
- **[SOURCE]** — read directly from the committed `.sql` / `.js` files (source of truth for what a re-run would apply).
- **[INFERRED]** — deduced from source + migration order; needs one live query to confirm, which I give.

---

## ★ TOP FINDING — the security fixes are NOT durable [SOURCE, high confidence]

This is the most important sentence in the document: **every RLS hole I closed this
session is patched by a migration layered *on top of* base schema files that still
declare the vulnerable policy.** There is no migration runner and no ordering guarantee
— the DB was built by hand, file by file. Re-running any base file silently reverts the
fix.

Concretely, these permissive policies are **still present in the base files** and would
re-open on re-run:

| base file:line | policy | re-opens (closed by) |
|---|---|---|
| `schema.sql:326` | `p_shops_upd on shops for update using(true)` | shop hijack (migration 0002) |
| `schema.sql:322` | `p_orders_upd on orders for update using(true)` | bulk order rewrite (0003) |
| `schema.sql:319` | `p_snap_all on state_snapshots for all using(true)` | snapshot overwrite/**delete** (0003) |
| `payments_schema.sql:29-30` | `payments_read_own for select using(true)` | payments world-read (harden_rls) |
| `harden_rls.sql:18` | `snap_upd for update using(true)` | snapshot overwrite (0003) |
| `harden_rls.sql:79,81` | `p_mu_upd / p_mm_upd for update using(true)` | (still open — see below) |
| `community_schema.sql:45` | `ls_upd on listings for update using(true)` | (still open — see below) |
| `mitra_schema.sql:309-310` | `p_mu_all / p_mm_all for all using(true)` | (superseded by harden_rls, but re-run of mitra_schema after harden re-opens DELETE) |

**Fix (unavoidable, and it's the real Week-1 Task 4):** the base files must not declare
permissive policies that a migration then has to undo. Either (a) edit each base file so
it creates the *safe* policy at source and delete the migrations, or (b) freeze the base
files and make `migrations/` the only path applied, in numeric order, in CI. Until then,
"it's fixed" is true only until the next `psql -f schema.sql`. **I cannot honestly call
Step 1 done while this stands.**

---

## Security findings

### CONFIRMED LIVE / high-confidence, NOT fixed

**1. `orders` table is world-readable — includes delivery OTPs. [INFERRED — P0/P1]**
`schema.sql:321` `p_orders_read on orders for select using(true)`. Migration 0003 dropped
the *UPDATE* policy on `orders` but **not the SELECT**, and `harden_rls.sql` never touches
`orders` (it hardens the *other* order table, `shop_orders`). So anon can very likely
`SELECT * FROM orders` — and that table carries `otp integer` (the delivery handover OTP),
`addr_label`, `partner_name`, `total` (written by `orders_sync`, `cloud.js`).
- **Exploit:** `curl .../rest/v1/orders?select=otp,addr_label,partner_name` with the public
  anon key → every order's handover OTP + area + partner. At scale this is delivery
  interception (show up, quote the OTP).
- **This is my own Step-1 miss** — I audited write holes, not read holes, the same class
  of error as my first dossier. Flagging loudly.
- **Confirm:** `select count(*) from pg_policies where tablename='orders' and cmd='SELECT' and qual='true';` (expect 1 = live).
- **Fix:** `drop policy if exists p_orders_read on orders;` — nothing needs it. `orders` is
  a **write-only client mirror** (`orders_sync` writes it; the client reads its own orders
  from `localStorage`, never from this table). No RPC replacement required. Verify by
  grepping the client for a read of `orders` — [SOURCE] there is none.

**2. `recent_errors()` leaks error messages + URLs to anon. [SOURCE — P1]**
`harden_rls.sql:54-59`: `security definer`, returns last 12 rows of `error_log(message,
url)`, `grant execute ... to anon`, **no admin gate.** URLs in this app can contain the
device key (a bearer token — see #4). Any visitor calling `rpc/recent_errors` reads recent
errors and possibly leaked keys.
- **Fix:** add `if admin_rank(_admin_level(p_token)) < 4 then return; end if;` and take a
  `p_token`, or revoke the anon grant. Check `js/ops.js` / `js/admin.js` callers first —
  they call it for the admin error board, so it must take a token, not just be revoked.

**3. Deferred write holes — still live. [VERIFIED-LIVE 2026-07-17 + SOURCE]**
My own Step-1 close-out listed these as remaining, and I never migrated them:
- `listings` — `ls_upd for update using(true)` (`community_schema.sql:45`): anon rewrites
  any property/stay listing (price, title, owner-facing fields).
- `mitra_utterances` / `mitra_model` — `p_mu_upd`/`p_mm_upd for update using(true)`
  (`harden_rls.sql:79-81`): anon overwrites training rows and the model meta → training-set
  poisoning. (DELETE was closed by harden_rls; UPDATE remains.)
- `push_subscriptions` — permissive UPDATE (schema).
- **Fix:** same pattern as 0002/0003 — route writes through a device-derived RPC, drop the
  anon UPDATE policy. `listings` already half-done: `cloudPostListing` posts directly; needs
  a `listing_upsert(p_device, …)` that derives `owner_device`.

**4. Identity is `Math.random()`; device key is a bearer token. [SOURCE — P1, systemic]**
`js/core.js:72` `uid = () => Math.random().toString(36).slice(2,9)`; `js/cloud.js` builds
`S.deviceKey` from it. `crypto.randomUUID`/`getRandomValues` appear **zero** times.
`snapshot_restore(p_device)`, `orders_sync`, `shop_upsert`, `my_leads`, `my_shop_orders`
all trust this key as identity. `harden_rls.sql:7` *claims* a "40-char unguessable
device_key" — **false** on length, entropy, and (until 0002) exposure. Every RPC I added
this session inherits this: the ownership guard is only as strong as an unguessable key,
and this key is guessable-ish (Math.random, ~36 bits). Week-1 Task 3 remains undone.

**5. `shopimg` is an open, public, MIME-unrestricted file host. [SOURCE — P1/P2]**
`shop_menu_schema.sql:11-18`: bucket `public=true`, `file_size_limit=3000000`, policy
`"shopimg upload" for insert with check (bucket_id='shopimg')` — **no auth, no
`allowed_mime_types`.** Anyone with the anon key uploads arbitrary ≤3 MB files to your
domain (malware distribution, illegal content — your legal problem, served from
orignals.shop).
- **Fix:** `update storage.buckets set allowed_mime_types = array['image/jpeg','image/png','image/webp'] where id='shopimg';` Requiring auth would break the current unauthenticated shop-photo upload (`cloudUploadImage`) — honest tradeoff; at minimum restrict MIME + keep the cap.

**6. `price_check` fails OPEN. [SOURCE — P2]**
`shop_menu_schema.sql:60` ends `exception when others then return
json_build_object('verdict','ok')`. Any internal error **approves** the price → a seller
can defeat moderation by triggering an error path. Invert to `'block'` on error — but
handle the empty-bounds case so a brand-new item (no learned band yet) is not wrongly
blocked (return `'ok'` when there is simply no band, `'block'` only on a real error).

**7. Browser-side Anthropic key — armed, unloaded. [SOURCE — P1 on activation]**
`js/brain.js:288-296` calls `api.anthropic.com` from the browser with `x-api-key` from
`config.js` + `anthropic-dangerous-direct-browser-access: true`. Placeholder today
(returns null at line 288), but `config.js:14-23` instructs the founder to paste a real
key — which would publish `sk-ant-…` to every visitor via a static asset + CDN + git. Must
become a Supabase edge function (`Deno.env`) before Mitra's LLM is ever enabled. Pattern to
copy already exists: `functions/razorpay-verify`.

**8. Non-constant-time HMAC compare. [SOURCE — P3]**
`functions/razorpay-verify` compares `expected === signature`. Timing-attack severity over
a network is low, but it's a one-line `crypto.timingSafeEqual`-style fix.

### VERIFIED FIXED THIS SESSION [VERIFIED-LIVE]
- **Admin-takeover race — closed.** `admin_users` has 1 active row; `admin_claim` refuses when >0 (2026-07-12). Setup code moved off world-readable `platform_flags` → `admin_bootstrap` (0 policies). (0001)
- **Shop hijack — closed.** `shops`/`shop_items` anon UPDATE dropped; `shop_upsert` derives id server-side; attacker passing a victim's id writes only their own shop (proven). (0002)
- **Bulk order/snapshot rewrite — closed.** `orders`/`state_snapshots` anon UPDATE/INSERT dropped; `orders_sync` stamps + guards ownership (proven: cross-device rewrite → rows:0); `snapshot_save` RPC. (0003)
- **Payments — deny-all read** (via `payment_status` RPC), confirmed NONE permissive on payments 2026-07-12. (Durability caveat: `payments_schema.sql` re-run re-opens it — see top finding.)

---

## Wallet removal — audit [VERIFIED-LIVE]
- `walletAdd` / `walletPay` **definitions and all call sites: gone** (0 hits). `S.wallet`
  reads: **0**. No `ReferenceError` surface. 31 JS files parse clean.
- Replaced by `earnCredit()` / `earnedTotal()` (`core.js:218-225`) — a **non-spendable**
  record of money owed; verified nothing debits or spends it, and it is never a checkout
  rail. Checkout now offers only **UPI/Card + COD**; the wallet button is removed
  (`index.html`, `core.js` checkout).
- Mitra can no longer mint or transact: the "add N to wallet" branch is gone; ordering now
  routes through the **same `checkoutSheet`** (propose → user confirms → real payment).
  Cancellation no longer credits a balance — it messages a real refund-to-source.
- **Honest business note (not a bug):** referral bonuses (`account.js:209`, `cloud.js:396`)
  and partner/shop earnings now `earnCredit(...)` — i.e. the platform records a real
  **liability to pay out** (to UPI), rather than fictional spendable credit. That is
  correct and honest, but it *is* real money owed; make sure the referral program is
  intended as a cash liability before scaling it.

---

## Supply chain — audit [VERIFIED-LIVE + SOURCE]
Model: append-only `stock_ledger`; stock is `sum(delta)`, never an editable counter. Good.
- **Conserved across tiers** (0007): receive = buyer `+qty` / supplier `−qty`, atomic, same
  batch. Proven end-to-end manufacturer→wholesaler→retailer→customer: total produced =
  Σ on-hand + sold, exactly; one batch traced all the way down.
- **Idempotent** (0006 sale, 0007 PO): partial unique indexes + `on conflict do nothing`.
  Proven: same sale twice deducts once; re-receive → `already_final`.
- **Both completion paths draw stock** (`myshop.js:260` partner + `:471` counter) — fixed
  this session; before, partner-delivered sales left stock overstated.
- **Client UI complete** (`js/supply.js`, 200 lines): stock + low/out + days-of-cover ·
  purchases · incoming orders · PO builder · dispatch-with-batch · receive · adjust. Wired
  from the shop dashboard (`myshop.js:354 go('supply')`), loaded (`index.html:146`),
  deployed (HTTP 200).
- **Gaps [SOURCE]:**
  - `stock_ledger` / `purchase_orders` writes are RPC-only (`_my_shop` derived) — good — but
    inherit the **weak device-key identity** (#4). A stolen device key = full control of
    that shop's procurement.
  - Tiers only *do* anything when a real wholesaler/manufacturer is on the app; seed
    suppliers can receive POs but nobody accepts them. (Known; resolves at onboarding.)
  - No PO **payment** rail — "you pay the supplier on their terms" (`supply.js:165`); B2B
    money is off-platform. Intended for now, but the batch/purity chain is only as trusted
    as an unauthenticated device key claiming to be a manufacturer.

---

## Code integrity [VERIFIED-LIVE]
- 31/31 JS files parse clean; `git status` clean (all committed).
- No secret **values** in the client (only public anon key + public Razorpay keyId). No key
  ever committed to git history (checked previously).
- No stub handlers reintroduced; no dead-wallet references.

---

## Prioritised fix list (do in this order)
1. **[P0] `drop policy p_orders_read on orders`** — closes the OTP/address read leak. One line, nothing breaks. Confirm-then-drop.
2. **[P0-meta] Make migrations authoritative** — freeze base `.sql`, apply only `migrations/` in order via CI, add the policy-regression test (permissive SELECT on PII + permissive UPDATE/DELETE on core = build fails). Without this, 1–3 above and this session's work all silently regress.
3. **[P1] Gate `recent_errors()`** to admin (take `p_token`).
4. **[P1] Close deferred write holes** — `listings`, `mitra_utterances`, `mitra_model`, `push_subscriptions` (device-derived RPC + drop anon UPDATE).
5. **[P1] `shopimg` MIME allowlist.**
6. **[P1] Identity → `crypto.randomUUID`** (Week-1 Task 3) — the systemic one; re-key migration that doesn't orphan existing devices/shops.
7. **[P2] `price_check` fail-closed** (with empty-bounds carve-out).
8. **[P1-on-activation] Move Anthropic call to an edge function** before any real key.
9. **[P3] Constant-time HMAC compare.**

## Open questions (need a human / the DB token)
1. Confirm `orders` SELECT is live (query in #1) — I'm ~90% from source but couldn't re-query.
2. Which base files were *actually last applied*, and in what order? The live policy set is order-dependent and I can't enumerate it without the Management token.
3. Is the referral bonus meant to be a real cash liability (it now is)?
4. Region of the Supabase project (DPDP/localisation) — still unstated in-repo.
5. Are the deferred UPDATE holes (#3) truly still live, or did an un-committed hotfix drop them? Needs `pg_policies` access.
