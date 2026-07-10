/* ============================================================
   ORIGNALS core — state · router · UI kit · wallet · order engine
   (localStorage namespace is 'omny_*' — internal, invisible to users;
    kept stable so existing installs don't lose their data)
   ============================================================ */

/* ---------- tiny helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* ---------- multi-currency (prices are stored in INR; display in the
   user's currency; the platform still settles in INR) ---------- */
const CURRENCIES = {
  INR: { sym: '₹', rate: 1, loc: 'en-IN', name: 'Indian Rupee' },
  USD: { sym: '$', rate: 83, loc: 'en-US', name: 'US Dollar' },
  EUR: { sym: '€', rate: 90, loc: 'de-DE', name: 'Euro' },
  GBP: { sym: '£', rate: 105, loc: 'en-GB', name: 'British Pound' },
  AED: { sym: 'AED ', rate: 22.6, loc: 'en-AE', name: 'UAE Dirham' },
  SGD: { sym: 'S$', rate: 61, loc: 'en-SG', name: 'Singapore Dollar' },
  AUD: { sym: 'A$', rate: 54, loc: 'en-AU', name: 'Australian Dollar' },
  CAD: { sym: 'C$', rate: 60, loc: 'en-CA', name: 'Canadian Dollar' },
  NPR: { sym: 'रू ', rate: 0.625, loc: 'ne-NP', name: 'Nepali Rupee' },
  BDT: { sym: '৳ ', rate: 0.755, loc: 'bn-BD', name: 'Bangladeshi Taka' },
  SAR: { sym: 'SAR ', rate: 22.1, loc: 'ar-SA', name: 'Saudi Riyal' }
};
let CUR = { code: 'INR', sym: '₹', rate: 1, loc: 'en-IN' };
function setCurrency(code) {
  const c = CURRENCIES[code]; if (!c) return;
  CUR = Object.assign({ code }, c);
  if (typeof S !== 'undefined' && S) { S.currency = code; save(); }
}
function detectCurrency() {
  let code = (typeof S !== 'undefined' && S && S.currency) || null;
  if (!code) {
    const reg = ((navigator.language || 'en-IN').split('-')[1] || 'IN').toUpperCase();
    code = { US: 'USD', GB: 'GBP', AE: 'AED', SG: 'SGD', AU: 'AUD', CA: 'CAD', NP: 'NPR', BD: 'BDT', SA: 'SAR',
      DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR' }[reg] || 'INR';
  }
  setCurrency(code);
}
function isIndia() { return (CUR.code || 'INR') === 'INR'; }
const money = n => {
  const v = Number(n || 0) / CUR.rate;
  if (CUR.code === 'INR') return '₹' + Math.round(v).toLocaleString('en-IN');
  const dp = v >= 100 ? 0 : 2;
  try { return CUR.sym + (Math.round(v * (dp ? 100 : 1)) / (dp ? 100 : 1)).toLocaleString(CUR.loc, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  catch (e) { return CUR.sym + (Math.round(v * 100) / 100); }
};
/* always-INR formatter for the actual charge / invoices */
const moneyINR = n => '₹' + Number(Math.round(n)).toLocaleString('en-IN');

/* real identity: the signed-in name, or a set name, else 'Guest'.
   'Friend' was a placeholder default — never treat it as a real login. */
function isGuest() {
  const a = (typeof authState === 'function') ? authState() : null;
  if (a && a.token) return false;
  return !(typeof S !== 'undefined' && S && S.user && S.user.name && S.user.name !== 'Friend');
}
function displayName() {
  const a = (typeof authState === 'function') ? authState() : null;
  if (a && a.name) return a.name;
  if (typeof S !== 'undefined' && S && S.user && S.user.name && S.user.name !== 'Friend') return S.user.name;
  return 'Guest';
}
const uid  = () => Math.random().toString(36).slice(2, 9);
const pick = a => a[Math.floor(Math.random() * a.length)];
const rnd  = (a, b) => Math.round(a + Math.random() * (b - a));
const kmFare = (v, km) => Math.max(v.base + v.perKm * km, 20);

/* ---------- state ---------- */
const OMNY_KEY = 'omny_v1';

function defaultState() {
  return {
    theme: 'light',
    mode: 'buy',                              // buy | earn
    user: { name: 'Friend', phone: '', addr: DB.places[0] },
    wallet: { bal: 500, txns: [{ id: uid(), ts: Date.now(), label: 'Welcome gift 🎉', amt: +500 }] },
    cart: { shopId: null, items: {} },        // one shop at a time
    orders: [],                               // unified orders across everything
    notifs: [],
    partner: null,                            // earn-mode profile
    activeJob: null,
    earnings: [],                             // completed jobs {id,ts,what,pay}
    myShop: null,                             // shop-owner profile
    favs: []
  };
}

let S;
try { S = Object.assign(defaultState(), JSON.parse(localStorage.getItem(OMNY_KEY)) || {}); }
catch (e) { S = defaultState(); }
function save() {
  S.lastSaved = Date.now();
  localStorage.setItem(OMNY_KEY, JSON.stringify(S));
  if (typeof cloudQueue === 'function') cloudQueue();
}

/* ---------- theme ---------- */
function applyTheme() { document.documentElement.dataset.theme = S.theme; }
function toggleTheme() { S.theme = S.theme === 'light' ? 'dark' : 'light'; save(); applyTheme(); }

/* ---------- router ---------- */
const VIEWS = {};
function view(name, fn) { VIEWS[name] = fn; }
function go(path) { location.hash = '#/' + path; }

/* route source: the hash wins for in-app nav, but a direct visit to a
   real path (e.g. orignals.shop/admin) is honoured too — so clean URLs
   without a #/ work. */
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h) return h;
  const p = location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (p) return decodeURIComponent(p);
  return S.mode === 'earn' ? 'earn' : 'home';
}

function route() {
  const parts = currentRoute().split('/');
  const name = parts[0];
  const fn = VIEWS[name] || VIEWS.home;
  const main = $('#view');
  main.className = 'view-out';
  fn(parts.slice(1));
  requestAnimationFrame(() => { main.className = 'view-in'; });
  window.scrollTo(0, 0);
  refreshChrome(name);
}

/* ---------- mode toggle (Buy ⇄ Earn) ---------- */
function setMode(m) {
  if (S.mode === m) return;
  S.mode = m; save();
  toast(m === 'earn' ? 'Earn mode — deliver & earn as you go' : 'Buy mode — every shop near you', m === 'earn' ? '🤝' : '🛍️');
  go(m === 'earn' ? 'earn' : 'home');
}

/* ---------- chrome (header + bottom nav) ---------- */
function refreshChrome(current) {
  $('#walletChip').textContent = money(S.wallet.bal);
  const visualMode = current === 'home' ? S.mode : (['earn', 'earnings'].includes(current) ? 'earn' : 'buy');
  $('#modeToggle').className = 'mode-toggle ' + visualMode;
  $$('.hd-link').forEach(b => b.classList.toggle('active', b.dataset.v === current));
  const n = notifUnread();
  $('#bellDot').style.display = n ? 'block' : 'none';
  const cc = cartCount();
  const bubble = $('#cartBubble');
  if (cc && S.mode === 'buy') { bubble.style.display = 'flex'; $('#cartBubbleCount').textContent = cc; $('#cartBubbleTotal').textContent = money(cartTotal().total); }
  else bubble.style.display = 'none';
  $$('.bnav-item').forEach(b => b.classList.toggle('active', b.dataset.v === current));
  $('#locName').textContent = S.user.addr.name;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.innerHTML = `${ic('check', 15)}<span>${esc(String(msg).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim())}</span>`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- bottom sheet ---------- */
function sheet(html, cls) {
  $('#sheetBody').innerHTML = html;
  $('#sheetBody').className = 'sheet-body ' + (cls || '');
  $('#sheetWrap').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheetWrap').classList.remove('open');
  document.body.style.overflow = '';
  /* release any un-paid seat hold the user is walking away from */
  if (typeof releaseSeatHold === 'function') releaseSeatHold();
}

/* ---------- confetti ---------- */
function confettiBurst() {
  const c = document.createElement('div'); c.className = 'confetti';
  const colors = ['#1A5632', '#E8A020', '#67C48D', '#C84B31', '#F1EADC'];
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('i');
    p.style.cssText = `left:${rnd(5, 95)}%;background:${pick(colors)};animation-delay:${Math.random() * .5}s;animation-duration:${1.4 + Math.random()}s;transform:rotate(${rnd(0, 360)}deg)`;
    c.appendChild(p);
  }
  document.body.appendChild(c);
  setTimeout(() => c.remove(), 3000);
}

/* ---------- notifications ---------- */
function notify(title, body, emoji) {
  S.notifs.unshift({ id: uid(), ts: Date.now(), title, body, emoji: emoji || '🔔', read: false });
  S.notifs = S.notifs.slice(0, 40); save();
}
function notifUnread() { return S.notifs.filter(n => !n.read).length; }

/* ---------- wallet ---------- */
function walletAdd(amt, label) {
  S.wallet.bal += amt;
  S.wallet.txns.unshift({ id: uid(), ts: Date.now(), label, amt });
  save(); refreshChrome();
}
function walletPay(amt, label) {
  if (S.wallet.bal < amt) return false;
  walletAdd(-amt, label);
  return true;
}

/* ---------- cart (single shop at a time) ---------- */
function findShop(id) { return DB.shops.find(s => s.id === id); }
function findItem(shop, itemId) { return shop.items.find(i => i.id === itemId); }

function cartSet(shopId, itemId, qty) {
  if (S.cart.shopId && S.cart.shopId !== shopId && Object.keys(S.cart.items).length) {
    const old = findShop(S.cart.shopId);
    if (!confirm(`Your basket has items from ${old ? old.name : 'another shop'}. Start a fresh basket?`)) return;
    S.cart = { shopId: null, items: {} };
  }
  S.cart.shopId = shopId;
  if (qty <= 0) delete S.cart.items[itemId]; else S.cart.items[itemId] = qty;
  if (!Object.keys(S.cart.items).length) S.cart.shopId = null;
  save(); refreshChrome();
  if ((location.hash.replace(/^#\/?/, '') || '').split('/')[0] === 'cart') { VIEWS.cart([]); return; }
  $$(`[data-step="${itemId}"]`).forEach(el => el.outerHTML = stepper(shopId, itemId));
}
function cartQty(itemId) { return S.cart.items[itemId] || 0; }
function cartCount() { return Object.values(S.cart.items).reduce((a, b) => a + b, 0); }
/* ============================================================
   FEE MODEL (no buyer subscription — pay-per-use like the rivals):
   · Item total → 100% to the shop
   · GST → as applicable (5% on food/restaurant), remitted to govt
   · Platform fee → 5% of items (this ALSO absorbs the ~3% payment-
     gateway charge internally; buyers see one clean fee)
   · Delivery fee → distance-based (fuel/inflation aware), CAPPED so it
     never exceeds Zomato-class rivals. Shop's free-delivery offer wins.
   ============================================================ */
function cartTotal() {
  const shop = findShop(S.cart.shopId);
  let sub = 0;
  if (shop) for (const [iid, q] of Object.entries(S.cart.items)) { const it = findItem(shop, iid); if (it) sub += it.price * q; }
  if (!shop || !sub) return { sub: 0, gst: 0, platformFee: 0, deliveryFee: 0, fee: 0, total: 0, shop };

  const isFood = ['food', 'restaurant', 'organic', 'grocery', 'dairy', 'bakery'].includes(shop.type);
  const gst = isFood ? Math.round(sub * 0.05) : 0;                 // GST on prepared food
  const platformFee = Math.max(3, Math.round(sub * 0.05));         // 5% — absorbs ~3% gateway MDR

  const km = +shop.km || 2;
  const self = S.cart.deliv === 'self';
  const FUEL = 1.0;                                                // inflation/fuel multiplier (tunable centrally)
  let deliveryFee = Math.round(((self ? 12 : 22) + Math.max(0, km - 1) * (self ? 5 : 8)) * FUEL);
  if (sub < 149) deliveryFee += 12;                               // small-order fee (rival-standard)
  deliveryFee = Math.min(deliveryFee, self ? 45 : 65);            // hard cap ≤ rivals
  if (shop.offer && /free/i.test(shop.offer) && sub >= 199) deliveryFee = 0;  // shop's own free-delivery offer

  const total = sub + gst + platformFee + deliveryFee;
  return { sub, gst, platformFee, deliveryFee, fee: deliveryFee, total, shop };
}

/* stepper — ADD / − qty + control */
function stepper(shopId, itemId) {
  const q = cartQty(itemId);
  if (!q || S.cart.shopId !== shopId)
    return `<button class="stp add" data-step="${itemId}" onclick="event.stopPropagation();cartSet('${shopId}','${itemId}',1)">ADD</button>`;
  return `<span class="stp qty" data-step="${itemId}">
    <button onclick="event.stopPropagation();cartSet('${shopId}','${itemId}',${q - 1})">−</button><b>${q}</b>
    <button onclick="event.stopPropagation();cartSet('${shopId}','${itemId}',${q + 1})">+</button></span>`;
}

/* ---------- stars ---------- */
function stars(r) {
  return `<span class="stars">${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))}</span>`;
}

/* ============================================================
   ORDER ENGINE — status derives from elapsed time, survives reload
   ============================================================ */
const FLOWS = {
  shop_self:    [{ t: 'Order placed', e: 'receipt' }, { t: 'Shop confirmed', e: 'check' }, { t: 'Shop is on the way', e: 'bike' }, { t: 'Delivered', e: 'flag' }],
  shop_partner: [{ t: 'Order placed', e: 'receipt' }, { t: 'Shop is packing', e: 'package' }, { t: 'Nearby partner picked up', e: 'users' }, { t: 'On the way to you', e: 'bike' }, { t: 'Delivered', e: 'flag' }],
  send:         [{ t: 'Finding a partner passing by', e: 'search' }, { t: 'Partner assigned', e: 'users' }, { t: 'Picked up', e: 'package' }, { t: 'On the way', e: 'bike' }, { t: 'Delivered', e: 'flag' }],
  ride:         [{ t: 'Ride booked', e: 'pin' }, { t: 'Captain on the way', e: 'bike' }, { t: 'Ride in progress', e: 'arrowr' }, { t: 'Ride completed', e: 'flag' }]
};
/* seconds after placedAt when each stage begins */
const FLOW_T = {
  shop_self:    [0, 8, 22, 55],
  shop_partner: [0, 6, 16, 28, 60],
  send:         [0, 7, 15, 26, 58],
  ride:         [0, 5, 18, 50]
};

function createOrder(o) {
  o.id = 'OM' + rnd(10000, 99999);
  o.placedAt = Date.now();
  o.lastStage = 0;
  /* stage times scale with the real trip distance: longer routes
     genuinely take longer (proportions of the flow preserved) */
  if (o.km != null && FLOW_T[o.flow]) {
    const pattern = FLOW_T[o.flow];
    const last = pattern[pattern.length - 1];
    const total = Math.min(Math.max(40 + o.km * 16, 55), 220);
    o.flowT = pattern.map(t => Math.round(t / last * total));
  }
  if (!o.partner && o.flow !== 'shop_self') o.partner = Object.assign({ otp: rnd(1000, 9999) }, pick(DB.partners));
  S.orders.unshift(o); save();
  notify('Order ' + o.id + ' placed', o.title, '🧾');
  return o;
}
function orderTimes(o) { return o.flowT || FLOW_T[o.flow]; }
function orderStage(o) {
  /* community-shop orders are driven by the REAL shopkeeper's actions
     (accept → pack → hand over → delivered), not by a timer */
  if (o.cloudShop) {
    const last = FLOWS[o.flow].length - 1;
    const map = { new: 0, prep: 1, finding: 1, handed: last - 1, selfout: last - 1, done: last };
    const s = map[o.cloudStatus || 'new'];
    return Math.min(s != null ? s : 0, last);
  }
  const el = (Date.now() - o.placedAt) / 1000;
  const times = orderTimes(o);
  let idx = 0;
  for (let i = 0; i < times.length; i++) if (el >= times[i]) idx = i;
  return idx;
}
function orderDone(o) { return !!o.cancelled || orderStage(o) >= FLOWS[o.flow].length - 1; }
function orderStatus(o) { return o.cancelled ? { t: 'Cancelled — refunded', e: 'x' } : FLOWS[o.flow][orderStage(o)]; }
function canCancel(o) { return !o.cancelled && o.kind !== 'ride' && orderStage(o) < 2; }
function cancelOrder(oid) {
  const o = S.orders.find(x => x.id === oid);
  if (!o || !canCancel(o)) { toast('Too late to cancel — already picked up'); return; }
  o.cancelled = Date.now();
  /* tell the real shopkeeper on the other device */
  if (o.cloudShop && typeof CLOUD !== 'undefined' && CLOUD.on) {
    cloudFetch('rpc/shop_order_cancel', { method: 'POST', body: JSON.stringify({ p_id: o.id, p_device: S.deviceKey || 'anon' }) }).catch(() => {});
  }
  walletAdd(o.total, 'Refund · ' + o.id + ' · ' + o.title);
  notify('Order cancelled', money(o.total) + ' refunded to your wallet instantly', 'x');
  toast('Cancelled — ' + money(o.total) + ' refunded to wallet');
  if (typeof renderTrack === 'function' && $('#trackWrap')) renderTrack(oid);
  refreshChrome();
}
function activeOrders() { return S.orders.filter(o => !orderDone(o)); }

/* poll: fire notifications when a stage advances; refresh live views */
setInterval(() => {
  let changed = false;
  S.orders.forEach(o => {
    const st = orderStage(o);
    if (st > (o.lastStage || 0)) {
      o.lastStage = st;
      const f = FLOWS[o.flow][st];
      notify(f.t, o.title + ' · ' + o.id, f.e);
      toast(f.t + ' — ' + o.title, f.e);
      changed = true;
    }
  });
  if (changed) { save(); refreshChrome(); }
  if (typeof pollCloudOrders === 'function') pollCloudOrders();
  const live = $('[data-live-order]');
  if (live && typeof renderTrack === 'function') renderTrack(live.dataset.liveOrder);
  const strip = $('#activeStrip');
  if (strip && typeof activeStripHTML === 'function') strip.innerHTML = activeStripHTML();
}, 2500);

/* order timeline HTML (shared by tracking views) */
function timelineHTML(o) {
  const st = orderStage(o);
  return `<div class="timeline">` + FLOWS[o.flow].map((f, i) => `
    <div class="tl-row ${i < st ? 'done' : i === st ? 'now' : ''}">
      <div class="tl-dot">${i <= st ? ic(f.e, 13) : ''}</div>
      <div class="tl-info"><b>${f.t}</b>${i === st && !orderDone(o) ? '<span class="tl-live">Live</span>' : ''}</div>
    </div>`).join('') + `</div>`;
}

/* ---------- shared checkout sheet ---------- */
let _ckCoupon = null;
function checkoutSheet(cfg) {
  /* cfg: {title, emoji, lines:[[label,amt]], total, meta, onPay(finalTotal, couponOff)} */
  _ckCoupon = null;
  window._ckCfg = cfg;
  renderCheckout();
}
function renderCheckout() {
  const cfg = window._ckCfg;
  let off = 0, cpMsg = '';
  if (_ckCoupon) {
    const c = DB.coupons[_ckCoupon];
    if (c && cfg.total >= c.min) { off = c.off; cpMsg = `<span class="ok">✓ ${_ckCoupon} applied — ${money(off)} off</span>`; }
    else if (c) cpMsg = `<span class="bad">Needs minimum order of ${money(c.min)}</span>`;
    else cpMsg = `<span class="bad">Invalid code</span>`;
  }
  const final = Math.max(cfg.total - off, 0);
  const canWallet = S.wallet.bal >= final;
  sheet(`
    <div class="sheet-grab"></div>
    <div class="ck-head"><span class="ck-ic">${ic(cfg.icon || 'receipt', 22)}</span>
      <div><b>${esc(cfg.title)}</b><small>${esc(cfg.meta || 'Pay securely')}</small></div></div>
    <div class="ck-bill">
      ${cfg.lines.map(l => `<div class="ck-line"><span>${esc(l[0])}</span><span>${l[1] === 0 ? '<b class="ok">FREE</b>' : money(l[1])}</span></div>`).join('')}
      ${off ? `<div class="ck-line ok"><span>Coupon</span><span>− ${money(off)}</span></div>` : ''}
      <div class="ck-line grand"><span>To pay</span><span>${money(final)}</span></div>
    </div>
    <div class="ck-coupon">
      <input id="ckCoupon" placeholder="Coupon code (try FOOD50)" value="${_ckCoupon || ''}"/>
      <button onclick="_ckCoupon=$('#ckCoupon').value.trim().toUpperCase();renderCheckout()">Apply</button>
    </div>
    <div class="ck-cpmsg">${cpMsg}</div>
    <div class="ck-pays">
      <button class="ck-pay ${canWallet ? '' : 'dis'}" onclick="${canWallet ? `paySelected(${final},${off},'wallet')` : `toast('Wallet balance is low — add money or pay by UPI')`}">
        <span>${ic('wallet', 20)}</span><div><b>Orignals Wallet</b><small>Balance ${money(S.wallet.bal)}</small></div><em>${canWallet ? 'Pay ' + money(final) : 'Low balance'}</em></button>
      <button class="ck-pay" onclick="paySelected(${final},${off},'upi')">
        <span>${ic('card', 20)}</span><div><b>UPI / Card</b><small>GPay · PhonePe · Paytm · any bank app</small></div><em>Pay ${money(final)}</em></button>
      <button class="ck-pay" onclick="paySelected(${final},${off},'cod')">
        <span>${ic('cash', 20)}</span><div><b>Cash on delivery</b><small>Pay when it arrives</small></div><em>Book</em></button>
    </div>`);
}
function paySelected(final, off, method) {
  const cfg = window._ckCfg;
  if (method === 'wallet' && !walletPay(final, cfg.title)) { toast('Wallet balance is low', '👛'); return; }
  if (method === 'upi') {
    /* real money: Razorpay order → checkout → server-side signature verify */
    payViaRazorpay(final, { purpose: 'order', ref: cfg.title, desc: cfg.title }, (payId) => {
      S.wallet.txns.unshift({ id: uid(), ts: Date.now(), label: cfg.title + ' · UPI ·' + String(payId).slice(-6), amt: -final, ext: true });
      save();
      closeSheet(); confettiBurst();
      cfg.onPay(final, off, 'upi');
    });
    return;
  }
  save();
  closeSheet(); confettiBurst();
  cfg.onPay(final, off, method);
}

/* ---------- desktop header nav ---------- */
function buildChrome() {
  const nav = $('#hdNav');
  if (nav) nav.innerHTML = [
    ['shops', 'store', 'Nearby'], ['send', 'package', 'Send'], ['ride', 'bike', 'Rides'],
    ['tickets', 'star', 'Movies'], ['orders', 'receipt', 'Orders'], ['mitra', 'spark', 'Mitra']
  ].map(l => `<button class="hd-link" data-v="${l[0]}" onclick="go('${l[0]}')">${ic(l[1], 15)}<span>${l[2]}</span></button>`).join('');
  const mt = $('#modeToggle');
  if (mt) mt.innerHTML = `<button onclick="setMode('buy')">${ic('cart', 14)} Buy</button><button onclick="setMode('earn')">${ic('users', 14)} Earn</button>`;
}

/* ---------- real map (3rd-party lib now; own precise engine as fallback/roadmap) ---------- */
function realMap(elId, lat, lng, label) {
  const el = document.getElementById(elId);
  if (!el || !window.L || !navigator.onLine) return false;
  try {
    const map = L.map(el, { zoomControl: false, attributionControl: false }).setView([lat, lng], 15);
    const _mapCfg = (window.ORIGNALS_CONFIG || {}).map || {};
    L.tileLayer(_mapCfg.tileUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    L.marker([lat, lng]).addTo(map).bindPopup(label || 'Precise location').openPopup();
    return true;
  } catch (e) { return false; }
}

/* ---------- installable app (Add to Home Screen) ---------- */
let _installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _installEvt = e; refreshChrome(); showInstallBanner(); });
window.addEventListener('appinstalled', () => { _installEvt = null; const b = document.getElementById('instBar'); if (b) b.remove(); toast('Installed — open Orignals from your home screen'); });
function installApp() {
  if (_installEvt) { _installEvt.prompt(); _installEvt.userChoice && _installEvt.userChoice.finally(() => { _installEvt = null; }); return; }
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  toast(location.protocol === 'file:'
    ? 'Open it on orignals.shop — then Install appears'
    : iOS ? 'On iPhone: tap Share ⬆ → Add to Home Screen'
    : 'Use the browser menu → Install app / Add to Home Screen');
}
function showInstallBanner() {
  try {
    if (!_installEvt || sessionStorage.getItem('inst_hide') || document.getElementById('instBar')) return;
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
    const b = document.createElement('div');
    b.id = 'instBar'; b.className = 'install-bar';
    b.innerHTML = `<span>${ic('upload', 15)} <b>Install Orignals</b> — instant, works offline</span>
      <span class="ib-act"><button class="btn-main sm" onclick="installApp()">Install</button>
      <button class="inst-x" aria-label="Dismiss" onclick="sessionStorage.setItem('inst_hide','1');var e=document.getElementById('instBar');if(e)e.remove()">✕</button></span>`;
    document.body.appendChild(b);
  } catch (e) {}
}

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  if (typeof detectCurrency === 'function') detectCurrency();
  buildChrome();
  window.addEventListener('hashchange', route);
  route();
  if (typeof cloudInit === 'function') cloudInit();
  if (typeof opsBoot === 'function') setTimeout(opsBoot, 400);        // remote kill switches
  if (typeof authBoot === 'function') setTimeout(authBoot, 500);      // validate session (fail-open)
  if (typeof cloudClaimRefCredits === 'function') setTimeout(cloudClaimRefCredits, 3000);  // referral rewards
  if (typeof maybeShowConsent === 'function') setTimeout(maybeShowConsent, 700);  // first-run consent (DPDP)
  if (!S.notifs.length) notify('Welcome to Orignals', 'Purity-verified food, every shop nearby, earn as you go. ₹500 free in your wallet.');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
