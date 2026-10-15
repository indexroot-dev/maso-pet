// Utilidades compartidas por todas las páginas

async function api(url, opciones = {}) {
  const res = await fetch(url, {
    ...opciones,
    headers: { 'Content-Type': 'application/json' },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(datos?.error || 'Ocurrió un error, intenta nuevamente');
  return datos;
}

function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function datosFormulario(form) {
  const datos = Object.fromEntries(new FormData(form));
  form.querySelectorAll('input[type="checkbox"]').forEach((c) => { datos[c.name] = c.checked; });
  return datos;
}

function mostrarAviso(elemento, mensaje, tipo = 'error') {
  elemento.textContent = mensaje;
  elemento.className = `aviso ${tipo === 'error' ? 'error' : ''}`;
}

function formatearFecha(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// Edad legible a partir de una fecha YYYY-MM-DD
function edad(fechaNacimiento) {
  if (!fechaNacimiento) return '';
  const nac = new Date(fechaNacimiento + 'T00:00');
  const hoy = new Date();
  let meses = (hoy.getFullYear() - nac.getFullYear()) * 12 + hoy.getMonth() - nac.getMonth();
  if (hoy.getDate() < nac.getDate()) meses--;
  if (meses < 0) return '';
  if (meses < 12) return `${meses} mes${meses === 1 ? '' : 'es'}`;
  const anios = Math.floor(meses / 12);
  return `${anios} año${anios === 1 ? '' : 's'}`;
}

const ICONOS_ESPECIE = { perro: '🐶', gato: '🐱', ave: '🐦', conejo: '🐰', roedor: '🐹', reptil: '🦎', otro: '🐾' };

// Datos para pasear en grupo
const TAMANOS = { pequeno: 'Pequeño', mediano: 'Mediano', grande: 'Grande' };
const CARACTERES = {
  sociable: 'Sociable con otras mascotas',
  selectivo: 'Se lleva bien con algunas',
  timido: 'Tímido, necesita espacio',
  no_sociable: 'Prefiere no juntarse con otras',
};
const HORARIOS = { manana: '🌅 Mañana', tarde: '☀️ Tarde', noche: '🌙 Noche', fines: '📆 Fines de semana' };
const ESPECIES = { perro: 'Perro', gato: 'Gato', ave: 'Ave', conejo: 'Conejo', roedor: 'Roedor', reptil: 'Reptil', otro: 'Otro' };
const SERVICIOS = { paseo: '🦮 Paseos', cuidado: '🏡 Cuidado en mi casa', visita: '🚪 Visitas a domicilio', guarderia: '☀️ Guardería de día' };
const TIPOS_EVENTO = { feria: '🎪 Feria', vacunacion: '💉 Vacunación', encuentro: '🐕 Encuentro', adopcion: '🏠 Jornada de adopción', taller: '🎓 Taller o charla', otro: '📌 Otro' };
const ESTADOS_ADOPCION = { disponible: 'Disponible', en_proceso: 'En proceso', adoptado: '¡Adoptado! 🎉' };

// Ubicación del navegador como promesa
function ubicacionNavegador() {
  return new Promise((resolver, rechazar) => {
    if (!navigator.geolocation) return rechazar(new Error('Tu navegador no permite obtener la ubicación'));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolver({ lat: coords.latitude, lng: coords.longitude }),
      () => rechazar(new Error('No pudimos obtener tu ubicación. Revisa los permisos del navegador.')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

// Mapa pequeño para elegir un punto (requiere Leaflet en la página)
function mapaSelector(id, alElegir, centro = [-33.4372, -70.6206]) {
  const mapa = L.map(id).setView(centro, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  let marcador = null;
  const marcar = (latlng, centrar = false) => {
    if (marcador) marcador.setLatLng(latlng);
    else marcador = L.marker(latlng).addTo(mapa);
    if (centrar) mapa.setView(latlng, 15);
    alElegir(latlng);
  };
  mapa.on('click', (e) => marcar(e.latlng));
  return { mapa, marcar, limpiar: () => { marcador?.remove(); marcador = null; } };
}

const textoDistanciaAprox = (km) => (km == null ? '' : km <= 0.5 ? 'a menos de 1 km' : `a ~${String(km).replace('.', ',')} km`);

// Foto de la mascota o, si no tiene, el emoji de su especie
function avatarMascota(m, clase = '') {
  return m.foto
    ? `<img class="foto-mascota ${clase}" src="/fotos/${encodeURIComponent(m.foto)}" alt="Foto de ${esc(m.nombre)}">`
    : `<div class="foto-mascota sin-foto ${clase}" aria-hidden="true">${ICONOS_ESPECIE[m.especie] || '🐾'}</div>`;
}

// Reduce la imagen en el navegador antes de subirla (más rápido y liviano)
function redimensionarImagen(archivo, maximo = 900) {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maximo / Math.max(img.width, img.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(img.width * escala);
      lienzo.height = Math.round(img.height * escala);
      lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(img.src);
      resolver(lienzo.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => rechazar(new Error('No pudimos leer la imagen. Prueba con una foto JPG o PNG.'));
    img.src = URL.createObjectURL(archivo);
  });
}

// Distancia en km entre dos puntos {lat, lng}
function distanciaKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const textoDistancia = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toLocaleString('es-CL', { maximumFractionDigits: 1 })} km`);

// ★★★★☆ con texto accesible
function estrellas(valor) {
  const llenas = Math.round(valor || 0);
  return `<span class="estrellas" aria-label="${valor || 0} de 5 estrellas">${'★'.repeat(llenas)}<span class="vacias">${'★'.repeat(5 - llenas)}</span></span>`;
}

const PAGINAS_COMUNIDAD = ['paseos.html', 'paseo.html', 'perdidas.html', 'adopciones.html', 'adopcion.html', 'cuidadores.html', 'cuidador.html', 'eventos.html'];

// Cierra el menú "Comunidad" al hacer clic fuera
document.addEventListener('click', (e) => {
  const menu = document.querySelector('.menu-comunidad[open]');
  if (menu && !menu.contains(e.target)) menu.removeAttribute('open');
});

async function iniciarNav() {
  const usuario = await api('/api/auth/me').catch(() => null);
  const nav = document.getElementById('nav');
  if (!nav) return usuario;
  const pagina = location.pathname.split('/').pop() || 'index.html';
  const enlace = (href, texto) => `<a href="${href}" class="${pagina === href ? 'activo' : ''}">${texto}</a>`;

  nav.innerHTML = `
    <a class="logo" href="index.html" aria-label="MasoPet, inicio"><img src="logo-huella.png" alt=""><span class="maso">MASO</span><span class="pet">PET</span></a>
    <nav>
      ${usuario
        ? `${enlace('mapa.html', 'Mapa')}
           ${enlace('mascotas.html', 'Mis mascotas')}
           <details class="menu-comunidad">
             <summary class="${PAGINAS_COMUNIDAD.includes(pagina) ? 'activo' : ''}">Comunidad</summary>
             <div class="submenu">
               ${enlace('paseos.html', '🦮 Paseos en compañía')}
               ${enlace('perdidas.html', '🚨 Mascotas perdidas')}
               ${enlace('adopciones.html', '🏠 Adopciones')}
               ${enlace('cuidadores.html', '🤝 Paseadores y cuidadores')}
               ${enlace('eventos.html', '📅 Eventos')}
             </div>
           </details>
           ${usuario.rol === 'admin' ? enlace('admin.html', '🛡️ Admin') : ''}
           ${enlace('cuenta.html', `👤 ${esc(usuario.nombre.split(' ')[0])}`)}
           <button id="btn-salir" type="button">Salir</button>`
        : `${enlace('login.html', 'Iniciar sesión')}
           <a class="btn chico" href="registro.html">Crear cuenta</a>`}
    </nav>`;

  document.getElementById('btn-salir')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = 'index.html';
  });
  return usuario;
}

// ---------- Reportar contenido ----------
const MOTIVOS_REPORTE = {
  falso: 'Información falsa o engañosa',
  no_admite: 'Ya no admite mascotas / no existe',
  ofensivo: 'Contenido ofensivo o inapropiado',
  spam: 'Spam o publicidad',
  otro: 'Otro motivo',
};
const NOMBRE_TIPO = { lugar: 'este lugar', resena: 'esta reseña', perdida: 'este aviso', paseo: 'este paseo', comentario: 'este mensaje', adopcion: 'esta publicación', cuidador: 'este perfil', resena_cuidador: 'esta reseña', evento: 'este evento' };

function abrirReporte(tipo, objetoId, titulo) {
  document.getElementById('dialogo-reporte')?.remove();
  const motivos = Object.entries(MOTIVOS_REPORTE).filter(([clave]) => tipo === 'lugar' || clave !== 'no_admite');
  const dialogo = document.createElement('dialog');
  dialogo.id = 'dialogo-reporte';
  dialogo.className = 'dialogo';
  dialogo.innerHTML = `
    <form>
      <h2>🚩 Reportar ${NOMBRE_TIPO[tipo]}</h2>
      <p class="sutil">${esc(titulo)}</p>
      <div class="aviso-reporte"></div>
      <fieldset class="motivos">
        <legend>¿Qué problema tiene?</legend>
        ${motivos.map(([clave, texto], i) => `<label class="check"><input type="radio" name="motivo" value="${clave}" ${i ? '' : 'required'}> ${texto}</label>`).join('')}
      </fieldset>
      <label>Detalle (opcional)<textarea name="detalle" maxlength="1000" placeholder="Cuéntanos más para revisarlo mejor"></textarea></label>
      <div class="acciones" style="margin-top: 1rem">
        <button class="btn" type="submit">Enviar reporte</button>
        <button class="btn sec" type="button" data-cerrar>Cancelar</button>
      </div>
    </form>`;
  document.body.append(dialogo);
  const form = dialogo.querySelector('form');
  const aviso = dialogo.querySelector('.aviso-reporte');
  dialogo.querySelector('[data-cerrar]').addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('close', () => dialogo.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { mensaje } = await api('/api/reportes', { method: 'POST', body: { tipo, objeto_id: objetoId, ...datosFormulario(form) } });
      form.innerHTML = `<h2>✅ Reporte enviado</h2><p>${esc(mensaje)}</p><button class="btn" type="button" data-cerrar>Cerrar</button>`;
      form.querySelector('[data-cerrar]').addEventListener('click', () => dialogo.close());
    } catch (err) {
      mostrarAviso(aviso, err.message);
    }
  });
  dialogo.showModal();
}

// Para páginas privadas: redirige al login si no hay sesión
async function requerirSesion() {
  const usuario = await usuarioActual;
  if (!usuario) location.href = `login.html?volver=${encodeURIComponent(location.pathname.slice(1) + location.search)}`;
  return usuario;
}

const usuarioActual = iniciarNav();

// Permite instalar MasoPet como app en el celular o computador
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
