/* ============================================================
   HOME — buy-mode landing + mega category directory
   ============================================================ */

function activeStripHTML() {
  const act = activeOrders();
  if (!act.length) return '';
  return act.slice(0, 3).map(o => {
    const f = orderStatus(o);
    return `<div class="live-card" onclick="go('track/${o.id}')">
      <span class="live-ic">${ic(f.e, 18)}</span>
      <div class="live-info"><b>${esc(f.t)}</b><small>${esc(o.title)} · ${o.id}</small></div>
      <span class="live-pulse"></span></div>`;
  }).join('');
}

view('home', () => {
  if (S.mode === 'earn') { VIEWS.earn([]); return; }
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const nearby = [...DB.shops].sort((a, b) => a.km - b.km).slice(0, 6);

  $('#view').innerHTML = `
  <div class="home-hero">
    <div class="home-greet">${greet}, <b>${esc(S.user.name)}</b></div>
    <h1 class="home-title">Real food. Real shops.<br/><span>Verified by our own people.</span></h1>
    <div class="usp-strip">${ic('shield', 13)} No adulterated ghee. No fake paneer. Every batch purity-tested — Safety · Purity · Sustainability.</div>

    <button class="mitra-bar" onclick="go('mitra')">
      <span class="mitra-orb">${ic('mic', 17)}</span>
      <span class="mitra-hint" id="mitraHint">"Order 2 milk from the kirana…"</span>
      <span class="mitra-go">Ask Mitra</span>
    </button>
  </div>

  <div id="activeStrip" class="active-strip">${activeStripHTML()}</div>

  <!-- 3-tint category system (spec §6): commerce=leaf · movement=haldi · lifestyle=cream -->
  <div class="svc-grid">
    <button class="svc t-com" onclick="go('shops')"><span class="svc-ic">${ic('store', 21)}</span><b>Shops Nearby</b><small>Buy from any shop</small></button>
    <button class="svc t-move" onclick="go('send')"><span class="svc-ic">${ic('package', 21)}</span><b>Send Anything</b><small>Tiffin to truck-load</small></button>
    <button class="svc t-move" onclick="go('ride')"><span class="svc-ic">${ic('bike', 21)}</span><b>Rides</b><small>Bike · Auto · Car</small></button>
    <button class="svc t-life" onclick="go('tickets')"><span class="svc-ic">${ic('star', 21)}</span><b>Movies & Events</b><small>Book seats live</small></button>
    <button class="svc t-com" onclick="go('tickets/dining')"><span class="svc-ic">${ic('bowl', 21)}</span><b>Dining</b><small>Reserve a table</small></button>
    <button class="svc t-life" onclick="go('estate')"><span class="svc-ic">${ic('home', 21)}</span><b>Property & Stays</b><small>Buy · rent · hotels</small></button>
    <button class="svc t-move" onclick="setMode('earn')"><span class="svc-ic">${ic('users', 21)}</span><b>Earn</b><small>Deliver as you go</small></button>
    <button class="svc t-com" onclick="go('myshop')"><span class="svc-ic">${ic('chart', 21)}</span><b>Your Shop</b><small>Sell on Orignals</small></button>
  </div>

  <div class="chip-row">
    ${DB.shopTypes.filter(t => t.id !== 'all').map(t =>
      `<button class="chip" onclick="go('shops/${t.id}')">${typeIcon(t.id, 14)}${t.name}</button>`).join('')}
    <button class="chip" onclick="go('categories')">${ic('grid', 14)}All categories</button>
  </div>

  <div class="promo-scroll">
    <div class="promo p1" onclick="go('shops/organic')"><div><small>PURE &amp; LOCAL</small><b>All organic food,<br/>from farms near you</b><em>Shop organic</em></div><span>${ic('leaf', 52)}</span></div>
    <div class="promo p5" onclick="go('tickets')"><div><small>THIS WEEKEND</small><b>Blockbusters &amp; events —<br/>pick your seat live</b><em>Book tickets</em></div><span>${ic('star', 52)}</span></div>
    <div class="promo p2" onclick="go('send')"><div><small>THE NEIGHBOUR WAY</small><b>"Take this tiffin<br/>to grandma" — done.</b><em>Send anything</em></div><span>${ic('package', 52)}</span></div>
    <div class="promo p3" onclick="setMode('earn')"><div><small>PASSING BY? EARN.</small><b>Every trip you make<br/>can pay you back</b><em>Start earning</em></div><span>${ic('cash', 52)}</span></div>
    <div class="promo p4" onclick="go('myshop')"><div><small>FOR EVERY DUKAAN</small><b>Your shop online<br/>in 2 minutes</b><em>Register shop</em></div><span>${ic('store', 52)}</span></div>
  </div>

  <div class="sec-head"><h2>Nearest to you</h2><button class="lnk" onclick="go('shops')">See all ${ic('arrowr', 12)}</button></div>
  <div class="shop-list">${nearby.map(shopCardHTML).join('')}</div>

  <div class="sec-head"><h2>Everything on Orignals</h2><button class="lnk" onclick="go('categories')">Full directory ${ic('arrowr', 12)}</button></div>
  <div class="mega-grid">
    ${DB.megaCats.slice(0, 8).map(c => `
      <button class="mega" onclick="window._shopQ='${esc(c.subs[0])}';go('shops')">
        <span>${ic(c.icon, 19)}</span><b>${esc(c.name)}</b><small>${esc(c.subs.slice(0, 3).join(' · '))}</small></button>`).join('')}
  </div>

  <section class="band-ink">
  <div class="sec-head"><h2>How Orignals works</h2></div>
  <div class="how-grid">
    <div class="how"><span>${ic('store', 22)}</span><b>Every shop, one platform</b><p>Kirana, restaurants, pharmacies, wholesalers, factories — every seller in India lists here and sells to people nearby.</p></div>
    <div class="how"><span>${ic('truck', 22)}</span><b>Shops choose delivery</b><p>A shop delivers itself, or hands the order to a verified Orignals partner passing nearby — whichever is faster.</p></div>
    <div class="how"><span>${ic('users', 22)}</span><b>Anyone can earn</b><p>Registered &amp; verified? On foot, cycle, bike, car or truck — carry something along your way and get paid.</p></div>
    <div class="how"><span>${ic('spark', 22)}</span><b>Just say it</b><p>No app confusion. Tell Mitra "order milk" or "book 2 tickets" in your own words — it does the rest.</p></div>
  </div>
  </section>

  <div class="foot-note">Orignals — every shop, every street, everyone earns<br/>
  <span class="dim">First month free · Buyers 1 CHF/yr · Sellers tiered 1–100 CHF/yr · Demo build</span></div>`;

  const hints = ['"Order 2 milk from the kirana…"', '"Send this tiffin to grandma"', '"Book 2 tickets for the 6:30 show"', '"Book a bike to the station"', '"Kya mera order aa gaya?"'];
  let hi = 0;
  clearInterval(window._hintTimer);
  window._hintTimer = setInterval(() => {
    const el = $('#mitraHint'); if (!el) { clearInterval(window._hintTimer); return; }
    hi = (hi + 1) % hints.length; el.style.opacity = 0;
    setTimeout(() => { el.textContent = hints[hi]; el.style.opacity = 1; }, 250);
  }, 3200);
});

/* ---------- FULL CATEGORY DIRECTORY (sell everything) ---------- */
view('categories', () => {
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>All categories</h1><small>Everything sells on Orignals — retail to industrial</small></div></div>
  <div class="dir-grid">
    ${DB.megaCats.map(c => `
      <div class="dir-card">
        <div class="dir-head"><span>${ic(c.icon, 18)}</span><b>${esc(c.name)}</b></div>
        <div class="dir-subs">
          ${c.subs.map(s => `<button class="dir-sub" onclick="window._shopQ='${esc(s)}';go('shops')">${esc(s)}</button>`).join('')}
        </div>
      </div>`).join('')}
  </div>
  <div class="join-strip" onclick="go('myshop')">Sell in any of these categories — <b>list your shop free</b> ${ic('arrowr', 12)}</div>`;
});
