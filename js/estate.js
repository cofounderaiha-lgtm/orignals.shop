/* ============================================================
   PROPERTY & STAYS — buy · rent · plots · commercial · hotels
   Post property free · precise location · verified listings
   ============================================================ */

function lakh(n) {
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1).replace(/\.0$/, '') + ' L';
  return money(n);
}

let _commListings = [];
view('estate', args => {
  const tab = args[0] || 'buy';
  const tabs = [['buy', 'Buy'], ['rent', 'Rent'], ['plot', 'Plots'], ['commercial', 'Commercial'], ['hotels', 'Hotels & Stays'], ['mine', 'My activity']];
  let body = '';
  /* pull listings posted on other devices into the marketplace */
  if (typeof cloudListingsRefresh === 'function') {
    cloudListingsRefresh(rows => {
      _commListings = rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, loc: r.loc, price: +r.price, area: r.area, bhk: r.bhk, by: 'Owner', verified: true, community: true, owner_device: r.owner_device, lat: r.lat, lng: r.lng, tags: ['Listed on Orignals', 'GPS pinned'] }));
      if (location.hash.replace('#/', '').split('/')[0] === 'estate') VIEWS.estate(args);
    });
  }

  if (['buy', 'rent', 'plot', 'commercial'].includes(tab)) {
    const list = [...DB.properties, ...(S.myListings || []), ..._commListings].filter(p => p.kind === tab);
    body = `
    <div class="tip-strip">${ic('shield', 13)} Every listing is GPS-pinned &amp; document-checked — precise location, zero fake listings.</div>
    ${list.length ? `<div class="prop-list">${list.map(p => `
      <div class="prop-card">
        <div class="prop-img">
          ${p.img ? `<img src="${p.img}" alt="" loading="lazy" onerror="this.remove()"/>` : `<span class="tile-ic">${ic('home', 34)}</span>`}
          ${p.verified ? `<em class="prop-verified">${ic('shield', 11)} Verified</em>` : ''}
        </div>
        <div class="prop-body">
          <div class="prop-price">${p.kind === 'rent' || (p.tags || []).some(t => t.includes('/month')) ? money(p.price) + '<small>/month</small>' : lakh(p.price)}</div>
          <b>${esc(p.title)}</b>
          <small>${ic('pin', 11)} ${esc(p.loc)} · GPS ${p.lat ? p.lat.toFixed(3) + ', ' + p.lng.toFixed(3) : 'pinned'}</small>
          <div class="prop-meta"><span>${esc(p.bhk)}</span><span>${esc(p.area)}</span><span>By ${esc(p.by)}</span></div>
          <div class="prop-tags">${(p.tags || []).map(t => `<i>${esc(t)}</i>`).join('')}</div>
          <div class="btn-pair">
            <button class="btn-main sm" onclick="propContact('${p.id}')">Contact ${p.by === 'Owner' ? 'owner' : 'dealer'}</button>
            <button class="btn-main sm ghost" onclick="propVisit('${p.id}')">Book site visit</button>
            ${tab !== 'rent' ? `<button class="btn-main sm ghost" onclick="emiSheet(${p.price})">EMI</button>` : ''}
          </div>
        </div>
      </div>`).join('')}</div>`
      : `<div class="empty"><span>${ic('home', 40)}</span><b>No listings in this tab yet</b><p>Post yours free — buyers nearby see it instantly.</p></div>`}
    <div class="join-strip" onclick="postPropWizard()">${ic('plus', 13)} <b>Post your property FREE</b> — owner or dealer ${ic('arrowr', 12)}</div>`;
  }

  if (tab === 'hotels') {
    body = `
    <div class="tip-strip">${ic('shield', 13)} Standardised stays — verified photos, fixed prices, clean-linen promise. Hosts: first month free, then tiered 25–100 CHF/yr.</div>
    <div class="prop-list">
      ${DB.hotels.map(h => `
      <div class="prop-card">
        <div class="prop-img">
          ${h.img ? `<img src="${h.img}" alt="" loading="lazy" onerror="this.remove()"/>` : `<span class="tile-ic">${ic('home', 34)}</span>`}
          <em class="prop-verified">${ic('shield', 10)} VERIFIED HOST</em>
        </div>
        <div class="prop-body">
          <div class="prop-price">${money(h.price)}<small>/night</small></div>
          <b>${esc(h.name)}</b>
          <small>${ic('pin', 11)} ${esc(h.loc)}</small>
          ${h.host ? `<small class="host-line">${ic('user', 11)} Hosted by <b>${esc(h.host.name)}</b> · Verified · joined ${h.host.since} · ★ ${h.rating} (${h.ratings})</small>` : ''}
          <div class="prop-tags">${h.amen.map(a => `<i>${esc(a)}</i>`).join('')}</div>
          <button class="btn-main sm wide" onclick="staySheet('${h.id}')">Book this stay</button>
        </div>
      </div>`).join('')}
    </div>
    <div class="join-strip" onclick="toast('Host onboarding: verified photos + GST + property docs. First month free, then tiered 25–100 CHF/yr.')">${ic('plus', 13)} <b>List your hotel or homestay</b> ${ic('arrowr', 12)}</div>`;
  }

  if (tab === 'mine') {
    const ls = S.myListings || [], vs = S.visits || [], sts = S.stays || [];
    /* real enquiries from other devices */
    if (typeof cloudMyLeads === 'function') cloudMyLeads().then(leads => {
      const box = document.getElementById('myLeads');
      if (!box) return;
      box.innerHTML = leads.length ? `<div class="sec-head"><h2>Enquiries on your listings <span class="live-dot"></span></h2></div>` + leads.map(l => {
        const lp = (S.myListings || []).find(x => x.id === l.listing_id);
        return `<div class="order-row static"><span class="or-emoji">${ic(l.kind === 'visit' ? 'pin' : 'phone', 18)}</span>
          <div class="or-info"><b>${esc(l.name || 'A buyer')} — ${l.kind === 'visit' ? 'wants a site visit' : 'is interested'}</b><small>${lp ? esc(lp.title) : l.listing_id}${l.note ? ' · ' + esc(l.note) : ''} · ${new Date(l.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
          <span class="or-status live">New</span></div>`;
      }).join('') : '';
    });
    body = (ls.length || vs.length || sts.length) ? `
      <div id="myLeads"></div>
      ${ls.length ? `<div class="sec-head"><h2>Your listings</h2></div>` + ls.map(p => `
        <div class="order-row static"><span class="or-emoji">${ic('home', 18)}</span>
          <div class="or-info"><b>${esc(p.title)}</b><small>${esc(p.loc)} · live on Orignals</small></div>
          <div class="or-right"><b>${p.kind === 'rent' ? money(p.price) + '/mo' : lakh(p.price)}</b><span class="or-status live">Live</span></div></div>`).join('') : ''}
      ${vs.length ? `<div class="sec-head"><h2>Site visits</h2></div>` + vs.map(v => `
        <div class="order-row static"><span class="or-emoji">${ic('pin', 18)}</span>
          <div class="or-info"><b>${esc(v.title)}</b><small>${esc(v.slot)} · agent will call</small></div>
          <span class="or-status done">Scheduled</span></div>`).join('') : ''}
      ${sts.length ? `<div class="sec-head"><h2>Your stays</h2></div>` + sts.map(st => `
        <div class="order-row static"><span class="or-emoji">${ic('home', 18)}</span>
          <div class="or-info"><b>${esc(st.hotel)}</b><small>${esc(st.day)} · ${st.nights} night${st.nights > 1 ? 's' : ''} · ${st.guests} guests</small></div>
          <div class="or-right"><b>${money(st.total)}</b><span class="or-status done">Booked</span></div></div>`).join('') : ''}`
      : `<div class="empty"><span>${ic('home', 40)}</span><b>Nothing here yet</b><p>Your listings, site visits and hotel stays collect here.</p></div>`;
  }

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>Property &amp; stays</h1><small>Buy · rent · plots · commercial · hotels — precise &amp; verified</small></div></div>
  <div class="chip-row sticky-chips">
    ${tabs.map(t => `<button class="chip ${tab === t[0] ? 'on' : ''}" onclick="go('estate/${t[0]}')">${t[1]}</button>`).join('')}
  </div>
  ${body}`;
});

function findProp(id) { return [...DB.properties, ...(S.myListings || []), ..._commListings].find(p => p.id === id); }

function propContact(pid) {
  const p = findProp(pid);
  /* real cross-device lead: the lister gets a genuine enquiry */
  if (p.community && typeof cloudPostLead === 'function') cloudPostLead(p, 'contact');
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${esc(p.title)}</h3>
    <div class="trust-row">${ic('shield', 13)} Contact is masked-number protected — fraud-safe for both sides.</div>
    ${p.community ? `<div class="offer-strip">${ic('check', 12)} The owner has been notified of your interest.</div>` : ''}
    <button class="place-row" onclick="toast('Connecting via masked number — your number stays private')">
      <span>${ic('phone', 17)}</span><div><b>Call ${esc(p.by)}</b><small>Masked number · recorded for safety</small></div><em>Call</em></button>
    <button class="place-row" onclick="closeSheet();toast('Chat opening — talk via Mitra');setTimeout(()=>go('mitra'),500)">
      <span>${ic('spark', 17)}</span><div><b>Chat via Mitra</b><small>Negotiate, ask docs, schedule — in chat</small></div><em>Chat</em></button>`);
}
function propVisit(pid) {
  const p = findProp(pid);
  const slot = pick(['Today 5:30 PM', 'Tomorrow 11 AM', 'Sat 10 AM', 'Sun 4 PM']);
  if (p.community && typeof cloudPostLead === 'function') cloudPostLead(p, 'visit', 'Site visit requested · ' + slot);
  if (!S.visits) S.visits = [];
  S.visits.unshift({ id: uid(), title: p.title, slot, ts: Date.now() });
  save(); confettiBurst();
  notify('Site visit booked', `${p.title} — ${slot}. A verified agent accompanies you.`);
  toast('Site visit booked · ' + slot);
}

