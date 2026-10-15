const $ = (id) => document.getElementById(id);
const form = $('form-evento');
let tipoActivo = '';
let selector = null;

const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};

function tarjeta(e) {
  const dia = new Date(`${e.fecha}T00:00`);
  return `<article class="tarjeta evento ${e.cancelado ? 'cancelado' : ''}" id="evento-${e.id}">
    <div class="fecha-bloque"><span class="dia">${dia.getDate()}</span><span class="mes-corto">${dia.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '')}</span></div>
    <div class="paseo-info">
      <div class="chips" style="margin: 0 0 .3rem">
        <span class="etiqueta">${TIPOS_EVENTO[e.tipo]}</span>
        ${e.gratuito ? '<span class="etiqueta">Gratis</span>' : e.precio ? `<span class="etiqueta ambar">${esc(e.precio)}</span>` : ''}
        ${e.cancelado ? '<span class="etiqueta alerta">Cancelado</span>' : ''}
      </div>
      <h3>${esc(e.titulo)}</h3>
      <div class="sutil">${dia.toLocaleDateString('es-CL', { weekday: 'long' })} · ${esc(e.hora_inicio)}${e.hora_fin ? `–${esc(e.hora_fin)}` : ''} · 📍 ${esc(e.lugar)}${e.distancia_km != null ? ` · ${String(e.distancia_km).replace('.', ',')} km` : ''}</div>
      ${e.direccion ? `<div class="sutil">${esc(e.direccion)}</div>` : ''}
      ${e.descripcion ? `<p class="texto-pre">${esc(e.descripcion)}</p>` : ''}
      <div class="sutil">${e.organizador ? `Organiza ${esc(e.organizador)} · ` : ''}Publicado por ${esc(e.publicado_por)}</div>
      <div class="acciones" style="margin-top: .6rem">
        ${e.cancelado ? '' : `<button class="btn ${e.asistire ? '' : 'sec'} chico" data-asistire="${e.id}" data-va="${e.asistire ? 1 : 0}" aria-pressed="${Boolean(e.asistire)}">
          ${e.asistire ? '✅ Asistiré' : '🙋 Asistiré'}</button>`}
        <span class="sutil">${e.asistentes} ${e.asistentes === 1 ? 'persona va' : 'personas van'}</span>
        <a class="btn sec chico" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}">🧭 Cómo llegar</a>
        ${e.enlace ? `<a class="btn sec chico" target="_blank" rel="noopener noreferrer" href="${esc(e.enlace)}">🔗 Más información</a>` : ''}
        ${e.propio
          ? `${e.cancelado ? '' : `<button class="btn sec chico" data-cancelar="${e.id}">Cancelar evento</button>`}<button class="btn peligro chico" data-eliminar="${e.id}">Eliminar</button>`
          : `<button type="button" class="enlace-reporte" data-reportar="${e.id}" data-titulo="${esc(e.titulo)}">🚩 Reportar</button>`}
      </div>
    </div>
  </article>`;
}

async function cargar() {
  const params = new URLSearchParams();
  if (tipoActivo) params.set('tipo', tipoActivo);
  const eventos = await api(`/api/eventos?${params}`);
  $('lista').innerHTML = eventos.map(tarjeta).join('')
    || '<div class="tarjeta vacio">No hay eventos próximos de este tipo. ¿Conoces uno? ¡Publícalo! 🐾</div>';
}

function pintarFiltros() {
  $('filtros').innerHTML = [['', '🗓️ Todos'], ...Object.entries(TIPOS_EVENTO)]
    .map(([k, v]) => `<button type="button" class="chip ${k === tipoActivo ? 'activo' : ''}" data-tipo="${k}">${v}</button>`).join('');
}

function abrirFormulario() {
  form.classList.remove('oculto');
  form.fecha.min = hoyISO();
  if (!selector) {
    selector = mapaSelector('mapa-evento', (latlng) => {
      form.lat.value = latlng.lat;
      form.lng.value = latlng.lng;
      $('ayuda-mapa').textContent = '✅ Lugar marcado (toca de nuevo para moverlo).';
    });
  }
  setTimeout(() => selector.mapa.invalidateSize(), 50);
  form.scrollIntoView({ behavior: 'smooth' });
}

form.gratuito.addEventListener('change', () => $('campo-precio').classList.toggle('oculto', form.gratuito.checked));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form.lat.value) return mostrarAviso($('aviso-evento'), 'Marca en el mapa dónde será el evento');
  try {
    const { id } = await api('/api/eventos', { method: 'POST', body: datosFormulario(form) });
    form.reset();
    form.classList.add('oculto');
    selector.limpiar();
    tipoActivo = '';
    pintarFiltros();
    await cargar();
    $(`evento-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    mostrarAviso($('aviso-evento'), err.message);
  }
});

$('btn-publicar').addEventListener('click', abrirFormulario);
$('btn-cancelar').addEventListener('click', () => { form.classList.add('oculto'); form.reset(); selector?.limpiar(); });

$('filtros').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-tipo]');
  if (!chip) return;
  tipoActivo = chip.dataset.tipo;
  pintarFiltros();
  cargar();
});

$('lista').addEventListener('click', async (e) => {
  const asistire = e.target.closest('[data-asistire]');
  const cancelar = e.target.closest('[data-cancelar]');
  const eliminar = e.target.closest('[data-eliminar]');
  const reportar = e.target.closest('[data-reportar]');
  try {
    if (asistire) await api(`/api/eventos/${asistire.dataset.asistire}/asistire`, { method: asistire.dataset.va === '1' ? 'DELETE' : 'PUT' });
    else if (cancelar && confirm('¿Cancelar este evento? Seguirá visible como cancelado.')) await api(`/api/eventos/${cancelar.dataset.cancelar}`, { method: 'PUT', body: { cancelado: true } });
    else if (eliminar && confirm('¿Eliminar este evento?')) await api(`/api/eventos/${eliminar.dataset.eliminar}`, { method: 'DELETE' });
    else if (reportar) return abrirReporte('evento', Number(reportar.dataset.reportar), reportar.dataset.titulo);
    else return;
    cargar();
  } catch (err) {
    alert(err.message);
  }
});

$('select-tipo').innerHTML = Object.entries(TIPOS_EVENTO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
pintarFiltros();
requerirSesion().then((u) => u && cargar());
