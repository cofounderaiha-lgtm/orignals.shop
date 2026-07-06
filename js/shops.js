/* ============================================================
   SHOPS — photo cards · shop page · B2B quotes · cart · tracking
   ============================================================ */

function deliveryBadge(shop) {
  if (shop.delivery === 'self') return `<span class="dbadge self">Shop delivers itself</span>`;
  if (shop.delivery === 'both') return `<span class="dbadge both">Self or partner delivery</span>`;
  return `<span class="dbadge partner">Orignals partner delivery</span>`;
}

function shopTile(s, big) {
  const img = DB.shopImgs[s.id];
  return `<div class="shop-tile ${big ? 'big' : ''}">
    <span class="tile-ic">${typeIcon(s.type, big ? 40 : 28)}</span>
    ${img ? `<img src="${img}" alt="" loading="lazy" onerror="this.remove()"/>` : ''}
    ${!big ? `<span class="rate on-img">★ ${s.rating}</span>` : ''}
    ${!big && s.offer ? `<em class="shop-offer">${esc(s.offer)}</em>` : ''}
    ${!big && !s.open ? '<i class="shop-closed">Opens later</i>' : ''}
  </div>`;
}

function shopCardHTML(s, featured) {
  return `<div class="shop-card ${featured ? 'featured' : ''} ${s.open ? '' : 'closed'}" onclick="go('shop/${s.id}')">
    ${shopTile(s)}
    <div class="shop-body">
      ${featured ? `<small class="feat-tag">${ic('spark', 11)} Closest to you</small>` : ''}
      <div class="shop-line1"><b>${esc(s.name)}</b></div>
      <div class="shop-line2">${esc(s.tag)}</div>
      <div class="shop-line3">
        <span>${ic('pin', 11)} ${s.km} km</span><span>·</span><span>${ic('clock', 11)} ${s.time >= 60 ? Math.round(s.time / 60) + ' hr' : s.time + ' min'}</span>
        ${s.b2b ? '<span>·</span><span class="b2b-tag">B2B · MOQ</span>' : ''}
      </div>
      ${deliveryBadge(s)}
    </div></div>`;
}

/* ---------- SHOP LIST ---------- */
view('shops', args => {
  const filt = args[0] || 'all';
  const q = (window._shopQ || '').toLowerCase();
  let list = [...DB.shops].sort((a, b) => a.km - b.km);
  if (filt !== 'all') list = list.filter(s => s.type === filt);
  if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || s.tag.toLowerCase().includes(q) ||
    s.items.some(i => i.name.toLowerCase().includes(q)));

  $('#view').innerHTML = `
  <div class="page-head">
    <button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>Shops near you</h1><small>${DB.shops.length} shops within 5 km of ${esc(S.user.addr.name)}</small></div>
    <button class="lnk" onclick="go('categories')">All categories</button>
  </div>
  <div class="search-row">
    <input id="shopQ" placeholder="Search shops or items — 'milk', 'biryani', 'cement'…" value="${esc(window._shopQ || '')}"
      oninput="window._shopQ=this.value;debounceShops('${filt}')"/>
    ${q ? `<button class="lnk" onclick="window._shopQ='';go('shops/${filt}')">Clear</button>` : ''}
  </div>
  <div class="chip-row sticky-chips">
    ${DB.shopTypes.map(t => `<button class="chip ${t.id === filt ? 'on' : ''}" onclick="go('shops/${t.id}')">${typeIcon(t.id, 14)}${t.name}</button>`).join('')}
  </div>
  ${list.length ? `<div class="shop-list">${list.map((s, i) => shopCardHTML(s, i === 0 && !q && filt === 'all')).join('')}</div>`
    : `<div class="empty"><span>${ic('search', 40)}</span><b>No shops found for "${esc(window._shopQ || '')}"</b><p>Every category sells on Orignals — a shop for this will onboard soon. Try another word.</p><button class="btn-main" onclick="window._shopQ='';go('shops')">Browse all shops</button></div>`}
  <div class="join-strip" onclick="go('myshop')">Own a shop? <b>List it on Orignals — free, 2 minutes</b> ${ic('arrowr', 12)}</div>`;

  const inp = $('#shopQ');
  if (q && inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
});
let _shopDeb;
function debounceShops(filt) { clearTimeout(_shopDeb); _shopDeb = setTimeout(() => VIEWS.shops([filt]), 250); }

