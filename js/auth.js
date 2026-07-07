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
  authSave({ token: r.token, ident: r.ident, name: r.name || name, face: !!r.face });
  if (name && (!S.user.name || S.user.name === 'Friend')) { S.user.name = name; save(); }
  confettiBurst();
  toast(_authMode === 'login' ? 'Welcome back!' : 'Account created — you\'re secured');
  refreshChrome && refreshChrome();
  go('account');
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
    <h3>${ic('camera', 15)} Face lock (2FA)</h3>
    <p class="movie-about">Add your face as a second factor. Your photo is captured on-device; enabling this asks for a face check on sensitive actions. No third-party face service — it stays yours.</p>
    ${S.faceRef ? `<div class="face-preview"><img src="${S.faceRef}" alt="your enrolled face"/><span>${ic('check', 12)} Face enrolled</span></div>
      <button class="btn-main sm ghost" onclick="enrolFace()">Re-capture</button>
      <button class="btn-main sm ghost red" onclick="removeFace()">Remove</button>`
    : `<button class="btn-main sm" onclick="enrolFace()">${ic('camera', 14)} Enrol my face</button>`}
  </div>
  <div class="foot-note">${ic('shield', 12)} Delivery hand-overs can also capture the collector's photo, so even if a friend picks up your parcel, there's a verified record of who took it.</div>`;
});
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
