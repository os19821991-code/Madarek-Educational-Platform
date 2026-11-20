const APP_CACHE = 'madarik-app-v1';
const FONTS_CACHE = 'madarik-fonts-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const allowedCaches = new Set([APP_CACHE, FONTS_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !allowedCaches.has(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isBypassedRequest(url) {
  if (!url.protocol.startsWith('http')) return true;
  if (url.pathname.startsWith('/api/')) return true;

  const host = url.hostname;
  if (
    host.includes('firestore.googleapis.com') ||
    host.includes('identitytoolkit.googleapis.com') ||
    host.includes('securetoken.googleapis.com') ||
    host.includes('firebaseinstallations.googleapis.com') ||
    host.includes('accounts.google.com') ||
    host === 'www.googleapis.com' ||
    host === 'gmail.googleapis.com'
  ) {
    return true;
  }

  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (isBypassedRequest(url)) return;

  // Cache Google Fonts stylesheets & font files cleanly
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONTS_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response && (response.ok || response.type === 'opaque')) {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return cached || Response.error();
        }
      }),
    );
    return;
  }

  // Only cache same-origin requests
  if (url.origin !== self.location.origin) return;

  // Navigation requests: Network-first with offline app-shell fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(APP_CACHE).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(APP_CACHE);
          return (
            (await cache.match(request)) ||
            (await cache.match('/index.html')) ||
            (await cache.match('/')) ||
            new Response('<h1>التطبيق غير متصل بالإنترنت حالياً</h1>', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }),
    );
    return;
  }

  // Same-origin static assets: Stale-While-Revalidate
  event.respondWith(
    caches.open(APP_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        return cached;
      }

      const networkResponse = await networkPromise;
      return networkResponse || Response.error();
    }),
  );
});
