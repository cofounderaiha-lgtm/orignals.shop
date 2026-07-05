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
  { id: 'l5', name: 'L5 · Super Admin', desc: 'Founder-level. Everything below plus pricing plans, payouts, admin appointments.', perms: ['overview', 'purity', 'kyc', 'fraud', 'orders', 'plans', 'roles', 'data'] },
  { id: 'l4', name: 'L4 · Operations Admin', desc: 'Runs the platform day-to-day: KYC, fraud, all orders, database read.', perms: ['overview', 'kyc', 'fraud', 'orders', 'roles', 'data'] },
  { id: 'l3', name: 'L3 · Purity Inspector', desc: 'Field & lab team. Seals or delists batches. Nothing else.', perms: ['overview', 'purity', 'roles'] },
  { id: 'l2', name: 'L2 · City Manager', desc: 'Onboards shops & partners in their city, watches local orders.', perms: ['overview', 'kyc', 'orders', 'roles'] },
  { id: 'l1', name: 'L1 · Support Agent', desc: 'Sees order status to help customers. Read-only.', perms: ['overview', 'orders', 'roles'] }
];
function adminRole() { return ADMIN_ROLES.find(r => r.id === (S.adminRole || 'l5')) || ADMIN_ROLES[0]; }

view('admin', args => {
  adminSeed();
  const role = adminRole();
  let tab = args[0] || 'overview';
  if (!role.perms.includes(tab)) tab = 'overview';
  const A = S.admin;
  const tabs = [['overview', 'Overview'], ['purity', 'Purity'], ['kyc', 'KYC'], ['fraud', 'Fraud'], ['orders', 'Orders'], ['plans', 'Plans'], ['roles', 'Control levels'], ['data', 'Database']];
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
    : `<div class="empty"><span>${ic('receipt', 40)}</span><b>No orders yet in this demo</b></div>`;

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
    <div class="card-block"><h3>Delivery partners (Earn mode)</h3>
      <div class="ck-line"><span>Joining & platform fee</span><span><b>0 — they earn, never pay</b></span></div></div>`;

  if (tab === 'roles') body = `
    <div class="tip-strip">${ic('shield', 13)} Five control levels — each admin sees only what their level permits. You are acting as <b>${role.name}</b>.</div>
    ${ADMIN_ROLES.map(r => `
    <div class="job-card ${r.id === role.id ? 'active' : ''}">
      <div class="job-top"><span class="job-emoji">${ic(r.id === 'l5' ? 'shield' : r.id === 'l3' ? 'leaf' : 'user', 20)}</span>
        <div><b>${r.name}</b><small>${r.desc}</small></div>
        ${r.id === role.id ? '<em class="job-pay">Acting</em>' : ''}</div>
      <div class="job-note">Access: ${r.perms.filter(p => !['roles'].includes(p)).map(p => tabs.find(t => t[0] === p)[1]).join(' · ')}</div>
      ${r.id !== role.id ? `<button class="btn-main wide sm ghost" onclick="S.adminRole='${r.id}';save();toast('Now acting as ${r.name}');VIEWS.admin(['roles'])">Act as this level</button>` : ''}
    </div>`).join('')}`;

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
    <button class="btn-main wide ghost" onclick="exportState()">${ic('upload', 14)} Export full database (JSON)</button>`;
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
});

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
