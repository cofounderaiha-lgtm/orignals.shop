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

### 1. Map tiles — BREAKS AT ~THOUSANDS of users ⚠️ do before launch
`tile.openstreetmap.org` is a volunteer-run server whose usage policy **forbids
heavy production apps**. At lakh-scale we will be throttled or blocked in hours.

**Fix (one line — already centralized in `config.js → map.tileUrl`):**
- Commercial: **MapTiler** (₹2–8K/mo tiers) or Stadia Maps — swap URL + key, done.
- Self-host free: **OpenFreeMap / Protomaps** India extract on a ₹3–6K/mo VPS.
- Do BOTH: commercial now, self-host in parallel (own-maps roadmap, docs/MAPS.md).

### 2. Address search (Nominatim) — BREAKS AT ~HUNDREDS concurrent ⚠️ do before launch
Public Nominatim allows **1 request/second total**. Our cache + own-DB-first +
dedupe cuts traffic massively, but launch day still needs its own geocoder.

**Fix:**
- **Self-hosted Nominatim, India extract**: ~64 GB disk, 8 GB RAM VPS (~₹4–8K/mo). Point `geoSearch` at it — one URL constant.
- Or paid: LocationIQ / Geoapify (Indian coverage, ~₹2–10K/mo by volume).
- Keep the flywheel: every pick still lands in `geo_places`, so our own search keeps getting stronger.

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

### 7. Legal & compliance for a government-endorsed consumer platform
- **Consumer Protection (E-Commerce) Rules 2020** — grievance officer named in-app, 48 h acknowledgement. (Admin L1 Support queue exists; needs a named human.)
- **FSSAI aggregator license** for food delivery.
- **DPDP Act 2023** — privacy policy, consent copy, data-deletion path (exportState/reset exist; wire a delete-my-data RPC).
- **Partner insurance** (group accident cover per active partner — as promised in-app).
- **Terms of service + refund policy pages.**

### 8. Launch-day operations
- **Sentry** (free tier) for error monitoring — 10-line snippet.
- **Load test** with k6: simulate 50K concurrent order placements against Supabase Pro *before* the announcement.
- **Status page** + a WhatsApp support number on day one.
- **Kill switches**: `config.js` flags already let us hard-swap tiles/geocoder/LLM lanes without redeploying user devices (config is fetched fresh each load).

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

## The 7 things only the founder can do (I cannot do these with code)

1. Upgrade **Supabase → Pro** (dashboard billing).
2. Upgrade **Vercel → Pro** (dashboard billing).
3. Create **MapTiler** account → give me the key (I swap `config.js` in one commit).
4. Start **business entity + Razorpay** application (longest lead time — start today).
5. **MSG91** account for OTP SMS → give me the key.
6. **Anthropic API key** for the Mitra Claude lane (optional but recommended) → `config.js llm.apiKey`.
7. Name a **grievance officer** (legal requirement).

Everything else — wiring, swapping, testing, deploying — I execute directly.
