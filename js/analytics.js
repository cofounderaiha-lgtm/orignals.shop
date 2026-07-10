/* ============================================================
   ORIGNALS ANALYTICS (client) — first-party, privacy-owned.
   Fires a lightweight beacon on every page + a 20s heartbeat so
   the admin sees live visitors. Precise geo is added server-side by
   /api/track (Vercel edge headers); if that's unreachable we fall
   back to a direct RPC with a coarse timezone country. Anonymous
   device key only — no third-party tracker, no cookies, no PII.
   ============================================================ */
const ANA = { session: null, started: false, hb: null, lastPage: null, coords: null, located: false };

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
  if (ANA.coords) return ANA.coords;   // exact GPS captured this session
  try { const a = S.user && S.user.addr; if (a && a.lat != null && a.lng != null) return { lat: +a.lat, lng: +a.lng }; } catch (e) {}
  return { lat: null, lng: null };
}
/* exact location — ONLY if the visitor already granted geolocation (e.g. for
   delivery). We never fire a fresh prompt just to track; that would be rude. */
function anaLocate() {
  if (!navigator.geolocation) return;
  const grab = () => navigator.geolocation.getCurrentPosition(
    p => { ANA.coords = { lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }; },
    () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 });
  try {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(st => { if (st.state === 'granted') grab(); }).catch(() => {});
    }
  } catch (e) {}
}
function anaBrowser() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/CriOS|Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}
/* reverse-geocode the exact coords to a human locality (e.g. "IIT Guwahati,
   Kamrup") ONCE per session, cached. Only runs when we already have precise
   coords (GPS granted or a saved address) — never triggers a location prompt. */
function anaLocality() {
  if (ANA.place) return ANA.place;
  try { const s = sessionStorage.getItem('ana_place'); if (s) { ANA.place = s; return s; } } catch (e) {}
  const c = anaCoords();
  if (c.lat == null || ANA._revTried) return '';
  ANA._revTried = true;
  try {
    fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=' + c.lat + '&lon=' + c.lng, { headers: { Accept: 'application/json' } })
      .then(r => r.json()).then(d => {
        const a = d.address || {};
        const local = a.neighbourhood || a.suburb || a.village || a.hamlet || a.town || a.city_district || a.road || '';
        const city = a.city || a.town || a.county || a.state_district || '';
        const place = [local, city].filter(Boolean).join(', ') || d.name || '';
        if (place) { ANA.place = place.slice(0, 120); try { sessionStorage.setItem('ana_place', ANA.place); } catch (e) {} }
      }).catch(() => {});
  } catch (e) {}
  return '';
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
    lat: c.lat, lng: c.lng, val: (val == null ? null : +val),
    place: anaLocality(), browser: anaBrowser()
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
    p_role: p.role, p_uad: p.uad, p_lang: p.lang, p_country: anaCoarseCountry(), p_region: '', p_city: p.place || '',
    p_lat: p.lat, p_lng: p.lng, p_val: p.val, p_place: p.place || '', p_browser: p.browser || ''
  };
  cloudFetch('rpc/track_hit', { method: 'POST', body: JSON.stringify(b) }).catch(() => {});
}
function trackPage(name) {
  if (!ANA.located) { ANA.located = true; anaLocate(); }   // grab exact coords once, if already permitted
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
