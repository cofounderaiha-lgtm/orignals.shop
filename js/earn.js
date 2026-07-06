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
  const teaser = [...allJobs()].sort((a, b) => b.pay / b.km - a.pay / a.km).slice(0, 5);
  const total = teaser.reduce((a, j) => a + j.pay, 0);
  $('#view').innerHTML = `
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
    <div>"I drop 2 tiffins on my way to college. Petrol paid, plus ₹1,800 a month extra."<small>— Ravi K. · cycle partner · 4,820 trips · ★ 4.9</small></div>
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
    <div class="foot-note sm">0 fees · arrives in seconds (demo: deducted from wallet)</div>`);
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
