'use strict';

const CACHE = 'servicepulse-v4';
const PRECACHE = [
  '/?sw=v4',
  '/manifest.json',
  '/icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') return;

  // Dynamic APIs → network-first
  if (url.hostname.includes('reddit.com') || url.hostname.includes('downdetector.com') || url.hostname.includes('status')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // HTML → always network (no cache)
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(fetch(request));
    return;
  }

  // Static → cache-first with network fallback
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
