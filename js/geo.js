/* ============================================================
   ORIGNALS GEO — our own map infra, built the flywheel way
   ------------------------------------------------------------
   Lane 1 (now, open source): Leaflet + OpenStreetMap tiles for
   display, Nominatim for address search. Free, no keys.
   Lane 2 (ours, growing daily): every address anyone searches,
   picks or delivers to becomes a row in OUR geo_places table —
   hyperlocal Indian POI data (the kirana behind the temple, the
   blue-gate house) that no map company sells. Search hits OUR
   database first; OSM only fills the gaps. Roadmap: docs/MAPS.md
   ============================================================ */

/* geocode cache — at lakh-user scale we must NOT hammer the geocoder.
   Every query is answered from cache (memory + localStorage, 24 h TTL)
   before any network call; identical in-flight queries are deduped. */
const _geoMem = {};
let _geoInflight = {};
function _geoCacheGet(q) {
  const k = q.toLowerCase();
  if (_geoMem[k] && Date.now() - _geoMem[k].t < 864e5) return _geoMem[k].res;
  try {
    const disk = JSON.parse(localStorage.getItem('omny_geocache') || '{}');
    if (disk[k] && Date.now() - disk[k].t < 864e5) { _geoMem[k] = disk[k]; return disk[k].res; }
  } catch (e) {}
  return null;
}
function _geoCachePut(q, res) {
  const k = q.toLowerCase();
  _geoMem[k] = { t: Date.now(), res };
  try {
    const disk = JSON.parse(localStorage.getItem('omny_geocache') || '{}');
    disk[k] = _geoMem[k];
    const keys = Object.keys(disk);
    if (keys.length > 120) keys.sort((a, b) => disk[a].t - disk[b].t).slice(0, keys.length - 120).forEach(x => delete disk[x]);
    localStorage.setItem('omny_geocache', JSON.stringify(disk));
  } catch (e) {}
}

/* own-places-first address search */
async function geoSearch(q) {
  q = String(q || '').trim();
  if (q.length < 3) return [];
  const hit = _geoCacheGet(q);
  if (hit) return hit;
  if (_geoInflight[q.toLowerCase()]) return _geoInflight[q.toLowerCase()];
  const p = _geoSearchNet(q);
  _geoInflight[q.toLowerCase()] = p;
  try { return await p; } finally { delete _geoInflight[q.toLowerCase()]; }
}
async function _geoSearchNet(q) {
  let own = [];
  try {
    if (typeof CLOUD !== 'undefined' && CLOUD.on) {
      const enc = encodeURIComponent('*' + q + '*');
      own = await cloudFetch(`geo_places?select=name,sub,lat,lng,uses&or=(name.ilike.${enc},sub.ilike.${enc})&order=uses.desc&limit=4`) || [];
    }
  } catch (e) { /* own DB not installed yet — OSM covers */ }
  own = own.map(p => ({ name: p.name, sub: p.sub, lat: +p.lat, lng: +p.lng, src: 'orignals' }));

  let osm = [];
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&limit=4&q=' + encodeURIComponent(q),
      { headers: { 'Accept-Language': 'en' } });
    if (r.ok) {
      osm = (await r.json()).map(x => ({
        name: x.name || String(x.display_name).split(',')[0],
        sub: String(x.display_name).split(',').slice(1, 4).map(s => s.trim()).join(', '),
        lat: +x.lat, lng: +x.lon, src: 'osm'
      }));
    }
  } catch (e) { /* offline — own results only */ }

  const seen = new Set(own.map(p => p.name.toLowerCase()));
  const res = [...own, ...osm.filter(p => !seen.has(p.name.toLowerCase()))].slice(0, 6);
  if (res.length) _geoCachePut(q, res);
  return res;
}

/* the flywheel: every used location grows OUR places database */
function geoLog(p, kind) {
  try {
    if (typeof CLOUD === 'undefined' || !CLOUD.on || !p || !p.lat) return;
    cloudFetch('rpc/geo_touch', {
      method: 'POST',
      body: JSON.stringify({
        p_name: String(p.name).slice(0, 120), p_sub: String(p.sub || '').slice(0, 200),
        p_lat: +(+p.lat).toFixed(6), p_lng: +(+p.lng).toFixed(6),
        p_kind: kind || 'drop', p_device: S.deviceKey || 'anon'
      })
    }).catch(() => {});
  } catch (e) { /* never block UX on telemetry */ }
}

