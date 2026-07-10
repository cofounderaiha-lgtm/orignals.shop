/* ============================================================
   EARN MODE — one verified human, every kind of trip:
   taxi rides (solo/shared) + parcels on the same pathway.
   Gamified earnings · seva (free) mode · CV face+vehicle verify
   ============================================================ */

let REG = null;

/* partner yearly fee by vehicle level (first month complimentary) */
const PARTNER_FEE = { walk: 1, cycle: 1, bike: 3, auto: 5, car: 7, van: 7, truck: 10 };

const RIDE_JOBS = [
  { id: 'rj1', what: 'Ride · 1 person to Cyber Park', type: 'ride', from: 'Lakeview Residency', to: 'Tower B, Cyber Park', km: 8.4, pay: 96, by: 'Priya M. · face-verified', note: 'Share OK — one more co-rider may join on route' },
  { id: 'rj2', what: 'Ride · 2 people to Railway Station', type: 'ride', from: 'Central Mall', to: 'Railway Station', km: 4.1, pay: 62, by: 'Rahul S. · face-verified', note: 'Luggage: 2 bags' },
  { id: 'rj3', what: 'Ride · 1 person to Uni Campus', type: 'ride', from: 'Shanti Kunj, Sector 9', to: 'Uni Campus, Main Block', km: 5.6, pay: 71, by: 'Zoya K. · face-verified', note: 'Morning class — before 9 am' }
];
function allJobs() { return [...DB.seedJobs, ...RIDE_JOBS]; }
function jobIcon(type) { return type === 'ride' ? ic('users', 20) : parcelIcon(type, 20); }
function jobFits(j, v) {
  if (j.type === 'ride') return !!DB.vehicles.find(x => x.id === v.id && x.ride) && j.km <= v.maxKm;
  const pt = DB.parcelTypes.find(p => p.id === j.type);
  return pt && pt.fits.includes(v.id) && j.km <= v.maxKm;
}

view('earn', () => {
  const et = S.earnMode || 'deliver';
  if (et === 'sell' || et === 'services') { renderEarnSell(et); return; }
  if (!S.partner) { renderEarnPitch(); return; }
  if (S.partner.status === 'verifying') { renderVerifying(); return; }
  if (S.activeJob) { renderActiveJob(); return; }
  renderJobFeed();
});

/* ---------- earner-type toggle: three ways to earn on Orignals ---------- */
function setEarnMode(m) { S.earnMode = m; save(); VIEWS.earn([]); }
function earnToggle(active) {
  const segs = [
    ['deliver', 'truck', 'Deliver & Ride'],
    ['sell', 'store', 'Sell Products'],
    ['services', 'spark', 'Services']
  ];
  return `<div class="earn-seg">${segs.map(s =>
    `<button class="${active === s[0] ? 'on' : ''}" onclick="setEarnMode('${s[0]}')">${ic(s[1], 15)}<span>${s[2]}</span></button>`).join('')}</div>`;
}

