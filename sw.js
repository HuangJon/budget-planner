/**
 * Offline support. Keeps a copy of the app's files on the phone. Budget data is not here: the
 * database keeps its own offline copy. Network first, so updates arrive; saved copy when offline.
 * When you add a file under css/ or js/, add it to APP_FILES (a unit test checks this), and bump
 * CACHE together with APP_VERSION in js/config/app.js for every release.
 */
const CACHE = 'wmm-v7';
const APP_FILES = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './js/main.js',
  './css/base.css',
  './css/budget.css',
  './css/screens.css',
  './css/theme.css',
  './css/tokens.css',
  './js/config/app.js',
  './js/config/firebase.js',
  './js/core/budget.js',
  './js/core/categorize.js',
  './js/core/export.js',
  './js/core/import.js',
  './js/core/accounts.js',
  './js/core/search.js',
  './js/core/ids.js',
  './js/core/money.js',
  './js/core/recurring.js',
  './js/core/trends.js',
  './js/core/usage.js',
  './js/data/backend-firebase.js',
  './js/data/backend-local.js',
  './js/data/example.js',
  './js/data/fields.js',
  './js/data/repository.js',
  './js/ui/account.js',
  './js/ui/budget.js',
  './js/ui/cat-edit.js',
  './js/ui/dom.js',
  './js/ui/error-log.js',
  './js/ui/help.js',
  './js/ui/home.js',
  './js/ui/look.js',
  './js/ui/owner.js',
  './js/ui/people.js',
  './js/ui/plan.js',
  './js/ui/state.js',
  './js/ui/transactions.js',
  './js/ui/trends.js',
  './js/ui/tour.js',
  './js/ui/tx-form.js',
  './js/ui/import.js',
  './js/ui/report.js',
  './js/ui/accounts.js',
  './js/ui/idle.js',
  './js/ui/arrange.js',
  './js/ui/search.js',
  './js/ui/updates.js',
];
/** The database code and fonts come from Google and have to work offline too. */
const isCdn = url => (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))
  || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  const mine = url.origin === self.location.origin;
  if (request.method !== 'GET' || !(mine || isCdn(url))) return; // never touches live database traffic
  const saved = () => caches.match(request, { ignoreSearch: mine }).then(hit => hit || (mine ? caches.match('./index.html') : Response.error()));
  event.respondWith(
    fetch(request)
      .then(response => {
        if (!response.ok && response.type !== 'opaque') return saved().then(hit => hit || response);
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(saved),
  );
});
