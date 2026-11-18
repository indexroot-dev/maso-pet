const idMascota = new URLSearchParams(location.search).get('id');
const $ = (id) => document.getElementById(id);
const formDatos = $('form-datos');

const COLUMNAS = {
  vacunas: [['fecha', 'Fecha', formatearFecha], ['nombre', 'Vacuna'], ['proxima_fecha', 'Próxima dosis', formatearFecha], ['veterinario', 'Veterinario/a'], ['notas', 'Notas']],
  desparasitaciones: [['fecha', 'Fecha', formatearFecha], ['producto', 'Producto'], ['tipo', 'Tipo'], ['proxima_fecha', 'Próxima dosis', formatearFecha], ['notas', 'Notas']],
  consultas: [['fecha', 'Fecha', formatearFecha], ['motivo', 'Motivo'], ['diagnostico', 'Diagnóstico'], ['tratamiento', 'Tratamiento'], ['veterinario', 'Veterinario/a'], ['peso', 'Peso', (p) => (p ? `${p} kg` : '—')]],
  medicamentos: [['nombre', 'Medicamento'], ['dosis', 'Dosis'], ['cada_dias', 'Frecuencia', frecuencia], ['horario', 'Horario'], ['fecha_inicio', 'Desde', formatearFecha], ['fecha_fin', 'Hasta', (f) => (f ? formatearFecha(f) : 'Sin término')], ['notas', 'Notas']],
  citas: [['fecha', 'Fecha', formatearFecha], ['hora', 'Hora'], ['motivo', 'Motivo'], ['veterinario', 'Veterinario/a o clínica'], ['notas', 'Notas']],
};

// Fecha de hoy (o dentro de N días) en la hora de Chile, como 2026-11-17
function fechaLocalISO(dias = 0) {
  const d = new Date(Date.now() + dias * 864e5);
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}

// Cada cuántos días se da un medicamento, en palabras
function frecuencia(dias) {
  return { 1: 'Todos los días', 2: 'Día por medio', 7: 'Una vez a la semana', 15: 'Cada 15 días', 30: 'Una vez al mes' }[dias] || `Cada ${dias} días`;
}

function pintarTabla(seccion, registros) {
  const columnas = COLUMNAS[seccion];
  $(`tabla-${seccion}`).innerHTML = registros.length
    ? `<table>
        <thead><tr>${columnas.map(([, t]) => `<th>${t}</th>`).join('')}<th class="no-imprimir"></th></tr></thead>
        <tbody>${registros.map((r) => `<tr>
          ${columnas.map(([campo, , formato]) => `<td>${esc(formato ? formato(r[campo]) : r[campo] || '—')}</td>`).join('')}
          <td class="no-imprimir acciones-fila">
            <button class="btn sec chico" type="button" data-editar="${seccion}" data-id="${r.id}" title="Editar" aria-label="Editar">✏️</button>
            <button class="btn peligro chico" data-seccion="${seccion}" data-id="${r.id}" title="Eliminar" aria-label="Eliminar">✕</button>
          </td>
        </tr>`).join('')}</tbody>
      </table>`
    : '<p class="vacio">Sin registros todavía.</p>';
}

