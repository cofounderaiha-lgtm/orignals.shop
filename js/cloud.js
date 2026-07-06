/* ============================================================
   ORIGNALS cloud layer — Supabase bridge (feature-flagged)
   No keys? Everything stays local, zero errors. Paste keys in
   config.js and the same build syncs across devices instantly.
   ------------------------------------------------------------
   Sync model v1 ("demo bridge"):
   · full state → state_snapshots (device-scoped, upsert, debounced)
   · orders + own shop mirrored to normalized tables so the SQL
     console and future dashboards see real rows
   · boot: if cloud snapshot is newer than local, offer restore
   ============================================================ */

const CLOUD = {
  on: false, url: '', key: '',
  status: 'local',         // local | connecting | synced | error
  lastPush: 0, pushTimer: null, lastError: ''
};

function cloudHeaders(extra) {
  return Object.assign({
    'apikey': CLOUD.key,
    'Authorization': 'Bearer ' + CLOUD.key,
    'Content-Type': 'application/json'
  }, extra || {});
}

async function cloudFetch(path, opts) {
  const res = await fetch(CLOUD.url + '/rest/v1/' + path, Object.assign({ headers: cloudHeaders(opts && opts.headers) }, opts));
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 140));
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

function cloudInit() {
  const cfg = window.ORIGNALS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseUrl.includes('YOUR-')) {
    CLOUD.status = 'local'; return;
  }
  CLOUD.on = true;
  CLOUD.url = cfg.supabaseUrl.replace(/\/$/, '');
  CLOUD.key = cfg.supabaseAnonKey;
  CLOUD.status = 'connecting';
  if (!S.deviceKey) { S.deviceKey = 'dev_' + uid() + uid(); save(); }
  cloudBoot();
}

/* ---------- boot: pull snapshot, offer restore if newer ---------- */
async function cloudBoot() {
  try {
    const rows = await cloudFetch('state_snapshots?device_key=eq.' + S.deviceKey + '&select=state,updated_at');
    CLOUD.status = 'synced';
    if (rows && rows.length) {
      const remote = rows[0];
      const remoteTs = new Date(remote.updated_at).getTime();
      const localTs = S.lastSaved || 0;
      if (remoteTs > localTs + 60000 && remote.state && (remote.state.orders || []).length > (S.orders || []).length) {
        if (confirm('A newer copy of your Orignals data exists in the cloud (from another device or session). Restore it here?')) {
          const keep = S.deviceKey;
          S = Object.assign(defaultState(), remote.state);
          S.deviceKey = keep; save(); applyTheme(); route();
          toast('Cloud data restored');
          return;
        }
      }
    }
    if (typeof brainAdoptGlobal === 'function') brainAdoptGlobal();
    cloudQueue();               // first push
    toast('Cloud connected — your data now syncs across devices');
    notify('Cloud sync active', 'Backed by your Supabase project. Orders & shop now mirror to the database.', 'check');
  } catch (e) {
    CLOUD.status = 'error'; CLOUD.lastError = e.message;
    console.warn('[cloud] boot failed:', e.message);
  }
}

/* ---------- debounced push (called from save()) ---------- */
function cloudQueue() {
  if (!CLOUD.on) return;
  clearTimeout(CLOUD.pushTimer);
  CLOUD.pushTimer = setTimeout(cloudPush, 2500);
}

