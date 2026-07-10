/* ============================================================
   ORIGNALS IN-HOUSE CALL — real voice & video, ZERO phone numbers
   ------------------------------------------------------------
   • Peer-to-peer WebRTC (getUserMedia + RTCPeerConnection).
   • Signaling piggybacks on the ORDER CHAT channel (chat_send/chat_read),
     which the server already restricts to *order participants only*.
     => Only the buyer and the partner CURRENTLY claimed on that order
        (or a support executive added to the order) can ever connect.
        After the order closes, the channel closes with it.
   • No telco, no masked number, no number of any kind is exchanged.
   • For production reliability behind mobile NAT add a TURN server in
     config.js  (window.CONFIG.call.turn = [{urls,username,credential}]).
   ============================================================ */
const CALL_SIG = 'call:';            /* invisible prefix — filtered out of visible chat */
const CALL = { pc: null, oid: null, role: 'buyer', kind: 'audio', local: null, remote: null,
  active: false, seen: new Set(), poll: null, ring: null, incoming: null, t0: 0, tick: null };

function callIce() {
  const base = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  try { const t = (window.CONFIG && CONFIG.call && CONFIG.call.turn) || []; return base.concat(t); } catch (e) { return base; }
}
function callSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection && typeof cloudChatSend === 'function' && CLOUD.on);
}

/* ---- signaling over the authenticated order-chat channel ---- */
function callSig(obj) { obj.d = S.deviceKey || 'anon'; return cloudChatSend(CALL.oid, CALL.role, CALL_SIG + JSON.stringify(obj)); }
async function callPollLoop() {
  if (!CALL.oid) return;
  const rows = await cloudChatRead(CALL.oid).catch(() => []);
  for (const m of rows || []) {
    if (!m.msg || m.msg.indexOf(CALL_SIG) !== 0) continue;
    if (m.from_device === (S.deviceKey || 'anon')) continue;   /* ignore my own */
    const key = (m.created_at || '') + '|' + m.msg;
    if (CALL.seen.has(key)) continue; CALL.seen.add(key);
    let o; try { o = JSON.parse(m.msg.slice(CALL_SIG.length)); } catch (e) { continue; }
    await callOnSignal(o);
  }
}
function callStartPoll(fast) {
  clearInterval(CALL.poll);
  CALL.poll = setInterval(callPollLoop, fast ? 1000 : 2500);
  callPollLoop();
}

/* ---- the phone/video button rendered on the track & job screens ---- */
function callControls(oid, role) {
  if (!callSupported()) return '';
  return `<div class="call-ctrls">
    <button class="call-btn voice" onclick="callDial('${oid}','${role || 'buyer'}','audio')" title="Voice call — in-app, no number">${ic('phone', 17)}</button>
    <button class="call-btn video" onclick="callDial('${oid}','${role || 'buyer'}','video')" title="Video call — in-app, no number">${ic('camera', 17)}</button>
  </div>`;
}

/* ---- OUTGOING ---- */
async function callDial(oid, role, kind) {
  if (!callSupported()) { toast('In-app calling needs camera/mic permission on a secure (https) connection'); return; }
  if (CALL.active) { toast('Already on a call'); return; }
  CALL.oid = oid; CALL.role = role; CALL.kind = kind; CALL.seen = new Set();
  try { CALL.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' }); }
  catch (e) { toast('Allow microphone' + (kind === 'video' ? ' & camera' : '') + ' to call'); return; }
  callUI('calling');
  callNewPeer();
  CALL.local.getTracks().forEach(t => CALL.pc.addTrack(t, CALL.local));
  const offer = await CALL.pc.createOffer(); await CALL.pc.setLocalDescription(offer);
  await callSig({ t: 'ring', kind });
  await callSig({ t: 'offer', kind, sdp: offer.sdp });
  callStartPoll(true);
  CALL.ring = setTimeout(() => { if (!CALL.active) { toast('No answer'); callHangup(true); } }, 45000);
}

/* ---- INCOMING (detected by the passive watcher on track/job screens) ---- */
async function callOnSignal(o) {
  if (o.t === 'ring' && !CALL.active && !CALL.pc) { callIncomingPrompt(o); return; }
  if (o.t === 'offer') {
    if (!CALL.pc) callNewPeer();
    await CALL.pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
    CALL.kind = o.kind || 'audio';
    if (!CALL.local) {
      try { CALL.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: CALL.kind === 'video' }); }
      catch (e) { toast('Allow mic to answer'); return; }
      CALL.local.getTracks().forEach(t => CALL.pc.addTrack(t, CALL.local));
      callUI('in');
    }
    const ans = await CALL.pc.createAnswer(); await CALL.pc.setLocalDescription(ans);
    await callSig({ t: 'answer', sdp: ans.sdp });
  } else if (o.t === 'answer') {
    if (CALL.pc && !CALL.pc.currentRemoteDescription) await CALL.pc.setRemoteDescription({ type: 'answer', sdp: o.sdp });
  } else if (o.t === 'ice' && o.cand) {
    try { if (CALL.pc) await CALL.pc.addIceCandidate(o.cand); } catch (e) {}
  } else if (o.t === 'end') { callHangup(true); }
}
function callIncomingPrompt(o) {
  CALL.incoming = o; CALL.kind = o.kind || 'audio';
  callUI('incoming');
  if (CALL.ring) clearTimeout(CALL.ring);
  CALL.ring = setTimeout(() => { if (!CALL.active) callDecline(); }, 40000);
}
async function callAccept() {
  callStartPoll(true);
  callUI('in');            /* the offer already queued will be answered by callOnSignal */
}
function callDecline() { callSig({ t: 'end' }); callHangup(true); }

