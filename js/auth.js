/* ============================================================
   ORIGNALS AUTH (client) — self-hosted, fail-open.
   Email/phone + password today; OTP ready; camera-based face
   enrol + delivery-handover photo capture. If the backend is
   unreachable the app NEVER locks the user out — auth is an
   enhancement layered over the existing device-local mode.
   ============================================================ */

const AUTH_KEY = 'omny_auth';
function authState() { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; } }
function authSave(a) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (e) {} }
function authClear() { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} }
function isAuthed() { const a = authState(); return !!(a && a.token); }

async function authCall(fn, body) {
  if (typeof CLOUD === 'undefined' || !CLOUD.on) return { ok: false, reason: 'offline' };
  try { return await cloudFetch('rpc/' + fn, { method: 'POST', body: JSON.stringify(body) }) || { ok: false }; }
  catch (e) { return { ok: false, reason: 'error' }; }
}

/* boot: silently confirm an existing session; never blocks */
async function authBoot() {
  const a = authState();
  if (!a || !a.token) return;
  const r = await authCall('auth_whoami', { p_token: a.token });
  if (r && r.ok === false && r.reason !== 'offline' && r.reason !== 'error') {
    authClear();   // token genuinely invalid → sign out quietly
  }
}

/* ---------- login / register screen ---------- */
let _authMode = 'login';
view('login', () => {
  const a = authState();
  if (a && a.token) { renderAccountAuthed(); return; }
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('account')">${ic('chevl', 16)}</button>
    <div><h1>${_authMode === 'login' ? 'Sign in' : 'Create account'}</h1><small>Secure your orders, wallet &amp; shop across devices</small></div></div>
  <div class="auth-card">
    <div class="when-seg">
      <button class="${_authMode === 'login' ? 'on' : ''}" onclick="_authMode='login';VIEWS.login([])">Sign in</button>
      <button class="${_authMode === 'register' ? 'on' : ''}" onclick="_authMode='register';VIEWS.login([])">Register</button>
    </div>
    ${_authMode === 'register' ? `<label class="fld"><span>Your name</span><input class="txt" id="auName" placeholder="e.g. Ramesh Kumar" value="${esc(S.user.name && S.user.name !== 'Friend' ? S.user.name : '')}"/></label>` : ''}
    <label class="fld"><span>Email or mobile number</span><input class="txt" id="auId" placeholder="you@email.com or 98765 43210" autocomplete="username"/></label>
    <label class="fld"><span>Password</span><input class="txt" id="auPass" type="password" placeholder="At least 6 characters" autocomplete="${_authMode === 'login' ? 'current-password' : 'new-password'}"/></label>
    <button class="btn-main wide lg" onclick="authSubmit()">${_authMode === 'login' ? 'Sign in' : 'Create my account'}</button>
    <div class="foot-note">${ic('shield', 12)} Your password is hashed on our own servers — never stored in plain text, never shared. Face lock &amp; SMS OTP are available as extra security.</div>
  </div>`;
  setTimeout(() => { const el = $('#auId'); if (el) el.focus(); }, 60);
});

async function authSubmit() {
  const id = ($('#auId') && $('#auId').value.trim()) || '';
  const pass = ($('#auPass') && $('#auPass').value) || '';
  const name = ($('#auName') && $('#auName').value.trim()) || S.user.name || '';
  if (id.length < 5) { toast('Enter your email or 10-digit mobile'); return; }
  if (pass.length < 6) { toast('Password must be at least 6 characters'); return; }
  if (typeof CLOUD === 'undefined' || !CLOUD.on) { toast('Connect to the internet to sign in'); return; }
  toast(_authMode === 'login' ? 'Signing in…' : 'Creating your account…');
  const fn = _authMode === 'login' ? 'auth_login' : 'auth_register';
  const r = await authCall(fn, { p_ident: id, p_pass: pass, p_name: name, p_device: S.deviceKey || '' });
  if (!r.ok) {
    const msg = { exists: 'That account already exists — sign in instead', no_user: 'No account found — register first', wrong_pass: 'Incorrect password', weak_pass: 'Password too short', bad_ident: 'Enter a valid email or mobile', offline: 'No connection' }[r.reason] || 'Could not sign in — try again';
    toast(msg); return;
  }
  const finalize = () => {
    authSave({ token: r.token, ident: r.ident, name: r.name || name, face: !!r.face });
    if (name && (!S.user.name || S.user.name === 'Friend')) { S.user.name = name; save(); }
    confettiBurst();
    toast(_authMode === 'login' ? 'Welcome back!' : 'Account created — you\'re secured');
    refreshChrome && refreshChrome();
    go('account');
  };
  /* password OK — layer any enabled second factors: face, then authenticator */
  const afterFace = () => {
    if (_authMode === 'login' && typeof twofaLoginStep === 'function') twofaLoginStep(r.token, r.ident, finalize);
    else finalize();
  };
  if (_authMode === 'login' && r.face && typeof faceVerifyStep === 'function') {
    toast('Password OK — now confirm your face');
    faceVerifyStep(r.ident, afterFace);
    return;
  }
  afterFace();
}

function authLogout() {
  if (!confirm('Sign out on this device? Your data stays safe in your account.')) return;
  const a = authState();
  authClear();
  toast('Signed out');
  go('account');
}

/* small helper the Account screen calls to show signed-in state */
function renderAccountAuthed() { go('account'); }
function authBadgeHTML() {
  const a = authState();
  if (a && a.token) {
    return `<button class="role-row" onclick="go('facelock')">
      <span>${ic('shield', 20)}</span><div><b>${esc(a.name || a.ident)}</b><small>${ic('check', 10)} Signed in &amp; secured${a.face ? ' · face lock on' : ''}</small></div><em>Manage</em></button>`;
  }
  return `<button class="role-row highlight" onclick="go('login')">
    <span>${ic('shield', 20)}</span><div><b>Sign in / Create account</b><small>Secure your wallet, orders &amp; shop across devices</small></div><em>Go</em></button>`;
}

/* ============================================================
   WEB PUSH (self-hosted) — receive alerts even when app is closed.
   Fully off until you set your own VAPID public key in config.push.
   Sending is done by your own server/edge fn with the private key —
   no third-party push service subscription.
   ============================================================ */
function pushAvailable() {
  const k = ((window.ORIGNALS_CONFIG || {}).push || {}).vapidPublic;
  return !!(k && 'serviceWorker' in navigator && 'PushManager' in window && k.length > 20);
}
function _urlB64ToU8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
async function pushEnable() {
  if (!pushAvailable()) { toast('Alerts will switch on once push is configured'); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Allow notifications to get delivery alerts'); return; }
    const reg = await navigator.serviceWorker.ready;
    const key = ((window.ORIGNALS_CONFIG || {}).push || {}).vapidPublic;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _urlB64ToU8(key) });
    if (typeof CLOUD !== 'undefined' && CLOUD.on) {
      const a = authState();
      await cloudFetch('push_subscriptions?on_conflict=device_key', {
        method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([{ device_key: S.deviceKey, sub, ident: (a && a.ident) || null }])
      }).catch(() => {});
    }
    S.pushOn = true; save();
    toast('Alerts on — you\'ll be notified even when the app is closed');
  } catch (e) { toast('Could not enable alerts on this device'); }
}

/* ============================================================
   CAMERA — face-lock enrol + delivery-handover proof capture.
   Pure browser (getUserMedia). Photos stay on device unless you
   attach them to an order as delivery proof. Fails gracefully if
   no camera / permission denied.
   ============================================================ */
let _camStream = null;
function captureCameraPhoto(title, hint, onCapture) {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${esc(title)}</h3>
    <div class="cam-wrap"><video id="camVideo" autoplay playsinline muted></video>
      <div class="cam-ring"></div></div>
    <div class="foot-note sm">${esc(hint || 'Position the face in the circle and tap capture.')}</div>
    <div class="btn-pair">
      <button class="btn-main ghost" onclick="stopCamera();closeSheet()">Cancel</button>
      <button class="btn-main" id="camShot" onclick="doCapture()">${ic('camera', 15)} Capture</button>
    </div>`);
  window._camCb = onCapture;
  const v = document.getElementById('camVideo');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.querySelector('.cam-wrap').innerHTML = `<div class="cam-fallback">${ic('camera', 30)}<p>No camera on this device.</p></div>`;
    const b = document.getElementById('camShot'); if (b) b.style.display = 'none';
    return;
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 480 }, audio: false })
    .then(stream => { _camStream = stream; if (document.getElementById('camVideo')) v.srcObject = stream; })
    .catch(() => {
      const w = document.querySelector('.cam-wrap');
      if (w) w.innerHTML = `<div class="cam-fallback">${ic('camera', 30)}<p>Camera permission denied. Allow it in your browser to use face verification.</p></div>`;
      const b = document.getElementById('camShot'); if (b) b.style.display = 'none';
    });
}
function doCapture() {
  const v = document.getElementById('camVideo');
  if (!v || !v.videoWidth) { toast('Camera still starting — try again'); return; }
  const s = Math.min(v.videoWidth, v.videoHeight);
  const c = document.createElement('canvas'); c.width = 240; c.height = 240;
  const ctx = c.getContext('2d');
  ctx.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, 240, 240);
  const data = c.toDataURL('image/jpeg', 0.7);
  stopCamera(); closeSheet();
  if (window._camCb) window._camCb(data);
}
function stopCamera() { try { if (_camStream) { _camStream.getTracks().forEach(t => t.stop()); _camStream = null; } } catch (e) {} }

