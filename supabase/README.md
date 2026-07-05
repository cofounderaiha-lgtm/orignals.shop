# Orignals — Backend (Supabase) Setup

Production database layer for orignals.shop. **10 minutes, no code changes.**

## 1 · Create the project
1. [supabase.com](https://supabase.com) → New project (free tier is fine)
2. Pick a region close to India (e.g. `ap-south-1` Mumbai)

## 2 · Install the schema
Dashboard → **SQL Editor** → New query → paste all of [`schema.sql`](schema.sql) → **Run**.

You get: 17 tables, enums, indexes, RLS policies, an auto-refund trigger,
a wallet-balance view, and the 14 launch shops seeded.

## 3 · Storage buckets
Dashboard → **Storage** → create:
| Bucket | Public | Holds |
|---|---|---|
| `shop-photos` | ✅ | shop & item photos |
| `kyc` | ❌ private | ID / DL / vehicle scans |

## 4 · Connect the app
Project Settings → **API** → copy both values into [`../config.js`](../config.js):

```js
window.ORIGNALS_CONFIG = {
  supabaseUrl: 'https://xxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...'
};
```

Commit + push (Vercel/Netlify redeploys) — done. The app shows
**"Cloud synced"** in Admin → Database and starts mirroring.

## What syncs (v1 demo-bridge)
| Client data | Cloud destination | Mode |
|---|---|---|
| Full app state | `state_snapshots` | debounced upsert, restore-on-boot across devices |
| Every order | `orders` (+ auto `order_events`/refund trigger) | idempotent upsert |
| Your shop + shelf | `shops`, `shop_items` | upsert |
| Custom "Other" categories | `custom_categories` | upsert — shared with every seller |

## Table map (matches Admin → Database view)
`profiles` · `wallet_txns` (+`wallet_balances` view) · `shops` · `shop_items` ·
`orders` · `order_events` · `partners` (level auto-computed) · `jobs` ·
`tickets` · `bookings` · `properties` · `rfqs` · `purity_checks` · `kyc_docs` ·
`custom_categories` · `state_snapshots`

## Business rules enforced in the database
- **Auto-refund trigger** — setting `orders.cancelled_at` inserts the refund
  ledger row and a `cancelled` order event. The ledger is the wallet truth
  (`wallet_balances` view); balances can never drift.
- **Partner levels** — `partners.level` is a generated column
  (bronze <10 · silver <25 · gold ≥25 trips). Unfakeable.
- **Seller tiers & fees** — `shops.tier` enum (individual→manufacturer),
  `fee_paid_till` for the 1–100 CHF/yr cycle with complimentary first month.
- **Purity pipeline** — `purity_checks.status`: queued → sampling → lab →
  sealed / delisted, with inspector attribution.

## v1.1 hardening roadmap (when phone-auth ships)
1. Enable Supabase Auth (phone OTP) → link `profiles.auth_id = auth.uid()`
2. Replace the permissive demo policies in `schema.sql` §RLS with
   `auth.uid()`-scoped ones (templates in comments there)
3. Move payments to an Edge Function (`/functions/pay`) wrapping a PSP
4. Realtime: subscribe to `order_events` for push-grade live tracking
