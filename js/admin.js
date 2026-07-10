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
  { id: 'l5', name: 'L5 · Super Admin', desc: 'Founder-level. Everything below plus pricing plans, payouts, admin appointments and the Test console.', perms: ['overview', 'purity', 'kyc', 'fraud', 'orders', 'plans', 'roles', 'data', 'mitra', 'test'] },
  { id: 'l4', name: 'L4 · Operations Admin', desc: 'Runs the platform day-to-day: KYC, fraud, all orders, database read, onboard staff up to L3.', perms: ['overview', 'kyc', 'fraud', 'orders', 'roles', 'data', 'mitra'] },
  { id: 'l3', name: 'L3 · Purity Inspector', desc: 'Field & lab team. Seals or delists batches. Nothing else.', perms: ['overview', 'purity', 'roles'] },
  { id: 'l2', name: 'L2 · City Manager', desc: 'Onboards shops & partners in their city, watches local orders.', perms: ['overview', 'kyc', 'orders', 'roles'] },
  { id: 'l1', name: 'L1 · Support Agent', desc: 'Sees order status to help customers. Read-only.', perms: ['overview', 'orders', 'roles'] }
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
  const tabs = [['overview', 'Overview'], ['purity', 'Purity'], ['kyc', 'KYC'], ['fraud', 'Fraud'], ['orders', 'Orders'], ['plans', 'Plans'], ['roles', 'Team &amp; levels'], ['data', 'Database'], ['mitra', 'Mitra AI'], ['test', 'Test console']];
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
      ['tickets', 'Movies', 'star'], ['tickets/dining', 'Dining', 'bowl'], ['estate', 'Property', 'home'], ['estate/hotels', 'Stays', 'home'],
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
