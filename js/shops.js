/* ============================================================
   SHOPS — photo cards · shop page · B2B quotes · cart · tracking
   ============================================================ */

function deliveryBadge(shop) {
  if (shop.delivery === 'self') return `<span class="dbadge self">Shop delivers itself</span>`;
  if (shop.delivery === 'both') return `<span class="dbadge both">Self or partner delivery</span>`;
  return `<span class="dbadge partner">Orignals partner delivery</span>`;
}

/* stable named inspector per shop — same person every time */
function inspectorFor(s) {
  let h = 0; const id = String(s.id);
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return DB.inspectors[h % DB.inspectors.length];
}
function inspectorLine(s) {
  if (!['organic', 'food', 'grocery', 'dairy', 'pharmacy'].includes(s.type)) return '';
  const ins = inspectorFor(s);
  const hour = new Date().getHours();
  const when = hour < 12 ? 'this morning' : hour < 17 ? 'at noon today' : 'this morning';
  return `<div class="inspector-line">${ic('shield', 12)} Checked ${when} by <b>Inspector ${esc(ins.name)}</b> · ${esc(ins.area)} circle</div>`;
}

function shopTile(s, big) {
  const img = DB.shopImgs[s.id] || s.img;
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
      <div class="shop-line1"><b>${esc(s.name)}</b><span class="vbadge">${ic('check', 9)} VERIFIED</span></div>
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
  /* pull in shops registered on other devices (throttled to 1/min);
     when new ones arrive while the list is open, re-render seamlessly */
  if (typeof cloudShopsRefresh === 'function') {
    cloudShopsRefresh(() => { if (location.hash.replace('#/', '').split('/')[0] === 'shops') VIEWS.shops(args); });
  }
  const filt = args[0] || 'all';
  const q = (window._shopQ || '').toLowerCase();
  const sort = window._shopSort || 'relevance';
  window._shopFilters = window._shopFilters || {};
  const F = window._shopFilters;
  let list = [...DB.shops];
  if (filt !== 'all') list = list.filter(s => s.type === filt);
  if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || s.tag.toLowerCase().includes(q) ||
    s.items.some(i => i.name.toLowerCase().includes(q)));
  /* market-level filters */
  if (F.veg) list = list.filter(s => s.veg);
  if (F.offer) list = list.filter(s => s.offer);
  if (F.open) list = list.filter(s => s.open);
  if (F.free) list = list.filter(s => s.delivery !== 'partner' || (s.offer && /free/i.test(s.offer)));
  /* market-level sort */
  const minPrice = s => Math.min(...s.items.map(i => i.price), 1e9);
  const sorters = {
    relevance: (a, b) => (b.open - a.open) || (a.km - b.km),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    near: (a, b) => a.km - b.km,
    fast: (a, b) => (a.time || 99) - (b.time || 99),
    price: (a, b) => minPrice(a) - minPrice(b)
  };
  list.sort(sorters[sort] || sorters.relevance);
  const activeFilters = Object.values(F).filter(Boolean).length;

  const sortOpts = [['relevance', 'Relevance'], ['rating', 'Top rated'], ['near', 'Nearest'], ['fast', 'Fastest'], ['price', 'Price: low']];

  $('#view').innerHTML = `
  <div class="page-head">
    <button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>Shops near you</h1><small>${list.length} of ${DB.shops.length} shops near ${esc(S.user.addr.name)}</small></div>
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
  <div class="sortbar">
    <button class="sortbtn ${activeFilters ? 'on' : ''}" onclick="shopFilterSheet()">${ic('grid', 13)} Filters${activeFilters ? ' · ' + activeFilters : ''}</button>
    <div class="sortscroll">
      ${sortOpts.map(o => `<button class="sortchip ${sort === o[0] ? 'on' : ''}" onclick="window._shopSort='${o[0]}';VIEWS.shops(['${filt}'])">${o[1]}</button>`).join('')}
    </div>
  </div>
  ${list.length ? `<div class="shop-list">${list.map((s, i) => shopCardHTML(s, i === 0 && !q && filt === 'all' && sort === 'relevance')).join('')}</div>`
    : `<div class="empty"><span>${ic('search', 40)}</span><b>No shops match</b><p>${activeFilters ? 'Try removing a filter, or ' : ''}search another word — every category onboards to Orignals.</p><button class="btn-main" onclick="window._shopQ='';window._shopFilters={};go('shops')">Reset</button></div>`}
  <div class="join-strip" onclick="go('myshop')">Own a shop? <b>List it on Orignals — free, 2 minutes</b> ${ic('arrowr', 12)}</div>`;

  const inp = $('#shopQ');
  if (q && inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
});
let _shopDeb;
function debounceShops(filt) { clearTimeout(_shopDeb); _shopDeb = setTimeout(() => VIEWS.shops([filt]), 250); }

