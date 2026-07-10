/* Orignals service worker — offline shell + on-device map tile cache.
   Tiles are cached cache-first (capped), which makes maps load instantly,
   work offline, and massively cuts traffic to the open-source tile servers. */
const CACHE = 'orignals-v10';
const TILES = 'orignals-tiles-v1';
const TILE_CAP = 900;
const SHELL = [
  './index.html', './css/app.css', './css/modules.css',
  './js/data.js', './js/icons.js', './js/core.js', './js/home.js', './js/shops.js',
  './js/send.js', './js/rides.js', './js/tickets.js', './js/estate.js',
  './js/earn.js', './js/myshop.js', './js/mitra.js', './js/account.js', './js/admin.js',
  './js/cloud.js', './js/brain.js', './js/brain_ml.js', './js/geo.js', './js/ops.js', './js/auth.js', './js/face.js', './js/legal.js',
  './manifest.json', './config.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-180.png'
];

/* ---------- WEB PUSH (self-hosted VAPID) ----------
   Receive side is 100% browser-native — no third party. Sending needs
   your own VAPID keypair (self-generated) from your server/edge fn.
   This shows the notification even when the app is closed. */
self.addEventListener('push', e => {
  let d = { title: 'Orignals', body: 'You have an update' };
  try { if (e.data) d = Object.assign(d, e.data.json()); } catch (x) { try { d.body = e.data.text(); } catch (y) {} }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, badge: './manifest.json', tag: d.tag || 'orignals',
    data: { url: d.url || './' }, requireInteraction: !!d.important
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) { w.navigate && w.navigate(url); return w.focus(); } }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
const TILE_HOSTS = ['tile.openstreetmap.org', 'basemaps.cartocdn.com', 'tile.openstreetmap.de'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  try {
    const c = await caches.open(TILES);
    const keys = await c.keys();
    if (keys.length > TILE_CAP) {
      for (const k of keys.slice(0, keys.length - TILE_CAP)) await c.delete(k);
    }
  } catch (e) {}
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  /* map tiles: cache-first, capped — offline maps + minimal server load */
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    e.respondWith(
      caches.open(TILES).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok || res.type === 'opaque') { c.put(e.request, res.clone()); trimTiles(); }
        return res;
      })))
    );
    return;
  }

  /* never cache API/payment traffic — orders, money and state must always be live */
  if (url.hostname.endsWith('supabase.co') || url.hostname.includes('nominatim') ||
      url.hostname.includes('anthropic') || url.hostname.endsWith('razorpay.com')) return;

  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if ((res.ok && url.origin === self.location.origin) || (res.type === 'opaque' && url.hostname === 'unpkg.com')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
