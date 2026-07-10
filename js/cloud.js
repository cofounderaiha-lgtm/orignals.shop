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
    /* hardened: read our own snapshot via device-keyed RPC (table is no
       longer bulk-readable by the public anon key) */
    const remote = await cloudFetch('rpc/snapshot_restore', { method: 'POST', body: JSON.stringify({ p_device: S.deviceKey }) });
    CLOUD.status = 'synced';
    if (remote && remote.state) {
      const remoteTs = new Date(remote.updated_at).getTime();
      const localTs = S.lastSaved || 0;
      if (remoteTs > localTs + 60000 && remote.state && (remote.state.orders || []).length > (S.orders || []).length) {
        if (confirm('A newer copy of your Orignals data exists in the cloud (from another device or session). Restore it here?')) {
          const keep = S.deviceKey;
          S = Object.assign(defaultState(), remote.state);
          S.deviceKey = keep; save(); applyTheme(); route();
          toast('Welcome back — your account is ready');
          return;
        }
      }
    }
    if (typeof brainAdoptGlobal === 'function') brainAdoptGlobal();
    cloudQueue();               // first push — silent (no infra details ever shown to users)
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

    /* 3 — mirror the user's own shop + items (with real GPS location so
       buyers on every other device can find and order from it) */
    if (S.myShop) {
      const shopId = 'my_' + S.deviceKey.slice(0, 12);
      await cloudFetch('shops?on_conflict=id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([{
          id: shopId, name: S.myShop.name, category: S.myShop.cat,
          tagline: 'Seller on Orignals', delivery: S.myShop.delivery || 'both',
          pure_veg: !!S.myShop.veg, gst: S.myShop.gst || null, fssai: S.myShop.fssai || null,
          is_open: !!S.myShop.online, photo_url: (S.myShop.photo && S.myShop.photo.startsWith('http')) ? S.myShop.photo : null,
          lat: (S.myShop.addr && S.myShop.addr.lat != null) ? +S.myShop.addr.lat : null,
          lng: (S.myShop.addr && S.myShop.addr.lng != null) ? +S.myShop.addr.lng : null,
          addr: S.myShop.addr ? (S.myShop.addr.name + (S.myShop.addr.sub ? ', ' + S.myShop.addr.sub : '')) : null,
          phone: S.myShop.phone || null,
          open_from: S.myShop.open || null, open_till: S.myShop.close || null,
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
            qty_label: it.qty, price: it.price, in_stock: !it.out, icon: it.emoji || null,
            photo_url: (it.photo && it.photo.startsWith('http')) ? it.photo : null, section: it.section || null
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
  if (CLOUD.on) setTimeout(cloudMarketStats, 60);
  return `<div class="trust-row">${ic(icon, 13)} <b>${t}</b> — ${esc(sub)}</div>
    ${CLOUD.on ? `<div id="mktStats" class="trust-row">${ic('clock', 12)} Loading live marketplace stats…</div>
    <div class="btn-pair">
      <button class="btn-main sm ghost" onclick="cloudPush().then(()=>{toast('Pushed to cloud');VIEWS.admin(['data'])})">Sync now</button>
      <button class="btn-main sm ghost" onclick="cloudBoot()">Pull from cloud</button></div>` : ''}`;
}

/* ============================================================
   LIVE MARKETPLACE — the inner engine, cross-device.
   Parcels posted anywhere appear as claimable jobs for every
   partner; shops registered anywhere appear for every buyer.
   ============================================================ */

/* a Send order becomes a real job for all nearby partners */
function cloudPostJob(j) {
  if (!CLOUD.on) return;
  cloudFetch('live_jobs?on_conflict=id', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=ignore-duplicates' },
    body: JSON.stringify([{
      id: j.id, device_key: S.deviceKey || 'anon',
      what: String(j.what).slice(0, 90), jtype: j.jtype || 'box',
      from_name: j.from_name, to_name: j.to_name,
      from_lat: j.from_lat != null ? +j.from_lat : null, from_lng: j.from_lng != null ? +j.from_lng : null,
      to_lat: j.to_lat != null ? +j.to_lat : null, to_lng: j.to_lng != null ? +j.to_lng : null,
      km: j.km != null ? +(+j.km).toFixed(1) : null, pay: Math.max(Math.round(j.pay || 0), 0),
      note: j.note ? String(j.note).slice(0, 200) : null, order_ref: j.order_ref || null
    }])
  }).catch(e => console.warn('[jobs] post skipped:', e.message));
}

