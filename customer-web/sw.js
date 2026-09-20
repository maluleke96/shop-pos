const IMAGE_CACHE = 'shop-order-images-v3';

function isMenuImageRequest(url) {
  const path = url.pathname;
  return path.startsWith('/api/product-image/')
    || path.startsWith('/api/combo-image/')
    || path.startsWith('/api/app-image');
}

self.addEventListener('install', (e) => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('shop-order-images-') && k !== IMAGE_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch (_) { return; }
  if (!isMenuImageRequest(url)) return;

  e.respondWith((async () => {
    const cache = await caches.open(IMAGE_CACHE);
    const cached = await cache.match(e.request);
    const network = fetch(e.request).then((resp) => {
      if (resp.ok) cache.put(e.request, resp.clone());
      return resp;
    }).catch(() => cached);
    return cached || network;
  })());
});
