// ============================================================
//  Service Worker — বন্যা পর্যবেক্ষণ ব্যবস্থা
//  Offline support + Cache management
// ============================================================

const CACHE_NAME = 'flood-monitor-v1';
const OFFLINE_URL = 'offline.html';

const CACHE_FILES = [
  '/flood-monitoring-system/',
  '/flood-monitoring-system/index.html',
  '/flood-monitoring-system/manifest.json',
  '/flood-monitoring-system/icon-192.png',
  '/flood-monitoring-system/icon-512.png',
  '/flood-monitoring-system/offline.html',
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_FILES);
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH ────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Firebase requests — always network
  if (event.request.url.includes('firebase') ||
      event.request.url.includes('googleapis') ||
      event.request.url.includes('gstatic')) {
    event.respondWith(fetch(event.request).catch(() => new Response('')));
    return;
  }

  // HTML — Network first, fallback to cache, then offline page
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((cached) =>
            cached || caches.match(OFFLINE_URL)
          )
        )
    );
    return;
  }

  // Others — Cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).catch(() => new Response(''))
    )
  );
});
