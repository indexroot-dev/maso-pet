const $ = (id) => document.getElementById(id);
const PESTANAS = ['paseos', 'vecinos', 'perfil'];
const formPaseo = $('form-paseo');
const formPerfil = $('form-perfil');
const CENTRO = [-33.4372, -70.6206];
let ubicacionActual = null;
let invitados = new Map(); // usuario_id -> nombre
let mapaNuevo = null;
let marcadorNuevo = null;
let mapaZona = null;
let marcadorZona = null;

const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};
const textoKm = (km) => (km <= 0.5 ? 'a menos de 1 km' : `a ~${String(km).replace('.', ',')} km`);

function crearMapa(id, alHacerClic) {
  const mapa = L.map(id).setView(CENTRO, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  mapa.on('click', (e) => alHacerClic(e.latlng));
  return mapa;
}

function obtenerUbicacion() {
  return new Promise((resolver, rechazar) => {
    if (!navigator.geolocation) return rechazar(new Error('Tu navegador no permite obtener la ubicación'));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolver({ lat: coords.latitude, lng: coords.longitude }),
      () => rechazar(new Error('No pudimos obtener tu ubicación. Revisa los permisos del navegador.')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

function mascotaMini(m) {
  return `<div class="mascota-mini">
    ${avatarMascota(m)}
    <div>
      <strong>${esc(m.nombre)}</strong>
      <div class="sutil">${esc([m.raza || m.especie, TAMANOS[m.tamano], edad(m.fecha_nacimiento)].filter(Boolean).join(' · '))}</div>
      ${m.caracter ? `<span class="etiqueta caracter-${esc(m.caracter)}">${esc(CARACTERES[m.caracter])}</span>` : ''}
    </div>
  </div>`;
}

// ---------- Pestañas ----------
function mostrarPestana(nombre) {
  if (!PESTANAS.includes(nombre)) nombre = 'paseos';
  document.querySelectorAll('[data-pestana]').forEach((b) => b.setAttribute('aria-selected', b.dataset.pestana === nombre));
  PESTANAS.forEach((p) => $(`pestana-${p}`).classList.toggle('oculto', p !== nombre));
  history.replaceState(null, '', `#${nombre}`);
  ({ paseos: cargarPaseos, vecinos: cargarVecinos, perfil: cargarPerfil })[nombre]();
}

// ---------- Paseos ----------
async function cargarPaseos() {
  const params = new URLSearchParams({ radio: $('radio-paseos').value });
  if (ubicacionActual) { params.set('lat', ubicacionActual.lat); params.set('lng', ubicacionActual.lng); }
  const { paseos, tiene_origen: tieneOrigen } = await api(`/api/paseos?${params}`);
  $('sin-origen').classList.toggle('oculto', tieneOrigen);

  $('lista-paseos').innerHTML = paseos.map((p) => {
    const dia = new Date(`${p.fecha}T00:00`);
    const estado = p.es_organizador ? '<span class="etiqueta">⭐ Organizas</span>'
      : p.mi_estado === 'va' ? '<span class="etiqueta">✅ Vas</span>'
        : p.mi_estado === 'invitado' ? '<span class="etiqueta alerta">💌 Te invitaron</span>' : '';
    return `<a class="tarjeta paseo-tarjeta" href="paseo.html?id=${p.id}">
      <div class="fecha-bloque"><span class="dia">${dia.getDate()}</span><span class="mes-corto">${dia.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '')}</span></div>
      <div class="paseo-info">
        <h3>${esc(p.titulo)} ${p.privado ? '<span title="Privado">🔒</span>' : ''}</h3>
        <div class="sutil">${dia.toLocaleDateString('es-CL', { weekday: 'long' })} · ${esc(p.hora)} · 📍 ${esc(p.punto)}${p.distancia_km != null ? ` · ${String(p.distancia_km).replace('.', ',')} km` : ''}</div>
        <div class="paseo-meta">
          <span class="sutil">Organiza ${esc(p.organizador_nombre)}</span>
          <span class="sutil">· 🐾 ${p.asistentes}${p.cupo ? `/${p.cupo}` : ''} van</span>
          ${estado}
        </div>
      </div>
    </a>`;
  }).join('') || `<div class="tarjeta vacio">No hay paseos próximos ${tieneOrigen ? 'en esta zona' : ''}. ¡Organiza el primero! 🐕</div>`;
}

async function abrirFormularioPaseo() {
  mostrarPestana('paseos');
  formPaseo.classList.remove('oculto');
  formPaseo.fecha.min = hoyISO();
  if (!formPaseo.fecha.value) formPaseo.fecha.value = hoyISO();
  pintarInvitados();
  if (!mapaNuevo) {
    mapaNuevo = crearMapa('mapa-paseo-nuevo', (latlng) => marcarPunto(latlng));
    const lugares = await api('/api/lugares').catch(() => []);
    lugares.sort((a, b) => (b.categoria === 'parque') - (a.categoria === 'parque') || a.nombre.localeCompare(b.nombre));
    $('select-lugar').insertAdjacentHTML('beforeend', lugares.map((l) =>
      `<option value="${l.id}" data-lat="${l.lat}" data-lng="${l.lng}" data-nombre="${esc(l.nombre)}">${l.categoria === 'parque' ? '🌳' : '📍'} ${esc(l.nombre)}</option>`).join(''));
  }
  setTimeout(() => mapaNuevo.invalidateSize(), 50);
  formPaseo.scrollIntoView({ behavior: 'smooth' });
}

function marcarPunto(latlng, centrar = false) {
  formPaseo.lat.value = latlng.lat.toFixed(6);
  formPaseo.lng.value = latlng.lng.toFixed(6);
  if (marcadorNuevo) marcadorNuevo.setLatLng(latlng);
  else marcadorNuevo = L.marker(latlng).addTo(mapaNuevo);
  if (centrar) mapaNuevo.setView(latlng, 16);
  $('ayuda-punto').textContent = '✅ Punto marcado (toca de nuevo para moverlo).';
}

function pintarInvitados() {
  $('invitados').classList.toggle('oculto', !invitados.size);
  $('invitados').innerHTML = `💌 Invitando a: ${[...invitados].map(([id, nombre]) =>
    `<span class="chip activo">${esc(nombre)} <button type="button" data-quitar="${id}" aria-label="Quitar a ${esc(nombre)}">✕</button></span>`).join(' ')}`;
}

function cerrarFormularioPaseo() {
  formPaseo.classList.add('oculto');
  formPaseo.reset();
  invitados = new Map();
  if (marcadorNuevo) marcadorNuevo.remove();
  marcadorNuevo = null;
  $('ayuda-punto').textContent = 'Toca el mapa para marcar el punto exacto de encuentro.';
}

$('select-lugar').addEventListener('change', (e) => {
  const opcion = e.target.selectedOptions[0];
  if (!opcion.value) return;
  formPaseo.punto.value = opcion.dataset.nombre;
  marcarPunto(L.latLng(Number(opcion.dataset.lat), Number(opcion.dataset.lng)), true);
});

$('invitados').addEventListener('click', (e) => {
  const quitar = e.target.closest('[data-quitar]');
  if (!quitar) return;
  invitados.delete(Number(quitar.dataset.quitar));
  pintarInvitados();
});

formPaseo.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!formPaseo.lat.value) return mostrarAviso($('aviso-paseo'), 'Marca el punto de encuentro en el mapa o elige un lugar de la lista');
  try {
    const datos = datosFormulario(formPaseo);
    const { id } = await api('/api/paseos', { method: 'POST', body: { ...datos, invitados: [...invitados.keys()] } });
    location.href = `paseo.html?id=${id}`;
  } catch (err) {
    mostrarAviso($('aviso-paseo'), err.message);
  }
});

$('btn-organizar').addEventListener('click', abrirFormularioPaseo);
$('btn-cancelar-paseo').addEventListener('click', cerrarFormularioPaseo);
$('radio-paseos').addEventListener('change', cargarPaseos);
$('btn-ubicacion').addEventListener('click', async () => {
  try {
    ubicacionActual = await obtenerUbicacion();
    cargarPaseos();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Vecinos ----------
async function cargarVecinos() {
  const { perfil } = await api('/api/paseos/perfil');
  $('vecinos-sin-perfil').classList.toggle('oculto', Boolean(perfil?.activo));
  $('vecinos-con-perfil').classList.toggle('oculto', !perfil?.activo);
  if (!perfil?.activo) return;
  const vecinos = await api(`/api/paseos/vecinos?radio=${$('radio-vecinos').value}`);
  $('lista-vecinos').innerHTML = vecinos.map((v) => `
    <article class="tarjeta vecino">
      <div class="vecino-cabecera">
        <h3>${esc(v.nombre)}</h3>
        <span class="sutil">${textoKm(v.distancia_km)}</span>
      </div>
      ${v.horarios.length ? `<div class="chips">${v.horarios.map((h) => `<span class="chip">${HORARIOS[h]}</span>`).join('')}</div>` : ''}
      ${v.descripcion ? `<p>${esc(v.descripcion)}</p>` : ''}
      <div class="mascotas-vecino">${v.mascotas.map(mascotaMini).join('')}</div>
      <button class="btn chico" type="button" data-invitar="${v.usuario_id}" data-nombre="${esc(v.nombre)}">👋 Invitar a pasear</button>
    </article>`).join('')
    || '<div class="tarjeta vacio">Aún no hay vecinos con perfil de paseo en esta distancia. Prueba con un radio mayor o invita a tus amigos a MasoPet. 🐾</div>';
}

$('radio-vecinos').addEventListener('change', cargarVecinos);
$('lista-vecinos').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-invitar]');
  if (!boton) return;
  invitados.set(Number(boton.dataset.invitar), boton.dataset.nombre);
  abrirFormularioPaseo();
});

// ---------- Mi perfil ----------
async function cargarPerfil() {
  const [{ perfil, mascotas_ids: elegidas }, mascotas] = await Promise.all([api('/api/paseos/perfil'), api('/api/mascotas')]);
  $('mis-mascotas').innerHTML = mascotas.map((m) => `
    <label class="check elegir-mascota">
      <input type="checkbox" name="mascotas" value="${m.id}" ${elegidas.includes(m.id) ? 'checked' : ''}>
      ${mascotaMini(m)}
    </label>`).join('') || '<p class="sutil">Primero <a href="mascotas.html">registra a tu mascota</a>.</p>';

  formPerfil.activo.checked = Boolean(perfil?.activo);
  formPerfil.descripcion.value = perfil?.descripcion || '';
  formPerfil.querySelectorAll('[name="horarios"]').forEach((c) => { c.checked = perfil?.horarios.includes(c.value) || false; });

  if (!mapaZona) mapaZona = crearMapa('mapa-zona', (latlng) => marcarZona(latlng));
  setTimeout(() => mapaZona.invalidateSize(), 50);
  if (perfil?.lat) marcarZona(L.latLng(perfil.lat, perfil.lng), true);
}

function marcarZona(latlng, centrar = false) {
  formPerfil.lat.value = latlng.lat;
  formPerfil.lng.value = latlng.lng;
  if (marcadorZona) marcadorZona.setLatLng(latlng);
  else marcadorZona = L.circle(latlng, { radius: 600, color: '#0f766e', fillOpacity: 0.15 }).addTo(mapaZona);
  if (centrar) mapaZona.setView(latlng, 14);
}

$('btn-zona-ubicacion').addEventListener('click', async () => {
  try {
    const { lat, lng } = await obtenerUbicacion();
    marcarZona(L.latLng(lat, lng), true);
  } catch (err) {
    alert(err.message);
  }
});

formPerfil.addEventListener('submit', async (e) => {
  e.preventDefault();
  const valores = (nombre) => [...formPerfil.querySelectorAll(`[name="${nombre}"]:checked`)].map((c) => c.value);
  try {
    const { activo } = await api('/api/paseos/perfil', {
      method: 'PUT',
      body: {
        activo: formPerfil.activo.checked,
        lat: formPerfil.lat.value ? Number(formPerfil.lat.value) : null,
        lng: formPerfil.lng.value ? Number(formPerfil.lng.value) : null,
        descripcion: formPerfil.descripcion.value,
        horarios: valores('horarios'),
        mascotas: valores('mascotas').map(Number),
      },
    });
    mostrarAviso($('aviso-perfil'), activo ? '¡Listo! Ya apareces para tus vecinos. 🐾' : 'Perfil guardado. No apareces para tus vecinos.', 'ok');
  } catch (err) {
    mostrarAviso($('aviso-perfil'), err.message);
  }
});

// ---------- Inicio ----------
document.querySelector('.pestanas').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-pestana]');
  if (boton) mostrarPestana(boton.dataset.pestana);
});
document.querySelector('main').addEventListener('click', (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) { e.preventDefault(); mostrarPestana(ir.dataset.ir); }
});

requerirSesion().then((u) => u && mostrarPestana(location.hash.slice(1)));
