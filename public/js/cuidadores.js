const $ = (id) => document.getElementById(id);
const form = $('form-perfil');
let ubicacion = null;
let selector = null;
let fotoNueva = null;
let yo = null;

const casillas = (nombre, objeto) => Object.entries(objeto)
  .map(([k, v]) => `<label class="check chip-check"><input type="checkbox" name="${nombre}" value="${k}"> ${v}</label>`).join('');
const marcados = (nombre) => [...form.querySelectorAll(`[name="${nombre}"]:checked`)].map((c) => c.value);
const fotoPersona = (foto, nombre) => (foto
  ? `<img class="foto-mascota grande" src="/fotos/${encodeURIComponent(foto)}" alt="Foto de ${esc(nombre)}">`
  : '<div class="foto-mascota grande sin-foto" aria-hidden="true">🧑</div>');

// ---------- Buscar ----------
async function buscar() {
  const params = new URLSearchParams({ radio: $('filtro-radio').value, orden: $('filtro-orden').value });
  if ($('filtro-servicio').value) params.set('servicio', $('filtro-servicio').value);
  if ($('filtro-especie').value) params.set('especie', $('filtro-especie').value);
  if (ubicacion) { params.set('lat', ubicacion.lat); params.set('lng', ubicacion.lng); }
  const { cuidadores, tiene_origen: tieneOrigen } = await api(`/api/cuidadores?${params}`);
  $('sin-origen').classList.toggle('oculto', tieneOrigen);
  $('lista').innerHTML = cuidadores.map((c) => `
    <a class="tarjeta vecino cuidador-tarjeta" href="cuidador.html?id=${c.usuario_id}">
      <div class="cuidador-cabecera">
        ${fotoPersona(c.foto, c.nombre)}
        <div>
          <h3>${esc(c.nombre)} ${c.propio ? '<span class="etiqueta">Tú</span>' : ''}</h3>
          <div>${c.total_resenas ? `${estrellas(c.promedio)} <span class="sutil">${String(c.promedio).replace('.', ',')} (${c.total_resenas})</span>` : '<span class="sutil">Sin reseñas aún</span>'}</div>
          <div class="sutil">${textoDistanciaAprox(c.distancia_km)}</div>
        </div>
      </div>
      <div class="chips">${c.servicios.map((s) => `<span class="chip">${SERVICIOS[s]}</span>`).join('')}</div>
      ${c.tarifa ? `<div><strong>${esc(c.tarifa)}</strong></div>` : ''}
      ${c.descripcion ? `<p class="recortado">${esc(c.descripcion)}</p>` : ''}
    </a>`).join('') || '<div class="tarjeta vacio">No encontramos paseadores ni cuidadores con estos filtros. Prueba ampliando la distancia.</div>';
}

// ---------- Mi perfil ----------
async function cargarPerfil() {
  const p = await api('/api/cuidadores/perfil');
  if (!selector) selector = mapaSelector('mapa-zona', (latlng) => { form.lat.value = latlng.lat; form.lng.value = latlng.lng; });
  setTimeout(() => selector.mapa.invalidateSize(), 50);
  $('vista-foto').innerHTML = fotoPersona(p?.foto, yo.nombre);
  $('ver-perfil').classList.toggle('oculto', !p);
  $('ver-perfil').href = `cuidador.html?id=${yo.id}`;
  if (!p) return;
  form.activo.checked = Boolean(p.activo);
  for (const nombre of ['servicios', 'especies', 'tamanos', 'horarios']) {
    form.querySelectorAll(`[name="${nombre}"]`).forEach((c) => { c.checked = p[nombre].includes(c.value); });
  }
  form.tarifa.value = p.tarifa || '';
  form.contacto.value = p.contacto || '';
  form.descripcion.value = p.descripcion || '';
  form.cobertura_km.value = String(p.cobertura_km);
  selector.marcar(L.latLng(p.lat, p.lng), true);
}

$('input-foto').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  fotoNueva = await redimensionarImagen(archivo, 600);
  $('vista-foto').innerHTML = `<img class="foto-mascota grande" src="${fotoNueva}" alt="Vista previa">`;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { activo } = await api('/api/cuidadores/perfil', {
      method: 'PUT',
      body: {
        activo: form.activo.checked,
        servicios: marcados('servicios'),
        especies: marcados('especies'),
        tamanos: marcados('tamanos'),
        horarios: marcados('horarios'),
        tarifa: form.tarifa.value,
        contacto: form.contacto.value,
        descripcion: form.descripcion.value,
        lat: form.lat.value ? Number(form.lat.value) : null,
        lng: form.lng.value ? Number(form.lng.value) : null,
        cobertura_km: Number(form.cobertura_km.value),
        imagen: fotoNueva,
      },
    });
    fotoNueva = null;
    mostrarAviso($('aviso-perfil'), activo ? '¡Listo! Tu perfil ya aparece en las búsquedas. 🐾' : 'Perfil guardado (oculto para los demás).', 'ok');
    $('ver-perfil').classList.remove('oculto');
  } catch (err) {
    mostrarAviso($('aviso-perfil'), err.message);
  }
});

// ---------- Pestañas e inicio ----------
function mostrarPestana(nombre) {
  if (!['buscar', 'perfil'].includes(nombre)) nombre = 'buscar';
  document.querySelectorAll('[data-pestana]').forEach((b) => b.setAttribute('aria-selected', b.dataset.pestana === nombre));
  $('pestana-buscar').classList.toggle('oculto', nombre !== 'buscar');
  $('pestana-perfil').classList.toggle('oculto', nombre !== 'perfil');
  history.replaceState(null, '', `#${nombre}`);
  if (nombre === 'buscar') buscar(); else cargarPerfil();
}

document.querySelector('.pestanas').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-pestana]');
  if (boton) mostrarPestana(boton.dataset.pestana);
});
['filtro-servicio', 'filtro-especie', 'filtro-radio', 'filtro-orden'].forEach((id) => $(id).addEventListener('change', buscar));
$('btn-ubicacion').addEventListener('click', async () => {
  try {
    ubicacion = await ubicacionNavegador();
    $('btn-ubicacion').textContent = '📍 Usando tu ubicación';
    buscar();
  } catch (err) {
    alert(err.message);
  }
});

$('filtro-servicio').innerHTML = `<option value="">Todos los servicios</option>${Object.entries(SERVICIOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}`;
$('servicios').innerHTML = casillas('servicios', SERVICIOS);
$('tamanos').innerHTML = casillas('tamanos', TAMANOS);
$('horarios').innerHTML = casillas('horarios', HORARIOS);
requerirSesion().then((u) => {
  if (!u) return;
  yo = u;
  mostrarPestana(location.hash.slice(1));
});
