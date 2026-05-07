'use strict';

const CACHE = 'servicepulse-v5';
const PRECACHE = [
  '/?sw=v5',
  '/manifest.json',
  '/icon.png',
  '/offline',
];

// Track the last known waiting SW URL so the banner shows on every update,
// not just the first one after page load.
let lastWaitingSWUrl = null;

// Listen for new SW activation to update our tracked URL
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
  // New SW took control — update tracked URL so next comparison works
  self.clients.matchAll().then(clients => {
    for (const client of clients) {
      client.postMessage({ type: 'SW_ACTIVATED', url: self.scriptURL });
    }
  });
});

// Serve offline fallback for failed navigations to HTML pages
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') return;

  // Dynamic APIs → network-first, fall back to cache
  if (url.hostname.includes('reddit.com') ||
      url.hostname.includes('downdetector.com') ||
      url.hostname.includes('statuspage') ||
      url.hostname.includes('status.io')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // HTML navigation → network, offline fallback on failure
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/offline').then(r => r || new Response(
          '<html><body style="font-family:sans-serif;padding:40px;color:#666"><h2>You\'re offline</h2><p>ServicePulse needs a connection to fetch the latest status. Check your network and reload.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        ))
      )
    );
    return;
  }

  // Static assets → cache-first, network on miss
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

// Handle messages from the page (e.g., SKIP_WAITING, SW_ACTIVATED)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'SW_ACTIVATED') {
    lastWaitingSWUrl = event.data.url;
  }
});
