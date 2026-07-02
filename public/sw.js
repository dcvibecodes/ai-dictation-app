const CACHE_NAME = 'dictation-v4';
const STATIC_ASSETS = [
  '/',
  '/styles.css',
  '/script.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache API calls or auth pages
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/upload') ||
      url.pathname.startsWith('/cleanup') ||
      url.pathname.startsWith('/prompts') ||
      url.pathname.startsWith('/login') ||
      url.pathname.startsWith('/setup') ||
      url.pathname.startsWith('/logout') ||
      e.request.method !== 'GET') {
    return;
  }

  // Network-first for HTML, cache-first for assets
  if (e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
