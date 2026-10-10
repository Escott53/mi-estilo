// Service worker de Mi Estilo: network-first para los archivos de la app (siempre la última versión
// si hay conexión) y caché como respaldo sin conexión. Nunca intercepta las llamadas a OpenAI.
const CACHE_VERSION = 'mi-estilo-v1.0.0';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.json',
  './js/app.js', './js/api.js', './js/db.js', './js/image.js', './js/prompts.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // api.openai.com y demás: directo a la red
  e.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req.mode === 'navigate' ? './index.html' : req, res.clone());
      return res;
    } catch (_) {
      const hit = await cache.match(req.mode === 'navigate' ? './index.html' : req, { ignoreSearch: true });
      return hit || (await cache.match('./index.html')) || Response.error();
    }
  })());
});