/* open jobs posted by OTHER devices in the last 24 h */
async function cloudJobs() {
  if (!CLOUD.on) return [];
  const since = new Date(Date.now() - 864e5).toISOString();
  const rows = await cloudFetch(
    'live_jobs?status=eq.open&device_key=neq.' + encodeURIComponent(S.deviceKey || 'anon') +
    '&created_at=gte.' + since + '&order=created_at.desc&limit=20');
  return (rows || []).map(r => ({
    id: r.id, cloud: true, what: r.what,
    type: r.jtype === 'ride' ? 'ride' : (DB.parcelTypes.some(p => p.id === r.jtype) ? r.jtype : 'box'),
    from: r.from_name || 'Pickup point', to: r.to_name || 'Drop point',
    km: r.km != null ? +r.km : 1, pay: +r.pay || 0,
    by: 'Neighbour · verified buyer', note: r.note || '',
    geo: (r.from_lat != null && r.to_lat != null)
      ? { from: { lat: +r.from_lat, lng: +r.from_lng }, to: { lat: +r.to_lat, lng: +r.to_lng } } : null
  }));
}
function cloudJobClaim(id) {
  return cloudFetch('rpc/job_claim', { method: 'POST', body: JSON.stringify({ p_job: id, p_device: S.deviceKey || 'anon' }) });
}
function cloudJobDone(id) {
  return cloudFetch('rpc/job_done', { method: 'POST', body: JSON.stringify({ p_job: id, p_device: S.deviceKey || 'anon' }) });
}

/* community shops: every shop registered on any device joins DB.shops */
let _commShopsAt = 0;
async function cloudShopsRefresh(onDone) {
  if (!CLOUD.on) return;
  if (Date.now() - _commShopsAt < 60000) return;     // refresh at most 1/min
  _commShopsAt = Date.now();
  try {
    const own = 'my_' + (S.deviceKey || '').slice(0, 12);
    const shops = await cloudFetch(
      'shops?id=like.my_*&id=neq.' + own + '&is_open=eq.true&deleted_at=is.null&select=*&limit=40');
    if (!shops || !shops.length) return;
    const ids = shops.map(s => '"' + s.id + '"').join(',');
    const items = await cloudFetch('shop_items?shop_id=in.(' + ids + ')&in_stock=eq.true&limit=300') || [];
    const byShop = {};
    items.forEach(it => { (byShop[it.shop_id] = byShop[it.shop_id] || []).push(it); });
    const here = (S.user.addr && S.user.addr.lat != null) ? S.user.addr : DB.places[0];
    let added = 0;
    shops.forEach(cs => {
      const its = (byShop[cs.id] || []).map(it => ({
        id: it.id, name: it.name, qty: it.qty_label || '', price: +it.price,
        mrp: it.mrp ? +it.mrp : undefined, bestseller: !!it.bestseller,
        photo: it.photo_url || '', section: it.section || ''
      }));
      if (!its.length) return;
      const km = (cs.lat != null && here.lat != null)
        ? +geoKm({ lat: +cs.lat, lng: +cs.lng }, { lat: +here.lat, lng: +here.lng }).toFixed(1) : 2.0;
      const mapped = {
        id: cs.id, name: cs.name, community: true, img: cs.photo_url || undefined,
        type: DB.shopTypes.some(t => t.id === cs.category) ? cs.category : 'grocery',
        rating: cs.rating != null ? +cs.rating : 5.0, ratings: cs.ratings_count || 'New',
        km, time: Math.max(9, Math.round(km * 4 + 8)),
        open: !!cs.is_open, delivery: cs.delivery || 'both', veg: !!cs.pure_veg,
        offer: cs.offer_label || '', tag: cs.addr ? cs.addr.slice(0, 60) : 'Seller on Orignals',
        lat: cs.lat != null ? +cs.lat : undefined, lng: cs.lng != null ? +cs.lng : undefined,
        items: its
      };
      const at = DB.shops.findIndex(x => x.id === cs.id);
      if (at >= 0) DB.shops[at] = mapped; else { DB.shops.push(mapped); added++; }
    });
    if (added && onDone) onDone(added);
  } catch (e) { console.warn('[shops] community refresh skipped:', e.message); }
}