/* live search UI used inside the address picker sheet */
let _geoDeb, _geoResults = [];
function geoPickSearch(q) {
  clearTimeout(_geoDeb);
  const box = document.getElementById('geoResults');
  if (!box) return;
  if (String(q).trim().length < 3) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="foot-note sm">Searching all of India…</div>`;
  _geoDeb = setTimeout(async () => {
    _geoResults = await geoSearch(q);
    const b2 = document.getElementById('geoResults');
    if (!b2) return;
    b2.innerHTML = _geoResults.length ? _geoResults.map((p, i) => `
      <button class="place-row" onclick="geoPick(${i})">
        <span>${ic('pin', 17)}</span>
        <div><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></div>
        <em>${p.src === 'orignals' ? 'Orignals' : 'OSM'}</em>
      </button>`).join('')
      : `<div class="foot-note sm">Nothing found — try a landmark or area name.</div>`;
  }, 350);
}
function geoPick(i) {
  const p = _geoResults[i];
  if (!p) return;
  S.user.addr = { id: 'geo_' + uid(), name: p.name, sub: p.sub, icon: '⌖', km: '—', lat: p.lat, lng: p.lng };
  save(); geoLog(p, 'picked');
  closeSheet(); refreshChrome();
  toast('Delivering to ' + p.name);
  if (window._addrDone) window._addrDone();
}

/* ============================================================
   REAL geo utilities — distance, live place picker, route map
   ============================================================ */

/* haversine — real km between two {lat,lng} points */
function geoKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
/* trip km: real distance if both points geocoded, else saved-km fallback */
function tripKm(from, to, floor) {
  const real = geoKm(from, to);
  const km = real != null ? real : Math.abs((to && to.km || 0) - (from && from.km || 0));
  return Math.max(km, floor || 0.8);
}

/* reusable LIVE-SEARCH place picker — saved places + real OSM address search.
   onPick(place) receives {name, sub, lat, lng, km}. */
function placePickerSheet(title, onPick) {
  window._ppPick = onPick;
  window._ppResults = [];
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${esc(title)}</h3>
    <div class="search-row"><input id="ppSearch" placeholder="Search any address, area or landmark in India…" autocomplete="off" oninput="ppSearch(this.value)"/></div>
    <div id="ppResults"></div>
    <button class="place-row gps" onclick="ppUseGPS()"><span class="gps-ic">${ic('pin', 18)}</span>
      <div><b>Use my current location</b><small>Live GPS</small></div><em>Locate</em></button>
    <div class="foot-note sm" style="text-align:left;margin:8px 0 4px">Saved places</div>
    ${DB.places.map((p, i) => `<button class="place-row" onclick="ppChoose(${i})">
      <span>${ic(p.id === 'home' ? 'home' : p.id === 'work' ? 'chart' : 'pin', 17)}</span><div><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></div><em>${p.km} km</em></button>`).join('')}`);
  setTimeout(() => { const el = document.getElementById('ppSearch'); if (el) el.focus(); }, 60);
}
function ppChoose(i) {
  const p = DB.places[i];
  closeSheet();
  if (window._ppPick) window._ppPick({ name: p.name, sub: p.sub, lat: p.lat, lng: p.lng, km: p.km, icon: p.icon });
}
let _ppDeb;
function ppSearch(q) {
  clearTimeout(_ppDeb);
  const box = document.getElementById('ppResults');
  if (!box) return;
  if (String(q).trim().length < 3) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="foot-note sm">Searching…</div>`;
  _ppDeb = setTimeout(async () => {
    const res = await geoSearch(q);
    window._ppResults = res;
    const b2 = document.getElementById('ppResults');
    if (!b2) return;
    b2.innerHTML = res.length ? res.map((p, i) => `
      <button class="place-row" onclick="ppChooseResult(${i})">
        <span>${ic('pin', 17)}</span><div><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></div>
        <em>${p.src === 'orignals' ? 'Orignals' : 'Map'}</em></button>`).join('')
      : `<div class="foot-note sm">No match — try an area or landmark name.</div>`;
  }, 350);
}
function ppChooseResult(i) {
  const p = window._ppResults[i];
  if (!p) return;
  geoLog(p, 'picked');
  closeSheet();
  if (window._ppPick) window._ppPick({ name: p.name, sub: p.sub, lat: p.lat, lng: p.lng, km: null });
}
function ppUseGPS() {
  if (!navigator.geolocation) { toast('GPS not available on this device'); return; }
  toast('Locating you…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    let name = 'Current location', sub = lat.toFixed(4) + ', ' + lng.toFixed(4);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } });
      if (r.ok) { const d = await r.json(); if (d.display_name) { name = String(d.display_name).split(',')[0]; sub = String(d.display_name).split(',').slice(1, 4).join(',').trim(); } }
    } catch (e) {}
    closeSheet();
    if (window._ppPick) window._ppPick({ name, sub, lat, lng, km: null });
  }, () => toast('Could not get your location — pick manually'), { enableHighAccuracy: true, timeout: 8000 });
}

/* ---------- open-source tile engine with automatic failover ----------
   No paid map vendor. We rotate across public open-source tile servers:
   if one throttles or fails (6+ tile errors), the layer silently switches
   to the next source and the working choice is remembered on-device. */
function omTileSources() {
  const cfg = (window.ORIGNALS_CONFIG || {}).map || {};
  if (Array.isArray(cfg.tileUrls) && cfg.tileUrls.length) return cfg.tileUrls;
  if (cfg.tileUrl) return [cfg.tileUrl];
  return ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
}
function omTileLayer(map) {
  const srcs = omTileSources();
  let idx = Math.min(parseInt(localStorage.getItem('omny_tilesrc') || '0', 10) || 0, srcs.length - 1);
  const layer = L.tileLayer(srcs[idx], { maxZoom: 19 });
  let errs = 0;
  layer.on('tileerror', () => {
    errs++;
    if (errs >= 6 && idx < srcs.length - 1) {
      idx++; errs = 0;
      layer.setUrl(srcs[idx]);
      try { localStorage.setItem('omny_tilesrc', String(idx)); } catch (e) {}
      console.warn('[map] tile source failed over to', srcs[idx]);
    }
  });
  layer.on('load', () => { errs = 0; });
  layer.addTo(map);
  return layer;
}

/* real road-routing via open-source OSRM — returns the actual driving
   path geometry [[lat,lng]...] + distance(km) + duration(min). Cached. */
const _routeCache = {};
async function roadRoute(from, to) {
  if (!from || !to || from.lat == null || to.lat == null) return null;
  const key = [from.lat.toFixed(4), from.lng.toFixed(4), to.lat.toFixed(4), to.lng.toFixed(4)].join(',');
  if (_routeCache[key]) return _routeCache[key];
  try {
    const url = 'https://router.project-osrm.org/route/v1/driving/' +
      from.lng + ',' + from.lat + ';' + to.lng + ',' + to.lat + '?overview=full&geometries=geojson';
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const rt = d.routes && d.routes[0];
    if (!rt) return null;
    const out = { path: rt.geometry.coordinates.map(c => [c[1], c[0]]), km: rt.distance / 1000, min: Math.round(rt.duration / 60) };
    _routeCache[key] = out;
    return out;
  } catch (e) { return null; }
}

/* open turn-by-turn navigation in the device's map app (Google Maps →
   geo: fallback). Works on phone (partner navigating) and desktop. */
function navTo(lat, lng, label) {
  if (lat == null) { toast('No location to navigate to'); return; }
  const g = 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=driving';
  try { window.open(g, '_blank'); } catch (e) { location.href = 'geo:' + lat + ',' + lng + '?q=' + lat + ',' + lng + '(' + encodeURIComponent(label || 'Destination') + ')'; }
}

/* real interactive route map: markers + ACTUAL ROAD PATH (OSRM), auto-fit.
   Draws a straight line instantly, then swaps in the real road route. */
function routeMap(elId, from, to) {
  const el = document.getElementById(elId);
  if (!el || typeof L === 'undefined' || !from || from.lat == null) return;
  try {
    if (el._map) { el._map.remove(); el._map = null; }
    const map = L.map(el, { zoomControl: false, attributionControl: false, dragging: true, scrollWheelZoom: false });
    omTileLayer(map);
    const pin = (c) => L.divIcon({ className: '', html: `<div style="width:16px;height:16px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
    const A = [from.lat, from.lng];
    L.marker(A, { icon: pin('#1A5632') }).addTo(map);
    if (to && to.lat != null) {
      const B = [to.lat, to.lng];
      L.marker(B, { icon: pin('#C84B31') }).addTo(map);
      /* instant straight hint, replaced by the real road route below */
      let line = L.polyline([A, B], { color: '#1A5632', weight: 3, opacity: .35, dashArray: '2,8' }).addTo(map);
      map.fitBounds([A, B], { padding: [36, 36] });
      roadRoute(from, to).then(rt => {
        if (!rt || !el._map) return;
        map.removeLayer(line);
        L.polyline(rt.path, { color: '#1A5632', weight: 5, opacity: .85, lineCap: 'round', lineJoin: 'round' }).addTo(map);
        map.fitBounds(rt.path, { padding: [30, 30] });
      });
    } else {
      map.setView(A, 14);
    }
    el._map = map;
    setTimeout(() => map.invalidateSize(), 120);
  } catch (e) { console.warn('[map] render failed', e); }
}