/* ---------- Face lock management ---------- */
view('facelock', () => {
  const a = authState();
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('account')">${ic('chevl', 16)}</button>
    <div><h1>Face lock &amp; security</h1><small>Extra protection — fully on your own device &amp; servers</small></div></div>
  ${a && a.token ? `<div class="card-block"><h3>${ic('check', 14)} Signed in</h3>
    <p class="movie-about">${esc(a.name || a.ident)} — your account is secured with a password on our own servers.</p>
    <button class="btn-main sm ghost red" onclick="authLogout()">Sign out</button></div>` : `
  <div class="card-block"><h3>Sign in first</h3><p class="movie-about">Create a password account to enable face lock.</p>
    <button class="btn-main sm" onclick="go('login')">Sign in / Register</button></div>`}
  <div class="card-block">
    <h3>${ic('camera', 15)} Face lock (real 2FA)</h3>
    <p class="movie-about">Add your face as a genuine second factor. Detection runs in your browser; the match is verified <b>on our own server</b> (distance &lt; 0.55) so it can't be faked. After this, signing in asks for your face too. No third-party face service.</p>
    ${(S.faceRef || (a && a.face)) ? `${S.faceRef ? `<div class="face-preview"><img src="${S.faceRef}" alt="your enrolled face"/><span>${ic('check', 12)} Face enrolled</span></div>` : `<div class="trust-row">${ic('check', 12)} Face enrolled on this account</div>`}
      <button class="btn-main sm ghost" onclick="faceEnrol()">Re-enrol</button>
      <button class="btn-main sm ghost red" onclick="faceRemoveServer()">Remove</button>`
    : `<button class="btn-main sm" ${a && a.token ? `onclick="faceEnrol()"` : `onclick="toast('Sign in first to enable face lock');go('login')"`}>${ic('camera', 14)} Enrol my face</button>`}
  </div>
  <div class="card-block" id="totpCard">
    <h3>${ic('shield', 15)} Authenticator app (2FA)</h3><p class="movie-about">Loading…</p>
  </div>
  <div class="card-block">
    <h3>${ic('bell', 15)} Delivery &amp; order alerts</h3>
    <p class="movie-about">Get notified the moment your order moves — even when the app is closed. Runs on our own push keys, no third-party alert service.</p>
    <button class="btn-main sm ${S.pushOn ? 'ghost' : ''}" onclick="pushEnable()">${S.pushOn ? ic('check', 14) + ' Alerts on — re-check' : ic('bell', 14) + ' Enable alerts'}</button>
    ${!pushAvailable() ? `<div class="foot-note sm" style="text-align:left">Push activates automatically once your VAPID key is set in config — nothing to change in the app.</div>` : ''}
  </div>
  <div class="foot-note">${ic('shield', 12)} Delivery hand-overs can also capture the collector's photo, so even if a friend picks up your parcel, there's a verified record of who took it.</div>`;
  twofaLoad();
});

/* ============================================================
   AUTHENTICATOR-APP 2FA (TOTP) — client. Verified server-side.
   ============================================================ */
const _tfaFld = 'width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;margin:8px 0;font:inherit;letter-spacing:3px;text-align:center;font-size:1.1rem;background:var(--card,#fff);color:inherit';
async function twofaLoad() {
  const box = document.getElementById('totpCard'); if (!box) return;
  const a = authState();
  if (!a || !a.token || typeof CLOUD === 'undefined' || !CLOUD.on) {
    box.innerHTML = `<h3>${ic('shield', 15)} Authenticator app (2FA)</h3><p class="movie-about">Sign in to add an authenticator app (Google Authenticator, Authy, Microsoft Authenticator…) as a code-based second factor.</p>`;
    return;
  }
  const st = await authCall('twofa_status', { p_token: a.token });
  if (st && st.totp) {
    box.innerHTML = `<h3>${ic('check', 15)} Authenticator app — <b class="ok">ON</b></h3>
      <p class="movie-about">A 6-digit code from your authenticator app is required at sign-in. <b>${st.backup_left || 0}</b> backup code${st.backup_left === 1 ? '' : 's'} left for recovery.</p>
      <button class="btn-main sm ghost red" onclick="twofaOff()">Turn off authenticator</button>`;
  } else {
    box.innerHTML = `<h3>${ic('shield', 15)} Authenticator app (2FA)</h3>
      <p class="movie-about">Add Google Authenticator, Authy or any TOTP app as a second factor. Works offline, needs no SMS, and can't be SIM-swapped.</p>
      <button class="btn-main sm" onclick="twofaSetupStart()">${ic('shield', 14)} Set up authenticator</button>`;
  }
}
async function twofaSetupStart() {
  const a = authState(); if (!a || !a.token) { toast('Sign in first'); return; }
  toast('Preparing…');
  const r = await authCall('twofa_totp_setup', { p_token: a.token });
  if (!r || !r.ok) { toast('Could not start setup — try again'); return; }
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Set up authenticator</h3>
    <p class="foot-note sm" style="text-align:left">1. Open your authenticator app.  2. Scan this QR (or type the key).  3. Enter the 6-digit code it shows.</p>
    <div id="totpQR" style="display:flex;justify-content:center;margin:10px 0"></div>
    <div class="ck-line"><span>Manual key</span><b style="letter-spacing:1px;font-family:monospace">${esc(r.secret)}</b></div>
    <input id="totpCode" inputmode="numeric" maxlength="6" placeholder="000000" style="${_tfaFld}"/>
    <button class="btn-main wide" onclick="twofaConfirm()">${ic('check', 14)} Verify &amp; turn on</button>`);
  if (typeof qrRender === 'function') qrRender('totpQR', r.otpauth);
  setTimeout(() => { const e = document.getElementById('totpCode'); if (e) e.focus(); }, 80);
}
async function twofaConfirm() {
  const a = authState(); const code = ((document.getElementById('totpCode') || {}).value || '');
  if (code.replace(/\D/g, '').length < 6) { toast('Enter the 6-digit code from the app'); return; }
  toast('Verifying…');
  const r = await authCall('twofa_totp_enable', { p_token: a.token, p_code: code });
  if (!r || !r.ok) { toast(r && r.reason === 'bad_code' ? 'Code incorrect — enter the current one' : 'Could not enable — try again'); return; }
  const codes = r.backup_codes || [];
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${ic('check', 16)} Authenticator is on</h3>
    <div class="trust-row">${ic('shield', 12)} Save these backup codes somewhere safe. Each one works once if you ever lose your phone.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0;font-family:monospace;font-size:1.05rem">
      ${codes.map(c => `<div style="background:var(--wash,#f4f4f5);padding:10px;border-radius:9px;text-align:center">${esc(c)}</div>`).join('')}</div>
    <button class="btn-main wide" onclick="closeSheet();go('facelock')">I've saved them — Done</button>`);
  confettiBurst();
}
async function twofaOff() {
  if (!confirm('Turn off authenticator 2FA? Your account will then rely on password' + ((authState() || {}).face ? ' + face lock' : '') + '.')) return;
  const a = authState();
  const r = await authCall('twofa_totp_disable', { p_token: a.token });
  if (r && r.ok) { toast('Authenticator turned off'); go('facelock'); } else toast('Could not turn off — try again');
}
/* login-time second factor */
async function twofaLoginStep(token, ident, done) {
  const st = await authCall('twofa_status', { p_token: token });
  if (!st || !st.totp) { done(); return; }
  window._tfaIdent = ident; window._tfaDone = done;
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Two-factor code</h3>
    <p class="foot-note sm" style="text-align:left">Enter the 6-digit code from your authenticator app — or an 8-digit backup code.</p>
    <input id="tfaLogin" inputmode="numeric" placeholder="000000" style="${_tfaFld}"/>
    <button class="btn-main wide" onclick="twofaLoginVerify()">Verify &amp; sign in</button>`);
  setTimeout(() => { const e = document.getElementById('tfaLogin'); if (e) e.focus(); }, 80);
}
async function twofaLoginVerify() {
  const code = ((document.getElementById('tfaLogin') || {}).value || '');
  if (!code.trim()) { toast('Enter your code'); return; }
  toast('Verifying…');
  const r = await authCall('twofa_verify_login', { p_ident: window._tfaIdent, p_code: code });
  if (r && r.ok && !r.reason) { closeSheet(); const d = window._tfaDone; window._tfaDone = null; if (d) d(); }
  else toast('Code incorrect — try again');
}
function enrolFace() {
  captureCameraPhoto('Enrol your face', 'Look straight at the camera in good light.', (data) => {
    S.faceRef = data; save();
    const a = authState();
    if (a && a.token) { authCall('auth_set_face', { p_token: a.token, p_enrolled: true }); a.face = true; authSave(a); }
    confettiBurst(); toast('Face enrolled — 2FA is on');
    go('facelock');
  });
}
function removeFace() {
  S.faceRef = null; save();
  const a = authState(); if (a && a.token) { authCall('auth_set_face', { p_token: a.token, p_enrolled: false }); a.face = false; authSave(a); }
  toast('Face lock removed'); go('facelock');
}
