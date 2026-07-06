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
