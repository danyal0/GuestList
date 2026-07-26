/* Gatherly service worker — offline support.
 *
 * Strategy:
 *  - App shell + static assets: stale-while-revalidate
 *  - API GET requests: network-first with cache fallback (fresh data wins,
 *    cached data keeps the app usable offline)
 *  - Navigations: network-first, falling back to the /offline page
 */
const VERSION = 'v1';
const STATIC_CACHE = `gatherly-static-${VERSION}`;
const API_CACHE = `gatherly-api-${VERSION}`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept auth or realtime traffic.
  if (url.pathname.startsWith('/api/v1/auth') || url.pathname.startsWith('/socket.io')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r ?? Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((r) => r ?? Response.error())),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
  }
});
