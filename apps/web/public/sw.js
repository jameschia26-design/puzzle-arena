/*
 * The worker keeps static subresources available but deliberately never stores
 * a document: an offline HTML shell from an earlier deploy can refer to a
 * deleted asset hash and leave the user with only the page background.
 * Documents and the worker script always go to the network.
 *
 * This name replaces the previous document cache so activation clears any
 * stale shell already stored on clients. Future deployments remain safe
 * without a cache-name change because HTML is not cached here.
 */
const CACHE = 'puzzle-arena-assets-v2';
const SHELL = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // A failed precache must not block installation.
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live traffic and deployment metadata are never cached by this worker.
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname === '/sw.js'
  ) {
    return;
  }

  // Fingerprinted assets are immutable — cache first, and never re-validate.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // A deployment document must never be served from Cache Storage. Its hashed
  // asset references are valid only for that deployment, so leave navigation
  // handling to the browser's network request.
  if (request.mode === 'navigate') return;

  // Everything else (icons, fonts): cache first, refresh in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit ?? network;
    }),
  );
});