// ---------- Calendario del celular ----------
const dos = (n) => String(n).padStart(2, '0');
// Horas escritas en el horario, ej: "8:00 y 20:00" → ['08:00', '20:00']
function horasDelHorario(horario) {
  const horas = [...String(horario || '').matchAll(/\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/g)].map((m) => `${dos(m[1])}:${m[2]}`);
  return [...new Set(horas)].sort();
}
// Enlace que abre Google Calendar con el evento ya completado
function enlaceGoogle({ titulo, fecha, hora, minutos = 60, detalles, lugar, repetir }) {
  const compacta = (iso) => iso.replaceAll('-', '');
  const [a, m, d] = fecha.split('-').map(Number);
  let fechas;
  if (hora) {
    const [h, mi] = hora.split(':').map(Number);
    const fin = new Date(a, m - 1, d, h, mi + minutos);
    fechas = `${compacta(fecha)}T${hora.replace(':', '')}00/${fin.getFullYear()}${dos(fin.getMonth() + 1)}${dos(fin.getDate())}T${dos(fin.getHours())}${dos(fin.getMinutes())}00`;
  } else {
    const sig = new Date(a, m - 1, d + 1);
    fechas = `${compacta(fecha)}/${sig.getFullYear()}${dos(sig.getMonth() + 1)}${dos(sig.getDate())}`;
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: titulo, dates: fechas, details: detalles || '', ctz: 'America/Santiago' });
  if (lugar) p.set('location', lugar);
  if (repetir) p.set('recur', repetir);
  return `https://calendar.google.com/calendar/render?${p}`;
}
function menuCalendario(seccion, registro, enlacesGoogle) {
  const botonesGoogle = enlacesGoogle
    .map((g) => `<a class="btn sec chico" target="_blank" rel="noopener" href="${esc(g.url)}">Google Calendar${g.hora ? ` · ${esc(g.hora)}` : ''}</a>`)
    .join('');
  return `<details class="calendario no-imprimir">
    <summary>📅 Agregar a mi calendario</summary>
    <div class="acciones">
      ${botonesGoogle}
      <a class="btn sec chico" href="/api/mascotas/${idMascota}/${seccion}/${registro.id}/calendario.ics" download>iPhone u otro calendario</a>
    </div>
    <p class="sutil">Así tu celular te avisará a la hora, aunque MasoPet esté cerrada.</p>
  </details>`;
}

// Un medicamento en curso: dosis de hoy, botón "✓ Ya se lo di" y calendario
function tarjetaMedicamento(ficha, x, hoy) {
  const dadasHoy = (ficha.libro || [])
    .filter((l) => l.medicamento_id === x.id && l.fecha === hoy)
    .sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
  const tocaHoy = Math.round((new Date(`${hoy}T12:00`) - new Date(`${x.fecha_inicio}T12:00`)) / 864e5) % x.cada_dias === 0;
  const titulo = `💊 ${ficha.nombre}: ${x.nombre}${x.dosis ? ` (${x.dosis})` : ''}`;
  const hasta = x.fecha_fin ? `;UNTIL=${x.fecha_fin.replaceAll('-', '')}` : '';
  const repetir = `RRULE:FREQ=DAILY;INTERVAL=${x.cada_dias}${hasta}`;
  const horas = horasDelHorario(x.horario);
  const google = (horas.length ? horas : ['09:00']).map((hora) => ({
    hora: horas.length > 1 ? hora : '',
    url: enlaceGoogle({ titulo, fecha: x.fecha_inicio, hora, minutos: 15, detalles: x.notas || '', repetir }),
  }));
  const dosis = dadasHoy.length
    ? dadasHoy.map((d) => {
      const deshacer = d.usuario_id === usuarioActualId ? ` <button class="enlace-boton" type="button" data-deshacer="${d.id}">Deshacer</button>` : '';
      return `<span class="etiqueta dada">✓ ${esc(d.detalle)}${deshacer}</span>`;
    }).join(' ')
    : `<span class="sutil">${tocaHoy ? 'Hoy todavía nadie lo ha marcado.' : 'Hoy no le toca.'}</span>`;
  const detalle = `${esc(frecuencia(x.cada_dias))}${x.horario ? ` · ${esc(x.horario)}` : ''}${x.fecha_fin ? ` · hasta el ${formatearFecha(x.fecha_fin)}` : ''}`;
  return `<div class="recordatorio medicamento con-acciones">
    <div class="recordatorio-fila">
      <span>💊 ${esc(x.nombre)}${x.dosis ? ` <span class="sutil">(${esc(x.dosis)})</span>` : ''}</span>
      <strong>${detalle}</strong>
    </div>
    <div class="dosis-hoy">${dosis}</div>
    <div class="recordatorio-acciones">
      <button class="btn chico" type="button" data-dosis="${x.id}" data-nombre="${esc(x.nombre)}">✓ Ya se lo di</button>
      ${menuCalendario('medicamentos', x, google)}
    </div>
  </div>`;
}