/* ---------- SHOP PAGE ---------- */
view('shop', args => {
  const s = findShop(args[0]);
  if (!s) { go('shops'); return; }
  const vegOnly = window._vegOnly && s.type === 'food';
  const items = vegOnly ? s.items.filter(i => i.veg) : s.items;
  const best = items.filter(i => i.bestseller);
  const myRfqs = (S.rfqs || []).filter(r => r.shopId === s.id);

  const itemRow = i => `
    <div class="item-row">
      <div class="item-emoji">${typeIcon(s.type, 22)}</div>
      <div class="item-info">
        ${i.veg !== undefined ? `<span class="veg-dot ${i.veg ? 'v' : 'nv'}"></span>` : ''}
        <b>${esc(i.name)}</b>
        <small>${esc(i.qty)}${i.moq ? ` · MOQ ${i.moq}` : ''}</small>
        ${i.desc ? `<p>${esc(i.desc)}</p>` : ''}
        <div class="item-price">${money(i.price)}${i.mrp ? `<s>${money(i.mrp)}</s><em>${Math.round((1 - i.price / i.mrp) * 100)}% off</em>` : ''}${i.moq ? `<em class="moq">min ${money(i.price * i.moq)}</em>` : ''}</div>
      </div>
      <div class="item-act">${i.bestseller ? '<span class="bst">★ Bestseller</span>' : ''}${stepper(s.id, i.id)}</div>
    </div>`;

  $('#view').innerHTML = `
  <div class="shop-hero">
    ${DB.shopImgs[s.id] ? `<img src="${DB.shopImgs[s.id]}" alt="" onerror="this.remove()"/>` : ''}
    <button class="back glass" onclick="go('shops')">${ic('chevl', 16)}</button>
    <span class="shop-hero-ic">${typeIcon(s.type, 42)}</span>
  </div>
  <div class="shop-sheet">
    <div class="shop-head">
      <div><h1>${esc(s.name)}</h1><small>${esc(s.tag)}</small></div>
      <div class="rate big">★ ${s.rating}<small>${s.ratings} ratings</small></div>
    </div>
    <div class="shop-meta">
      <span>${ic('pin', 12)} ${s.km} km away</span><span>${ic('clock', 12)} ${s.time >= 60 ? Math.round(s.time / 60) + ' hr' : s.time + ' min'}</span>
      ${deliveryBadge(s)}
    </div>
    <div class="trust-row">${ic('shield', 13)} Verified seller · GST registered ${s.type === 'food' ? '· FSSAI licensed' : ''} · Secure payments</div>
    ${s.offer ? `<div class="offer-strip">${ic('gift', 13)} ${esc(s.offer)}</div>` : ''}
    ${s.b2b ? `<div class="b2b-strip">${ic('factory', 13)} Wholesale — items have minimum order quantities. GST invoice provided.
      <button class="btn-main sm alt" onclick="rfqSheet('${s.id}')">Get Best Price</button></div>` : ''}
    ${myRfqs.length ? myRfqs.map(r => `<div class="offer-strip">${ic('receipt', 13)} Quote ${r.status === 'quoted' ? `received: <b>${money(r.quote)}/${esc(r.unit)}</b> for ${r.qty} ${esc(r.unit)}s` : 'requested — supplier replies in minutes'} · ${esc(r.item)}</div>`).join('') : ''}
    ${s.type === 'food' ? `<label class="veg-toggle"><input type="checkbox" ${vegOnly ? 'checked' : ''} onchange="window._vegOnly=this.checked;VIEWS.shop(['${s.id}'])"/><span></span> Veg only</label>` : ''}

    ${best.length ? `<div class="sec-head"><h2>Bestsellers</h2></div>${best.map(itemRow).join('')}` : ''}
    <div class="sec-head"><h2>All items <small>(${items.length})</small></h2></div>
    ${items.map(itemRow).join('')}
    <div class="shop-foot">Shop ID ${s.id.toUpperCase()} · ${s.delivery === 'self' ? 'Delivers with own staff' : s.delivery === 'both' ? 'Own staff + Orignals partners' : 'Delivered by nearby Orignals partners'}</div>
  </div>`;
});