/* ---------- SELL / SERVICES pitch (shops & providers earn too) ---------- */
function renderEarnSell(kind) {
  if (S.myShop) {
    S.earnMode = 'deliver'; renderShopDash(); return;   // already a seller → dashboard
  }
  const isSvc = kind === 'services';
  const tiers = [
    ['Individual', 'Service person, solo seller, one vehicle', '1 CHF/yr'],
    ['Retail shop', 'Kirana, pharmacy, small store', '10 CHF/yr'],
    ['Large retail', 'Restaurant, multi-staff shop', '25 CHF/yr'],
    ['Wholesaler', 'Dealer, distributor, hotel', '50 CHF/yr'],
    ['Manufacturer', 'Factory, enterprise brand', '100 CHF/yr']
  ];
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="setMode('buy')">${ic('chevl', 16)}</button>
    <div><h1>Earn on Orignals</h1><small>Three ways to make money — pick yours</small></div></div>
  ${earnToggle(kind)}

  <div class="pitch-hero">
    <div class="pitch-live"><i></i>Every shop &amp; service in India can sell here</div>
    <h1>${isSvc ? 'Your skill,<br/><span>booked online.</span>' : 'Your shop,<br/><span>selling to the street.</span>'}</h1>
    <p>${isSvc
      ? 'Tailor, salon, tutor, electrician, plumber — list your service, take bookings from everyone nearby, get paid to your wallet instantly.'
      : 'Kirana, restaurant, pharmacy, wholesaler — list your products and everyone near you can order. You keep 100% of the item price. Deliver yourself or let a nearby partner carry it.'}</p>
    <div class="btn-pair hero-cta">
      <button class="btn-cta" onclick="startShopReg()">${isSvc ? 'List my service' : 'Register my shop'} — 2 min</button>
    </div>
  </div>

  <div class="earn-stats">
    <div><span class="st-ic t1">${ic('cash', 16)}</span><b>100%</b><small>of item price is yours</small></div>
    <div><span class="st-ic t2">${ic('truck', 16)}</span><b>You choose</b><small>self or partner delivery</small></div>
    <div><span class="st-ic t3">${ic('shield', 16)}</span><b>First month free</b><small>then tiered by turnover</small></div>
  </div>

  <div class="sec-head"><h2>Seller tiers</h2><small class="dim">no signup fee</small></div>
  <div class="card-block">
    ${tiers.map((t, i) => `<div class="ck-line"><span><b>${i + 1} · ${t[0]}</b> — ${t[1]}</span><span>${t[2]}</span></div>`).join('')}
  </div>

  <div class="how-grid tinted">
    <div class="how"><span>${ic('edit', 22)}</span><b>2-minute setup</b><p>Name, category, address, timings — big buttons, no confusing forms. Add GST/FSSAI if you have them.</p></div>
    <div class="how"><span>${ic('cash', 22)}</span><b>Money instantly</b><p>Every sale lands in your wallet the moment it's delivered. Daily settlement to your bank.</p></div>
    <div class="how"><span>${ic('leaf', 22)}</span><b>Purity badge</b><p>Sell natural &amp; unadulterated? Our field team verifies your batches — the Purity seal sells itself.</p></div>
    <div class="how"><span>${ic('chart', 22)}</span><b>Grow with data</b><p>Live sales chart, stock control, offers and a shareable shop link — all built in.</p></div>
  </div>

  <button class="btn-main wide lg" onclick="startShopReg()">${isSvc ? 'List my service now' : 'Take my shop live'}</button>
  <div class="foot-note">No signup fee · first month complimentary · then 1–100 CHF/yr by tier.</div>`;
}

/* ---------- pitch + registration ---------- */
function renderEarnPitch() {
  const teaser = [...allJobs()].sort((a, b) => b.pay / b.km - a.pay / a.km).slice(0, 5);
  const total = teaser.reduce((a, j) => a + j.pay, 0);
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="setMode('buy')">${ic('chevl', 16)}</button>
    <div><h1>Earn on Orignals</h1><small>Three ways to make money — pick yours</small></div></div>
  ${earnToggle('deliver')}
  <div class="pitch-hero">
    <div class="pitch-live"><i></i>${allJobs().length} jobs live near ${esc(S.user.addr.name)} · ${money(total)}+ on the table</div>
    <h1>Passing by anyway?<br/><span>Get paid for it.</span></h1>
    <p>People, tiffins, medicines, parcels — everything moving along your route stacks into one trip. Or carry free as seva. Your road, your rules.</p>
    <div class="btn-pair hero-cta">
      <button class="btn-cta" onclick="startPartnerReg()">Register &amp; verify — 2 min</button>
      <button class="btn-cta ghost" onclick="document.getElementById('jobTeaser').scrollIntoView({behavior:'smooth'})">See the jobs first</button>
    </div>
  </div>

  <div class="sec-head" id="jobTeaser"><h2>On your path, right now</h2><small class="dim">register to accept</small></div>
  <div class="teaser-scroll">
    ${teaser.map(j => `
      <div class="teaser-card" onclick="startPartnerReg()">
        <span class="tz-ic">${jobIcon(j.type)}</span>
        <b>${esc(j.what)}</b>
        <small>${esc(j.from)} ${ic('arrowr', 10)} ${esc(j.to)}</small>
        <div class="tz-foot"><em>+${money(j.pay)}</em><span>${j.km} km</span></div>
      </div>`).join('')}
    <div class="teaser-card more" onclick="startPartnerReg()"><b>+${allJobs().length - teaser.length} more</b><small>unlock the full feed</small><span class="tz-arrow">${ic('arrowr', 18)}</span></div>
  </div>

  <div class="earn-stats">
    <div><span class="st-ic t1">${ic('cash', 16)}</span><b>₹120–450</b><small>avg per day, part-time</small></div>
    <div><span class="st-ic t2">${ic('truck', 16)}</span><b>Walk to truck</b><small>every vehicle counts</small></div>
    <div><span class="st-ic t3">${ic('shield', 16)}</span><b>1–10 CHF/yr</b><small>by vehicle · first month free</small></div>
  </div>

  <div class="steps-strip">
    <div class="step"><i>1</i><div><b>Register</b><small>name, phone, vehicle — 2 minutes</small></div></div>
    <div class="step-line"></div>
    <div class="step"><i>2</i><div><b>CV-verify</b><small>face + vehicle scanned once</small></div></div>
    <div class="step-line"></div>
    <div class="step"><i>3</i><div><b>Earn</b><small>accept jobs on your route</small></div></div>
  </div>

  <div class="how-grid tinted">
    <div class="how"><span>${ic('camera', 22)}</span><b>CV-verified identity</b><p>Live face scan matched to your govt ID by high-precision computer vision. The vehicle's plate &amp; model are verified too.</p></div>
    <div class="how"><span>${ic('pin', 22)}</span><b>Jobs on your path</b><p>Going somewhere? Rides and parcels along the same route stack into one trip — more earnings per kilometre.</p></div>
    <div class="how"><span>${ic('cash', 22)}</span><b>Instant money</b><p>OTP handover, live GPS trace, money in your wallet the second you deliver. Withdraw to UPI anytime.</p></div>
    <div class="how"><span>${ic('gift', 22)}</span><b>Seva mode</b><p>Help a neighbour free — toggle seva, deliver at zero charge, earn community karma instead.</p></div>
  </div>

  <div class="quote-strip">
    <span class="q-ava">${ic('user', 20)}</span>
    <div>"I drop 2 tiffins on my way to college — no extra petrol, just my usual route. That's ₹1,800 a month extra."<small>— Ravi K. · cycle partner · 4,820 trips · ★ 4.9</small></div>
  </div>

  <button class="btn-main wide lg" onclick="startPartnerReg()">Start earning on your route</button>
  <div class="foot-note">${ic('shield', 12)} Face + vehicle verified by computer vision · OTP handovers · live GPS. Safety first, always.</div>`;
}

