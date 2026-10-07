// APP_VERSION vient de version.js (source unique, partagée avec index.html).
// Le navigateur compare aussi les scripts importés octet par octet : changer
// version.js suffit à déclencher l'installation du nouveau Service Worker.
importScripts('./version.js');

// Nom du cache dérivé de la version → l'ancien cache est supprimé à l'activation
const CACHE_NAME = 'allinone-v' + APP_VERSION;
const OFFLINE_URL = '/venteapp/offline.html';

const PRECACHE = [
  '/venteapp/',
  '/venteapp/index.html',
  '/venteapp/version.js',
  '/venteapp/style.css?v=' + APP_VERSION,
  '/venteapp/app.js?v=' + APP_VERSION,
  '/venteapp/offline.html',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE).catch(()=>{}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Appels API Vercel → laisser passer, retourner JSON d'erreur si hors ligne
  if (event.request.url.includes('allinone-server.vercel.app')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'OFFLINE' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Ressources app → Network First avec fallback cache puis offline.html
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const offlinePage = await caches.match(OFFLINE_URL);
          return offlinePage || new Response('Hors ligne', { status: 503 });
        }
        return new Response('Hors ligne', { status: 503 });
      })
  );
});
