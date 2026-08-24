const CACHE_VERSION = 'v6';
const SHELL_CACHE = `educore-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `educore-runtime-${CACHE_VERSION}`;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![SHELL_CACHE, RUNTIME_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function cacheNetworkResponse(request, cacheName, cached = null) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      const copy = response.clone();
      void caches.open(cacheName).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    return cached || null;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(request) || await caches.match('/');
      const networkPromise = cacheNetworkResponse(request, RUNTIME_CACHE, cached);
      if (cached) {
        // Return the cached shell immediately; update it without delaying navigation.
        event.waitUntil(networkPromise.then(() => undefined));
        return cached;
      }
      return (await networkPromise) || Response.error();
    })());
    return;
  }

  if (['script', 'style', 'font', 'image'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || cacheNetworkResponse(request, RUNTIME_CACHE)),
    );
  }
});
