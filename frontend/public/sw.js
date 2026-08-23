const CACHE_VERSION = 'v3';
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
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      void caches.open(cacheName).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = cacheNetworkResponse(request, RUNTIME_CACHE, cached).catch(() => caches.match('/') || Response.error());
        return cached || network;
      }),
    );
    return;
  }

  if (['script', 'style', 'font', 'image'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || cacheNetworkResponse(request, RUNTIME_CACHE)),
    );
  }
});