/* ---------- dining reservations (→ restaurant device) ---------- */
function cloudPostReservation(r) {
  if (!CLOUD.on) return;
  cloudFetch('reservations?on_conflict=id', { method: 'POST', headers: { 'Prefer': 'resolution=ignore-duplicates' },
    body: JSON.stringify([{ id: r.id, shop_id: r.shopId, buyer_device: S.deviceKey || 'anon', buyer_name: (S.user.name || 'Guest').slice(0, 40), day: r.day, slot: r.slot, guests: r.guests }]) }).catch(() => {});
}
function cloudReservationCancel(id) {
  if (!CLOUD.on) return Promise.resolve();
  return cloudFetch('rpc/reservation_cancel', { method: 'POST', body: JSON.stringify({ p_id: id, p_device: S.deviceKey || 'anon' }) }).catch(() => {});
}

/* ---------- property listings + leads (cross-device) ---------- */
function cloudPostListing(p) {
  if (!CLOUD.on) return;
  cloudFetch('listings?on_conflict=id', { method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify([{ id: p.id, owner_device: S.deviceKey || 'anon', kind: p.kind, title: p.title, loc: p.loc, price: p.price, area: p.area, bhk: p.bhk, lat: p.lat != null ? +p.lat : null, lng: p.lng != null ? +p.lng : null, status: 'live' }]) }).catch(() => {});
}
let _commListAt = 0;
async function cloudListingsRefresh(onDone) {
  if (!CLOUD.on || Date.now() - _commListAt < 60000) return;
  _commListAt = Date.now();
  try {
    const rows = await cloudFetch('listings?status=eq.live&owner_device=neq.' + encodeURIComponent(S.deviceKey || 'anon') + '&select=*&order=created_at.desc&limit=30');
    if (rows && rows.length && onDone) onDone(rows);
  } catch (e) {}
}
function cloudPostLead(listing, kind, note) {
  if (!CLOUD.on || !listing.owner_device) return;
  cloudFetch('listing_leads', { method: 'POST', headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify([{ listing_id: listing.id, owner_device: listing.owner_device, from_device: S.deviceKey || 'anon', kind, name: (S.user.name || 'A buyer').slice(0, 40), note: (note || '').slice(0, 160) }]) }).catch(() => {});
}
async function cloudMyLeads() {
  if (!CLOUD.on) return [];
  try { return await cloudFetch('rpc/my_leads', { method: 'POST', body: JSON.stringify({ p_device: S.deviceKey || 'anon' }) }) || []; }
  catch (e) { return []; }
}

/* ---------- document-assistance requests ---------- */
function cloudDocRequest(r) {
  if (!CLOUD.on) return Promise.resolve();
  return cloudFetch('rpc/doc_request_add', { method: 'POST', body: JSON.stringify({
    p_id: r.id, p_device: S.deviceKey || 'anon', p_applicant: (r.applicant || '').slice(0, 60),
    p_service: r.serviceId, p_name: r.name, p_price: r.price, p_note: (r.note || '').slice(0, 200)
  }) }).catch(() => {});
}
async function cloudMyDocRequests() {
  if (!CLOUD.on) return [];
  try { return await cloudFetch('rpc/my_doc_requests', { method: 'POST', body: JSON.stringify({ p_device: S.deviceKey || 'anon' }) }) || []; }
  catch (e) { return []; }
}
function cloudDocCancel(id) {
  if (!CLOUD.on) return Promise.resolve();
  return cloudFetch('rpc/doc_request_cancel', { method: 'POST', body: JSON.stringify({ p_id: id, p_device: S.deviceKey || 'anon' }) }).catch(() => {});
}

/* ---------- referrals (cross-device credit) ---------- */
function cloudRefRegister(code) {
  if (!CLOUD.on) return;
  cloudFetch('rpc/ref_register', { method: 'POST', body: JSON.stringify({ p_code: code, p_device: S.deviceKey || 'anon' }) }).catch(() => {});
}
function cloudRedeemRef(code) {
  if (!CLOUD.on) return Promise.resolve({ ok: false, reason: 'offline' });
  return cloudFetch('rpc/redeem_ref', { method: 'POST', body: JSON.stringify({ p_code: code, p_device: S.deviceKey || 'anon' }) }).then(r => r || { ok: false }).catch(() => ({ ok: false, reason: 'offline' }));
}
async function cloudClaimRefCredits() {
  if (!CLOUD.on) return;
  try {
    const n = await cloudFetch('rpc/claim_ref_credits', { method: 'POST', body: JSON.stringify({ p_device: S.deviceKey || 'anon' }) });
    if (n && n > 0) {
      walletAdd(n * 50, 'Referral bonus · ' + n + ' friend' + (n > 1 ? 's' : '') + ' joined');
      notify('Referral reward!', '₹' + (n * 50) + ' added — ' + n + ' friend' + (n > 1 ? 's' : '') + ' joined with your code.');
    }
  } catch (e) {}
}