// Una cita que viene: cuándo y calendario
function tarjetaCita(ficha, c, hoy) {
  const google = [{ hora: '', url: enlaceGoogle({ titulo: `🩺 ${ficha.nombre}: ${c.motivo}`, fecha: c.fecha, hora: c.hora, detalles: c.notas || '', lugar: c.veterinario || '' }) }];
  return `<div class="recordatorio cita con-acciones">
    <div class="recordatorio-fila">
      <span>🩺 ${esc(c.motivo)}${c.veterinario ? ` <span class="sutil">(${esc(c.veterinario)})</span>` : ''}</span>
      <strong>${c.fecha === hoy ? 'Hoy' : `El ${formatearFecha(c.fecha)}`}${c.hora ? ` a las ${esc(c.hora)}` : ''}</strong>
    </div>
    <div class="recordatorio-acciones">${menuCalendario('citas', c, google)}</div>
  </div>`;
}

function pintarRecordatorios(ficha) {
  const hoy = fechaLocalISO();
  const limite = fechaLocalISO(60);

  // Solo la dosis más reciente de cada vacuna/producto cuenta para el recordatorio
  const ultimos = new Map();
  for (const v of ficha.vacunas) if (!ultimos.has(`v:${v.nombre}`)) ultimos.set(`v:${v.nombre}`, { ...v, etiqueta: `💉 ${v.nombre}` });
  for (const d of ficha.desparasitaciones) if (!ultimos.has(`d:${d.producto}`)) ultimos.set(`d:${d.producto}`, { ...d, etiqueta: `🪱 ${d.producto}` });

  const proximos = [...ultimos.values()]
    .filter((r) => r.proxima_fecha && r.proxima_fecha <= limite)
    .sort((a, b) => a.proxima_fecha.localeCompare(b.proxima_fecha));

  // Medicamentos en curso y citas que vienen
  const enCurso = ficha.medicamentos.filter((x) => x.fecha_inicio <= hoy && (!x.fecha_fin || x.fecha_fin >= hoy));
  const citas = ficha.citas.filter((c) => c.fecha >= hoy && c.fecha <= limite).sort((a, b) => `${a.fecha}${a.hora || ''}`.localeCompare(`${b.fecha}${b.hora || ''}`));

  const html = [
    ...enCurso.map((x) => tarjetaMedicamento(ficha, x, hoy)),
    ...citas.map((c) => tarjetaCita(ficha, c, hoy)),
    ...proximos.map((r) => {
      const vencido = r.proxima_fecha < hoy;
      return `<div class="recordatorio ${vencido ? 'vencido' : ''}">
        <span>${esc(r.etiqueta)}</span>
        <strong>${vencido ? 'Atrasada desde' : 'Toca el'} ${formatearFecha(r.proxima_fecha)}</strong>
      </div>`;
    }),
  ];
  $('seccion-recordatorios').classList.toggle('oculto', !html.length);
  $('recordatorios').innerHTML = html.join('');
}

