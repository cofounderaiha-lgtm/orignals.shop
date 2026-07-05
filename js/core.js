/* ============================================================
   OMNY core — state · router · UI kit · wallet · order engine
   ============================================================ */

/* ---------- tiny helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => '₹' + Number(Math.round(n)).toLocaleString('en-IN');
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
function save() { localStorage.setItem(OMNY_KEY, JSON.stringify(S)); }

/* ---------- theme ---------- */
function applyTheme() { document.documentElement.dataset.theme = S.theme; }
function toggleTheme() { S.theme = S.theme === 'light' ? 'dark' : 'light'; save(); applyTheme(); }

/* ---------- router ---------- */
const VIEWS = {};
function view(name, fn) { VIEWS[name] = fn; }
function go(path) { location.hash = '#/' + path; }

function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || (S.mode === 'earn' ? 'earn' : 'home')).split('/');
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
function cartTotal() {
  const shop = findShop(S.cart.shopId);
  let sub = 0;
  if (shop) for (const [iid, q] of Object.entries(S.cart.items)) { const it = findItem(shop, iid); if (it) sub += it.price * q; }
  const fee = !shop ? 0 : (sub >= 199 ? 0 : (shop.delivery === 'self' ? 15 : 25));
  return { sub, fee, total: sub + fee, shop };
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
  if (!o.partner && o.flow !== 'shop_self') o.partner = Object.assign({ otp: rnd(1000, 9999) }, pick(DB.partners));
  S.orders.unshift(o); save();
  notify('Order ' + o.id + ' placed', o.title, '🧾');
  return o;
}
function orderStage(o) {
  const el = (Date.now() - o.placedAt) / 1000;
  const times = FLOW_T[o.flow];
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
        <span>${ic('card', 20)}</span><div><b>UPI / Card</b><small>Any bank app (demo)</small></div><em>Pay ${money(final)}</em></button>
      <button class="ck-pay" onclick="paySelected(${final},${off},'cod')">
        <span>${ic('cash', 20)}</span><div><b>Cash on delivery</b><small>Pay when it arrives</small></div><em>Book</em></button>
    </div>`);
}
function paySelected(final, off, method) {
  const cfg = window._ckCfg;
  if (method === 'wallet' && !walletPay(final, cfg.title)) { toast('Wallet balance is low', '👛'); return; }
  if (method === 'upi') S.wallet.txns.unshift({ id: uid(), ts: Date.now(), label: cfg.title + ' · UPI', amt: -final, ext: true });
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    L.marker([lat, lng]).addTo(map).bindPopup(label || 'Precise location').openPopup();
    return true;
  } catch (e) { return false; }
}

/* ---------- installable app (Add to Home Screen) ---------- */
let _installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _installEvt = e; refreshChrome(); });
function installApp() {
  if (_installEvt) { _installEvt.prompt(); _installEvt = null; return; }
  toast(location.protocol === 'file:'
    ? 'Host it (orignals.shop) or run a local server — then Install appears'
    : 'Use browser menu → Install app / Add to Home Screen');
}

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  buildChrome();
  window.addEventListener('hashchange', route);
  route();
  if (!S.notifs.length) notify('Welcome to Orignals', 'Purity-verified food, every shop nearby, earn as you go. ₹500 free in your wallet.');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
