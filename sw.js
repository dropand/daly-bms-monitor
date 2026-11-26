// Кэш для офлайн-запуска: страница, манифест, значки. Данные BMS идут по Bluetooth, сеть не нужна.
const CACHE = 'daly-bms-v23';
const FILES = [
  './',
  'index.html',
  'app.css?v=23',
  'src/proto.js',
  'src/math.js',
  'src/store.js',
  'src/charts.js',
  'src/ui.js',
  'src/demo.js',
  'src/app.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png'
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    if (r && r.ok && r.type === 'basic') {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(m => m || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
