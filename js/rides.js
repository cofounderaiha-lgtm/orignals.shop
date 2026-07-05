/* ============================================================
   RIDES — solo or shared, end-to-end, CV-verified both sides
   ============================================================ */

let RIDE = null;
function rideReset() { RIDE = { from: DB.places[0], to: null, veh: null, share: false }; }

view('ride', () => { if (!RIDE || RIDE.done) rideReset(); renderRide(); });

function renderRide() {
  const km = RIDE.to ? Math.max(Math.abs(RIDE.to.km - RIDE.from.km), 1.2) : 0;
  const rideVehicles = DB.vehicles.filter(v => v.ride);
  const mult = RIDE.share ? 0.72 : 1;

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>Book a ride</h1><small>CV-verified captains near ${esc(RIDE.from.name)} · fixed fare, no surge</small></div></div>

  <div class="ride-map">
    <svg viewBox="0 0 400 170">
      ${[0,1,2,3,4,5].map(i => `<line x1="${i*80}" y1="0" x2="${i*80}" y2="170" class="grid"/>`).join('')}
      ${[0,1,2].map(i => `<line x1="0" y1="${i*85}" x2="400" y2="${i*85}" class="grid"/>`).join('')}
      ${RIDE.to ? `<path d="M60 130 C 150 130, 160 40, 250 40 S 340 90, 350 55" class="route"/>` : ''}
      <circle cx="60" cy="130" r="7" fill="#1A5632"/>
      ${RIDE.to ? `<circle cx="350" cy="55" r="7" fill="#C84B31"/>` : ''}
      ${[[110, 60], [210, 120], [300, 100], [160, 30]].map(m => `<g class="cab-float" transform="translate(${m[0]},${m[1]})"><circle r="10" fill="#1A5632" opacity=".9"/>${icNested('bike', 11)}</g>`).join('')}
    </svg>
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
  <label class="agree-row slim ${RIDE.share ? 'on' : ''}" onclick="RIDE.share=!RIDE.share;renderRide()">
    <i>${RIDE.share ? '✓' : ''}</i><span><b>Share my ride — save ~28%</b> · a CV-verified co-rider on the same route may join</span></label>
  <div class="sec-head"><h2>Choose your ride</h2></div>
  ${rideVehicles.map(v => {
    const fare = Math.round(kmFare(v, km) * mult);
    return `<button class="veh-row ${RIDE.veh === v.id ? 'on' : ''}" onclick="RIDE.veh='${v.id}';renderRide()">
      <span class="veh-emoji">${vehIcon(v.id, 26)}</span>
      <div><b>${v.name} <small>· ${v.seats} seat${v.seats > 1 ? 's' : ''}</small></b><small>${v.desc}</small><small class="ok">${v.eta + rnd(0, 2)} min away · face-verified captain</small></div>
      <em>${money(fare)}${RIDE.share ? '<small class="ok"> shared</small>' : ''}</em></button>`;
  }).join('')}
  ${RIDE.veh ? `<button class="btn-main wide" onclick="rideCheckout(${km})">Book ${DB.vehicles.find(v => v.id === RIDE.veh).name} · ${money(Math.round(kmFare(DB.vehicles.find(v => v.id === RIDE.veh), km) * mult))}</button>` : ''}
  <div class="foot-note">${ic('shield', 12)} Captain, co-rider &amp; the exact vehicle are all CV-verified before every trip. Coupon RIDE25 works above ₹99.</div>`
  : `
  <div class="sec-head"><h2>Popular drops</h2></div>
  ${DB.places.slice(1, 6).map((p, idx) => `<button class="place-row" onclick="RIDE.to=DB.places[${idx + 1}];renderRide()">
    <span>${ic('pin', 17)}</span><div><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></div><em>${p.km} km</em></button>`).join('')}`}`;
}

function rideSwap() { if (!RIDE.to) return; const t = RIDE.from; RIDE.from = RIDE.to; RIDE.to = t; renderRide(); }
function ridePickPlace(which) {
  window._rideWhich = which;
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${which === 'from' ? 'Pickup point' : 'Drop point'}</h3>
    ${DB.places.map((p, i) => `<button class="place-row" onclick="RIDE[window._rideWhich]=DB.places[${i}];closeSheet();renderRide()">
      <span>${ic('pin', 17)}</span><div><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></div><em>${p.km} km</em></button>`).join('')}`);
}

function rideCheckout(km) {
  const v = DB.vehicles.find(x => x.id === RIDE.veh);
  const mult = RIDE.share ? 0.72 : 1;
  const fare = Math.round(kmFare(v, km) * mult);
  checkoutSheet({
    title: v.name + ' to ' + RIDE.to.name, icon: 'bike',
    meta: `${RIDE.from.name} → ${RIDE.to.name} · ${km.toFixed(1)} km · ${RIDE.share ? 'shared ride' : 'solo'} · fixed fare`,
    lines: [['Base fare', v.base], ['Distance (' + km.toFixed(1) + ' km × ' + money(v.perKm) + ')', Math.round(kmFare(v, km)) - v.base], ...(RIDE.share ? [['Ride-share saving', -(Math.round(kmFare(v, km)) - fare)]] : [])],
    total: fare,
    onPay: (final) => {
      const o = createOrder({
        kind: 'ride', flow: 'ride',
        title: v.name + ' to ' + RIDE.to.name + (RIDE.share ? ' (shared)' : ''),
        total: final,
        detail: `${RIDE.from.name} → ${RIDE.to.name} · ${km.toFixed(1)} km${RIDE.share ? ' · shared' : ''}`,
        items: [{ name: v.name + ' ride · ' + km.toFixed(1) + ' km', q: 1, price: final }]
      });
      RIDE.done = true;
      go('track/' + o.id);
    }
  });
}