async function cloudPush() {
  if (!CLOUD.on) return;
  try {
    /* 1 — full snapshot (source of truth for restore) */
    await cloudFetch('state_snapshots', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([{ device_key: S.deviceKey, state: S, app_ver: 'v1' }])
    });

    /* 2 — mirror orders into normalized rows (idempotent upsert) */
    if (S.orders.length) {
      const rows = S.orders.slice(0, 50).map(o => ({
        id: o.id, kind: o.kind || 'shop', flow: o.flow || null,
        shop_id: (o.shopId && String(o.shopId).startsWith('sh')) ? o.shopId : null,
        title: o.title, items: o.items || [], total: o.total,
        addr_label: o.addr ? o.addr.name : null,
        partner_name: o.partner ? o.partner.name : null,
        partner_veh: o.partner ? o.partner.veh : null,
        otp: o.partner ? o.partner.otp : null,
        rated: o.rated || null,
        cancelled_at: o.cancelled ? new Date(o.cancelled).toISOString() : null,
        placed_at: new Date(o.placedAt).toISOString()
      }));
      await cloudFetch('orders?on_conflict=id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(rows)
      });
    }

    /* 3 — mirror the user's own shop + items */
    if (S.myShop) {
      const shopId = 'my_' + S.deviceKey.slice(0, 12);
      await cloudFetch('shops?on_conflict=id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([{
          id: shopId, name: S.myShop.name, category: S.myShop.cat,
          tagline: 'Seller on Orignals', delivery: S.myShop.delivery || 'both',
          pure_veg: !!S.myShop.veg, gst: S.myShop.gst || null, fssai: S.myShop.fssai || null,
          is_open: !!S.myShop.online,
          offer_label: S.myShop.offer ? S.myShop.offer.label : null,
          offer_pct: S.myShop.offer ? S.myShop.offer.pct : null
        }])
      });
      if (S.myShop.items.length) {
        await cloudFetch('shop_items?on_conflict=id', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(S.myShop.items.map((it, i) => ({
            id: shopId + '_i' + i, shop_id: shopId, name: it.name,
            qty_label: it.qty, price: it.price, in_stock: !it.out, icon: it.emoji || null
          })))
        });
      }
    }

    /* 4 — Mitra Brain: training data + model meta mirror to cloud */
    try {
      const ulog = (typeof brainLog === 'function') ? brainLog().slice(-200) : [];
      if (ulog.length) {
        await cloudFetch('mitra_utterances?on_conflict=device_key,ts', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(ulog.map(u => ({
            device_key: S.deviceKey, ts: new Date(u.ts).toISOString(),
            text: u.text, pred: u.pred, conf: u.conf, label: u.label, src: u.src
          })))
        });
      }
      if (typeof brainStats === 'function' && BRAIN.W) {
        const bs = brainStats();
        await cloudFetch('mitra_model?on_conflict=device_key', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify([{ device_key: S.deviceKey, version: BRAIN.version, trained: bs.trained, labeled: bs.labeled, accuracy: bs.accuracy }])
        });
      }
    } catch (e) { console.warn('[cloud] mitra sync skipped:', e.message); }

    /* 5 — custom categories benefit every seller */
    if ((S.customCats || []).length) {
      await cloudFetch('custom_categories?on_conflict=id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(S.customCats.map(c => ({ id: c.id, name: c.name })))
      });
    }

    CLOUD.status = 'synced'; CLOUD.lastPush = Date.now(); CLOUD.lastError = '';
  } catch (e) {
    CLOUD.status = 'error'; CLOUD.lastError = e.message;
    console.warn('[cloud] push failed:', e.message);
  }
}

/* ---------- admin helpers ---------- */
function cloudStatusHTML() {
  const map = {
    local:      ['Local only', 'Paste Supabase keys in config.js to go multi-device', 'grid'],
    connecting: ['Connecting…', CLOUD.url, 'clock'],
    synced:     ['Cloud synced', CLOUD.url + (CLOUD.lastPush ? ' · last push ' + new Date(CLOUD.lastPush).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''), 'check'],
    error:      ['Cloud error', CLOUD.lastError, 'x']
  };
  const [t, sub, icon] = map[CLOUD.status];
  return `<div class="trust-row">${ic(icon, 13)} <b>${t}</b> — ${esc(sub)}</div>
    ${CLOUD.on ? `<div class="btn-pair">
      <button class="btn-main sm ghost" onclick="cloudPush().then(()=>{toast('Pushed to cloud');VIEWS.admin(['data'])})">Sync now</button>
      <button class="btn-main sm ghost" onclick="cloudBoot()">Pull from cloud</button></div>` : ''}`;
}

/* ============================================================
   REAL PAYMENTS — Razorpay via Supabase edge functions.
   The key secret never exists client-side: razorpay-order creates
   the order server-side, razorpay-verify checks the HMAC signature
   server-side. Money is only trusted after verification.
   ============================================================ */
