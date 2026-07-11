/* ============================================================
   HOME — buy-mode landing + mega category directory
   ============================================================ */

/* "Your usual" — one-tap reorder of what you actually buy (video spec) */
function usualStripHTML() {
  const past = S.orders.filter(o => o.kind === 'shop' && o.shopId && orderDone(o) && !o.cancelled);
  if (!past.length) return '';
  const seen = new Set(), usual = [];
  for (const o of past) {
    if (seen.has(o.shopId)) continue;
    seen.add(o.shopId);
    const shop = findShop(o.shopId);
    if (!shop) continue;
    usual.push({ o, shop });
    if (usual.length >= 4) break;
  }
  if (!usual.length) return '';
  return `<div class="sec-head slim"><h2>Your usual</h2></div>
  <div class="usual-strip">
    ${usual.map(u => `<button class="usual" onclick="reorder('${u.o.id}')">
      <span class="u-ic">${typeIcon(u.shop.type, 17)}</span>
      <div><b>${esc(u.o.items && u.o.items.length ? u.o.items.map(i => i.name).slice(0, 2).join(', ') : u.o.title)}</b>
      <small>${esc(u.shop.name)}</small></div>
      <em>${money(u.o.total)} ↻</em></button>`).join('')}
  </div>`;
}

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
  if (typeof cloudShopsRefresh === 'function') cloudShopsRefresh();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const nearby = [...DB.shops].sort((a, b) => a.km - b.km).slice(0, 6);

  $('#view').innerHTML = `
  <div class="home-hero">
    <div class="home-greet">${greet}${isGuest() ? '' : ', <b>' + esc(displayName()) + '</b>'}${isGuest() ? ' — <b onclick="go(\'login\')" style="cursor:pointer;color:var(--primary)">sign in</b>' : ''}</div>
    <h1 class="home-title">Real food. Real shops.<br/><span>Verified by our own people.</span></h1>
    <div class="usp-strip">${ic('shield', 13)} No adulterated ghee. No fake paneer. Every batch purity-tested — Safety · Purity · Sustainability.</div>

    <button class="mitra-bar" onclick="go('mitra')">
      <span class="mitra-orb">${ic('mic', 17)}</span>
      <span class="mitra-hint" id="mitraHint">"Order 2 milk from the kirana…"</span>
      <span class="mitra-go">Ask Mitra</span>
    </button>
  </div>

  <div id="activeStrip" class="active-strip">${activeStripHTML()}</div>

  ${usualStripHTML()}

  <!-- 3-tint category system (spec §6): commerce=leaf · movement=haldi · lifestyle=cream -->
  <div class="svc-grid">
    <button class="svc t-com" onclick="go('shops')"><span class="svc-ic">${ic('store', 21)}</span><b>Shops Nearby</b><small>Buy from any shop</small></button>
    <button class="svc t-move" onclick="go('send')"><span class="svc-ic">${ic('package', 21)}</span><b>Send Anything</b><small>Tiffin to truck-load</small></button>
    <button class="svc t-move" onclick="go('ride')"><span class="svc-ic">${ic('bike', 21)}</span><b>Rides</b><small>Bike · Auto · Car</small></button>
    <button class="svc t-life" onclick="go('tickets')"><span class="svc-ic">${ic('star', 21)}</span><b>Events</b><small>Attend · plan · host</small></button>
    <button class="svc t-com" onclick="go('tickets/dining')"><span class="svc-ic">${ic('bowl', 21)}</span><b>Dining</b><small>Reserve a table</small></button>
    <button class="svc t-life" onclick="go('estate')"><span class="svc-ic">${ic('home', 21)}</span><b>Property & Stays</b><small>Buy · rent · hotels</small></button>
    <button class="svc t-com" onclick="go('services')"><span class="svc-ic">${ic('users', 21)}</span><b>Services</b><small>Verified pros · all trades</small></button>
    <button class="svc t-move" onclick="setMode('earn')"><span class="svc-ic">${ic('users', 21)}</span><b>Earn</b><small>Deliver · Sell · Services</small></button>
    <button class="svc t-com" onclick="go('myshop')"><span class="svc-ic">${ic('chart', 21)}</span><b>Your Shop</b><small>Sell on Orignals</small></button>
  </div>

  <div class="chip-row">
    ${DB.shopTypes.filter(t => t.id !== 'all').map(t =>
      `<button class="chip" onclick="go('shops/${t.id}')">${typeIcon(t.id, 14)}${t.name}</button>`).join('')}
    <button class="chip" onclick="go('categories')">${ic('grid', 14)}All categories</button>
  </div>

  <div class="promo-scroll">
    <div class="promo p1" onclick="go('shops/organic')"><div><small>PURE &amp; LOCAL</small><b>All organic food,<br/>from farms near you</b><em>Shop organic</em></div><span>${ic('leaf', 52)}</span></div>
    <div class="promo p5" onclick="go('tickets')"><div><small>THIS WEEKEND</small><b>Events near you —<br/>attend, plan or host</b><em>Explore events</em></div><span>${ic('star', 52)}</span></div>
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

  <button class="promise-strip" onclick="go('promise')">${ic('shield', 14)} <b>One promise, kept.</b> Verified by named inspectors · delivered by neighbours ${ic('arrowr', 12)}</button>

  <div class="foot-note">Orignals — every shop, every street, everyone earns<br/>
  <span class="dim">First month free · Buyers 1 CHF/yr · Sellers tiered 1–100 CHF/yr</span></div>`;

  const hints = ['"Order 2 milk from the kirana…"', '"Send this tiffin to grandma"', '"Events near me this weekend"', '"Book a bike to the station"', '"Kya mera order aa gaya?"'];
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