function shopFilterSheet() {
  const F = window._shopFilters || (window._shopFilters = {});
  const opts = [['veg', 'Pure veg', 'leaf'], ['offer', 'Has offers', 'gift'], ['open', 'Open now', 'clock'], ['free', 'Free delivery', 'truck']];
  const render = () => { $('#sheetBody').innerHTML = `
    <div class="sheet-grab"></div><h3 class="sheet-title">Filters</h3>
    ${opts.map(o => `<label class="agree-row ${F[o[0]] ? 'on' : ''}" onclick="window._shopFilters['${o[0]}']=!window._shopFilters['${o[0]}'];window._sfR()">
      <i>${F[o[0]] ? '✓' : ''}</i><span>${ic(o[2], 14)} <b>${o[1]}</b></span></label>`).join('')}
    <div class="btn-pair" style="margin-top:12px">
      <button class="btn-main ghost" onclick="window._shopFilters={};window._sfR()">Clear all</button>
      <button class="btn-main" onclick="closeSheet();VIEWS.shops(['${(location.hash.split('/')[1] || 'all')}'])">Show results</button>
    </div>`; };
  window._sfR = render; sheet(''); render();
}

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
      <div class="item-emoji">${i.photo ? `<img src="${esc(i.photo)}" alt="" loading="lazy"/>` : typeIcon(s.type, 22)}</div>
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
    ${(DB.shopImgs[s.id] || s.img) ? `<img src="${DB.shopImgs[s.id] || s.img}" alt="" onerror="this.remove()"/>` : ''}
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
    ${inspectorLine(s)}
    ${s.offer ? `<div class="offer-strip">${ic('gift', 13)} ${esc(s.offer)}</div>` : ''}
    ${s.b2b ? `<div class="b2b-strip">${ic('factory', 13)} Wholesale — items have minimum order quantities. GST invoice provided.
      <button class="btn-main sm alt" onclick="rfqSheet('${s.id}')">Get Best Price</button></div>` : ''}
    ${myRfqs.length ? myRfqs.map(r => `<div class="offer-strip">${ic('receipt', 13)} Quote ${r.status === 'quoted' ? `received: <b>${money(r.quote)}/${esc(r.unit)}</b> for ${r.qty} ${esc(r.unit)}s` : 'requested — supplier replies in minutes'} · ${esc(r.item)}</div>`).join('') : ''}
    ${s.type === 'food' ? `<label class="veg-toggle"><input type="checkbox" ${vegOnly ? 'checked' : ''} onchange="window._vegOnly=this.checked;VIEWS.shop(['${s.id}'])"/><span></span> Veg only</label>` : ''}

    ${best.length ? `<div class="sec-head"><h2>Bestsellers</h2></div>${best.map(itemRow).join('')}` : ''}
    ${(() => {
      const sections = [...new Set(items.map(i => i.section).filter(Boolean))];
      if (sections.length > 1) {
        /* sectioned menu (restaurants): group by section */
        return sections.map(sec => `<div class="sec-head"><h2>${esc(sec)}</h2></div>${items.filter(i => i.section === sec).map(itemRow).join('')}`).join('') +
          (items.some(i => !i.section) ? `<div class="sec-head"><h2>More</h2></div>${items.filter(i => !i.section).map(itemRow).join('')}` : '');
      }
      return `<div class="sec-head"><h2>All items <small>(${items.length})</small></h2></div>${items.map(itemRow).join('')}`;
    })()}
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
  const { sub, gst, platformFee, deliveryFee, total, shop } = cartTotal();
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
    ${gst ? `<div class="ck-line"><span>GST</span><span>${money(gst)}</span></div>` : ''}
    <div class="ck-line"><span>Platform fee <small class="dim">(5%)</small></span><span>${money(platformFee)}</span></div>
    <div class="ck-line"><span>Delivery fee ${deliveryFee === 0 ? '' : `· ${shop.km} km`}</span><span>${deliveryFee === 0 ? '<b class="ok">FREE</b>' : money(deliveryFee)}</span></div>
    <div class="ck-line grand"><span>To pay</span><span>${money(total)}</span></div>
  </div>

  <button class="btn-main wide ${moqIssue ? 'dis' : ''}" onclick="${moqIssue ? `toast('Meet the MOQ first')` : 'cartCheckout()'}">
    Proceed to pay · ${money(total)}</button>
  <div class="foot-note">No subscription — you only pay per order. <b>100% of the item price goes to the shop</b>; the delivery fee goes to whoever carries it. Our platform fee is a flat 5% (it covers payment charges too).</div>`;
});

function cartCheckout() {
  const { sub, gst, platformFee, deliveryFee, total, shop } = cartTotal();
  checkoutSheet({
    title: 'Order from ' + shop.name, icon: 'store',
    meta: (S.cart.deliv === 'self' ? 'Shop delivers itself' : 'Nearby partner delivery') + ' · to ' + S.user.addr.name,
    lines: [['Items total', sub], ...(gst ? [['GST', gst]] : []), ['Platform fee (5%)', platformFee], ['Delivery fee', deliveryFee]], total,
    onPay: (final) => {
      const items = Object.entries(S.cart.items).map(([iid, q]) => { const it = findItem(shop, iid); return { name: it.name, q, price: it.price }; });
      const o = createOrder({
        kind: 'shop', flow: S.cart.deliv === 'self' ? 'shop_self' : 'shop_partner',
        km: +shop.km || undefined,
        cloudShop: !!shop.community,
        title: shop.name + ' · ' + items.length + ' item' + (items.length > 1 ? 's' : ''),
        shopId: shop.id, items, total: final, addr: S.user.addr,
        bill: { sub, gst, platformFee, deliveryFee, total: final }, shopName: shop.name, shopGst: shop.gst || null
      });
      /* community shop: the order lands LIVE on the shopkeeper's device */
      if (o.cloudShop && typeof cloudPostShopOrder === 'function') cloudPostShopOrder(o, shop);
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

/* ---------- INVOICE / BILL (GST-style, printable) ---------- */
view('invoice', args => {
  const o = S.orders.find(x => x.id === args[0]);
  if (!o) { go('orders'); return; }
  const b = o.bill || { sub: o.total, gst: 0, platformFee: 0, deliveryFee: 0, total: o.total };
  const gstHalf = b.gst ? Math.round(b.gst / 2) : 0;
  const d = new Date(o.placedAt);
  $('#view').innerHTML = `
  <div class="page-head noprint"><button class="back" onclick="go('track/${o.id}')">${ic('chevl', 16)}</button>
    <div><h1>Bill / Invoice</h1><small>${o.id}</small></div>
    <button class="lnk" onclick="window.print()">${ic('upload', 13)} Print / Save PDF</button></div>
  <div class="invoice" id="invoiceDoc">
    <div class="inv-head">
      <div><div class="inv-logo"><svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#1A5632"/><path d="M12 5.2l1.6 5.2 5.2 1.6-5.2 1.6L12 18.8l-1.6-5.2L5.2 12l5.2-1.6z" fill="#E8A020"/></svg> Orig<b>nals</b></div>
        <small>Tax Invoice / Bill of Supply</small></div>
      <div class="inv-meta"><b>${o.id}</b><small>${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</small></div>
    </div>
    <div class="inv-parties">
      <div><small>Sold by</small><b>${esc(o.shopName || (findShop(o.shopId) || {}).name || 'Shop')}</b>${o.shopGst ? `<small>GSTIN: ${esc(o.shopGst)}</small>` : '<small>Unregistered supplier</small>'}</div>
      <div><small>Billed to</small><b>${esc(S.user.name || 'Customer')}</b><small>${esc((o.addr && o.addr.name) || S.user.addr.name)}</small></div>
    </div>
    <table class="inv-table"><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>${(o.items || []).map(i => `<tr><td>${esc(i.name)}</td><td>${i.q}</td><td>${moneyINR(i.price)}</td><td>${moneyINR(i.price * i.q)}</td></tr>`).join('')}</tbody></table>
    <div class="inv-totals">
      <div class="ck-line"><span>Items total</span><span>${moneyINR(b.sub)}</span></div>
      ${b.gst ? `<div class="ck-line"><span>CGST (2.5%)</span><span>${moneyINR(gstHalf)}</span></div>
      <div class="ck-line"><span>SGST (2.5%)</span><span>${moneyINR(b.gst - gstHalf)}</span></div>` : ''}
      <div class="ck-line"><span>Platform fee</span><span>${moneyINR(b.platformFee)}</span></div>
      <div class="ck-line"><span>Delivery fee</span><span>${b.deliveryFee ? moneyINR(b.deliveryFee) : 'FREE'}</span></div>
      <div class="ck-line grand"><span>Total paid</span><span>${moneyINR(b.total)}</span></div>
    </div>
    <div class="inv-foot">
      <div>Payment: ${o.cancelled ? 'Refunded' : 'Paid'} · Order ${o.id}</div>
      ${CUR.code !== 'INR' ? `<div>Displayed elsewhere as ${money(b.total)} — charged in INR.</div>` : ''}
      <div>100% of the item price is paid to the shop. This is a computer-generated invoice.</div>
      <div>Orignals — every shop, every street, everyone earns.</div>
    </div>
  </div>`;
});

/* ---------- real scannable QR (lazy-loaded generator) ---------- */
let _qrLoad;
function ensureQR() {
  if (window.qrcode) return Promise.resolve();
  if (_qrLoad) return _qrLoad;
  _qrLoad = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    s.onload = res; s.onerror = () => { _qrLoad = null; rej(); }; document.head.appendChild(s);
  });
  return _qrLoad;
}
function qrRender(elId, text) {
  ensureQR().then(() => {
    const el = document.getElementById(elId); if (!el || !window.qrcode) return;
    try {
      const qr = window.qrcode(0, 'M'); qr.addData(String(text)); qr.make();
      el.innerHTML = qr.createImgTag(4, 0);
      const img = el.querySelector('img'); if (img) { img.style.width = '100%'; img.style.height = 'auto'; img.style.imageRendering = 'pixelated'; img.style.display = 'block'; }
    } catch (e) {}
  }).catch(() => {});
}

/* ---------- LIVE TRACKING ---------- */
view('track', args => {
  $('#view').innerHTML = `<div data-live-order="${esc(args[0])}" id="trackWrap"></div>`;
  renderTrack(args[0]);
});

function trackEtaText(o) {
  if (o.cloudShop) {
    const t = { new: 'Waiting for the shop to accept', prep: 'Shop is packing your order', finding: 'Shop is calling a partner', handed: 'On the way to you', selfout: 'Shop is on the way' };
    return (t[o.cloudStatus || 'new'] || 'Live') + ' · Live';
  }
  const times = orderTimes(o);
  return `~${Math.max(1, Math.round((times[times.length - 1] - (Date.now() - o.placedAt) / 1000) / 60 * 10) / 10)} min left · Live`;
}

function renderTrack(oid) {
  const wrap = $('#trackWrap'); if (!wrap) return;
  const o = S.orders.find(x => x.id === oid);
  if (!o) { wrap.innerHTML = `<div class="empty"><span>${ic('search', 40)}</span><b>Order ${esc(oid)} not found</b><p>Check the order ID and try again.</p></div>`; return; }
  const done = orderDone(o);
  const st = orderStage(o);

  /* rebuild the DOM only when the stage changes; between stages just
     move the live courier marker and refresh the ETA — no flicker */
  const sig = [o.id, st, o.cancelled ? 1 : 0, o.rated || 0].join(':');
  if (wrap.dataset.sig === sig) {
    trackLiveMap('trkMap', o);
    const eta = $('#trkEta'); if (eta && !done && !o.cancelled) eta.textContent = trackEtaText(o);
    return;
  }
  wrap.dataset.sig = sig;

  wrap.innerHTML = `
  <div class="page-head"><button class="back" onclick="go('orders')">${ic('chevl', 16)}</button>
    <div><h1>${done ? 'Delivered' : esc(orderStatus(o).t)}</h1><small>${esc(o.title)} · ${o.id}${S.user.addr.gps ? ' · GPS live' : ''}</small></div></div>

  <div class="track-map real">
    <div id="trkMap" class="route-canvas full"></div>
    ${done || o.cancelled ? '' : `<div class="eta-pill" id="trkEta">${trackEtaText(o)}</div>`}
  </div>

  ${(() => {
    /* prefer the REAL partner who actually claimed this order (cloud) */
    const rp = o.realPartner;
    const p = rp ? { name: rp.taken_name, veh: rp.taken_veh, rating: rp.taken_rating || 4.8, trips: null } : o.partner;
    if (!p || (st < 1 && !rp)) return '';
    return `
  <div class="partner-card">
    <span class="pc-ava">${ic('user', 22)}</span>
    <div class="pc-info"><b>${esc(p.name)} <small class="dim">★ ${(+p.rating || 4.8).toFixed(1)}</small></b>
      <small>${esc(p.veh || p.car || 'Verified partner')}${p.trips ? ' · ' + p.trips.toLocaleString('en-IN') + ' trips' : ''}</small>
      ${!done && !o.cancelled ? `<small class="ok">${rp ? (rp.picked_at ? 'On the way to you — live' : 'Heading to the shop') : 'Arriving soon'}</small>` : ''}</div>
    ${!done ? `<button class="pc-call" onclick="callOrder('${o.id}')" title="Call in-app — no numbers shared">${ic('phone', 16)}</button>` : ''}
  </div>
  ${!done && !o.cancelled ? `
  <div class="handover-card">
    <div class="ho-otp"><small>SHOW THIS TO YOUR DELIVERY PARTNER</small><b>${o.partner ? o.partner.otp : '—'}</b><span>delivery OTP</span></div>
    <div class="ho-qr" id="hoQR">${ic('grid', 20)}</div>
  </div>
  <div class="foot-note sm">${ic('shield', 12)} The partner enters this OTP (or scans the QR) to complete delivery. Your name &amp; number are never shared — calls happen inside the app.</div>` : ''}`;
  })()}

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
  ${o.kind === 'shop' ? `<button class="btn-main wide ghost" onclick="go('invoice/${o.id}')">${ic('receipt', 14)} View bill / invoice</button>` : ''}
  <button class="btn-main wide ghost" onclick="toast('Tell Mitra your issue — opening chat');setTimeout(()=>go('mitra'),600)">Need help with this order?</button>`;
  trackLiveMap('trkMap', o);
  /* render the real, scannable handover QR (encodes the OTP) */
  if (o.partner && !done && !o.cancelled) qrRender('hoQR', 'ORIGNALS:' + o.id + ':' + o.partner.otp);
  /* fetch the REAL partner who claimed this order (live, cross-device) */
  if (o.cloudShop && !done && !o.cancelled && typeof cloudJobForOrder === 'function') {
    if (Date.now() - (o._rpAt || 0) > 6000) {
      o._rpAt = Date.now();
      cloudJobForOrder(o.id).then(job => {
        if (!job || !job.taken_name) return;
        const changed = !o.realPartner || o.realPartner.partner_lat !== job.partner_lat || o.realPartner.taken_name !== job.taken_name;
        o.realPartner = job;
        if (job.partner_lat != null) o.partnerLive = { lat: +job.partner_lat, lng: +job.partner_lng };
        if (changed && location.hash.includes('track')) { wrap.dataset.sig = ''; renderTrack(oid); }
      });
    }
  }
}

/* ---------- in-app contact: NO number exchange, all in our backend ---------- */
function callOrder(oid) {
  const o = S.orders.find(x => x.id === oid);
  const who = (o && o.realPartner && o.realPartner.taken_name) || (o && o.partner && o.partner.name) || 'your partner';
  if (typeof callStart === 'function') { callStart(oid, who); return; }
  /* honest interim until in-app voice is live: connect via Mitra, numbers never shared */
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Contact ${esc(who)}</h3>
    <div class="trust-row">${ic('shield', 13)} Your name &amp; number are never shared — everything stays inside Orignals.</div>
    <button class="place-row" onclick="closeSheet();toast('Opening chat');setTimeout(()=>go('mitra'),400)">
      <span>${ic('spark', 17)}</span><div><b>Message via Mitra</b><small>Send a note about this order — no numbers exchanged</small></div><em>Chat</em></button>
    <div class="foot-note sm">In-app voice calling (private, number-free) is rolling out soon. Until then, the OTP/QR completes your handover safely.</div>`);
}

