const $ = (id) => document.getElementById(id);
const idAdopcion = new URLSearchParams(location.search).get('id');
let a = null;

const fechaCorta = (sql) => new Date(`${sql.replace(' ', 'T')}Z`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });
const tabla = (columnas, filas) => (filas.length
  ? `<table><thead><tr>${columnas.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${
    filas.map((f) => `<tr>${columnas.map(([c, , fmt]) => `<td>${esc(fmt ? fmt(f[c]) : f[c] || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  : '<p class="vacio">Sin registros.</p>');

function enlaceContacto(contacto) {
  const digitos = contacto.replace(/\D/g, '');
  if (digitos.length < 8) return esc(contacto);
  return `<a href="tel:${esc(contacto.replace(/[^\d+]/g, ''))}">📞 ${esc(contacto)}</a> · <a target="_blank" rel="noopener" href="https://wa.me/${digitos}">WhatsApp</a>`;
}

async function cargar() {
  try {
    a = await api(`/api/adopciones/${encodeURIComponent(idAdopcion)}`);
  } catch (err) {
    mostrarAviso($('aviso-general'), err.message);
    return;
  }
  document.title = `${a.nombre} busca hogar — MasoPet`;
  $('contenido').classList.remove('oculto');
  $('foto').innerHTML = avatarMascota(a);
  $('estado').textContent = ESTADOS_ADOPCION[a.estado];
  $('estado').className = `etiqueta ${a.estado === 'adoptado' ? '' : a.estado === 'en_proceso' ? 'ambar' : ''}`;
  $('nombre').textContent = `${a.nombre} ${a.sexo === 'macho' ? '♂' : a.sexo === 'hembra' ? '♀' : ''}`;
  $('resumen').textContent = [ESPECIES[a.especie], a.raza, a.edad, TAMANOS[a.tamano]].filter(Boolean).join(' · ');
  $('etiquetas').innerHTML = [
    a.caracter && `<span class="etiqueta caracter-${esc(a.caracter)}">${esc(CARACTERES[a.caracter])}</span>`,
    a.esterilizado && '<span class="etiqueta">Esterilizado/a</span>',
    (a.vacunado || a.salud?.vacunas.length) && '<span class="etiqueta">💉 Vacunado/a</span>',
    a.con_ficha && '<span class="etiqueta">🩺 Ficha de salud en MasoPet</span>',
  ].filter(Boolean).join('');
  $('publicado').innerHTML = `${a.publicador === 'refugio' ? '🏢 Publicado por el refugio' : '👤 Publicado por'} <strong>${esc(a.publicado_por)}</strong>${a.comuna ? ` · 📍 ${esc(a.comuna)}` : ''} · ${fechaCorta(a.creado_en)}`;
  $('contacto').innerHTML = a.estado === 'adoptado' ? '' : enlaceContacto(a.contacto);

  $('descripcion').textContent = a.descripcion || 'Sin descripción.';
  $('requisitos').textContent = a.requisitos || '';
  $('bloque-requisitos').classList.toggle('oculto', !a.requisitos);

  // Ficha de salud (si se publicó desde una mascota registrada)
  $('seccion-salud').classList.toggle('oculto', !a.salud);
  if (a.salud) {
    $('datos-salud').innerHTML = [
      ['Esterilizado/a', a.esterilizado ? 'Sí' : 'No'],
      ['Microchip', a.salud.microchip ? 'Sí' : 'No'],
      ['Peso', a.salud.peso ? `${String(a.salud.peso).replace('.', ',')} kg` : null],
      ['Alergias', a.salud.alergias],
      ['Condiciones crónicas', a.salud.condiciones],
      ['Último control', a.salud.ultima_consulta ? `${formatearFecha(a.salud.ultima_consulta.fecha)} — ${a.salud.ultima_consulta.motivo}` : null],
    ].map(([t, v]) => `<div><dt>${t}</dt><dd>${esc(v || '—')}</dd></div>`).join('');
    $('tabla-vacunas').innerHTML = tabla([['fecha', 'Fecha', formatearFecha], ['nombre', 'Vacuna'], ['proxima_fecha', 'Próxima dosis', formatearFecha]], a.salud.vacunas);
    $('tabla-desparasitaciones').innerHTML = tabla([['fecha', 'Fecha', formatearFecha], ['producto', 'Producto'], ['tipo', 'Tipo']], a.salud.desparasitaciones);
  }

  // Quien publicó: estado y solicitudes. Los demás: formulario de interés.
  $('btn-reportar').classList.toggle('oculto', a.propia);
  $('seccion-interes').classList.toggle('oculto', a.propia || a.estado === 'adoptado');
  $('form-interes').classList.toggle('oculto', a.ya_solicite);
  $('ya-enviado').classList.toggle('oculto', !a.ya_solicite);
  $('seccion-solicitudes').classList.toggle('oculto', !a.propia);
  $('acciones-duenio').innerHTML = a.propia ? `
    <label class="ordenar" style="margin-left: 0">Estado
      <select id="cambiar-estado">${Object.entries(ESTADOS_ADOPCION).map(([k, v]) => `<option value="${k}" ${k === a.estado ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </label>
    <button class="btn peligro chico" type="button" id="btn-eliminar">Eliminar publicación</button>` : '';
  if (a.propia) {
    $('solicitudes').innerHTML = a.solicitudes.map((s) => `
      <div class="solicitud">
        <div><strong>${esc(s.nombre)}</strong> <span class="sutil">· ${fechaCorta(s.creado_en)}</span></div>
        <p class="texto-pre">${esc(s.mensaje)}</p>
        <div class="sutil">📧 <a href="mailto:${esc(s.email)}">${esc(s.email)}</a>${s.telefono ? ` · 📞 ${esc(s.telefono)}` : ''}</div>
      </div>`).join('') || '<p class="vacio">Aún nadie ha mostrado interés. Comparte la publicación con tus conocidos.</p>';
  }
}

$('contenido').addEventListener('change', async (e) => {
  if (e.target.id !== 'cambiar-estado') return;
  await api(`/api/adopciones/${idAdopcion}`, { method: 'PUT', body: { estado: e.target.value } });
  cargar();
});

$('contenido').addEventListener('click', async (e) => {
  if (e.target.id === 'btn-eliminar' && confirm('¿Eliminar esta publicación?')) {
    await api(`/api/adopciones/${idAdopcion}`, { method: 'DELETE' });
    location.href = 'adopciones.html';
  }
  if (e.target.id === 'btn-reportar') abrirReporte('adopcion', a.id, `${a.nombre} en adopción`);
});

$('form-interes').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/adopciones/${idAdopcion}/solicitudes`, { method: 'POST', body: datosFormulario(e.target) });
    cargar();
  } catch (err) {
    mostrarAviso($('aviso-interes'), err.message);
  }
});

requerirSesion().then((u) => u && cargar());
