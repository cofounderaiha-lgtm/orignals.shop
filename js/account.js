/* ============================================================
   ACCOUNT / PROFILE — one clean identity for a buyer, with optional
   "earn & sell" roles below. Staff/super-admin access is NEVER part of
   this screen for normal users — it is injected only after the server
   confirms the signed-in account is staff (see the end of the view).
   ============================================================ */

/* ---------- EARNINGS & PAYOUTS ----------
   This replaced the wallet on 2026-07-17. There is NO stored balance and no
   top-up: every order is paid by UPI/card or cash on delivery. What lives here
   is money the platform OWES you for deliveries/sales, and it is paid out to
   your UPI — it can never be spent inside the app. */
view('wallet', () => {
  const owed = (typeof earnedTotal === 'function') ? earnedTotal() : 0;
  const led = (S.earnings || []);
  const reqs = (S.payoutRequests || []);
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('account')">${ic('chevl', 16)}</button>
    <div><h1>Earnings &amp; payouts</h1><small>What you've earned — paid out to your UPI</small></div></div>

  <div class="wallet-card">
    <small>TO BE PAID OUT</small>
    <b>${money(owed)}</b>
    <span>${esc(displayName())} · paid to your UPI</span>
  </div>

  <div class="trust-row">${ic('shield', 12)} Orignals holds no balance for you. You pay per order by UPI/card or cash, and money you earn is transferred to your bank — nothing is stored on the app.</div>

  ${reqs.length ? `<div class="sec-head"><h2>Payout requests</h2></div>
  ${reqs.slice(0, 10).map(r => `<div class="ck-line"><span>${esc(r.upi)} · ${new Date(r.ts).toLocaleDateString('en-IN')}</span><span><b>${money(r.amt)}</b> · ${esc(r.status)}</span></div>`).join('')}` : ''}

  <div class="sec-head"><h2>Earnings</h2></div>
  ${led.length ? led.map(t => `
    <div class="order-row static">
      <span class="or-emoji">${ic('cash', 17)}</span>
      <div class="or-info"><b>${esc(t.label)}</b><small>${new Date(t.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
      <b class="ok">+${money(t.amt)}</b>
    </div>`).join('')
    : `<div class="empty"><span>${ic('cash', 40)}</span><b>No earnings yet</b><p>Deliver an order or sell from your shop and it appears here.</p></div>`}`;
});

/* ---------- NOTIFICATIONS ---------- */
view('notifs', () => {
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>Updates</h1><small>${notifUnread()} unread</small></div>
    ${S.notifs.length ? `<button class="lnk red" onclick="if(confirm('Clear all updates?')){S.notifs=[];save();VIEWS.notifs([])}">Clear all</button>` : ''}</div>
  ${S.notifs.length ? S.notifs.map(n => `
    <div class="order-row static ${n.read ? '' : 'unread'}">
      <span class="or-emoji">${ic('bell', 17)}</span>
      <div class="or-info"><b>${esc(n.title)}</b><small>${esc(n.body)}</small>
        <small class="dim">${new Date(n.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
    </div>`).join('')
    : `<div class="empty"><span>${ic('bell', 40)}</span><b>All quiet</b><p>Order updates and earnings land here.</p></div>`}`;
  S.notifs.forEach(n => n.read = true); save(); refreshChrome('notifs');
});

/* ---------- ACCOUNT / PROFILE ---------- */
view('account', () => {
  const v = S.partner ? DB.vehicles.find(x => x.id === S.partner.veh) : null;
  const isBusiness = !!(S.myShop || S.partner || (S.myListings || []).length);
  /* one-time: ensure a referral code exists & is registered */
  if (!S.refCode) { S.refCode = 'ORIG-' + uid().slice(0, 5).toUpperCase(); save(); }
  if (!S.refRegistered && typeof cloudRefRegister === 'function' && typeof CLOUD !== 'undefined' && CLOUD.on) { cloudRefRegister(S.refCode); S.refRegistered = true; save(); }

  $('#view').innerHTML = `
  <div class="acct-head">
    <span class="acct-ava">${esc((displayName()[0] || 'G').toUpperCase())}</span>
    <div><h1>${esc(displayName())}</h1><small>${isGuest() ? 'Guest — sign in to secure your account' : esc(S.user.addr.name)}</small></div>
    <button class="lnk" onclick="${isGuest() ? "go('login')" : 'editProfile()'}">${isGuest() ? 'Sign in' : 'Edit'}</button>
  </div>

  <div class="earn-tiles wide3">
    <div class="etile" onclick="go('wallet')"><b>${money(typeof earnedTotal === 'function' ? earnedTotal() : 0)}</b><small>Earnings</small></div>
    <div class="etile" onclick="go('orders')"><b>${S.orders.length}</b><small>Orders</small></div>
    <div class="etile" onclick="go('notifs')"><b>${notifUnread()}</b><small>Updates</small></div>
  </div>

  ${isGuest()
    ? `<button class="role-row highlight" onclick="go('login')"><span>${ic('shield', 20)}</span><div><b>Sign in / Create account</b><small>Secure your wallet, orders &amp; data across devices</small></div><em>Go</em></button>`
    : `<div class="sec-head"><h2>Account &amp; security</h2></div>${typeof authBadgeHTML === 'function' ? authBadgeHTML() : ''}`}

  <div class="sec-head"><h2>Settings</h2></div>
  <button class="role-row" onclick="pickAddress(()=>VIEWS.account([]))">
    <span>${ic('pin', 20)}</span><div><b>Delivery location</b><small>${esc(S.user.addr.name)}</small></div><em>Change</em></button>
  <button class="role-row" onclick="currencySheet()">
    <span>${ic('cash', 20)}</span><div><b>Currency</b><small>${CURRENCIES[CUR.code] ? CURRENCIES[CUR.code].name : 'Your currency'} (${CUR.code})</small></div><em>${CUR.code}</em></button>
  <button class="role-row" onclick="toggleTheme();VIEWS.account([])">
    <span>${ic(S.theme === 'light' ? 'moon' : 'sun', 20)}</span><div><b>Appearance</b><small>${S.theme === 'light' ? 'Light' : 'Dark'} mode</small></div><em>Switch</em></button>
  <button class="role-row" onclick="go('notifs')">
    <span>${ic('bell', 20)}</span><div><b>Notifications</b><small>${notifUnread()} unread</small></div><em>Open</em></button>
  <button class="role-row" onclick="installApp()">
    <span>${ic('upload', 20)}</span><div><b>Install the app</b><small>Add to home screen — works offline</small></div><em>Install</em></button>
  <button class="role-row" onclick="go('mitra')">
    <span>${ic('spark', 20)}</span><div><b>Talk to Mitra</b><small>Your in-app assistant — voice or text</small></div><em>Chat</em></button>

  <div class="card-block">
    <h3>${ic('gift', 15)} Refer &amp; earn — ₹50 each</h3>
    <p class="movie-about">Share your code. When a friend joins and places their first order, you both get ₹50 in wallet.</p>
    <div class="ck-coupon"><input value="${S.refCode}" readonly id="refCodeBox"/><button onclick="copyRef()">Copy</button></div>
    ${S.refRedeemed ? `<div class="trust-row">${ic('check', 13)} Friend's code applied — ₹50 credited</div>`
      : `<div class="ck-coupon" style="margin-top:8px"><input id="refIn" placeholder="Have a friend's code? ORIG-XXXXX"/><button onclick="redeemRef()">Apply</button></div>`}
  </div>

  <div class="sec-head"><h2>Earn &amp; sell with Orignals</h2></div>
  <button class="role-row" onclick="setMode('earn')">
    <span>${ic('users', 20)}</span><div><b>Deliver &amp; earn</b><small>${S.partner ? (S.partner.status === 'verified' ? `Verified${v ? ' · ' + v.name : ''} · ${S.partner.jobs} trips` : 'Verification in progress…') : 'Face + vehicle verified · earn or do seva'}</small></div>
    <em>${S.partner ? 'Open' : 'Start'}</em></button>
  <button class="role-row" onclick="go('myshop')">
    <span>${ic('store', 20)}</span><div><b>Sell — open your shop</b><small>${S.myShop ? esc(S.myShop.name) + ' · ' + money(S.myShop.revenue) : 'List your dukaan · free for the first month'}</small></div>
    <em>${S.myShop ? 'Open' : 'Start'}</em></button>
  <button class="role-row" onclick="go('services')">
    <span>${ic('user', 20)}</span><div><b>Offer a service</b><small>Any profession — get expertise-verified</small></div><em>Open</em></button>
  <button class="role-row" onclick="go('estate')">
    <span>${ic('home', 20)}</span><div><b>Host a stay / list property</b><small>${(S.myListings || []).length ? S.myListings.length + ' live listing(s)' : 'Rooms, homestays, sell or rent'}</small></div><em>Open</em></button>
  ${isBusiness ? `<button class="role-row" onclick="go('papers')">
    <span>${ic('shield', 20)}</span><div><b>Papers &amp; licences</b><small>Get GST, FSSAI, trade licences made${(S.docRequests || []).some(r => r.status !== 'cancelled' && r.status !== 'issued') ? ' · <b class="ok">in progress</b>' : ''}</small></div><em>Open</em></button>` : ''}

  <div id="staffEntry"></div>

  <div class="sec-head"><h2>Help, legal &amp; data</h2></div>
  <button class="role-row" onclick="go('legal')">
    <span>${ic('shield', 20)}</span><div><b>Legal &amp; policies</b><small>Privacy, terms, refunds, grievance</small></div><em>View</em></button>
  <button class="role-row" onclick="go('legal/data')">
    <span>${ic('lock', 20)}</span><div><b>Your data</b><small>Export everything or erase it — your right</small></div><em>Manage</em></button>
  <button class="role-row" onclick="resetDemo()">
    <span>${ic('trash', 20)}</span><div><b>Reset app data</b><small>Clear this device — orders, wallet, roles</small></div><em>Reset</em></button>
  ${isGuest() ? '' : `<button class="btn-main wide ghost red" style="margin-top:10px" onclick="if(typeof authLogout==='function')authLogout()">Sign out</button>`}

  <div class="foot-note">Orignals — a product of EdurankAI · Safety · Purity · Sustainability<br/>
  <span class="dim"><a onclick="go('legal/privacy')">Privacy</a> · <a onclick="go('legal/terms')">Terms</a> · <a onclick="go('legal/refund')">Refunds</a> · <a onclick="go('legal/grievance')">Grievance</a></span></div>`;

  /* STAFF / SUPER-ADMIN entry — injected ONLY after the SERVER confirms this
     signed-in account is staff (admin_whoami.admin === true). A normal user,
     and every guest, never sees it: the placeholder stays empty and the /admin
     route itself is server-gated too. */
  window.__isStaff = false; window.__staffLevel = null;
  if (typeof adminApi === 'function' && typeof CLOUD !== 'undefined' && CLOUD.on && typeof authState === 'function' && authState() && authState().token) {
    adminApi('admin_whoami', {}).then(w => {
      if (!w || !w.admin) { window.__isStaff = false; window.__staffLevel = null; return; }
      window.__isStaff = true; window.__staffLevel = w.level || null;
      const box = document.getElementById('staffEntry');
      if (!box) return;
      box.innerHTML = `<div class="sec-head"><h2>Staff</h2></div><button class="role-row admin" onclick="go('admin')">
        <span>${ic('shield', 20)}</span><div><b>${esc((w.level || 'l1').toUpperCase())} · Staff console</b><small>Your department controls${w.ident ? ' · ' + esc(w.ident) : ''}</small></div><em>Enter</em></button>`;
    }).catch(() => {});
  }
});

function currencySheet() {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Choose your currency</h3>
    <div class="foot-note sm" style="text-align:left;margin:0 0 8px">Prices show in your currency. Shops are in India, so the platform settles in ₹ (INR) — foreign amounts are indicative.</div>
    ${Object.entries(CURRENCIES).map(([code, c]) => `<button class="place-row" onclick="setCurrency('${code}',true);closeSheet();toast('Prices now in ${code}');VIEWS.account([])">
      <span style="font-weight:800">${c.sym.trim() || code}</span><div><b>${esc(c.name)}</b><small>${code} · e.g. ${(() => { const p = CUR; CUR = Object.assign({ code }, c); const s = money(500); CUR = p; return s; })()} for ₹500</small></div>${CUR.code === code ? '<em class="ok">✓</em>' : '<em>Select</em>'}</button>`).join('')}`);
}
function buyMembership() {
  /* real payment only — no wallet deduction */
  checkoutSheet({
    title: 'Orignals membership · 1 year', icon: 'shield',
    meta: 'Everything unlocked for a year',
    lines: [['Membership (1 year)', 99]], total: 99,
    onPay: () => {
      S.memberTill = Date.now() + 365 * 86400000; save();
      confettiBurst(); toast('Member! Everything unlocked for a year');
      notify('Membership active', 'Welcome to Orignals — 1 year, everything access.');
      VIEWS.account([]);
    }
  });
  return;
}

function editProfile() {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Your profile</h3>
    <label class="fld"><span>Your name</span><input class="txt" id="pfName" value="${esc(S.user.name)}"/></label>
    <button class="btn-main wide" onclick="
      const n=$('#pfName').value.trim();
      if(n.length<2){toast('Enter your name');return}
      S.user.name=n;save();closeSheet();toast('Saved');VIEWS.account([])">Save</button>`);
}

function resetDemo() {
  if (!confirm('Reset everything? Wallet, orders, your shop, listings and partner profile will be cleared.')) return;
  localStorage.removeItem(OMNY_KEY);
  location.hash = ''; location.reload();
}


/* ---------- referral ---------- */
function copyRef() {
  const v = $('#refCodeBox').value;
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(() => toast('Code copied — share away!'));
  else { $('#refCodeBox').select(); document.execCommand && document.execCommand('copy'); toast('Code copied'); }
}
async function redeemRef() {
  const v = ($('#refIn').value || '').trim().toUpperCase();
  if (!/^ORIG-[A-Z0-9]{4,6}$/.test(v)) { toast('Codes look like ORIG-XXXXX'); return; }
  if (v === S.refCode) { toast("That's your own code!"); return; }
  if (S.refRedeemed) { toast('You have already used a referral code'); return; }
  /* real cross-device: credits the friend who owns this code, too */
  if (typeof cloudRedeemRef === 'function' && CLOUD.on) {
    const r = await cloudRedeemRef(v);
    if (!r.ok) {
      const msg = r.reason === 'invalid' ? 'That code was not found' : r.reason === 'self' ? "That's your own code!" : r.reason === 'used' ? 'You have already used a referral code' : 'Could not apply the code — try again';
      toast(msg); return;
    }
  }
  S.refRedeemed = v;
  earnCredit(50, 'Referral bonus · ' + v);
  confettiBurst(); toast('₹50 added — your friend gets ₹50 too!');
  VIEWS.account([]);
}
