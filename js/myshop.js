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
    <div class="wiz-q">Licences <small>(optional — you can list without any)</small></div>
    <div class="paperless-note">${ic('shield', 15)}<div><b>No papers? No problem.</b><small>List under your own verified identity now. Add licences anytime — or let us make them for you at market rates.</small></div></div>
    <label class="fld"><span>GST number (optional)</span><input class="txt" placeholder="22AAAAA0000A1Z5" value="${esc(SREG.gst)}" oninput="SREG.gst=this.value"/></label>
    <label class="fld"><span>FSSAI licence (optional, for food)</span><input class="txt" placeholder="14-digit FSSAI no." value="${esc(SREG.fssai)}" oninput="SREG.fssai=this.value"/></label>
    <button class="btn-main ghost wide" onclick="go('papers')">${ic('shield', 14)} I need help getting papers made</button>
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
function shopFreshPledge() {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${ic('leaf', 16)} Freshness pledge</h3>
    <p class="foot-note sm" style="text-align:left">By pledging, you confirm for every order:</p>
    <div class="ck-line"><span>🌿 Cooked / prepared <b>fresh</b>, not sold pre-made or reheated</span><span></span></div>
    <div class="ck-line"><span>🚫 No banned colours, adulterants or unsafe additives</span><span></span></div>
    <div class="ck-line"><span>🧼 Clean handling &amp; storage</span><span></span></div>
    <div class="foot-note sm" style="text-align:left;margin-top:8px">Orignals may spot-check. A broken pledge delists your shop — this protects every honest seller.</div>
    <button class="btn-main wide" onclick="shopFreshConfirm()">${ic('check', 14)} I pledge — show it to buyers</button>`);
}
function shopFreshConfirm() {
  S.myShop.fresh = { made: true, noPremade: true, hygiene: true, at: Date.now() }; save();
  closeSheet(); confettiBurst(); toast('Freshness pledge live — buyers now see 🌿 Fresh today');
  renderShopDash();
}

/* ---- Commerce World Model: what-if price simulation (grounded, real) ---- */
function shopSimulate() {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${ic('chart', 15)} What-if price simulation</h3>
    <p class="foot-note sm" style="text-align:left">Enter one item's price and how many you sell per day. Mitra simulates raising, keeping, and discounting it — projecting units &amp; revenue with a demand-elasticity model.</p>
    <div style="display:flex;gap:8px">
      <label style="flex:1;font-size:.8rem;color:var(--mut)">Price ₹<input id="simP" type="number" inputmode="numeric" value="40" style="${_poFld}" oninput="shopSimCalc()"/></label>
      <label style="flex:1;font-size:.8rem;color:var(--mut)">Units / day<input id="simU" type="number" inputmode="numeric" value="30" style="${_poFld}" oninput="shopSimCalc()"/></label>
    </div>
    <div id="simResults"></div>`);
  shopSimCalc();
}
function shopSimCalc() {
  const box = document.getElementById('simResults'); if (!box) return;
  const price = +((document.getElementById('simP') || {}).value) || 0;
  const units = +((document.getElementById('simU') || {}).value) || 0;
  const e = 1.2;   // demand elasticity (groceries ≈ 1.2: a 10% rise ≈ 12% fewer units)
  const base = price * units;
  const rows = [['Raise +15%', 0.15], ['Keep price', 0], ['Discount −15%', -0.15]].map(([label, dp]) => {
    const np = price * (1 + dp), nu = Math.max(0, units * (1 - e * dp)), rev = np * nu;
    return { label, np, nu, rev, delta: Math.round(rev - base) };
  });
  const best = rows.reduce((a, b) => b.rev > a.rev ? b : a);
  box.innerHTML = rows.map(r => `<div class="ck-line ${r === best ? 'grand' : ''}"><span>${esc(r.label)} → ₹${r.np.toFixed(0)} · ~${r.nu.toFixed(0)} units</span><span>${money(Math.round(r.rev))} <small class="${r.delta >= 0 ? 'ok' : 'red'}">${r.delta >= 0 ? '+' : ''}${money(r.delta)}</small></span></div>`).join('')
    + `<div class="foot-note sm" style="text-align:left;margin-top:6px">${ic('spark', 11)} Best projected revenue: <b>${esc(best.label)}</b>. Model elasticity ≈ ${e}. Decision support — validate against real sales.</div>`;
}
const _poFld = 'width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:12px;margin:6px 0;font:inherit;background:var(--card,#fff);color:inherit';
function shopPayoutSheet() {
  const p = (S.myShop && S.myShop.payout) || {};
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Payout account</h3>
    <div class="trust-row">${ic('shield', 12)} Your money is settled here automatically. Bank details are stored for payout only.</div>
    <input id="poHolder" placeholder="Account holder name" value="${esc(p.holder || (S.myShop ? S.myShop.name : '') || '')}" style="${_poFld}"/>
    <input id="poUpi" placeholder="UPI ID — e.g. shop@upi (fastest)" value="${esc(p.upi || '')}" style="${_poFld}"/>
    <div style="display:flex;gap:8px"><input id="poBank" placeholder="Bank account no." value="${esc(p.bank_acc || '')}" style="${_poFld}"/>
      <input id="poIfsc" placeholder="IFSC" value="${esc(p.ifsc || '')}" style="${_poFld}"/></div>
    <button class="btn-main wide" onclick="shopPayoutSave()">${ic('check', 14)} Save payout account</button>`);
}
async function shopPayoutSave() {
  const g = id => (document.getElementById(id) || {}).value.trim();
  const holder = g('poHolder'), upi = g('poUpi'), bank = g('poBank'), ifsc = g('poIfsc');
  if (!upi && !bank) { toast('Add a UPI ID or bank account'); return; }
  S.myShop.payout = { holder, upi, bank_acc: bank, ifsc }; save();
  if (typeof CLOUD !== 'undefined' && CLOUD.on) {
    await cloudFetch('rpc/payout_account_set', { method: 'POST', body: JSON.stringify({ p_payee: S.deviceKey || 'anon', p_kind: 'shop', p_holder: holder, p_upi: upi, p_bank: bank, p_ifsc: ifsc }) }).catch(() => {});
  }
  closeSheet(); toast('Payout account saved'); renderShopDash();
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
    const rows = await cloudFetch('rpc/my_shop_orders', { method: 'POST', body: JSON.stringify({ p_shop: sid }) });
    (rows || []).forEach(r => {
      let o = M.orders.find(x => x.id === r.id);
      if (!o) {
        o = {
          id: r.id, ts: new Date(r.created_at).getTime(), real: true,
          customer: (r.buyer_name || 'Customer'),
          items: (r.items || []).map(i => ({ name: i.name, price: i.price, q: i.q, emoji: '' })),
          total: +r.total, status: r.status,
          buyer: { device: r.buyer_device, addr: r.buyer_addr, lat: r.buyer_lat, lng: r.buyer_lng }
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
    const rz = await cloudFetch('rpc/shop_reservations', { method: 'POST', body: JSON.stringify({ p_shop: sid }) });
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
      ${(o.real && typeof orderChat === 'function') ? `<button class="lnk" onclick="orderChat('${o.id}','shop')">${ic('spark', 11)} Message customer</button>` : ''}
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
  ${M.photo ? `<div class="shop-cover"><img src="${M.photo}" alt=""/></div>` : ''}
  <div class="shopdash-head">
    <span class="pc-ava big">${M.photo ? `<img src="${M.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"/>` : typeIcon(M.cat, 24)}</span>
    <div><h1>${esc(M.name)}</h1><small>${cat ? cat.name : ''} · ${esc(M.addr.name)} · ${M.open}–${M.close} ${M.veg ? '· Pure veg' : ''}</small>
      <small>${M.delivery === 'self' ? 'Self delivery' : M.delivery === 'partner' ? 'Partner delivery' : '🏪+Both'} ${M.gst ? '· GST ✓' : ''} ${M.fssai ? '· FSSAI ✓' : ''}</small></div>
    <label class="switch ${M.online ? 'on' : ''}" onclick="S.myShop.online=!S.myShop.online;save();renderShopDash()"><i></i>${M.online ? 'Online' : 'Offline'}</label>
  </div>

  <div class="earn-tiles wide3">
    <div class="etile"><b>${money(M.revenue)}</b><small>Revenue</small></div>
    <div class="etile"><b>${done.length}</b><small>Orders done</small></div>
    <div class="etile"><b>${M.items.length}</b><small>Items listed</small></div>
  </div>

  <div class="card-block">
    <h3>${ic('wallet', 14)} Payouts — auto-settled</h3>
    <p class="movie-about">Order money is settled to you <b>automatically</b> — you keep <b>92%</b>, the platform's fee is just 8% (which already covers the payment-gateway charge). No invoices to chase; we pay out on a daily batch. Just add where your money should go.</p>
    ${M.payout ? `<div class="trust-row">${ic('check', 12)} Payout set — ${esc(M.payout.upi || M.payout.bank_acc || 'account on file')} <button class="lnk" onclick="shopPayoutSheet()">Change</button></div>`
      : `<button class="btn-main sm" onclick="shopPayoutSheet()">${ic('wallet', 13)} Add payout account</button>`}
  </div>

  <div class="card-block">
    <h3>${ic('leaf', 14)} Freshness &amp; quality pledge</h3>
    <p class="movie-about">Buyers choose Orignals for genuinely fresh, honest food. Pledge that you sell fresh — no pre-made or reheated stock, no banned additives, clean handling. Keep it: a broken pledge delists your shop.</p>
    ${M.fresh ? `<div class="trust-row" style="background:#e9f7ee;border-color:#bfe6cd">${ic('check', 12)} Pledged — buyers see <b>🌿 Fresh today</b> on your shop. <button class="lnk red" onclick="S.myShop.fresh=false;save();renderShopDash()">Withdraw</button></div>`
      : `<button class="btn-main sm" onclick="shopFreshPledge()">${ic('leaf', 13)} Take the freshness pledge</button>`}
  </div>

  <div class="card-block">
    <h3>${ic('chart', 14)} What-if simulator</h3>
    <p class="movie-about">Before you change a price, simulate it. Mitra projects demand &amp; revenue across scenarios with a price-elasticity model — decision support, not a guess. (This is the Commerce World Model, running on your own numbers.)</p>
    <button class="btn-main sm" onclick="shopSimulate()">${ic('spark', 13)} Run a price simulation</button>
  </div>

  ${done.length ? (() => { const days = [...Array(7)].map((_, i) => {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - (6 - i));
      const nx = d.getTime() + 86400000;
      return { lbl: d.toLocaleDateString('en-IN', { weekday: 'narrow' }), amt: done.filter(o => o.ts >= d.getTime() && o.ts < nx).reduce((a, o) => a + o.total, 0) }; });
    const mx = Math.max(...days.map(d => d.amt), 50);
    return `<div class="card-block"><h3>${ic('chart', 14)} Sales — last 7 days</h3>
      <div class="bars">${days.map(d => `<div class="bar"><i style="height:${Math.max(d.amt / mx * 100, 3)}%"></i><small>${d.lbl}</small></div>`).join('')}</div></div>`; })() : ''}

  ${M.offer ? `<div class="offer-strip">${ic('gift', 13)} Live offer: <b>${esc(M.offer.label)}</b> — shown to nearby customers <button class="lnk red" onclick="S.myShop.offer=null;save();renderShopDash()">End</button></div>` : ''}

  ${(() => {
    const needGps = !(M.addr && M.addr.lat != null);
    const needItems = !M.items.length;
    const live = M.online && !needGps && !needItems;
    if (live) return `<div class="golive ok">${ic('check', 15)} <b>You're LIVE</b> — buyers near ${esc(M.addr.name)} can find and order from you now.</div>`;
    return `<div class="golive todo"><b>${ic('shield', 14)} To go live to buyers:</b>
      <div class="golive-steps">
        <span class="${!needItems ? 'done' : ''}">${ic(!needItems ? 'check' : 'plus', 12)} Add at least 1 item ${needItems ? '' : '✓'}</span>
        <span class="${!needGps ? 'done' : ''}">${ic(!needGps ? 'check' : 'pin', 12)} Pin your exact location ${needGps ? `<button class="lnk" onclick="shopFixLocation()">Set now</button>` : '✓'}</span>
        <span class="${M.online ? 'done' : ''}">${ic(M.online ? 'check' : 'clock', 12)} Be online ${M.online ? '✓' : `<button class="lnk" onclick="S.myShop.online=true;save();renderShopDash()">Go online</button>`}</span>
      </div></div>`;
  })()}

  <div class="btn-pair">
    <button class="btn-main sm" onclick="bulkMenuSheet()">${ic('camera', 13)} Import / scan menu</button>
    <button class="btn-main sm alt" onclick="shopItemSheet()">+ Add one item</button>
  </div>
  <div class="btn-pair">
    <button class="btn-main sm ghost" onclick="shopSetCover()">${ic('camera', 13)} ${M.photo ? 'Change' : 'Add'} shop photo</button>
    <button class="btn-main sm ghost" onclick="go('storefront')">Preview my shop</button>
  </div>
  <div class="btn-pair">
    <button class="btn-main sm ghost" onclick="offerSheet()">Create offer</button>
    <button class="btn-main sm ghost" onclick="shareShop()">Share shop link</button>
  </div>

  ${!M.items.length ? `<div class="tip-strip">${ic('spark', 13)} Restaurant with a big menu? Tap <b>Import / scan menu</b> — paste it or photograph it, and every dish is added at once.</div>` : ''}

  ${(M.reservations && M.reservations.length) ? `<div class="sec-head"><h2>Table reservations ${ic('bowl', 14)}</h2></div>
    ${M.reservations.map(r => `<div class="job-card"><div class="job-top"><span class="job-emoji">${ic('bowl', 20)}</span>
      <div><b>${esc(r.name)} · ${r.guests} guests</b><small><b class="ok">LIVE · real guest</b> · ${esc(r.day)} ${esc(r.slot)}</small></div>
      <em class="job-pay">20% off</em></div></div>`).join('')}` : ''}

  ${pend.length ? `<div class="sec-head"><h2>Orders <span class="live-dot"></span></h2></div>${pend.map(orderCard).join('')}` :
    M.items.length ? `<div class="tip-strip"> You're online — orders from nearby customers pop up here the moment they're placed.</div>` : ''}

  ${M.items.length ? `<div class="sec-head"><h2>Your menu (${M.items.length})</h2><small class="dim">tap Edit to add a photo</small></div>
  ${M.items.map((it, i) => `<div class="item-row slim">
      <div class="item-emoji">${it.photo ? `<img src="${esc(it.photo)}" alt="" loading="lazy"/>` : icOr(it.emoji, 20)}</div>
      <div class="item-info"><b>${esc(it.name)}</b>${it.section ? ` <em class="sec-tag">${esc(it.section)}</em>` : ''}${it.out ? ' <em class="out-tag">Out of stock</em>' : ''}${it.flag ? ` <em class="out-tag amber">price ${it.flag}</em>` : ''}<small>${esc(it.qty)}</small><div class="item-price">${money(it.price)}</div></div>
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
  /* alert the buyer's phone even if their app is closed */
  const alertBuyer = (title, bodyTxt) => { if (o.real && o.buyer && o.buyer.device && typeof cloudPushTo === 'function') cloudPushTo({ device_key: o.buyer.device, title, body: bodyTxt, url: '#/orders' }); };
  if (act === 'accept') { o.status = 'prep'; pushCloud('prep'); alertBuyer('Order accepted', M.name + ' is preparing your order'); toast('Order accepted — pack it up!', '📦'); }
  if (act === 'reject') { o.status = 'rejected'; pushCloud('rejected'); alertBuyer('Order refunded', M.name + ' could not take the order — money is back in your wallet'); toast('Order rejected & refunded', ''); }
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
  const it = idx != null ? S.myShop.items[idx] : { name: '', price: '', qty: '', emoji: '🛒', section: '', photo: '' };
  window._itEdit = idx;
  window._itEmoji = it.emoji;
  window._itPhoto = it.photo || '';
  const sections = [...new Set(S.myShop.items.map(x => x.section).filter(Boolean))];
  sheet(`
    <div class="sheet-grab"></div><h3 class="sheet-title">${idx != null ? 'Edit item' : 'Add item'}</h3>
    <div class="item-photo-row">
      <div class="item-photo-thumb" id="itPhotoThumb">${window._itPhoto ? `<img src="${window._itPhoto}"/>` : ic('camera', 22)}</div>
      <div><button class="btn-main sm ghost" onclick="pickPhoto(d=>setItemPhoto(d))">${ic('camera', 13)} Add photo</button>
        ${window._itPhoto ? `<button class="lnk red" onclick="setItemPhoto('')">Remove</button>` : ''}<div class="foot-note sm" style="margin:4px 0 0">A real photo sells 3× better.</div></div>
    </div>
    <label class="fld"><span>Item name</span><input class="txt" id="itName" placeholder="e.g. Paneer Butter Masala" value="${esc(it.name)}" oninput="itPriceHint()"/></label>
    <div class="fld-pair">
      <label class="fld"><span>Price (₹)</span><input class="txt" id="itPrice" inputmode="numeric" placeholder="99" value="${it.price}" oninput="itPriceHint()"/></label>
      <label class="fld"><span>Quantity / unit</span><input class="txt" id="itQty" placeholder="1 plate / 500 g" value="${esc(it.qty)}"/></label>
    </div>
    <div id="itPriceHint" class="price-hint"></div>
    <label class="fld"><span>Section <small class="dim">(optional — e.g. Starters, Mains)</small></span>
      <input class="txt" id="itSection" placeholder="Section" value="${esc(it.section || '')}" list="secList"/>
      <datalist id="secList">${sections.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
    <div class="fld"><span>Icon (used if no photo)</span><div class="chip-wrap">
      ${SHOP_ICONS.map(e => `<button class="chip emoji ${e === it.emoji ? 'on' : ''}" data-ic="${e}" onclick="window._itEmoji='${e}';$$('.chip.emoji').forEach(c=>c.classList.toggle('on',c.dataset.ic==='${e}'))">${ic(e, 17)}</button>`).join('')}</div></div>
    <button class="btn-main wide" onclick="shopItemSave()">Save item</button>`);
}
function setItemPhoto(d) { window._itPhoto = d; const t = document.getElementById('itPhotoThumb'); if (t) t.innerHTML = d ? `<img src="${d}"/>` : ic('camera', 22); }
function shopFixLocation() {
  placePickerSheet('Your shop location — search or use GPS', (p) => {
    S.myShop.addr = { name: p.name, sub: p.sub, lat: p.lat, lng: p.lng };
    if (p.lat != null && typeof geoLog === 'function') geoLog(p, 'shop');
    save(); toast('Location pinned'); renderShopDash();
  });
}
function shopSetCover() {
  pickPhoto(async (d) => {
    toast('Uploading photo…');
    let url = d;
    if (typeof cloudUploadImage === 'function') { const up = await cloudUploadImage(d, 'shop'); if (up) url = up; }
    S.myShop.photo = url; save(); toast('Shop photo set'); renderShopDash();
  });
}
let _priceHintDeb;
function itPriceHint() {
  clearTimeout(_priceHintDeb);
  _priceHintDeb = setTimeout(async () => {
    const el = document.getElementById('itPriceHint'); if (!el) return;
    const name = ($('#itName') && $('#itName').value.trim()) || '';
    const price = parseInt($('#itPrice') && $('#itPrice').value, 10);
    if (!price || !name) { el.innerHTML = ''; return; }
    const v = await cloudPriceCheck(S.myShop.cat, name, price);
    el.innerHTML = priceVerdictHTML(v);
  }, 400);
}
function priceVerdictHTML(v) {
  if (!v || v.verdict === 'ok' || v.verdict === 'invalid') return v && v.verdict === 'ok' ? `<span class="ok">${ic('check', 11)} Fair price</span>` : '';
  const range = (v.min != null) ? ` (typical ${money(v.min)}–${money(v.max)})` : '';
  if (v.verdict === 'block') return `<span class="bad">${ic('shield', 11)} This price is way outside the accepted range${range}. Please correct it.</span>`;
  if (v.verdict === 'high') return `<span class="amber">${ic('shield', 11)} Looks high${range} — buyers may skip it.</span>`;
  if (v.verdict === 'low') return `<span class="amber">${ic('shield', 11)} Looks low${range} — double-check.</span>`;
  return '';
}
async function shopItemSave() {
  const name = $('#itName').value.trim();
  const price = parseInt($('#itPrice').value, 10);
  const qty = $('#itQty').value.trim() || '1 pc';
  const section = ($('#itSection') && $('#itSection').value.trim()) || '';
  if (name.length < 2) { toast('Name the item', ''); return; }
  if (!price || price < 1) { toast('Enter a valid price', '💰'); return; }
  /* price moderation — block absurd prices */
  const v = await cloudPriceCheck(S.myShop.cat, name, price);
  if (v.verdict === 'block') { toast('Price not accepted — typical range ' + money(v.min) + '–' + money(v.max)); return; }
  toast('Saving…');
  let photoUrl = window._itPhoto;
  if (photoUrl && photoUrl.startsWith('data:') && typeof cloudUploadImage === 'function') {
    const up = await cloudUploadImage(photoUrl, 'dish'); if (up) photoUrl = up;
  }
  const item = { id: 'my' + uid(), name, price, qty, section, photo: photoUrl || '', emoji: window._itEmoji || '🛒', flag: (v.verdict === 'high' || v.verdict === 'low') ? v.verdict : null };
  if (window._itEdit != null) S.myShop.items[window._itEdit] = Object.assign(S.myShop.items[window._itEdit], item, { id: S.myShop.items[window._itEdit].id });
  else S.myShop.items.push(item);
  save(); closeSheet(); toast('Shelf updated', '🧺'); renderShopDash();
}

