/* ============================================================
   YOUR SHOP — any shop in India goes online in 2 minutes.
   Choose: deliver yourself, or let nearby partners carry it.
   ============================================================ */

let SREG = null;
const SHOP_ICONS = ['cart','bowl','leaf','cross','shirt','plug','flower','book','package','gift','briefcase','cash'];

view('myshop', () => {
  if (!S.myShop) { renderShopPitch(); return; }
  renderShopDash();
});

/* ---------- pitch ---------- */
function renderShopPitch() {
  $('#view').innerHTML = `
  <div class="earn-hero">
    <span class="earn-big">${ic('store', 54)}</span>
    <h1>Every dukaan in India.<br/><span>Online. Today.</span></h1>
    <p>Kirana, tiffin service, tailor, pharmacy, wholesaler — list your shop, and everyone nearby can order from you. You keep 100% of item price.</p>
    <div class="earn-stats">
      <div><b>₹0</b><small>listing fee</small></div>
      <div><b>2 min</b><small>detailed but easy form</small></div>
      <div><b>You choose</b><small>self or partner delivery</small></div>
    </div>
    <button class="btn-main wide lg" onclick="startShopReg()">Register my shop →</button>
  </div>
  <div class="how-grid">
    <div class="how"><span>${ic('edit', 22)}</span><b>Easy registration</b><p>Name, category, address, timings — big buttons, no confusing forms. Add GST/FSSAI if you have them. No signup fee. First month complimentary, then your tier: Individual 1 CHF/yr up to Manufacturer 100 CHF/yr.</p></div>
    <div class="how"><span>${ic('truck', 22)}</span><b>Delivery, your way</b><p>Deliver with your own staff, or tap once and a verified partner passing nearby picks it up.</p></div>
    <div class="how"><span>${ic('cash', 22)}</span><b>Money, instantly</b><p>Every sale lands in your wallet the moment it's delivered. Daily settlement to your bank.</p></div>
    <div class="how"><span>${ic('leaf', 22)}</span><b>Purity badge</b><p>Sell natural &amp; unadulterated? Our field team verifies your batches — the Purity ✓ seal sells itself.</p></div>
  </div>`;
}