/* ============================================================
   LIVE TRACKING GEO — real coordinates + moving courier
   ============================================================ */

/* geodesic destination point: real position `km` away at `bearing`° */
function geoDest(lat, lng, km, bearing) {
  const R = 6371, r = Math.PI / 180, br = bearing * r, d = km / R;
  const la1 = lat * r, lo1 = lng * r;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: la2 / r, lng: lo2 / r };
}

/* every shop gets a stable real position: its true km from the user's
   base at a bearing derived from its id (until the shop pins its own GPS) */
function shopLatLng(s) {
  if (!s) return null;
  if (s.lat != null) return { lat: +s.lat, lng: +s.lng };
  let h = 0; const id = String(s.id);
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const base = DB.places[0];
  return geoDest(base.lat, base.lng, Math.max(+s.km || 0.5, 0.2), h % 360);
}

/* resolve an order's route endpoints (stored at creation, or derived) */
function orderGeo(o) {
  if (o.geo && o.geo.from && o.geo.from.lat != null && o.geo.to && o.geo.to.lat != null) return o.geo;
  const to = (S.user.addr && S.user.addr.lat != null) ? { lat: +S.user.addr.lat, lng: +S.user.addr.lng }
    : { lat: DB.places[0].lat, lng: DB.places[0].lng };
  if (o.shopId) { const s = findShop(o.shopId); const f = shopLatLng(s); if (f) return { from: f, to }; }
  return null;
}

