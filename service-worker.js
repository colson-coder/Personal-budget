// =============================================================================
// service-worker.js — Caches the app shell (HTML/CSS/JS/manifest/icons) so the
// app opens even offline. Requests go to the network first so every deploy
// shows up right away; the cache is only the offline fallback.
//
// IMPORTANT: We deliberately do NOT cache Supabase or ExchangeRate-API
// responses — financial data and rates must stay live. Only same-origin static
// shell files are cached.
//
// ON DEPLOY: bump CACHE_VERSION so clients drop the old shell and pick up your
// changes instead of being stuck behind a stale cache.
// =============================================================================

const CACHE_VERSION = 'pb-shell-v10';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/finance.js',
  './js/icons.js',
  './js/nav.js',
  './js/rates.js',
  './js/recurring.js',
  './js/router.js',
  './js/store.js',
  './js/theme.js',
  './js/util.js',
  './js/views/add.js',
  './js/views/auth.js',
  './js/views/categories.js',
  './js/views/dashboard.js',
  './js/views/debts.js',
  './js/views/funds.js',
  './js/views/import.js',
  './js/views/income.js',
  './js/views/more.js',
  './js/views/plan.js',
  './js/views/quick.js',
  './js/views/reports.js',
  './js/views/settings.js',
  './js/views/taxes.js',
  './js/views/setup.js',
  './js/views/transactions.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon-180.png',
];

// Pre-cache the shell on install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// Drop old cache versions on activate.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept cross-origin requests (Supabase, ExchangeRate-API, the
  // Supabase ESM CDN). Let them hit the network directly — data stays live.
  if (url.origin !== self.location.origin) return;

  // Same-origin: network-first. Users always get the newest version when
  // online (no stale app after a deploy); the cache is the offline fallback.
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
