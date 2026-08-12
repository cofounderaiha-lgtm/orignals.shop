/* ============================================================
   LOCAL SCHEMA VALIDATION — run the ENTIRE backend against a real Postgres
   (PGlite = Postgres compiled to WASM) INSIDE node. No Supabase, no server,
   nothing exposed. Applies every base *_schema.sql + all migrations in the
   runbook order, EXECUTES each migration's self-proof (asserts), runs the test
   suites, and independently probes the negative-authz mechanism.

   Run:
     cd supabase/tests && npm init -y >/dev/null 2>&1
     npm i @electric-sql/pglite
     node local_validate.mjs

   HEALTHY: "migrations failed: NONE — all proofs passed" and every DIRECT
   VERIFICATION line says PASS. This is the gate to run BEFORE ever pushing the
   schema to a real database.
   ============================================================ */
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { fuzzystrmatch } from '@electric-sql/pglite/contrib/fuzzystrmatch';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SQLDIR = fileURLToPath(new URL('../', import.meta.url));   // supabase/
// TEST-ONLY preprocess: PGlite has no pg_cron; swap the extension line for a
// cron.schedule stub so base files that schedule jobs still apply. Never touches
// the shipped files (Supabase HAS pg_cron).
const CRON_STUB = "create schema if not exists cron; create or replace function cron.schedule(text,text,text) returns bigint language sql as $cs$ select 1::bigint $cs$;";
const rd = (p) => readFileSync(SQLDIR + p, 'utf8')
  .replace(/create\s+extension\s+if\s+not\s+exists\s+pg_cron\s*;/gi, CRON_STUB);

// runbook base-file order (ops + auth BEFORE admin), then migrations (0012 deleted)
const BASE = [
  'schema.sql','ops_schema.sql','auth_schema.sql','admin_schema.sql','geo_schema.sql',
  'jobs_schema.sql','shop_orders_schema.sql','shop_menu_schema.sql','community_schema.sql',
  'mitra_schema.sql','ratings_schema.sql','seats_schema.sql','payments_schema.sql',
  'settlements_schema.sql','order_chat.sql','verify_schema.sql','fraud_schema.sql',
  'twofa_schema.sql','face_schema.sql','services_schema.sql','hr_schema.sql',
  'live_delivery.sql','analytics_schema.sql','analytics_precise.sql','analytics_backfill.sql',
  'harden_rls.sql',
];
const MIGS = ['0001','0002','0003','0004','0005','0006','0007','0008','0009','0010','0011',
  '0013','0014','0015','0016','0017','0018','0019','0020','0021','0022','0023'];
const migFile = (n) => {
  const map = {'0001':'0001_admin_bootstrap_secret','0002':'0002_shop_upsert_rpc','0003':'0003_orders_snapshots_rpc',
   '0004':'0004_errors_and_storage','0005':'0005_supply_chain','0006':'0006_stock_idempotent','0007':'0007_po_conserve_stock',
   '0008':'0008_orders_read_and_pricecheck','0009':'0009_order_lifecycle','0010':'0010_doc_requests','0011':'0011_device_key_hardening',
   '0013':'0013_eta_engine','0014':'0014_search','0015':'0015_finance_refunds_coupling','0016':'0016_dispatch',
   '0017':'0017_derive_identity','0018':'0018_events','0019':'0019_shop_intelligence','0020':'0020_observability',
   '0021':'0021_recommendations','0022':'0022_fraud_risk','0023':'0023_exec_dashboard'};
  return 'migrations/' + map[n] + '.sql';
};

const db = new PGlite({ extensions: { pg_trgm, pgcrypto, fuzzystrmatch } });
const log = (s) => console.log(s);

// Supabase-compatible prelude: roles + the schemas the base files reference.
const PRELUDE = `
create schema if not exists extensions;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default true, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner text, created_at timestamptz default now());
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'anon'::text $$;
`;

async function apply(label, sql) {
  try { await db.exec(sql); log(`  OK    ${label}`); return true; }
  catch (e) { log(`  FAIL  ${label}\n         └─ ${String(e.message || e).replace(/\s+/g,' ').slice(0,240)}`); return false; }
}

log('=== PRELUDE (roles + extensions/storage/auth stubs) ===');
await apply('prelude', PRELUDE);

log('\n=== BASE SCHEMA (apply once, runbook order) ===');
const baseFail = [];
for (const f of BASE) { if (!(await apply(f, rd(f)))) baseFail.push(f); }

log('\n=== MIGRATIONS (numeric order — proofs EXECUTE here) ===');
const migFail = [];
for (const n of MIGS) { if (!(await apply(n + '  ' + migFile(n).replace('migrations/',''), rd(migFile(n))))) migFail.push(n); }

log('\n=== TEST SUITES ===');
for (const t of ['tests/policy_regression.sql','tests/security_negative.sql','tests/concurrency.sql','tests/e2e_scenarios.sql']) await apply(t, rd(t));

log('\n=== DIRECT VERIFICATION (independently prove negative-authz denies) ===');
async function probe(label, sql, expect) {
  try { const r = await db.query(sql); const v = r.rows[0] ? Object.values(r.rows[0])[0] : null;
    log(`  ${String(v) === String(expect) ? 'PASS' : 'FAIL'}  ${label} → got ${v} (want ${expect})`); }
  catch (e) { log(`  ERR   ${label}: ${String(e.message).replace(/\s+/g,' ').slice(0,140)}`); }
}
await probe('to_regprocedure resolves (guards not skipping)', "select to_regprocedure('shop_order_status(text,text,text)') is not null", true);
await db.exec("delete from shop_orders where id='PROBE_V'; insert into shop_orders(id, shop_id, buyer_device, items, total, status) values ('PROBE_V', _my_shop('victimdevkey01'), 'victimdevkey01', '[]'::jsonb, 10, 'new');");
await probe('attacker CANNOT advance victim order', "select shop_order_status('PROBE_V','attackerkey999','prep')", false);
await probe('owner CAN advance own order',        "select shop_order_status('PROBE_V','victimdevkey01','prep')", true);
await probe('attacker CANNOT refund victim order', "select (refund_open('PROBE_V','attackerkey999','x')->>'ok')", 'false');

log('\n=== SUMMARY ===');
log(`base files failed: ${baseFail.length ? baseFail.join(', ') : 'none'}`);
log(`migrations failed: ${migFail.length ? migFail.join(', ') : 'NONE — all proofs passed'}`);
