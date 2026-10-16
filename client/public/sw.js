/* SecureChat service worker
 *  - makes the site installable as an app
 *  - opens instantly and works offline-ish: the app shell is cached, pages are network-first
 *  - NEVER touches the API, the WebSocket or any other website (chat data always comes live from the server)
 */
const VERSION = 'v1';
const SHELL = `securechat-shell-${VERSION}`;
const ASSETS = `securechat-assets-${VERSION}`;
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so a new deploy shows up right away), cached app shell when the network is slow or gone
async function navigate(request) {
  const cache = await caches.open(SHELL);
  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 5000)),
    ]);
    if (fresh && fresh.ok) cache.put('/', fresh.clone()); // every route serves the same single-page app
    return fresh;
  } catch {
    return (await cache.match('/')) || new Response('You are offline. Open SecureChat again when you have a connection.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

// Built files have hashed names, so a cached copy is always correct
async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

// The page tells us which built files it is using, so the app opens offline even right after the first visit
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_URLS' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter((u) => typeof u === 'string' && new URL(u, self.location.origin).origin === self.location.origin);
  event.waitUntil(caches.open(ASSETS).then((cache) => Promise.all(urls.map((u) => cache.add(u).catch(() => {})))));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // other websites (Google sign-in, fonts, the API server): untouched
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  if (request.mode === 'navigate') return event.respondWith(navigate(request));
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    return event.respondWith(cacheFirst(request));
  }
});
