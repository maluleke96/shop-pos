self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(clients.claim()); });

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/manager/';
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      try {
        const url = new URL(client.url);
        if (url.pathname.startsWith('/manager')) {
          if ('focus' in client) await client.focus();
          return;
        }
      } catch (_) { /* ignore */ }
    }
    await clients.openWindow(target);
  })());
});
