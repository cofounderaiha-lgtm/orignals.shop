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
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-PUBLIC-KEY'
};
