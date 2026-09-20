const SHELL_CACHE = 'shoppos-shell-v1';
const IMAGE_CACHE = 'shoppos-images-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/js/env.js',
  '/js/utils.js',
  '/js/data-cache.js',
  '/js/app.js',
  '/js/offline-store.js',
  '/js/offline-queue.js',
  '/js/supabase-bootstrap.js',
  '/js/api.js',
  '/css/pos-till.css'
];

function isImageRequest(url) {
  const path = url.pathname;
  return path.startsWith('/api/product-image/')
    || path.startsWith('/api/combo-image/')
    || path.startsWith('/api/app-image');
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_ASSETS.filter(Boolean)).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch (_) { return; }

  if (isImageRequest(url)) {
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
    return;
  }

  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(e.request);
      try {
        const resp = await fetch(e.request);
        if (resp.ok) cache.put(e.request, resp.clone());
        return resp;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    })());
  }
});
