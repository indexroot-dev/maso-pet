const CATEGORIAS = {
  restaurante: { nombre: 'Restaurantes', singular: 'Restaurante', icono: '🍽️' },
  cafe: { nombre: 'Cafés', singular: 'Café', icono: '☕' },
  hotel: { nombre: 'Hoteles', singular: 'Hotel', icono: '🏨' },
  parque: { nombre: 'Parques', singular: 'Parque', icono: '🌳' },
  playa: { nombre: 'Playas', singular: 'Playa', icono: '🏖️' },
  tienda: { nombre: 'Tiendas', singular: 'Tienda', icono: '🛍️' },
  veterinaria: { nombre: 'Veterinarias', singular: 'Veterinaria', icono: '🩺' },
  otro: { nombre: 'Otros', singular: 'Otro', icono: '📍' },
};
const ADMITE = { todas: 'Todas las mascotas', perros: 'Solo perros', gatos: 'Solo gatos' };

const mapa = L.map('mapa').setView([-33.4372, -70.6206], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(mapa);
const capaLugares = L.layerGroup().addTo(mapa);
const capaPerdidas = L.layerGroup().addTo(mapa);

const $ = (id) => document.getElementById(id);
const form = $('form-lugar');
const formResena = $('form-resena');
let usuario = null;
let lugares = [];
let marcadores = new Map();
let categoriaActiva = '';
let soloFavoritos = false;
let ubicacion = null;
let marcadorUbicacion = null;
let marcadorNuevo = null;
let lugarAbierto = null;

const icono = (contenido, extra = '') => L.divIcon({
  html: `<div class="marcador ${extra}">${contenido}</div>`,
  className: '', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18],
});
const distancia = (l) => (ubicacion ? distanciaKm(ubicacion, l) : null);
const resumenEstrellas = (l) => (l.total_resenas
  ? `${estrellas(l.promedio)} <span class="sutil">${String(l.promedio).replace('.', ',')} (${l.total_resenas})</span>`
  : '<span class="sutil">Sin reseñas aún</span>');

// ---------- Lugares ----------
async function cargarLugares() {
  const params = new URLSearchParams();
  if (categoriaActiva) params.set('categoria', categoriaActiva);
  if ($('buscar').value.trim()) params.set('q', $('buscar').value.trim());
  if (soloFavoritos) params.set('favoritos', '1');
  lugares = await api(`/api/lugares?${params}`);
  pintarLugares();
}

function ordenados() {
  const orden = $('orden').value;
  const copia = [...lugares];
  if (orden === 'distancia' && ubicacion) return copia.sort((a, b) => distancia(a) - distancia(b));
  if (orden === 'valoracion') return copia.sort((a, b) => (b.promedio || 0) - (a.promedio || 0) || b.total_resenas - a.total_resenas);
  return copia;
}

function pintarLugares() {
  capaLugares.clearLayers();
  marcadores = new Map();
  for (const lugar of lugares) {
    const cat = CATEGORIAS[lugar.categoria] || CATEGORIAS.otro;
    const m = L.marker([lugar.lat, lugar.lng], { icon: icono(cat.icono, lugar.es_favorito ? 'favorito' : '') })
      .bindPopup(`<div class="popup">
        <h3>${cat.icono} ${esc(lugar.nombre)}</h3>
        <p>${resumenEstrellas(lugar)}</p>
        <button class="btn chico" data-detalle="${lugar.id}">Ver detalle y reseñas</button>
      </div>`);
    capaLugares.addLayer(m);
    marcadores.set(lugar.id, m);
  }

  const lista = ordenados();
  $('contador').textContent = `${lista.length} lugar${lista.length === 1 ? '' : 'es'}${soloFavoritos ? ' favorito' + (lista.length === 1 ? '' : 's') : ''}`;
  $('lista').innerHTML = lista.map((l) => {
    const km = distancia(l);
    return `<li data-id="${l.id}" tabindex="0">
      <div class="nombre">${CATEGORIAS[l.categoria]?.icono || '📍'} ${esc(l.nombre)} ${l.es_favorito ? '<span aria-label="favorito">❤️</span>' : ''}</div>
      <div class="linea-estrellas">${resumenEstrellas(l)}${km != null ? ` · <span class="sutil">${textoDistancia(km)}</span>` : ''}</div>
      <div class="sutil">${esc(l.direccion || '')}</div>
      <span class="etiqueta">${esc(ADMITE[l.mascotas_admitidas])}</span>
    </li>`;
  }).join('') || `<li class="vacio">${soloFavoritos ? 'Aún no tienes favoritos. Abre un lugar y toca 🤍 para guardarlo.' : 'No hay lugares con esos filtros.'}</li>`;
}

