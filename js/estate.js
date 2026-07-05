/* ============================================================
   PROPERTY & STAYS — buy · rent · plots · commercial · hotels
   Post property free · precise location · verified listings
   ============================================================ */

function lakh(n) {
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1).replace(/\.0$/, '') + ' L';
  return money(n);
}

view('estate', args => {
  const tab = args[0] || 'buy';
  const tabs = [['buy', 'Buy'], ['rent', 'Rent'], ['plot', 'Plots'], ['commercial', 'Commercial'], ['hotels', 'Hotels & Stays'], ['mine', 'My activity']];
  let body = '';

  if (['buy', 'rent', 'plot', 'commercial'].includes(tab)) {
    const list = [...DB.properties, ...(S.myListings || [])].filter(p => p.kind === tab);
    body = `
    <div class="tip-strip">${ic('shield', 13)} Every listing is GPS-pinned &amp; document-checked — precise location, zero fake listings.</div>
    ${list.length ? `<div class="prop-list">${list.map(p => `
      <div class="prop-card">
        <div class="prop-img" style="background:linear-gradient(135deg,#1e293b,#475569)">
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
        <div class="prop-img" style="background:linear-gradient(135deg,#0c1a2b,#0e7490)">
          ${h.img ? `<img src="${h.img}" alt="" loading="lazy" onerror="this.remove()"/>` : `<span class="tile-ic">${ic('home', 34)}</span>`}
          <em class="prop-verified">${'★'.repeat(h.star)} ${h.rating} (${h.ratings})</em>
        </div>
        <div class="prop-body">
          <div class="prop-price">${money(h.price)}<small>/night</small></div>
          <b>${esc(h.name)}</b>
          <small>${ic('pin', 11)} ${esc(h.loc)}</small>
          <div class="prop-tags">${h.amen.map(a => `<i>${esc(a)}</i>`).join('')}</div>
          <button class="btn-main sm wide" onclick="staySheet('${h.id}')">Book stay</button>
        </div>
      </div>`).join('')}
    </div>
    <div class="join-strip" onclick="toast('Host onboarding: verified photos + GST + property docs. First month free, then tiered 25–100 CHF/yr.')">${ic('plus', 13)} <b>List your hotel or homestay</b> ${ic('arrowr', 12)}</div>`;
  }

  if (tab === 'mine') {
    const ls = S.myListings || [], vs = S.visits || [], sts = S.stays || [];
    body = (ls.length || vs.length || sts.length) ? `
      ${ls.length ? `<div class="sec-head"><h2>Your listings</h2></div>` + ls.map(p => `
        <div class="order-row static"><span class="or-emoji">${ic('home', 18)}</span>
          <div class="or-info"><b>${esc(p.title)}</b><small>${esc(p.loc)} · ${p.leads || 0} leads · ${p.views || 0} views</small></div>
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

function findProp(id) { return [...DB.properties, ...(S.myListings || [])].find(p => p.id === id); }

function propContact(pid) {
  const p = findProp(pid);
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${esc(p.title)}</h3>
    <div class="trust-row">${ic('shield', 13)} Contact is masked-number protected — fraud-safe for both sides.</div>
    <button class="place-row" onclick="toast('Calling via masked number… (demo)')">
      <span>${ic('phone', 17)}</span><div><b>Call ${esc(p.by)}</b><small>Masked number · recorded for safety</small></div><em>Call</em></button>
    <button class="place-row" onclick="closeSheet();toast('Chat opening — talk via Mitra');setTimeout(()=>go('mitra'),500)">
      <span>${ic('spark', 17)}</span><div><b>Chat via Mitra</b><small>Negotiate, ask docs, schedule — in chat</small></div><em>Chat</em></button>`);
}
function propVisit(pid) {
  const p = findProp(pid);
  const slot = pick(['Today 5:30 PM', 'Tomorrow 11 AM', 'Sat 10 AM', 'Sun 4 PM']);
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
  notify('Listing is live', t + ' — buyers nearby can see it now.');
  toast('Your property is live');
  go('estate/' + PROP.kind);
  setTimeout(() => {
    const mp = (S.myListings || []).find(x => x.id === p.id);
    if (mp) { mp.views = rnd(8, 30); mp.leads = rnd(1, 4); save(); notify('Property leads', `${mp.leads} buyers contacted about "${mp.title}" · ${mp.views} views`); }
  }, 25000);
}

/* ---------- hotel stay booking ---------- */
function staySheet(hid) {
  const h = DB.hotels.find(x => x.id === hid);
  window._st = { day: 'Today', nights: 1, guests: 2 };
  const render = () => {
    const d = window._st;
    $('#sheetBody').innerHTML = `
    <div class="sheet-grab"></div><h3 class="sheet-title">${esc(h.name)}</h3>
    <div class="ck-line"><span>${'★'.repeat(h.star)} · ${h.rating} (${h.ratings})</span><span>${money(h.price)}/night</span></div>
    <div class="fld"><span>Check-in</span><div class="chip-wrap">
      ${['Today', 'Tomorrow', 'Sat', 'Sun'].map(x => `<button class="chip ${d.day === x ? 'on' : ''}" onclick="window._st.day='${x}';window._stR()">${x}</button>`).join('')}</div></div>
    <div class="qty-line"><b>Nights</b><span class="stp qty"><button onclick="window._st.nights=Math.max(1,window._st.nights-1);window._stR()">−</button><b>${d.nights}</b><button onclick="window._st.nights=Math.min(14,window._st.nights+1);window._stR()">+</button></span></div>
    <div class="qty-line"><b>Guests</b><span class="stp qty"><button onclick="window._st.guests=Math.max(1,window._st.guests-1);window._stR()">−</button><b>${d.guests}</b><button onclick="window._st.guests=Math.min(6,window._st.guests+1);window._stR()">+</button></span></div>
    <button class="btn-main wide" onclick="stayBook('${hid}')">Book · ${money(h.price * d.nights)}</button>`;
  };
  window._stR = render;
  sheet(''); render();
}
function stayBook(hid) {
  const h = DB.hotels.find(x => x.id === hid);
  const d = window._st, total = h.price * d.nights;
  closeSheet();
  checkoutSheet({
    title: 'Stay · ' + h.name, icon: 'home',
    meta: `${d.day} check-in · ${d.nights} night${d.nights > 1 ? 's' : ''} · ${d.guests} guests · free cancellation`,
    lines: [[d.nights + ' night' + (d.nights > 1 ? 's' : '') + ' × ' + money(h.price), total]], total,
    onPay: (final) => {
      if (!S.stays) S.stays = [];
      S.stays.unshift({ id: uid(), hotel: h.name, day: d.day, nights: d.nights, guests: d.guests, total: final, ts: Date.now() });
      save();
      notify('Stay booked', `${h.name} — ${d.day}, ${d.nights} night(s). Show your ID at check-in.`);
      go('estate/mine');
    }
  });
}
