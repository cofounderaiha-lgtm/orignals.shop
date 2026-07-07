# Orignals — Self-Reliance & Anti-Fragility Guide

Principle (founder's): **no load-bearing third-party dependency.** If any
external service or subscription dies, Orignals must keep working, and every
outside piece must be replaceable at a single, documented seam — no engineer,
no scramble, no embarrassment.

This is how each piece is built to that standard.

## Authentication — already 100% ours
The entire auth engine (generation, bcrypt/sha256 hashing, rate-limiting,
lockout, verification, sessions) lives in **your own Postgres** — `supabase/auth_schema.sql`.
- **Email/phone + password** (`auth_register` / `auth_login`): works **today**,
  needs no delivery channel, no third party. This is the live login.
- **OTP** (`otp_request` / `otp_verify`): fully built and tested; the only
  outsourced hop is *delivering the SMS*, isolated in **one function**:

  ```sql
  -- supabase/auth_schema.sql → otp_deliver(phone, code)
  -- Today: empty (no channel). When your own SMS system is ready, put the
  -- call to your gateway HERE. Nothing else in the app changes.
  ```
- **Fail-open**: every auth RPC returns `{ok,reason}` and never throws; if the
  backend is unreachable the app silently stays in device-local mode. Nobody is
  ever locked out by an outage.
- `platform_flags.require_auth` is **off** — auth is an enhancement, not a gate,
  until you decide otherwise. `otp_dev_echo` returns the code for pilot testing;
  turn it off the moment real delivery exists.

## SMS — the one thing software alone cannot do
Delivering a code to an arbitrary phone requires **either** a licensed SMS
gateway **or** your own telecom/DLT setup (a regulated telecom business, not
code). There is no way around this physical/regulatory fact — Supabase or
anyone else. Your options, cheapest dependency first:
1. **Your own SMS system** (the goal): when live, wire it into `otp_deliver`.
2. **Password login only** (live now): no SMS needed at all.
3. A gateway (MSG91/etc.) later if ever wanted: also just `otp_deliver`.

## Face lock & delivery proof — pure browser, no service
- `captureCameraPhoto()` uses the browser's own camera (`getUserMedia`). No
  cloud face API. Photos stay on the device unless attached to a delivery.
- **Delivery hand-over proof**: the partner captures the collector's photo at
  drop — so even if a friend picks up on the receiver's behalf, there's a
  verified record of who took it.
- **Automated face *matching*** (recognising it's the same face) needs an ML
  model. To stay self-reliant, that would be **face-api.js with the models
  self-hosted in the repo** (no runtime calls out). Say the word and I'll add
  it. If your **edurank.ai** face-2FA has code you want reused, paste it here —
  I can't reach that external project, but I'll match its approach exactly.

## Web push (alerts when the app is closed)
- **Receiving** is native browser (service worker `push` handler — already in
  `sw.js`). No third party.
- **Sending** needs a **VAPID keypair you generate yourself** (`npx web-push
  generate-vapid-keys`) — it is *yours*, not a subscription. The browser's push
  endpoint (FCM/Mozilla) is part of the open web platform, not a paid vendor.
- To switch it on: put the **public** key in `config.js → push.vapidPublic`
  (client subscribes automatically, `push_subscriptions` table stores it); keep
  the **private** key as a Supabase secret / on your VPS, and send from a small
  function. Blank key = push simply stays off, app unaffected.

## Maps & geocoding — open-source with failover
Multi-server open-source tiles + on-device cache + our own `geo_places` first.
Self-host the India tile/geocoder on your VPS when scale needs it (docs/MAPS.md,
docs/LAUNCH-READINESS.md). No paid map vendor.

## Moving to your own VPS (when you buy it)
Everything is plain **Postgres + vanilla JS + static files** — no framework
lock-in. To leave Supabase: run stock PostgreSQL + PostgREST (both open source)
on your VPS, point `config.js` at it, deploy the static app behind any web
server. The SQL in `supabase/*.sql` is standard Postgres and runs as-is.

## The single-seam summary (where each outside piece plugs in)
| Capability | Seam (one place to change) | Third party? |
|---|---|---|
| SMS OTP delivery | `otp_deliver()` | your own gateway |
| Web push sending | `config.push.vapidPublic` + send fn | your own VAPID |
| Real payments | `otp/razorpay` edge fns (deferred) | Razorpay (chosen) |
| Map tiles/geocoder | `config.map.tileUrls` / `geoSearch` | open-source |
| LLM escalation | `config.llm.apiKey` | optional, off by default |

Nothing above is load-bearing today except password login, which is entirely
ours. The platform runs, and stays running, on your own infrastructure.
