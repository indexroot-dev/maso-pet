const idMascota = new URLSearchParams(location.search).get('id');
const $ = (id) => document.getElementById(id);
const formDatos = $('form-datos');

const COLUMNAS = {
  vacunas: [['fecha', 'Fecha', formatearFecha], ['nombre', 'Vacuna'], ['proxima_fecha', 'Próxima dosis', formatearFecha], ['veterinario', 'Veterinario/a'], ['notas', 'Notas']],
  desparasitaciones: [['fecha', 'Fecha', formatearFecha], ['producto', 'Producto'], ['tipo', 'Tipo'], ['proxima_fecha', 'Próxima dosis', formatearFecha], ['notas', 'Notas']],
  consultas: [['fecha', 'Fecha', formatearFecha], ['motivo', 'Motivo'], ['diagnostico', 'Diagnóstico'], ['tratamiento', 'Tratamiento'], ['veterinario', 'Veterinario/a'], ['peso', 'Peso', (p) => (p ? `${p} kg` : '—')]],
};

function pintarTabla(seccion, registros) {
  const columnas = COLUMNAS[seccion];
  $(`tabla-${seccion}`).innerHTML = registros.length
    ? `<table>
        <thead><tr>${columnas.map(([, t]) => `<th>${t}</th>`).join('')}<th class="no-imprimir"></th></tr></thead>
        <tbody>${registros.map((r) => `<tr>
          ${columnas.map(([campo, , formato]) => `<td>${esc(formato ? formato(r[campo]) : r[campo] || '—')}</td>`).join('')}
          <td class="no-imprimir"><button class="btn peligro chico" data-seccion="${seccion}" data-id="${r.id}" title="Eliminar">✕</button></td>
        </tr>`).join('')}</tbody>
      </table>`
    : '<p class="vacio">Sin registros todavía.</p>';
}

function pintarRecordatorios(ficha) {
  const hoy = new Date().toISOString().slice(0, 10);
  const limite = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);

  // Solo la dosis más reciente de cada vacuna/producto cuenta para el recordatorio
  const ultimos = new Map();
  for (const v of ficha.vacunas) if (!ultimos.has(`v:${v.nombre}`)) ultimos.set(`v:${v.nombre}`, { ...v, etiqueta: `💉 ${v.nombre}` });
  for (const d of ficha.desparasitaciones) if (!ultimos.has(`d:${d.producto}`)) ultimos.set(`d:${d.producto}`, { ...d, etiqueta: `🪱 ${d.producto}` });

  const proximos = [...ultimos.values()]
    .filter((r) => r.proxima_fecha && r.proxima_fecha <= limite)
    .sort((a, b) => a.proxima_fecha.localeCompare(b.proxima_fecha));

  $('seccion-recordatorios').classList.toggle('oculto', !proximos.length);
  $('recordatorios').innerHTML = proximos.map((r) => {
    const vencido = r.proxima_fecha < hoy;
    return `<div class="recordatorio ${vencido ? 'vencido' : ''}">
      <span>${esc(r.etiqueta)}</span>
      <strong>${vencido ? 'Atrasada desde' : 'Toca el'} ${formatearFecha(r.proxima_fecha)}</strong>
    </div>`;
  }).join('');
}

function pintarDatos(m) {
  document.title = `${m.nombre} — Ficha clínica — MasoPet`;
  $('avatar').innerHTML = avatarMascota(m, 'grande');
  $('btn-foto').textContent = m.foto ? '📷 Cambiar foto' : '📷 Agregar foto';
  $('btn-quitar-foto').classList.toggle('oculto', !m.foto);
  $('titulo').textContent = m.nombre;
  $('enlace-libro').href = `libro.html?id=${m.id}`;
  $('subtitulo').textContent = [m.especie, m.raza, m.sexo].filter(Boolean).join(' · ');

  const datos = [
    ['Fecha de nacimiento', m.fecha_nacimiento ? `${formatearFecha(m.fecha_nacimiento)} (${edad(m.fecha_nacimiento) || 'recién nacido'})` : null],
    ['Peso actual', m.peso ? `${m.peso} kg` : null],
    ['Color / pelaje', m.color],
    ['Microchip', m.microchip],
    ['Esterilizado/a', m.esterilizado ? 'Sí' : 'No'],
    ['Tamaño', TAMANOS[m.tamano]],
    ['Con otras mascotas', CARACTERES[m.caracter]],
    ['Alergias', m.alergias],
    ['Condiciones crónicas', m.condiciones],
    ['Notas', m.notas],
  ];
  $('datos').innerHTML = datos.map(([t, v]) => `<div><dt>${t}</dt><dd>${esc(v || '—')}</dd></div>`).join('');

  for (const campo of formDatos.elements) {
    if (!campo.name) continue;
    if (campo.type === 'checkbox') campo.checked = Boolean(m[campo.name]);
    else campo.value = m[campo.name] ?? '';
  }
}