function pintarChips() {
  const chips = [['', { nombre: 'Todos', icono: '' }], ...Object.entries(CATEGORIAS)];
  $('chips').innerHTML = chips.map(([clave, c]) =>
    `<button type="button" class="chip ${clave === categoriaActiva ? 'activo' : ''}" data-cat="${clave}">${c.icono} ${c.nombre}</button>`
  ).join('');
}

// ---------- Detalle y reseñas ----------
async function abrirDetalle(id) {
  const lugar = lugares.find((l) => l.id === id);
  if (!lugar) return;
  lugarAbierto = lugar;
  salirModoAgregar();
  mapa.closePopup();
  mapa.setView([lugar.lat, lugar.lng], Math.max(mapa.getZoom(), 15));

  const cat = CATEGORIAS[lugar.categoria] || CATEGORIAS.otro;
  const km = distancia(lugar);
  $('detalle').innerHTML = `
    <div class="detalle-cabecera">
      <span class="etiqueta">${cat.icono} ${cat.singular}</span>
      <h1>${esc(lugar.nombre)}</h1>
      <p>${resumenEstrellas(lugar)}</p>
    </div>
    <p><span class="etiqueta">${esc(ADMITE[lugar.mascotas_admitidas])}</span>${km != null ? ` <span class="sutil">· a ${textoDistancia(km)} de ti</span>` : ''}</p>
    ${lugar.direccion ? `<p>📍 ${esc(lugar.direccion)}</p>` : ''}
    ${lugar.descripcion ? `<p class="sutil">${esc(lugar.descripcion)}</p>` : ''}
    <div class="acciones">
      <button class="btn ${lugar.es_favorito ? '' : 'sec'} chico" id="btn-favorito" aria-pressed="${Boolean(lugar.es_favorito)}">
        ${lugar.es_favorito ? '❤️ En favoritos' : '🤍 Guardar en favoritos'}</button>
      <a class="btn sec chico" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${lugar.lat},${lugar.lng}">🧭 Cómo llegar</a>
      ${usuario && lugar.creado_por === usuario.id
        ? '<button class="btn peligro chico" id="btn-eliminar-lugar">Eliminar lugar</button>'
        : '<button class="btn sec chico" id="btn-reportar-lugar">🚩 Reportar</button>'}
    </div>`;

  $('vista-lista').classList.add('oculto');
  $('vista-detalle').classList.remove('oculto');
  $('panel').scrollTop = 0;
  if (window.innerWidth <= 760) $('panel').scrollIntoView({ behavior: 'smooth' });
  await cargarResenas();
}

async function cargarResenas() {
  const resenas = await api(`/api/lugares/${lugarAbierto.id}/resenas`);
  const propia = resenas.find((r) => r.propia);

  $('resumen-resenas').innerHTML = resenas.length
    ? `<div class="resumen-resenas"><span class="promedio">${String(lugarAbierto.promedio).replace('.', ',')}</span>
        <div>${estrellas(lugarAbierto.promedio)}<div class="sutil">${resenas.length} reseña${resenas.length === 1 ? '' : 's'}</div></div></div>`
    : '<p class="sutil">Nadie ha opinado todavía. ¡Sé el primero!</p>';

  formResena.reset();
  $('aviso-resena').className = '';
  $('aviso-resena').textContent = '';
  $('titulo-form-resena').textContent = propia ? 'Tu reseña' : 'Deja tu reseña';
  $('btn-borrar-resena').classList.toggle('oculto', !propia);
  if (propia) {
    formResena.querySelector(`input[value="${propia.estrellas}"]`).checked = true;
    formResena.comentario.value = propia.comentario || '';
  }

  $('lista-resenas').innerHTML = resenas.map((r) => `
    <li class="resena">
      <div class="resena-cabecera"><strong>${esc(r.autor)}${r.propia ? ' (tú)' : ''}</strong> ${estrellas(r.estrellas)}</div>
      <div class="sutil">${new Date(r.creado_en.replace(' ', 'T') + 'Z').toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}
        ${r.propia ? '' : `· <button type="button" class="enlace-reporte" data-reportar-resena="${r.id}" data-autor="${esc(r.autor)}">Reportar</button>`}</div>
      ${r.comentario ? `<p>${esc(r.comentario)}</p>` : ''}
    </li>`).join('');
}

