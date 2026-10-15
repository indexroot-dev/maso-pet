const $ = (id) => document.getElementById(id);
const form = $('form-adopcion');
let estado = '';
let ubicacion = null;
let mascotas = [];
let selector = null;

const opciones = (objeto, vacio) => `<option value="">${vacio}</option>${Object.entries(objeto).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}`;

function tarjeta(a) {
  return `<a class="tarjeta adopcion-tarjeta" href="adopcion.html?id=${a.id}">
    <div class="adopcion-foto">
      ${avatarMascota(a)}
      ${a.estado !== 'disponible' ? `<span class="sello ${a.estado === 'adoptado' ? 'verde' : 'ambar'}">${ESTADOS_ADOPCION[a.estado]}</span>` : ''}
      ${a.publicador === 'refugio' ? '<span class="sello-refugio">🏢 Refugio</span>' : ''}
    </div>
    <div class="adopcion-cuerpo">
      <h3>${esc(a.nombre)} ${a.sexo === 'macho' ? '♂' : a.sexo === 'hembra' ? '♀' : ''}</h3>
      <div class="sutil">${esc([ESPECIES[a.especie], a.raza, a.edad, TAMANOS[a.tamano]].filter(Boolean).join(' · '))}</div>
      <div class="chips">
        ${a.con_ficha ? '<span class="etiqueta">🩺 Con ficha de salud</span>' : ''}
        ${a.esterilizado ? '<span class="etiqueta">Esterilizado/a</span>' : ''}
        ${a.vacunado ? '<span class="etiqueta">Vacunas al día</span>' : ''}
      </div>
      <div class="sutil">${esc(a.organizacion || '')}${a.comuna ? ` · 📍 ${esc(a.comuna)}` : ''}${a.distancia_km != null ? ` · ${textoDistanciaAprox(a.distancia_km)}` : ''}</div>
      ${a.propia ? '<span class="etiqueta">Tu publicación</span>' : ''}
    </div>
  </a>`;
}

async function cargar() {
  const params = new URLSearchParams();
  if (estado) params.set('estado', estado);
  if ($('filtro-especie').value) params.set('especie', $('filtro-especie').value);
  if ($('filtro-tamano').value) params.set('tamano', $('filtro-tamano').value);
  if (ubicacion) { params.set('lat', ubicacion.lat); params.set('lng', ubicacion.lng); }
  const lista = await api(`/api/adopciones?${params}`);
  $('lista').innerHTML = lista.map(tarjeta).join('') || `<div class="tarjeta vacio">${estado
    ? 'Aún no hay adopciones concretadas. ¡La primera historia feliz puede ser la tuya!'
    : 'No hay mascotas en adopción con estos filtros.'}</div>`;
}

async function abrirFormulario() {
  form.classList.remove('oculto');
  if (!selector) {
    selector = mapaSelector('mapa-adopcion', (latlng) => { form.lat.value = latlng.lat; form.lng.value = latlng.lng; });
    mascotas = await api('/api/mascotas');
    $('select-mascota').insertAdjacentHTML('beforeend', mascotas.map((m) => `<option value="${m.id}">${ICONOS_ESPECIE[m.especie] || '🐾'} ${esc(m.nombre)}</option>`).join(''));
  }
  setTimeout(() => selector.mapa.invalidateSize(), 50);
  form.scrollIntoView({ behavior: 'smooth' });
}

// Al elegir una mascota registrada se completan sus datos (se pueden editar)
$('select-mascota').addEventListener('change', (e) => {
  const m = mascotas.find((x) => x.id === Number(e.target.value));
  if (!m) return;
  for (const campo of ['nombre', 'especie', 'raza', 'sexo', 'tamano', 'caracter']) form[campo].value = m[campo] || '';
  form.esterilizado.checked = Boolean(m.esterilizado);
  form.edad.value = edad(m.fecha_nacimiento);
});

form.querySelectorAll('[name="publicador"]').forEach((r) => r.addEventListener('change', () => {
  $('campo-organizacion').classList.toggle('oculto', form.publicador.value !== 'refugio');
}));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = datosFormulario(form);
  try {
    const archivo = $('input-foto').files[0];
    if (archivo) datos.imagen = await redimensionarImagen(archivo);
    const { id } = await api('/api/adopciones', { method: 'POST', body: datos });
    location.href = `adopcion.html?id=${id}`;
  } catch (err) {
    mostrarAviso($('aviso-adopcion'), err.message);
  }
});

$('btn-publicar').addEventListener('click', abrirFormulario);
$('btn-cancelar').addEventListener('click', () => { form.classList.add('oculto'); form.reset(); selector?.limpiar(); });
$('filtro-especie').addEventListener('change', cargar);
$('filtro-tamano').addEventListener('change', cargar);
$('btn-cerca').addEventListener('click', async () => {
  try {
    ubicacion = await ubicacionNavegador();
    $('btn-cerca').textContent = '📍 Ordenado por cercanía';
    cargar();
  } catch (err) {
    alert(err.message);
  }
});
document.querySelector('.pestanas').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-estado]');
  if (!boton) return;
  estado = boton.dataset.estado;
  document.querySelectorAll('[data-estado]').forEach((b) => b.setAttribute('aria-selected', b === boton));
  cargar();
});

// ---------- Inicio ----------
$('select-especie').innerHTML = Object.entries(ESPECIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('select-tamano').innerHTML = opciones(TAMANOS, '—');
$('select-caracter').innerHTML = opciones(CARACTERES, '—');
$('filtro-especie').innerHTML = opciones(ESPECIES, 'Todas las especies');
$('filtro-tamano').innerHTML = opciones(TAMANOS, 'Todos los tamaños');
requerirSesion().then((u) => u && cargar());
