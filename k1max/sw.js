/* Çevrimdışı çalışma: uygulama dosyalarını ve sabit sürümlü kütüphaneleri önbelleğe alır. */
const VERSION = 'k1max-v8';
const APP = [
  './', './index.html', './style.css', './app.js', './presets.js', './slicer-core.js', './slicer-worker.js', './threemf.js', './project3mf.js', './meshrepair.js', './bed-model.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/STLLoader.js',
  'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP.concat(LIBS))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'cdn.jsdelivr.net') {
    // sürüm sabit: önce önbellek
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  // uygulama dosyaları: önce ağ (güncel kalsın), ağ yoksa önbellek
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