async function cargar() {
  try {
    const ficha = await api(`/api/mascotas/${encodeURIComponent(idMascota)}`);
    pintarDatos(ficha);
    pintarRecordatorios(ficha);
    for (const seccion of Object.keys(COLUMNAS)) pintarTabla(seccion, ficha[seccion]);
  } catch (err) {
    mostrarAviso($('aviso-general'), err.message);
    $('titulo').textContent = 'Ficha no disponible';
  }
}

// ---------- Enlaces para el veterinario ----------
async function cargarEnlaces() {
  const enlaces = await api(`/api/mascotas/${idMascota}/compartir`);
  $('enlaces').innerHTML = enlaces.map((e) => {
    const qr = qrcode(0, 'M');
    qr.addData(e.url);
    qr.make();
    const vence = new Date(e.expira).toLocaleString('es-CL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    return `<div class="enlace">
      <div class="qr qr-chico">${qr.createSvgTag(4, 2)}</div>
      <div class="enlace-datos">
        <div class="sutil">Vence el ${vence}</div>
        <input type="text" readonly value="${esc(e.url)}" aria-label="Enlace para el veterinario">
        <div class="acciones">
          <button class="btn sec chico" data-copiar="${esc(e.url)}">📋 Copiar</button>
          <a class="btn sec chico" href="${esc(e.url)}" target="_blank" rel="noopener">Ver</a>
          <button class="btn peligro chico" data-revocar="${e.id}">Revocar</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ---------- Eventos ----------
$('input-foto').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  e.target.value = '';
  if (!archivo) return;
  $('btn-foto').textContent = '⏳ Subiendo…';
  try {
    const imagen = await redimensionarImagen(archivo);
    await api(`/api/mascotas/${idMascota}/foto`, { method: 'PUT', body: { imagen } });
    cargar();
  } catch (err) {
    mostrarAviso($('aviso-general'), err.message);
    cargar();
  }
});

$('btn-quitar-foto').addEventListener('click', async () => {
  if (!confirm('¿Quitar la foto?')) return;
  await api(`/api/mascotas/${idMascota}/foto`, { method: 'DELETE' });
  cargar();
});

$('btn-compartir').addEventListener('click', async () => {
  try {
    await api(`/api/mascotas/${idMascota}/compartir`, { method: 'POST', body: { dias: Number($('duracion').value) } });
    $('aviso-compartir').className = '';
    $('aviso-compartir').textContent = '';
    cargarEnlaces();
  } catch (err) {
    mostrarAviso($('aviso-compartir'), err.message);
  }
});

$('enlaces').addEventListener('click', async (e) => {
  const copiar = e.target.closest('[data-copiar]');
  const revocar = e.target.closest('[data-revocar]');
  if (copiar) {
    try {
      await navigator.clipboard.writeText(copiar.dataset.copiar);
    } catch {
      copiar.closest('.enlace').querySelector('input').select();
      document.execCommand('copy');
    }
    copiar.textContent = '✅ Copiado';
    setTimeout(() => { copiar.textContent = '📋 Copiar'; }, 2000);
  }
  if (revocar && confirm('¿Revocar este enlace? El veterinario ya no podrá abrir la ficha con él.')) {
    await api(`/api/mascotas/${idMascota}/compartir/${revocar.dataset.revocar}`, { method: 'DELETE' });
    cargarEnlaces();
  }
});

formDatos.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/mascotas/${idMascota}`, { method: 'PUT', body: datosFormulario(formDatos) });
    $('editar').open = false;
    $('aviso-datos').className = '';
    $('aviso-datos').textContent = '';
    cargar();
  } catch (err) {
    mostrarAviso($('aviso-datos'), err.message);
  }
});

document.querySelectorAll('form[data-seccion]').forEach((form) => {
  const aviso = form.querySelector('.aviso-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/mascotas/${idMascota}/${form.dataset.seccion}`, { method: 'POST', body: datosFormulario(form) });
      form.reset();
      form.closest('details').open = false;
      aviso.className = 'aviso-form';
      aviso.textContent = '';
      cargar();
    } catch (err) {
      mostrarAviso(aviso, err.message);
    }
  });
});

document.querySelector('main').addEventListener('click', async (e) => {
  const boton = e.target.closest('button[data-seccion]');
  if (!boton || !confirm('¿Eliminar este registro?')) return;
  try {
    await api(`/api/mascotas/${idMascota}/${boton.dataset.seccion}/${boton.dataset.id}`, { method: 'DELETE' });
    cargar();
  } catch (err) {
    alert(err.message);
  }
});

$('btn-eliminar').addEventListener('click', async () => {
  if (!confirm(`¿Eliminar la ficha de ${$('titulo').textContent}? Se borrará todo su historial.`)) return;
  await api(`/api/mascotas/${idMascota}`, { method: 'DELETE' });
  location.href = 'mascotas.html';
});

requerirSesion().then((u) => {
  if (!u) return;
  cargar();
  cargarEnlaces().catch(() => {});
});
