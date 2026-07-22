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

/* cinemas near you (multi-venue, BookMyShow-style) */
const CINEMAS = [
  { id: 'cin1', name: 'PVR Grand Galleria', area: 'City Centre', km: 2.4 },
  { id: 'cin2', name: 'INOX Riverside Mall', area: 'Sector 12', km: 4.1 },
  { id: 'cin3', name: 'Cinepolis Metro Walk', area: 'Model Town', km: 3.3 },
  { id: 'cin4', name: 'Miraj Cinemas', area: 'Old Town', km: 5.8 }
];

view('tickets', args => {
  const tab = args[0] || 'events';

  const tabs = [['events', 'Events'], ['planners', 'Planners'], ['venues', 'Venues'], ['dining', 'Dining'], ['mine', 'My bookings']];
  let body = '';

  if (tab === 'events') {
    window._evScope = window._evScope || 'All';
    window._evCat = window._evCat || 'All';
    const scopes = ['All', 'Nearby', 'Society', 'City', 'State', 'National'];
    const cats = ['All', ...Array.from(new Set(DB.events.map(e => e.cat)))];
    let list = DB.events;
    if (window._evScope !== 'All') list = list.filter(e => e.scope === window._evScope);
    if (window._evCat !== 'All') list = list.filter(e => e.cat === window._evCat);
    body = `
    <div class="tip-strip">${ic('star', 13)} Everything happening around you — society melas to national summits. Book a seat, or plan your own below.</div>
    <div class="chip-row">${scopes.map(s => `<button class="chip ${window._evScope === s ? 'on' : ''}" onclick="window._evScope='${s}';VIEWS.tickets(['events'])">${s}</button>`).join('')}</div>
    <div class="chip-row">${cats.map(c => `<button class="chip ${window._evCat === c ? 'on' : ''}" onclick="window._evCat='${c}';VIEWS.tickets(['events'])">${esc(c)}</button>`).join('')}</div>
    <div class="event-list">
      ${list.length ? list.map(e => `
      <div class="event-card" onclick="eventSheet('${e.id}')">
        <div class="event-img" ${e.grad ? `style="background:linear-gradient(135deg,${e.grad[0]},${e.grad[1]})"` : ''}>
          ${e.img ? `<img src="${e.img}" alt="" loading="lazy" onerror="this.remove()"/>` : ''}
          <em>${esc(e.cat)}</em>${e.scope ? `<span style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.55);color:#fff;font-size:.65rem;padding:2px 8px;border-radius:20px">${esc(e.scope)}</span>` : ''}</div>
        <div class="event-body">
          <b>${esc(e.title)}</b>
          <small>${ic('pin', 11)} ${esc(e.venue)}</small>
          <small>${ic('clock', 11)} ${esc(e.when)}</small>
          <div class="event-foot"><b>${e.price ? money(e.price) : 'Free'}</b>${e.price ? '<span>onwards</span>' : ''}<em>${e.price ? 'Book' : 'RSVP'} ${ic('arrowr', 11)}</em></div>
        </div>
      </div>`).join('') : `<div class="empty"><span>${ic('star', 40)}</span><b>No events in ${esc(window._evScope)}${window._evCat !== 'All' ? ' · ' + esc(window._evCat) : ''}</b><p>Try another filter — or plan your own below.</p></div>`}
    </div>
    <div class="sec-head" style="margin-top:16px"><h2>Plan your own event</h2></div>
    <div class="dir-grid">
      <button class="svc" onclick="go('tickets/planners')"><span class="svc-ic">${ic('user', 20)}</span><b>Event planners</b><small>Weddings · corporate · birthdays</small></button>
      <button class="svc" onclick="go('tickets/venues')"><span class="svc-ic">${ic('home', 20)}</span><b>Venues &amp; places</b><small>Halls · lawns · rooftops</small></button>
    </div>`;
  }

  if (tab === 'planners') {
    body = `
    <div class="tip-strip">${ic('shield', 13)} Every planner is identity- &amp; work-verified before onboarding. Get a quote in-app — no numbers shared.</div>
    ${DB.eventPros.map(p => `
    <div class="job-card" onclick="plannerSheet('${p.id}')">
      <div class="job-top"><span class="job-emoji">${ic('user', 20)}</span>
        <div><b>${esc(p.name)} ${p.verified ? `<small class="ok">${ic('check', 10)} Verified</small>` : '<small class="dim">Under review</small>'}</b>
          <small>${esc(p.kind)} · ★ ${p.rating} · ${p.jobs} events</small>
          <small class="dim">${esc(p.area)} · ${p.tags.map(esc).join(' · ')}</small></div>
        <em class="job-pay">${money(p.from)}<small>from</small></em></div>
    </div>`).join('')}
    <button class="btn-main wide ghost" onclick="go('services')">${ic('spark', 14)} Are you an event professional? Get onboarded &amp; verified</button>`;
  }

  if (tab === 'venues') {
    body = `
    <div class="tip-strip">${ic('pin', 13)} Book a hall, lawn or rooftop near you — check the date and hold it in-app.</div>
    <div class="prop-list">
    ${DB.venues.map(v => `
    <div class="shop-card" onclick="venueSheet('${v.id}')">
      <div style="background:linear-gradient(135deg,#0F3B21,#1A5632);color:#fff;padding:16px;border-radius:14px 14px 0 0;display:flex;justify-content:space-between;align-items:center"><b>${esc(v.kind)}</b><span style="opacity:.85;font-size:.8rem">${esc(v.cap)}</span></div>
      <div class="shop-body">
        <div class="shop-line1"><b>${esc(v.name)}</b></div>
        <div class="shop-line2">${esc(v.tags.join(' · '))}</div>
        <div class="shop-line3"><span>${ic('pin', 11)} ${esc(v.area)} · ${v.km} km</span></div>
        <div class="event-foot"><b>${money(v.from)}</b><span>per day</span><em>Check dates ${ic('arrowr', 11)}</em></div>
      </div></div>`).join('')}
    </div>`;
  }

  if (tab === 'dining') {
    const cuisines = ['All', 'Biryani', 'South Indian', 'Tiffin', 'Sweets', 'Veg'];
    window._dineCuisine = window._dineCuisine || 'All';
    const cz = window._dineCuisine;
    let rests = DB.shops.filter(s => s.type === 'food' && s.open);
    if (cz !== 'All') {
      const kw = cz.toLowerCase();
      rests = rests.filter(s => (s.name + ' ' + s.tag).toLowerCase().includes(kw) || (cz === 'Veg' && s.veg));
    }
    body = `<div class="tip-strip">${ic('bowl', 13)} Reserve a table at restaurants near you — pay at the restaurant, 20% off the bill on Orignals reservations.</div>
    <div class="chip-row">
      ${cuisines.map(c => `<button class="chip ${cz === c ? 'on' : ''}" onclick="window._dineCuisine='${c}';VIEWS.tickets(['dining'])">${c}</button>`).join('')}
    </div>
    <div class="shop-list">
      ${rests.length ? rests.map(s => `
      <div class="shop-card" onclick="dineSheet('${s.id}')">
        ${shopTile(s)}
        <div class="shop-body">
          <div class="shop-line1"><b>${esc(s.name)}</b><span class="rate">★ ${s.rating}</span></div>
          <div class="shop-line2">${esc(s.tag)}</div>
          <div class="shop-line3"><span>${ic('pin', 11)} ${s.km} km</span><span>·</span><span>Table for 2–8</span></div>
          <div class="dine-menu-peek">${s.items.slice(0, 3).map(i => esc(i.name)).join(' · ')}</div>
          <span class="dbadge both">20% off bill · Reserve free</span>
        </div></div>`).join('') : `<div class="empty"><span>${ic('bowl', 40)}</span><b>No ${esc(cz)} places open now</b><p>Try another cuisine.</p></div>`}</div>`;
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
      : `<div class="empty"><span>${ic('star', 40)}</span><b>No bookings yet</b><p>Event tickets, tables and stays appear here.</p></div>`;
  }

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>Events near you</h1><small>Society melas to national summits · plan &amp; host your own</small></div></div>
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

    <div class="sec-head"><h2>Pick a cinema &amp; show</h2></div>
    <div class="date-strip">
      ${tkDates().map(d => `<button class="date-pill ${window._tkDate === d.key ? 'on' : ''}" onclick="window._tkDate='${d.key}';VIEWS.movie(['${m.id}'])"><small>${d.day}</small><b>${d.num}</b></button>`).join('')}
    </div>
    ${CINEMAS.map(cin => `
      <div class="cinema-block">
        <div class="cinema-head"><b>${esc(cin.name)}</b><small>${ic('pin', 10)} ${esc(cin.area)} · ${cin.km} km</small></div>
        <div class="show-row">
          ${m.times.map((t, i) => {
            const av = showAvail(m.id + cin.id + window._tkDate, t);
            return `<button class="show-pill ${av}" ${av === 'full' ? `onclick="toast('This show is almost full — pick another')"` : `onclick="window._cinema='${esc(cin.name)}';go('seats/${m.id}/${i}')"`}>${t}<small>${av === 'avail' ? 'Available' : av === 'fill' ? 'Filling fast' : 'Almost full'}</small></button>`;
          }).join('')}
        </div>
      </div>`).join('')}
    <div class="legend"><span><i class="lg avail"></i>Available</span><span><i class="lg fill"></i>Filling fast</span><span><i class="lg full"></i>Almost full</span></div>
  </div>`;
});

/* ---------- SEAT SELECTION (real cross-device inventory) ---------- */
let SEATSEL = [];
function showKeyOf(m, tIdx) { return m.id + '|' + window._tkDate + '|' + tIdx + '|' + (window._cinema || 'c'); }

view('seats', args => {
  const m = DB.movies.find(x => x.id === args[0]);
  const tIdx = parseInt(args[1], 10) || 0;
  if (!m) { go('tickets'); return; }
  window._tkDate = window._tkDate || tkDates()[0].key;
  SEATSEL = [];
  window._seatCtx = { m, tIdx, taken: new Set(), loaded: false };
  renderSeats();
  /* pull the REAL booked seats for this exact show from the cloud */
  if (typeof cloudSeatsTaken === 'function') {
    cloudSeatsTaken(showKeyOf(m, tIdx)).then(list => {
      if (!window._seatCtx || window._seatCtx.m.id !== m.id || window._seatCtx.tIdx !== tIdx) return;
      window._seatCtx.taken = new Set(list);
      window._seatCtx.loaded = true;
      if (location.hash.includes('seats/')) renderSeats();
    });
  }
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
    <div><h1>${esc(m.title)}</h1><small>${tkDates().find(d => d.key === window._tkDate).day} · ${time} · ${esc(window._cinema || 'Screen 2')}${window._seatCtx.loaded ? ' · <b class="ok">live seats</b>' : (typeof CLOUD !== 'undefined' && CLOUD.on ? ' · syncing…' : '')}</small></div></div>

  <div class="screen-arc"><svg viewBox="0 0 300 30"><path d="M10 28 Q150 -8 290 28" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" opacity=".7"/></svg><small>SCREEN THIS WAY</small></div>

  <div class="seat-map">
    ${DB.seatTiers.map(tier => `
      <div class="tier-lbl">${tier.name} · ${money(tier.price)}</div>
      ${tier.rows.map(r => `
      <div class="seat-row">
        <small>${r}</small>
        ${[...Array(12)].map((_, c) => {
          const sid = r + (c + 1);
          /* sold = real cloud booking OR the house's baseline occupancy */
          const sold = (window._seatCtx.taken && window._seatCtx.taken.has(sid)) ||
                       hash(m.id + tIdx + sid + window._tkDate) % 10 < 3;
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
/* food & beverage combos (BookMyShow-style add-on) */
const FNB = [
  { id: 'combo1', name: 'Large Popcorn + Pepsi', price: 470, ic: 'bowl' },
  { id: 'combo2', name: 'Cheese Nachos + Coke', price: 380, ic: 'bowl' },
  { id: 'pop', name: 'Salted Popcorn (Regular)', price: 250, ic: 'bowl' },
  { id: 'samosa', name: 'Veg Samosa (2 pcs)', price: 120, ic: 'bowl' },
  { id: 'water', name: 'Mineral Water', price: 60, ic: 'bowl' }
];

/* seat hold lifecycle: reserve on the server BEFORE payment (real
   cinemas lock your seats while you pay), confirm on pay, release if
   the user backs out of checkout. */
let _seatHold = null;
function releaseSeatHold() {
  if (_seatHold && !_seatHold.confirmed) {
    if (typeof cloudSeatsFree === 'function') cloudSeatsFree(_seatHold.show, _seatHold.seats);
    _seatHold = null;
  }
}

async function seatCheckout() {
  const { m, tIdx } = window._seatCtx;
  const time = m.times[tIdx];
  const day = tkDates().find(d => d.key === window._tkDate).day;
  const total = SEATSEL.reduce((a, s) => a + seatPrice(s[0]), 0);
  const show = showKeyOf(m, tIdx);
  const seats = [...SEATSEL];

  /* atomically hold the seats first — this is what prevents two phones
     from ever buying the same seat */
  toast('Holding your seats…');
  const conflicts = (typeof cloudSeatsBook === 'function') ? await cloudSeatsBook(show, seats) : [];
  if (conflicts && conflicts.length) {
    conflicts.forEach(s => window._seatCtx.taken.add(s));
    SEATSEL = SEATSEL.filter(s => !conflicts.includes(s));
    renderSeats();
    toast('Just taken by someone else: ' + conflicts.join(', ') + ' — pick again');
    return;
  }
  _seatHold = { show, seats, confirmed: false };
  window._fnb = {};
  fnbSheet(() => seatPayment(m, tIdx, seats));   // offer snacks, then pay
}

/* F&B add-on step (skippable) */
function fnbSheet(onProceed) {
  window._fnbNext = onProceed;
  const render = () => {
    const F = window._fnb || {};
    const sub = FNB.reduce((a, x) => a + (F[x.id] || 0) * x.price, 0);
    $('#sheetBody').innerHTML = `
    <div class="sheet-grab"></div><h3 class="sheet-title">Add snacks? ${ic('bowl', 16)}</h3>
    <div class="foot-note sm" style="text-align:left;margin:0 0 6px">Skip the queue — pick up at the counter with your ticket.</div>
    ${FNB.map(x => `<div class="qty-line"><div><b>${esc(x.name)}</b><small class="dim"> · ${money(x.price)}</small></div>
      <span class="stp qty"><button onclick="window._fnb['${x.id}']=Math.max(0,(window._fnb['${x.id}']||0)-1);window._fnbR()">−</button><b>${(F[x.id] || 0)}</b><button onclick="window._fnb['${x.id}']=(window._fnb['${x.id}']||0)+1;window._fnbR()">+</button></span></div>`).join('')}
    <div class="btn-pair" style="margin-top:12px">
      <button class="btn-main ghost" onclick="window._fnbNext()">Skip</button>
      <button class="btn-main" onclick="window._fnbNext()">${sub ? 'Add ' + money(sub) + ' & continue' : 'Continue'}</button>
    </div>`;
  };
  window._fnbR = render; sheet(''); render();
}

function seatPayment(m, tIdx, seats) {
  const time = m.times[tIdx];
  const day = tkDates().find(d => d.key === window._tkDate).day;
  const show = showKeyOf(m, tIdx);
  const seatTotal = seats.reduce((a, s) => a + seatPrice(s[0]), 0);
  const F = window._fnb || {};
  const fnbLines = FNB.filter(x => F[x.id]).map(x => [x.name + ' × ' + F[x.id], x.price * F[x.id]]);
  const fnbTotal = fnbLines.reduce((a, l) => a + l[1], 0);
  const total = seatTotal + fnbTotal;

  checkoutSheet({
    title: m.title + ' · ' + seats.length + ' seats', icon: 'star',
    meta: `${day} · ${time} · Seats ${seats.join(', ')}${fnbTotal ? ' + snacks' : ''} · held for you`,
    lines: [...seats.map(s => ['Seat ' + s + ' (' + DB.seatTiers.find(t => t.rows.includes(s[0])).name + ')', seatPrice(s[0])]), ...fnbLines],
    total,
    onPay: (final) => {
      if (!S.tickets) S.tickets = [];
      const t = { id: 'TK' + rnd(10000, 99999), title: m.title, sub: `${day} · ${time} · ${window._cinema || 'Screen 2'} · ${seats.join(', ')}`, seats, show, cinema: window._cinema, fnb: fnbLines.map(l => l[0]), total: final, ts: Date.now(), grad: m.grad };
      if (_seatHold) _seatHold.confirmed = true;
      if (typeof cloudSeatsConfirm === 'function') cloudSeatsConfirm(show, seats, t.id);
      _seatHold = null;
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
    ${(t.fnb && t.fnb.length) ? `<div class="ticket-fnb">${ic('bowl', 12)} Snacks: ${t.fnb.map(esc).join(', ')} — collect at the counter</div>` : ''}
    <div class="ticket-foot">${ic('shield', 12)} Fraud-proof: QR is single-scan, seat-locked &amp; ID-bound</div>
  </div>
  <button class="btn-main wide ghost" onclick="cancelTicket('${t.id}')">Cancel ticket (90% refund to wallet)</button>`;
});
function cancelTicket(tid) {
  const t = S.tickets.find(x => x.id === tid); if (!t) return;
  if (!confirm('Cancel this ticket? 90% refunds to your wallet instantly.')) return;
  /* free the seats so others can book them */
  if (t.show && t.seats && typeof cloudSeatsFreeTicket === 'function') cloudSeatsFreeTicket(tid);
  S.tickets = S.tickets.filter(x => x.id !== tid);
  /* 90% refund goes to the original payment method — no minted credit */
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

/* ---------- EVENT PLANNERS & CONSULTANTS (quote-based, in-app) ---------- */
const _fld = 'width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:12px;margin:6px 0;font:inherit;background:var(--card,#fff);color:inherit';
function plannerSheet(id) {
  const p = DB.eventPros.find(x => x.id === id); if (!p) return;
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${esc(p.name)}</h3>
    <div class="trust-row">${ic('shield', 12)} ${p.verified ? 'Identity &amp; work verified' : 'Verification under review'} · you talk in-app, no numbers shared.</div>
    <p class="movie-about">${esc(p.kind)} · ★ ${p.rating} · ${p.jobs} events · ${esc(p.area)}<br/>Specialities: ${p.tags.map(esc).join(', ')}. Starting from <b>${money(p.from)}</b>.</p>
    <input id="evWhen" placeholder="When is your event? e.g. 14 Dec, evening" style="${_fld}"/>
    <input id="evGuests" placeholder="Guests / scale — e.g. 300 guests" style="${_fld}"/>
    <button class="btn-main wide" onclick="sendPlannerEnquiry('${id}')">${ic('spark', 14)} Send enquiry &amp; get a quote</button>`);
}
function sendPlannerEnquiry(id) {
  const p = DB.eventPros.find(x => x.id === id); if (!p) return;
  const when = (document.getElementById('evWhen') || {}).value || '';
  const g = (document.getElementById('evGuests') || {}).value || '';
  if (!S.eventLeads) S.eventLeads = [];
  S.eventLeads.unshift({ id: uid(), pro: p.name, when, guests: g, ts: Date.now() });
  save(); closeSheet(); confettiBurst();
  notify('Enquiry sent to ' + p.name, (when ? when + ' · ' : '') + (g || 'quote requested') + ' — they will reply with a quote in your chat.', '📩');
  toast('Enquiry sent — ' + p.name + ' will reply in-app');
}

/* ---------- EVENT VENUES / PLACES (date hold, in-app) ---------- */
function venueSheet(id) {
  const v = DB.venues.find(x => x.id === id); if (!v) return;
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${esc(v.name)}</h3>
    <p class="movie-about">${esc(v.kind)} · capacity ${esc(v.cap)} · ${esc(v.area)} (${v.km} km)<br/>${v.tags.map(esc).join(' · ')}. From <b>${money(v.from)}</b> per day.</p>
    <input id="vnDate" type="date" style="${_fld}"/>
    <button class="btn-main wide" onclick="holdVenue('${id}')">${ic('check', 14)} Check availability &amp; hold</button>`);
}
function holdVenue(id) {
  const v = DB.venues.find(x => x.id === id); if (!v) return;
  const d = (document.getElementById('vnDate') || {}).value || '';
  if (!d) { toast('Pick a date first'); return; }
  if (!S.eventLeads) S.eventLeads = [];
  S.eventLeads.unshift({ id: uid(), venue: v.name, when: d, ts: Date.now() });
  save(); closeSheet(); confettiBurst();
  notify('Date held at ' + v.name, d + ' — confirm within 48h to lock it in.', '📍');
  toast('Held ' + v.name + ' for ' + d);
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
    <div class="ck-line"><span>★ ${s.rating} · ${esc(s.tag)}</span><span>${s.km} km</span></div>
    <div class="menu-peek">
      <small class="dim">Popular dishes</small>
      ${s.items.slice(0, 4).map(i => `<div class="ck-line"><span>${esc(i.name)}<small class="dim"> · ${esc(i.qty)}</small></span><span>${money(i.price)}</span></div>`).join('')}
    </div>
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
  const rid = 'RZ' + rnd(10000, 99999);
  S.bookings.unshift({ id: rid, shopId, shop: s.name, day: d.day, slot: d.slot, guests: d.guests, ts: Date.now() });
  /* community restaurant: the reservation lands on the owner's device */
  if (s.community && typeof cloudPostReservation === 'function') {
    cloudPostReservation({ id: rid, shopId, day: d.day, slot: d.slot, guests: d.guests });
  }
  save(); closeSheet(); confettiBurst();
  notify('Table reserved', `${s.name} — ${d.day} ${d.slot}, ${d.guests} guests. 20% off the bill.`);
  toast('Table reserved at ' + s.name);
  go('tickets/mine');
}


/* ---------- cancellations: dining (free) & stays (full refund) ---------- */
function cancelDining(i) {
  const b = (S.bookings || [])[i]; if (!b) return;
  if (!confirm('Cancel your table at ' + b.shop + '? Free cancellation.')) return;
  if (b.id && typeof cloudReservationCancel === 'function') cloudReservationCancel(b.id);
  S.bookings.splice(i, 1); save();
  toast('Reservation cancelled — the table is freed for someone else');
  VIEWS.tickets(['mine']);
}
function cancelStay(i) {
  const st = (S.stays || [])[i]; if (!st) return;
  if (!confirm('Cancel your stay at ' + st.hotel + '? Full ' + money(st.total) + ' refunds to wallet.')) return;
  S.stays.splice(i, 1);
  /* refund goes to the original payment method — no minted credit */
  toast('Stay cancelled — ' + money(st.total) + ' refunded');
  VIEWS.tickets(['mine']);
}
