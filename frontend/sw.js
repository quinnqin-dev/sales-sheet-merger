/* The document CSP stays connect-src 'none'. Cache API requests are same-origin only. */
const CACHE = "sheet-merger-__VERSION__";
const PRECACHE = __PRECACHE__;
// Embedding immutable build bytes avoids Cache.addAll/fetch, which connect-src 'none'
// correctly blocks inside a service worker too. No CSP exception is needed for sw.js.
const EMBEDDED = __EMBEDDED__;
const CSP =
  "default-src 'self'; connect-src 'none'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const [path, type, bytes] of EMBEDDED) {
        await cache.put(
          path,
          new Response(
            Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)),
            {
              headers: { "Content-Type": type, "Content-Security-Policy": CSP },
            },
          ),
        );
      }
    })(),
  );
  // Do not skipWaiting: an open batch must never be interrupted by an update.
});
self.addEventListener("activate", (event) => {
  // Older caches are retained while an older tab could still need its hashed modules.
  // They contain application assets only, never spreadsheets or personal data.
  event.waitUntil(
    (async () => {
      // The browser performs this navigation request, so no connect-src exception
      // is needed inside the service worker. Keep assets on script/style-src self.
      if (self.registration.navigationPreload)
        await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.searchParams.has("sheet-merger-network")
  )
    return;
  if (
    request.mode === "navigate" &&
    ["/", "/index.html"].includes(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const response = await Promise.race([
            event.preloadResponse,
            // Some engines leave the preload pending after going offline.
            new Promise((resolve) =>
              setTimeout(() => resolve(undefined), 1500),
            ),
          ]);
          if (response?.ok) {
            const html = await response.clone().text();
            const assets = [
              ...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g),
            ].map((m) => m[1]);
            // Keep the installed application until its matching update is accepted.
            // Serving newer HTML with unavailable new chunks would break offline use.
            if (assets.some((path) => !PRECACHE.includes(path)))
              return (await cache.match("/index.html")) || response;
            await cache.put("/index.html", response.clone());
            return response;
          }
        } catch {
          /* Offline: the installed application shell remains available. */
        }
        return (await cache.match("/index.html")) || Response.error();
      })(),
    );
  } else if (
    PRECACHE.includes(url.pathname) ||
    /^\/assets\/[^/]+-[^/]+\.(js|css)$/.test(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE),
          hit = (await cache.match(request)) || (await caches.match(request));
        if (hit) return hit;
        // An evicted asset falls back through the browser's native script/style
        // loader instead of a worker fetch blocked by connect-src 'none'.
        const direct = new URL(request.url);
        direct.searchParams.set("sheet-merger-network", "1");
        return Response.redirect(direct.href, 307);
      })(),
    );
  }
});