function pintarDatos(m) {
  document.title = `${m.nombre} — Ficha clínica — MasoPet`;
  $('avatar').innerHTML = avatarMascota(m, 'grande');
  $('btn-foto').textContent = m.foto ? '📷 Cambiar foto' : '📷 Agregar foto';
  $('btn-quitar-foto').classList.toggle('oculto', !m.foto);
  $('titulo').textContent = m.nombre;
  $('enlace-libro').href = `libro.html?id=${m.id}`;
  // Solo el dueño puede eliminar la ficha
  $('btn-eliminar').classList.toggle('oculto', !m.es_dueno);
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

let fichaActual = null;

async function cargar() {
  try {
    const ficha = await api(`/api/mascotas/${encodeURIComponent(idMascota)}`);
    fichaActual = ficha;
    pintarDatos(ficha);
    pintarRecordatorios(ficha);
    for (const seccion of Object.keys(COLUMNAS)) pintarTabla(seccion, ficha[seccion]);
  } catch (err) {
    mostrarAviso($('aviso-general'), err.message);
    $('titulo').textContent = 'Ficha no disponible';
  }
}

// ---------- Tutores ----------
let usuarioActualId = null;

async function cargarTutores() {
  const { es_dueno: esDueno, dueno, tutores, max } = await api(`/api/mascotas/${idMascota}/tutores`);
  const fila = (nombre, detalle, quitar) => `<li>
    <span class="avatar-tutor" aria-hidden="true">👤</span>
    <span class="tutor-datos"><strong>${esc(nombre)}</strong>${detalle ? ` <span class="sutil">${detalle}</span>` : ''}</span>
    ${quitar || ''}
  </li>`;
  $('lista-tutores').innerHTML = [
    fila(dueno.id === usuarioActualId ? `${dueno.nombre} (tú)` : dueno.nombre, 'Tutor/a principal'),
    ...tutores.map((t) => fila(
      t.id === usuarioActualId ? `${t.nombre} (tú)` : t.nombre,
      [t.estado === 'pendiente' ? '<span class="etiqueta ambar">Invitación pendiente</span>' : '', t.email ? esc(t.email) : ''].filter(Boolean).join(' · '),
      esDueno ? `<button class="btn peligro chico" type="button" data-quitar="${t.id}" data-nombre="${esc(t.nombre)}" data-pendiente="${t.estado === 'pendiente' ? 1 : ''}">${t.estado === 'pendiente' ? 'Anular' : 'Quitar'}</button>` : '',
    )),
  ].join('');
  // El dueño invita (mientras no llegue al máximo); los demás pueden salirse
  $('form-tutor').classList.toggle('oculto', !esDueno || tutores.length + 1 >= max);
  $('btn-salir-tutor').classList.toggle('oculto', esDueno);
  $('ayuda-tutores').textContent = esDueno
    ? 'Invita a otras personas que también cuidan a esta mascota (tu pareja, familia o quien la comparte contigo). Podrán ver y editar su ficha y su libro de control, y recibirán los recordatorios de sus vacunas.'
    : `Cuidas a esta mascota junto a ${dueno.nombre}. Pueden ver y editar su ficha y su libro de control.`;
}

$('form-tutor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    const t = await api(`/api/mascotas/${idMascota}/tutores`, { method: 'POST', body: { email: form.email.value } });
    form.reset();
    mostrarAviso($('aviso-tutor'), `Listo: le enviamos la invitación a ${t.nombre}. Aparecerá como tutor cuando la acepte.`, 'exito');
    cargarTutores();
  } catch (err) {
    mostrarAviso($('aviso-tutor'), err.message);
  }
});

$('lista-tutores').addEventListener('click', async (e) => {
  const boton = e.target.closest('[data-quitar]');
  if (!boton) return;
  const pregunta = boton.dataset.pendiente
    ? `¿Anular la invitación a ${boton.dataset.nombre}?`
    : `¿Quitar a ${boton.dataset.nombre} como tutor? Ya no podrá ver la ficha de ${$('titulo').textContent}.`;
  if (!confirm(pregunta)) return;
  try {
    await api(`/api/mascotas/${idMascota}/tutores/${boton.dataset.quitar}`, { method: 'DELETE' });
    cargarTutores();
  } catch (err) {
    alert(err.message);
  }
});

$('btn-salir-tutor').addEventListener('click', async () => {
  if (!confirm(`¿Dejar de ser tutor de ${$('titulo').textContent}? Ya no verás su ficha ni su libro de control.`)) return;
  try {
    await api(`/api/mascotas/${idMascota}/tutores/${usuarioActualId}`, { method: 'DELETE' });
    location.href = 'mascotas.html';
  } catch (err) {
    alert(err.message);
  }
});

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

