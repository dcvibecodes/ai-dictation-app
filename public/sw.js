const CACHE_NAME = 'dictation-v16';
const STATIC_ASSETS = [
  '/',
  '/styles.css',
  '/script.js',
  '/login.html',
  '/setup.html',
  '/auth.css',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
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
      url.pathname.startsWith('/cleanup-stream') ||
      e.request.method !== 'GET') {
    return;
  }

  // Cache-first for Google Fonts (stable, long-lived)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // Network-first keeps installed PWAs visually current, with cache fallback offline.
  if (e.request.headers.get('accept')?.includes('text/html') ||
      STATIC_ASSETS.includes(url.pathname)) {
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