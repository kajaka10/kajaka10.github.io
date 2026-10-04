/* Słoik – service worker: wszystkie pliki w pamięci telefonu, działa offline.
   Po KAŻDEJ zmianie plików aplikacji zwiększ numer wersji poniżej (v2 → v3),
   inaczej telefon będzie dalej pokazywał starą wersję. */
const CACHE = 'sloik-v2';

const FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './sync.js',
  './firebase-config.js',
  './vendor/firebase.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Instalacja: pobierz wszystkie pliki do pamięci (zawsze świeże, z pominięciem pamięci przeglądarki)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

// Aktywacja: usuń stare wersje
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Każde żądanie do naszej strony: najpierw z pamięci, dopiero potem z internetu.
// Ruch do Firebase (inne domeny) przechodzi bez zmian.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