function startPartnerReg() {
  REG = { step: 1, name: S.user.name !== 'Friend' ? S.user.name : '', phone: '', veh: null, docs: {}, upi: '', agree: false };
  renderReg();
}
function regDocList() {
  const motor = ['bike', 'auto', 'car', 'van', 'truck'].includes(REG.veh);
  const docs = [
    ['id', 'Govt ID (masked & encrypted)', 'file'],
    ['face', 'Live face scan — CV match with ID', 'camera']
  ];
  if (motor) docs.push(['dl', 'Driving licence', 'file'], ['veh', 'Vehicle scan — plate + model CV-verified', 'camera']);
  return docs;
}
function renderReg() {
  const st = REG.step;
  let body = '';

  if (st === 1) body = `
    <div class="wiz-q">About you</div>
    <label class="fld"><span>Full name</span><input class="txt" placeholder="e.g. Ramesh Kumar" value="${esc(REG.name)}" oninput="REG.name=this.value"/></label>
    <label class="fld"><span>Mobile number</span><input class="txt" placeholder="10-digit mobile" maxlength="10" inputmode="numeric" value="${esc(REG.phone)}" oninput="REG.phone=this.value.replace(/\\D/g,'')"/></label>
    <button class="btn-main wide" onclick="regNext1()">Next ${ic('arrowr', 13)}</button>`;

  if (st === 2) body = `
    <div class="wiz-q">How will you carry?</div>
    <div class="ptype-grid">
      ${DB.vehicles.map(v => `<button class="ptype ${REG.veh === v.id ? 'on' : ''}" onclick="REG.veh='${v.id}';renderReg()">
        <span>${vehIcon(v.id, 26)}</span><b>${v.name} <small class="ok">· ${PARTNER_FEE[v.id]} CHF/yr</small></b><small>${v.carry}${v.ride ? ' · can carry people' : ''}</small></button>`).join('')}
    </div>
    ${REG.veh ? `<button class="btn-main wide" onclick="REG.step=3;renderReg()">Next ${ic('arrowr', 13)}</button>` : ''}
    <div class="tip-strip">No vehicle? No problem. Walkers deliver tiffins &amp; documents within 2 km.</div>`;

  if (st === 3) body = `
    <div class="wiz-q">Verification <small>— precise, anti-fraud</small></div>
    ${regDocList().map(d => `
      <button class="doc-row ${REG.docs[d[0]] ? 'ok' : ''}" onclick="REG.docs['${d[0]}']=!REG.docs['${d[0]}'];renderReg()">
        <div><b>${ic(d[2], 15)} ${d[1]}</b><small>${REG.docs[d[0]] ? 'Captured & verified ✓' : 'Tap to scan'}</small></div>
        <span>${REG.docs[d[0]] ? ic('check', 18) : ic('upload', 18)}</span></button>`).join('')}
    ${regDocList().every(d => REG.docs[d[0]]) ? `<button class="btn-main wide" onclick="REG.step=4;renderReg()">Next ${ic('arrowr', 13)}</button>` : ''}
    <div class="tip-strip">${ic('shield', 12)} Both rider and driver are face-verified — and the exact vehicle on the trip is the one that was verified. No swaps, no fraud.</div>`;

  if (st === 4) body = `
    <div class="wiz-q">Get paid</div>
    <label class="fld"><span>UPI ID (for cash-outs)</span><input class="txt" placeholder="yourname@bank" value="${esc(REG.upi)}" oninput="REG.upi=this.value"/></label>
    <label class="agree-row ${REG.agree ? 'on' : ''}" onclick="REG.agree=!REG.agree;renderReg()">
      <i>${REG.agree ? '✓' : ''}</i><span>I'll treat every person and parcel with care, follow traffic rules, and hand over with OTP only. Safety, purity, sustainability — for all.</span></label>
    ${REG.upi.includes('@') && REG.agree ? `<button class="btn-main wide lg" onclick="submitPartnerReg()">Submit for verification</button>` : ''}`;

  $('#view').innerHTML = `
  <div class="page-head">
    <button class="back" onclick="${st === 1 ? 'renderEarnPitch()' : `REG.step=${st - 1};renderReg()`}">${ic('chevl', 16)}</button>
    <div><h1>Partner registration</h1><small>Detailed but easy — step ${st} of 4</small></div></div>
  <div class="wiz-dots">${[1, 2, 3, 4].map(i => `<i class="${i <= st ? 'on' : ''}"></i>`).join('')}</div>
  ${body}`;
}
function regNext1() {
  if (REG.name.trim().length < 3) { toast('Please enter your full name'); return; }
  if (REG.phone.length !== 10) { toast('Enter a valid 10-digit mobile number'); return; }
  REG.step = 2; renderReg();
}
function submitPartnerReg() {
  S.partner = { name: REG.name.trim(), phone: REG.phone, veh: REG.veh, upi: REG.upi, status: 'verifying', since: Date.now(), rating: 5.0, jobs: 0, seva: 0, streak: 0 };
  S.user.name = REG.name.trim().split(' ')[0];
  save(); renderVerifying();
  setTimeout(() => {
    if (S.partner && S.partner.status === 'verifying') {
      S.partner.status = 'verified'; save();
      notify('You are verified', 'Face + vehicle matched by computer vision. Jobs near you are live.');
      toast('Verified! You can start earning now');
      confettiBurst();
      if (location.hash.includes('earn')) VIEWS.earn([]);
    }
  }, 3500);
}
function renderVerifying() {
  $('#view').innerHTML = `
  <div class="earn-hero">
    <span class="earn-big spin-slow">${ic('shield', 54)}</span>
    <h1>Verifying you…</h1>
    <p>Computer vision is matching your live face scan with your ID${['bike','auto','car','van','truck'].includes(S.partner.veh) ? ', and your vehicle plate with its registration' : ''}. Usually done in under a minute.</p>
    <div class="verify-bar"><i></i></div>
  </div>`;
}