/* ---------- registration wizard ---------- */
function startShopReg() {
  SREG = { step: 1, name: '', cat: null, phone: '', addr: DB.places[0], open: '8 am', close: '9 pm', veg: false, delivery: null, fssai: '', gst: '' };
  renderShopReg();
}
function renderShopReg() {
  const st = SREG.step;
  let body = '';

  if (st === 1) body = `
    <div class="wiz-q">Your shop</div>
    <label class="fld"><span>Shop name</span><input class="txt" placeholder="e.g. Lakshmi Kirana Store" value="${esc(SREG.name)}" oninput="SREG.name=this.value"/></label>
    <div class="fld"><span>Category</span>
      <div class="chip-wrap">
        ${DB.shopTypes.filter(t => t.id !== 'all').map(t =>
          `<button class="chip ${SREG.cat === t.id ? 'on' : ''}" onclick="SREG.cat='${t.id}';renderShopReg()">${typeIcon(t.id, 14)}${t.name}</button>`).join('')}
        ${(S.customCats || []).map(c =>
          `<button class="chip ${SREG.cat === c.id ? 'on' : ''}" onclick="SREG.cat='${c.id}';renderShopReg()">${ic('store', 14)}${esc(c.name)}</button>`).join('')}
        <button class="chip ${SREG.cat === 'other' ? 'on' : ''}" onclick="SREG.cat='other';renderShopReg()">${ic('plus', 14)}Other</button>
      </div>
      ${SREG.cat === 'other' ? `<input class="txt" placeholder="Type your category — e.g. Tailor, Salon, Tutor, Repair…" maxlength="30" value="${esc(SREG.customCat || '')}" oninput="SREG.customCat=this.value"/>
      <div class="foot-note sm" style="text-align:left">Your category gets saved and appears as an option for every seller after you.</div>` : ''}</div>
    <label class="fld"><span>Owner mobile</span><input class="txt" placeholder="10-digit mobile" maxlength="10" inputmode="numeric" value="${esc(SREG.phone)}" oninput="SREG.phone=this.value.replace(/\\D/g,'')"/></label>
    <button class="btn-main wide" onclick="shopRegNext1()">Next →</button>`;

  if (st === 2) body = `
    <div class="wiz-q">Where & when</div>
    <div class="addr-row" onclick="shopPickAddr()">
      <span>${ic('pin', 18)}</span><div><b>${esc(SREG.addr.name)}</b><small>${esc(SREG.addr.sub)}</small></div><em>Change</em></div>
    <div class="fld"><span>Open from</span>
      <div class="chip-wrap">${['6 am','8 am','10 am','12 pm'].map(t => `<button class="chip ${SREG.open === t ? 'on' : ''}" onclick="SREG.open='${t}';renderShopReg()">${t}</button>`).join('')}</div></div>
    <div class="fld"><span>Open till</span>
      <div class="chip-wrap">${['6 pm','9 pm','11 pm','24 hrs'].map(t => `<button class="chip ${SREG.close === t ? 'on' : ''}" onclick="SREG.close='${t}';renderShopReg()">${t}</button>`).join('')}</div></div>
    <label class="agree-row ${SREG.veg ? 'on' : ''}" onclick="SREG.veg=!SREG.veg;renderShopReg()"><i>${SREG.veg ? '✓' : ''}</i><span>Pure veg shop</span></label>
    <button class="btn-main wide" onclick="SREG.step=3;renderShopReg()">Next →</button>`;

  if (st === 3) body = `
    <div class="wiz-q">How will orders reach customers?</div>
    <label class="radio-row big ${SREG.delivery === 'self' ? 'on' : ''}" onclick="SREG.delivery='self';renderShopReg()">
      <i></i><div><b>I deliver myself</b><small>Your own staff or family delivers. You keep the delivery fee too.</small></div></label>
    <label class="radio-row big ${SREG.delivery === 'partner' ? 'on' : ''}" onclick="SREG.delivery='partner';renderShopReg()">
      <i></i><div><b>Orignals partners deliver</b><small>One tap — a verified partner passing nearby picks it up. No staff needed.</small></div></label>
    <label class="radio-row big ${SREG.delivery === 'both' ? 'on' : ''}" onclick="SREG.delivery='both';renderShopReg()">
      <i></i><div><b>+ Both, I decide per order</b><small>Busy day? Call a partner. Free evening? Deliver yourself.</small></div></label>
    ${SREG.delivery ? `<button class="btn-main wide" onclick="SREG.step=4;renderShopReg()">Next →</button>` : ''}`;

  if (st === 4) body = `
    <div class="wiz-q">Licences <small>(optional, boosts trust)</small></div>
    <label class="fld"><span>GST number (optional)</span><input class="txt" placeholder="22AAAAA0000A1Z5" value="${esc(SREG.gst)}" oninput="SREG.gst=this.value"/></label>
    <label class="fld"><span>FSSAI licence (optional, for food)</span><input class="txt" placeholder="14-digit FSSAI no." value="${esc(SREG.fssai)}" oninput="SREG.fssai=this.value"/></label>
    <button class="btn-main wide lg" onclick="submitShopReg()">Take my shop live — first month free</button>
    <div class="foot-note">No signup fee · first month complimentary · then tiered 1–100 CHF/yr.</div>`;

  $('#view').innerHTML = `
  <div class="page-head">
    <button class="back" onclick="${st === 1 ? 'renderShopPitch()' : `SREG.step=${st - 1};renderShopReg()`}">←</button>
    <div><h1>Shop registration</h1><small>Detailed but easy — step ${st} of 4</small></div></div>
  <div class="wiz-dots">${[1, 2, 3, 4].map(i => `<i class="${i <= st ? 'on' : ''}"></i>`).join('')}</div>
  ${body}`;
}
function catInfo(id) {
  return DB.shopTypes.find(t => t.id === id) || (S.customCats || []).find(c => c.id === id) || { id, name: 'Shop' };
}
function shopRegNext1() {
  if (SREG.name.trim().length < 3) { toast('Give your shop a name'); return; }
  if (!SREG.cat) { toast('Pick a category'); return; }
  if (SREG.cat === 'other') {
    const name = (SREG.customCat || '').trim();
    if (name.length < 3) { toast('Type your category name first'); return; }
    if (!S.customCats) S.customCats = [];
    let c = S.customCats.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!c) {
      c = { id: 'c' + uid(), name: name.replace(/\b\w/g, m => m.toUpperCase()) };
      S.customCats.push(c); save();
      toast('"' + c.name + '" saved — future sellers will see it too');
    }
    SREG.cat = c.id;
  }
  if (SREG.phone.length !== 10) { toast('Enter a valid 10-digit mobile'); return; }
  SREG.step = 2; renderShopReg();
}
function shopPickAddr() {
  /* real address search + GPS — the shop's exact pin is what buyers,
     partners and the purity inspector all navigate to */
  placePickerSheet('Shop location — search or use GPS', (p) => {
    SREG.addr = { name: p.name, sub: p.sub, lat: p.lat, lng: p.lng };
    if (p.lat != null) geoLog(p, 'shop');
    renderShopReg();
  });
}
function submitShopReg() {
  S.myShop = {
    name: SREG.name.trim(), cat: SREG.cat, phone: SREG.phone, addr: SREG.addr,
    open: SREG.open, close: SREG.close, veg: SREG.veg, delivery: SREG.delivery,
    gst: SREG.gst, fssai: SREG.fssai, online: true, created: Date.now(),
    items: [], orders: [], revenue: 0, lastGen: Date.now()
  };
  save(); confettiBurst();
  notify('Your shop is LIVE!', SREG.name + ' is now visible to everyone nearby.', '🎉');
  toast('Your shop is live on Orignals!', '🏪');
  renderShopDash();
}