/* real rating: recomputes the shop's average for everyone */
function cloudRateShop(shopId, stars, orderRef) {
  if (!CLOUD.on) return Promise.resolve(null);
  return cloudFetch('rpc/rate_shop', {
    method: 'POST',
    body: JSON.stringify({ p_shop: shopId, p_device: S.deviceKey || 'anon', p_stars: stars, p_order: orderRef || '' })
  }).catch(() => null);
}

/* ============================================================
   SEAT INVENTORY — real, no double-booking across devices
   ============================================================ */
async function cloudSeatsTaken(showKey) {
  if (!CLOUD.on) return [];
  try {
    const rows = await cloudFetch('seat_bookings?show_key=eq.' + encodeURIComponent(showKey) + '&select=seat');
    return (rows || []).map(r => r.seat);
  } catch (e) { return []; }
}
function cloudSeatsBook(showKey, seats) {
  if (!CLOUD.on) return Promise.resolve([]);   // offline: allow (single device)
  return cloudFetch('rpc/seats_book', { method: 'POST', body: JSON.stringify({ p_show: showKey, p_seats: seats, p_device: S.deviceKey || 'anon' }) })
    .then(r => Array.isArray(r) ? r : []).catch(() => []);
}
function cloudSeatsConfirm(showKey, seats, ticketId) {
  if (!CLOUD.on) return Promise.resolve();
  return cloudFetch('rpc/seats_confirm', { method: 'POST', body: JSON.stringify({ p_show: showKey, p_seats: seats, p_device: S.deviceKey || 'anon', p_ticket: ticketId }) }).catch(() => {});
}
function cloudSeatsFree(showKey, seats) {
  if (!CLOUD.on) return Promise.resolve();
  return cloudFetch('rpc/seats_free', { method: 'POST', body: JSON.stringify({ p_show: showKey, p_seats: seats, p_device: S.deviceKey || 'anon' }) }).catch(() => {});
}
function cloudSeatsFreeTicket(ticketId) {
  if (!CLOUD.on) return Promise.resolve();
  return cloudFetch('rpc/seats_free_ticket', { method: 'POST', body: JSON.stringify({ p_ticket: ticketId, p_device: S.deviceKey || 'anon' }) }).catch(() => {});
}

/* ---------- image upload to Supabase Storage (shop/dish photos) ---------- */
async function cloudUploadImage(dataUrl, prefix) {
  if (!CLOUD.on || !dataUrl) return null;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const path = (prefix || 'img') + '/' + (S.deviceKey || 'd').slice(0, 10) + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.jpg';
    const r = await fetch(CLOUD.url + '/storage/v1/object/shopimg/' + path, {
      method: 'POST', headers: { apikey: CLOUD.key, Authorization: 'Bearer ' + CLOUD.key, 'Content-Type': 'image/jpeg' }, body: blob
    });
    if (!r.ok) return null;
    return CLOUD.url + '/storage/v1/object/public/shopimg/' + path;
  } catch (e) { return null; }
}

/* ---------- server-side price sanity (moderation) ---------- */
async function cloudPriceCheck(cat, name, price) {
  if (!CLOUD.on) return { verdict: 'ok' };
  try { return await cloudFetch('rpc/price_check', { method: 'POST', body: JSON.stringify({ p_cat: cat, p_name: name, p_price: price }) }) || { verdict: 'ok' }; }
  catch (e) { return { verdict: 'ok' }; }
}

/* ============================================================
   WEB PUSH — fire an alert to another device (self-hosted VAPID).
   Degrades silently if push isn't configured yet (503 → ignored).
   ============================================================ */
function cloudPushTo(target) {
  if (!CLOUD.on) return;
  try {
    fetch(CLOUD.url + '/functions/v1/push-send', {
      method: 'POST', headers: cloudHeaders(), body: JSON.stringify(target)
    }).catch(() => {});
  } catch (e) {}
}

