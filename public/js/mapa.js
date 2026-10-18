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
let lugarEditando = null;
let zonaBuscada = null;
let marcadorZona = null;

const icono = (contenido, extra = '') => L.divIcon({
  html: `<div class="marcador ${extra}">${contenido}</div>`,
  className: '', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18],
});
// Las distancias se miden desde la comuna o dirección buscada o, si no hay, desde donde está la persona
const origen = () => zonaBuscada || ubicacion;
const distancia = (l) => (origen() ? distanciaKm(origen(), l) : null);
const urlFoto = (foto) => `/fotos/${encodeURIComponent(foto)}`;
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
  if (orden === 'distancia' && origen()) return copia.sort((a, b) => distancia(a) - distancia(b));
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
        ${lugar.foto ? `<img class="popup-foto" src="${urlFoto(lugar.foto)}" alt="">` : ''}
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
    ${lugar.foto ? `<img class="foto-lugar" src="${urlFoto(lugar.foto)}" alt="Foto de ${esc(lugar.nombre)}">` : ''}
    <div class="detalle-cabecera">
      <span class="etiqueta">${cat.icono} ${cat.singular}</span>
      <h1>${esc(lugar.nombre)}</h1>
      <p>${resumenEstrellas(lugar)}</p>
    </div>
    <p><span class="etiqueta">${esc(ADMITE[lugar.mascotas_admitidas])}</span>${km != null ? ` <span class="sutil">· a ${textoDistancia(km)} de ${zonaBuscada ? esc(zonaBuscada.nombre) : 'ti'}</span>` : ''}</p>
    ${lugar.direccion ? `<p>📍 ${esc(lugar.direccion)}</p>` : ''}
    ${lugar.horario ? `<p>🕒 ${esc(lugar.horario)}</p>` : ''}
    ${lugar.descripcion ? `<p class="sutil">${esc(lugar.descripcion)}</p>` : ''}
    <div class="acciones">
      <button class="btn ${lugar.es_favorito ? '' : 'sec'} chico" id="btn-favorito" aria-pressed="${Boolean(lugar.es_favorito)}">
        ${lugar.es_favorito ? '❤️ En favoritos' : '🤍 Guardar en favoritos'}</button>
      <a class="btn sec chico" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${lugar.lat},${lugar.lng}">🧭 Cómo llegar</a>
      ${usuario && lugar.creado_por === usuario.id
        ? '<button class="btn sec chico" id="btn-editar-lugar">✏️ Editar</button> <button class="btn peligro chico" id="btn-eliminar-lugar">Eliminar lugar</button>'
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
  lugarEditando = null;
  $('vista-foto-lugar').innerHTML = '';
  $('quitar-foto-lugar').classList.add('oculto');
  $('titulo-form-lugar').textContent = 'Nuevo lugar';
  $('ayuda-ubicacion').textContent = 'Haz clic en el mapa para marcar la ubicación.';
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

// ---------- Ir a una comuna o dirección ----------
// Usa el buscador gratuito de OpenStreetMap (Nominatim). Sus reglas piden no más de una búsqueda por segundo:
// por eso solo se busca al apretar "Ir", no mientras se escribe.
let resultadosZona = [];

async function buscarZona(textoBuscado) {
  const params = new URLSearchParams({ q: textoBuscado, format: 'jsonv2', countrycodes: 'cl', limit: '5', 'accept-language': 'es' });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!res.ok) throw new Error('El buscador de direcciones no respondió. Intenta de nuevo en unos segundos.');
  return res.json();
}

function irAZona(r) {
  const nombre = r.name || r.display_name.split(',')[0];
  zonaBuscada = { lat: Number(r.lat), lng: Number(r.lon), nombre };
  $('resultados-zona').classList.add('oculto');
  $('zona').value = '';
  if (marcadorZona) marcadorZona.remove();
  marcadorZona = L.marker([zonaBuscada.lat, zonaBuscada.lng], { icon: icono('📌', 'zona') }).addTo(mapa).bindPopup(esc(r.display_name));
  const [sur, norte, oeste, este] = (r.boundingbox || []).map(Number);
  if (Number.isFinite(sur) && norte - sur > 0.005) mapa.fitBounds([[sur, oeste], [norte, este]], { maxZoom: 15 });
  else mapa.setView([zonaBuscada.lat, zonaBuscada.lng], 15);
  $('zona-activa').innerHTML = `Mostrando cerca de <strong>${esc(nombre)}</strong> <button type="button" class="enlace-reporte" id="btn-quitar-zona">✕ Quitar</button>`;
  $('zona-activa').classList.remove('oculto');
  $('orden').querySelector('[value="distancia"]').disabled = false;
  $('orden').value = 'distancia';
  pintarLugares();
  if (lugarAbierto) abrirDetalle(lugarAbierto.id);
}

function quitarZona() {
  zonaBuscada = null;
  if (marcadorZona) marcadorZona.remove();
  marcadorZona = null;
  $('zona-activa').classList.add('oculto');
  if (!ubicacion) {
    $('orden').value = 'nombre';
    $('orden').querySelector('[value="distancia"]').disabled = true;
  }
  pintarLugares();
}

