/* ============================================================
   SERVICES MARKETPLACE — verified professionals across all three
   sectors. Individuals, teams & organisations offer services;
   expertise is verified before listing; buyers enquire in-app.
   ============================================================ */
const SVC_SECTORS = [['', 'All'], ['primary', 'Primary'], ['secondary', 'Secondary'], ['tertiary', 'Tertiary']];
const SVC_CATS = ['Tuition', 'Healthcare', 'Physio', 'Plumbing', 'Electrical', 'Carpentry', 'Painting', 'Cleaning', 'Accounting & Tax', 'Legal', 'Design', 'Web & IT', 'Photography', 'Beauty & Salon', 'Agriculture', 'Construction', 'Repair', 'Catering', 'Consulting', 'Other'];
let _SVC = { sector: '', cat: '', q: '' };

function svcApi(fn, body) {
  if (typeof CLOUD === 'undefined' || !CLOUD.on) return Promise.resolve(null);
  return cloudFetch('rpc/' + fn, { method: 'POST', body: JSON.stringify(body || {}) }).catch(() => null);
}
function svcKindLabel(k) { return k === 'organisation' ? 'Organisation' : k === 'team' ? 'Team' : 'Individual'; }

view('services', () => {
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
    <div><h1>Services</h1><small>Verified professionals — tuition to construction</small></div></div>
  <div class="tip-strip">${ic('shield', 13)} Every provider proves their expertise before being listed. Enquire in-app — no numbers shared until you both agree.</div>
  <div class="chip-row">${SVC_SECTORS.map(s => `<button class="chip ${_SVC.sector === s[0] ? 'on' : ''}" onclick="svcSetSector('${s[0]}')">${s[1]}</button>`).join('')}</div>
  <div class="chip-row">${['', ...SVC_CATS].map(c => `<button class="chip ${_SVC.cat === c ? 'on' : ''}" onclick="_SVC.cat='${c}';svcLoad()">${c || 'All categories'}</button>`).join('')}</div>
  <div class="dir-grid" style="margin:6px 0 2px">
    <button class="svc" onclick="svcRegister()"><span class="svc-ic">${ic('user', 20)}</span><b>Offer your services</b><small>Get expertise-verified &amp; onboarded</small></button>
    <button class="svc" onclick="svcMine()"><span class="svc-ic">${ic('shield', 20)}</span><b>My services</b><small>Status &amp; enquiries</small></button>
  </div>
  <div id="svcList"><div class="empty sm"><span>${ic('user', 24)}</span><b>Loading professionals…</b></div></div>`;
  svcLoad();
});
function svcSetSector(s) { _SVC.sector = s; svcLoad(); go('services'); }

async function svcLoad() {
  const box = document.getElementById('svcList'); if (!box) return;
  if (typeof CLOUD === 'undefined' || !CLOUD.on) { box.innerHTML = `<div class="empty sm"><span>${ic('user', 26)}</span><b>Connect to see verified providers</b></div>`; return; }
  const r = await svcApi('service_list', { p_sector: _SVC.sector, p_category: _SVC.cat, p_q: _SVC.q });
  const list = Array.isArray(r) ? r : [];
  box.innerHTML = list.length ? list.map(svcCard).join('')
    : `<div class="empty"><span>${ic('user', 40)}</span><b>No verified ${esc(_SVC.cat || '')} providers here yet</b><p>Try another category — or offer your own service above.</p></div>`;
}
function svcCard(p) {
  return `<div class="job-card" onclick="svcSheet(${p.id})">
    <div class="job-top"><span class="job-emoji">${ic('user', 20)}</span>
      <div><b>${esc(p.name)} <small class="ok">${ic('check', 10)} Verified</small></b>
        <small>${esc(p.category)} · ${svcKindLabel(p.kind)} · ★ ${(+p.rating || 0).toFixed(1)} · ${p.jobs || 0} jobs</small>
        <small class="dim">${esc(p.headline || '')}${p.area ? ' · ' + esc(p.area) : ''}</small></div>
      <em class="job-pay">${money(p.rate || 0)}<small>/${esc(p.rate_unit || 'hour')}</small></em></div>
  </div>`;
}
async function svcSheet(id) {
  const r = await svcApi('service_list', { p_sector: '', p_category: '', p_q: '' });
  const p = (Array.isArray(r) ? r : []).find(x => x.id === id);
  if (!p) { toast('Provider not found'); return; }
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${esc(p.name)}</h3>
    <div class="trust-row">${ic('check', 12)} Expertise verified · ${svcKindLabel(p.kind)} · ${esc(p.sector || '')} sector</div>
    <p class="movie-about">${esc(p.headline || '')}${p.about ? '<br/>' + esc(p.about) : ''}<br/>${esc(p.category)} · ★ ${(+p.rating || 0).toFixed(1)} · ${p.jobs || 0} jobs${p.area ? ' · ' + esc(p.area) : ''}<br/>From <b>${money(p.rate || 0)}</b>/${esc(p.rate_unit || 'hour')}.</p>
    <input id="svcNeed" placeholder="What do you need? e.g. weekly Physics, Class 10" style="${svcFld}"/>
    <input id="svcWhen" placeholder="When? e.g. weekday evenings" style="${svcFld}"/>
    <button class="btn-main wide" onclick="svcEnquire(${p.id})">${ic('spark', 14)} Send enquiry — no numbers shared</button>`);
}
async function svcEnquire(id) {
  const need = (document.getElementById('svcNeed') || {}).value || '';
  const when = (document.getElementById('svcWhen') || {}).value || '';
  const r = await svcApi('service_enquire', { p_provider: id, p_device: S.deviceKey || 'anon', p_need: need, p_when: when });
  if (r && r.ok) { closeSheet(); confettiBurst(); toast('Enquiry sent — they will reply in-app'); }
  else toast('Could not send — try again');
}
const svcFld = 'width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:12px;margin:6px 0;font:inherit;background:var(--card,#fff);color:inherit';

