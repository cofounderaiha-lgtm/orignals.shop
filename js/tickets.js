/* ============================================================
   TICKETS — movies (live seat map) · events · dining · my bookings
   ============================================================ */

function tkDates() {
  return [...Array(5)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return { key: d.toISOString().slice(0, 10), day: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString('en-IN', { weekday: 'short' }), num: d.getDate() };
  });
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function showAvail(mid, t) { const r = hash(mid + t) % 10; return r < 5 ? 'avail' : r < 8 ? 'fill' : 'full'; }

view('tickets', args => {
  const tab = args[0] || 'movies';
  window._tkDate = window._tkDate || tkDates()[0].key;
  const fmt = window._tkFmt || 'All';

  const tabs = [['movies', 'Movies'], ['events', 'Events'], ['dining', 'Dining'], ['mine', 'My bookings']];
  let body = '';

  if (tab === 'movies') {
    let list = DB.movies;
    if (fmt !== 'All') list = list.filter(m => m.tag.includes(fmt));
    body = `
    <div class="date-strip">
      ${tkDates().map(d => `<button class="date-pill ${window._tkDate === d.key ? 'on' : ''}" onclick="window._tkDate='${d.key}';VIEWS.tickets(['movies'])"><small>${d.day}</small><b>${d.num}</b></button>`).join('')}
    </div>
    <div class="chip-row">
      ${['All', '2D', '3D', 'IMAX', 'Dolby'].map(f => `<button class="chip ${fmt === f ? 'on' : ''}" onclick="window._tkFmt='${f}';VIEWS.tickets(['movies'])">${f}</button>`).join('')}
    </div>
    <div class="legend"><span><i class="lg avail"></i>Available</span><span><i class="lg fill"></i>Filling fast</span><span><i class="lg full"></i>Almost full</span></div>
    <div class="movie-grid">
      ${list.map(m => `
      <div class="movie-card" onclick="go('movie/${m.id}')">
        <div class="poster">
          <b>${esc(m.title)}</b><small>${esc(m.tag)}</small>
          <span class="poster-rate">★ ${m.rating}</span>
        </div>
        <div class="movie-body">
          <b>${esc(m.title)}</b>
          <small>${m.cert} · ${esc(m.lang)} · ${Math.floor(m.mins / 60)}h ${m.mins % 60}m</small>
          <small class="dim">${esc(m.genre)}</small>
        </div>
      </div>`).join('')}
    </div>`;
  }

  if (tab === 'events') {
    body = `<div class="event-list">
      ${DB.events.map(e => `
      <div class="event-card" onclick="eventSheet('${e.id}')">
        <div class="event-img">
          ${e.img ? `<img src="${e.img}" alt="" loading="lazy" onerror="this.remove()"/>` : ''}
          <em>${esc(e.cat)}</em></div>
        <div class="event-body">
          <b>${esc(e.title)}</b>
          <small>${ic('pin', 11)} ${esc(e.venue)}</small>
          <small>${ic('clock', 11)} ${esc(e.when)}</small>
          <div class="event-foot"><b>${money(e.price)}</b><span>onwards</span><em>Book ${ic('arrowr', 11)}</em></div>
        </div>
      </div>`).join('')}</div>`;
  }

  if (tab === 'dining') {
    const rests = DB.shops.filter(s => s.type === 'food' && s.open);
    body = `<div class="tip-strip">${ic('bowl', 13)} Reserve a table at restaurants near you — pay at the restaurant, 20% off the bill on Orignals reservations.</div>
    <div class="shop-list">
      ${rests.map(s => `
      <div class="shop-card" onclick="dineSheet('${s.id}')">
        ${shopTile(s)}
        <div class="shop-body">
          <div class="shop-line1"><b>${esc(s.name)}</b><span class="rate">★ ${s.rating}</span></div>
          <div class="shop-line2">${esc(s.tag)}</div>
          <div class="shop-line3"><span>${ic('pin', 11)} ${s.km} km</span><span>·</span><span>Table for 2–8</span></div>
          <span class="dbadge both">20% off bill · Reserve free</span>
        </div></div>`).join('')}</div>`;
  }

  if (tab === 'mine') {
    const tks = S.tickets || [], bks = S.bookings || [], sts = S.stays || [];
    body = (tks.length || bks.length || sts.length) ? `
      ${tks.map(t => `<div class="order-row" onclick="go('ticket/${t.id}')">
        <span class="or-emoji">${ic('star', 18)}</span>
        <div class="or-info"><b>${esc(t.title)}</b><small>${esc(t.sub)}</small></div>
        <div class="or-right"><b>${money(t.total)}</b><span class="or-status done">Confirmed</span></div></div>`).join('')}
      ${bks.map((b, i) => `<div class="order-row static"><span class="or-emoji">${ic('bowl', 18)}</span>
        <div class="or-info"><b>Table at ${esc(b.shop)}</b><small>${esc(b.day)} · ${esc(b.slot)} · ${b.guests} guests · 20% off bill</small></div>
        <div class="or-right"><span class="or-status done">Reserved</span><button class="lnk red" onclick="cancelDining(${i})">Cancel</button></div></div>`).join('')}
      ${sts.map((st, i) => `<div class="order-row static"><span class="or-emoji">${ic('home', 18)}</span>
        <div class="or-info"><b>${esc(st.hotel)}</b><small>${esc(st.day)} · ${st.nights} night${st.nights > 1 ? 's' : ''} · ${st.guests} guests</small></div>
        <div class="or-right"><b>${money(st.total)}</b><span class="or-status done">Booked</span><button class="lnk red" onclick="cancelStay(${i})">Cancel</button></div></div>`).join('')}`
      : `<div class="empty"><span>${ic('star', 40)}</span><b>No bookings yet</b><p>Movie tickets, tables and stays appear here.</p></div>`;
  }

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>Movies, events &amp; more</h1><small>Live seats · instant tickets · zero convenience fee</small></div></div>
  <div class="chip-row">
    ${tabs.map(t => `<button class="chip ${tab === t[0] ? 'on' : ''}" onclick="go('tickets/${t[0]}')">${t[1]}</button>`).join('')}
  </div>
  ${body}`;
});

/* ---------- MOVIE DETAIL + SHOWTIMES ---------- */
view('movie', args => {
  const m = DB.movies.find(x => x.id === args[0]);
  if (!m) { go('tickets'); return; }
  window._tkDate = window._tkDate || tkDates()[0].key;
  $('#view').innerHTML = `
  <div class="shop-hero">
    <button class="back glass" onclick="go('tickets')">${ic('chevl', 16)}</button>
    <div class="movie-hero"><b>${esc(m.title)}</b><small>${esc(m.tag)} · ★ ${m.rating} (${m.votes})</small></div>
  </div>
  <div class="shop-sheet">
    <div class="shop-head"><div><h1>${esc(m.title)}</h1><small>${m.cert} · ${esc(m.lang)} · ${Math.floor(m.mins / 60)}h ${m.mins % 60}m · ${esc(m.genre)}</small></div>
      <div class="rate big">★ ${m.rating}<small>${m.votes} votes</small></div></div>
    <p class="movie-about">${esc(m.about)}</p>
    <div class="trust-row">${ic('shield', 13)} Allows cancellation · Digital ticket · Recliners available · Wheelchair friendly</div>

    <div class="sec-head"><h2>Pick a show</h2></div>
    <div class="date-strip">
      ${tkDates().map(d => `<button class="date-pill ${window._tkDate === d.key ? 'on' : ''}" onclick="window._tkDate='${d.key}';VIEWS.movie(['${m.id}'])"><small>${d.day}</small><b>${d.num}</b></button>`).join('')}
    </div>
    <div class="show-row">
      ${m.times.map((t, i) => {
        const av = showAvail(m.id + window._tkDate, t);
        return `<button class="show-pill ${av}" ${av === 'full' ? `onclick="toast('This show is almost full — pick another')"` : `onclick="go('seats/${m.id}/${i}')"`}>${t}<small>${av === 'avail' ? 'Available' : av === 'fill' ? 'Filling fast' : 'Almost full'}</small></button>`;
      }).join('')}
    </div>
    <div class="legend"><span><i class="lg avail"></i>Available</span><span><i class="lg fill"></i>Filling fast</span><span><i class="lg full"></i>Almost full</span></div>
  </div>`;
});

/* ---------- SEAT SELECTION ---------- */
let SEATSEL = [];
view('seats', args => {
  const m = DB.movies.find(x => x.id === args[0]);
  const tIdx = parseInt(args[1], 10) || 0;
  if (!m) { go('tickets'); return; }
  window._tkDate = window._tkDate || tkDates()[0].key;
  SEATSEL = [];
  window._seatCtx = { m, tIdx };
  renderSeats();
});

function seatPrice(row) {
  const t = DB.seatTiers.find(t => t.rows.includes(row));
  return t ? t.price : 180;
}
function renderSeats() {
  const { m, tIdx } = window._seatCtx;
  const time = m.times[tIdx];
  const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const total = SEATSEL.reduce((a, s) => a + seatPrice(s[0]), 0);

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('movie/${m.id}')">${ic('chevl', 16)}</button>
    <div><h1>${esc(m.title)}</h1><small>${tkDates().find(d => d.key === window._tkDate).day} · ${time} · Screen 2</small></div></div>

  <div class="screen-arc"><svg viewBox="0 0 300 30"><path d="M10 28 Q150 -8 290 28" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" opacity=".7"/></svg><small>SCREEN THIS WAY</small></div>

  <div class="seat-map">
    ${DB.seatTiers.map(tier => `
      <div class="tier-lbl">${tier.name} · ${money(tier.price)}</div>
      ${tier.rows.map(r => `
      <div class="seat-row">
        <small>${r}</small>
        ${[...Array(12)].map((_, c) => {
          const sid = r + (c + 1);
          const sold = hash(m.id + tIdx + sid + window._tkDate) % 10 < 3;
          const sel = SEATSEL.includes(sid);
          return `${c === 3 || c === 9 ? '<span class="aisle"></span>' : ''}
            <button class="seat ${sold ? 'sold' : sel ? 'sel' : ''}" ${sold ? '' : `onclick="toggleSeat('${sid}')"`}>${c + 1}</button>`;
        }).join('')}
      </div>`).join('')}`).join('')}
  </div>
  <div class="legend"><span><i class="lg savail"></i>Free</span><span><i class="lg ssel"></i>Yours</span><span><i class="lg ssold"></i>Sold</span></div>

  ${SEATSEL.length ? `
  <div class="seat-bar">
    <div><b>${SEATSEL.length} seat${SEATSEL.length > 1 ? 's' : ''}</b><small>${SEATSEL.join(', ')}</small></div>
    <button class="btn-main" onclick="seatCheckout()">Pay ${money(total)}</button>
  </div>` : `<div class="foot-note">Tap seats to select — max 6 per booking.</div>`}`;
}
function toggleSeat(sid) {
  if (SEATSEL.includes(sid)) SEATSEL = SEATSEL.filter(s => s !== sid);
  else { if (SEATSEL.length >= 6) { toast('Max 6 seats per booking'); return; } SEATSEL.push(sid); }
  renderSeats();
}
function seatCheckout() {
  const { m, tIdx } = window._seatCtx;
  const time = m.times[tIdx];
  const day = tkDates().find(d => d.key === window._tkDate).day;
  const total = SEATSEL.reduce((a, s) => a + seatPrice(s[0]), 0);
  checkoutSheet({
    title: m.title + ' · ' + SEATSEL.length + ' seats', icon: 'star',
    meta: `${day} · ${time} · Seats ${SEATSEL.join(', ')} · Zero convenience fee`,
    lines: SEATSEL.map(s => ['Seat ' + s + ' (' + DB.seatTiers.find(t => t.rows.includes(s[0])).name + ')', seatPrice(s[0])]),
    total,
    onPay: (final) => {
      if (!S.tickets) S.tickets = [];
      const t = { id: 'TK' + rnd(10000, 99999), title: m.title, sub: `${day} · ${time} · Screen 2 · ${SEATSEL.join(', ')}`, seats: [...SEATSEL], total: final, ts: Date.now(), grad: m.grad };
      S.tickets.unshift(t); save();
      notify('Tickets confirmed', `${m.title} — ${t.sub}`);
      go('ticket/' + t.id);
    }
  });
}

/* ---------- DIGITAL TICKET with QR ---------- */
function qrSVG(seed) {
  const n = 21, h0 = hash(seed);
  let cells = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    if (finder) continue;
    if (hash(seed + x + '_' + y + h0) % 100 < 46) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  const f = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
  return `<svg class="qr" viewBox="-1 -1 23 23" fill="currentColor">${f(0, 0)}${f(14, 0)}${f(0, 14)}${cells}</svg>`;
}
view('ticket', args => {
  const t = (S.tickets || []).find(x => x.id === args[0]);
  if (!t) { go('tickets/mine'); return; }
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('tickets/mine')">${ic('chevl', 16)}</button>
    <div><h1>Your ticket</h1><small>Show this at entry — that's it</small></div></div>
  <div class="ticket-card">
    <div class="ticket-top">
      <b>${esc(t.title)}</b><small>${esc(t.sub)}</small></div>
    <div class="ticket-mid">
      ${qrSVG(t.id)}
      <div class="ticket-meta"><b>${t.id}</b><small>Paid ${money(t.total)}</small><small>${new Date(t.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
    </div>
    <div class="ticket-rip"></div>
    <div class="ticket-foot">${ic('shield', 12)} Fraud-proof: QR is single-scan, seat-locked &amp; ID-bound</div>
  </div>
  <button class="btn-main wide ghost" onclick="cancelTicket('${t.id}')">Cancel ticket (90% refund to wallet)</button>`;
});
function cancelTicket(tid) {
  const t = S.tickets.find(x => x.id === tid); if (!t) return;
  if (!confirm('Cancel this ticket? 90% refunds to your wallet instantly.')) return;
  S.tickets = S.tickets.filter(x => x.id !== tid);
  walletAdd(Math.round(t.total * 0.9), 'Refund · ' + t.title);
  save(); toast('Cancelled — ' + money(Math.round(t.total * 0.9)) + ' refunded');
  go('tickets/mine');
}

/* ---------- EVENTS ---------- */
function eventSheet(eid) {
  const e = DB.events.find(x => x.id === eid);
  window._evQty = 1;
  const render = () => {
    $('#sheetBody').innerHTML = `
    <div class="sheet-grab"></div>
    <h3 class="sheet-title">${esc(e.title)}</h3>
    <div class="ck-line"><span>${ic('pin', 12)} ${esc(e.venue)}</span><span>${esc(e.when)}</span></div>
    <p class="movie-about">${esc(e.about)}</p>
    <div class="qty-line"><b>Tickets</b>
      <span class="stp qty"><button onclick="window._evQty=Math.max(1,window._evQty-1);window._evRender()">−</button><b>${window._evQty}</b><button onclick="window._evQty=Math.min(8,window._evQty+1);window._evRender()">+</button></span></div>
    <button class="btn-main wide" onclick="eventBook('${eid}')">Book ${window._evQty} · ${money(e.price * window._evQty)}</button>`;
  };
  window._evRender = render;
  sheet(''); render();
}
function eventBook(eid) {
  const e = DB.events.find(x => x.id === eid);
  const q = window._evQty, total = e.price * q;
  closeSheet();
  checkoutSheet({
    title: e.title, icon: 'star', meta: `${e.venue} · ${e.when} · ${q} ticket${q > 1 ? 's' : ''}`,
    lines: [[q + ' × entry', total]], total,
    onPay: (final) => {
      if (!S.tickets) S.tickets = [];
      const t = { id: 'TK' + rnd(10000, 99999), title: e.title, sub: `${e.when} · ${e.venue} · ${q} entry`, total: final, ts: Date.now(), grad: e.grad };
      S.tickets.unshift(t); save();
      notify('Event booked', e.title + ' — ' + e.when);
      go('ticket/' + t.id);
    }
  });
}

/* ---------- DINING RESERVATION ---------- */
function dineSheet(shopId) {
  const s = findShop(shopId);
  window._dn = { day: 'Today', slot: DB.dineSlots[2], guests: 2 };
  const render = () => {
    const d = window._dn;
    $('#sheetBody').innerHTML = `
    <div class="sheet-grab"></div>
    <h3 class="sheet-title">Reserve at ${esc(s.name)}</h3>
    <div class="fld"><span>Day</span><div class="chip-wrap">
      ${['Today', 'Tomorrow', 'Sat', 'Sun'].map(x => `<button class="chip ${d.day === x ? 'on' : ''}" onclick="window._dn.day='${x}';window._dnRender()">${x}</button>`).join('')}</div></div>
    <div class="fld"><span>Time</span><div class="chip-wrap">
      ${DB.dineSlots.map(x => `<button class="chip ${d.slot === x ? 'on' : ''}" onclick="window._dn.slot='${x}';window._dnRender()">${x}</button>`).join('')}</div></div>
    <div class="qty-line"><b>Guests</b>
      <span class="stp qty"><button onclick="window._dn.guests=Math.max(1,window._dn.guests-1);window._dnRender()">−</button><b>${d.guests}</b><button onclick="window._dn.guests=Math.min(12,window._dn.guests+1);window._dnRender()">+</button></span></div>
    <button class="btn-main wide" onclick="dineBook('${shopId}')">Reserve — free · 20% off bill</button>`;
  };
  window._dnRender = render;
  sheet(''); render();
}
function dineBook(shopId) {
  const s = findShop(shopId);
  const d = window._dn;
  if (!S.bookings) S.bookings = [];
  S.bookings.unshift({ id: uid(), shop: s.name, day: d.day, slot: d.slot, guests: d.guests, ts: Date.now() });
  save(); closeSheet(); confettiBurst();
  notify('Table reserved', `${s.name} — ${d.day} ${d.slot}, ${d.guests} guests. 20% off the bill.`);
  toast('Table reserved at ' + s.name);
  go('tickets/mine');
}


/* ---------- cancellations: dining (free) & stays (full refund) ---------- */
function cancelDining(i) {
  const b = (S.bookings || [])[i]; if (!b) return;
  if (!confirm('Cancel your table at ' + b.shop + '? Free cancellation.')) return;
  S.bookings.splice(i, 1); save();
  toast('Reservation cancelled — the table is freed for someone else');
  VIEWS.tickets(['mine']);
}
function cancelStay(i) {
  const st = (S.stays || [])[i]; if (!st) return;
  if (!confirm('Cancel your stay at ' + st.hotel + '? Full ' + money(st.total) + ' refunds to wallet.')) return;
  S.stays.splice(i, 1);
  walletAdd(st.total, 'Refund · stay · ' + st.hotel);
  toast('Stay cancelled — ' + money(st.total) + ' refunded');
  VIEWS.tickets(['mine']);
}
