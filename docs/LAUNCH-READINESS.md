# Orignals — CM-Release Launch Readiness

> Scenario this plan prepares for: the Chief Minister announces the platform and
> **1 lakh → 20 lakh (possibly crore-scale) people install it in the first days.**
> Launching unprepared at that scale is dangerous. This is the exact, honest,
> numbered preparation list. Items are ordered by "what breaks first".

---

## What already survives crore-scale (no action needed)

| Layer | Why it holds |
|---|---|
| The app itself (HTML/CSS/JS PWA) | Static files on Vercel's global CDN. Millions of loads are what CDNs are for. |
| Per-user state | Lives on each user's own device (localStorage) — zero server load per tap. |
| Service worker cache | After first visit the app loads from the device, not the network. |
| Geocode cache (built) | Every address search is cached 24 h on-device + deduped; repeat searches cost the network nothing. |
| Own places DB (geo_places) | Searches hit OUR database first; the flywheel makes us less dependent on outside geocoders every day. |
| Mitra brain (own LLM) | Runs 100% in the browser; the Supabase trainer runs on a cron, not per-user. Claude API is only the escalation lane and can be capped. |

---

## What breaks first, and the fix — in order

### 1. Map tiles — mitigated, open-source only (founder decision 2026-07-06)
**Decision: no paid map vendor.** Built instead:
- **Automatic failover** across three open-source tile servers (OSM → Carto → OSM-DE),
  per-device, remembered — no single point of failure (`config.js map.tileUrls`).
- **On-device tile cache** in the service worker (capped ~900 tiles): maps load
  instantly, work offline, and each user hits the tile servers a fraction as often.

**When scale actually arrives** (still open-source, one-time setup, no vendor):
self-host an **India tile server** — OpenFreeMap or Protomaps `.pmtiles` extract
on our own VPS/CDN, then put its URL first in `tileUrls`. That is the "own maps"
lane of docs/MAPS.md — our destination anyway.

### 2. Address search (Nominatim) — mitigated, open-source only
Public Nominatim allows **1 request/second total**. Mitigations already built:
24 h on-device geocode cache + in-flight dedupe + **our own `geo_places` DB is
searched first** and gets stronger with every pick (flywheel).

**When scale actually arrives:** self-hosted **Nominatim India extract** on our
own VPS (open source, ~64 GB disk / 8 GB RAM) — point `geoSearch` at it, one URL.
No paid geocoder needed at any stage.

### 3. Supabase — free tier dies at ~tens of thousands ⚠️ do before launch
Free tier: 500 MB DB, limited pooled connections, 5 GB egress.

**Fix (billing click on the Supabase dashboard, project `wvprqdfhjcammghjwoqj`):**
- **Pro ($25/mo)** carries a district pilot (≈1–2 lakh casual users) — 8 GB DB, 250 GB egress, daily backups.
- **Team/custom compute** before a full state release. Add read replicas if order writes exceed ~1K/min.
- Already in place: RLS on every table, security-definer RPCs, pg_cron trainer, connection pooling.

### 4. Vercel bandwidth — upgrade the same day
Hobby plan = 100 GB/mo. The app is light (~400 KB first load, then cached), but
lakh-scale first-day installs ≈ 40–400 GB.
**Fix:** Vercel **Pro ($20/mo, 1 TB)** — a billing click. (Token I hold can manage projects, not billing.)

### 5. Real money — the biggest gap, and it is REGULATORY, not code
Today the wallet is platform-internal credit. Real UPI in / bank payouts out require:

1. **A registered business entity** (Pvt Ltd / LLP) + current account + GST.
2. **Payment gateway**: Razorpay / Cashfree (UPI, cards, netbanking; ~2% MDR;
   they carry the RBI PA/PG compliance). Checkout drop-in replaces the wallet-pay
   button — the `checkoutSheet` flow was built so this is a bolt-in.
3. **Payouts**: RazorpayX / Cashfree Payouts for partner earnings + seller settlements
   (IMPS/UPI, ₹2–5 per payout).
4. **Escrow-style nodal handling** for marketplace money (gateway provides this).

