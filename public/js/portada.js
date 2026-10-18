// Los usuarios con sesión van directo a sus mascotas
usuarioActual.then((u) => { if (u) location.replace('mascotas.html'); });

enlacesPublicos.then((enlaces) => {
  if (pintarRedes(document.getElementById('redes'), enlaces)) document.getElementById('siguenos').classList.remove('oculto');
}).catch(() => {});

// Contador de usuarios registrados (sube desde 0 hasta el total)
api('/api/estadisticas').then(({ usuarios }) => {
  if (!usuarios) return;
  const numero = document.getElementById('total-usuarios');
  document.getElementById('texto-usuarios').textContent = usuarios === 1
    ? 'persona ya cuida a su mascota con MasoPet 🐾'
    : 'personas ya cuidan a sus mascotas con MasoPet 🐾';
  document.getElementById('contador-usuarios').classList.remove('oculto');

  const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duracion = reducirMovimiento ? 0 : 1200;
  const inicio = performance.now();
  const animar = (ahora) => {
    const avance = duracion ? Math.min(1, (ahora - inicio) / duracion) : 1;
    numero.textContent = Math.round(usuarios * (1 - (1 - avance) ** 3)).toLocaleString('es-CL');
    if (avance < 1) requestAnimationFrame(animar);
  };
  requestAnimationFrame(animar);
}).catch(() => {});

// "localhost" no sirve desde el celular: en ese caso se usa la IP de este computador en la red
async function urlParaQr() {
  const esLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!esLocal) return { url: `${location.origin}/`, esLocal };
  const { urlApp } = await api('/api/info').catch(() => ({}));
  return { url: `${urlApp || location.origin}/`, esLocal };
}

urlParaQr().then(({ url, esLocal }) => {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  document.getElementById('qr').innerHTML = qr.createSvgTag(6, 2);

  const enlace = document.getElementById('qr-url');
  enlace.href = url;
  enlace.textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  document.getElementById('aviso-local').classList.toggle('oculto', !esLocal);
});

// Botón de descarga del APK, solo si ya fue construido (android/construir-apk.ps1)
fetch('descargas/MasoPet.apk', { method: 'HEAD' }).then((r) => {
  if (!r.ok) return;
  document.getElementById('btn-apk').classList.remove('oculto');
  document.getElementById('ayuda-apk').classList.remove('oculto');
}).catch(() => {});

// Botón "Instalar" para navegadores que lo permiten (Chrome, Edge, Android)
let eventoInstalar = null;
const btnInstalar = document.getElementById('btn-instalar');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  eventoInstalar = e;
  btnInstalar.classList.remove('oculto');
});

btnInstalar.addEventListener('click', async () => {
  if (!eventoInstalar) return;
  eventoInstalar.prompt();
  await eventoInstalar.userChoice;
  eventoInstalar = null;
  btnInstalar.classList.add('oculto');
});

window.addEventListener('appinstalled', () => btnInstalar.classList.add('oculto'));
