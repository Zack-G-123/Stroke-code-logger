'use strict';

const CACHE_VERSION = 'stroke-code-logger-offline-v1';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon-64.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

// NIHSS visual cards currently used by the app. They are fetched once while online
// and retained in the service-worker cache so the resource screens remain usable offline.
const EXTERNAL_OFFLINE_ASSETS = [
  'https://static.wixstatic.com/media/69387f_b898656ccda94c4d9ed9d410a06a45a1~mv2.png/v1/fill/w_600%2Ch_454%2Cal_c%2Cq_85%2Cusm_0.66_1.00_0.01%2Cenc_avif%2Cquality_auto/best-language-image-1-tiny.png',
  'https://static.wixstatic.com/media/69387f_e4aeac7e23634e089b65f8788c1c0056~mv2.png/v1/fill/w_443%2Ch_600%2Cal_c%2Cq_85%2Cusm_0.66_1.00_0.01%2Cenc_avif%2Cquality_auto/best-language-image-2-tiny.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const appCache = await caches.open(APP_CACHE);
    await appCache.addAll(APP_ASSETS);

    // Cross-origin image responses are opaque, so cache them individually instead
    // of using addAll(). A failed optional image must not prevent app installation.
    const runtimeCache = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(EXTERNAL_OFFLINE_ASSETS.map(async url => {
      const request = new Request(url, { mode: 'no-cors', cache: 'reload' });
      const response = await fetch(request);
      await runtimeCache.put(request, response);
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([APP_CACHE, RUNTIME_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('stroke-code-logger-') && !keep.has(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isNavigation = request.mode === 'navigate';
  const isSameOrigin = url.origin === self.location.origin;

  if (isNavigation) {
    // Prefer the newest online app shell, but launch instantly from cache offline.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          const cache = await caches.open(APP_CACHE);
          cache.put('./index.html', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (_) {
        return (await caches.match(request)) || (await caches.match('./index.html')) || (await caches.match('./'));
      }
    })());
    return;
  }

  // Local app assets: cache-first for reliable offline launch; refresh cache online.
  if (isSameOrigin) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) {
        fetch(request).then(async fresh => {
          if (fresh && fresh.ok) {
            const cache = await caches.open(APP_CACHE);
            await cache.put(request, fresh);
          }
        }).catch(() => {});
        return cached;
      }
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          const cache = await caches.open(APP_CACHE);
          await cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (_) {
        return Response.error();
      }
    })());
    return;
  }

  // Cross-origin resources (notably the NIHSS cards): network-first so updates are
  // picked up when online, with the device cache as the offline fallback.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, fresh.clone());
      return fresh;
    } catch (_) {
      const cached = await caches.match(request);
      return cached || Response.error();
    }
  })());
});
