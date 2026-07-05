/* Orignals service worker — offline shell so the installed app always opens */
const CACHE = 'orignals-v3';
const SHELL = [
  './index.html', './css/app.css', './css/modules.css',
  './js/data.js', './js/icons.js', './js/core.js', './js/home.js', './js/shops.js',
  './js/send.js', './js/rides.js', './js/tickets.js', './js/estate.js',
  './js/earn.js', './js/myshop.js', './js/mitra.js', './js/account.js', './js/admin.js',
  './manifest.json', './config.js', './js/cloud.js'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && e.request.url.startsWith(self.location.origin)) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
