/* ============================================================
   ORIGNALS FACE 2FA (client) — ported from edurankai
   face-2fa-portable. Loads @vladmandic/face-api lazily (only when a
   face feature is used), captures a 128-float descriptor in-browser,
   and sends it to our OWN server RPCs where the distance match is
   enforced (0.55). Self-hosted models supported via config.face.
   Fails gracefully: no camera / no face / lib blocked → clear message.
   ============================================================ */

let _faceLoad = null;
function faceEnsure() {
  if (_faceLoad) return _faceLoad;
  const cfg = (window.ORIGNALS_CONFIG || {}).face || {};
  const LIB = cfg.lib || 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.min.js';
  const MODELS = cfg.models || 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
  _faceLoad = new Promise((resolve, reject) => {
    if (window.faceapi) return resolve(MODELS);
    const s = document.createElement('script');
    s.src = LIB; s.async = true;
    s.onload = () => resolve(MODELS);
    s.onerror = () => { _faceLoad = null; reject(new Error('face-api failed to load')); };
    document.head.appendChild(s);
  }).then(async (models) => {
    const f = window.faceapi;
    try {
      if (f.tf) {
        try { await f.tf.setBackend('webgl'); } catch (e) {}
        if (f.tf.getBackend && !f.tf.getBackend()) { try { await f.tf.setBackend('wasm'); } catch (e) {} }
        if (f.tf.ready) await f.tf.ready();
      }
    } catch (e) {}
    await Promise.all([
      f.nets.tinyFaceDetector.loadFromUri(models),
      f.nets.faceLandmark68TinyNet.loadFromUri(models),
      f.nets.faceRecognitionNet.loadFromUri(models)
    ]);
    return true;
  });
  return _faceLoad;
}

/* open the camera, load the model, capture ONE good descriptor.
   onDone({ descriptor:number[128], thumb:dataURL }) or onFail(reason). */
function faceScan(title, hint, onDone) {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">${esc(title)}</h3>
    <div class="cam-wrap"><video id="fcVideo" autoplay playsinline muted></video><div class="cam-ring"></div></div>
    <div class="foot-note sm" id="fcStatus">Loading face model… (first time ~5–15s)</div>
    <button class="btn-main ghost wide" onclick="faceStop();closeSheet()">Cancel</button>`);
  window._faceDone = onDone;
  const setStatus = (m, cls) => { const s = document.getElementById('fcStatus'); if (s) { s.textContent = m; s.className = 'foot-note sm' + (cls ? ' ' + cls : ''); } };
  const v = document.getElementById('fcVideo');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.querySelector('.cam-wrap').innerHTML = `<div class="cam-fallback">${ic('camera', 30)}<p>No camera on this device.</p></div>`;
    setStatus('Face verification needs a camera.', 'bad'); return;
  }
  let cancelled = false; window._faceCancel = () => { cancelled = true; };
  Promise.all([
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480 }, audio: false })
      .then(st => { _faceStream = st; if (document.getElementById('fcVideo')) v.srcObject = st; }),
    faceEnsure()
  ]).then(() => {
    if (cancelled) return;
    setStatus('Look straight at the camera…');
    let tries = 0;
    const loop = async () => {
      if (cancelled || !document.getElementById('fcVideo')) return;
      tries++;
      try {
        const f = window.faceapi;
        const opts = new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
        const det = await f.detectSingleFace(v, opts).withFaceLandmarks(true).withFaceDescriptor();
        if (det && det.descriptor) {
          const s = Math.min(v.videoWidth, v.videoHeight);
          const c = document.createElement('canvas'); c.width = 200; c.height = 200;
          c.getContext('2d').drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, 200, 200);
          faceStop(); closeSheet();
          if (window._faceDone) window._faceDone({ descriptor: Array.from(det.descriptor).map(x => +x.toFixed(5)), thumb: c.toDataURL('image/jpeg', 0.7) });
          return;
        }
      } catch (e) {}
      if (tries >= 40) { setStatus('Could not find a face clearly. Cancel and try again in better light.', 'bad'); return; }
      setTimeout(loop, 500);
    };
    loop();
  }).catch(() => {
    setStatus('Face model could not load — check your connection.', 'bad');
    const w = document.querySelector('.cam-wrap');
    if (w) w.innerHTML = `<div class="cam-fallback">${ic('shield', 30)}<p>Face verification unavailable right now.</p></div>`;
  });
}
let _faceStream = null;
function faceStop() { try { if (window._faceCancel) window._faceCancel(); if (_faceStream) { _faceStream.getTracks().forEach(t => t.stop()); _faceStream = null; } } catch (e) {} }

/* ---------- enrol (bind your face to the account) ---------- */
function faceEnrol() {
  const a = (typeof authState === 'function') ? authState() : null;
  if (!a || !a.token) { toast('Sign in first to enable face lock'); go('login'); return; }
  faceScan('Enrol your face', '', async (res) => {
    toast('Saving your face…');
    const r = await authCall('face_enroll', { p_token: a.token, p_descriptor: res.descriptor });
    if (r && r.ok) {
      S.faceRef = res.thumb; save();
      a.face = true; authSave(a);
      confettiBurst(); toast('Face lock on — real 2FA enabled');
      go('facelock');
    } else {
      toast(r && r.reason === 'bad_descriptor' ? 'Face not clear — try again' : 'Could not save — try again');
    }
  });
}
async function faceRemoveServer() {
  const a = (typeof authState === 'function') ? authState() : null;
  if (a && a.token) await authCall('face_remove', { p_token: a.token });
  S.faceRef = null; save();
  if (a) { a.face = false; authSave(a); }
  toast('Face lock removed'); go('facelock');
}

/* ---------- verify (2nd factor at login) ---------- */
function faceVerifyStep(ident, onPass) {
  faceScan('Face check', 'Confirm it\'s you.', async (res) => {
    toast('Checking…');
    const r = await authCall('face_verify', { p_ident: ident, p_descriptor: res.descriptor });
    if (r && r.ok) { onPass(); }
    else if (r && r.reason === 'not_enrolled') { onPass(); }   // nothing to check against
    else { toast('Face not recognised' + (r && r.distance ? ' (' + r.distance + ')' : '') + ' — try again'); }
  });
}