$('form-zona').addEventListener('submit', async (e) => {
  e.preventDefault();
  const textoBuscado = $('zona').value.trim();
  if (textoBuscado.length < 3) return;
  const lista = $('resultados-zona');
  lista.classList.remove('oculto');
  lista.innerHTML = '<li class="vacio">Buscando…</li>';
  try {
    resultadosZona = await buscarZona(textoBuscado);
    if (resultadosZona.length === 1) return irAZona(resultadosZona[0]);
    lista.innerHTML = resultadosZona.map((r, i) => `<li><button type="button" data-zona="${i}">${esc(r.display_name)}</button></li>`).join('')
      || '<li class="vacio">No encontramos ese lugar. Prueba con otra forma de escribirlo (ej: "Ñuñoa" o "Av. Grecia 1200, Ñuñoa").</li>';
  } catch (err) {
    lista.innerHTML = `<li class="vacio">${esc(err.message === 'Failed to fetch' ? 'No hay conexión con el buscador de direcciones.' : err.message)}</li>`;
  }
});

$('resultados-zona').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-zona]');
  if (boton) irAZona(resultadosZona[Number(boton.dataset.zona)]);
});

$('zona-activa').addEventListener('click', (e) => {
  if (e.target.closest('#btn-quitar-zona')) quitarZona();
});

// ---------- Mi ubicación ----------
// automatico: al abrir el mapa. Si falla no muestra alertas, y no mueve el mapa si la persona ya está haciendo algo.
function ubicarme(automatico = false) {
  if (!navigator.geolocation) return automatico || alert('Tu navegador no permite obtener la ubicación');
  $('btn-cerca').textContent = '📍 Buscando…';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      ubicacion = { lat: coords.latitude, lng: coords.longitude };
      $('btn-cerca').textContent = '📍 Cerca de mí';
      if (!automatico && zonaBuscada) quitarZona();
      if (marcadorUbicacion) marcadorUbicacion.remove();
      marcadorUbicacion = L.circleMarker([ubicacion.lat, ubicacion.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#2b6cb0', fillOpacity: 1 })
        .addTo(mapa).bindPopup('Estás aquí');
      const ocupado = automatico && (lugarAbierto || document.body.classList.contains('modo-agregar'));
      if (!ocupado) mapa.setView([ubicacion.lat, ubicacion.lng], 14);
      $('orden').querySelector('[value="distancia"]').disabled = false;
      $('orden').value = 'distancia';
      pintarLugares();
      if (lugarAbierto) abrirDetalle(lugarAbierto.id);
    },
    () => {
      $('btn-cerca').textContent = '📍 Cerca de mí';
      if (!automatico) alert('No pudimos obtener tu ubicación. Revisa que el navegador tenga permiso.');
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}
$('btn-cerca').addEventListener('click', () => ubicarme());

$('btn-agregar').addEventListener('click', () => {
  salirModoAgregar();
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

function editarLugar(lugar) {
  salirModoAgregar();
  lugarEditando = lugar;
  for (const campo of ['nombre', 'categoria', 'mascotas_admitidas', 'direccion', 'descripcion', 'horario', 'lat', 'lng']) {
    form[campo].value = lugar[campo] ?? '';
  }
  $('titulo-form-lugar').textContent = 'Editar lugar';
  $('ayuda-ubicacion').textContent = 'Si quieres mover el lugar, haz clic en el mapa en la nueva ubicación.';
  if (lugar.foto) {
    $('vista-foto-lugar').innerHTML = `<img class="foto-lugar chica" src="${urlFoto(lugar.foto)}" alt="Foto actual">`;
    $('quitar-foto-lugar').classList.remove('oculto');
  }
  marcadorNuevo = L.marker([lugar.lat, lugar.lng], { icon: icono('✏️', 'nuevo') }).addTo(mapa);
  cerrarDetalle();
  form.classList.remove('oculto');
  document.body.classList.add('modo-agregar');
  form.nombre.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form.lat.value) return mostrarAviso($('aviso-lugar'), 'Haz clic en el mapa para marcar la ubicación');
  const boton = form.querySelector('[type="submit"]');
  boton.disabled = true;
  try {
    const datos = datosFormulario(form);
    const archivo = $('foto-lugar').files[0];
    if (archivo) datos.imagen = await redimensionarImagen(archivo);
    const lugar = lugarEditando
      ? await api(`/api/lugares/${lugarEditando.id}`, { method: 'PUT', body: datos })
      : await api('/api/lugares', { method: 'POST', body: datos });
    salirModoAgregar();
    await cargarLugares();
    abrirDetalle(lugar.id);
  } catch (err) {
    mostrarAviso($('aviso-lugar'), err.message);
  } finally {
    boton.disabled = false;
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
  if (e.target.closest('#btn-editar-lugar')) editarLugar(lugarAbierto);
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
  const lugarPedido = Number(new URLSearchParams(location.search).get('lugar'));
  cargarLugares().then(() => { if (lugarPedido) abrirDetalle(lugarPedido); });
  cargarPerdidas();
  if (!lugarPedido) ubicarme(true);
});
