/* ============================================================
   SEND ANYTHING — tiffin box to truck-load, carried by a
   CV-verified partner already passing nearby
   ============================================================ */

let SEND = null;
function sendReset() {
  SEND = { step: 1, type: null, from: DB.places[0], to: null, note: '', when: 'now', vehicle: null };
}

view('send', () => { if (!SEND || SEND.done) sendReset(); renderSend(); });

function suggestVehicles(typeId, km) {
  const pt = DB.parcelTypes.find(p => p.id === typeId);
  return DB.vehicles.filter(v => pt.fits.includes(v.id) && v.maxKm >= km);
}
function sendFare(v, km) {
  if (v.id === 'walk') return Math.max(20, Math.round(12 * km));
  if (v.id === 'cycle') return Math.max(25, Math.round(14 * km));
  return Math.round(kmFare(v, km));
}

function renderSend() {
  const st = SEND.step;
  const km = SEND.to ? tripKm(SEND.from, SEND.to, 0.8) : 0;

  let body = '';
  if (st === 1) body = `
    <div class="wiz-q">What are you sending?</div>
    <div class="ptype-grid">
      ${DB.parcelTypes.map(p => `<button class="ptype ${SEND.type === p.id ? 'on' : ''}" onclick="SEND.type='${p.id}';SEND.step=2;renderSend()">
        <span>${parcelIcon(p.id, 26)}</span><b>${p.name}</b></button>`).join('')}
    </div>
    <div class="tip-strip">The old neighbour way — "take this to them". A verified partner passing by carries it, and earns. Or does it free, as seva.</div>`;

  if (st === 2) body = `
    <div class="wiz-q">Pickup &amp; drop</div>
    <div class="pin-box">
      <div class="pin-row" onclick="sendPickPlace('from')">
        <i class="pin g"></i><div><small>PICKUP FROM</small><b>${esc(SEND.from.name)}</b><span>${esc(SEND.from.sub)}</span></div><em>Change</em></div>
      <div class="pin-join"></div>
      <div class="pin-row" onclick="sendPickPlace('to')">
        <i class="pin r"></i><div><small>DELIVER TO</small><b>${SEND.to ? esc(SEND.to.name) : 'Choose drop point'}</b><span>${SEND.to ? esc(SEND.to.sub) : 'Tap to select'}</span></div><em>${SEND.to ? 'Change' : 'Select'}</em></div>
    </div>
    ${SEND.to ? `<div class="route-live"><div id="sendMap" class="route-canvas"></div><div class="route-fig">${km.toFixed(1)} km · ~${Math.round(km * 3 + 5)} min</div></div>` : ''}
    <input class="txt" id="sendNote" placeholder="Note for the partner — e.g. 'warm tiffin, deliver before 1 pm'" value="${esc(SEND.note)}" oninput="SEND.note=this.value"/>
    <div class="seg-row">
      <button class="seg ${SEND.when === 'now' ? 'on' : ''}" onclick="SEND.when='now';renderSend()">Pickup now</button>
      <button class="seg ${SEND.when === 'later' ? 'on' : ''}" onclick="SEND.when='later';renderSend()">In 1 hour</button>
    </div>
    ${SEND.to ? `<button class="btn-main wide" onclick="SEND.step=3;renderSend()">See partners &amp; fare ${ic('arrowr', 13)}</button>` : ''}`;

  if (st === 3) {
    const opts = suggestVehicles(SEND.type, km);
    body = `
    <div class="wiz-q">Who should carry it? <small>${km.toFixed(1)} km trip</small></div>
    ${opts.map(v => `
      <button class="veh-row ${SEND.vehicle === v.id ? 'on' : ''}" onclick="SEND.vehicle='${v.id}';renderSend()">
        <span class="veh-emoji">${vehIcon(v.id, 26)}</span>
        <div><b>${v.name}</b><small>${v.carry}</small><small class="ok">~${v.id === 'walk' ? rnd(3, 8) : v.eta + rnd(0, 3)} min away · ${rnd(2, 9)} partners nearby</small></div>
        <em>${money(sendFare(v, km))}</em></button>`).join('')}
    <div class="tip-strip">${ic('shield', 13)} Every partner is CV face-verified with a verified vehicle. Live GPS trace + OTP handover at both ends.</div>
    ${SEND.vehicle ? `<button class="btn-main wide" onclick="sendCheckout(${km})">Book pickup · ${money(sendFare(DB.vehicles.find(v => v.id === SEND.vehicle), km))}</button>` : ''}`;
  }

  const pt = SEND.type ? DB.parcelTypes.find(p => p.id === SEND.type) : null;
  $('#view').innerHTML = `
  <div class="page-head">
    <button class="back" onclick="${st === 1 ? `go('home')` : `SEND.step=${st - 1};renderSend()`}">${ic('chevl', 16)}</button>
    <div><h1>Send Anything</h1><small>${pt ? pt.name + (SEND.to ? ` · to ${SEND.to.name}` : '') : 'A neighbour-powered courier for everything'}</small></div>
  </div>
  <div class="wiz-dots">${[1, 2, 3].map(i => `<i class="${i <= st ? 'on' : ''}"></i>`).join('')}</div>
  ${body}`;
  if (SEND.to && document.getElementById('sendMap')) routeMap('sendMap', SEND.from, SEND.to);
}

function sendPickPlace(which) {
  placePickerSheet(which === 'from' ? 'Pickup from' : 'Deliver to', (p) => { SEND[which] = p; renderSend(); });
}

function sendCheckout(km) {
  const v = DB.vehicles.find(x => x.id === SEND.vehicle);
  const pt = DB.parcelTypes.find(p => p.id === SEND.type);
  const fare = sendFare(v, km);
  checkoutSheet({
    title: 'Send ' + pt.name, icon: 'package',
    meta: `${SEND.from.name} → ${SEND.to.name} · ${km.toFixed(1)} km · by ${v.name}`,
    lines: [['Partner fare (' + v.name + ')', fare - 5], ['Platform fee', 5]], total: fare,
    onPay: (final) => {
      const o = createOrder({
        kind: 'send', flow: 'send',
        title: pt.name + ' → ' + SEND.to.name,
        total: final,
        detail: `${SEND.from.name} → ${SEND.to.name} · ${km.toFixed(1)} km · ${v.name}` + (SEND.note ? ' · "' + SEND.note + '"' : ''),
        items: [{ name: pt.name + ' (' + v.name + ' partner)', q: 1, price: final }]
      });
      SEND.done = true;
      go('track/' + o.id);
    }
  });
}