async function refrescarDetalle() {
  const id = lugarAbierto.id;
  await cargarLugares();
  if (lugares.some((l) => l.id === id)) await abrirDetalle(id);
  else cerrarDetalle();
}

function cerrarDetalle() {
  lugarAbierto = null;
  $('vista-detalle').classList.add('oculto');
  $('vista-lista').classList.remove('oculto');
}

// ---------- Mascotas perdidas ----------
async function cargarPerdidas() {
  capaPerdidas.clearLayers();
  if (!$('chip-perdidas').classList.contains('activo')) return;
  const avisos = (await api('/api/perdidas')).filter((p) => p.estado === 'perdida');
  for (const p of avisos) {
    const contenido = p.foto ? `<img src="/fotos/${encodeURIComponent(p.foto)}" alt="">` : (ICONOS_ESPECIE[p.especie] || '🐾');
    L.marker([p.lat, p.lng], { icon: icono(contenido, 'perdida'), zIndexOffset: 1000 })
      .bindPopup(`<div class="popup popup-perdida">
        ${p.foto ? `<img src="/fotos/${encodeURIComponent(p.foto)}" alt="Foto de ${esc(p.nombre)}">` : ''}
        <h3>🚨 Se busca: ${esc(p.nombre)}</h3>
        <p class="sutil">${esc([p.especie, p.raza, p.color].filter(Boolean).join(' · '))}</p>
        <p>Perdido el ${formatearFecha(p.fecha)}</p>
        ${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}
        <p>📞 <strong>${esc(p.contacto)}</strong></p>
        <a href="perdidas.html#aviso-${p.id}">Ver aviso completo</a>
      </div>`)
      .addTo(capaPerdidas);
  }
}

// ---------- Agregar lugar ----------
function salirModoAgregar() {
  form.classList.add('oculto');
  form.reset();
  document.body.classList.remove('modo-agregar');
  if (marcadorNuevo) mapa.removeLayer(marcadorNuevo);
  marcadorNuevo = null;
}

// ---------- Eventos ----------
$('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  categoriaActiva = chip.dataset.cat;
  pintarChips();
  cargarLugares();
});

$('chip-favoritos').addEventListener('click', (e) => {
  soloFavoritos = !soloFavoritos;
  e.currentTarget.classList.toggle('activo', soloFavoritos);
  e.currentTarget.setAttribute('aria-pressed', soloFavoritos);
  cargarLugares();
});

$('chip-perdidas').addEventListener('click', (e) => {
  const activo = e.currentTarget.classList.toggle('activo');
  e.currentTarget.setAttribute('aria-pressed', activo);
  cargarPerdidas();
});

let temporizador;
$('buscar').addEventListener('input', () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(cargarLugares, 300);
});

$('orden').addEventListener('change', pintarLugares);

const abrirDesdeLista = (e) => {
  const item = e.target.closest('li[data-id]');
  if (item) abrirDetalle(Number(item.dataset.id));
};
$('lista').addEventListener('click', abrirDesdeLista);
$('lista').addEventListener('keydown', (e) => { if (e.key === 'Enter') abrirDesdeLista(e); });

