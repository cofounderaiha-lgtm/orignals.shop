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

/* own-places-first address search */
async function geoSearch(q) {
  q = String(q || '').trim();
  if (q.length < 3) return [];
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
  return [...own, ...osm.filter(p => !seen.has(p.name.toLowerCase()))].slice(0, 6);
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
      <span>${p.icon || ic('pin', 17)}</span><div><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></div><em>${p.km} km</em></button>`).join('')}`);
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

/* real interactive route map: two markers + line, auto-fit */
function routeMap(elId, from, to) {
  const el = document.getElementById(elId);
  if (!el || typeof L === 'undefined' || !from || from.lat == null) return;
  try {
    if (el._map) { el._map.remove(); el._map = null; }
    const cfg = (window.ORIGNALS_CONFIG || {}).map || {};
    const map = L.map(el, { zoomControl: false, attributionControl: false, dragging: true, scrollWheelZoom: false });
    L.tileLayer(cfg.tileUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    const pin = (c) => L.divIcon({ className: '', html: `<div style="width:16px;height:16px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
    const A = [from.lat, from.lng];
    L.marker(A, { icon: pin('#1A5632') }).addTo(map);
    if (to && to.lat != null) {
      const B = [to.lat, to.lng];
      L.marker(B, { icon: pin('#C84B31') }).addTo(map);
      L.polyline([A, B], { color: '#1A5632', weight: 4, opacity: .8, dashArray: '2,8', lineCap: 'round' }).addTo(map);
      map.fitBounds([A, B], { padding: [36, 36] });
    } else {
      map.setView(A, 14);
    }
    el._map = map;
    setTimeout(() => map.invalidateSize(), 120);
  } catch (e) { console.warn('[map] render failed', e); }
}
