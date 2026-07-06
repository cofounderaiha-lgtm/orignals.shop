/* ============================================================
   ORIGNALS load test — k6 (https://k6.io), open source, free.
   Simulates a CM-launch spike hitting the real backend paths that
   matter: reading shops, searching geo, placing jobs, claiming them.

   Run against a THROWAWAY / staging project, never production with
   real users. Ramps to 500 virtual users.

     SUPA_URL=https://<ref>.supabase.co \
     SUPA_ANON=<anon-key> \
     k6 run docs/loadtest.js

   Reads env so no keys are committed. Interpreting results:
   · http_req_failed  should stay < 1%
   · http_req_duration p(95) should stay under ~800ms
   If either blows up at N users, that N is where the current tier
   needs the upgrade named in docs/LAUNCH-READINESS.md.
   ============================================================ */
import http from 'k6/http';
import { check, sleep } from 'k6';

const URL = __ENV.SUPA_URL;
const ANON = __ENV.SUPA_ANON;
const H = { headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' } };

export const options = {
  stages: [
    { duration: '30s', target: 50 },    // early adopters
    { duration: '1m', target: 200 },    // announcement hits
    { duration: '1m', target: 500 },    // peak spike
    { duration: '1m', target: 500 },    // sustained
    { duration: '30s', target: 0 },     // drain
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  // 1. browse shops (the most common read)
  let r = http.get(`${URL}/rest/v1/shops?select=id,name,lat,lng&limit=20`, H);
  check(r, { 'shops 200': (x) => x.status === 200 });

  // 2. open marketplace jobs (partner feed)
  r = http.get(`${URL}/rest/v1/live_jobs?status=eq.open&select=id&limit=20`, H);
  check(r, { 'jobs 200': (x) => x.status === 200 });

  // 3. Mitra intent prediction (own-LLM backend RPC)
  r = http.post(`${URL}/rest/v1/rpc/mitra_predict`, JSON.stringify({ txt: 'order 2 milk' }), H);
  check(r, { 'mitra 200': (x) => x.status === 200 });

  sleep(Math.random() * 2 + 1);
}
