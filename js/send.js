/* ============================================================
   SEND ANYTHING — tiffin box to truck-load, carried by a
   CV-verified partner already passing nearby
   ============================================================ */

let SEND = null;
function sendReset() {
  SEND = { step: 1, type: null, from: DB.places[0], to: null, note: '', when: 'now', vehicle: null, tier: 'normal' };
}

/* ============================================================
   LONG-HAUL MULTI-LEG RELAY LOGISTICS
   Anything beyond a single rider's range is routed through legs —
   first-mile bike → line-haul (road / rail / air) → last-mile bike —
   each carried by a verified partner, priced by distance + weight +
   speed tier, with a safe hand-over between every leg.
   ============================================================ */
const RELAY_TIERS = [
  { id: 'normal',  name: 'Normal',  desc: 'Surface & rail — best price', },
  { id: 'fast',    name: 'Fast',    desc: 'Express road — quicker' },
  { id: 'express', name: 'Express', desc: 'Air cargo — fastest' }
];
function relayWeight(typeId) {
  const f = ((DB.parcelTypes.find(p => p.id === typeId) || {}).fits) || [];
  if (f.includes('truck')) return f.length === 1 ? 6 : 3;
  if (f.includes('van')) return 2.4;
  if (f.includes('car')) return 1.6;
  return 1;
}
function relaySpeed(mode) { return { bike: 24, truck: 46, rail: 52, air: 620 }[mode] || 40; }
function relayModeIcon(mode) {
  if (mode === 'bike') return ic('bike', 22);
  if (mode === 'truck') return ic('truck', 22);
  if (mode === 'rail') return '<span style="font-size:19px;line-height:1">🚆</span>';
  if (mode === 'air') return '<span style="font-size:19px;line-height:1">✈️</span>';
  return ic('package', 22);
}
function relayEta(h) { if (h < 24) return Math.max(1, Math.round(h)) + ' hr'; const d = h / 24; return d < 1.6 ? '~1 day' : '~' + Math.round(d) + ' days'; }
function relayPlan(km, typeId, tier) {
  const w = relayWeight(typeId);
  const first = Math.min(9, +(km * 0.02 + 2).toFixed(1));
  const last = Math.min(11, +(km * 0.02 + 2.5).toFixed(1));
  const lineKm = Math.max(1, +(km - first - last).toFixed(1));
  let lm, ll, lr, hub, lspd;
  if (tier === 'express' || km > 1800) { lm = 'air'; ll = 'Air-cargo line-haul'; lr = (tier === 'express' ? 9.5 : 7); hub = 6; lspd = 620; }
  else if (km > 500) { if (tier === 'fast') { lm = 'truck'; ll = 'Express road line-haul'; lr = 4.6; hub = 3; lspd = 62; } else { lm = 'rail'; ll = 'Rail-freight line-haul'; lr = 2.7; hub = 5; lspd = 52; } }
  else { lm = 'truck'; ll = (tier === 'fast' ? 'Express road' : 'Surface road'); lr = (tier === 'fast' ? 4.8 : 3.4); hub = tier === 'fast' ? 2 : 3; lspd = tier === 'fast' ? 58 : 44; }
  const legs = [
    { mode: 'bike', label: 'First-mile pickup', km: first, rate: 9, spd: 24 },
    { mode: lm, label: ll, km: lineKm, rate: lr, spd: lspd },
    { mode: 'bike', label: 'Last-mile delivery', km: last, rate: 9, spd: 24 }
  ];
  let cost = 0, hours = hub;
  legs.forEach(l => { l.cost = Math.round((14 + l.km * l.rate) * (l.mode === 'bike' ? 1 : w)); cost += l.cost; l.hours = +(l.km / (l.spd || relaySpeed(l.mode))).toFixed(1); hours += l.hours; });
  const platform = Math.round(cost * 0.05), gst = Math.round(cost * 0.05);
  return { legs, subtotal: cost, platform, gst, total: cost + platform + gst, hours: +hours.toFixed(1), lineMode: lm };
}
function relayStepHTML(km) {
  const tier = SEND.tier || 'normal';
  const plan = relayPlan(km, SEND.type, tier);
  return `
    <div class="wiz-q">Long-distance relay <small>${km.toFixed(1)} km</small></div>
    <div class="tip-strip">${ic('shield', 13)} Too far for one rider — Mitra routes your parcel through <b>${plan.legs.length} verified legs</b> (bike → line-haul → bike), each GPS-traced with a safe hand-over. No parcel moves without a matched carrier.</div>
    <div class="seg-row">${RELAY_TIERS.map(t => `<button class="seg ${tier === t.id ? 'on' : ''}" onclick="SEND.tier='${t.id}';renderSend()">${t.name}</button>`).join('')}</div>
    <div class="foot-note sm" style="text-align:left;margin:2px 0 8px">${esc(RELAY_TIERS.find(t => t.id === tier).desc)} · via <b>${plan.lineMode === 'air' ? 'air cargo' : plan.lineMode === 'rail' ? 'rail freight' : 'road'}</b> · ETA <b>${relayEta(plan.hours)}</b></div>
    ${plan.legs.map((l, i) => `
      <div class="veh-row" style="cursor:default">
        <span class="veh-emoji">${relayModeIcon(l.mode)}</span>
        <div><b>Leg ${i + 1} · ${esc(l.label)}</b><small>${l.km} km · ~${relayEta(l.hours)}</small><small class="ok">verified ${l.mode === 'bike' ? 'rider' : l.mode === 'air' ? 'air partner' : l.mode === 'rail' ? 'rail partner' : 'driver'} · safe hand-over</small></div>
        <em>${money(l.cost)}</em></div>`).join('')}
    <div class="card-block">
      <div class="ck-line"><span>Carriers (${plan.legs.length} legs)</span><span>${money(plan.subtotal)}</span></div>
      <div class="ck-line"><span>Platform fee (5%)</span><span>${money(plan.platform)}</span></div>
      <div class="ck-line"><span>GST (5%)</span><span>${money(plan.gst)}</span></div>
      <div class="ck-line grand"><span>Total · ETA ${relayEta(plan.hours)}</span><span>${money(plan.total)}</span></div>
    </div>
    <button class="btn-main wide" onclick="sendCheckoutRelay(${km})">Book relay · ${money(plan.total)}</button>`;
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

  if (st === 3 && km > 60) {
    /* beyond a single rider's range → multi-leg relay logistics */
    body = relayStepHTML(km);
  } else if (st === 3) {
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

function sendCheckoutRelay(km) {
  const pt = DB.parcelTypes.find(p => p.id === SEND.type);
  const tier = SEND.tier || 'normal';
  const plan = relayPlan(km, SEND.type, tier);
  const tierName = RELAY_TIERS.find(t => t.id === tier).name;
  checkoutSheet({
    title: 'Relay · ' + pt.name, icon: 'package',
    meta: `${SEND.from.name} → ${SEND.to.name} · ${km.toFixed(1)} km · ${plan.legs.length}-leg ${tierName} relay · ETA ${relayEta(plan.hours)}`,
    lines: plan.legs.map((l, i) => ['Leg ' + (i + 1) + ' · ' + l.label + ' (' + l.km + ' km)', l.cost]).concat([['Platform fee (5%)', plan.platform], ['GST (5%)', plan.gst]]),
    total: plan.total,
    onPay: (final) => {
      const o = createOrder({
        kind: 'send', flow: 'send', km,
        geo: (SEND.from.lat != null && SEND.to.lat != null) ? { from: { lat: +SEND.from.lat, lng: +SEND.from.lng }, to: { lat: +SEND.to.lat, lng: +SEND.to.lng } } : undefined,
        title: pt.name + ' → ' + SEND.to.name + ' (' + tierName + ' relay)',
        total: final,
        detail: `${SEND.from.name} → ${SEND.to.name} · ${km.toFixed(1)} km · ${plan.legs.length}-leg relay · ETA ${relayEta(plan.hours)}` + (SEND.note ? ' · "' + SEND.note + '"' : ''),
        items: plan.legs.map((l, i) => ({ name: 'Leg ' + (i + 1) + ': ' + l.label + ' (' + l.mode + ', ' + l.km + ' km)', q: 1, price: l.cost })).concat([{ name: 'Platform fee + GST', q: 1, price: plan.platform + plan.gst }])
      });
      /* the first-mile pickup is the immediately claimable job; onward legs
         hand over at each hub */
      if (typeof cloudPostJob === 'function') cloudPostJob({
        id: 'lj_' + o.id, what: 'Relay pickup · ' + pt.name, jtype: SEND.type,
        from_name: SEND.from.name, to_name: 'Relay hub (first-mile)',
        from_lat: SEND.from.lat, from_lng: SEND.from.lng, to_lat: SEND.to.lat, to_lng: SEND.to.lng,
        km: plan.legs[0].km, pay: Math.max(Math.round(plan.legs[0].cost * 0.8), 10),
        note: 'First-mile of a ' + plan.legs.length + '-leg relay to ' + SEND.to.name, order_ref: o.id
      });
      SEND.done = true;
      go('track/' + o.id);
    }
  });
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
        kind: 'send', flow: 'send', km,
        geo: (SEND.from.lat != null && SEND.to.lat != null) ? { from: { lat: +SEND.from.lat, lng: +SEND.from.lng }, to: { lat: +SEND.to.lat, lng: +SEND.to.lng } } : undefined,
        title: pt.name + ' → ' + SEND.to.name,
        total: final,
        detail: `${SEND.from.name} → ${SEND.to.name} · ${km.toFixed(1)} km · ${v.name}` + (SEND.note ? ' · "' + SEND.note + '"' : ''),
        items: [{ name: pt.name + ' (' + v.name + ' partner)', q: 1, price: final }]
      });
      /* this parcel is now a REAL claimable job for every partner nearby */
      if (typeof cloudPostJob === 'function') cloudPostJob({
        id: 'lj_' + o.id, what: 'Deliver ' + pt.name, jtype: SEND.type,
        from_name: SEND.from.name, to_name: SEND.to.name,
        from_lat: SEND.from.lat, from_lng: SEND.from.lng,
        to_lat: SEND.to.lat, to_lng: SEND.to.lng,
        km, pay: Math.max(Math.round(final * 0.8), 10), note: SEND.note, order_ref: o.id
      });
      SEND.done = true;
      go('track/' + o.id);
    }
  });
}