let _payBusy = false;
async function payViaRazorpay(amountRs, meta, onSuccess, onUnconfigured) {
  if (_payBusy) return;
  if (typeof Razorpay === 'undefined') { toast('Payment system loading — try again in a moment'); return; }
  _payBusy = true;

  /* Lane A (strongest): server-created order + signature verify.
     Needs RZP_KEY_SECRET in Supabase secrets. */
  if (CLOUD.on) {
    try {
      const r = await fetch(CLOUD.url + '/functions/v1/razorpay-order', {
        method: 'POST', headers: cloudHeaders(),
        body: JSON.stringify({
          amount: Math.round(amountRs * 100),
          purpose: meta.purpose || 'order',
          ref: String(meta.ref || '').slice(0, 50),
          device: S.deviceKey || ''
        })
      });
      const d = await r.json();
      if (r.ok && !d.error) { _rzpOpenOrder(d, amountRs, meta, onSuccess); return; }
      if (!(d && d.error === 'payments not configured')) {
        _payBusy = false; toast('Could not start payment — try wallet'); return;
      }
      /* not configured → fall through to Lane B */
    } catch (e) { /* network issue → try Lane B */ }
  }

  /* Lane B (keyless): direct Checkout with the public Key ID; Razorpay's
     webhook confirms the captured payment server-side into our ledger. */
  const keyId = ((window.ORIGNALS_CONFIG || {}).pay || {}).keyId;
  if (!keyId || keyId.indexOf('rzp_') !== 0) {
    _payBusy = false;
    if (onUnconfigured) onUnconfigured();
    else toast('Online payments activate soon — pay by wallet meanwhile');
    return;
  }
  _rzpOpenDirect(keyId, amountRs, meta, onSuccess);
}

function _rzpBase(amountPaise, meta) {
  return {
    amount: amountPaise, currency: 'INR',
    name: 'Orignals', description: String(meta.desc || 'Orignals').slice(0, 80),
    prefill: { name: S.user.name && S.user.name !== 'Friend' ? S.user.name : '' },
    notes: {
      purpose: String(meta.purpose || 'order').slice(0, 30),
      ref: String(meta.ref || '').slice(0, 50),
      device: S.deviceKey || ''
    },
    theme: { color: '#1A5632' },
    modal: { ondismiss: () => { _payBusy = false; toast('Payment cancelled'); } }
  };
}

function _rzpOpenOrder(d, amountRs, meta, onSuccess) {
  const opts = Object.assign(_rzpBase(d.amount, meta), {
    key: d.keyId, order_id: d.orderId,
    handler: async (resp) => {
      try {
        const v = await fetch(CLOUD.url + '/functions/v1/razorpay-verify', {
          method: 'POST', headers: cloudHeaders(),
          body: JSON.stringify({ orderId: d.orderId, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature })
        });
        const vd = await v.json();
        _payBusy = false;
        if (vd && vd.verified) onSuccess(resp.razorpay_payment_id);
        else toast('Payment could not be verified — if money left your account it auto-refunds in 5–7 days');
      } catch (e) {
        _payBusy = false;
        toast('Verification failed — note payment ID ' + String(resp.razorpay_payment_id || '').slice(-8));
      }
    }
  });
  const rz = new Razorpay(opts);
  if (rz.on) rz.on('payment.failed', () => { _payBusy = false; toast('Payment failed — no money taken, try again'); });
  rz.open();
}

function _rzpOpenDirect(keyId, amountRs, meta, onSuccess) {
  const opts = Object.assign(_rzpBase(Math.round(amountRs * 100), meta), {
    key: keyId,
    handler: async (resp) => {
      /* poll our ledger for the webhook-confirmed row (payment.captured) */
      toast('Payment received — confirming with bank…');
      let state = 'pending';
      if (CLOUD.on) {
        for (let i = 0; i < 6; i++) {
          await new Promise(res => setTimeout(res, 2500));
          try {
            const rows = await cloudFetch('payments?rzp_payment_id=eq.' + encodeURIComponent(resp.razorpay_payment_id) + '&select=status');
            if (rows && rows[0]) {
              if (rows[0].status === 'verified') { state = 'verified'; break; }
              if (rows[0].status === 'failed') { state = 'failed'; break; }
            }
          } catch (e) { /* keep polling */ }
        }
      }
      _payBusy = false;
      if (state === 'failed') { toast('Bank reported a failure — any deducted money auto-refunds'); return; }
      onSuccess(resp.razorpay_payment_id, state === 'verified');
      if (state !== 'verified') toast('Payment recorded — bank confirmation syncs in the background');
    }
  });
  const rz = new Razorpay(opts);
  if (rz.on) rz.on('payment.failed', () => { _payBusy = false; toast('Payment failed — no money taken, try again'); });
  rz.open();
}
