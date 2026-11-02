/* ==========================================================================
   sw.js — offline cache so the app works on a plane / in a canyon.

   Strategy: network-first for plan.json (so plan edits show up), cache-first
   for everything else. Bump CACHE_VERSION when you change css/js and want
   old copies dropped.
   ========================================================================== */

const CACHE_VERSION = 'v1';
const CACHE = 'ironman703-' + CACHE_VERSION;

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/store.js',
  './js/plan.js',
  './js/ui.js',
  './js/app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // plan.json: try the network first, fall back to cache when offline.
  if (url.pathname.endsWith('plan.json')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }))
  );
});
