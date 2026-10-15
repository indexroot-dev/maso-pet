// Vista de solo lectura para el veterinario (sin cuenta)
const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get('t') || '';

const TIPOS_LIBRO = {
  control: '🩺 Control veterinario', peso: '⚖️ Control de peso', medicamento: '💊 Medicamento',
  alimentacion: '🍖 Alimentación', higiene: '🛁 Baño / peluquería', ejercicio: '🦮 Paseo / ejercicio',
  comportamiento: '🧠 Comportamiento', sintoma: '🤒 Síntoma / malestar', otro: '📝 Otro',
};
const kg = (p) => (p != null ? `${String(p).replace('.', ',')} kg` : '—');

function tabla(id, columnas, filas) {
  $(id).innerHTML = filas.length
    ? `<table><thead><tr>${columnas.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead>
       <tbody>${filas.map((r) => `<tr>${columnas.map(([c, , f]) => `<td>${esc(f ? f(r[c]) : r[c] || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<p class="vacio">Sin registros.</p>';
}

async function cargar() {
  let m;
  try {
    m = await api(`/api/compartido/${encodeURIComponent(token)}`);
  } catch (err) {
    mostrarAviso($('aviso-general'), err.message);
    return;
  }
  document.title = `Ficha clínica de ${m.nombre} — MasoPet`;
  $('contenido').classList.remove('oculto');
  const vence = new Date(m.expira).toLocaleString('es-CL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('vigencia').textContent = `🔗 Ficha compartida por su tutor/a. Este enlace es de solo lectura y vence el ${vence}`;
  $('foto').innerHTML = avatarMascota(m, 'grande');
  $('titulo').textContent = m.nombre;
  $('subtitulo').textContent = [m.especie, m.raza, m.sexo].filter(Boolean).join(' · ');
  $('tutor').textContent = `Tutor/a: ${m.tutor}`;

  const datos = [
    ['Fecha de nacimiento', m.fecha_nacimiento ? `${formatearFecha(m.fecha_nacimiento)} (${edad(m.fecha_nacimiento)})` : null],
    ['Peso', m.peso ? kg(m.peso) : null],
    ['Color / pelaje', m.color],
    ['Microchip', m.microchip],
    ['Esterilizado/a', m.esterilizado ? 'Sí' : 'No'],
    ['Alergias', m.alergias],
    ['Condiciones crónicas', m.condiciones],
    ['Notas', m.notas],
  ];
  $('datos').innerHTML = datos.map(([t, v]) => `<div><dt>${t}</dt><dd>${esc(v || '—')}</dd></div>`).join('');

  tabla('tabla-vacunas', [['fecha', 'Fecha', formatearFecha], ['nombre', 'Vacuna'], ['proxima_fecha', 'Próxima dosis', formatearFecha], ['veterinario', 'Veterinario/a'], ['notas', 'Notas']], m.vacunas);
  tabla('tabla-desparasitaciones', [['fecha', 'Fecha', formatearFecha], ['producto', 'Producto'], ['tipo', 'Tipo'], ['proxima_fecha', 'Próxima dosis', formatearFecha]], m.desparasitaciones);
  tabla('tabla-consultas', [['fecha', 'Fecha', formatearFecha], ['motivo', 'Motivo'], ['diagnostico', 'Diagnóstico'], ['tratamiento', 'Tratamiento'], ['veterinario', 'Veterinario/a'], ['peso', 'Peso', kg]], m.consultas);
  tabla('tabla-libro', [['fecha', 'Fecha', formatearFecha], ['tipo', 'Tipo', (t) => TIPOS_LIBRO[t] || t], ['titulo', 'Anotación'], ['detalle', 'Detalle'], ['peso', 'Peso', kg]], m.libro.slice(0, 30));
}

cargar();
