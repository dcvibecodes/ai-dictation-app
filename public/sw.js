// Cache version is bumped on every release. It only exists to purge old shells;
// app code is always fetched network-first so a deploy is live on the next load.
const CACHE_NAME = 'dictation-v22';
const APP_SHELL = [
  '/',
  '/styles.css',
  '/script.js',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

// Never cache these — they must always be fresh (API calls, auth pages, code).
const NEVER_CACHE = [
  '/api/',
  '/upload',
  '/cleanup',
  '/prompts',
  '/login',
  '/setup',
  '/logout',
  '/cleanup-stream',
  '/sw.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
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

  // Only handle same-origin GETs; let everything else hit the network normally.
  if (e.request.method !== 'GET') return;

  const neverCache = NEVER_CACHE.some(p => url.pathname.startsWith(p));
  if (neverCache) return; // default browser fetch — no SW involvement

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

  // Network-first for ALL app code and pages, so a deploy is picked up immediately.
  // The cache is only a fallback for offline use.
  e.respondWith(
    fetch(e.request).then(res => {
      // Only cache successful, basic responses (not opaque/error pages).
      if (res && res.status === 200 && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