$('btn-cerca').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Tu navegador no permite obtener la ubicación');
  $('btn-cerca').textContent = '📍 Buscando…';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      ubicacion = { lat: coords.latitude, lng: coords.longitude };
      $('btn-cerca').textContent = '📍 Cerca de mí';
      if (marcadorUbicacion) marcadorUbicacion.remove();
      marcadorUbicacion = L.circleMarker([ubicacion.lat, ubicacion.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#2b6cb0', fillOpacity: 1 })
        .addTo(mapa).bindPopup('Estás aquí');
      mapa.setView([ubicacion.lat, ubicacion.lng], 14);
      $('orden').querySelector('[value="distancia"]').disabled = false;
      $('orden').value = 'distancia';
      pintarLugares();
      if (lugarAbierto) abrirDetalle(lugarAbierto.id);
    },
    () => {
      $('btn-cerca').textContent = '📍 Cerca de mí';
      alert('No pudimos obtener tu ubicación. Revisa que el navegador tenga permiso.');
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

$('btn-agregar').addEventListener('click', () => {
  form.classList.remove('oculto');
  document.body.classList.add('modo-agregar');
  $('aviso-lugar').className = '';
  $('aviso-lugar').textContent = '';
  form.nombre.focus();
});

$('btn-cancelar').addEventListener('click', salirModoAgregar);

mapa.on('click', (e) => {
  if (!document.body.classList.contains('modo-agregar')) return;
  form.lat.value = e.latlng.lat.toFixed(6);
  form.lng.value = e.latlng.lng.toFixed(6);
  if (marcadorNuevo) marcadorNuevo.setLatLng(e.latlng);
  else marcadorNuevo = L.marker(e.latlng, { icon: icono('➕', 'nuevo') }).addTo(mapa);
  $('ayuda-ubicacion').textContent = '✅ Ubicación marcada (puedes hacer clic de nuevo para moverla).';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form.lat.value) return mostrarAviso($('aviso-lugar'), 'Haz clic en el mapa para marcar la ubicación');
  try {
    const lugar = await api('/api/lugares', { method: 'POST', body: datosFormulario(form) });
    salirModoAgregar();
    await cargarLugares();
    abrirDetalle(lugar.id);
  } catch (err) {
    mostrarAviso($('aviso-lugar'), err.message);
  }
});

$('mapa').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-detalle]');
  if (boton) abrirDetalle(Number(boton.dataset.detalle));
});

$('btn-volver').addEventListener('click', cerrarDetalle);

$('detalle').addEventListener('click', async (e) => {
  if (e.target.closest('#btn-favorito')) {
    await api(`/api/lugares/${lugarAbierto.id}/favorito`, { method: lugarAbierto.es_favorito ? 'DELETE' : 'PUT' });
    refrescarDetalle();
  }
  if (e.target.closest('#btn-reportar-lugar')) abrirReporte('lugar', lugarAbierto.id, lugarAbierto.nombre);
  if (e.target.closest('#btn-eliminar-lugar') && confirm('¿Eliminar este lugar del mapa?')) {
    try {
      await api(`/api/lugares/${lugarAbierto.id}`, { method: 'DELETE' });
      cerrarDetalle();
      cargarLugares();
    } catch (err) {
      alert(err.message);
    }
  }
});

formResena.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = datosFormulario(formResena);
  if (!datos.estrellas) return mostrarAviso($('aviso-resena'), 'Elige de 1 a 5 estrellas');
  try {
    await api(`/api/lugares/${lugarAbierto.id}/resenas`, { method: 'PUT', body: { estrellas: Number(datos.estrellas), comentario: datos.comentario } });
    refrescarDetalle();
  } catch (err) {
    mostrarAviso($('aviso-resena'), err.message);
  }
});

$('lista-resenas').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-reportar-resena]');
  if (boton) abrirReporte('resena', Number(boton.dataset.reportarResena), `Reseña de ${boton.dataset.autor} en ${lugarAbierto.nombre}`);
});

$('btn-borrar-resena').addEventListener('click', async () => {
  if (!confirm('¿Borrar tu reseña?')) return;
  await api(`/api/lugares/${lugarAbierto.id}/resenas`, { method: 'DELETE' });
  refrescarDetalle();
});

// ---------- Inicio ----------
$('select-categoria').innerHTML = Object.entries(CATEGORIAS)
  .map(([clave, c]) => `<option value="${clave}">${c.icono} ${c.singular}</option>`).join('');
pintarChips();
requerirSesion().then((u) => {
  usuario = u;
  if (!u) return;
  cargarLugares();
  cargarPerdidas();
});
