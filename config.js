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
  supabaseUrl: 'https://wvprqdfhjcammghjwoqj.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHJxZGZoamNhbW1naGp3b3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyOTU4MDksImV4cCI6MjA5ODg3MTgwOX0.kPSSYOde8j_G5pQ-8vOQvn5NnGjAOjXsTpsMXkqhMW4'
};
