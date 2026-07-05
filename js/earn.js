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
  if (!S.partner) { renderEarnPitch(); return; }
  if (S.partner.status === 'verifying') { renderVerifying(); return; }
  if (S.activeJob) { renderActiveJob(); return; }
  renderJobFeed();
});

/* ---------- pitch + registration ---------- */
function renderEarnPitch() {
  $('#view').innerHTML = `
  <div class="earn-hero">
    <span class="earn-big">${ic('users', 54)}</span>
    <h1>Passing by anyway?<br/><span>Get paid for it.</span></h1>
    <p>Carry a person like a taxi — solo or shared. Carry a tiffin, medicines, a parcel on the same pathway. End to end, one trip, multiple earnings. Or deliver free as seva — your choice.</p>
    <div class="earn-stats">
      <div><b>₹120–450</b><small>avg per day, part-time</small></div>
      <div><b>Walk to truck</b><small>every vehicle counts</small></div>
      <div><b>1–10 CHF/yr</b><small>by vehicle · first month free</small></div>
    </div>
    <button class="btn-main wide lg" onclick="startPartnerReg()">Register &amp; verify — 2 minutes</button>
    <div class="foot-note">${ic('shield', 12)} Face + vehicle verified by computer vision. Safety first, always.</div>
  </div>
  <div class="how-grid">
    <div class="how"><span>${ic('camera', 22)}</span><b>CV-verified identity</b><p>Live face scan matched to your govt ID by high-precision computer vision. The vehicle's plate &amp; model are scanned and verified too.</p></div>
    <div class="how"><span>${ic('pin', 22)}</span><b>Jobs on your path</b><p>Going somewhere? Rides and parcels along the same route stack into one trip — more earnings per kilometre.</p></div>
    <div class="how"><span>${ic('cash', 22)}</span><b>Instant money</b><p>OTP handover, live GPS trace, money in your wallet the second you deliver. Cash out anytime.</p></div>
    <div class="how"><span>${ic('gift', 22)}</span><b>Seva mode</b><p>Want to help a neighbour free? Toggle seva — deliver at zero charge and earn community karma instead.</p></div>
  </div>`;
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
        <div><b>${ic(d[2], 15)} ${d[1]}</b><small>${REG.docs[d[0]] ? 'Captured & verified ✓ (demo)' : 'Tap to scan'}</small></div>
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
    <p>Computer vision is matching your live face scan with your ID${['bike','auto','car','van','truck'].includes(S.partner.veh) ? ', and your vehicle plate with its registration' : ''}. Under a minute in this demo.</p>
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

function renderJobFeed() {
  const v = DB.vehicles.find(x => x.id === S.partner.veh);
  const jobs = availableJobs();
  const waiting = jobs.reduce((a, j) => a + j.pay, 0);
  const seva = window._sevaMode;

  $('#view').innerHTML = `
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

  <div class="sec-head"><h2>On your way <span class="live-dot"></span></h2><small>rides + parcels, same pathway</small></div>
  ${jobs.length ? jobs.map(j => `
    <div class="job-card">
      <div class="job-top"><span class="job-emoji">${jobIcon(j.type)}</span>
        <div><b>${esc(j.what)}</b><small>by ${esc(j.by)}${j.type === 'ride' ? ' · end-to-end or shared' : ''}</small></div>
        <em class="job-pay">${seva ? 'SEVA' : '+' + money(j.pay)}</em></div>
      <div class="job-route"><i class="pin g"></i>${esc(j.from)}<span class="job-arrow">${ic('arrowr', 11)}</span><i class="pin r"></i>${esc(j.to)}<b>· ${j.km} km</b></div>
      ${j.note ? `<div class="job-note">${esc(j.note)}</div>` : ''}
      <button class="btn-main wide sm" onclick="acceptJob('${j.id}',${seva ? 'true' : 'false'})">${seva ? 'Accept as seva (free)' : 'Accept · earn ' + money(j.pay)}</button>
    </div>`).join('')
  : `<div class="empty"><span>${ic('clock', 40)}</span><b>All demo jobs done — legend!</b>
      <p>New rides &amp; parcels appear as neighbours and shops post them.</p>
      <button class="btn-main" onclick="S.earnings=S.earnings.map(e=>({...e,jobId:'used_'+e.jobId}));save();VIEWS.earn([])">Refresh demo jobs</button></div>`}
  <div class="foot-note">${ic('shield', 12)} OTP both ends · GPS trace · insurance on every trip · money lands instantly</div>`;
}

function acceptJob(jobId, seva) {
  const j = allJobs().find(x => x.id === jobId); if (!j) return;
  S.activeJob = { jobId, stage: 0, seva: !!seva, otpPick: rnd(1000, 9999), otpDrop: rnd(1000, 9999), acceptedAt: Date.now() };
  save(); toast(seva ? 'Seva accepted — you are gold' : 'Job accepted — head to pickup');
  renderActiveJob();
}

/* ---------- active job ---------- */
function renderActiveJob() {
  const A = S.activeJob;
  const j = allJobs().find(x => x.id === A.jobId);
  const steps = ['Head to pickup', j.type === 'ride' ? 'Start ride with OTP' : 'Collect with OTP', j.type === 'ride' ? 'End ride with OTP' : 'Deliver with OTP'];
  const prog = A.stage / 2;

  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="dropJobConfirm()">${ic('x', 16)}</button>
    <div><h1>${steps[A.stage]}</h1><small>${esc(j.what)} · ${A.seva ? 'SEVA — free delivery' : '+' + money(j.pay)}</small></div></div>

  <div class="track-map">
    <svg viewBox="0 0 400 190">
      ${[0,1,2,3,4,5].map(i => `<line x1="${i*80}" y1="0" x2="${i*80}" y2="190" class="grid"/>`).join('')}
      <path d="M40 150 C 120 150, 130 45, 210 45 S 330 110, 360 60" class="route-bg"/>
      <path d="M40 150 C 120 150, 130 45, 210 45 S 330 110, 360 60" class="route" style="stroke-dasharray:420;stroke-dashoffset:${420 - 420 * prog}"/>
      <circle cx="40" cy="150" r="7" fill="#1A5632"/><text x="40" y="175" class="map-lbl">Pickup</text>
      <circle cx="360" cy="60" r="7" fill="#C84B31"/><text x="360" y="40" class="map-lbl">Drop</text>
      <g style="offset-path:path('M40 150 C 120 150, 130 45, 210 45 S 330 110, 360 60');offset-distance:${prog * 100}%" class="mover">
        <circle r="12" fill="#1A5632"/>${icNested(VEH_ICON[S.partner.veh] || 'bike', 13)}</g>
    </svg>
  </div>

  <div class="job-card active">
    <div class="job-route"><i class="pin g"></i>${esc(j.from)}<span class="job-arrow">${ic('arrowr', 11)}</span><i class="pin r"></i>${esc(j.to)}<b>· ${j.km} km</b></div>
    ${j.note ? `<div class="job-note">${esc(j.note)}</div>` : ''}
    <div class="otp-strip">${A.stage === 1 ? `${j.type === 'ride' ? 'Rider' : 'Sender'}'s OTP → <b>${A.otpPick}</b> · faces already CV-matched` : A.stage === 2 ? `${j.type === 'ride' ? 'Drop' : 'Receiver'}'s OTP → <b>${A.otpDrop}</b>` : `Contact ${esc(j.by.split(' ·')[0])} if you can't find the pickup`}</div>
  </div>

  <div class="wiz-dots">${[0, 1, 2].map(i => `<i class="${i <= A.stage ? 'on' : ''}"></i>`).join('')}</div>
  ${A.stage === 0 ? `<button class="btn-main wide lg" onclick="S.activeJob.stage=1;save();renderActiveJob()">${ic('pin', 15)} I've reached the pickup</button>` : ''}
  ${A.stage === 1 ? `<button class="btn-main wide lg" onclick="S.activeJob.stage=2;save();toast('On the way — ride safe!');renderActiveJob()">${ic('check', 15)} OTP matched — ${j.type === 'ride' ? 'ride started' : 'collected'}</button>` : ''}
  ${A.stage === 2 ? `<button class="btn-main wide lg" onclick="completeJob()">${ic('flag', 15)} OTP matched — ${j.type === 'ride' ? 'ride complete' : 'delivered'}</button>` : ''}`;
}

function dropJobConfirm() {
  if (confirm('Drop this job? It goes back to the feed for other partners.')) {
    S.activeJob = null; save(); VIEWS.earn([]);
  }
}
function completeJob() {
  const A = S.activeJob;
  const j = allJobs().find(x => x.id === A.jobId);
  const pay = A.seva ? 0 : j.pay;
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
  <button class="btn-main wide ghost" onclick="toast('Cash-out to ${esc(S.partner.upi)} requested (demo)')">Cash out to UPI</button>`;
});
