// Service worker: permite instalar la app y abrir las páginas sin conexión.
// Los datos de /api nunca se guardan en caché (son privados de cada usuario).
const CACHE = 'masopet-v16';
const ARCHIVOS = [
  '/', '/index.html', '/mapa.html', '/login.html', '/registro.html', '/verificar.html', '/mascotas.html', '/ficha.html', '/libro.html',
  '/perdidas.html', '/cuenta.html', '/olvide.html', '/restablecer.html', '/admin.html', '/paseos.html', '/paseo.html',
  '/adopciones.html', '/adopcion.html', '/cuidadores.html', '/cuidador.html', '/eventos.html', '/notificaciones.html', '/apoyar.html',
  '/css/styles.css', '/js/comun.js', '/js/mapa.js', '/js/auth.js', '/js/mascotas.js', '/js/ficha.js', '/js/libro.js',
  '/js/perdidas.js', '/js/cuenta.js', '/js/admin.js', '/js/paseos.js', '/js/paseo.js',
  '/js/adopciones.js', '/js/adopcion.js', '/js/cuidadores.js', '/js/cuidador.js', '/js/eventos.js', '/js/notificaciones.js', '/js/apoyar.js',
  '/manifest.webmanifest', '/icons/icono-192.png', '/logo.png', '/logo-huella.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Primero la red (para tener siempre lo último) y, si no hay conexión, la copia guardada
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
