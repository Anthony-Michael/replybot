/**
 * Offline shell.
 *
 * A job site is exactly where the signal is worst, so the app has to open and
 * work with no network at all. Nothing here talks to a server — there is no
 * server — so the cache is the whole story.
 */

const VERSION = 'shiftsense-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/app/styles.css',
  './src/app/main.js',
  './src/app/ui.js',
  './src/app/tracker.js',
  './src/core/engine.js',
  './src/core/geo.js',
  './src/core/hours.js',
  './src/core/places.js',
  './src/core/records.js',
  './src/core/sessions.js',
  './src/core/settings.js',
  './src/core/store.js',
  './src/core/time.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Cache first, then network — and when a fresh copy does arrive, keep it for
  // next time so an update lands without the user knowing there was one.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const live = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? live;
    }),
  );
});
