const $ = (id) => document.getElementById(id);
const idCuidador = new URLSearchParams(location.search).get('id');
const formResena = $('form-resena');
let c = null;

const fechaLarga = (sql) => new Date(`${sql.replace(' ', 'T')}Z`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });

function enlaceContacto(contacto) {
  const digitos = contacto.replace(/\D/g, '');
  if (digitos.length < 8) return `📞 ${esc(contacto)}`;
  return `<a class="btn sec chico" href="tel:${esc(contacto.replace(/[^\d+]/g, ''))}">📞 ${esc(contacto)}</a>
    <a class="btn sec chico" target="_blank" rel="noopener" href="https://wa.me/${digitos}">💬 WhatsApp</a>`;
}

async function cargar() {
  try {
    c = await api(`/api/cuidadores/${encodeURIComponent(idCuidador)}`);
  } catch (err) {
    mostrarAviso($('aviso-general'), err.message);
    return;
  }
  document.title = `${c.nombre} · Paseador/a y cuidador/a — MasoPet`;
  $('contenido').classList.remove('oculto');
  $('aviso-inactivo').classList.toggle('oculto', !(c.propio && !c.activo));
  $('foto').innerHTML = c.foto
    ? `<img class="foto-mascota grande" src="/fotos/${encodeURIComponent(c.foto)}" alt="Foto de ${esc(c.nombre)}">`
    : '<div class="foto-mascota grande sin-foto" aria-hidden="true">🧑</div>';
  $('nombre').textContent = c.nombre;
  $('valoracion').innerHTML = c.total_resenas
    ? `${estrellas(c.promedio)} <strong>${String(c.promedio).replace('.', ',')}</strong> <span class="sutil">(${c.total_resenas} reseña${c.total_resenas === 1 ? '' : 's'})</span>`
    : '<span class="sutil">Sin reseñas aún</span>';
  $('zona').textContent = [textoDistanciaAprox(c.distancia_km), `se desplaza hasta ${c.cobertura_km} km`].filter(Boolean).join(' · ');
  $('servicios').innerHTML = c.servicios.map((s) => `<span class="chip activo">${SERVICIOS[s]}</span>`).join('');
  $('tarifa').textContent = c.tarifa || '';
  $('descripcion').textContent = c.descripcion || '';
  $('detalles').innerHTML = [
    ['Acepta', c.especies.map((e) => ({ perro: 'Perros', gato: 'Gatos', otro: 'Otras mascotas' })[e]).join(', ')],
    ['Tamaños', c.tamanos.map((t) => TAMANOS[t]).join(', ')],
    ['Disponibilidad', c.horarios.map((h) => HORARIOS[h]).join(', ')],
  ].map(([t, v]) => `<div><dt>${t}</dt><dd>${esc(v || 'Consultar')}</dd></div>`).join('');
  $('contacto').innerHTML = `<div class="acciones">${enlaceContacto(c.contacto)}</div>`;
  $('btn-reportar').classList.toggle('oculto', c.propio);
  $('seccion-mensaje').classList.toggle('oculto', c.propio);

  const propia = c.resenas.find((r) => r.propia);
  formResena.classList.toggle('oculto', c.propio);
  formResena.reset();
  $('titulo-form-resena').textContent = propia ? 'Tu reseña' : '¿Te cuidó a tu mascota? Deja tu reseña';
  $('btn-borrar-resena').classList.toggle('oculto', !propia);
  if (propia) {
    formResena.querySelector(`input[value="${propia.estrellas}"]`).checked = true;
    formResena.comentario.value = propia.comentario || '';
  }
  $('resenas').innerHTML = c.resenas.map((r) => `
    <li class="resena">
      <div class="resena-cabecera"><strong>${esc(r.autor)}${r.propia ? ' (tú)' : ''}</strong> ${estrellas(r.estrellas)}</div>
      <div class="sutil">${fechaLarga(r.creado_en)}
        ${r.propia ? '' : `· <button type="button" class="enlace-reporte" data-reportar="${r.id}" data-autor="${esc(r.autor)}">Reportar</button>`}</div>
      ${r.comentario ? `<p>${esc(r.comentario)}</p>` : ''}
    </li>`).join('') || '<li class="vacio">Aún no tiene reseñas.</li>';
}

$('form-mensaje').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { mensaje } = await api(`/api/cuidadores/${idCuidador}/mensaje`, { method: 'POST', body: datosFormulario(e.target) });
    e.target.reset();
    mostrarAviso($('aviso-mensaje'), `✅ ${mensaje}`, 'ok');
  } catch (err) {
    mostrarAviso($('aviso-mensaje'), err.message);
  }
});

formResena.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = datosFormulario(formResena);
  if (!datos.estrellas) return mostrarAviso($('aviso-resena'), 'Elige de 1 a 5 estrellas');
  try {
    await api(`/api/cuidadores/${idCuidador}/resenas`, { method: 'PUT', body: { estrellas: Number(datos.estrellas), comentario: datos.comentario } });
    cargar();
  } catch (err) {
    mostrarAviso($('aviso-resena'), err.message);
  }
});

$('btn-borrar-resena').addEventListener('click', async () => {
  if (!confirm('¿Borrar tu reseña?')) return;
  await api(`/api/cuidadores/${idCuidador}/resenas`, { method: 'DELETE' });
  cargar();
});

$('resenas').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-reportar]');
  if (boton) abrirReporte('resena_cuidador', Number(boton.dataset.reportar), `Reseña de ${boton.dataset.autor}`);
});
$('btn-reportar').addEventListener('click', () => abrirReporte('cuidador', c.usuario_id, `Perfil de ${c.nombre}`));

requerirSesion().then((u) => u && cargar());
