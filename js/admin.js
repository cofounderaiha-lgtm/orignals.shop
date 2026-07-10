/* ============================================================
   ADMIN PANEL — precise everything, strictly anti-fraud
   Purity queue · KYC queue · shops · orders · revenue · plans
   ============================================================ */

function adminSeed() {
  if (S.admin) return;
  S.admin = {
    purityQueue: [
      { id: 'pq1', item: 'Wood-Pressed Ghee (batch #GH-042)', shop: 'Prakriti Organic Store', test: 'Fat profile + adulterant panel', status: 'pending' },
      { id: 'pq2', item: 'Paneer Fresh (batch #PN-118)', shop: 'Sharma Kirana & General', test: 'Starch + synthetic milk panel', status: 'pending' },
      { id: 'pq3', item: 'Forest Raw Honey (batch #HN-007)', shop: 'Prakriti Organic Store', test: 'C4 sugar + pollen count', status: 'pending' },
      { id: 'pq4', item: 'Turmeric Fingers (lot #TU-231)', shop: 'AgroHarvest Wholesale', test: 'Lead chromate screen', status: 'pending' }
    ],
    kycQueue: [
      { id: 'ky1', name: 'Ramesh V. · Bike partner', docs: 'ID ✓ · DL ✓ · RC pending', status: 'pending' },
      { id: 'ky2', name: 'Meena Stores · Kirana', docs: 'GST ✓ · Shop photo ✓ · Bank pending', status: 'pending' },
      { id: 'ky3', name: 'Hilltop Homestay · Host', docs: 'Property deed ✓ · Photos ✓', status: 'pending' }
    ],
    flags: [
      { id: 'fl1', what: 'OTP mismatch ×3 on delivery', who: 'Order OM55231', level: 'high' },
      { id: 'fl2', what: 'Same device, 4 new buyer accounts', who: 'Device d-88f2', level: 'high' },
      { id: 'fl3', what: 'Price 60% below market — possible counterfeit', who: 'Listing "branded ghee 1L @ ₹180"', level: 'med' },
      { id: 'fl4', what: 'GPS jump 8 km during live delivery', who: 'Partner P-3341', level: 'med' }
    ],
    resolved: 0
  };
  save();
}

/* ---------- admin control levels ---------- */
const ADMIN_ROLES = [
  { id: 'l5', name: 'L5 · Super Admin', desc: 'Founder-level. Everything below plus pricing plans, payouts, admin appointments, org-wide HRMS, live visitor analytics and the Test console.', perms: ['overview', 'analytics', 'purity', 'kyc', 'fraud', 'orders', 'plans', 'roles', 'hrms', 'data', 'mitra', 'test'] },
  { id: 'l4', name: 'L4 · Operations Admin', desc: 'Runs the platform day-to-day: live analytics, org-wide HRMS, KYC, fraud, all orders, database read, onboard staff up to L3.', perms: ['overview', 'analytics', 'kyc', 'fraud', 'orders', 'roles', 'hrms', 'data', 'mitra'] },
  { id: 'l3', name: 'L3 · Purity Inspector', desc: 'Field & lab team. Seals or delists batches, runs their department HR. ', perms: ['overview', 'purity', 'roles', 'hrms'] },
  { id: 'l2', name: 'L2 · City Manager', desc: 'Onboards shops & partners in their city, watches local orders, runs their department HR.', perms: ['overview', 'kyc', 'orders', 'roles', 'hrms'] },
  { id: 'l1', name: 'L1 · Support Agent', desc: 'Sees order status to help customers; own attendance & leave.', perms: ['overview', 'orders', 'roles', 'hrms'] }
];
/* server-verified level (from admin_whoami); falls back to l5 only for
   pure-local/offline demo mode where there is no cloud to check against */
let ADMIN_LEVEL = null, ADMIN_WHO = null;
function adminRole() {
  const lvl = ADMIN_LEVEL || ((typeof CLOUD === 'undefined' || !CLOUD.on) ? 'l5' : null);
  return ADMIN_ROLES.find(r => r.id === lvl) || ADMIN_ROLES[ADMIN_ROLES.length - 1];
}
function adminApi(fn, body) {
  const a = (typeof authState === 'function') ? authState() : null;
  if (!a || !a.token) return Promise.resolve({ ok: false, signed_in: false });
  return cloudFetch('rpc/' + fn, { method: 'POST', body: JSON.stringify(Object.assign({ p_token: a.token }, body || {})) }).catch(() => ({ ok: false }));
}
function adminRank(l) { return { l5: 5, l4: 4, l3: 3, l2: 2, l1: 1 }[l] || 0; }

/* gated entry: verify the admin level on the server before rendering */
/* /superadmin is an alias for /admin — same server-gated console */
view('superadmin', a => (VIEWS.admin || VIEWS.home)(a));
view('admin', async args => {
  const a = (typeof authState === 'function') ? authState() : null;
  const cloudOn = typeof CLOUD !== 'undefined' && CLOUD.on;
  if (cloudOn) {
    $('#view').innerHTML = `<div class="page-head"><button class="back" onclick="go('account')">${ic('chevl', 16)}</button><div><h1>Admin</h1><small>Verifying access…</small></div></div><div class="empty"><span>${ic('shield', 40)}</span><b>Checking your access…</b></div>`;
    let who = { admin: false, signed_in: false, bootstrap: false };
    if (a && a.token) who = await adminApi('admin_whoami', {}) || who;
    ADMIN_WHO = who;
    if (!who.admin) { renderAdminGate(who); return; }
    ADMIN_LEVEL = who.level;
  } else {
    ADMIN_LEVEL = 'l5';   // offline/local demo: full access on-device only
  }
  adminSeed();
  renderAdminPanel(args);
});