/* ---------- job feed (gamified) ---------- */
function availableJobs() {
  const doneIds = S.earnings.map(e => e.jobId);
  const v = DB.vehicles.find(x => x.id === S.partner.veh);
  return allJobs().filter(j => !doneIds.includes(j.id)).filter(j => jobFits(j, v));
}
function todayEarn() {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  return S.earnings.filter(e => e.ts >= d0.getTime()).reduce((a, e) => a + e.pay, 0);
}

function partnerOnline() { return S.partner && S.partner.online !== false; }
function toggleOnline() {
  S.partner.online = !partnerOnline();
  save();
  toast(S.partner.online ? 'You are online — jobs on your path will appear' : 'You are offline — no jobs will be offered');
  renderJobFeed();
}

/* real neighbour-posted jobs from the cloud (cross-device marketplace) */
let _cloudJobs = [], _cloudJobsAt = 0;
function refreshCloudJobs() {
  if (typeof cloudJobs !== 'function' || !CLOUD.on) return;
  if (Date.now() - _cloudJobsAt < 20000) return;
  _cloudJobsAt = Date.now();
  cloudJobs().then(list => {
    const had = _cloudJobs.length;
    _cloudJobs = list || [];
    /* re-render only if the feed is on screen and the job count changed */
    if (_cloudJobs.length !== had && S.partner && S.partner.status !== 'verifying' &&
        !S.activeJob && S.mode === 'earn' && (S.earnMode || 'deliver') === 'deliver') {
      renderJobFeed();
    }
  }).catch(() => {});
}

