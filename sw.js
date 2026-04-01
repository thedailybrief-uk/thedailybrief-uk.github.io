const CACHE_NAME = 'daily-brief-v27';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/404.html',
  '/manifest.json',
  '/og-image.png',
  '/legal-styles.css',
  '/privacy.html',
  '/terms.html',
  '/cookies.html',
  '/subscribe-terms.html',
  '/sitemap.xml',
  '/robots.txt',
  '/fonts/inter-latin.woff2',
  '/fonts/inter-latin-ext.woff2',
  '/fonts/playfair-display-latin.woff2',
  '/fonts/playfair-display-latin-ext.woff2',
  '/fonts/source-serif-4-latin.woff2',
  '/fonts/source-serif-4-latin-ext.woff2',
  '/fonts/source-serif-4-italic-latin.woff2',
  '/fonts/source-serif-4-italic-latin-ext.woff2',
];
const FONT_CACHE = 'daily-brief-fonts-v2';

// Install: cache static assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== FONT_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for HTML (always get latest briefing), cache-first for fonts
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Cache-first for self-hosted fonts (they rarely change)
  if (url.origin === self.location.origin && url.pathname.startsWith('/fonts/')) {
    e.respondWith(
      caches.open(FONT_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            cache.put(e.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // Network-first for same-origin (HTML, images)
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Network-only for RSS proxies and external APIs (don't cache stale news)
  e.respondWith(fetch(e.request));
});

// ── Web Push Notifications ──

self.addEventListener('push', (e) => {
  // Always show a notification — even if payload is empty or decryption failed
  let data = { title: 'The Daily Brief', body: 'New update available' };

  if (e.data) {
    try {
      data = e.data.json();
    } catch {
      try { data.body = e.data.text(); } catch { /* keep default */ }
    }
  }

  const options = {
    body: data.body || 'New update available',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.type === 'breaking' ? 'breaking-news' : 'edition-' + Date.now(),
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    requireInteraction: data.type === 'breaking',
  };

  e.waitUntil(self.registration.showNotification(data.title || 'The Daily Brief', options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  const targetUrl = e.notification.data?.url || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (new URL(client.url).pathname === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new tab
      return clients.openWindow(targetUrl);
    })
  );
});
