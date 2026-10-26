const $ = (id) => document.getElementById(id);
const form = $('form-perdida');
let mapaReporte = null;
let marcador = null;

const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};

function enlaceTelefono(contacto) {
  const numero = contacto.replace(/[^\d+]/g, '');
  return numero.replace(/\D/g, '').length >= 8
    ? `<a href="tel:${esc(numero)}">${esc(contacto)}</a>`
    : esc(contacto);
}

function tarjeta(p) {
  const encontrada = p.estado === 'encontrada';
  return `<article class="tarjeta aviso-perdida ${encontrada ? 'encontrada' : ''}" id="aviso-${p.id}">
    <div class="aviso-foto">
      ${avatarMascota(p)}
      <span class="sello">${encontrada ? '🎉 ¡En casa!' : 'SE BUSCA'}</span>
    </div>
    <div class="aviso-cuerpo">
      <h3>${esc(p.nombre)}</h3>
      <div class="sutil">${esc([p.especie, p.raza, p.sexo, p.color].filter(Boolean).join(' · '))}</div>
      <p>${encontrada ? `Volvió a casa el ${formatearFecha(p.encontrada_en.slice(0, 10))}` : `Perdido el <strong>${formatearFecha(p.fecha)}</strong>`}</p>
      ${!encontrada && p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}
      ${encontrada ? '' : `
        <p>📞 ${enlaceTelefono(p.contacto)} <span class="sutil">· ${esc(p.tutor)}</span></p>
        <p><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}">📍 Dónde se vio por última vez</a></p>`}
      ${p.propia ? `<div class="acciones">
        ${encontrada ? '' : `<button class="btn chico" data-encontrada="${p.id}">🎉 ¡Ya apareció!</button>`}
        <button class="btn peligro chico" data-eliminar="${p.id}">Eliminar aviso</button>
      </div>` : `<button type="button" class="enlace-reporte" data-reportar="${p.id}" data-nombre="${esc(p.nombre)}">🚩 Reportar aviso</button>`}
    </div>
  </article>`;
}

async function cargar() {
  const avisos = await api('/api/perdidas');
  const activos = avisos.filter((p) => p.estado === 'perdida');
  const reencuentros = avisos.filter((p) => p.estado === 'encontrada');
  $('activos').innerHTML = activos.map(tarjeta).join('')
    || '<p class="vacio">No hay mascotas perdidas reportadas. ¡Buenas noticias! 🐾</p>';
  $('reencuentros').innerHTML = reencuentros.map(tarjeta).join('');
  $('seccion-reencuentros').classList.toggle('oculto', !reencuentros.length);
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: 'center' });
}

async function abrirFormulario() {
  const [mascotas, avisos] = await Promise.all([api('/api/mascotas'), api('/api/perdidas')]);
  const conAviso = new Set(avisos.filter((p) => p.propia && p.estado === 'perdida').map((p) => p.mascota_id));
  const disponibles = mascotas.filter((m) => !conAviso.has(m.id));
  $('select-mascota').innerHTML = disponibles.map((m) => `<option value="${m.id}">${ICONOS_ESPECIE[m.especie] || '🐾'} ${esc(m.nombre)}</option>`).join('');
  $('sin-mascotas').hidden = disponibles.length > 0;

  form.classList.remove('oculto');
  form.fecha.value = hoyISO();
  if (!mapaReporte) {
    mapaReporte = L.map('mapa-reporte').setView([-33.4372, -70.6206], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapaReporte);
    mapaReporte.on('click', (e) => marcar(e.latlng));
    centrarEnUbicacion(mapaReporte, { sinMover: () => Boolean(marcador) });
  }
  setTimeout(() => mapaReporte.invalidateSize(), 50);
  form.scrollIntoView({ behavior: 'smooth' });
}

function marcar(latlng) {
  form.lat.value = latlng.lat.toFixed(6);
  form.lng.value = latlng.lng.toFixed(6);
  if (marcador) marcador.setLatLng(latlng);
  else marcador = L.marker(latlng).addTo(mapaReporte);
  $('ayuda-mapa').textContent = '✅ Lugar marcado (toca de nuevo para moverlo).';
}

function cerrarFormulario() {
  form.classList.add('oculto');
  form.reset();
  if (marcador) marcador.remove();
  marcador = null;
  $('ayuda-mapa').textContent = 'Toca el mapa donde se vio por última vez.';
}

// ---------- Eventos ----------
$('btn-reportar').addEventListener('click', abrirFormulario);
$('btn-cancelar').addEventListener('click', cerrarFormulario);

$('btn-mi-ubicacion').addEventListener('click', () => {
  navigator.geolocation?.getCurrentPosition(
    ({ coords }) => {
      const latlng = L.latLng(coords.latitude, coords.longitude);
      mapaReporte.setView(latlng, 16);
      marcar(latlng);
    },
    () => alert('No pudimos obtener tu ubicación'),
  );
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form.mascota_id.value) return mostrarAviso($('aviso-perdida'), 'Primero registra a tu mascota en "Mis mascotas"');
  if (!form.lat.value) return mostrarAviso($('aviso-perdida'), 'Marca en el mapa dónde se vio por última vez');
  try {
    const { id } = await api('/api/perdidas', { method: 'POST', body: datosFormulario(form) });
    cerrarFormulario();
    location.hash = `aviso-${id}`;
    await cargar();
  } catch (err) {
    mostrarAviso($('aviso-perdida'), err.message);
  }
});

document.querySelector('main').addEventListener('click', async (e) => {
  const encontrada = e.target.closest('[data-encontrada]');
  const eliminar = e.target.closest('[data-eliminar]');
  const reportar = e.target.closest('[data-reportar]');
  if (reportar) abrirReporte('perdida', Number(reportar.dataset.reportar), `Se busca: ${reportar.dataset.nombre}`);
  try {
    if (encontrada && confirm('¡Qué alegría! ¿Marcar el aviso como resuelto?')) {
      await api(`/api/perdidas/${encontrada.dataset.encontrada}/encontrada`, { method: 'PUT' });
      cargar();
    }
    if (eliminar && confirm('¿Eliminar este aviso?')) {
      await api(`/api/perdidas/${eliminar.dataset.eliminar}`, { method: 'DELETE' });
      cargar();
    }
  } catch (err) {
    alert(err.message);
  }
});

requerirSesion().then((u) => u && cargar());