/* ============================================================
   PHOTOS — pick from gallery or camera, compressed on-device
   ============================================================ */
function pickPhoto(onData) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => compressImage(r.result, 1000, onData);
    r.readAsDataURL(f);
  };
  inp.click();
}
function compressImage(dataUrl, maxDim, cb) {
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    cb(c.toDataURL('image/jpeg', 0.72));
  };
  img.onerror = () => cb(dataUrl);
  img.src = dataUrl;
}

/* ============================================================
   BULK MENU IMPORT + SCANNER — paste or photograph a whole menu
   ============================================================ */
function bulkMenuSheet() {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Import your whole menu</h3>
    <div class="foot-note sm" style="text-align:left;margin:0 0 8px">Paste your menu, or scan a photo of it. One dish per line — write the price at the end. Lines with no price become a <b>section</b> heading.</div>
    <div class="btn-pair">
      <button class="btn-main sm ghost" onclick="scanMenu()">${ic('camera', 13)} Scan menu photo</button>
      <button class="btn-main sm ghost" onclick="document.getElementById('bulkText').value=bulkSample();bulkPreview()">Paste example</button>
    </div>
    <textarea class="txt" id="bulkText" rows="9" placeholder="STARTERS\nPaneer Tikka - 220\nChicken 65  240\n\nMAIN COURSE\nDal Makhani 210\nButter Naan 45" oninput="bulkPreview()" style="resize:vertical;font-family:monospace;font-size:.82rem"></textarea>
    <div id="bulkPrev"></div>
    <button class="btn-main wide" id="bulkGo" onclick="bulkImport()" disabled>Add items</button>`);
}
function bulkSample() {
  return 'STARTERS\nPaneer Tikka - 220\nChicken 65 - 240\nVeg Spring Roll 180\n\nMAIN COURSE\nDal Makhani - 210\nPaneer Butter Masala 250\nButter Chicken 320\n\nBREADS\nButter Naan - 45\nTandoori Roti 25\n\nDESSERTS\nGulab Jamun (2 pc) - 90';
}
function parseMenu(text) {
  const items = []; let section = '';
  String(text || '').split(/\n/).forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    const nums = line.match(/\d[\d,]*(?:\.\d+)?/g);
    if (!nums) { section = line.replace(/[:•\-–—]+\s*$/, '').replace(/^[•\-–—]\s*/, '').trim().slice(0, 40); return; }
    const priceStr = nums[nums.length - 1];
    const price = Math.round(parseFloat(priceStr.replace(/,/g, '')));
    const at = line.lastIndexOf(priceStr);
    let name = line.slice(0, at).replace(/(?:₹|rs\.?|inr|\bfor\b)/ig, '').replace(/[₹\-–—.:•\s]+$/, '').trim();
    if (!name) name = line.replace(priceStr, '').replace(/[₹\-–—.:•]/g, '').trim();
    if (name && price > 0 && price < 1000000) items.push({ name: name.slice(0, 60), price, section });
  });
  return items;
}
let _bulkItems = [];
function bulkPreview() {
  const ta = document.getElementById('bulkText'); if (!ta) return;
  _bulkItems = parseMenu(ta.value);
  const box = document.getElementById('bulkPrev');
  const go = document.getElementById('bulkGo');
  if (!_bulkItems.length) { box.innerHTML = `<div class="foot-note sm">Nothing detected yet — one dish per line, price at the end.</div>`; if (go) go.disabled = true; return; }
  const bySec = {};
  _bulkItems.forEach(i => { (bySec[i.section || 'Menu'] = bySec[i.section || 'Menu'] || []).push(i); });
  box.innerHTML = `<div class="bulk-count">${ic('check', 12)} <b>${_bulkItems.length}</b> items detected${Object.keys(bySec).length > 1 ? ' · ' + Object.keys(bySec).length + ' sections' : ''}</div>` +
    Object.entries(bySec).map(([s, arr]) => `<div class="bulk-sec"><small class="dim">${esc(s)}</small>${arr.map(i => `<div class="bulk-line"><span>${esc(i.name)}</span><b>${money(i.price)}</b></div>`).join('')}</div>`).join('');
  if (go) go.disabled = false;
}
async function bulkImport() {
  if (!_bulkItems.length) return;
  toast('Checking prices & adding ' + _bulkItems.length + ' items…');
  let added = 0, blocked = [];
  for (const it of _bulkItems) {
    const v = await cloudPriceCheck(S.myShop.cat, it.name, it.price);
    if (v.verdict === 'block') { blocked.push(it.name); continue; }
    S.myShop.items.push({ id: 'my' + uid(), name: it.name, price: it.price, qty: it.qty || '1 plate', section: it.section || '', emoji: '🍽', flag: (v.verdict === 'high' || v.verdict === 'low') ? v.verdict : null });
    added++;
  }
  save(); closeSheet();
  toast(added + ' items added' + (blocked.length ? ' · ' + blocked.length + ' skipped (price out of range)' : ''));
  renderShopDash();
}

/* menu scanner: photograph the physical menu → OCR → fill the textarea */
let _tessLoad;
function ensureTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (_tessLoad) return _tessLoad;
  _tessLoad = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = res; s.onerror = () => { _tessLoad = null; rej(new Error('ocr load failed')); };
    document.head.appendChild(s);
  });
  return _tessLoad;
}
function scanMenu() { pickPhoto(d => runMenuOCR(d)); }
async function runMenuOCR(dataUrl) {
  toast('Reading the menu… first scan downloads the reader (~few sec)');
  try {
    await ensureTesseract();
    const res = await Tesseract.recognize(dataUrl, 'eng');
    const ta = document.getElementById('bulkText');
    if (ta) { ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + (res.data.text || '').trim(); bulkPreview(); }
    toast('Menu read — review & fix the lines, then Add items');
  } catch (e) { toast('Could not read the photo — please type or paste the menu'); }
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

/* ============================================================
   PAPERS & VERIFICATION — list without papers, or get them made
   ============================================================ */
view('papers', () => {
  const kyc = S.partner && S.partner.status === 'verified';
  const shopV = !!S.myShop;
  const localReqs = S.docRequests || [];
  /* pull latest status from the cloud (admin advances requested→issued) */
  if (typeof cloudMyDocRequests === 'function') cloudMyDocRequests().then(rows => {
    if (!rows || !rows.length) return;
    let changed = false;
    rows.forEach(cr => {
      const lr = (S.docRequests || []).find(x => x.id === cr.id);
      if (lr && lr.status !== cr.status) { lr.status = cr.status; lr.ref = cr.ref_no || lr.ref; changed = true; }
    });
    if (changed) { save(); if (location.hash.includes('papers')) VIEWS.papers([]); }
  });

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('account')">${ic('chevl', 16)}</button>
    <div><h1>Papers &amp; verification</h1><small>No documents? List anyway — and we'll get them made for you</small></div></div>

  <div class="card-block accent-block">
    <h3>${ic('shield', 15)} You can start today — no papers needed</h3>
    <p class="movie-about">Don't have GST, FSSAI or a trade licence yet? List your shop or services under <b>your own verified identity</b> (Aadhaar/PAN). Buyers still see you as a <b>Verified Individual</b>. Add licences later to unlock higher seller tiers and B2B billing.</p>
    <div class="verify-rows">
      <div class="verify-row ${kyc ? 'ok' : ''}"><span>${ic(kyc ? 'check' : 'user', 16)}</span><div><b>Personal identity (KYC)</b><small>${kyc ? 'Verified — you can list as an individual' : 'Face + ID verification · takes a minute'}</small></div>
        <button class="lnk" onclick="${kyc ? "toast('Already verified')" : "go('earn')"}">${kyc ? 'Done' : 'Verify'}</button></div>
      <div class="verify-row ${shopV ? 'ok' : ''}"><span>${ic(shopV ? 'check' : 'store', 16)}</span><div><b>Shop listed</b><small>${shopV ? esc(S.myShop.name) + ' is live' : 'Register your shop free — 2 minutes'}</small></div>
        <button class="lnk" onclick="go('myshop')">${shopV ? 'Open' : 'List'}</button></div>
    </div>
  </div>

  ${localReqs.length ? `<div class="sec-head"><h2>Your document requests</h2></div>
    ${localReqs.map(r => {
      const steps = ['requested', 'docs_collected', 'filed', 'issued'];
      const si = Math.max(0, steps.indexOf(r.status));
      const pct = r.status === 'cancelled' ? 0 : Math.round(si / (steps.length - 1) * 100);
      return `<div class="card-block">
        <div class="doc-req-head"><b>${esc(r.name)}</b><em>${money(r.price)} · paid</em></div>
        <div class="lvl-bar"><i style="width:${pct}%"></i></div>
        <small class="dim">${DB.docStatus[r.status] || r.status}${r.ref ? ' · Ref ' + esc(r.ref) : ''}</small>
        ${(r.status === 'requested' || r.status === 'docs_collected') ? `<button class="lnk red" style="float:right" onclick="cancelDocRequest('${r.id}')">Cancel</button>` : ''}
      </div>`;
    }).join('')}` : ''}

  <div class="sec-head"><h2>Any document, made for you</h2><small class="dim">market rates · all-inclusive</small></div>
  <div class="tip-strip">${ic('check', 13)} In India a document proves everything — birth, death, marriage, property, licences. One transparent fee: government charges, filing &amp; an expert handling it. Track every step here.</div>
  <div class="search-row"><input id="docSearch" placeholder="Search — 'death certificate', 'GST', 'driving licence'…" oninput="window._docQ=this.value;VIEWS.papers([])" value="${esc(window._docQ || '')}"/></div>
  <div class="chip-row">
    <button class="chip ${!window._docCat ? 'on' : ''}" onclick="window._docCat='';VIEWS.papers([])">All</button>
    ${DB.docCats.map(c => `<button class="chip ${window._docCat === c.id ? 'on' : ''}" onclick="window._docCat='${c.id}';VIEWS.papers([])">${ic(c.icon, 13)}${c.name}</button>`).join('')}
  </div>
  ${(() => {
    const q = (window._docQ || '').toLowerCase();
    let list = DB.docServices;
    if (window._docCat) list = list.filter(d => d.cat === window._docCat);
    if (q) list = list.filter(d => (d.name + ' ' + d.desc).toLowerCase().includes(q));
    if (!list.length) return `<div class="empty"><span>${ic('search', 40)}</span><b>No document matches "${esc(window._docQ || '')}"</b><p>We handle almost every Indian document — try another word, or ask Mitra.</p></div>`;
    /* group by category for a clean directory */
    const cats = window._docCat ? [DB.docCats.find(c => c.id === window._docCat)] : DB.docCats;
    return cats.map(c => {
      const items = list.filter(d => d.cat === c.id);
      if (!items.length) return '';
      return `<div class="sec-head slim"><h2>${ic(c.icon, 14)} ${c.name}</h2></div>
      <div class="doc-grid">${items.map(d => `
        <div class="doc-card">
          <div class="doc-top"><b>${esc(d.name)}</b><em>${d.price ? money(d.price) : 'Free'}</em></div>
          <p>${esc(d.desc)}</p>
          <div class="doc-meta"><span>${ic('clock', 11)} ${esc(d.days)}</span><span>${esc(d.gov)}</span></div>
          <div class="doc-need">Needs: ${d.need.map(esc).join(' · ')}</div>
          <button class="btn-main sm wide" onclick="requestDoc('${d.id}')">${d.price ? 'Get this — ' + money(d.price) : 'Get help — free'}</button>
        </div>`).join('')}</div>`;
    }).join('');
  })()}
  <div class="foot-note">Assisted by verified professionals &amp; empanelled agents. Government fees are shown transparently. Cancel before filing for a full refund.</div>`;
});

