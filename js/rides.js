/* ============================================================
   RIDES — solo or shared, end-to-end, CV-verified both sides
   ============================================================ */

let RIDE = null;
function rideReset() { RIDE = { from: DB.places[0], to: null, veh: null, share: false, when: 'now' }; }
function rideTimes() {
  const out = [], now = new Date();
  for (let i = 1; i <= 8; i++) { const d = new Date(now.getTime() + i * 30 * 60000); out.push(d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })); }
  return out;
}

view('ride', () => { if (!RIDE || RIDE.done) rideReset(); renderRide(); });

function renderRide() {
  const km = RIDE.to ? tripKm(RIDE.from, RIDE.to, 1.2) : 0;
  const rideVehicles = DB.vehicles.filter(v => v.ride);
  const mult = RIDE.share ? 0.72 : 1;

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>Book a ride</h1><small>CV-verified captains near ${esc(RIDE.from.name)} · fixed fare, no surge</small></div></div>

  <div class="ride-map"><div id="rideMap" class="route-canvas full"></div>
    ${RIDE.to ? `<div class="eta-pill">${km.toFixed(1)} km · ~${Math.round(km * 3 + 4)} min</div>` : ''}
  </div>

  <div class="pin-box">
    <div class="pin-row" onclick="ridePickPlace('from')">
      <i class="pin g"></i><div><small>PICKUP</small><b>${esc(RIDE.from.name)}</b><span>${esc(RIDE.from.sub)}</span></div><em>Change</em></div>
    <div class="pin-join"><button class="swap" onclick="rideSwap()" title="Swap">${ic('swap', 14)}</button></div>
    <div class="pin-row" onclick="ridePickPlace('to')">
      <i class="pin r"></i><div><small>DROP</small><b>${RIDE.to ? esc(RIDE.to.name) : 'Where to?'}</b><span>${RIDE.to ? esc(RIDE.to.sub) : 'Tap to choose destination'}</span></div><em>${RIDE.to ? 'Change' : 'Select'}</em></div>
  </div>

  ${RIDE.to ? `
  <div class="when-seg">
    <button class="${RIDE.when === 'now' ? 'on' : ''}" onclick="RIDE.when='now';renderRide()">${ic('bike', 14)} Ride now</button>
    <button class="${RIDE.when !== 'now' ? 'on' : ''}" onclick="RIDE.when=RIDE.when==='now'?rideTimes()[1]:RIDE.when;renderRide()">${ic('clock', 14)} Schedule</button>
  </div>
  ${RIDE.when !== 'now' ? `<div class="chip-row" style="margin:0 0 8px">${rideTimes().map(t => `<button class="chip ${RIDE.when === t ? 'on' : ''}" onclick="RIDE.when='${t}';renderRide()">${t}</button>`).join('')}</div>` : ''}
  <label class="agree-row slim ${RIDE.share ? 'on' : ''}" onclick="RIDE.share=!RIDE.share;renderRide()">
    <i>${RIDE.share ? '✓' : ''}</i><span><b>Share my ride — save ~28%</b> · a CV-verified co-rider on the same route may join</span></label>
  <div class="sec-head"><h2>Choose your ride</h2></div>
  ${rideVehicles.map(v => {
    const fare = Math.round(kmFare(v, km) * mult);
    return `<button class="veh-row ${RIDE.veh === v.id ? 'on' : ''}" onclick="RIDE.veh='${v.id}';renderRide()">
      <span class="veh-emoji">${vehIcon(v.id, 26)}</span>
      <div><b>${v.name} <small>· ${v.seats} seat${v.seats > 1 ? 's' : ''}</small></b><small>${v.desc}</small><small class="ok">${RIDE.when === 'now' ? (v.eta + rnd(0, 2)) + ' min away · face-verified captain' : 'Scheduled for ' + RIDE.when + ' · face-verified captain'}</small></div>
      <em>${money(fare)}${RIDE.share ? '<small class="ok"> shared</small>' : ''}</em></button>`;
  }).join('')}
  ${RIDE.veh ? `<button class="btn-main wide" onclick="rideCheckout(${km})">${RIDE.when === 'now' ? 'Book' : 'Schedule'} ${DB.vehicles.find(v => v.id === RIDE.veh).name} · ${money(Math.round(kmFare(DB.vehicles.find(v => v.id === RIDE.veh), km) * mult))}</button>` : ''}
  <div class="foot-note">${ic('shield', 12)} Captain, co-rider &amp; the exact vehicle are all CV-verified before every trip. Coupon RIDE25 works above ₹99.</div>`
  : `
  <div class="sec-head"><h2>Popular drops</h2></div>
  ${DB.places.slice(1, 6).map((p, idx) => `<button class="place-row" onclick="RIDE.to=DB.places[${idx + 1}];renderRide()">
    <span>${ic('pin', 17)}</span><div><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></div><em>${p.km} km</em></button>`).join('')}`}`;
  if (document.getElementById('rideMap')) routeMap('rideMap', RIDE.from, RIDE.to);
}

function rideSwap() { if (!RIDE.to) return; const t = RIDE.from; RIDE.from = RIDE.to; RIDE.to = t; renderRide(); }
function ridePickPlace(which) {
  placePickerSheet(which === 'from' ? 'Pickup point' : 'Drop point', (p) => { RIDE[which] = p; renderRide(); });
}

function rideCheckout(km) {
  const v = DB.vehicles.find(x => x.id === RIDE.veh);
  const mult = RIDE.share ? 0.72 : 1;
  const fare = Math.round(kmFare(v, km) * mult);
  const sched = RIDE.when !== 'now';
  /* transparent, statutory breakdown — GST on rides is 5% (cab aggregator),
     plus a 3% platform/convenience fee that already absorbs the gateway cost */
  const gst = Math.round(fare * 0.05);
  const platform = Math.round(fare * 0.03);
  const grand = fare + gst + platform;
  const lines = [['Base fare', v.base], ['Distance (' + km.toFixed(1) + ' km × ' + money(v.perKm) + ')', Math.round(kmFare(v, km)) - v.base],
    ...(RIDE.share ? [['Ride-share saving', -(Math.round(kmFare(v, km)) - fare)]] : []), ['GST (5%)', gst], ['Platform fee (3%)', platform]];
  /* SAFETY (2026-08-11): rides take NO online prepayment. Real-time captain
     dispatch is not yet guaranteed (see COMPLETION-ASSESSMENT §J — no dispatch
     engine), so charging up front would be charging for a ride that may not be
     matched. You pay the captain DIRECTLY at the end (cash / UPI). Booking posts
     a REAL job to nearby captains via the same live_jobs feed a Send parcel uses,
     so a real captain can claim it — no fabricated payment. */
  sheet(`
    <div class="sheet-grab"></div>
    <div class="ck-head"><span class="ck-ic">${ic('bike', 22)}</span>
      <div><b>${esc(v.name)} to ${esc(RIDE.to.name)}</b><small>${esc(RIDE.from.name)} → ${esc(RIDE.to.name)} · ${km.toFixed(1)} km · ${sched ? 'scheduled ' + esc(RIDE.when) : (RIDE.share ? 'shared' : 'solo')}</small></div></div>
    <div class="ck-bill">
      ${lines.map(l => `<div class="ck-line"><span>${esc(l[0])}</span><span>${money(l[1])}</span></div>`).join('')}
      <div class="ck-line grand"><span>Estimated fare</span><span>${money(grand)}</span></div>
    </div>
    <div class="foot-note sm" style="text-align:left">${ic('shield', 12)} You pay the captain directly at the end of the trip (cash / UPI). <b>No money is taken now.</b> We post your ride to verified captains near ${esc(RIDE.from.name)} — fare is an estimate and settles on the metered distance.</div>
    <button class="btn-main wide" onclick="rideBook(${km},${grand},${fare},${sched ? 1 : 0})">${sched ? 'Schedule ride' : 'Confirm — find my captain'}</button>`);
}
function rideBook(km, grand, fare, sched) {
  const v = DB.vehicles.find(x => x.id === RIDE.veh);
  closeSheet();
  if (sched) {
    /* scheduled ride: confirmed for later, not tracked live now */
    if (!S.scheduled) S.scheduled = [];
    const sid = 'RD' + uidStrong().slice(0, 10);
    S.scheduled.unshift({ id: sid, title: v.name + ' to ' + RIDE.to.name, when: RIDE.when, from: RIDE.from.name, to: RIDE.to.name, km: +km.toFixed(1), total: grand, ts: Date.now() });
    save(); confettiBurst();
    notify('Ride scheduled', `${v.name} to ${RIDE.to.name} at ${RIDE.when}. A captain is matched near the time — you pay them directly at the end.`);
    toast('Ride scheduled for ' + RIDE.when);
    RIDE.done = true; go('orders');
    return;
  }
  const title = v.name + ' to ' + RIDE.to.name + (RIDE.share ? ' (shared)' : '');
  const geo = (RIDE.from.lat != null && RIDE.to.lat != null) ? { from: { lat: +RIDE.from.lat, lng: +RIDE.from.lng }, to: { lat: +RIDE.to.lat, lng: +RIDE.to.lng } } : undefined;
  const o = createOrder({
    kind: 'ride', flow: 'ride', km, payMethod: 'cod',
    geo, title, total: grand,
    detail: `${RIDE.from.name} → ${RIDE.to.name} · ${km.toFixed(1)} km${RIDE.share ? ' · shared' : ''}`,
    items: [{ name: v.name + ' ride · ' + km.toFixed(1) + ' km', q: 1, price: grand }]
  });
  /* post a REAL job so a nearby captain can actually claim this ride */
  if (typeof cloudPostJob === 'function') cloudPostJob({
    id: o.id, jtype: 'ride', what: v.name + ' ride · ' + km.toFixed(1) + ' km',
    from_name: RIDE.from.name, to_name: RIDE.to.name,
    from_lat: RIDE.from.lat, from_lng: RIDE.from.lng, to_lat: RIDE.to.lat, to_lng: RIDE.to.lng,
    km: +km.toFixed(1), pay: fare, order_ref: o.id
  });
  RIDE.done = true; confettiBurst();
  go('track/' + o.id);
}