/* ---------- dashboard ---------- */

/* REAL incoming orders: buyers on other devices ordering from this shop */
async function shopCloudSync() {
  const M = S.myShop;
  if (!M || typeof CLOUD === 'undefined' || !CLOUD.on) return false;
  let changed = false;
  try {
    const sid = 'my_' + (S.deviceKey || '').slice(0, 12);
    const rows = await cloudFetch('shop_orders?shop_id=eq.' + sid + '&order=created_at.desc&limit=25');
    (rows || []).forEach(r => {
      let o = M.orders.find(x => x.id === r.id);
      if (!o) {
        o = {
          id: r.id, ts: new Date(r.created_at).getTime(), real: true,
          customer: (r.buyer_name || 'Customer'),
          items: (r.items || []).map(i => ({ name: i.name, price: i.price, q: i.q, emoji: '' })),
          total: +r.total, status: r.status,
          buyer: { addr: r.buyer_addr, lat: r.buyer_lat, lng: r.buyer_lng }
        };
        if (r.buyer_lat != null && M.addr && M.addr.lat != null && typeof geoKm === 'function') {
          o.km = +geoKm({ lat: +M.addr.lat, lng: +M.addr.lng }, { lat: +r.buyer_lat, lng: +r.buyer_lng }).toFixed(1);
        }
        M.orders.unshift(o); changed = true;
        notify('LIVE order at your shop!', o.items.map(i => i.name).join(', ') + ' · ' + money(o.total) + ' · ' + o.customer, '🏪');
        toast('New LIVE order at ' + M.name + '!');
      } else if (o.real && r.status === 'rejected' && o.status !== 'rejected') {
        o.status = 'rejected'; changed = true;
        notify('Order cancelled by buyer', r.id + ' — no action needed.');
      }
    });

    /* real table reservations from buyers on other devices */
    const rz = await cloudFetch('reservations?shop_id=eq.' + sid + '&status=eq.reserved&order=created_at.desc&limit=15');
    M.reservations = M.reservations || [];
    (rz || []).forEach(r => {
      if (!M.reservations.find(x => x.id === r.id)) {
        M.reservations.unshift({ id: r.id, name: r.buyer_name || 'Guest', day: r.day, slot: r.slot, guests: r.guests, ts: new Date(r.created_at).getTime() });
        changed = true;
        notify('New table reservation!', `${r.buyer_name || 'A guest'} · ${r.guests} guests · ${r.day} ${r.slot}`, '🍽');
      }
    });
    /* drop reservations the buyer cancelled */
    const liveIds = new Set((rz || []).map(r => r.id));
    if (M.reservations.length) { const before = M.reservations.length; M.reservations = M.reservations.filter(x => liveIds.has(x.id)); if (M.reservations.length !== before) changed = true; }

    /* delivery leg posted to the partner feed: reflect real claim/finish */
    for (const o of M.orders.filter(x => x.real && x.jobId && !['done', 'rejected'].includes(x.status))) {
      const js = await cloudFetch('live_jobs?id=eq.' + o.jobId + '&select=status');
      if (!js || !js[0]) continue;
      if (js[0].status === 'taken' && o.status === 'finding') {
        o.status = 'handed'; o.partner = 'Orignals partner (live claim)'; o.otp = o.otp || rnd(1000, 9999);
        cloudShopOrderStatus(o.id, 'handed'); changed = true;
        toast('A real partner claimed the delivery!');
      }
      if (js[0].status === 'done' && o.status !== 'done') {
        o.status = 'done'; M.revenue += o.total;
        walletAdd(o.total, 'Sale · ' + o.id);
        cloudShopOrderStatus(o.id, 'done'); changed = true;
        confettiBurst(); toast('+' + money(o.total) + ' — delivered by partner, sale complete!');
      }
    }
  } catch (e) { /* next tick */ }
  if (changed) save();
  return changed;
}