/* continuous 0→1 journey progress from real elapsed time */
function orderProg(o) {
  const times = (typeof orderTimes === 'function') ? orderTimes(o) : FLOW_T[o.flow];
  return Math.min((Date.now() - o.placedAt) / 1000 / times[times.length - 1], 1);
}

/* live tracking map: built once per stage, courier marker moves every tick */
function trackLiveMap(elId, o) {
  const el = document.getElementById(elId);
  if (!el || typeof L === 'undefined') return;
  const g = orderGeo(o);
  if (!g) return;
  const prog = o.cancelled ? 0 : orderProg(o);
  const A = [g.from.lat, g.from.lng], B = [g.to.lat, g.to.lng];
  /* if the REAL partner is sharing live GPS, put the courier THERE;
     otherwise fall back to time-based interpolation */
  const cur = (o.partnerLive && o.partnerLive.lat != null)
    ? [o.partnerLive.lat, o.partnerLive.lng]
    : [A[0] + (B[0] - A[0]) * prog, A[1] + (B[1] - A[1]) * prog];
  try {
    if (el._map && el._courier) { el._courier.setLatLng(cur); return; }
    if (el._map) { el._map.remove(); el._map = null; }
    const map = L.map(el, { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
    omTileLayer(map);
    const pin = (c) => L.divIcon({ className: '', html: `<div style="width:15px;height:15px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`, iconSize: [15, 15], iconAnchor: [8, 8] });
    L.marker(A, { icon: pin('#1A5632') }).addTo(map);
    L.marker(B, { icon: pin('#C84B31') }).addTo(map);
    L.polyline([A, B], { color: '#1A5632', weight: 4, opacity: .75, dashArray: '2,8', lineCap: 'round' }).addTo(map);
    const courierIc = L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
      html: `<div style="width:34px;height:34px;border-radius:50%;background:#1A5632;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff">${typeof ic === 'function' ? ic(o.kind === 'ride' ? 'bike' : 'package', 16) : ''}</div>` });
    el._courier = L.marker(cur, { icon: courierIc, zIndexOffset: 900 }).addTo(map);
    map.fitBounds([A, B], { padding: [40, 40] });
    el._map = map;
    setTimeout(() => map.invalidateSize(), 120);
  } catch (e) { console.warn('[track map] failed', e); }
}