// ---------- "✓ Ya se lo di" y "Deshacer" ----------
$('recordatorios').addEventListener('click', async (e) => {
  const dar = e.target.closest('[data-dosis]');
  const deshacer = e.target.closest('[data-deshacer]');
  try {
    if (dar) {
      const hoy = fechaLocalISO();
      const yaDadas = (fichaActual?.libro || []).filter((l) => l.medicamento_id === Number(dar.dataset.dosis) && l.fecha === hoy);
      const pregunta = `Hoy ya se lo dieron: ${yaDadas.map((d) => d.detalle).join(', ')}.\n\n¿Registrar otra dosis de ${dar.dataset.nombre}?`;
      if (yaDadas.length && !confirm(pregunta)) return;
      dar.disabled = true;
      await api(`/api/mascotas/${idMascota}/medicamentos/${dar.dataset.dosis}/dosis`, { method: 'POST' });
      cargar();
    } else if (deshacer && confirm('¿Deshacer esta dosis? Se borrará del libro de control.')) {
      await api(`/api/mascotas/${idMascota}/libro/${deshacer.dataset.deshacer}`, { method: 'DELETE' });
      cargar();
    }
  } catch (err) {
    alert(err.message);
    cargar();
  }
});

// ---------- Editar un registro: reutiliza el formulario de la sección ----------
function terminarEdicion(form) {
  delete form.dataset.editando;
  form.reset();
  form.querySelector('button[type="submit"]').textContent = form.dataset.textoBoton;
  const detalle = form.closest('details');
  detalle.querySelector('summary').textContent = detalle.dataset.textoResumen;
  form.querySelector('.btn-cancelar-edicion')?.remove();
}

function editarRegistro(seccion, id) {
  const registro = fichaActual?.[seccion]?.find((r) => r.id === Number(id));
  const form = document.querySelector(`form[data-seccion="${seccion}"]`);
  if (!registro || !form) return;
  terminarEdicion(form);
  for (const campo of form.elements) if (campo.name) campo.value = registro[campo.name] ?? '';
  form.dataset.editando = id;
  form.querySelector('button[type="submit"]').textContent = 'Guardar cambios';
  const cancelar = document.createElement('button');
  cancelar.type = 'button';
  cancelar.className = 'btn sec btn-cancelar-edicion';
  cancelar.textContent = 'Cancelar';
  cancelar.addEventListener('click', () => { terminarEdicion(form); form.closest('details').open = false; });
  form.querySelector('button[type="submit"]').after(cancelar);
  const detalle = form.closest('details');
  detalle.querySelector('summary').textContent = '✏️ Editando registro';
  detalle.open = true;
  detalle.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.querySelectorAll('form[data-seccion]').forEach((form) => {
  const aviso = form.querySelector('.aviso-form');
  form.dataset.textoBoton = form.querySelector('button[type="submit"]').textContent;
  form.closest('details').dataset.textoResumen = form.closest('details').querySelector('summary').textContent;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editando = form.dataset.editando;
    try {
      await api(`/api/mascotas/${idMascota}/${form.dataset.seccion}${editando ? `/${editando}` : ''}`, { method: editando ? 'PUT' : 'POST', body: datosFormulario(form) });
      terminarEdicion(form);
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
  const editar = e.target.closest('button[data-editar]');
  if (editar) return editarRegistro(editar.dataset.editar, editar.dataset.id);
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

// "Desde" del medicamento parte en hoy (y vuelve a hoy al limpiar el formulario)
document.querySelector('form[data-seccion="medicamentos"] [name="fecha_inicio"]').defaultValue = fechaLocalISO();

requerirSesion().then((u) => {
  if (!u) return;
  usuarioActualId = u.id;
  cargar();
  cargarTutores().catch(() => $('seccion-tutores').classList.add('oculto'));
  cargarEnlaces().catch(() => {});
});