/* simulated walk-in orders — ONLY when running without a cloud connection */
function genIncomingOrder() {
  const M = S.myShop;
  if (typeof CLOUD !== 'undefined' && CLOUD.on) return false;
  if (!M || !M.online || !M.items.length) return false;
  const pendingNew = M.orders.filter(o => o.status === 'new').length;
  if (pendingNew >= 2 || Date.now() - (M.lastGen || 0) < 22000) return false;
  const n = rnd(1, Math.min(2, M.items.length));
  const chosen = [...M.items].sort(() => Math.random() - .5).slice(0, n).map(it => ({ name: it.name, emoji: it.emoji, price: it.price, q: rnd(1, 2) }));
  const total = chosen.reduce((a, i) => a + i.price * i.q, 0);
  M.orders.unshift({ id: 'SO' + rnd(1000, 9999), ts: Date.now(), customer: pick(DB.firstNames) + ' ' + pick(['S.', 'K.', 'R.', 'M.', 'P.']), items: chosen, total, status: 'new', km: (rnd(3, 28) / 10) });
  M.lastGen = Date.now();
  save();
  notify('New order at your shop! ', chosen.map(i => i.name).join(', ') + ' · ' + money(total), '🏪');
  toast('New order at ' + M.name + '!', '');
  return true;
}

