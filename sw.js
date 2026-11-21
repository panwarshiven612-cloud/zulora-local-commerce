const CACHE_NAME = 'zulora-local-v4';
const STATIC_ASSETS = [
  './',
  './index.html',
  './seller.html',
  './orders.html',
  './admin.html',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/modals.css',
  './css/style.css',
  './js/config.js',
  './js/auth.js',
  './js/cart.js',
  './js/firebase-init.js',
  './js/cloudinary.js',
  './js/geo-pricing.js',
  './js/notifications.js',
  './js/pwa.js',
  './js/app.js',
  './js/seller.js',
  './js/orders.js',
  './js/admin.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url)));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('cloudinary') ||
    url.hostname.includes('qrserver') ||
    url.hostname.includes('postimg') ||
    event.request.method !== 'GET'
  ) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((resp) => {
        if (resp && resp.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, resp.clone()));
        }
        return resp;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// Push notification support
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Zulora Local';
  const options = {
    body: data.body || 'You have a new notification',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: data.url || './',
    vibrate: [200, 100, 200]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data || './'));
});