/* ---------- B2B: GET BEST PRICE (RFQ) ---------- */
function rfqSheet(shopId) {
  const s = findShop(shopId);
  window._rfqItem = 0;
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Get Best Price — ${esc(s.name)}</h3>
    <div class="fld"><span>Product</span><div class="chip-wrap" id="rfqItems">
      ${s.items.map((i, idx) => `<button class="chip ${idx === 0 ? 'on' : ''}" onclick="window._rfqItem=${idx};$$('#rfqItems .chip').forEach((c,ci)=>c.classList.toggle('on',ci===${idx}))">${esc(i.name)}</button>`).join('')}</div></div>
    <label class="fld"><span>Quantity needed</span><input class="txt" id="rfqQty" inputmode="numeric" placeholder="e.g. 500"/></label>
    <label class="fld"><span>Note (optional)</span><input class="txt" id="rfqNote" placeholder="Delivery city, timeline, specs…"/></label>
    <button class="btn-main wide" onclick="rfqSubmit('${shopId}')">Request quote</button>
    <div class="foot-note sm">Suppliers usually reply within their response time. No obligation.</div>`);
}
function rfqSubmit(shopId) {
  const s = findShop(shopId);
  const it = s.items[window._rfqItem || 0];
  const qty = parseInt($('#rfqQty').value, 10);
  if (!qty || qty < 1) { toast('Enter the quantity you need'); return; }
  if (!S.rfqs) S.rfqs = [];
  const r = { id: uid(), shopId, item: it.name, unit: it.qty.replace('per ', ''), qty, status: 'sent', ts: Date.now() };
  S.rfqs.unshift(r); save(); closeSheet();
  toast('Quote requested — supplier is typing…');
  setTimeout(() => {
    r.status = 'quoted';
    r.quote = Math.round(it.price * (qty >= (it.moq || 1) * 4 ? 0.88 : 0.94) * 100) / 100;
    save();
    notify('Best price received', `${s.name}: ${money(r.quote)}/${r.unit} for ${qty} ${r.unit}s of ${it.name}`);
    toast(`Quote in: ${money(r.quote)}/${r.unit} from ${s.name}`);
    if (location.hash.includes(shopId)) VIEWS.shop([shopId]);
  }, 4000);
}

/* ---------- CART ---------- */
view('cart', () => {
  const { sub, fee, total, shop } = cartTotal();
  if (!shop || !sub) {
    $('#view').innerHTML = `<div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button><div><h1>Basket</h1></div></div>
      <div class="empty"><span>${ic('cart', 40)}</span><b>Your basket is empty</b><p>Everything from every nearby shop fits here.</p>
      <button class="btn-main" onclick="go('shops')">Browse shops</button></div>`;
    return;
  }
  if (!S.cart.deliv || shop.delivery !== 'both') S.cart.deliv = shop.delivery === 'both' ? 'partner' : shop.delivery;
  const moqIssue = shop.b2b && Object.entries(S.cart.items).some(([iid, q]) => { const it = findItem(shop, iid); return it && it.moq && q < it.moq; });

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('shop/${shop.id}')">${ic('chevl', 16)}</button>
    <div><h1>Basket</h1><small>From ${esc(shop.name)} · ${shop.km} km</small></div></div>

  <div class="cart-items">
    ${Object.entries(S.cart.items).map(([iid, q]) => {
      const it = findItem(shop, iid); if (!it) return '';
      return `<div class="cart-row">
        <span class="cr-ic">${typeIcon(shop.type, 18)}</span>
        <div class="cr-info"><b>${esc(it.name)}</b><small>${esc(it.qty)}${it.moq ? ` · MOQ ${it.moq}` : ''}</small></div>
        ${stepper(shop.id, iid)}
        <b class="cr-amt">${money(it.price * q)}</b></div>`;
    }).join('')}
  </div>
  ${moqIssue ? `<div class="warn-strip">Wholesale items are below their minimum order quantity — increase quantity to proceed.</div>` : ''}

  <div class="card-block">
    <h3>Delivery</h3>
    ${shop.delivery === 'both' ? `
      <label class="radio-row ${S.cart.deliv === 'partner' ? 'on' : ''}" onclick="S.cart.deliv='partner';save();VIEWS.cart([])">
        <i></i><div><b>Nearby Orignals partner</b><small>A verified partner passing by picks it up — usually fastest</small></div></label>
      <label class="radio-row ${S.cart.deliv === 'self' ? 'on' : ''}" onclick="S.cart.deliv='self';save();VIEWS.cart([])">
        <i></i><div><b>Shop delivers itself</b><small>${esc(shop.name)}'s own delivery staff</small></div></label>`
    : S.cart.deliv === 'self'
      ? `<div class="radio-row on static"><i></i><div><b>Shop delivers itself</b><small>${esc(shop.name)} delivers with own staff</small></div></div>`
      : `<div class="radio-row on static"><i></i><div><b>Nearby Orignals partner</b><small>A verified partner passing by will carry your order</small></div></div>`}
    <div class="addr-row" onclick="pickAddress(()=>VIEWS.cart([]))">
      <span>${ic('pin', 18)}</span><div><b>Deliver to ${esc(S.user.addr.name)}</b><small>${esc(S.user.addr.sub)}</small></div><em>Change</em></div>
  </div>

  <div class="card-block bill">
    <h3>Bill details</h3>
    <div class="ck-line"><span>Items total</span><span>${money(sub)}</span></div>
    <div class="ck-line"><span>Delivery fee ${fee === 0 ? '(free above ₹199)' : ''}</span><span>${fee === 0 ? '<b class="ok">FREE</b>' : money(fee)}</span></div>
    <div class="ck-line grand"><span>Grand total</span><span>${money(total)}</span></div>
  </div>

  <button class="btn-main wide ${moqIssue ? 'dis' : ''}" onclick="${moqIssue ? `toast('Meet the MOQ first')` : 'cartCheckout()'}">
    Proceed to pay · ${money(total)}</button>
  <div class="foot-note">100% of item price goes to the shop. Partner delivery fee goes to the person who carries it.</div>`;
});

function cartCheckout() {
  const { sub, fee, total, shop } = cartTotal();
  checkoutSheet({
    title: 'Order from ' + shop.name, icon: 'store',
    meta: (S.cart.deliv === 'self' ? 'Shop delivers itself' : 'Nearby partner delivery') + ' · to ' + S.user.addr.name,
    lines: [['Items total', sub], ['Delivery fee', fee]], total,
    onPay: (final) => {
      const items = Object.entries(S.cart.items).map(([iid, q]) => { const it = findItem(shop, iid); return { name: it.name, q, price: it.price }; });
      const o = createOrder({
        kind: 'shop', flow: S.cart.deliv === 'self' ? 'shop_self' : 'shop_partner',
        title: shop.name + ' · ' + items.length + ' item' + (items.length > 1 ? 's' : ''),
        shopId: shop.id, items, total: final, addr: S.user.addr
      });
      S.cart = { shopId: null, items: {} }; save();
      go('track/' + o.id);
    }
  });
}

/* ---------- address picker (with real GPS) ---------- */
function pickAddress(onDone) {
  window._addrDone = onDone;
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Deliver where?</h3>
    <div class="search-row"><input placeholder="Search any address in India…" oninput="geoPickSearch(this.value)"/></div>
    <div id="geoResults"></div>
    <button class="place-row gps" onclick="useGPS()">
      <span class="gps-ic">${ic('pin', 18)}</span><div><b>Use my current location</b><small>Live GPS — for instant 10–20 min delivery</small></div><em>Locate</em></button>
    ${DB.places.map((p, i) => `<button class="place-row" onclick="S.user.addr=DB.places[${i}];save();closeSheet();refreshChrome();window._addrDone&&window._addrDone()">
      <span>${ic('pin', 17)}</span><div><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></div><em>${p.km} km</em></button>`).join('')}`);
}
function useGPS() {
  if (!navigator.geolocation) { toast('GPS not available in this browser'); return; }
  toast('Locating you…');
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: la, longitude: lo, accuracy } = pos.coords;
    S.user.addr = { id: 'gps', name: 'Current location', sub: `GPS ${la.toFixed(4)}, ${lo.toFixed(4)} (±${Math.round(accuracy)} m)`, icon: 'pin', km: 0, gps: [la, lo] };
    save(); closeSheet(); refreshChrome();
    toast('Live location set — instant delivery enabled');
    notify('Location updated', `Delivering to GPS ${la.toFixed(4)}, ${lo.toFixed(4)} — shops within minutes of you.`);
    window._addrDone && window._addrDone();
  }, () => toast('Location permission denied — pick a saved address'), { enableHighAccuracy: true, timeout: 8000 });
}

