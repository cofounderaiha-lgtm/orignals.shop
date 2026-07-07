/* ============================================================
   ORIGNALS OPS — launch-day operational safety
   · remote kill switches (maintenance / payments / banner)
   · own error monitoring → error_log (no third-party account)
   · everything degrades safely if the cloud is unreachable
   ============================================================ */

const PLATFORM = { maintenance: false, payments_enabled: true, banner: '' };

/* ---------- boot: pull remote flags, apply kill switches ---------- */
async function opsBoot() {
  if (typeof CLOUD === 'undefined' || !CLOUD.on) return;
  try {
    const rows = await cloudFetch('platform_flags?id=eq.1&select=maintenance,payments_enabled,banner');
    if (rows && rows[0]) {
      PLATFORM.maintenance = !!rows[0].maintenance;
      PLATFORM.payments_enabled = rows[0].payments_enabled !== false;
      PLATFORM.banner = rows[0].banner || '';
      applyPlatformFlags();
    }
  } catch (e) { /* offline → app runs normally on last-known-good */ }
}

function applyPlatformFlags() {
  /* maintenance: freeze the app behind a clear, honest screen */
  let m = document.getElementById('maintScreen');
  if (PLATFORM.maintenance) {
    if (!m) {
      m = document.createElement('div');
      m.id = 'maintScreen';
      m.innerHTML = `<div class="maint-box">
        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#1A5632" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2 19 19M19 5l-2.8 2.8M7.8 16.2 5 19"/></svg>
        <h2>Back in a few minutes</h2>
        <p>Orignals is being upgraded. Your orders, wallet and shop are all safe. Please check again shortly.</p></div>`;
      document.body.appendChild(m);
    }
  } else if (m) { m.remove(); }

  /* banner: a dismissible notice strip under the header */
  const existing = document.getElementById('opsBanner');
  if (PLATFORM.banner && sessionStorage.getItem('ops_banner_seen') !== PLATFORM.banner) {
    if (!existing) {
      const b = document.createElement('div');
      b.id = 'opsBanner'; b.className = 'ops-banner';
      b.innerHTML = `<span>${esc(PLATFORM.banner)}</span>
        <button onclick="sessionStorage.setItem('ops_banner_seen','${esc(PLATFORM.banner).replace(/'/g, '')}');this.parentElement.remove()" aria-label="Dismiss">✕</button>`;
      const frame = document.querySelector('.frame') || document.body;
      frame.insertBefore(b, frame.children[1] || null);
    }
  } else if (existing) { existing.remove(); }
}

function paymentsLive() { return PLATFORM.payments_enabled !== false; }

/* ---------- own error monitoring ---------- */
let _errSent = {}, _errCount = 0;
function opsLogError(message, source, stack) {
  try {
    message = String(message || '').slice(0, 500);
    if (!message || message === 'Script error.') return;
    const sig = message.slice(0, 80);
    if (_errSent[sig] || _errCount > 40) return;   // dedupe + per-session cap
    _errSent[sig] = 1; _errCount++;
    if (typeof CLOUD === 'undefined' || !CLOUD.on) return;
    cloudFetch('error_log', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify([{
        device_key: (typeof S !== 'undefined' && S.deviceKey) ? S.deviceKey : 'anon',
        message, source: String(source || '').slice(0, 200),
        stack: String(stack || '').slice(0, 1200),
        url: location.hash || location.pathname,
        ua: navigator.userAgent.slice(0, 200)
      }])
    }).catch(() => {});
  } catch (e) { /* never let logging throw */ }
}

window.addEventListener('error', e => {
  opsLogError(e.message, (e.filename || '') + ':' + (e.lineno || ''), e.error && e.error.stack);
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason || {};
  opsLogError('Unhandled promise: ' + (r.message || r), 'promise', r.stack);
});

/* ---------- admin: recent errors + flag controls ---------- */
async function opsAdminHTML() {
  if (typeof CLOUD === 'undefined' || !CLOUD.on) {
    return `<div class="ck-line"><span class="dim">Connect cloud to see error monitoring &amp; kill switches.</span><span></span></div>`;
  }
  setTimeout(opsLoadErrors, 60);
  return `
    <div class="ck-line"><span><b>Maintenance mode</b> — freeze the app for all users</span>
      <span><button class="lnk ${PLATFORM.maintenance ? 'red' : ''}" onclick="opsSetFlag('maintenance',${!PLATFORM.maintenance})">${PLATFORM.maintenance ? 'ON — turn off' : 'Off — turn on'}</button></span></div>
    <div class="ck-line"><span><b>Payments</b> — global on/off switch</span>
      <span><button class="lnk ${paymentsLive() ? '' : 'red'}" onclick="opsSetFlag('payments_enabled',${!paymentsLive()})">${paymentsLive() ? 'Live — disable' : 'Disabled — enable'}</button></span></div>
    <div class="ck-line"><span><b>Banner notice</b></span><span><button class="lnk" onclick="opsSetBanner()">${PLATFORM.banner ? 'Edit / clear' : 'Set'}</button></span></div>
    <div class="sec-head"><h2>Recent errors</h2></div>
    <div id="opsErrs"><div class="ck-line"><span class="dim">Loading…</span><span></span></div></div>`;
}
async function opsLoadErrors() {
  const box = document.getElementById('opsErrs'); if (!box) return;
  try {
    const rows = await cloudFetch('rpc/recent_errors', { method: 'POST', body: JSON.stringify({}) });
    box.innerHTML = (rows && rows.length)
      ? rows.map(r => `<div class="ck-line"><span>${esc(String(r.message).slice(0, 60))}<small class="dim"> · ${esc(r.url || '')}</small></span><span class="dim">${new Date(r.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('')
      : `<div class="ck-line"><span class="ok">No errors logged 🎉</span><span></span></div>`;
  } catch (e) { box.innerHTML = `<div class="ck-line"><span class="dim">Could not load errors</span><span></span></div>`; }
}

/* flag writes need elevated rights — admins do it from the Supabase
   dashboard or the ops runner; in-app we guide, we don't fake success */
function opsSetFlag(flag, val) {
  toast('Kill switches are set from the secure ops console — see docs/OPS.md');
}
function opsSetBanner() {
  toast('Banner text is set from the secure ops console — see docs/OPS.md');
}
