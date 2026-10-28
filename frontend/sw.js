/* The document CSP stays connect-src 'none'. Cache API requests are same-origin only. */
const CACHE = 'sheet-merger-__VERSION__';
const PRECACHE = __PRECACHE__;
// Embedding immutable build bytes avoids Cache.addAll/fetch, which connect-src 'none'
// correctly blocks inside a service worker too. No CSP exception is needed for sw.js.
const EMBEDDED = __EMBEDDED__;
const CSP = "default-src 'self'; connect-src 'none'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    for (const [path, type, bytes] of EMBEDDED) {
      await cache.put(path, new Response(Uint8Array.from(atob(bytes), c=>c.charCodeAt(0)), {headers:{'Content-Type':type,'Content-Security-Policy':CSP}}));
    }
  })());
  // Do not skipWaiting: an open batch must never be interrupted by an update.
});
self.addEventListener('activate', event => {
  // Older caches are retained while an older tab could still need its hashed modules.
  // They contain application assets only, never spreadsheets or personal data.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) { await cache.put('/index.html', response.clone()); return response; }
      } catch { /* Offline: the installed application shell remains available. */ }
      return (await cache.match('/index.html')) || Response.error();
    })());
  } else if (PRECACHE.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE), hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
      return response;
    })());
  }
});