function renderJobFeed() {
  const v = DB.vehicles.find(x => x.id === S.partner.veh);
  const on = partnerOnline();
  const local = on ? availableJobs() : [];
  const cloud = on ? _cloudJobs.filter(j => jobFits(j, v)) : [];
  const jobs = [...cloud, ...local];
  const waiting = jobs.reduce((a, j) => a + j.pay, 0);
  const seva = window._sevaMode;
  const hour = new Date().getHours();
  if (on) refreshCloudJobs();

  $('#view').innerHTML = `
  ${earnToggle('deliver')}
  <div class="online-bar ${on ? 'on' : ''}">
    <span class="ob-dot"></span>
    <div class="ob-info"><b>Namaste, ${esc(S.partner.name.split(' ')[0])}</b>
      <small>${on ? `You're online · earning on your ${v.name} ${hour < 12 ? 'this morning' : hour < 17 ? 'this afternoon' : 'this evening'}` : 'You\'re offline — flip the switch when you\'re heading out'}</small></div>
    <button class="ob-switch ${on ? 'on' : ''}" onclick="toggleOnline()" aria-label="Go ${on ? 'offline' : 'online'}"></button>
  </div>
  <div class="earn-top">
    <div class="earn-me">
      <span class="pc-ava big">${vehIcon(S.partner.veh, 24)}</span>
      <div><b>${esc(S.partner.name)}</b><small>${ic('shield', 11)} CV-verified · ★ ${S.partner.rating.toFixed(1)} · ${S.partner.jobs} trips · ${S.partner.seva || 0} seva</small></div>
      <button class="lnk" onclick="go('earnings')">Earnings ${ic('arrowr', 11)}</button>
    </div>
    <div class="waiting-strip">
      <div class="waiting-amt"><small>WAITING ON YOUR PATH</small><b>${money(waiting)}</b></div>
      <div class="waiting-sub">${jobs.length} jobs match your ${v.name} right now ${jobs.length > 1 ? '· stack same-route jobs in one trip' : ''}</div>
    </div>
    <div class="earn-tiles">
      <div class="etile"><b>${money(todayEarn())}</b><small>Today</small></div>
      <div class="etile"><b>${money(S.earnings.reduce((a, e) => a + e.pay, 0))}</b><small>All time</small></div>
      <div class="etile"><b>${S.partner.streak || 0}🔥</b><small>Day streak</small></div>
    </div>
    <label class="agree-row slim ${seva ? 'on' : ''}" onclick="window._sevaMode=!window._sevaMode;renderJobFeed()">
      <i>${seva ? '✓' : ''}</i><span><b>Seva mode</b> — deliver free for neighbours, earn karma not cash</span></label>
  </div>

  <div class="sec-head"><h2>On your way ${on ? '<span class="live-dot"></span>' : ''}</h2><small>rides + parcels, same pathway</small></div>
  ${!on ? `<div class="empty"><span>${ic('clock', 40)}</span><b>You're offline</b>
      <p>Go online and jobs along your route — rides, parcels, tiffins — will appear here.</p>
      <button class="btn-main" onclick="toggleOnline()">Go online</button></div>`
  : jobs.length ? jobs.map(j => `
    <div class="job-card">
      <div class="job-top"><span class="job-emoji">${jobIcon(j.type)}</span>
        <div><b>${esc(j.what)}</b><small>by ${esc(j.by)}${j.cloud ? ' · <b class="ok">LIVE — posted from another device</b>' : ''}${j.type === 'ride' ? ' · end-to-end or shared' : ''}</small></div>
        <em class="job-pay">${seva ? 'SEVA' : '+' + money(j.pay)}</em></div>
      <div class="job-route"><i class="pin g"></i>${esc(j.from)}<span class="job-arrow">${ic('arrowr', 11)}</span><i class="pin r"></i>${esc(j.to)}<b>· ${j.km} km</b></div>
      ${j.note ? `<div class="job-note">${esc(j.note)}</div>` : ''}
      <button class="btn-main wide sm" onclick="acceptJob('${j.id}',${seva ? 'true' : 'false'})">${seva ? 'Accept as seva (free)' : 'Accept · earn ' + money(j.pay)}</button>
    </div>`).join('')
  : `<div class="empty"><span>${ic('clock', 40)}</span><b>No jobs on your path right now</b>
      <p>New rides &amp; parcels appear the moment neighbours and shops post them.</p>
      <button class="btn-main" onclick="S.earnings=S.earnings.map(e=>({...e,jobId:'used_'+e.jobId}));save();VIEWS.earn([])">Check for new jobs</button></div>`}
  <div class="foot-note">${ic('shield', 12)} OTP both ends · GPS trace · insurance on every trip · money lands instantly</div>`;
}

function acceptJob(jobId, seva) {
  const cj = _cloudJobs.find(x => x.id === jobId);
  if (cj) { acceptCloudJob(cj, seva); return; }
  const j = allJobs().find(x => x.id === jobId); if (!j) return;
  S.activeJob = { jobId, stage: 0, seva: !!seva, otpPick: rnd(1000, 9999), otpDrop: rnd(1000, 9999), acceptedAt: Date.now() };
  save(); toast(seva ? 'Seva accepted — you are gold' : 'Job accepted — head to pickup');
  renderActiveJob();
}

/* claim a neighbour-posted job atomically — first partner wins, others
   get an honest "already taken" the moment they try */
async function acceptCloudJob(j, seva) {
  toast('Claiming job…');
  try {
    const ok = await cloudJobClaim(j.id);
    if (ok !== true) {
      _cloudJobs = _cloudJobs.filter(x => x.id !== j.id);
      toast('Another partner just took this one');
      renderJobFeed();
      return;
    }
    S.activeJob = { jobId: j.id, cloudJob: j, cloud: true, stage: 0, seva: !!seva, otpPick: rnd(1000, 9999), otpDrop: rnd(1000, 9999), acceptedAt: Date.now() };
    _cloudJobs = _cloudJobs.filter(x => x.id !== j.id);
    save(); toast(seva ? 'Seva accepted — you are gold' : 'Job claimed — head to pickup');
    renderActiveJob();
  } catch (e) { toast('Could not claim the job — check connection'); }
}

/* ---------- active job ---------- */
/* job endpoints: real GPS when the poster pinned it (cloud jobs carry the
   sender's actual coordinates); otherwise a stable derived position */
function jobGeo(j) {
  if (j.geo && j.geo.from && j.geo.from.lat != null) return j.geo;
  let h = 0; const id = String(j.id);
  for (let i = 0; i < id.length; i++) h = (h * 37 + id.charCodeAt(i)) >>> 0;
  const base = DB.places[0];
  const from = geoDest(base.lat, base.lng, 0.3 + (h % 20) / 10, h % 360);
  const to = geoDest(from.lat, from.lng, Math.max(+j.km || 1, 0.5), (h >> 5) % 360);
  return { from, to };
}

function renderActiveJob() {
  const A = S.activeJob;
  const j = A.cloudJob || allJobs().find(x => x.id === A.jobId);
  const steps = ['Head to pickup', j.type === 'ride' ? 'Start ride with OTP' : 'Collect with OTP', j.type === 'ride' ? 'End ride with OTP' : 'Deliver with OTP'];

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="dropJobConfirm()">${ic('x', 16)}</button>
    <div><h1>${steps[A.stage]}</h1><small>${esc(j.what)} · ${A.seva ? 'SEVA — free delivery' : '+' + money(j.pay)}</small></div></div>

  <div class="track-map real"><div id="jobMap" class="route-canvas full"></div>
    <div class="nav-fab" onclick="jobNavigate()">${ic('pin', 16)} Navigate</div>
  </div>

  <div class="job-hud">
    <div class="hud-cell"><b>${A.seva ? 'SEVA' : '+' + money(j.pay)}</b><small>${A.seva ? 'karma' : 'you earn'}</small></div>
    <div class="hud-cell"><b>${j.km} km</b><small>${A.stage < 1 ? 'to pickup' : 'to drop'}</small></div>
    <div class="hud-cell"><b>${(S.partner.jobs || 0) + 1}</b><small>trip today</small></div>
  </div>

  <div class="job-card active">
    <div class="job-route"><i class="pin g"></i>${esc(j.from)}<span class="job-arrow">${ic('arrowr', 11)}</span><i class="pin r"></i>${esc(j.to)}<b>· ${j.km} km</b></div>
    ${j.note ? `<div class="job-note">${esc(j.note)}</div>` : ''}
    ${(A.cloud && j.orderRef && typeof orderChat === 'function') ? `<div class="job-contact">
      ${typeof callControls === 'function' ? callControls(j.orderRef, 'partner') : ''}
      <button class="btn-main sm ghost" onclick="orderChat('${j.orderRef}','partner')">${ic('spark', 13)} Message — no numbers</button>
    </div>` : ''}
    <div class="otp-strip">${A.stage === 1 ? `Ask the ${j.type === 'ride' ? 'rider' : 'sender'} for their OTP to ${j.type === 'ride' ? 'start' : 'collect'}` : A.stage === 2 ? `Ask the ${j.type === 'ride' ? 'rider' : 'customer'} to show their OTP or QR — enter it below` : `Head to the pickup — tap Navigate for directions`}</div>
  </div>

  ${(A.stage === 2 && j.type !== 'ride') ? `
  <div class="card-block handover">
    <h3>${ic('camera', 14)} Verify who collects</h3>
    <p class="movie-about">Even if a friend or family member picks up on the receiver's behalf, capture their photo — a verified record of exactly who took the parcel.</p>
    ${A.collectorPhoto ? `<div class="face-preview"><img src="${A.collectorPhoto}" alt="collector"/><span>${ic('check', 12)} Collector verified</span></div>`
      : `<button class="btn-main sm" onclick="captureCollector()">${ic('camera', 14)} Capture collector's photo</button>`}
  </div>` : ''}

  <div class="wiz-dots">${[0, 1, 2].map(i => `<i class="${i <= A.stage ? 'on' : ''}"></i>`).join('')}</div>
  ${A.stage === 0 ? `<button class="btn-main wide lg" onclick="jobReachedPickup()">${ic('pin', 15)} I've reached the pickup</button>` : ''}
  ${A.stage === 1 ? `<button class="btn-main wide lg" onclick="S.activeJob.stage=2;save();toast('On the way — ride safe!');renderActiveJob()">${ic('check', 15)} Collected — start delivery</button>` : ''}
  ${A.stage === 2 ? `<button class="btn-main wide lg" onclick="deliverWithOTP()">${ic('flag', 15)} ${j.type === 'ride' ? 'End ride' : 'Confirm delivery'} — OTP / QR</button>` : ''}`;

  /* real map: pickup + drop + your position; live GPS follows you if allowed */
  const g = jobGeo(j);
  const el = document.getElementById('jobMap');
  if (el && typeof routeMap === 'function') {
    routeMap('jobMap', { lat: g.from.lat, lng: g.from.lng }, { lat: g.to.lat, lng: g.to.lng });
    if (navigator.geolocation && el._map) {
      navigator.geolocation.getCurrentPosition(pos => {
        try {
          if (!el._map) return;
          const meIc = L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
            html: `<div style="width:30px;height:30px;border-radius:50%;background:#E8A020;border:3px solid #fff;box-shadow:0 3px 9px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff">${ic(VEH_ICON[S.partner.veh] || 'bike', 14)}</div>` });
          L.marker([pos.coords.latitude, pos.coords.longitude], { icon: meIc, zIndexOffset: 950 }).addTo(el._map);
        } catch (e) {}
      }, () => {}, { timeout: 6000 });
    }
  }
  startJobPing();   // share live location to the buyer (real jobs)
  /* partner listens for an in-app call from the customer on this order */
  if (A.cloud && j.orderRef && typeof callWatch === 'function') callWatch(j.orderRef, 'partner');
}

function jobNavigate() {
  const A = S.activeJob; if (!A) return;
  const j = A.cloudJob || allJobs().find(x => x.id === A.jobId); if (!j) return;
  const g = jobGeo(j);
  const target = A.stage >= 2 ? g.to : g.from;   // pickup first, then drop
  if (typeof navTo === 'function') navTo(target.lat, target.lng, A.stage >= 2 ? j.to : j.from);
}
function jobReachedPickup() {
  const A = S.activeJob; if (!A) return;
  if (A.cloud && typeof cloudJobPicked === 'function') cloudJobPicked(A.jobId);
  A.stage = 1; save(); renderActiveJob();
}
/* live GPS sharing to the buyer while carrying a real order */
function startJobPing() {
  clearInterval(window._jobPing);
  const A = S.activeJob;
  if (!A || !A.cloud || !navigator.geolocation || typeof cloudJobPing !== 'function') return;
  const ping = () => {
    if (!S.activeJob || !S.activeJob.cloud) { clearInterval(window._jobPing); return; }
    navigator.geolocation.getCurrentPosition(
      pos => cloudJobPing(S.activeJob.jobId, +pos.coords.latitude.toFixed(6), +pos.coords.longitude.toFixed(6)),
      () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 });
  };
  ping();
  window._jobPing = setInterval(ping, 15000);   // share location every 15s
}
/* handover: enter the OTP the buyer shows, or scan their QR — verified server-side */
function deliverWithOTP() {
  const A = S.activeJob; if (!A) return;
  const j = A.cloudJob || allJobs().find(x => x.id === A.jobId);
  if (!A.cloud) { completeJob(); return; }   // local/demo job → no server OTP
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Confirm handover</h3>
    <p class="movie-about">Ask the customer to show their 4-digit OTP (or QR) from their order. No numbers or personal details are ever shared.</p>
    <label class="fld"><span>Enter customer's OTP</span><input class="txt" id="dlvOtp" inputmode="numeric" maxlength="4" placeholder="4-digit OTP" style="text-align:center;font-size:1.4rem;letter-spacing:6px"/></label>
    <button class="btn-main wide" onclick="submitDeliverOTP()">${ic('check', 14)} Confirm delivery</button>
    <button class="btn-main wide ghost" onclick="scanDeliverQR()">${ic('camera', 14)} Scan customer's QR instead</button>`);
  setTimeout(() => { const el = document.getElementById('dlvOtp'); if (el) el.focus(); }, 60);
}
async function submitDeliverOTP(otpOverride) {
  const A = S.activeJob; if (!A) return;
  const otp = otpOverride || ($('#dlvOtp') && $('#dlvOtp').value.trim()) || '';
  if (!otpOverride && !/^\d{4}$/.test(otp)) { toast('Enter the 4-digit OTP'); return; }
  toast('Verifying…');
  const r = await cloudJobDeliver(A.jobId, otp);
  if (r && r.ok) { closeSheet(); completeJob(); }
  else toast(r && r.reason === 'wrong_otp' ? 'Wrong OTP — ask the customer again' : 'Could not verify — try the QR');
}
async function scanDeliverQR() {
  if (!('BarcodeDetector' in window)) { toast('QR scan not supported here — use the OTP'); return; }
  if (typeof captureCameraPhoto !== 'function') { toast('Camera unavailable'); return; }
  try {
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    captureCameraPhoto('Scan customer QR', 'Point at the QR on the customer\'s order.', async (dataUrl) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const codes = await det.detect(img);
          const raw = codes && codes[0] && codes[0].rawValue;
          const m = raw && String(raw).match(/(\d{4})/);
          if (m) submitDeliverOTP(m[1]);
          else toast('Could not read the QR — use the OTP');
        } catch (e) { toast('Could not read the QR — use the OTP'); }
      };
      img.src = dataUrl;
    });
  } catch (e) { toast('QR scan unavailable — use the OTP'); }
}
function captureCollector() {
  if (typeof captureCameraPhoto !== 'function') { toast('Camera unavailable'); return; }
  captureCameraPhoto('Verify who is collecting', 'Ask the person collecting to face the camera.', (data) => {
    if (S.activeJob) { S.activeJob.collectorPhoto = data; S.activeJob.collectorAt = Date.now(); save(); }
    toast('Collector verified — record saved with this delivery');
    renderActiveJob();
  });
}

