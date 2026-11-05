/* ==========================================================================
   sw.js — offline cache so the app works on a plane / in a canyon.

   Strategy: NETWORK FIRST, cache as fallback.

   This is deliberate. A cache-first service worker is faster but it happily
   serves last week's JavaScript after you edit a file, which is a miserable
   way to debug. Network-first means: when you have signal you always get the
   current version, and when you don't, the cached copy keeps working.

   Bump CACHE_VERSION to throw away the old cache entirely.
   ========================================================================== */

const CACHE_VERSION = 'v5';
const CACHE = 'ironman703-' + CACHE_VERSION;

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/store.js',
  './js/plan.js',
  './js/ui.js',
  './js/app.js',
  './plan.json',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
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

  event.respondWith(
    fetch(req)
      .then((res) => {
        // keep a copy of good responses for offline use
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          // offline and never cached: fall back to the shell for navigations
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        })
      )
  );
});