/* ============================================================
   CROSS-DEVICE COMMERCE — buyer's order ⇄ shopkeeper's dashboard
   ============================================================ */

/* buyer → cloud: order on a community shop lands on the owner's phone */
function cloudPostShopOrder(o, shop) {
  if (!CLOUD.on || !shop || !shop.community) return;
  /* notify the shop owner even if their app is closed */
  cloudPushTo({ shop_id: shop.id, title: 'New order at ' + (shop.name || 'your shop'), body: (o.items || []).map(i => i.name).join(', ') + ' · ' + money(o.total), url: '#/myshop' });
  const a = S.user.addr || DB.places[0];
  cloudFetch('shop_orders?on_conflict=id', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=ignore-duplicates' },
    body: JSON.stringify([{
      id: o.id, shop_id: shop.id,
      buyer_device: S.deviceKey || 'anon',
      buyer_name: (S.user.name || 'Customer').slice(0, 40),
      buyer_addr: (a.name + (a.sub ? ', ' + a.sub : '')).slice(0, 120),
      buyer_lat: a.lat != null ? +a.lat : null, buyer_lng: a.lng != null ? +a.lng : null,
      items: o.items || [], total: o.total
    }])
  }).catch(e => console.warn('[shop order] post skipped:', e.message));
}

/* owner action → cloud status (drives the buyer's live tracking) */
function cloudShopOrderStatus(id, status) {
  if (!CLOUD.on) return Promise.resolve(false);
  return cloudFetch('rpc/shop_order_status', {
    method: 'POST',
    body: JSON.stringify({ p_id: id, p_device: S.deviceKey || 'anon', p_status: status })
  }).catch(() => false);
}

/* buyer poll: live status of own cloud-shop orders → stage + refunds */
let _ordPollAt = 0;
async function pollCloudOrders() {
  if (!CLOUD.on) return;
  if (Date.now() - _ordPollAt < 7000) return;
  const live = S.orders.filter(o => o.cloudShop && !o.cancelled && o.cloudStatus !== 'done');
  if (!live.length) return;
  _ordPollAt = Date.now();
  try {
    const rows = await cloudFetch('rpc/order_statuses', { method: 'POST', body: JSON.stringify({ p_ids: live.map(o => o.id) }) });
    let changed = false;
    (rows || []).forEach(r => {
      const o = S.orders.find(x => x.id === r.id);
      if (!o || o.cloudStatus === r.status) return;
      o.cloudStatus = r.status; changed = true;
      if (r.status === 'rejected' && !o.cancelled) {
        o.cancelled = Date.now();
        walletAdd(o.total, 'Refund · ' + o.id + ' · shop could not take the order');
        notify('Order refunded', o.title + ' — the shop couldn\'t take it. ' + money(o.total) + ' is back in your wallet.', 'x');
      } else {
        const f = FLOWS[o.flow][orderStage(o)];
        if (f) notify(f.t, o.title + ' · live update from the shop', f.e);
      }
    });
    if (changed) { save(); refreshChrome(); }
  } catch (e) { /* next poll */ }
}

/* live marketplace stats for Admin → Database */
async function cloudMarketStats() {
  const el = document.getElementById('mktStats');
  if (!el || !CLOUD.on) return;
  try {
    /* counts via security-definer RPC (sensitive rows are not anon-readable) */
    const m = await cloudFetch('rpc/market_stats', { method: 'POST', body: JSON.stringify({}) }) || {};
    el.innerHTML = `${ic('spark', 12)} <b>Marketplace live:</b> ${m.open_jobs || 0} open jobs · ${m.active_orders || 0} active shop orders · ${m.verified_payments || 0} verified payments · ${m.community_shops || 0} community shops`;
  } catch (e) { el.textContent = 'Marketplace stats unavailable — ' + e.message; }
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
  if (typeof paymentsLive === 'function' && !paymentsLive()) { toast('Online payments are paused right now — pay by wallet'); return; }
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
            const st = await cloudFetch('rpc/payment_status', { method: 'POST', body: JSON.stringify({ p_payment: resp.razorpay_payment_id }) });
            if (st) {
              if (st === 'verified') { state = 'verified'; break; }
              if (st === 'failed') { state = 'failed'; break; }
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
