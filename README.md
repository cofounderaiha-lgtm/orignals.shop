# Orignals — orignals.shop

**Real food. Real shops. Verified by our own people.**

The people-first everything platform for India: purity-verified natural food, every nearby shop, neighbour-powered delivery, rides, movie/event tickets, dining, hotels & property — with **Mitra**, the platform's own voice/text intelligence, built in.

**Pillars:** Safety · Purity · Sustainability

## What's inside

| Area | Features |
|---|---|
| Buy | Nearby shops (photo cards), unified basket, coupons, live order tracking with OTP handover |
| Send Anything | Tiffin-to-truck parcels carried by verified partners passing by |
| Rides | Bike/auto/car/van — solo or shared, CV face + vehicle verification |
| Tickets | Movies with live seat map (Recliner/Prime/Classic), events, dining reservations, QR tickets |
| Property & Stays | Buy/rent/plots/commercial + hotels (book stays), post-property wizard, GPS-pinned listings |
| Earn | Gamified job feed ("₹ waiting on your path"), rides + parcels stack on one route, seva (free) mode |
| Your Shop | 2-minute seller onboarding (1 CHF signup, then 10–100 CHF/yr by turnover), self **or** partner delivery per order |
| Super Admin | Purity lab queue, KYC queue, fraud center, order oversight, CHF plan matrix |
| Mitra | Multi-item natural-language orders (English/Hinglish), voice in/out, booking, cancellation, recommendations |

## Stack

Zero-build vanilla HTML/CSS/JS. PWA (manifest + service worker — installable, offline shell). Leaflet/OSM for maps with an in-house SVG map engine as fallback. All state in `localStorage` (demo build — single-browser).

## Run locally

Open `index.html` in any browser. For PWA install + GPS, serve over HTTP:

```bash
npx serve .
```

## Deploy

Static hosting (Netlify / Vercel / Cloudflare Pages). Point `orignals.shop` DNS at the host; HTTPS auto-provisions.

## Roadmap (v2)

Supabase backend: auth (buyer/seller/partner/admin roles), Postgres for shops/orders/listings, realtime order tracking, Storage for shop photos & KYC docs, Edge Functions for payments and dispatch.

## Pricing model

First month complimentary for everyone. No signup fees. Then:

| Tier | Who | Per year |
|---|---|---|
| Buyer | everyone | **1 CHF** |
| Seller 1 · Individual | service person, bike/vehicle owner, solo seller | **1 CHF** |
| Seller 2 · Retail shop | kirana, pharmacy, small store | **10 CHF** |
| Seller 3 · Large retail | restaurants, multi-staff shops, hosts | **25 CHF** |
| Seller 4 · Wholesaler / dealer / hotel | | **50 CHF** |
| Seller 5 · Manufacturer / enterprise | | **100 CHF** |
| Delivery partner | Earn mode | **0 — they earn, never pay** |

Admin panel has 5 control levels (L1 Support → L5 Super Admin) with permission-gated tabs, plus a live Database view with JSON export.