function renderAdminGate(who) {
  const signedIn = who && who.signed_in;
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('account')">${ic('chevl', 16)}</button>
    <div><h1>Admin access</h1><small>Restricted — staff only</small></div></div>
  <div class="auth-card" style="text-align:center">
    <span class="svc-ic" style="margin:4px auto 10px;width:56px;height:56px">${ic('shield', 26)}</span>
    ${!signedIn ? `
      <h3>Sign in to continue</h3>
      <p class="movie-about">The admin panel needs a verified staff account. Sign in with your Orignals account.</p>
      <button class="btn-main wide" onclick="go('login')">Sign in / Register</button>`
    : who.bootstrap ? `
      <h3>Set up the first Super Admin</h3>
      <p class="movie-about">No admins exist yet. Enter the one-time setup code to claim <b>${esc(who.ident || 'this account')}</b> as Super Admin (L5).</p>
      <label class="fld"><span>Setup code</span><input class="txt" id="admCode" placeholder="Setup code" autocomplete="off"/></label>
      <button class="btn-main wide" onclick="adminClaim()">Claim Super Admin</button>`
    : `
      <h3>You don't have admin access</h3>
      <p class="movie-about">${esc(who.ident || 'This account')} is not a staff member. Ask a Super Admin to add you, then sign in again.</p>
      <button class="btn-main wide ghost" onclick="go('account')">Back</button>`}
  </div>`;
}
async function adminClaim() {
  const code = ($('#admCode') && $('#admCode').value.trim()) || '';
  if (!code) { toast('Enter the setup code'); return; }
  const a = authState();
  const r = await adminApi('admin_claim', { p_code: code, p_name: (a && a.name) || S.user.name || '' });
  if (r && r.ok) { confettiBurst(); toast('You are now Super Admin'); go('admin'); }
  else toast(r && r.reason === 'bad_code' ? 'Wrong setup code' : r && r.reason === 'already_setup' ? 'A Super Admin already exists' : 'Could not claim — try again');
}

function renderAdminPanel(args) {
  const role = adminRole();
  let tab = args[0] || 'overview';
  if (!role.perms.includes(tab)) tab = 'overview';
  const A = S.admin;
  const tabs = [['overview', 'Overview'], ['analytics', 'Analytics'], ['hrms', 'HR &amp; Staff'], ['purity', 'Purity'], ['kyc', 'KYC'], ['fraud', 'Fraud'], ['orders', 'Orders'], ['plans', 'Plans'], ['roles', 'Team &amp; levels'], ['data', 'Database'], ['mitra', 'Mitra AI'], ['test', 'Test console']];
  const gmv = S.orders.reduce((a, o) => a + o.total, 0) + (S.myShop ? S.myShop.revenue : 0);
  let body = '';

  if (tab === 'overview') body = `
    <div class="earn-tiles wide3">
      <div class="etile"><b>${DB.shops.length + (S.myShop ? 1 : 0)}</b><small>Shops live</small></div>
      <div class="etile"><b>${DB.partners.length + (S.partner ? 1 : 0)}</b><small>Partners</small></div>
      <div class="etile"><b>${money(gmv)}</b><small>GMV (you)</small></div>
    </div>
    <div class="earn-tiles wide3">
      <div class="etile"><b>${A.purityQueue.filter(x => x.status === 'pending').length}</b><small>Purity checks due</small></div>
      <div class="etile"><b>${A.kycQueue.filter(x => x.status === 'pending').length}</b><small>KYC pending</small></div>
      <div class="etile"><b>${A.flags.length}</b><small>Fraud flags open</small></div>
    </div>
    <div class="card-block"><h3>${ic('shield', 15)} The Orignals doctrine</h3>
      <p class="movie-about">Precise everything: every item batch purity-tested by our own field people, every partner KYC-verified, every handover OTP-locked, every listing GPS-pinned. Adulterated ghee or paneer sold at premium prices is exactly what this platform exists to end.</p></div>
    <div class="card-block"><h3>Verification pipeline</h3>
      ${['Field inspector visits the shop/farm', 'Batch sample sealed & lab-tested', 'Pass → batch gets a Purity ✓ seal + trace ID', 'Fail → item delisted, seller warned/removed'].map((s, i) =>
        `<div class="ck-line"><span><b>${i + 1}.</b> ${s}</span><span></span></div>`).join('')}</div>`;

  if (tab === 'analytics') body = `
    <div class="tip-strip">${ic('shield', 13)} First-party & private — your own data, no Google Analytics. Exact locality &amp; coordinates when a visitor shares location, city-level from the network edge otherwise. Anonymous device keys, no personal info.</div>
    <div class="ana-live-bar"><span class="ana-dot"></span> <b id="anaLiveNow">…</b> online right now</div>
    <div class="chip-row" id="anaRange" style="margin:2px 0 10px">
      ${[[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days']].map(r => `<button class="chip ${(_ANA_DAYS || 30) === r[0] ? 'on' : ''}" onclick="adminAnaSetRange(${r[0]})">${r[1]}</button>`).join('')}
    </div>
    <div class="ana-map-wrap"><div id="anaMap" class="ana-map"></div><div class="ana-map-cap">${ic('pin', 11)} Live visitors — exact where shared, last 5 min</div></div>
    <div id="anaCards" class="earn-tiles wide3"><div class="etile"><b>…</b><small>loading</small></div></div>
    <div id="anaBody"><div class="empty sm"><span>${ic('search', 26)}</span><b>Crunching your traffic…</b></div></div>`;

  if (tab === 'hrms') body = `
    <div class="tip-strip">${ic('shield', 13)} Full HRMS — departments, staff, attendance, leave & payroll. You see <b id="hrScope">your scope</b>: Super/Ops admins see the whole org, department admins see only their own department.</div>
    <div class="card-block" id="hrSelf"><h3>${ic('user', 15)} My workday</h3><p class="movie-about">Loading…</p></div>
    <div id="hrCards" class="earn-tiles wide3"><div class="etile"><b>…</b><small>loading</small></div></div>
    <div class="chip-row" id="hrTabs">
      ${[['team', 'Employees'], ['leave', 'Leave'], ['attend', 'Attendance'], ['pay', 'Payroll'], ['depts', 'Departments']].map(t => `<button class="chip ${(_HR_SUB || 'team') === t[0] ? 'on' : ''}" onclick="adminHRSub('${t[0]}')">${t[1]}</button>`).join('')}
    </div>
    <div id="hrBody"><div class="empty sm"><span>${ic('users', 26)}</span><b>Loading your team…</b></div></div>`;

  if (tab === 'purity') body = `
    <div class="tip-strip">${ic('leaf', 13)} Our key promise: naturally made &amp; grown food, zero adulteration. Approve only lab-passed batches.</div>
    ${A.purityQueue.map(q => `
    <div class="job-card ${q.status === 'pending' ? 'pulse-border' : ''}">
      <div class="job-top"><span class="job-emoji">${ic(q.status === 'ok' ? 'check' : 'leaf', 20)}</span>
        <div><b>${esc(q.item)}</b><small>${esc(q.shop)} · ${esc(q.test)}</small></div>
        ${q.status === 'ok' ? '<em class="job-pay">Purity ✓</em>' : q.status === 'fail' ? '<em class="job-pay" style="color:var(--red)">Delisted</em>' : ''}</div>
      ${q.status === 'pending' ? `<div class="btn-pair">
        <button class="btn-main sm" onclick="adminAct('purity','${q.id}','ok')">${ic('check', 13)} Lab passed — seal batch</button>
        <button class="btn-main sm ghost" onclick="adminAct('purity','${q.id}','fail')">Failed — delist</button></div>` : ''}
    </div>`).join('')}`;

  if (tab === 'kyc') body = `
    <div class="tip-strip">${ic('shield', 13)} No unverified human touches an order. ID + vehicle + bank + live selfie, all matched.</div>
    ${A.kycQueue.map(q => `
    <div class="job-card">
      <div class="job-top"><span class="job-emoji">${ic('user', 20)}</span>
        <div><b>${esc(q.name)}</b><small>${esc(q.docs)}</small></div>
        ${q.status !== 'pending' ? `<em class="job-pay" ${q.status === 'no' ? 'style="color:var(--red)"' : ''}>${q.status === 'ok' ? 'Verified' : 'Rejected'}</em>` : ''}</div>
      ${q.status === 'pending' ? `<div class="btn-pair">
        <button class="btn-main sm" onclick="adminAct('kyc','${q.id}','ok')">${ic('check', 13)} Verify</button>
        <button class="btn-main sm ghost" onclick="adminAct('kyc','${q.id}','no')">Reject</button></div>` : ''}
    </div>`).join('')}`;

  if (tab === 'fraud') body = `
    <div class="warn-strip">${A.flags.length} open flags · ${A.resolved} resolved. Zero tolerance — precise data makes fraud visible.</div>
    ${A.flags.map(f => `
    <div class="job-card">
      <div class="job-top"><span class="job-emoji">${ic('shield', 20)}</span>
        <div><b>${esc(f.what)}</b><small>${esc(f.who)} · severity ${f.level.toUpperCase()}</small></div></div>
      <div class="btn-pair">
        <button class="btn-main sm alt" onclick="adminFlag('${f.id}','block')">Block &amp; investigate</button>
        <button class="btn-main sm ghost" onclick="adminFlag('${f.id}','clear')">False alarm</button></div>
    </div>`).join('') || `<div class="empty"><span>${ic('shield', 40)}</span><b>All clear</b><p>No open fraud flags.</p></div>`}
    <div class="card-block"><h3>Always-on protections</h3>
      ${['OTP at both pickup & drop', 'GPS trace on every delivery', 'Masked calls, recorded', 'Batch trace ID on food', 'Payouts held on flagged accounts', 'One identity = one account (device + ID match)'].map(s =>
        `<div class="ck-line"><span>${ic('check', 12)} ${s}</span><span></span></div>`).join('')}</div>`;

  if (tab === 'orders') body = S.orders.length ? S.orders.slice(0, 12).map(o => `
    <div class="order-row" onclick="go('track/${o.id}')">
      <span class="or-emoji">${kindIcon(o.kind, 18)}</span>
      <div class="or-info"><b>${o.id} · ${esc(o.title)}</b><small>${orderStatus(o).t} · ${o.partner ? esc(o.partner.name) : 'shop staff'}</small></div>
      <div class="or-right"><b>${money(o.total)}</b><span class="or-status ${orderDone(o) ? 'done' : 'live'}">${orderDone(o) ? 'Done' : 'Live'}</span></div></div>`).join('')
    : `<div class="empty"><span>${ic('receipt', 40)}</span><b>No orders yet</b></div>`;

  if (tab === 'plans') body = `
    <div class="tip-strip">Market-standard pricing, all in CHF. Purpose over profit — small sellers must survive and win.</div>
    <div class="card-block"><h3>Buyers</h3>
      <div class="ck-line"><span>First month</span><span><b>Complimentary</b></span></div>
      <div class="ck-line"><span>Then, per year</span><span><b>1 CHF</b></span></div>
      <div class="ck-line"><span>Delivery, tickets, bookings</span><span>true cost, no dark fees</span></div></div>
    <div class="card-block"><h3>Sellers — 5 tiers (no signup fee · first month complimentary · then per year)</h3>
      <div class="ck-line"><span><b>1 · Individual</b> — service person, bike/vehicle owner, solo seller</span><span><b>1 CHF</b></span></div>
      <div class="ck-line"><span><b>2 · Retail shop</b> — kirana, pharmacy, small store</span><span><b>10 CHF</b></span></div>
      <div class="ck-line"><span><b>3 · Large retail</b> — restaurants, multi-staff shops, hosts</span><span><b>25 CHF</b></span></div>
      <div class="ck-line"><span><b>4 · Wholesaler / dealer / hotel</b></span><span><b>50 CHF</b></span></div>
      <div class="ck-line"><span><b>5 · Manufacturer / enterprise</b></span><span><b>100 CHF</b></span></div></div>
    <div class="card-block"><h3>Delivery partners — by vehicle level (first month complimentary · then per year)</h3>
      <div class="ck-line"><span>On foot / Cycle</span><span><b>1 CHF</b></span></div>
      <div class="ck-line"><span>Bike</span><span><b>3 CHF</b></span></div>
      <div class="ck-line"><span>Auto</span><span><b>5 CHF</b></span></div>
      <div class="ck-line"><span>Car / Van</span><span><b>7 CHF</b></span></div>
      <div class="ck-line"><span>Truck</span><span><b>10 CHF</b></span></div></div>`;

  if (tab === 'roles') {
    const canManage = ADMIN_LEVEL && adminRank(ADMIN_LEVEL) >= 4;
    body = `
    <div class="tip-strip">${ic('shield', 13)} Five control levels — each staff member sees only what their level permits. You are <b>${role.name}</b>${ADMIN_WHO && ADMIN_WHO.ident ? ' · ' + esc(ADMIN_WHO.ident) : ''}.</div>
    ${ADMIN_ROLES.map(r => `
    <div class="job-card ${r.id === (ADMIN_LEVEL || role.id) ? 'active' : ''}">
      <div class="job-top"><span class="job-emoji">${ic(r.id === 'l5' ? 'shield' : r.id === 'l3' ? 'leaf' : 'user', 20)}</span>
        <div><b>${r.name}</b><small>${r.desc}</small></div>
        ${r.id === (ADMIN_LEVEL || role.id) ? '<em class="job-pay">You</em>' : ''}</div>
      <div class="job-note">Access: ${r.perms.filter(p => !['roles'].includes(p)).map(p => (tabs.find(t => t[0] === p) || [p, p])[1]).join(' · ')}</div>
    </div>`).join('')}
    ${canManage ? `
    <div class="sec-head"><h2>Team &amp; employees</h2><small class="dim" id="teamCounts">—</small></div>
    <div class="card-block">
      <h3>${ic('plus', 14)} Add / promote a staff member</h3>
      <label class="fld"><span>Email or mobile</span><input class="txt" id="empId" placeholder="employee@orignals.shop or 98765 43210"/></label>
      <label class="fld"><span>Name</span><input class="txt" id="empName" placeholder="Full name"/></label>
      <div class="fld"><span>Level</span><div class="chip-wrap" id="empLevelWrap">
        ${ADMIN_ROLES.filter(r => adminRank(r.id) < adminRank(ADMIN_LEVEL) || ADMIN_LEVEL === 'l5').map(r => `<button class="chip ${r.id === 'l1' ? 'on' : ''}" data-lvl="${r.id}" onclick="admPickLvl('${r.id}')">${r.name.split(' · ')[1]}</button>`).join('')}
      </div></div>
      <button class="btn-main wide" onclick="adminAddEmployee()">Add to team</button>
      <div class="foot-note sm">They sign in with this email/mobile + their own password, then get exactly this level's access. You can promote or revoke anytime.</div>
    </div>
    <div class="search-row"><input id="teamSearch" placeholder="Search team by name or email…" oninput="adminLoadTeam(this.value)"/></div>
    <div id="teamList"><div class="foot-note sm">Loading team…</div></div>`
    : `<div class="foot-note">Only Operations Admin (L4) and Super Admin (L5) can manage staff.</div>`}`;
  }

  if (tab === 'data') {
    const dbTable = (title, rows) => `
      <div class="card-block"><h3>${title} <small class="dim">(${rows.length})</small></h3>
        ${rows.length ? rows.slice(0, 8).map(r => `<div class="ck-line"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('') : '<div class="ck-line"><span class="dim">empty</span><span></span></div>'}</div>`;
    body = `
    <div class="tip-strip">${ic('grid', 13)} Live database view — every table, exactly as stored on this device. In v2 this becomes the hosted database console.</div>
    ${dbTable('users', [[esc(S.user.name) + ' · ' + esc(S.user.addr.name), money(S.wallet.bal) + (S.memberTill ? ' · member' : '')]])}
    ${dbTable('orders', S.orders.map(o => [o.id + ' · ' + esc(o.title), money(o.total) + ' · ' + orderStatus(o).t]))}
    ${dbTable('shops', [...DB.shops.map(s => [esc(s.name), s.type + ' · ★' + s.rating]), ...(S.myShop ? [[esc(S.myShop.name) + ' (yours)', money(S.myShop.revenue)]] : [])])}
    ${dbTable('partners', S.partner ? [[esc(S.partner.name), S.partner.veh + ' · ' + S.partner.jobs + ' trips · ' + (S.partner.seva || 0) + ' seva']] : [])}
    ${dbTable('wallet_txns', S.wallet.txns.filter(t => t.label).map(t => [esc(t.label), (t.amt >= 0 ? '+' : '−') + money(Math.abs(t.amt))]))}
    ${dbTable('tickets', (S.tickets || []).map(t => [t.id + ' · ' + esc(t.title), money(t.total)]))}
    ${dbTable('bookings_stays', [...(S.bookings || []).map(b => ['Table · ' + esc(b.shop), b.day + ' ' + b.slot]), ...(S.stays || []).map(st => ['Stay · ' + esc(st.hotel), money(st.total)])])}
    ${dbTable('property_listings', (S.myListings || []).map(p => [esc(p.title), (p.leads || 0) + ' leads · ' + (p.views || 0) + ' views']))}
    ${dbTable('rfqs_b2b', (S.rfqs || []).map(r => [esc(r.item) + ' × ' + r.qty, r.status === 'quoted' ? money(r.quote) + '/' + esc(r.unit) : 'awaiting quote']))}
    ${dbTable('earnings', S.earnings.map(e => [esc(e.what), e.pay ? '+' + money(e.pay) : 'seva']))}
    <div class="card-block"><h3>${ic('grid', 14)} Cloud database</h3>${typeof cloudStatusHTML === 'function' ? cloudStatusHTML() : ''}</div>
    <div class="card-block"><h3>${ic('shield', 14)} Operations — monitoring &amp; kill switches</h3><div id="opsPanel"><div class="ck-line"><span class="dim">Loading…</span><span></span></div></div></div>
    <button class="btn-main wide ghost" onclick="exportState()">${ic('upload', 14)} Export full database (JSON)</button>`;
  }

  if (tab === 'mitra') {
    if (!BRAIN.W) brainLoad();
    const st = brainStats();
    const log = brainLog();
    const needsLabel = log.map((u, i) => ({ u, i })).filter(x => !x.u.label || x.u.conf < 0.6).slice(-8).reverse();
    const llmCfg = (window.ORIGNALS_CONFIG || {}).llm || {};
    const llmOn = llmCfg.apiKey && !String(llmCfg.apiKey).includes('YOUR-');
    body = `
    <div class="tip-strip">${ic('spark', 13)} <b>Mitra Brain</b> — Orignals' own model. It trains itself on every conversation: rules label the easy ones, you label the hard ones here, and (optionally) Claude's answers distill in. Zero API cost by default.</div>

    <div class="card-block">
      <h3>${ic('shield', 14)} Mitra — full capabilities &amp; control (Super Admin)</h3>
      <div class="ck-line"><span>Universal navigator</span><span>${typeof MITRA_HELP !== 'undefined' ? MITRA_HELP.length : '—'} sections — takes any user to any screen &amp; explains it</span></div>
      <div class="ck-line"><span>Intents understood</span><span>${BRAIN.intents.length} (order, track, ride, send, wallet, tickets, stays, property, earn, shop, help…)</span></div>
      <div class="ck-line"><span>Languages</span><span>22 Indian languages + English/Hinglish</span></div>
      <div class="ck-line"><span>Model lanes</span><span>Own in-browser brain (free) + Supabase trainer + optional Claude distillation</span></div>
      <div class="ck-line"><span>Role intelligence</span><span>Buyers → shopping help · Admins → their department · Super Admin → full control (here)</span></div>
      <div class="ck-line"><span>Claude escalation</span><span>${llmOn ? '<b class="ok">ON · ' + esc(llmCfg.model || '') + '</b>' : 'OFF — brain + rules handle everything'}</span></div>
      <div class="btn-pair" style="margin-top:8px">
        <button class="btn-main sm ghost" onclick="brainAdoptGlobal&&brainAdoptGlobal();toast('Pulled the latest backend model')">Sync backend model</button>
        <button class="btn-main sm ghost" onclick="brainSeedTrain();toast('Retrained from the full multilingual seed');VIEWS.admin(['mitra'])">Retrain from seed</button>
      </div>
    </div>
    <div class="earn-tiles wide3">
      <div class="etile"><b>${st.utterances}</b><small>Utterances collected</small></div>
      <div class="etile"><b>${st.labeled}</b><small>Training labels</small></div>
      <div class="etile"><b>${st.accuracy === null ? '—' : st.accuracy + '%'}</b><small>Model accuracy</small></div>
    </div>
    <div class="earn-tiles wide3">
      <div class="etile"><b>${(st.params / 1000).toFixed(1)}K</b><small>Model parameters</small></div>
      <div class="etile"><b>${st.trained}</b><small>Training steps</small></div>
      <div class="etile"><b>${llmOn ? esc(llmCfg.model || '') : 'OFF'}</b><small>Claude escalation</small></div>
    </div>
    <div class="trust-row">${ic('grid', 13)} Backend model: ${localStorage.getItem('mitra_global_ver') ? '<b>v' + localStorage.getItem('mitra_global_ver') + ' adopted</b> — trains itself in Supabase every 15 min (pg_cron)' : 'not yet adopted — installs with supabase/mitra_schema.sql'}
    </div>

    ${needsLabel.length ? `<div class="sec-head"><h2>Teach the model</h2><small class="dim">pick the right intent</small></div>
    ${needsLabel.map(x => `
      <div class="order-row static">
        <span class="or-emoji">${ic('spark', 16)}</span>
        <div class="or-info"><b>"${esc(x.u.text)}"</b>
          <small>model guessed: ${esc(x.u.pred)} · ${Math.round(x.u.conf * 100)}% ${x.u.label ? '· labeled: ' + esc(x.u.label) : '· <b>unlabeled</b>'}</small></div>
        <select class="txt sm" onchange="brainRelabel(${x.i}, this.value); toast('Learned — model updated'); VIEWS.admin(['mitra'])">
          <option value="">label…</option>
          ${BRAIN.intents.map(i2 => `<option value="${i2}" ${x.u.label === i2 ? 'selected' : ''}>${i2.replace('_', ' ')}</option>`).join('')}
        </select>
      </div>`).join('')}` : `<div class="tip-strip">${ic('check', 13)} Nothing needs labelling — talk to Mitra and hard cases will appear here.</div>`}

    <div class="card-block"><h3>Dataset by intent</h3>
      ${BRAIN.intents.map(i2 => {
        const n = (st.perIntent[i2] || 0) + (BRAIN_SEED[i2] || []).length;
        return `<div class="ck-line"><span>${i2.replace('_', ' ')}</span><span>${n} examples</span></div>`;
      }).join('')}</div>

    <div class="btn-pair">
      <button class="btn-main sm ghost" onclick="brainExportJSONL()">${ic('upload', 13)} Export dataset (JSONL)</button>
      <button class="btn-main sm ghost" onclick="brainRetrain();toast('Retrained from scratch on all labels');VIEWS.admin(['mitra'])">Retrain model</button>
    </div>
    <div class="foot-note sm">The JSONL export is exactly what you'll use to fine-tune a full open-weights model later — see docs/MITRA-AI.md for the roadmap.</div>`;
  }

  if (tab === 'test') {
    const routes = [
      ['home', 'Home', 'store'], ['shops', 'Shops', 'store'], ['send', 'Send', 'package'], ['ride', 'Rides', 'bike'],
      ['tickets', 'Events', 'star'], ['tickets/dining', 'Dining', 'bowl'], ['estate', 'Property', 'home'], ['estate/hotels', 'Stays', 'home'],
      ['earn', 'Earn', 'users'], ['myshop', 'Your Shop', 'chart'], ['papers', 'Papers', 'shield'], ['wallet', 'Wallet', 'wallet'],
      ['orders', 'Orders', 'receipt'], ['mitra', 'Mitra', 'spark'], ['login', 'Login', 'shield'], ['facelock', 'Security', 'camera'],
      ['legal', 'Legal', 'shield'], ['promise', 'Promise', 'check'], ['categories', 'Categories', 'grid'], ['notifs', 'Alerts', 'bell']
    ];
    body = `
    <div class="tip-strip">${ic('spark', 13)} <b>Test console</b> — Super Admin only. Exercise every feature &amp; backend directly. Actions run for real on this account/device.</div>

    <div class="sec-head"><h2>Backend health</h2></div>
    <div class="card-block"><div id="testHealth"><button class="btn-main sm" onclick="adminTestHealth()">${ic('spark', 14)} Run health check</button></div></div>

    <div class="sec-head"><h2>Open any screen</h2></div>
    <div class="mega-grid">
      ${routes.map(r => `<button class="mega" onclick="go('${r[0]}')"><span>${ic(r[2], 18)}</span><b>${esc(r[1])}</b><small>/${esc(r[0])}</small></button>`).join('')}
    </div>

    <div class="sec-head"><h2>Feature tests</h2></div>
    <div class="card-block test-grid">
      <button class="btn-main sm ghost" onclick="adminTestWallet()">${ic('wallet', 13)} Add ₹500 to wallet</button>
      <button class="btn-main sm ghost" onclick="adminTestOrder()">${ic('receipt', 13)} Place a test order + track</button>
      <button class="btn-main sm ghost" onclick="adminTestPayment()">${ic('card', 13)} Test payment (create order)</button>
      <button class="btn-main sm ghost" onclick="adminTestPush()">${ic('bell', 13)} Send a test push to me</button>
      <button class="btn-main sm ghost" onclick="adminTestOtp()">${ic('shield', 13)} Test OTP (show code)</button>
      <button class="btn-main sm ghost" onclick="adminTestSeedShop()">${ic('store', 13)} Seed a demo shop</button>
      <button class="btn-main sm ghost" onclick="adminTestSeedPartner()">${ic('users', 13)} Become a verified partner</button>
      <button class="btn-main sm ghost" onclick="adminTestNotify()">${ic('bell', 13)} Fire an in-app notification</button>
    </div>
    <div class="foot-note">Every button performs the real action so you can confirm the flow behaves correctly end-to-end.</div>`;
  }

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('account')">${ic('chevl', 16)}</button>
    <div><h1>Admin panel</h1><small>${role.name} · precise everything · strictly anti-fraud</small></div></div>
  <div class="chip-row sticky-chips">
    ${tabs.map(t => {
      const ok = role.perms.includes(t[0]);
      return `<button class="chip ${tab === t[0] ? 'on' : ''} ${ok ? '' : 'locked'}" onclick="${ok ? `go('admin/${t[0]}')` : `toast('${role.name} does not have ${t[1]} access')`}">${ok ? '' : ic('lock', 11)}${t[1]}</button>`;
    }).join('')}
  </div>
  ${body}`;

  if (tab === 'data' && typeof opsAdminHTML === 'function') {
    opsAdminHTML().then(h => { const el = document.getElementById('opsPanel'); if (el) el.innerHTML = h; });
  }
  if (tab === 'roles' && ADMIN_LEVEL && adminRank(ADMIN_LEVEL) >= 4) adminLoadTeam();
  if (tab === 'analytics') adminAnalyticsBoot(); else adminAnalyticsStop();
  if (tab === 'hrms') adminHRLoad();
}

/* ============================================================
   HRMS — departments, staff, attendance, leave, payroll.
   Server enforces department scoping; UI just renders it.
   ============================================================ */
let _HR_SUB = 'team', _HR = { over: null, month: null };
function adminHRSub(s) { _HR_SUB = s; document.querySelectorAll('#hrTabs .chip').forEach(c => c.classList.remove('on')); adminHRRenderSub(); }
async function adminHRLoad() {
  const o = await adminApi('hr_overview', {});
  _HR.over = o;
  const sc = document.getElementById('hrScope'); if (sc && o && o.scope) sc.textContent = o.scope === 'org' ? 'the whole organisation' : ('the ' + o.scope + ' department');
  const cards = document.getElementById('hrCards');
  if (cards) cards.innerHTML = o && o.ok ? `
    <div class="etile"><b>${o.headcount}</b><small>Staff</small></div>
    <div class="etile"><b>${o.present_today}</b><small>Present today</small></div>
    <div class="etile"><b>${o.on_leave}</b><small>On leave</small></div>
    <div class="etile"><b>${o.pending_leave}</b><small>Leave to approve</small></div>
    <div class="etile"><b>${money(o.payroll_month)}</b><small>Monthly payroll</small></div>
    <div class="etile"><b>${(o.by_dept || []).length}</b><small>Departments</small></div>` : `<div class="etile"><b>—</b><small>no access</small></div>`;
  /* self-service strip (works for every staff level) */
  const self = document.getElementById('hrSelf');
  if (self) self.innerHTML = `<h3>${ic('user', 15)} My workday</h3>
    <div class="btn-pair">
      <button class="btn-main sm" onclick="adminHRAttend('in')">${ic('check', 13)} Check in</button>
      <button class="btn-main sm ghost" onclick="adminHRAttend('out')">${ic('clock', 13)} Check out</button>
    </div>
    <button class="btn-main sm ghost wide" onclick="adminHRLeaveApply()">${ic('receipt', 13)} Apply for leave</button>`;
  adminHRRenderSub();
}
async function adminHRRenderSub() {
  const box = document.getElementById('hrBody'); if (!box) return;
  box.innerHTML = `<div class="empty sm"><span>${ic('users', 22)}</span><b>Loading…</b></div>`;
  const canManage = ADMIN_LEVEL && adminRank(ADMIN_LEVEL) >= 4;
  const canDecide = ADMIN_LEVEL && adminRank(ADMIN_LEVEL) >= 3;
  const isL5 = ADMIN_LEVEL === 'l5';
  if (_HR_SUB === 'team') {
    const rows = await adminApi('hr_employees', { p_q: '', p_dept: '', p_limit: 200, p_offset: 0 });
    box.innerHTML = (Array.isArray(rows) && rows.length) ? rows.map(e => `
      <div class="job-card">
        <div class="job-top"><span class="job-emoji">${ic('user', 18)}</span>
          <div><b>${esc(e.name || e.ident)} <small class="dim">${(e.level || '').toUpperCase()}</small></b>
            <small>${esc(e.designation || 'Staff')} · ${esc(e.department)}</small>
            <small class="dim">${money(e.salary || 0)}/mo · joined ${e.joined_on || '—'} · <b class="${e.status === 'active' ? 'ok' : ''}">${esc(e.status || 'active')}</b></small></div>
          ${canManage ? `<button class="lnk" onclick="adminHREdit('${esc(e.ident)}')">Edit</button>` : ''}</div>
      </div>`).join('') : `<div class="empty sm"><span>${ic('users', 26)}</span><b>No staff in your scope yet</b><p>Add staff in Team &amp; levels, then set their department & salary here.</p></div>`;
  } else if (_HR_SUB === 'leave') {
    const rows = await adminApi('hr_leave_list', { p_all: true });
    box.innerHTML = (Array.isArray(rows) && rows.length) ? rows.map(l => `
      <div class="job-card">
        <div class="job-top"><span class="job-emoji">${ic('receipt', 18)}</span>
          <div><b>${esc(l.name || l.ident)}</b><small>${esc(l.kind)} leave · ${l.from_date} → ${l.to_date} · ${esc(l.department)}</small>
            <small class="dim">${esc(l.reason || '')} · <b class="${l.status === 'approved' ? 'ok' : l.status === 'rejected' ? 'red' : ''}">${esc(l.status)}</b></small></div></div>
        ${(canDecide && l.status === 'pending') ? `<div class="btn-pair">
          <button class="btn-main sm" onclick="adminHRLeave(${l.id},'approved')">${ic('check', 13)} Approve</button>
          <button class="btn-main sm ghost" onclick="adminHRLeave(${l.id},'rejected')">Reject</button></div>` : ''}
      </div>`).join('') : `<div class="empty sm"><span>${ic('receipt', 26)}</span><b>No leave requests</b></div>`;
  } else if (_HR_SUB === 'attend') {
    const rows = await adminApi('hr_attendance_today', {});
    box.innerHTML = `<div class="foot-note sm" style="text-align:left">Today · ${new Date().toLocaleDateString('en-IN')}</div>` + ((Array.isArray(rows) && rows.length) ? rows.map(a => `
      <div class="ck-line"><span>${ic('user', 12)} ${esc(a.name || a.ident)} <small class="dim">${esc(a.department)}</small></span>
        <span>${a.check_in ? '🟢 ' + new Date(a.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}${a.check_out ? ' → ' + new Date(a.check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}</span></div>`).join('') : `<div class="empty sm"><span>${ic('clock', 26)}</span><b>Nobody has checked in yet</b></div>`);
  } else if (_HR_SUB === 'pay') {
    const pl = await adminApi('hr_payroll_list', { p_month: '' });
    _HR.month = pl && pl.month;
    box.innerHTML = `
      <div class="earn-tiles wide3">
        <div class="etile"><b>${money((pl && pl.total) || 0)}</b><small>Payroll ${pl && pl.month || ''}</small></div>
        <div class="etile"><b>${money((pl && pl.paid) || 0)}</b><small>Paid</small></div>
        <div class="etile"><b>${money(((pl && pl.total) || 0) - ((pl && pl.paid) || 0))}</b><small>Due</small></div>
      </div>
      ${isL5 ? `<button class="btn-main sm ghost wide" onclick="adminHRPayrollRun()">${ic('wallet', 13)} Generate this month's payroll from salaries</button>` : ''}
      ${(pl && Array.isArray(pl.rows) && pl.rows.length) ? pl.rows.map(r => `
      <div class="ck-line"><span>${esc(r.name || r.ident)} <small class="dim">${esc(r.department)}</small></span>
        <span>${money(r.amount)} · ${r.status === 'paid' ? '<b class="ok">paid</b>' : (isL5 ? `<button class="lnk" onclick="adminHRPay(${r.id})">Mark paid</button>` : '<b>due</b>')}</span></div>`).join('') : `<div class="empty sm"><span>${ic('wallet', 26)}</span><b>No payroll yet</b><p>${isL5 ? 'Generate it from staff salaries above.' : 'Ask a Super Admin to run payroll.'}</p></div>`}`;
  } else if (_HR_SUB === 'depts') {
    const d = await adminApi('hr_departments_list', {});
    box.innerHTML = (Array.isArray(d) && d.length) ? d.map(x => `
      <div class="ck-line"><span>${ic('grid', 12)} <b>${esc(x.name)}</b>${x.head ? ' · head ' + esc(x.head) : ''}</span><span>${x.headcount} staff</span></div>`).join('') : `<div class="empty sm"><span>${ic('grid', 26)}</span><b>No departments</b></div>`;
  }
}
async function adminHRAttend(action) {
  const r = await adminApi('hr_attendance_mark', { p_action: action });
  if (r && r.ok) { toast(action === 'in' ? 'Checked in ✓' : 'Checked out ✓'); if (_HR_SUB === 'attend') adminHRRenderSub(); adminHRLoad(); }
  else toast('Could not record — are you staff?');
}
function adminHRLeaveApply() {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Apply for leave</h3>
    <div class="ck-line"><span>From</span><input id="hrLvFrom" type="date" style="${_fld}"/></div>
    <div class="ck-line"><span>To</span><input id="hrLvTo" type="date" style="${_fld}"/></div>
    <input id="hrLvReason" placeholder="Reason (optional)" style="${_fld}"/>
    <button class="btn-main wide" onclick="adminHRLeaveSubmit()">Submit request</button>`);
}
async function adminHRLeaveSubmit() {
  const from = (document.getElementById('hrLvFrom') || {}).value, to = (document.getElementById('hrLvTo') || {}).value;
  const reason = (document.getElementById('hrLvReason') || {}).value || '';
  if (!from || !to) { toast('Pick both dates'); return; }
  const r = await adminApi('hr_leave_apply', { p_kind: 'casual', p_from: from, p_to: to, p_reason: reason });
  if (r && r.ok) { closeSheet(); toast('Leave request submitted'); adminHRLoad(); } else toast('Could not submit');
}
async function adminHRLeave(id, decision) {
  const r = await adminApi('hr_leave_decide', { p_id: id, p_decision: decision });
  if (r && r.ok) { toast('Leave ' + decision); adminHRRenderSub(); adminHRLoad(); } else toast((r && r.reason === 'out_of_scope') ? 'Not in your department' : 'Could not update');
}
function adminHREdit(ident) {
  const depts = ((_HR.over && _HR.over.by_dept) || []).map(d => d.dept);
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Edit staff · ${esc(ident)}</h3>
    <input id="hrDept" placeholder="Department (e.g. Support)" style="${_fld}"/>
    <input id="hrDesig" placeholder="Designation (e.g. City Lead)" style="${_fld}"/>
    <input id="hrSal" type="number" inputmode="numeric" placeholder="Monthly salary ₹" style="${_fld}"/>
    <select id="hrStatus" style="${_fld}"><option value="">Keep status</option><option value="active">Active</option><option value="on_leave">On leave</option><option value="suspended">Suspended</option><option value="exited">Exited</option></select>
    <button class="btn-main wide" onclick="adminHRSave('${esc(ident)}')">Save</button>`);
}
async function adminHRSave(ident) {
  const dept = (document.getElementById('hrDept') || {}).value || '';
  const desig = (document.getElementById('hrDesig') || {}).value || '';
  const sal = (document.getElementById('hrSal') || {}).value;
  const status = (document.getElementById('hrStatus') || {}).value || '';
  const r = await adminApi('hr_employee_set', { p_ident: ident, p_department: dept, p_designation: desig, p_salary: sal === '' ? null : Number(sal), p_status: status });
  if (r && r.ok) { closeSheet(); toast('Staff updated'); adminHRRenderSub(); adminHRLoad(); } else toast(r && r.reason === 'forbidden' ? 'Needs Ops/Super admin' : 'Could not save');
}
async function adminHRPayrollRun() {
  if (!confirm('Generate payroll for this month from every active staff salary?')) return;
  const r = await adminApi('hr_payroll_run', { p_month: '' });
  if (r && r.ok) { toast('Payroll generated · ' + r.rows + ' staff'); adminHRRenderSub(); } else toast(r && r.reason === 'only_l5' ? 'Super Admin only' : 'Could not run');
}
async function adminHRPay(id) {
  const r = await adminApi('hr_payroll_pay', { p_id: id });
  if (r && r.ok) { toast('Marked paid'); adminHRRenderSub(); } else toast('Could not update');
}

/* ============================================================
   ANALYTICS — live visitor map + full breakdowns (L4+ only,
   server-gated). One overview call + a fast live poll.
   ============================================================ */
let _ANA_DAYS = 30, _anaLiveTimer = null, _anaMap = null, _anaLayer = null, _anaBooted = false;

function adminAnaSetRange(d) { _ANA_DAYS = d; VIEWS.admin(['analytics']); }

function adminAnalyticsBoot() {
  adminAnalyticsLoad();
  clearInterval(_anaLiveTimer);
  adminAnalyticsLive();
  _anaLiveTimer = setInterval(() => { if (document.getElementById('anaMap')) adminAnalyticsLive(); else adminAnalyticsStop(); }, 5000);
}
function adminAnalyticsStop() {
  clearInterval(_anaLiveTimer); _anaLiveTimer = null;
  try { if (_anaMap) _anaMap.remove(); } catch (e) {}
  _anaMap = null; _anaLayer = null;
}

async function adminAnalyticsLoad() {
  const r = await adminApi('analytics_overview', { p_days: _ANA_DAYS });
  if (!r || !r.ok) { const b = document.getElementById('anaBody'); if (b) b.innerHTML = `<div class="empty sm"><span>${ic('lock', 26)}</span><b>${r && r.reason === 'forbidden' ? 'Analytics is L4+ only' : 'No data yet — traffic will appear as people visit'}</b></div>`; return; }
  const c = r.cards || {};
  const conv = c.visits_30d ? Math.round((c.orders_window / Math.max(c.visits_30d, 1)) * 1000) / 10 : 0;
  const cards = document.getElementById('anaCards');
  if (cards) cards.outerHTML = `<div id="anaCards">
    <div class="earn-tiles wide3">
      <div class="etile"><b>${(c.visits_today || 0).toLocaleString('en-IN')}</b><small>Visitors today</small></div>
      <div class="etile"><b>${(c.visits_7d || 0).toLocaleString('en-IN')}</b><small>Last 7 days</small></div>
      <div class="etile"><b>${(c.visits_30d || 0).toLocaleString('en-IN')}</b><small>Last 30 days</small></div>
    </div>
    <div class="earn-tiles wide3">
      <div class="etile"><b>${(c.views_window || 0).toLocaleString('en-IN')}</b><small>Page views (${_ANA_DAYS}d)</small></div>
      <div class="etile"><b>${(c.orders_window || 0).toLocaleString('en-IN')}</b><small>Orders (${_ANA_DAYS}d)</small></div>
      <div class="etile"><b>${money(c.gmv_window || 0)}</b><small>GMV (${_ANA_DAYS}d)</small></div>
    </div>`;
  const vpv = c.visits_30d ? (Math.round((c.views_window / Math.max(c.visits_30d, 1)) * 10) / 10) : 0;
  const body = document.getElementById('anaBody');
  if (body) body.innerHTML =
    anaTrendCard(r.series || []) +
    anaNewRetCard(r.newret) +
    anaGeoCard(r.geo || []) +
    anaHoursCard(r.hours || []) +
    anaBarCard('Top pages', (r.pages || []).map(p => [p.name || '—', p.visitors, p.views + ' views'])) +
    anaBarCard('Where they come from', (r.refs || []).map(x => [x.ref, x.visitors])) +
    anaBarCard('Device', (r.devices || []).map(x => [x.uad, x.visitors])) +
    anaBarCard('Browser', (r.browsers || []).map(x => [x.browser, x.visitors])) +
    anaBarCard('Language', (r.langs || []).map(x => [x.lang, x.visitors])) +
    anaBarCard('Visitor type', (r.roles || []).map(x => [x.role, x.visitors])) +
    anaEventCard(r.events || []) +
    `<div class="foot-note sm">Conversion (${_ANA_DAYS}d): <b>${conv}%</b> of visitors ordered · <b>${vpv}</b> pages per visit. First-party &amp; anonymous — no Google Analytics.</div>`;
}

function anaMax(rows, i) { return Math.max(1, ...rows.map(r => +r[i] || 0)); }
function anaEmptyCard(title) { return `<div class="card-block"><h3>${title}</h3><div class="foot-note sm" style="text-align:left">Nothing in this range yet — this fills as people arrive.</div></div>`; }
function anaBarCard(title, rows) {
  if (!rows.length) return anaEmptyCard(esc(title));
  const mx = anaMax(rows, 1);
  return `<div class="card-block"><h3>${esc(title)}</h3>${rows.map(r => `
    <div class="ana-bar"><span class="ana-bl">${esc(String(r[0]))}</span>
      <span class="ana-bt"><i style="width:${Math.round((+r[1] || 0) / mx * 100)}%"></i></span>
      <b>${(+r[1] || 0).toLocaleString('en-IN')}${r[2] ? ` <small class="dim">${esc(String(r[2]))}</small>` : ''}</b></div>`).join('')}</div>`;
}
function anaTrendCard(series) {
  if (!series.length) return anaEmptyCard('Visitors per day');
  const mx = Math.max(1, ...series.map(s => +s.visits || 0));
  const bars = series.map(s => `<div class="ana-col" title="${esc(s.d)} · ${s.visits} visitors">
    <i style="height:${Math.round((+s.visits || 0) / mx * 100)}%"></i></div>`).join('');
  return `<div class="card-block"><h3>Visitors per day</h3><div class="ana-trend">${bars}</div>
    <div class="ana-trend-x"><small>${esc(series[0].d)}</small><small>${esc(series[series.length - 1].d)}</small></div></div>`;
}
function anaGeoCard(geo) {
  if (!geo.length) return anaEmptyCard(ic('pin', 14) + ' Where visitors are');
  const mx = Math.max(1, ...geo.map(g => +g.visitors || 0));
  return `<div class="card-block"><h3>${ic('pin', 14)} Where visitors are — precise</h3>${geo.map(g => {
    const meta = [g.region, g.country].filter(Boolean).map(esc).join(', ') + (g.lat != null ? ' · ' + (+g.lat).toFixed(3) + ', ' + (+g.lng).toFixed(3) : '');
    return `<div class="ana-bar"><span class="ana-bl">${esc(anaFlag(g.country))} ${esc(g.place || '—')}<small class="dim"> · ${meta}</small></span>
      <span class="ana-bt"><i style="width:${Math.round((+g.visitors || 0) / mx * 100)}%"></i></span>
      <b>${(+g.visitors || 0).toLocaleString('en-IN')}<small class="dim"> · ${(+g.views || 0)} views</small></b></div>`;
  }).join('')}</div>`;
}
function anaHoursCard(hours) {
  if (!hours || !hours.length) return '';
  const map = {}; hours.forEach(h => map[h.hr] = +h.views || 0);
  const mx = Math.max(1, ...Object.values(map));
  let bars = '';
  for (let i = 0; i < 24; i++) { const v = map[i] || 0; bars += `<div class="ana-col" title="${i}:00 · ${v} views"><i style="height:${Math.round(v / mx * 100)}%"></i></div>`; }
  return `<div class="card-block"><h3>${ic('clock', 14)} Busiest hours (IST)</h3><div class="ana-trend">${bars}</div>
    <div class="ana-trend-x"><small>00:00</small><small>12:00</small><small>23:00</small></div></div>`;
}
function anaNewRetCard(nr) {
  if (!nr) return '';
  const n = +nr.new || 0, rt = +nr.returning || 0, tot = Math.max(1, n + rt);
  return `<div class="card-block"><h3>${ic('users', 14)} New vs returning</h3>
    <div class="ana-bar"><span class="ana-bl">New visitors</span><span class="ana-bt"><i style="width:${Math.round(n / tot * 100)}%"></i></span><b>${n} <small class="dim">${Math.round(n / tot * 100)}%</small></b></div>
    <div class="ana-bar"><span class="ana-bl">Returning</span><span class="ana-bt"><i style="width:${Math.round(rt / tot * 100)}%"></i></span><b>${rt} <small class="dim">${Math.round(rt / tot * 100)}%</small></b></div></div>`;
}
function anaEventCard(ev) {
  if (!ev.length) return anaEmptyCard('Key events');
  return `<div class="card-block"><h3>Key events</h3>${ev.map(e => `
    <div class="ck-line"><span>${esc(e.name)}</span><span><b>${(+e.n || 0).toLocaleString('en-IN')}</b>${+e.value ? ' · ' + money(e.value) : ''}</span></div>`).join('')}</div>`;
}
function anaFlag(cc) {
  if (!cc || cc.length !== 2) return '🌐';
  return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

async function adminAnalyticsLive() {
  const r = await adminApi('analytics_live', {});
  const now = document.getElementById('anaLiveNow');
  if (now) now.textContent = (r && r.ok ? (r.now || 0) : 0) + '';
  const el = document.getElementById('anaMap'); if (!el) return;
  if (!r || !r.ok) return;
  const pts = (r.people || []).filter(p => p.lat != null && p.lng != null);
  try {
    if (!_anaMap && typeof L !== 'undefined') {
      _anaMap = L.map(el, { zoomControl: false, attributionControl: false }).setView([22.6, 82], 4);
      L.tileLayer((window.CONFIG && CONFIG.map && CONFIG.map.tileUrls && CONFIG.map.tileUrls[0]) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(_anaMap);
      _anaLayer = L.layerGroup().addTo(_anaMap);
    }
    if (_anaLayer) {
      _anaLayer.clearLayers();
      const latlngs = [];
      pts.forEach(p => {
        const fresh = (p.ago || 999) < 75;
        const m = L.circleMarker([p.lat, p.lng], { radius: fresh ? 7 : 5, color: '#fff', weight: 1.5,
          fillColor: fresh ? '#1fb268' : '#E8A020', fillOpacity: fresh ? .95 : .6 });
        m.bindPopup(`<b>${esc(p.place || p.city || '—')}${p.country ? ', ' + esc(p.country) : ''}</b><br/>on <b>${esc(p.page || 'home')}</b> · ${esc(p.role || 'guest')} · ${esc(p.uad || '')}${p.browser ? ' · ' + esc(p.browser) : ''}<br/>${p.ago}s ago`);
        m.addTo(_anaLayer); latlngs.push([p.lat, p.lng]);
      });
      if (latlngs.length === 1) _anaMap.setView(latlngs[0], 15);   // street-level for a precise dot
      else if (latlngs.length > 1) { try { _anaMap.fitBounds(latlngs, { padding: [30, 30], maxZoom: 15 }); } catch (e) {} }
    }
  } catch (e) {}
}

function exportState() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
  a.download = 'orignals-database.json'; a.click();
  toast('Database exported as JSON');
}

function adminAct(queue, id, status) {
  const q = (queue === 'purity' ? S.admin.purityQueue : S.admin.kycQueue).find(x => x.id === id);
  if (!q) return;
  q.status = status; save();
  toast(queue === 'purity'
    ? (status === 'ok' ? 'Batch sealed with Purity ✓' : 'Item delisted — seller notified')
    : (status === 'ok' ? 'Verified — they can start now' : 'Rejected — docs requested again'));
  VIEWS.admin([queue]);
}
function adminFlag(id, act) {
  S.admin.flags = S.admin.flags.filter(f => f.id !== id);
  S.admin.resolved += 1; save();
  toast(act === 'block' ? 'Blocked & sent to investigation' : 'Flag cleared');
  VIEWS.admin(['fraud']);
}

/* ============================================================
   EMPLOYEE / TEAM MANAGEMENT (server-verified, scales to lakhs)
   ============================================================ */
let _empLvl = 'l1';
function admPickLvl(l) {
  _empLvl = l;
  document.querySelectorAll('#empLevelWrap .chip').forEach(c => c.classList.toggle('on', c.dataset.lvl === l));
}
async function adminAddEmployee() {
  const id = ($('#empId') && $('#empId').value.trim()) || '';
  const name = ($('#empName') && $('#empName').value.trim()) || '';
  if (id.length < 5) { toast('Enter the employee\'s email or mobile'); return; }
  const r = await adminApi('admin_grant', { p_ident: id, p_level: _empLvl, p_name: name });
  if (r && r.ok) { toast('Added to team as ' + _empLvl.toUpperCase()); if ($('#empId')) $('#empId').value = ''; if ($('#empName')) $('#empName').value = ''; adminLoadTeam(); }
  else toast({ forbidden: 'Your level can\'t add staff', cannot_grant_at_or_above: 'You can only add levels below yours', only_l5_makes_l5: 'Only a Super Admin can add another Super Admin', bad_ident: 'Invalid email/mobile' }[r && r.reason] || 'Could not add — try again');
}
async function adminLoadTeam(q) {
  const box = document.getElementById('teamList'); if (!box) return;
  const rows = await adminApi('admin_list', { p_q: q || '', p_limit: 100, p_offset: 0 });
  const counts = await adminApi('admin_counts', {});
  const cEl = document.getElementById('teamCounts');
  if (cEl && counts && typeof counts === 'object') cEl.textContent = ADMIN_ROLES.map(r => (counts[r.id] ? counts[r.id] + ' ' + r.id.toUpperCase() : '')).filter(Boolean).join(' · ') || '—';
  if (!Array.isArray(rows)) { box.innerHTML = `<div class="foot-note sm">Could not load team.</div>`; return; }
  box.innerHTML = rows.length ? rows.map(r => `
    <div class="order-row static">
      <span class="or-emoji">${ic(r.level === 'l5' ? 'shield' : r.level === 'l3' ? 'leaf' : 'user', 16)}</span>
      <div class="or-info"><b>${esc(r.name || r.ident)}</b><small>${esc(r.ident)} · <b>${r.level.toUpperCase()}</b> · added ${new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small></div>
      ${(ADMIN_LEVEL === 'l5' && r.ident !== (ADMIN_WHO && ADMIN_WHO.ident)) ? `<button class="lnk red" onclick="adminRevokeEmployee('${esc(r.ident)}')">Remove</button>` : ''}
    </div>`).join('') : `<div class="foot-note sm">No staff yet. Add your first team member above.</div>`;
}
async function adminRevokeEmployee(ident) {
  if (!confirm('Remove ' + ident + ' from the team? They lose all admin access.')) return;
  const r = await adminApi('admin_revoke', { p_ident: ident });
  if (r && r.ok) { toast('Removed from team'); adminLoadTeam(); }
  else toast(r && r.reason === 'last_super_admin' ? 'Cannot remove the last Super Admin' : 'Could not remove');
}

/* ============================================================
   SUPER ADMIN TEST CONSOLE — exercise every feature for real
   ============================================================ */
async function adminTestHealth() {
  const box = document.getElementById('testHealth');
  if (box) box.innerHTML = `<div class="foot-note sm">Pinging services…</div>`;
  const base = (typeof CLOUD !== 'undefined' && CLOUD.url) || '';
  const H = (typeof cloudHeaders === 'function') ? cloudHeaders() : {};
  const checks = [
    ['REST · shops', () => fetch(base + '/rest/v1/shops?select=id&limit=1', { headers: H })],
    ['Mitra model (RPC)', () => fetch(base + '/rest/v1/rpc/mitra_predict', { method: 'POST', headers: H, body: '{"txt":"order milk"}' })],
    ['Auth engine (RPC)', () => fetch(base + '/rest/v1/rpc/otp_request', { method: 'POST', headers: H, body: '{"p_phone":"9999999999","p_device":"health"}' })],
    ['Payments fn', () => fetch(base + '/functions/v1/razorpay-order', { method: 'POST', headers: H, body: '{"amount":100}' })],
    ['Push fn', () => fetch(base + '/functions/v1/push-send', { method: 'POST', headers: H, body: '{"device_key":"health","title":"t","body":"b"}' })]
  ];
  const results = [];
  for (const [label, fn] of checks) {
    try { const r = await fn(); results.push([label, r.ok, r.status]); }
    catch (e) { results.push([label, false, 'ERR']); }
  }
  if (box) box.innerHTML = results.map(([l, ok, s]) => `<div class="ck-line"><span>${esc(l)}</span><span class="${ok ? 'ok' : 'bad'}">${ok ? '✓ ' + s : '✕ ' + s}</span></div>`).join('') +
    `<button class="btn-main sm ghost" style="margin-top:10px" onclick="adminTestHealth()">Re-run</button>`;
}
function adminTestWallet() { walletAdd(500, 'Test top-up (admin)'); toast('₹500 added to your wallet'); }
function adminTestNotify() { notify('Test notification', 'This is a test alert from the admin console.', 'spark'); toast('In-app notification fired — check the bell'); }
function adminTestOrder() {
  const shop = DB.shops[0];
  const o = createOrder({ kind: 'shop', flow: 'shop_partner', km: shop.km, title: 'TEST · ' + shop.name, shopId: shop.id, items: [{ name: 'Test item', q: 1, price: 100 }], total: 100, addr: S.user.addr });
  toast('Test order placed — opening live tracking'); go('track/' + o.id);
}
async function adminTestPayment() {
  if (typeof CLOUD === 'undefined' || !CLOUD.on) { toast('Cloud off'); return; }
  toast('Creating a live Razorpay order…');
  try {
    const r = await fetch(CLOUD.url + '/functions/v1/razorpay-order', { method: 'POST', headers: cloudHeaders(), body: JSON.stringify({ amount: 100, purpose: 'order', ref: 'ADMIN-TEST', device: S.deviceKey }) });
    const d = await r.json();
    toast(d.orderId ? 'Order created: ' + d.orderId + ' (no charge)' : (d.error || 'Payment not configured'));
  } catch (e) { toast('Payment test failed'); }
}
async function adminTestPush() {
  if (typeof pushEnable === 'function' && !S.pushOn) { await pushEnable(); }
  if (typeof cloudPushTo === 'function') { cloudPushTo({ device_key: S.deviceKey, title: 'Orignals test', body: 'Push is working ✓', url: '#/admin/test' }); toast('Test push sent to this device'); }
}
async function adminTestOtp() {
  if (typeof CLOUD === 'undefined' || !CLOUD.on) { toast('Cloud off'); return; }
  try {
    const r = await cloudFetch('rpc/otp_request', { method: 'POST', body: JSON.stringify({ p_phone: '9876543210', p_device: S.deviceKey }) });
    toast(r && r.ok ? 'OTP for 9876543210: ' + (r.dev_code || '(delivery not set)') : 'OTP request failed');
  } catch (e) { toast('OTP test failed'); }
}
function adminTestSeedShop() {
  S.myShop = { name: 'Test Kirana (admin)', cat: 'grocery', phone: '9876543210', addr: S.user.addr, open: '8 am', close: '9 pm', veg: true, delivery: 'both', online: true, created: Date.now(), items: [{ id: 'ti1', name: 'Test Milk', qty: '500 ml', price: 29, emoji: '' }, { id: 'ti2', name: 'Test Bread', qty: '400 g', price: 45, emoji: '' }], orders: [], revenue: 0, lastGen: Date.now() };
  save(); toast('Demo shop created — opening Your Shop'); go('myshop');
}
function adminTestSeedPartner() {
  S.partner = { name: S.user.name || 'Test Partner', veh: 'bike', status: 'verified', rating: 4.9, jobs: 0, seva: 0, online: true };
  save(); toast('You are now a verified partner — opening Earn'); setMode('earn');
}