function dropJobConfirm() {
  if (confirm('Drop this job? It goes back to the feed for other partners.')) {
    const A = S.activeJob;
    if (A && A.cloud && CLOUD.on) {
      cloudFetch('rpc/job_reopen', { method: 'POST', body: JSON.stringify({ p_job: A.jobId, p_device: S.deviceKey || 'anon' }) }).catch(() => {});
    }
    S.activeJob = null; save(); VIEWS.earn([]);
  }
}
function completeJob() {
  const A = S.activeJob;
  const j = A.cloudJob || allJobs().find(x => x.id === A.jobId);
  const pay = A.seva ? 0 : j.pay;
  /* cross-device job: mark done in the cloud so the poster's side updates */
  if (A.cloud && typeof cloudJobDone === 'function') cloudJobDone(A.jobId).catch(() => {});
  S.earnings.unshift({ id: uid(), jobId: j.id, ts: Date.now(), what: j.what + (A.seva ? ' (seva)' : ''), pay });
  S.partner.jobs += 1;
  if (A.seva) S.partner.seva = (S.partner.seva || 0) + 1;
  S.partner.streak = (S.partner.streak || 0) + (todayEarn() === 0 && !A.seva ? 1 : S.partner.streak ? 0 : 1) || S.partner.streak || 1;
  S.activeJob = null;
  if (pay) walletAdd(pay, 'Earning · ' + j.what);
  notify(A.seva ? 'Seva complete — karma +1' : 'You earned ' + money(pay), j.what + (A.seva ? ' — a neighbour thanks you.' : ' — money added to wallet.'));
  save(); confettiBurst(); toast(A.seva ? 'Seva done. Respect.' : '+' + money(pay) + ' added to your wallet');
  VIEWS.earn([]);
}

