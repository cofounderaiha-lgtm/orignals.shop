/* Vercel serverless function — /api/track
   Enriches an anonymous analytics beacon with request geography
   (country / region / city / lat / lng from Vercel edge headers, which
   are present on every plan) and forwards it to Supabase via a PUBLIC
   RPC using the PUBLIC anon key. No secrets live here. City-precise,
   no GPS prompt, no PII. */
const SUPA = 'https://wvprqdfhjcammghjwoqj.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHJxZGZoamNhbW1naGp3b3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyOTU4MDksImV4cCI6MjA5ODg3MTgwOX0.kPSSYOde8j_G5pQ-8vOQvn5NnGjAOjXsTpsMXkqhMW4';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    const h = req.headers || {};
    const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
    const dec = v => { try { return decodeURIComponent(v || ''); } catch (e) { return v || ''; } };
    const body = {
      p_device: String(b.device || '').slice(0, 64),
      p_session: String(b.session || '').slice(0, 64),
      p_kind: ['page', 'ping', 'event'].includes(b.kind) ? b.kind : 'page',
      p_name: String(b.name || '').slice(0, 120),
      p_ref: String(b.ref || '').slice(0, 120),
      p_role: String(b.role || '').slice(0, 16),
      p_uad: String(b.uad || '').slice(0, 12),
      p_lang: String(b.lang || '').slice(0, 12),
      p_country: String(h['x-vercel-ip-country'] || '').slice(0, 4),
      p_region: String(h['x-vercel-ip-country-region'] || '').slice(0, 64),
      p_city: dec(h['x-vercel-ip-city']).slice(0, 80),
      p_lat: num(h['x-vercel-ip-latitude']) != null ? num(h['x-vercel-ip-latitude']) : (b.lat != null ? Number(b.lat) : null),
      p_lng: num(h['x-vercel-ip-longitude']) != null ? num(h['x-vercel-ip-longitude']) : (b.lng != null ? Number(b.lng) : null),
      p_val: (b.val == null ? null : Number(b.val))
    };
    await fetch(SUPA + '/rest/v1/rpc/track_hit', {
      method: 'POST',
      headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    res.status(204).end();
  } catch (e) { res.status(204).end(); }
};
