const IMAGE_CACHE = 'shop-order-images-v2';

function isMenuImageRequest(url) {
  const path = url.pathname;
  return path.startsWith('/api/product-image/')
    || path.startsWith('/api/combo-image/')
    || path.startsWith('/api/app-image');
}

self.addEventListener('install', (e) => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch (_) { return; }
  if (!isMenuImageRequest(url)) return;

  e.respondWith((async () => {
    const cache = await caches.open(IMAGE_CACHE);
    const cached = await cache.match(e.request);
    if (cached) return cached;
    try {
      const resp = await fetch(e.request);
      if (resp.ok) cache.put(e.request, resp.clone());
      return resp;
    } catch (err) {
      if (cached) return cached;
      throw err;
    }
  })());
});
