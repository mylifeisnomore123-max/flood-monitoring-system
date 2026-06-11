/* ═══════════════════════════════════════════════════════════
   sw.js — Service Worker
   বন্যা পর্যবেক্ষণ PWA — পূর্বধলা, নেত্রকোণা
   ═══════════════════════════════════════════════════════════ */

const CACHE_NAME    = 'flood-monitor-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@300;400;500;600;700&family=Noto+Sans+Bengali:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700;800;900&display=swap'
];

/* ─── INSTALL ─── */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache addAll partial fail:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

/* ─── ACTIVATE ─── */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ─── FETCH — Network-first for Firebase/API, Cache-first for assets ─── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Firebase Realtime DB & Open-Meteo → always network, no cache
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Static assets → Cache-first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache valid GET responses
        if (
          event.request.method === 'GET' &&
          response.status === 200 &&
          !url.hostname.includes('chrome-extension')
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for HTML pages
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

/* ═══════════════════════════════════════════════════════════
   PUSH NOTIFICATIONS
   ═══════════════════════════════════════════════════════════ */

self.addEventListener('push', (event) => {
  console.log('[SW] Push received');

  let data = {
    title: '🌊 বন্যা পর্যবেক্ষণ',
    body:  'নতুন আপডেট পাওয়া গেছে।',
    type:  'info',
    level: 0
  };

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  /* Icon & badge color by alert type */
  const iconMap = {
    safe:   '/icons/icon-192.png',
    warn:   '/icons/icon-192.png',
    danger: '/icons/icon-192.png',
    info:   '/icons/icon-192.png'
  };

  const options = {
    body:    data.body,
    icon:    iconMap[data.type] || '/icons/icon-192.png',
    badge:   '/icons/icon-96.png',
    tag:     `flood-alert-${data.type}`,
    renotify: true,
    requireInteraction: data.type === 'danger',
    vibrate: data.type === 'danger'
      ? [200, 100, 200, 100, 400]  // জরুরি — লম্বা কম্পন
      : [200, 100, 200],            // সতর্কতা — সংক্ষিপ্ত
    data: {
      url:   '/',
      type:  data.type,
      level: data.level,
      timestamp: Date.now()
    },
    actions: [
      { action: 'view',    title: '📊 ড্যাশবোর্ড দেখুন' },
      { action: 'dismiss', title: '✕ বন্ধ করুন' }
    ]
  };

  /* Alert-specific overrides */
  if (data.type === 'warn') {
    options.body = options.body || `⚠️ পানির স্তর ${data.level} সে.মি. — সতর্ক থাকুন।`;
  } else if (data.type === 'danger') {
    options.body = options.body || `🚨 বিপদ! পানির স্তর ${data.level} সে.মি. — দ্রুত নিরাপদ স্থানে যান!`;
    options.requireInteraction = true;
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

/* ─── Notification Click ─── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

/* ─── Background Sync (optional, for offline queuing) ─── */
self.addEventListener('sync', (event) => {
  if (event.tag === 'flood-data-sync') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SYNC_COMPLETE' });
        });
      })
    );
  }
});

/* ─── Message from main thread ─── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('[SW] flood-monitor sw.js loaded — version:', CACHE_NAME);
