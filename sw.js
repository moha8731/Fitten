const VERSION = 'v5.1';
const SHELL = `bulkmind-shell-${VERSION}`;
const RUNTIME = `bulkmind-runtime-${VERSION}`;
const ASSETS = ['./','./index.html','./styles.css','./app.js','./manifest.json','./icon-192.png','./icon-512.png','./offline.html'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => ![SHELL, RUNTIME].includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(RUNTIME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) || (await caches.match('./index.html')) || (await caches.match('./offline.html'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME);
    const cached = await caches.match(req);
    const network = fetch(req).then(response => {
      if (response.ok) cache.put(req, response.clone());
      return response;
    }).catch(() => null);
    return cached || network || Response.error();
  })());
});
