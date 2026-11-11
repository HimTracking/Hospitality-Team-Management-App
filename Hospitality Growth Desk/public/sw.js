const CACHE_NAME = 'maati-living-shell-v4';
const APP_SHELL = [
  '/',
  '/app.css',
  '/polish.css',
  '/mobile.css',
  '/app.js',
  '/ota-platforms.json',
  '/manifest.webmanifest',
  '/icons/maati-living.jpg',
  '/icons/maati-living-192.png',
  '/icons/maati-living-512.png',
  '/icons/maati-living-apple.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/data/')) return;

  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return (await caches.match('/')) || Response.error();
    return Response.error();
  }));
});