function cancelScheduled(i) {
  const r = (S.scheduled || [])[i]; if (!r) return;
  if (!confirm('Cancel your scheduled ride at ' + r.when + '? Full refund to wallet.')) return;
  S.scheduled.splice(i, 1);
  walletAdd(r.total, 'Refund · scheduled ride · ' + r.title);
  save(); toast('Scheduled ride cancelled — ' + money(r.total) + ' refunded');
  VIEWS.orders([]);
}

function rateOrder(oid, n) {
  const o = S.orders.find(x => x.id === oid); if (!o) return;
  o.rated = n; save(); confettiBurst(); toast('Thanks! ' + '★'.repeat(n) + ' given');
  /* real rating: recompute the shop's average so every buyer sees it */
  if (o.shopId && typeof cloudRateShop === 'function') {
    cloudRateShop(o.shopId, n, o.id).then(agg => {
      const s = findShop(o.shopId);
      if (agg && s && agg.avg != null) { s.rating = agg.avg; s.ratings = agg.count; }
    });
  }
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
  ${(S.scheduled || []).length ? `<div class="sec-head"><h2>Scheduled ${ic('clock', 13)}</h2></div>
    ${S.scheduled.map((r, i) => `<div class="order-row static"><span class="or-emoji">${ic('bike', 18)}</span>
      <div class="or-info"><b>${esc(r.title)}</b><small>at ${esc(r.when)} · ${r.from} → ${r.to} · ${r.km} km</small></div>
      <div class="or-right"><b>${money(r.total)}</b><button class="lnk red" onclick="cancelScheduled(${i})">Cancel</button></div></div>`).join('')}` : ''}
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