⏱ Realistic timeline: 2–4 weeks including gateway KYC. **Start the entity + gateway
application NOW — it is the longest pole.**

### 6. Real identity — phone OTP before public launch
Device-local identity is fine for a pilot, dangerous at scale (fraud, duplicate
first-month-free claims). **Fix:** Supabase Auth phone OTP via **MSG91** (~₹0.20/SMS).
1 lakh signups ≈ ₹20–40K one-time SMS cost. The wizard forms already collect
everything else.

### 7. Legal & compliance — ✅ BUILT (2026-07-06)
- ✅ **Privacy Policy** (DPDP Act 2023) — `#/legal/privacy`, full data-rights section.
- ✅ **Terms of Service** — `#/legal/terms`.
- ✅ **Refund & Cancellation policy** — `#/legal/refund`.
- ✅ **Shipping & Delivery policy** — `#/legal/shipping` (payment gateways require this).
- ✅ **Grievance Redressal** (CP E-Commerce Rules 2020) — `#/legal/grievance`, named-officer block, 48 h acknowledgement / 30-day resolution promise.
- ✅ **First-run consent** gate (DPDP) + specific location-permission consent.
- ✅ **Data export & erasure** — `#/legal/data`; `erase_device()` RPC wipes personal data and de-identifies financial records (retention exemption). Linked from Account.
- ⏳ **Founder to fill** the `[bracketed]` placeholders in `js/legal.js` / `docs/COMPLIANCE.md` once the entity + grievance officer are named.
- ⏳ **FSSAI aggregator license** + **partner group insurance** — external filings, start alongside the entity.

### 8. Launch-day operations — ✅ BUILT (2026-07-06)
- ✅ **Own error monitoring** → `error_log` table (no Sentry account needed); auto-captured, deduped, self-trimming; visible in Admin → Database → Operations.
- ✅ **Remote kill switches** → `platform_flags`: maintenance mode (freeze), payments on/off, broadcast banner — applied on next app open with no redeploy. Runbook: `docs/OPS.md`.
- ✅ **Load test** → `docs/loadtest.js` (k6, ramps to 500 VUs against the real backend paths). Run against staging before the announcement.
- ⏳ **Status page + WhatsApp support number** — external accounts; stand up on launch day.

---

## Phased release (the safe path to crores)

| Phase | Users | Infra needed | Cost/mo |
|---|---|---|---|
| **Pilot** (1 city ward) | 5–10K | Supabase Pro + Vercel Pro + MapTiler | ~₹6K |
| **District** | 1–2 lakh | + self-hosted Nominatim + MSG91 OTP + Razorpay live | ~₹25K |
| **State** | 20 lakh+ | + Supabase Team/compute + tile self-host + 2nd region | ~₹1–2L |
| **Crore-scale** | 1 Cr+ | Dedicated backend team; move hot paths (orders, jobs) to dedicated Postgres + queue | staffed project |

**Recommendation to put in front of the CM's office:** announce a **district pilot
first** ("live in X district today, statewide in 90 days"). It reads as a
launch, gives a controlled ramp, and every layer above is already built to scale
through those phases without rewriting the app.

---

## Founder items — DEFERRED by decision (2026-07-06) until scale actually demands

Founder's call: stay open-source and free-tier now; upgrades are "minutes to pay"
when real traffic arrives. Agreed — with one exception flagged below.

| # | Item | When to trigger |
|---|---|---|
| 1 | Supabase → Pro | when DB nears 400 MB or sync errors appear in Admin → Database |
| 2 | Vercel → Pro | when bandwidth dashboard passes ~70 GB in a month |
| 3 | Self-host tiles + Nominatim (open source, own VPS) | when daily actives pass ~10–20K |
| 4 | **Business entity + Razorpay** | ⚠️ the ONE item that is weeks, not minutes — start before any public date is fixed |
| 5 | MSG91 OTP key | at public launch (fraud control for first-month-free) |
| 6 | Anthropic API key (Mitra lane 2) | optional, any time — brain handles the rest |
| 7 | Grievance officer named | required at public launch (legal) |

Everything else — wiring, swapping, testing, deploying — is executed directly in code.