/* ---- watcher: lets a screen receive incoming calls without dialing ---- */
function callWatch(oid, role) {
  if (!callSupported()) return;
  if (CALL.active) return;
  CALL.oid = oid; CALL.role = role || 'buyer'; CALL.seen = CALL.seen || new Set();
  callStartPoll(false);
}
function callUnwatch() { if (!CALL.active) { clearInterval(CALL.poll); CALL.poll = null; } }

/* ---- peer plumbing ---- */
function callNewPeer() {
  const pc = new RTCPeerConnection({ iceServers: callIce() });
  pc.onicecandidate = e => { if (e.candidate) callSig({ t: 'ice', cand: e.candidate }); };
  pc.ontrack = e => {
    CALL.remote = e.streams[0];
    const v = document.getElementById('callRemote'); if (v) { v.srcObject = CALL.remote; v.play && v.play().catch(() => {}); }
    if (!CALL.active) { CALL.active = true; CALL.t0 = Date.now(); callUI('in'); callTimer(); }
  };
  pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) callHangup(true); };
  CALL.pc = pc;
}
function callTimer() {
  clearInterval(CALL.tick);
  CALL.tick = setInterval(() => {
    const el = document.getElementById('callTime'); if (!el) return;
    const s = Math.floor((Date.now() - CALL.t0) / 1000);
    el.textContent = String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 1000);
}
function callHangup(silent) {
  if (!silent && CALL.oid) callSig({ t: 'end' });
  try { CALL.pc && CALL.pc.close(); } catch (e) {}
  try { CALL.local && CALL.local.getTracks().forEach(t => t.stop()); } catch (e) {}
  clearTimeout(CALL.ring); clearInterval(CALL.tick);
  CALL.pc = null; CALL.local = null; CALL.remote = null; CALL.active = false; CALL.incoming = null;
  const el = document.getElementById('callOverlay'); if (el) el.remove();
  clearInterval(CALL.poll); CALL.poll = null;
}
function callMute() {
  if (!CALL.local) return;
  const a = CALL.local.getAudioTracks()[0]; if (!a) return; a.enabled = !a.enabled;
  const b = document.getElementById('callMute'); if (b) b.classList.toggle('off', !a.enabled);
}
function callCam() {
  if (!CALL.local) return;
  const v = CALL.local.getVideoTracks()[0]; if (!v) return; v.enabled = !v.enabled;
  const b = document.getElementById('callCam'); if (b) b.classList.toggle('off', !v.enabled);
}

/* ---- full-screen call overlay UI ---- */
function callUI(phase) {
  let el = document.getElementById('callOverlay');
  if (!el) { el = document.createElement('div'); el.id = 'callOverlay'; el.className = 'call-overlay'; document.body.appendChild(el); }
  const o = S.orders && S.orders.find(x => x.id === CALL.oid);
  const who = (o && o.realPartner && o.realPartner.taken_name) || (o && o.partner && o.partner.name) ||
    (CALL.role === 'partner' ? 'Customer' : 'Delivery partner');
  const vid = CALL.kind === 'video';
  const status = phase === 'calling' ? 'Ringing…' : phase === 'incoming' ? (vid ? 'Incoming video call' : 'Incoming call')
    : phase === 'in' && !CALL.active ? 'Connecting…' : '<span id="callTime">00:00</span>';
  el.innerHTML = `
    <div class="call-stage ${vid ? 'video' : 'audio'}">
      ${vid ? `<video id="callRemote" class="call-remote" autoplay playsinline></video>
               <video id="callLocal" class="call-local" autoplay playsinline muted></video>` : `
      <audio id="callRemote" autoplay></audio>
      <div class="call-avatar">${ic('spark', 40)}</div>`}
      <div class="call-head">
        <b>${esc(who)}</b>
        <small>${status} · ${ic('shield', 11)} in-app · no number shared</small>
      </div>
      <div class="call-actions">
        ${phase === 'incoming' ? `
          <button class="call-round decline" onclick="callDecline()">${ic('phone', 22)}</button>
          <button class="call-round accept" onclick="callAccept()">${ic('phone', 22)}</button>` : `
          <button class="call-round" id="callMute" onclick="callMute()" title="Mute">${ic('mic', 20)}</button>
          ${vid ? `<button class="call-round" id="callCam" onclick="callCam()" title="Camera">${ic('camera', 20)}</button>` : ''}
          <button class="call-round decline" onclick="callHangup()" title="End">${ic('phone', 22)}</button>`}
      </div>
    </div>`;
  if (vid) { const lv = document.getElementById('callLocal'); if (lv && CALL.local) lv.srcObject = CALL.local; }
  const rv = document.getElementById('callRemote'); if (rv && CALL.remote) { rv.srcObject = CALL.remote; rv.play && rv.play().catch(() => {}); }
}