function renderShopDash() {
  const M = S.myShop;
  const cat = DB.shopTypes.find(t => t.id === M.cat);
  const pend = M.orders.filter(o => o.status !== 'done' && o.status !== 'rejected');
  const done = M.orders.filter(o => o.status === 'done');

  const orderCard = o => `
    <div class="job-card ${o.status === 'new' ? 'pulse-border' : ''}">
      <div class="job-top"><span class="job-emoji">${ic('bell', 20)}</span>
        <div><b>${o.id} · ${esc(o.customer)}</b><small>${o.real ? '<b class="ok">LIVE · real buyer</b> · ' : ''}${o.km != null ? o.km + ' km away · ' : ''}${new Date(o.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</small></div>
        <em class="job-pay">${money(o.total)}</em></div>
      <div class="job-note">${o.items.map(i => `${i.emoji} ${esc(i.name)} × ${i.q}`).join(' · ')}</div>
      ${o.status === 'new' ? `<div class="btn-pair">
          <button class="btn-main sm" onclick="shopOrderAct('${o.id}','accept')">✓ Accept</button>
          <button class="btn-main sm ghost" onclick="shopOrderAct('${o.id}','reject')">Reject</button></div>` : ''}
      ${o.status === 'prep' ? (
        M.delivery === 'self'
          ? `<button class="btn-main wide sm" onclick="shopOrderAct('${o.id}','selfout')">I'm delivering it myself</button>`
        : M.delivery === 'partner'
          ? `<button class="btn-main wide sm" onclick="shopOrderAct('${o.id}','find')">Call nearby partner</button>`
          : `<div class="btn-pair">
              <button class="btn-main sm" onclick="shopOrderAct('${o.id}','selfout')">Deliver myself</button>
              <button class="btn-main sm alt" onclick="shopOrderAct('${o.id}','find')">Nearby partner</button></div>`) : ''}
      ${o.status === 'finding' ? `<div class="otp-strip">Finding a partner passing near you…</div>` : ''}
      ${o.status === 'handed' ? `<div class="otp-strip"><b>${esc(o.partner)}</b> is carrying it · give parcel with OTP <b>${o.otp}</b>
          <button class="btn-main wide sm" onclick="shopOrderAct('${o.id}','done')">Handover done ✓</button></div>` : ''}
      ${o.status === 'selfout' ? `<button class="btn-main wide sm" onclick="shopOrderAct('${o.id}','done')">✓ Mark delivered</button>` : ''}
    </div>`;

  $('#view').innerHTML = `
  <div class="shopdash-head">
    <span class="pc-ava big">${typeIcon(M.cat, 24)}</span>
    <div><h1>${esc(M.name)}</h1><small>${cat ? cat.name : ''} · ${esc(M.addr.name)} · ${M.open}–${M.close} ${M.veg ? '· Pure veg' : ''}</small>
      <small>${M.delivery === 'self' ? 'Self delivery' : M.delivery === 'partner' ? 'Partner delivery' : '🏪+Both'} ${M.gst ? '· GST ✓' : ''} ${M.fssai ? '· FSSAI ✓' : ''}</small></div>
    <label class="switch ${M.online ? 'on' : ''}" onclick="S.myShop.online=!S.myShop.online;save();renderShopDash()"><i></i>${M.online ? 'Online' : 'Offline'}</label>
  </div>

  <div class="earn-tiles wide3">
    <div class="etile"><b>${money(M.revenue)}</b><small>Revenue</small></div>
    <div class="etile"><b>${done.length}</b><small>Orders done</small></div>
    <div class="etile"><b>${M.items.length}</b><small>Items listed</small></div>
  </div>

  ${done.length ? (() => { const days = [...Array(7)].map((_, i) => {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - (6 - i));
      const nx = d.getTime() + 86400000;
      return { lbl: d.toLocaleDateString('en-IN', { weekday: 'narrow' }), amt: done.filter(o => o.ts >= d.getTime() && o.ts < nx).reduce((a, o) => a + o.total, 0) }; });
    const mx = Math.max(...days.map(d => d.amt), 50);
    return `<div class="card-block"><h3>${ic('chart', 14)} Sales — last 7 days</h3>
      <div class="bars">${days.map(d => `<div class="bar"><i style="height:${Math.max(d.amt / mx * 100, 3)}%"></i><small>${d.lbl}</small></div>`).join('')}</div></div>`; })() : ''}

  ${M.offer ? `<div class="offer-strip">${ic('gift', 13)} Live offer: <b>${esc(M.offer.label)}</b> — shown to nearby customers <button class="lnk red" onclick="S.myShop.offer=null;save();renderShopDash()">End</button></div>` : ''}

  <div class="btn-pair">
    <button class="btn-main sm alt" onclick="shopItemSheet()">+ Add item</button>
    <button class="btn-main sm ghost" onclick="go('storefront')">Preview my shop</button>
  </div>
  <div class="btn-pair">
    <button class="btn-main sm ghost" onclick="offerSheet()">Create offer</button>
    <button class="btn-main sm ghost" onclick="shareShop()">Share shop link</button>
  </div>

  ${!M.items.length ? `<div class="tip-strip">Add your first items — orders start coming once your shelf isn't empty!</div>` : ''}

  ${(M.reservations && M.reservations.length) ? `<div class="sec-head"><h2>Table reservations ${ic('bowl', 14)}</h2></div>
    ${M.reservations.map(r => `<div class="job-card"><div class="job-top"><span class="job-emoji">${ic('bowl', 20)}</span>
      <div><b>${esc(r.name)} · ${r.guests} guests</b><small><b class="ok">LIVE · real guest</b> · ${esc(r.day)} ${esc(r.slot)}</small></div>
      <em class="job-pay">20% off</em></div></div>`).join('')}` : ''}

  ${pend.length ? `<div class="sec-head"><h2>Orders <span class="live-dot"></span></h2></div>${pend.map(orderCard).join('')}` :
    M.items.length ? `<div class="tip-strip"> You're online — orders from nearby customers pop up here the moment they're placed.</div>` : ''}

  ${M.items.length ? `<div class="sec-head"><h2>Your shelf (${M.items.length})</h2></div>
  ${M.items.map((it, i) => `<div class="item-row slim">
      <div class="item-emoji">${icOr(it.emoji, 20)}</div>
      <div class="item-info"><b>${esc(it.name)}</b>${it.out ? ' <em class="out-tag">Out of stock</em>' : ''}<small>${esc(it.qty)}</small><div class="item-price">${money(it.price)}</div></div>
      <div class="item-act"><button class="lnk" onclick="S.myShop.items[${i}].out=!S.myShop.items[${i}].out;save();renderShopDash()">${it.out ? 'Restock' : 'Mark out'}</button>
        <button class="lnk" onclick="shopItemSheet(${i})">Edit</button>
        <button class="lnk red" onclick="if(confirm('Remove ${esc(it.name)}?')){S.myShop.items.splice(${i},1);save();renderShopDash()}">Delete</button></div></div>`).join('')}` : ''}

  ${done.length ? `<div class="sec-head"><h2>Completed</h2></div>
    ${done.slice(0, 6).map(o => `<div class="order-row static"><span class="or-emoji">${ic('check', 16)}</span>
      <div class="or-info"><b>${o.id} · ${esc(o.customer)}</b><small>${o.items.map(i => i.name).join(', ')}</small></div>
      <b class="ok">+${money(o.total)}</b></div>`).join('')}` : ''}`;

  clearInterval(window._shopTimer);
  window._shopTimer = setInterval(() => {
    if (!location.hash.includes('myshop')) { clearInterval(window._shopTimer); return; }
    if (typeof CLOUD !== 'undefined' && CLOUD.on) {
      shopCloudSync().then(ch => { if (ch && location.hash.includes('myshop')) renderShopDash(); });
    } else if (genIncomingOrder()) renderShopDash();
  }, 8000);
  if (typeof CLOUD !== 'undefined' && CLOUD.on) shopCloudSync().then(ch => { if (ch && location.hash.includes('myshop')) renderShopDash(); });
}

function shopOrderAct(oid, act) {
  const M = S.myShop;
  const o = M.orders.find(x => x.id === oid); if (!o) return;
  const pushCloud = (st) => { if (o.real && typeof cloudShopOrderStatus === 'function') cloudShopOrderStatus(oid, st); };
  if (act === 'accept') { o.status = 'prep'; pushCloud('prep'); toast('Order accepted — pack it up!', '📦'); }
  if (act === 'reject') { o.status = 'rejected'; pushCloud('rejected'); toast('Order rejected & refunded', ''); }
  if (act === 'selfout') { o.status = 'selfout'; o.deliv = 'self'; pushCloud('selfout'); toast('Marked out for delivery', '🛵'); }
  if (act === 'find') {
    o.status = 'finding'; o.deliv = 'partner'; pushCloud('finding');
    if (o.real && typeof cloudPostJob === 'function' && M.addr && M.addr.lat != null) {
      /* the delivery leg becomes a REAL claimable job for nearby partners */
      o.jobId = 'lj_' + oid;
      cloudPostJob({
        id: o.jobId, what: 'Deliver order from ' + M.name, jtype: 'box',
        from_name: M.name + ' (shop)', to_name: (o.buyer && o.buyer.addr) ? o.buyer.addr.split(',')[0] : 'Customer',
        from_lat: M.addr.lat, from_lng: M.addr.lng,
        to_lat: o.buyer ? o.buyer.lat : null, to_lng: o.buyer ? o.buyer.lng : null,
        km: o.km, pay: Math.max(15, Math.round((o.km || 2) * 9)), order_ref: oid
      });
      save(); renderShopDash();
      toast('Posted to the live partner feed — first partner passing by claims it');
      return;
    }
    /* no cloud/no GPS: platform assigns from the roster */
    save(); renderShopDash();
    setTimeout(() => {
      const oo = S.myShop.orders.find(x => x.id === oid);
      if (oo && oo.status === 'finding') {
        const p = pick(DB.partners);
        oo.status = 'handed'; oo.partner = p.name + ' (' + p.veh + ')'; oo.otp = rnd(1000, 9999); oo.deliv = 'partner';
        pushCloud('handed');
        save(); toast(p.name + ' accepted — arriving in ' + rnd(2, 6) + ' min', '🤝');
        if (location.hash.includes('myshop')) renderShopDash();
      }
    }, 3200);
    return;
  }
  if (act === 'done') {
    o.status = 'done'; pushCloud('done');
    M.revenue += o.total;
    walletAdd(o.total, 'Sale · ' + o.id + '');
    confettiBurst(); toast('+' + money(o.total) + ' — sale complete!', '💰');
  }
  save(); renderShopDash();
}

/* ---------- add / edit item ---------- */
function shopItemSheet(idx) {
  const it = idx != null ? S.myShop.items[idx] : { name: '', price: '', qty: '', emoji: '🛒' };
  window._itEdit = idx;
  window._itEmoji = it.emoji;
  sheet(`
    <div class="sheet-grab"></div><h3 class="sheet-title">${idx != null ? 'Edit item' : 'Add item to your shelf'}</h3>
    <label class="fld"><span>Item name</span><input class="txt" id="itName" placeholder="e.g. Fresh Paneer" value="${esc(it.name)}"/></label>
    <div class="fld-pair">
      <label class="fld"><span>Price (₹)</span><input class="txt" id="itPrice" inputmode="numeric" placeholder="99" value="${it.price}"/></label>
      <label class="fld"><span>Quantity / unit</span><input class="txt" id="itQty" placeholder="500 g / 1 pc" value="${esc(it.qty)}"/></label>
    </div>
    <div class="fld"><span>Icon</span><div class="chip-wrap">
      ${SHOP_ICONS.map(e => `<button class="chip emoji ${e === it.emoji ? 'on' : ''}" data-ic="${e}" onclick="window._itEmoji='${e}';$$('.chip.emoji').forEach(c=>c.classList.toggle('on',c.dataset.ic==='${e}'))">${ic(e, 17)}</button>`).join('')}</div></div>
    <button class="btn-main wide" onclick="shopItemSave()">Save item</button>`);
}
function shopItemSave() {
  const name = $('#itName').value.trim();
  const price = parseInt($('#itPrice').value, 10);
  const qty = $('#itQty').value.trim() || '1 pc';
  if (name.length < 2) { toast('Name the item', ''); return; }
  if (!price || price < 1) { toast('Enter a valid price', '💰'); return; }
  const item = { id: 'my' + uid(), name, price, qty, emoji: window._itEmoji || '🛒' };
  if (window._itEdit != null) S.myShop.items[window._itEdit] = Object.assign(S.myShop.items[window._itEdit], item, { id: S.myShop.items[window._itEdit].id });
  else S.myShop.items.push(item);
  save(); closeSheet(); toast('Shelf updated', '🧺'); renderShopDash();
}

/* ---------- public storefront preview ---------- */
view('storefront', () => {
  const M = S.myShop;
  if (!M) { go('myshop'); return; }
  const cat = DB.shopTypes.find(t => t.id === M.cat);
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('myshop')">←</button>
    <div><h1>Customer view 👁</h1><small>This is how ${esc(M.name)} appears to buyers nearby</small></div></div>
  <div class="shop-hero">
    <span class="shop-hero-emoji">${cat ? cat.emoji : '🏪'}</span>
  </div>
  <div class="shop-sheet">
    <div class="shop-head"><div><h1>${esc(M.name)}</h1><small>${cat ? cat.name : ''} · ${M.open}–${M.close} ${M.veg ? '· Pure veg' : ''}</small></div>
      <div class="rate big">★ New<small>Just joined</small></div></div>
    <div class="shop-meta"><span>${ic('pin', 12)} ${esc(M.addr.name)}</span>
      ${M.delivery === 'self' ? '<span class="dbadge self">Shop delivers itself</span>' : M.delivery === 'partner' ? '<span class="dbadge partner">Orignals partner delivery</span>' : '<span class="dbadge both">🏪+Self or partner delivery</span>'}</div>
    ${M.gst || M.fssai ? `<div class="offer-strip">✅ ${[M.gst && 'GST verified', M.fssai && 'FSSAI licensed'].filter(Boolean).join(' · ')}</div>` : ''}
    <div class="sec-head"><h2>All items (${M.items.length})</h2></div>
    ${M.items.length ? M.items.map(i => `
      <div class="item-row"><div class="item-emoji">${icOr(i.emoji, 20)}</div>
        <div class="item-info"><b>${esc(i.name)}</b><small>${esc(i.qty)}</small><div class="item-price">${money(i.price)}</div></div>
        <div class="item-act"><button class="stp add" onclick="toast('Customers tap here to order from you','🛒')">ADD</button></div></div>`).join('')
      : `<div class="empty"><span>🧺</span><b>Empty shelf</b><p>Add items from your dashboard.</p></div>`}
  </div>`;
});


