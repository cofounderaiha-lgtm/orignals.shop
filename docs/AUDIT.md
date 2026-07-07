# Orignals — Full Pre-Launch Audit (2026-07-06)

Honest audit for the "1 lakh+ concurrent users" question. Verdict at the bottom.

## 1. Stubs / empty / layout-only — PASS
Swept every view and handler. No fake buttons or dead screens remain. The
remaining `toast()`-only handlers are **real behaviour**, not stubs:
- masked-number calling ("your number stays private") — intended privacy design
- "Need help?" → opens Mitra; host-onboarding info strip
- seller's own item-preview ADD button (shows the seller what buyers see)

Every commerce/booking/earn flow is wired end-to-end and, where shared,
cross-device (orders, jobs, seats, ratings, dining, property leads, referrals).

## 2. Security at scale — WAS CRITICAL, NOW HARDENED (pilot-grade)
**Found:** the public anon key + RLS `select using(true)` meant anyone could
bulk-download every user's data; `state_snapshots` was `for all`, so anyone
could read/overwrite/**delete every account**.

**Fixed (supabase/harden_rls.sql, proven live):**
- Sensitive tables (state_snapshots, payments, listing_leads, reservations,
  error_log, shop_orders) are no longer anon bulk-readable; each per-device
  read goes through a security-definer RPC keyed on the unguessable 40-char
  `device_key`. state_snapshots also blocks anon DELETE.
- Verified: anon bulk read of every sensitive table → `[]`; anon DELETE of a
  snapshot leaves it intact; the app's own device RPC still works.

**Residual (must do before a真 public/government launch):** true isolation
still requires **real authentication (phone OTP)** — with an anon key, a caller
who *knows* a specific device key could still act on that row. This is the
deferred MSG91/Supabase-Auth item. Current state = safe for a controlled pilot,
not for adversarial public scale.

## 3. Crash-at-scale — PASS (with capacity caveats, no code crashes)
- No null-deref crashes: both `geoKm().toFixed()` calls are guarded by
  non-null coordinate checks; every `JSON.parse` is in try/catch or has a
  fallback.
- **Capacity, not crashes** (open-source/free tier, by your decision):
  - *Map tiles / geocoder*: OSM/Nominatim are rate-limited; mitigated with
    multi-server tile failover + on-device tile cache + geocode cache + our
    own geo_places first. Self-host when daily-actives pass ~10-20K.
  - *Write amplification*: every `save()` uploads the full state blob +
    re-mirrors orders/shops (2.5s debounce). Fine at pilot scale; trim to
    delta-sync before state scale.
  - *Supabase Pro / Vercel Pro*: "minutes to pay" upgrades, triggered by the
    thresholds in LAUNCH-READINESS.md. Not needed yet.

## 4. Third-party libraries — PASS (all correct, real, current)
| Dependency | Version / source | Status |
|---|---|---|
| Leaflet | 1.9.4 — official unpkg | ✅ current stable; `routeMap` degrades gracefully if it fails to load |
| Razorpay Checkout | checkout.razorpay.com/v1 — official | ✅ correct (feature deferred until keys) |
| Google Fonts | Inter + Bricolage Grotesque | ✅ real families; system-font fallback if blocked |
| OSM / Carto tiles | open-source, multi-server failover | ✅ |
Note (hardening, not a bug): unpkg + Google Fonts are external CDNs. For a
government-scale launch, self-host leaflet.js/css and the fonts to remove
external dependencies. The Supabase anon key in config.js is public **by
design** (safe); the key SECRET is never client-side.

## 5. DB ↔ client sync — PASS
Cross-checked every `cloudFetch` table and `rpc/*` call against the live
database: **all 90+ objects exist and names match.** Fixed one regression my
own hardening introduced (admin marketplace stats now uses a counts-only
`market_stats()` RPC instead of blocked table reads).

## 6. Naming consistency — MINOR (documented, harmless)
Internal namespace is `omny_*` (brand was renamed Omny→Orignals). It is
**invisible to users** and fully functional. Developer-facing comments updated
to "Orignals". The localStorage keys (`omny_v1`, `omny_geocache`, …) are left
unchanged **on purpose** — renaming would reset existing installs; it needs a
migration, not a rename. Everything user-visible says Orignals. Project/repo/
domain (`orignals-shop`, `orignals.shop`), config (`ORIGNALS_CONFIG`), and
Supabase ref (`wvprqdfhjcammghjwoqj`) are consistent.

---

## VERDICT

**Good to go for a controlled PILOT** (a ward/district, thousands of users):
functionality is real and cross-device, the catastrophic data-exposure hole is
closed, no crash bugs, libraries are correct.

**NOT yet good for an unrestricted public/government-scale launch** until these
(all previously flagged, none are new surprises):
1. **Real phone authentication** (OTP) — the one true security requirement.
2. Paid tiers (Supabase/Vercel) + self-hosted tiles/geocoder — at the
   thresholds in LAUNCH-READINESS.md.
3. Business entity + Razorpay live + FSSAI + grievance officer named
   (the weeks-long paperwork; start now).

Nothing in the code is fake, mismatched, or crash-prone by itself. The gap to
"crore-scale" is **auth + capacity + paperwork**, exactly as documented — not
hidden stubs.