/* ---------- ONE PROMISE, KEPT (video spec) ---------- */
view('promise', () => {
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>The Orignals promise</h1><small>One promise across every service</small></div></div>
  <div class="promise-page">
    <svg class="seal" width="120" height="120" viewBox="0 0 150 150">
      <defs><path id="sealArc2" d="M75 20 a55 55 0 1 1 -0.01 0"/></defs>
      <circle cx="75" cy="75" r="72" fill="none" stroke="#1A5632" stroke-width="2.5"/>
      <circle cx="75" cy="75" r="63" fill="none" stroke="#1A5632" stroke-width="1.2" stroke-dasharray="2 5"/>
      <circle cx="75" cy="75" r="42" fill="none" stroke="#1A5632" stroke-width="2"/>
      <text font-size="11.5" font-weight="700" letter-spacing="3.5" fill="#1A5632" font-family="Inter,sans-serif">
        <textPath href="#sealArc2" startOffset="0%">PURITY · VERIFIED · ORIGNALS ·</textPath></text>
      <g transform="translate(75,75)">
        <path d="M0-22c7 0 14 5.4 14 12.6 0 6.4-5.4 11-11.4 11.4V9h-5.2V2C-8.6 1.6-14-3-14-9.4-14-16.6-7-22 0-22z" fill="#1A5632"/>
        <path d="M-9 9h18" stroke="#1A5632" stroke-width="2.4" stroke-linecap="round"/></g>
    </svg>
    <h1>One promise, kept.</h1>
    <div class="promise-list">
      <div class="promise-row"><i>${ic('check', 13)}</i><div><b>Verified by named inspectors</b>
        <small>A real person with a real name checks every food shop — and you see who checked it, and when. Adulterated ghee and fake paneer end here.</small></div></div>
      <div class="promise-row"><i>${ic('check', 13)}</i><div><b>Delivered by neighbours you can see</b>
        <small>Every partner is ID-, face- and vehicle-verified. You see their name, their rating, their trips — and they see yours.</small></div></div>
      <div class="promise-row"><i>${ic('check', 13)}</i><div><b>The price on the card is the price you pay</b>
        <small>No surge, no hidden fees, no dark patterns. Cancel before pickup and every rupee returns to your wallet instantly.</small></div></div>
    </div>
    <div class="promise-foot">One promise across every service</div>
    <button class="btn-main wide" onclick="go('shops')">Shop with the promise</button>
  </div>`;
});