function svcRegister() {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Offer your services</h3>
    <div class="trust-row">${ic('shield', 12)} You'll be listed only after our team verifies your expertise. Individuals, teams & organisations all welcome.</div>
    <input id="spName" placeholder="Your / your team's name" style="${svcFld}"/>
    <select id="spKind" style="${svcFld}"><option value="individual">Individual / freelancer</option><option value="team">Team</option><option value="organisation">Organisation</option></select>
    <select id="spSector" style="${svcFld}"><option value="tertiary">Tertiary (services)</option><option value="secondary">Secondary (trades/manufacturing)</option><option value="primary">Primary (farming/raw)</option></select>
    <input id="spCat" placeholder="Category — e.g. Tuition, Plumbing, Design" style="${svcFld}"/>
    <input id="spHead" placeholder="One-line headline" style="${svcFld}"/>
    <textarea id="spAbout" placeholder="About your service" style="${svcFld};min-height:60px"></textarea>
    <textarea id="spCreds" placeholder="Your expertise / proof — degrees, licences, experience, portfolio links" style="${svcFld};min-height:60px"></textarea>
    <input id="spArea" placeholder="Area you serve — e.g. City-wide" style="${svcFld}"/>
    <div style="display:flex;gap:8px"><input id="spRate" type="number" inputmode="numeric" placeholder="Rate ₹" style="${svcFld}"/>
      <select id="spUnit" style="${svcFld}"><option value="hour">/hour</option><option value="visit">/visit</option><option value="day">/day</option><option value="month">/month</option><option value="project">/project</option></select></div>
    <button class="btn-main wide" onclick="svcSubmit()">${ic('check', 14)} Submit for verification</button>`);
}
async function svcSubmit() {
  const g = id => (document.getElementById(id) || {}).value || '';
  if (g('spName').trim().length < 2 || g('spCat').trim().length < 2) { toast('Name and category are required'); return; }
  if (g('spCreds').trim().length < 5) { toast('Describe your expertise so we can verify it'); return; }
  const r = await svcApi('service_register', {
    p_device: S.deviceKey || 'anon', p_ident: (typeof authState === 'function' && authState()) ? authState().ident : '',
    p_name: g('spName'), p_kind: g('spKind'), p_sector: g('spSector'), p_category: g('spCat'),
    p_headline: g('spHead'), p_about: g('spAbout'), p_credentials: g('spCreds'), p_area: g('spArea'),
    p_rate: Number(g('spRate') || 0), p_rate_unit: g('spUnit')
  });
  if (r && r.ok) { closeSheet(); confettiBurst(); notify('Application received', g('spName') + ' — our team will verify your expertise and list you.'); toast('Submitted — pending verification'); }
  else toast(r && r.reason === 'need_name_category' ? 'Name & category required' : 'Could not submit');
}
async function svcMine() {
  const r = await svcApi('service_mine', { p_device: S.deviceKey || 'anon' });
  const list = Array.isArray(r) ? r : [];
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">My services</h3>
    ${list.length ? list.map(p => `<div class="ck-line"><span>${ic('user', 12)} <b>${esc(p.name)}</b> · ${esc(p.category)}</span>
      <span><b class="${p.status === 'verified' ? 'ok' : p.status === 'rejected' ? 'red' : ''}">${esc(p.status)}</b></span></div>`).join('')
      : `<div class="empty sm"><span>${ic('user', 26)}</span><b>You haven't listed a service yet</b></div>`}
    <button class="btn-main wide ghost" onclick="closeSheet();svcRegister()">${ic('user', 13)} Offer a service</button>`);
}
