/* ============================================================
   ORIGNALS ANALYTICS (client) — first-party, privacy-owned.
   Fires a lightweight beacon on every page + a 20s heartbeat so
   the admin sees live visitors. Precise geo is added server-side by
   /api/track (Vercel edge headers); if that's unreachable we fall
   back to a direct RPC with a coarse timezone country. Anonymous
   device key only — no third-party tracker, no cookies, no PII.
   ============================================================ */
const ANA = { session: null, started: false, hb: null, lastPage: null };

function anaOn() { return typeof CLOUD !== 'undefined' && CLOUD.on; }
function anaSession() {
  if (ANA.session) return ANA.session;
  try {
    let s = sessionStorage.getItem('ana_sess');
    if (!s) { s = (S.deviceKey || 'd') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); sessionStorage.setItem('ana_sess', s); }
    ANA.session = s;
  } catch (e) { ANA.session = 'sess-' + Date.now(); }
  return ANA.session;
}
function anaDeviceType() {
  const w = window.innerWidth || 1024, ua = navigator.userAgent || '';
  if (/iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/.test(ua) || w < 640) return 'mobile';
  return 'desktop';
}
function anaRole() {
  if (window.__isStaff) return 'staff';
  try { if (S.partner && (S.mode === 'earn' || S.activeJob)) return 'partner'; } catch (e) {}
  const a = (typeof authState === 'function') ? authState() : null;
  if (a && a.token) return 'buyer';
  return (typeof isGuest === 'function' && isGuest()) ? 'guest' : 'buyer';
}
function anaCoarseCountry() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (/Kolkata|Calcutta/.test(tz)) return 'IN';
    return ((navigator.language || '').split('-')[1] || '').toUpperCase();
  } catch (e) { return ''; }
}
function anaCoords() {
  try { const a = S.user && S.user.addr; if (a && a.lat != null && a.lng != null) return { lat: +a.lat, lng: +a.lng }; } catch (e) {}
  return { lat: null, lng: null };
}
function anaRefHost() {
  try { return document.referrer ? new URL(document.referrer).host : ''; } catch (e) { return ''; }
}
function anaSend(kind, name, val) {
  if (!anaOn()) return;
  const c = anaCoords();
  const payload = {
    device: S.deviceKey || 'anon', session: anaSession(), kind: kind, name: name || '',
    ref: (!ANA.started && kind === 'page') ? anaRefHost() : '',
    role: anaRole(), uad: anaDeviceType(), lang: navigator.language || '',
    lat: c.lat, lng: c.lng, val: (val == null ? null : +val)
  };
  if (kind === 'page') ANA.started = true;
  try {
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true })
      .then(r => { if (!r.ok) throw 0; }).catch(() => anaDirect(payload));
  } catch (e) { anaDirect(payload); }
}
function anaDirect(p) {
  if (typeof cloudFetch !== 'function') return;
  const b = {
    p_device: p.device, p_session: p.session, p_kind: p.kind, p_name: p.name, p_ref: p.ref,
    p_role: p.role, p_uad: p.uad, p_lang: p.lang, p_country: anaCoarseCountry(), p_region: '', p_city: '',
    p_lat: p.lat, p_lng: p.lng, p_val: p.val
  };
  cloudFetch('rpc/track_hit', { method: 'POST', body: JSON.stringify(b) }).catch(() => {});
}
function trackPage(name) {
  ANA.lastPage = name || 'home';
  anaSend('page', ANA.lastPage);
  anaHeartbeat();
}
function trackEvent(name, val) { anaSend('event', name, val); }
function anaHeartbeat() {
  clearInterval(ANA.hb);
  ANA.hb = setInterval(() => { if (document.visibilityState === 'visible') anaSend('ping', ANA.lastPage || ''); }, 20000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ANA.started) anaSend('ping', ANA.lastPage || ''); });