/* ---------- offers & sharing ---------- */
function offerSheet() {
  window._offP = 0;
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Create an offer</h3>
    <div class="fld"><span>Discount</span><div class="chip-wrap">
      ${[10, 15, 20, 30, 50].map(p => `<button class="chip" onclick="window._offP=${p};$$('.sheet-body .chip').forEach(c=>c.classList.remove('on'));this.classList.add('on')">${p}% off</button>`).join('')}
    </div></div>
    <label class="fld"><span>Minimum order (optional)</span><input class="txt" id="offMin" type="number" placeholder="e.g. 199"/></label>
    <button class="btn-main wide" onclick="saveOffer()">Go live with offer</button>
    <div class="foot-note sm">Offers show on your shop card — nearby customers see them instantly.</div>`);
}
function saveOffer() {
  const p = window._offP;
  if (!p) { toast('Pick a discount percentage'); return; }
  const min = parseInt($('#offMin').value, 10) || 0;
  S.myShop.offer = { pct: p, min, label: p + '% off' + (min ? ' above ' + money(min) : ' on everything') };
  save(); closeSheet(); confettiBurst();
  toast('Offer live: ' + S.myShop.offer.label);
  renderShopDash();
}
function shareShop() {
  const link = 'https://orignals.shop/#/storefront/' + encodeURIComponent(S.myShop.name.toLowerCase().replace(/\s+/g, '-'));
  const done = () => toast('Link copied — share it on WhatsApp, status, anywhere');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => prompt('Copy your shop link:', link));
  else prompt('Copy your shop link:', link);
}