/* ---------- LIVE TRACKING ---------- */
view('track', args => {
  $('#view').innerHTML = `<div data-live-order="${esc(args[0])}" id="trackWrap"></div>`;
  renderTrack(args[0]);
});

function renderTrack(oid) {
  const wrap = $('#trackWrap'); if (!wrap) return;
  const o = S.orders.find(x => x.id === oid);
  if (!o) { wrap.innerHTML = `<div class="empty"><span>${ic('search', 40)}</span><b>Order ${esc(oid)} not found</b><p>Check the order ID and try again.</p></div>`; return; }
  const done = orderDone(o);
  const st = orderStage(o);
  const total = FLOWS[o.flow].length - 1;
  const prog = Math.min(st / total, 1);

  wrap.innerHTML = `
  <div class="page-head"><button class="back" onclick="go('orders')">${ic('chevl', 16)}</button>
    <div><h1>${done ? 'Delivered' : esc(orderStatus(o).t)}</h1><small>${esc(o.title)} · ${o.id}${S.user.addr.gps ? ' · GPS live' : ''}</small></div></div>

  <div class="track-map">
    <svg viewBox="0 0 400 190">
      <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1A5632"/><stop offset="1" stop-color="#0F3B21"/></linearGradient></defs>
      ${[0,1,2,3,4,5].map(i => `<line x1="${i*80}" y1="0" x2="${i*80}" y2="190" class="grid"/>`).join('')}
      ${[0,1,2,3].map(i => `<line x1="0" y1="${i*63}" x2="400" y2="${i*63}" class="grid"/>`).join('')}
      <path d="M40 150 C 120 150, 130 45, 210 45 S 330 110, 360 60" class="route-bg"/>
      <path d="M40 150 C 120 150, 130 45, 210 45 S 330 110, 360 60" class="route" style="stroke-dasharray:420;stroke-dashoffset:${420 - 420 * prog}"/>
      <circle cx="40" cy="150" r="7" fill="#1A5632"/><text x="40" y="175" class="map-lbl">${o.kind === 'ride' ? 'Pickup' : 'Shop'}</text>
      <circle cx="360" cy="60" r="7" fill="#C84B31"/><text x="360" y="40" class="map-lbl">${o.kind === 'ride' ? 'Drop' : 'You'}</text>
      <g style="offset-path:path('M40 150 C 120 150, 130 45, 210 45 S 330 110, 360 60');offset-distance:${prog * 100}%" class="mover">
        <circle r="12" fill="url(#rg)"/>${icNested('bike', 13)}</g>
    </svg>
    ${done ? '' : `<div class="eta-pill">~${Math.max(1, Math.round((FLOW_T[o.flow][total] - (Date.now() - o.placedAt) / 1000) / 60 * 10) / 10)} min left · Live</div>`}
  </div>

  ${o.partner && st >= 1 ? `
  <div class="partner-card">
    <span class="pc-ava">${ic('user', 22)}</span>
    <div class="pc-info"><b>${esc(o.partner.name)}</b><small>★ ${o.partner.rating} · ${o.partner.trips.toLocaleString('en-IN')} trips · ${esc(o.partner.veh)}</small></div>
    ${done ? '' : `<div class="pc-otp">OTP<b>${o.partner.otp}</b></div>`}
    <button class="pc-call" onclick="toast('Calling ${esc(o.partner.name)}… (demo)')">${ic('phone', 16)}</button>
  </div>
  <div class="foot-note sm">${ic('shield', 12)} Your partner is registered &amp; verified — ID, vehicle and background checked.</div>` : ''}

  ${timelineHTML(o)}

  <div class="card-block">
    <h3>Order summary</h3>
    ${(o.items || []).map(i => `<div class="ck-line"><span>${esc(i.name)} × ${i.q}</span><span>${money(i.price * i.q)}</span></div>`).join('')}
    ${o.detail ? `<div class="ck-line"><span>${esc(o.detail)}</span><span></span></div>` : ''}
    <div class="ck-line grand"><span>Paid</span><span>${money(o.total)}</span></div>
  </div>

  ${o.cancelled ? `<div class="warn-strip">${ic('x', 13)} Cancelled — <b>${money(o.total)} refunded</b> to your wallet. No questions asked.</div>` : ''}
  ${!done && canCancel(o) ? `<button class="btn-main wide ghost red" onclick="if(confirm('Cancel this order? Full ${money(o.total)} refunds to wallet instantly.'))cancelOrder('${o.id}')">Cancel order — full refund</button>` : ''}
  ${done && !o.rated && !o.cancelled ? `
  <div class="card-block rate-block">
    <h3>Rate this ${o.kind === 'ride' ? 'ride' : 'delivery'}</h3>
    <div class="rate-stars">${[1,2,3,4,5].map(n => `<button onclick="rateOrder('${o.id}',${n})">☆</button>`).join('')}</div>
  </div>` : ''}
  ${done && o.rated ? `<div class="card-block"><h3>Thanks for rating ${'★'.repeat(o.rated)}</h3></div>` : ''}
  ${done && o.kind === 'shop' && !o.cancelled ? `<button class="btn-main wide ghost" onclick="reorder('${o.id}')">Reorder the same</button>` : ''}
  <button class="btn-main wide ghost" onclick="toast('Tell Mitra your issue — opening chat');setTimeout(()=>go('mitra'),600)">Need help with this order?</button>`;
}

