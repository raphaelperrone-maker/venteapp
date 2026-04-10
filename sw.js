const CACHE = 'allinone-v1';
const ASSETS = [
  '/venteapp/app_vente.html',
  '/venteapp/manifest.json',
  '/venteapp/icon-192.png',
  '/venteapp/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Stratégie network-first : toujours essayer le réseau d'abord
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