/* ---------- earnings dashboard ---------- */
view('earnings', () => {
  if (!S.partner) { go('earn'); return; }
  const total = S.earnings.reduce((a, e) => a + e.pay, 0);
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i));
    const next = d.getTime() + 86400000;
    return { lbl: d.toLocaleDateString('en-IN', { weekday: 'narrow' }), amt: S.earnings.filter(e => e.ts >= d.getTime() && e.ts < next).reduce((a, e) => a + e.pay, 0) };
  });
  const max = Math.max(...days.map(d => d.amt), 50);

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('earn')">${ic('chevl', 16)}</button>
    <div><h1>Your earnings</h1><small>${S.partner.jobs} trips · ${S.partner.seva || 0} seva · ★ ${S.partner.rating.toFixed(1)}</small></div></div>
  <div class="earn-tiles wide3">
    <div class="etile"><b>${money(todayEarn())}</b><small>Today</small></div>
    <div class="etile"><b>${money(total)}</b><small>All time</small></div>
    <div class="etile"><b>${money(S.wallet.bal)}</b><small>Wallet</small></div>
  </div>
  ${(() => { const j = S.partner.jobs;
    const lv = j >= 25 ? ['Gold', 25, 50] : j >= 10 ? ['Silver', 10, 25] : ['Bronze', 0, 10];
    const pct = Math.min((j - lv[1]) / (lv[2] - lv[1]) * 100, 100);
    return `<div class="card-block">
    <h3>${ic('star', 14)} Partner level — <b>${lv[0]}</b></h3>
    <div class="lvl-bar"><i style="width:${pct}%"></i></div>
    <small class="dim">${j >= 25 ? 'Top tier — priority jobs & festival bonuses unlocked' : `${lv[2] - j} more trips to ${lv[2] === 10 ? 'Silver (priority jobs)' : 'Gold (festival bonuses)'}`}</small>
  </div>`; })()}
  <div class="card-block">
    <h3>Last 7 days</h3>
    <div class="bars">${days.map(d => `<div class="bar"><i style="height:${Math.max(d.amt / max * 100, 3)}%"></i><small>${d.lbl}</small></div>`).join('')}</div>
  </div>
  <div class="sec-head"><h2>History</h2></div>
  ${S.earnings.length ? S.earnings.map(e => `<div class="order-row static">
      <span class="or-emoji">${ic('cash', 18)}</span>
      <div class="or-info"><b>${esc(e.what)}</b><small>${new Date(e.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
      <b class="${e.pay ? 'ok' : 'dim'}">${e.pay ? '+' + money(e.pay) : 'SEVA'}</b></div>`).join('')
    : `<div class="empty"><span>${ic('cash', 40)}</span><b>No trips yet</b><p>Accept a job from the feed to start.</p></div>`}
  <button class="btn-main wide" onclick="withdrawSheet()">Withdraw to bank / UPI</button>`;
});

/* ---------- withdraw earnings (wallet -> bank) ---------- */
function withdrawSheet() {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Withdraw to bank</h3>
    <div class="ck-line"><span>Wallet balance</span><span><b>${money(S.wallet.bal)}</b></span></div>
    <label class="fld"><span>Amount (min ₹100)</span><input class="txt" id="wdAmt" type="number" inputmode="numeric" placeholder="500"/></label>
    <label class="fld"><span>UPI ID</span><input class="txt" id="wdUpi" value="${esc(S.partner.upi || '')}" placeholder="name@bank"/></label>
    <button class="btn-main wide" onclick="doWithdraw()">Withdraw instantly</button>
    <div class="foot-note sm">0 fees · IMPS/UPI payout · lands in your bank in seconds</div>`);
}
function doWithdraw() {
  const amt = parseInt($('#wdAmt').value, 10) || 0;
  const upi = $('#wdUpi').value.trim();
  if (amt < 100) { toast('Minimum withdrawal is ₹100'); return; }
  if (amt > S.wallet.bal) { toast('That is more than your wallet balance'); return; }
  if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) { toast('Enter a valid UPI ID like name@bank'); return; }
  S.partner.upi = upi;
  walletPay(amt, 'Withdrawn to ' + upi);
  closeSheet(); confettiBurst();
  notify('Withdrawal successful', money(amt) + ' sent to ' + upi, 'cash');
  toast(money(amt) + ' sent to ' + upi);
  VIEWS.earnings([]);
}
