/* ============================================================
   ACCOUNT — every user type in one identity:
   Buyer · Partner · Seller · Host · Property · Super Admin
   ============================================================ */

/* ---------- WALLET ---------- */
view('wallet', () => {
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('account')">${ic('chevl', 16)}</button>
    <div><h1>Wallet</h1><small>One wallet for shopping, rides, tickets &amp; earnings</small></div></div>

  <div class="wallet-card">
    <small>AVAILABLE BALANCE</small>
    <b>${money(S.wallet.bal)}</b>
    <span>${esc(S.user.name)} · Orignals Pay</span>
  </div>

  <div class="sec-head"><h2>Add money</h2></div>
  <div class="topup-row">
    ${[100, 200, 500, 1000].map(a => `<button class="topup" onclick="walletAdd(${a},'Added via UPI (demo)');toast('${money(a).replace(/'/g, '')} added');VIEWS.wallet([])">+${money(a)}</button>`).join('')}
  </div>
  <div class="foot-note">Demo top-up is free. In production this opens your UPI app.</div>

  <div class="sec-head"><h2>History</h2></div>
  ${S.wallet.txns.filter(t => t.label).map(t => `
    <div class="order-row static">
      <span class="or-emoji">${ic(t.amt >= 0 ? 'cash' : 'card', 17)}</span>
      <div class="or-info"><b>${esc(t.label)}</b><small>${new Date(t.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
      <b class="${t.amt >= 0 ? 'ok' : 'red'}">${t.amt >= 0 ? '+' : '−'}${money(Math.abs(t.amt))}</b>
    </div>`).join('')}`;
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

/* ---------- ACCOUNT ---------- */
view('account', () => {
  const v = S.partner ? DB.vehicles.find(x => x.id === S.partner.veh) : null;
  const memberTill = S.memberTill && S.memberTill > Date.now();
  $('#view').innerHTML = `
  <div class="acct-head">
    <span class="acct-ava">${(S.user.name || 'F')[0].toUpperCase()}</span>
    <div><h1>${esc(S.user.name)}</h1><small>${esc(S.user.addr.name)} · ${esc(S.user.addr.sub)}</small></div>
    <button class="lnk" onclick="editProfile()">Edit</button>
  </div>

  <div class="earn-tiles wide3">
    <div class="etile" onclick="go('wallet')"><b>${money(S.wallet.bal)}</b><small>Wallet</small></div>
    <div class="etile" onclick="go('orders')"><b>${S.orders.length}</b><small>Orders</small></div>
    <div class="etile" onclick="go('notifs')"><b>${notifUnread()}</b><small>Updates</small></div>
  </div>

  <div class="card-block">
    <h3>${ic('shield', 15)} Membership — 1 CHF/year</h3>
    <p class="movie-about">First month complimentary for everyone, no signup fees. Buyers 1 CHF/yr. Sellers, 5 tiers: Individual 1 · Retail 10 · Large retail 25 · Wholesaler 50 · Manufacturer 100 CHF/yr. Delivery partners by vehicle: on foot 1 up to truck 10 CHF/yr.</p>
    ${memberTill
      ? `<div class="trust-row">${ic('check', 13)} Active till ${new Date(S.memberTill).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>`
      : `<button class="btn-main sm" onclick="buyMembership()">Activate — ₹99 (≈1 CHF)</button>`}
  </div>

  ${(() => { if (!S.refCode) { S.refCode = 'ORIG-' + uid().slice(0, 5).toUpperCase(); save(); }
    return `<div class="card-block">
    <h3>${ic('gift', 15)} Refer &amp; earn — ₹50 each</h3>
    <p class="movie-about">Share your code. When a friend joins and places their first order, you both get ₹50 in wallet.</p>
    <div class="ck-coupon"><input value="${S.refCode}" readonly id="refCodeBox"/><button onclick="copyRef()">Copy</button></div>
    ${S.refRedeemed ? `<div class="trust-row">${ic('check', 13)} Friend's code applied — ₹50 credited</div>`
      : `<div class="ck-coupon" style="margin-top:8px"><input id="refIn" placeholder="Have a friend's code? ORIG-XXXXX"/><button onclick="redeemRef()">Apply</button></div>`}
  </div>`; })()}

  <div class="sec-head"><h2>Your roles — one identity, every side</h2></div>
  <button class="role-row" onclick="setMode('buy')">
    <span>${ic('cart', 20)}</span><div><b>Buyer</b><small>Purity-verified food &amp; every shop nearby</small></div><em>Active</em></button>
  <button class="role-row" onclick="setMode('earn')">
    <span>${ic('users', 20)}</span><div><b>Partner — rides &amp; delivery</b><small>${S.partner ? (S.partner.status === 'verified' ? `CV-verified · ${v.name} · ${S.partner.jobs} trips · ${S.partner.seva || 0} seva` : 'Verification in progress…') : 'Face + vehicle verified · earn or do seva'}</small></div>
    <em>${S.partner ? 'Open' : 'Join'}</em></button>
  <button class="role-row" onclick="go('myshop')">
    <span>${ic('store', 20)}</span><div><b>Seller — shop owner</b><small>${S.myShop ? esc(S.myShop.name) + ' · ' + money(S.myShop.revenue) + ' revenue' : 'List your dukaan · first month free, then tiered from 1 CHF/yr'}</small></div>
    <em>${S.myShop ? 'Open' : 'Join'}</em></button>
  <button class="role-row" onclick="go('estate/hotels')">
    <span>${ic('home', 20)}</span><div><b>Host — hotel &amp; stays</b><small>List rooms, homestays, hourly pods</small></div><em>Open</em></button>
  <button class="role-row" onclick="go('estate/buy')">
    <span>${ic('pin', 20)}</span><div><b>Property lister</b><small>${(S.myListings || []).length ? (S.myListings.length + ' live listing(s)') : 'Sell/rent property — GPS-pinned, fraud-proof'}</small></div><em>Open</em></button>
  <button class="role-row admin" onclick="go('admin')">
    <span>${ic('shield', 20)}</span><div><b>Super Admin</b><small>Full control — purity queue · KYC · fraud · orders · plans</small></div><em>Enter</em></button>

  <div class="sec-head"><h2>Settings</h2></div>
  <button class="role-row" onclick="installApp()">
    <span>${ic('upload', 20)}</span><div><b>Install the app</b><small>Add to home screen — works offline</small></div><em>Install</em></button>
  <button class="role-row" onclick="toggleTheme();VIEWS.account([])">
    <span>${ic(S.theme === 'light' ? 'moon' : 'sun', 20)}</span><div><b>${S.theme === 'light' ? 'Dark' : 'Light'} mode</b><small>Easy on the eyes</small></div><em>Switch</em></button>
  <button class="role-row" onclick="pickAddress(()=>VIEWS.account([]))">
    <span>${ic('pin', 20)}</span><div><b>Location</b><small>${esc(S.user.addr.name)} — use GPS for instant delivery</small></div><em>Change</em></button>
  <button class="role-row" onclick="go('mitra')">
    <span>${ic('spark', 20)}</span><div><b>Talk to Mitra</b><small>The platform's own intelligence — voice or text</small></div><em>Chat</em></button>
  <button class="role-row" onclick="resetDemo()">
    <span>${ic('trash', 20)}</span><div><b>Reset demo data</b><small>Fresh start — clears orders, wallet, roles</small></div><em>Reset</em></button>

  <div class="foot-note">Orignals · Safety · Purity · Sustainability — for all<br/>
  <span class="dim">People-first: small shops thrive, neighbours earn, no one loses their job to a machine.</span></div>`;
});

function buyMembership() {
  if (!walletPay(99, 'Orignals membership · 1 year')) { toast('Wallet low — add money first'); return; }
  S.memberTill = Date.now() + 365 * 86400000; save();
  confettiBurst(); toast('Member! Everything unlocked for a year');
  notify('Membership active', 'Welcome to Orignals — 1 year, everything access.');
  VIEWS.account([]);
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
function redeemRef() {
  const v = ($('#refIn').value || '').trim().toUpperCase();
  if (!/^ORIG-[A-Z0-9]{4,6}$/.test(v)) { toast('Codes look like ORIG-XXXXX'); return; }
  if (v === S.refCode) { toast("That's your own code!"); return; }
  S.refRedeemed = v;
  walletAdd(50, 'Referral bonus · ' + v);
  confettiBurst(); toast('₹50 added — your friend gets ₹50 too!');
  VIEWS.account([]);
}