/* ---------- post property (free, precise) ---------- */
let PROP = null;
function postPropWizard() {
  PROP = { step: 1, kind: 'buy', title: '', loc: '', price: '', area: '', bhk: '2 BHK' };
  propRender();
}
function propRender() {
  const p = PROP;
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Post property — free</h3>
  ${p.step === 1 ? `
    <div class="fld"><span>I want to</span><div class="chip-wrap">
      ${[['buy', 'Sell'], ['rent', 'Rent out'], ['plot', 'Sell plot'], ['commercial', 'Commercial']].map(k =>
        `<button class="chip ${p.kind === k[0] ? 'on' : ''}" onclick="PROP.kind='${k[0]}';propRender()">${k[1]}</button>`).join('')}</div></div>
    <div class="fld"><span>Type</span><div class="chip-wrap">
      ${['1 RK', '1 BHK', '2 BHK', '3 BHK', '4+ BHK', 'Villa', 'Plot', 'Shop', 'Office'].map(b =>
        `<button class="chip ${p.bhk === b ? 'on' : ''}" onclick="PROP.bhk='${b}';propRender()">${b}</button>`).join('')}</div></div>
    <button class="btn-main wide" onclick="PROP.step=2;propRender()">Next ${ic('arrowr', 13)}</button>`
  : `
    <label class="fld"><span>Title</span><input class="txt" id="ppT" placeholder="e.g. 2 BHK near Central Mall" value="${esc(p.title)}"/></label>
    <label class="fld"><span>Locality</span><input class="txt" id="ppL" placeholder="Area, landmark" value="${esc(p.loc)}"/></label>
    <div class="fld-pair">
      <label class="fld"><span>${p.kind === 'rent' ? 'Rent/month (₹)' : 'Price (₹)'}</span><input class="txt" id="ppP" inputmode="numeric" placeholder="${p.kind === 'rent' ? '18000' : '5500000'}"/></label>
      <label class="fld"><span>Area</span><input class="txt" id="ppA" placeholder="1,200 sq.ft"/></label>
    </div>
    <div class="trust-row">${ic('pin', 12)} On submit we GPS-pin the exact plot &amp; verify documents — precision kills fraud.</div>
    <button class="btn-main wide" onclick="propSubmit()">Go live — free</button>
    <div class="foot-note sm">Owners list free. Dealers/hosts: first month free, then tiered plans.</div>`}`);
}
function propSubmit() {
  const t = $('#ppT').value.trim(), l = $('#ppL').value.trim(), pr = parseInt($('#ppP').value, 10), a = $('#ppA').value.trim();
  if (t.length < 5) { toast('Give the listing a clear title'); return; }
  if (!l) { toast('Add the locality'); return; }
  if (!pr) { toast('Add the price'); return; }
  if (!S.myListings) S.myListings = [];
  const p = { id: 'my' + uid(), kind: PROP.kind, title: t, loc: l, price: pr, area: a || '—', bhk: PROP.bhk, by: 'Owner', verified: true, tags: ['Posted by you', 'GPS pinned'], views: 0, leads: 0, ts: Date.now() };
  S.myListings.unshift(p); save(); closeSheet(); confettiBurst();
  /* publish to every device's marketplace so real buyers can enquire */
  if (typeof cloudPostListing === 'function') cloudPostListing(p);
  notify('Listing is live', t + ' — buyers across Orignals can see it now.');
  toast('Your property is live on Orignals');
  go('estate/' + PROP.kind);
}

/* ---------- hotel stay booking — real calendar dates ---------- */
function stayFmt(d) { return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
function stayDays() {
  return [...Array(14)].map((_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return d; });
}
function staySheet(hid) {
  const h = DB.hotels.find(x => x.id === hid);
  window._st = { inIdx: 0, nights: 2, guests: 2 };
  const days = stayDays();
  const render = () => {
    const d = window._st;
    const ci = days[d.inIdx];
    const co = new Date(ci); co.setDate(co.getDate() + d.nights);
    const total = h.price * d.nights;
    $('#sheetBody').innerHTML = `
    <div class="sheet-grab"></div><h3 class="sheet-title">${esc(h.name)}</h3>
    ${h.host ? `<div class="trust-row">${ic('shield', 12)} Hosted by <b>&nbsp;${esc(h.host.name)}&nbsp;</b> · Verified · joined ${h.host.since} · ★ ${h.rating}</div>` : ''}
    <div class="fld"><span>Check-in date</span><div class="chip-row" style="margin:4px 0 2px">
      ${days.map((x, i) => `<button class="chip ${d.inIdx === i ? 'on' : ''}" onclick="window._st.inIdx=${i};window._stR()">${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : stayFmt(x)}</button>`).join('')}</div></div>
    <div class="qty-line"><b>Nights</b><span class="stp qty"><button onclick="window._st.nights=Math.max(1,window._st.nights-1);window._stR()">−</button><b>${d.nights}</b><button onclick="window._st.nights=Math.min(14,window._st.nights+1);window._stR()">+</button></span></div>
    <div class="qty-line"><b>Guests</b><span class="stp qty"><button onclick="window._st.guests=Math.max(1,window._st.guests-1);window._stR()">−</button><b>${d.guests}</b><button onclick="window._st.guests=Math.min(6,window._st.guests+1);window._stR()">+</button></span></div>
    <div class="card-block bill">
      <div class="ck-line"><span>Check-in</span><span><b>${stayFmt(ci)}</b> · from 12 pm</span></div>
      <div class="ck-line"><span>Check-out</span><span><b>${stayFmt(co)}</b> · by 11 am</span></div>
      <div class="ck-line grand"><span>${money(h.price)} × ${d.nights} night${d.nights > 1 ? 's' : ''}</span><span>${money(total)}</span></div>
    </div>
    <div class="trust-row">${ic('check', 12)} The price shown is the price you pay — zero fees at checkout · free cancellation till 24 h before</div>
    <button class="btn-main wide" onclick="stayBook('${hid}')">Book this stay · ${money(total)}</button>`;
  };
  window._stR = render;
  sheet(''); render();
}
function stayBook(hid) {
  const h = DB.hotels.find(x => x.id === hid);
  const d = window._st, days = stayDays();
  const ci = days[d.inIdx];
  const co = new Date(ci); co.setDate(co.getDate() + d.nights);
  const total = h.price * d.nights;
  closeSheet();
  checkoutSheet({
    title: 'Stay · ' + h.name, icon: 'home',
    meta: `${stayFmt(ci)} → ${stayFmt(co)} · ${d.nights} night${d.nights > 1 ? 's' : ''} · ${d.guests} guests · free cancellation`,
    lines: [[d.nights + ' night' + (d.nights > 1 ? 's' : '') + ' × ' + money(h.price), total]], total,
    onPay: (final) => {
      if (!S.stays) S.stays = [];
      S.stays.unshift({ id: uid(), hotel: h.name, day: stayFmt(ci), checkIn: ci.toISOString(), checkOut: co.toISOString(), nights: d.nights, guests: d.guests, total: final, ts: Date.now() });
      save();
      notify('Stay booked', `${h.name} — check-in ${stayFmt(ci)}, ${d.nights} night${d.nights > 1 ? 's' : ''}. Show your ID at check-in.`);
      go('estate/mine');
    }
  });
}


/* ---------- EMI calculator ---------- */
function emiSheet(price) {
  window._emi = { down: 20, yrs: 15 };
  renderEmi(price);
}
function renderEmi(price) {
  const e = window._emi, rate = 8.5;
  const P = price * (1 - e.down / 100), r = rate / 1200, n = e.yrs * 12;
  const emi = Math.round(P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
  const totalPay = emi * n, interest = totalPay - P;
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">EMI calculator</h3>
    <div class="ck-line"><span>Property price</span><span><b>${lakh(price)}</b></span></div>
    <div class="fld"><span>Down payment</span><div class="chip-wrap">
      ${[10, 20, 30, 40].map(d => `<button class="chip ${e.down === d ? 'on' : ''}" onclick="window._emi.down=${d};renderEmi(${price})">${d}%</button>`).join('')}
    </div></div>
    <div class="fld"><span>Tenure</span><div class="chip-wrap">
      ${[5, 10, 15, 20, 25].map(y => `<button class="chip ${e.yrs === y ? 'on' : ''}" onclick="window._emi.yrs=${y};renderEmi(${price})">${y} yrs</button>`).join('')}
    </div></div>
    <div class="card-block bill">
      <div class="ck-line"><span>Loan amount</span><span>${lakh(P)}</span></div>
      <div class="ck-line"><span>Interest rate</span><span>${rate}% p.a. (typical)</span></div>
      <div class="ck-line grand"><span>Monthly EMI</span><span>${money(emi)}</span></div>
      <div class="ck-line"><span>Total interest over ${e.yrs} yrs</span><span>${lakh(interest)}</span></div>
    </div>
    <div class="foot-note sm">Indicative only — final rates depend on your bank &amp; credit score.</div>`);
}