function requestDoc(sid) {
  const d = DB.docServices.find(x => x.id === sid); if (!d) return;
  const applicant = (S.myShop && S.myShop.name) || S.user.name || '';
  const free = !d.price;
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${esc(d.name)}</h3>
    <p class="movie-about">${esc(d.desc)}</p>
    <div class="card-block bill">
      <div class="ck-line"><span>Service (all-inclusive)</span><span>${free ? '<b class="ok">Free</b>' : money(d.price)}</span></div>
      <div class="ck-line"><span>Government fee</span><span class="ok">${esc(d.gov)}</span></div>
      <div class="ck-line"><span>Expected</span><span>${esc(d.days)}</span></div>
    </div>
    <label class="fld"><span>Applicant / business name</span><input class="txt" id="docApplicant" value="${esc(applicant)}" placeholder="Name on the certificate"/></label>
    <div class="foot-note sm" style="text-align:left">You'll be asked to upload ${d.need.map(esc).join(', ')} ${free ? 'so our expert can assist you' : 'after payment'}. ${free ? '' : 'Cancel before filing = full refund.'}</div>
    <button class="btn-main wide" onclick="payDoc('${sid}')">${free ? 'Request a free callback' : 'Pay ' + money(d.price) + ' &amp; start'}</button>`);
}
function payDoc(sid) {
  const d = DB.docServices.find(x => x.id === sid); if (!d) return;
  const applicant = ($('#docApplicant') && $('#docApplicant').value.trim()) || S.user.name || 'Applicant';
  closeSheet();
  const startDoc = (final) => {
    const id = 'DOC' + rnd(10000, 99999);
    if (!S.docRequests) S.docRequests = [];
    const req = { id, serviceId: sid, name: d.name, price: final, applicant, status: 'requested', ts: Date.now() };
    S.docRequests.unshift(req); save();
    if (typeof cloudDocRequest === 'function') cloudDocRequest(req);
    confettiBurst();
    notify('Application started', d.name + ' — our team will contact you to collect documents.');
    toast(final ? 'Started! We\'ll collect your documents next.' : 'Request received — our expert will call you.');
    go('papers');
  };
  if (!d.price) { startDoc(0); return; }   // free services → no payment
  checkoutSheet({
    title: d.name, icon: 'shield', meta: 'Document assistance · ' + d.days,
    lines: [[d.name + ' (all-inclusive)', d.price]], total: d.price,
    onPay: (final) => startDoc(final)
  });
}
function cancelDocRequest(id) {
  const r = (S.docRequests || []).find(x => x.id === id); if (!r) return;
  if (!confirm('Cancel this application? Full ' + money(r.price) + ' refunds to your wallet.')) return;
  if (typeof cloudDocCancel === 'function') cloudDocCancel(id);
  r.status = 'cancelled';
  walletAdd(r.price, 'Refund · ' + r.name);
  save(); toast('Cancelled — ' + money(r.price) + ' refunded');
  go('papers');
}
