/* ============================================================
   ORIGNALS runtime config
   ------------------------------------------------------------
   1. Create a free project at https://supabase.com
   2. SQL Editor → paste & run  supabase/schema.sql
   3. Project Settings → API → copy the two values below
   4. Redeploy (or just refresh locally) — the app auto-connects,
      shows "Cloud synced" in Admin → Database, and your orders,
      shop and categories mirror into real Postgres tables.
   The anon key is designed to be public (safe in frontend).
   Leave as-is to run fully local (default demo mode).
   ============================================================ */
window.ORIGNALS_CONFIG = {
  /* Optional: Claude escalation for queries Mitra Brain can't handle.
     Leave apiKey as-is for ZERO API cost (brain + rules handle everything).
     model: 'claude-haiku-4-5' = cheapest ($1/$5 per MTok) — your choice for
     cost control; switch to 'claude-opus-4-8' for maximum quality.
     Every Claude answer is logged as training data, so your own model
     learns from it and needs Claude less over time (distillation). */
  llm: {
    apiKey: 'YOUR-ANTHROPIC-API-KEY',
    model: 'claude-haiku-4-5'
  },
  /* Payments: Razorpay. The Key ID is public by design (it identifies the
     merchant in Checkout). The key SECRET is never here — server-side flows
     use Supabase secrets (RZP_KEY_SECRET / RZP_WEBHOOK_SECRET) only. */
  pay: {
    keyId: 'rzp_live_StUJDjsi0hfYyx'
  },
  /* Web push (self-hosted). Generate your OWN VAPID keypair (no third
     party): `npx web-push generate-vapid-keys`. Put the PUBLIC key here;
     keep the PRIVATE key as a Supabase secret for the send function.
     Left blank = push simply stays off, app works normally. */
  push: {
    vapidPublic: ''
  },
  /* Maps: 100% open-source, zero cost (founder decision 2026-07-06).
     The app tries these tile sources in order and AUTO-FAILS-OVER if one
     throttles or goes down — no single point of failure, no paid vendor.
     When our own self-hosted tiles are ready (Protomaps/OpenFreeMap India
     extract — see docs/MAPS.md) they go to the FRONT of this list. */
  map: {
    tileUrls: [
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://tile.openstreetmap.de/{z}/{x}/{y}.png'
    ]
  },
  supabaseUrl: 'https://wvprqdfhjcammghjwoqj.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHJxZGZoamNhbW1naGp3b3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyOTU4MDksImV4cCI6MjA5ODg3MTgwOX0.kPSSYOde8j_G5pQ-8vOQvn5NnGjAOjXsTpsMXkqhMW4'
};