function rateOrder(oid, n) {
  const o = S.orders.find(x => x.id === oid); if (!o) return;
  o.rated = n; save(); confettiBurst(); toast('Thanks! ' + '★'.repeat(n) + ' given');
  renderTrack(oid);
}
function reorder(oid) {
  const o = S.orders.find(x => x.id === oid); if (!o || !o.shopId) return;
  const shop = findShop(o.shopId); if (!shop) return;
  S.cart = { shopId: o.shopId, items: {} };
  o.items.forEach(i => { const it = shop.items.find(x => x.name === i.name); if (it) S.cart.items[it.id] = i.q; });
  save(); go('cart');
}

/* ---------- ORDERS HUB (with track-by-ID) ---------- */
view('orders', () => {
  const act = activeOrders(), past = S.orders.filter(o => orderDone(o));
  const row = o => {
    const f = orderStatus(o);
    return `<div class="order-row" onclick="go('track/${o.id}')">
      <span class="or-emoji">${kindIcon(o.kind, 18)}</span>
      <div class="or-info"><b>${esc(o.title)}</b>
        <small>${o.id} · ${new Date(o.placedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
      <div class="or-right"><b>${money(o.total)}</b><span class="or-status ${orderDone(o) ? 'done' : 'live'}">${orderDone(o) ? '✓ ' + f.t : f.t}</span></div></div>`;
  };
  const tks = S.tickets || [], bks = S.bookings || [];
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button><div><h1>Your orders</h1><small>Shops · parcels · rides · tickets — one place</small></div></div>
  <div class="search-row">
    <input id="trackId" placeholder="Track by order ID — e.g. OM48213" style="text-transform:uppercase"
      onkeydown="if(event.key==='Enter')trackById()"/>
    <button class="btn-main sm" style="margin:0" onclick="trackById()">Track</button>
  </div>
  ${act.length ? `<div class="sec-head"><h2>Live now <span class="live-dot"></span></h2></div>${act.map(row).join('')}` : ''}
  ${tks.length || bks.length ? `<div class="sec-head"><h2>Tickets &amp; bookings</h2></div>
    ${tks.map(t => `<div class="order-row" onclick="go('ticket/${t.id}')">
      <span class="or-emoji">${ic('star', 18)}</span>
      <div class="or-info"><b>${esc(t.title)}</b><small>${esc(t.sub)}</small></div>
      <div class="or-right"><b>${money(t.total)}</b><span class="or-status done">Confirmed</span></div></div>`).join('')}
    ${bks.map(b => `<div class="order-row static">
      <span class="or-emoji">${ic('bowl', 18)}</span>
      <div class="or-info"><b>Table at ${esc(b.shop)}</b><small>${esc(b.day)} · ${esc(b.slot)} · ${b.guests} guests</small></div>
      <div class="or-right"><span class="or-status done">Reserved</span></div></div>`).join('')}` : ''}
  <div class="sec-head"><h2>Past</h2></div>
  ${past.length ? past.map(row).join('') : `<div class="empty"><span>${ic('receipt', 40)}</span><b>Nothing yet</b><p>Your orders, parcels and rides will appear here.</p><button class="btn-main" onclick="go('shops')">Start shopping</button></div>`}`;
});
function trackById() {
  const id = ($('#trackId').value || '').trim().toUpperCase();
  if (!id) return;
  if (S.orders.some(o => o.id === id)) go('track/' + id);
  else toast('No order found with ID ' + id);
}
