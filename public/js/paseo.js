const $ = (id) => document.getElementById(id);
const idPaseo = new URLSearchParams(location.search).get('id');
let paseo = null;
let mapa = null;

const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};
const fechaHora = (sql) => new Date(`${sql.replace(' ', 'T')}Z`).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function mascotaMini(m) {
  return `<div class="mascota-mini">
    ${avatarMascota(m)}
    <div>
      <strong>${esc(m.nombre)}</strong>
      <div class="sutil">${esc([m.raza || m.especie, TAMANOS[m.tamano]].filter(Boolean).join(' · '))}</div>
      ${m.caracter ? `<span class="etiqueta caracter-${esc(m.caracter)}">${esc(CARACTERES[m.caracter])}</span>` : ''}
    </div>
  </div>`;
}

async function cargar() {
  try {
    paseo = await api(`/api/paseos/${encodeURIComponent(idPaseo)}`);
  } catch (err) {
    mostrarAviso($('aviso-general'), err.message);
    return;
  }
  const dia = new Date(`${paseo.fecha}T00:00`);
  const pasado = paseo.fecha < hoyISO();
  const activo = !paseo.cancelado && !pasado;
  document.title = `${paseo.titulo} — MasoPet`;
  $('contenido').classList.remove('oculto');
  $('aviso-cancelado').classList.toggle('oculto', !paseo.cancelado);
  $('aviso-invitacion').classList.toggle('oculto', !(activo && paseo.mi_estado === 'invitado'));
  $('dia').textContent = dia.getDate();
  $('mes').textContent = dia.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '');
  $('titulo').textContent = `${paseo.titulo}${paseo.privado ? ' 🔒' : ''}`;
  $('cuando').textContent = `${dia.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })} a las ${paseo.hora}${pasado ? ' (ya pasó)' : ''}`;
  $('organiza').textContent = `Organiza ${paseo.organizador_nombre}${paseo.es_organizador ? ' (tú)' : ''}`;
  $('descripcion').textContent = paseo.descripcion || '';
  $('punto').textContent = paseo.punto;
  $('como-llegar').href = `https://www.google.com/maps/dir/?api=1&destination=${paseo.lat},${paseo.lng}`;

  const lleno = paseo.cupo && paseo.asistentes >= paseo.cupo;
  let acciones = '';
  if (activo && paseo.es_organizador) acciones += '<button class="btn peligro chico" data-accion="cancelar">Cancelar paseo</button>';
  else if (activo && paseo.mi_estado === 'va') acciones += '<button class="btn sec chico" data-accion="salir">Ya no voy</button>';
  else if (activo && lleno) acciones += '<span class="etiqueta alerta">Paseo completo</span>';
  else if (activo) acciones += `<button class="btn" data-accion="unirme">🐾 ${paseo.mi_estado === 'invitado' ? 'Acepto, ¡voy!' : 'Me uno'}</button>`;
  if (!paseo.es_organizador) acciones += '<button type="button" class="enlace-reporte" data-accion="reportar">🚩 Reportar paseo</button>';
  $('acciones').innerHTML = acciones;

  if (!mapa) {
    mapa = L.map('mapa-paseo', { scrollWheelZoom: false }).setView([paseo.lat, paseo.lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
    L.marker([paseo.lat, paseo.lng]).addTo(mapa).bindPopup(esc(paseo.punto));
    // Muestra también dónde estás; si estás cerca (menos de 20 km), encuadra los dos puntos
    centrarEnUbicacion(mapa, { sinMover: () => true }).then((punto) => {
      if (punto && distanciaKm(punto, paseo) < 20) {
        mapa.fitBounds([[punto.lat, punto.lng], [paseo.lat, paseo.lng]], { padding: [40, 40], maxZoom: 16 });
      }
    });
  }

  $('cupo').textContent = `(${paseo.asistentes}${paseo.cupo ? ` de ${paseo.cupo}` : ''})`;
  const ordenados = [...paseo.participantes].sort((a, b) => (a.estado === 'invitado') - (b.estado === 'invitado'));
  $('participantes').innerHTML = ordenados.map((p) => `
    <div class="participante ${p.estado === 'invitado' ? 'invitado' : ''}">
      <div class="participante-nombre"><strong>${esc(p.nombre)}</strong>
        ${p.organizador ? '<span class="etiqueta">⭐ Organiza</span>' : ''}
        ${p.estado === 'invitado' ? '<span class="etiqueta">💌 Invitado/a</span>' : ''}</div>
      <div class="mascotas-vecino">${p.mascotas.map(mascotaMini).join('') || '<span class="sutil">Sin mascotas en su perfil de paseo</span>'}</div>
    </div>`).join('');

  $('comentarios').innerHTML = paseo.comentarios.map((c) => `
    <li class="comentario ${c.propio ? 'propio' : ''}">
      <div class="comentario-cabecera"><strong>${esc(c.autor)}</strong>${c.de_organizador ? ' <span class="etiqueta">Organiza</span>' : ''}
        <span class="sutil">${fechaHora(c.creado_en)}</span></div>
      <p>${esc(c.texto)}</p>
      ${c.propio || paseo.es_organizador ? `<button type="button" class="enlace-reporte" data-borrar="${c.id}">Borrar</button>` : ''}
      ${c.propio ? '' : `<button type="button" class="enlace-reporte" data-reportar-comentario="${c.id}" data-autor="${esc(c.autor)}">Reportar</button>`}
    </li>`).join('') || '<li class="vacio">Aún no hay mensajes. ¡Saluda al grupo! 👋</li>';
  $('form-comentario').classList.toggle('oculto', Boolean(paseo.cancelado));

  if (activo && paseo.es_organizador) cargarVecinosParaInvitar();
}

async function cargarVecinosParaInvitar() {
  const yaEstan = new Set(paseo.participantes.map((p) => p.usuario_id));
  const { perfil } = await api('/api/paseos/perfil');
  const vecinos = perfil?.activo ? await api('/api/paseos/vecinos?radio=10').catch(() => null) : null;
  $('invitar').classList.remove('oculto');
  if (!vecinos) {
    $('select-vecino').innerHTML = '';
    $('select-vecino').closest('.barra-admin').classList.add('oculto');
    $('aviso-invitar').innerHTML = 'Activa tu <a href="paseos.html#perfil">perfil de paseo</a> para invitar a tus vecinos.';
    return;
  }
  const disponibles = vecinos.filter((v) => !yaEstan.has(v.usuario_id));
  $('select-vecino').innerHTML = disponibles.map((v) =>
    `<option value="${v.usuario_id}">${esc(v.nombre)} — ${v.mascotas.map((m) => esc(m.nombre)).join(', ')} (${v.distancia_km <= 0.5 ? '< 1' : '~' + v.distancia_km} km)</option>`).join('');
  $('select-vecino').closest('.barra-admin').classList.toggle('oculto', !disponibles.length);
  $('aviso-invitar').textContent = disponibles.length ? '' : 'No hay más vecinos con perfil de paseo a menos de 10 km.';
}

// ---------- Eventos ----------
$('acciones').addEventListener('click', async (e) => {
  const accion = e.target.closest('[data-accion]')?.dataset.accion;
  if (!accion) return;
  try {
    if (accion === 'unirme') await api(`/api/paseos/${idPaseo}/unirme`, { method: 'POST' });
    if (accion === 'salir' && confirm('¿Seguro que ya no vas?')) await api(`/api/paseos/${idPaseo}/unirme`, { method: 'DELETE' });
    if (accion === 'cancelar' && confirm('¿Cancelar el paseo? Avisaremos por correo a quienes iban.')) await api(`/api/paseos/${idPaseo}`, { method: 'DELETE' });
    if (accion === 'reportar') return abrirReporte('paseo', paseo.id, paseo.titulo);
    cargar();
  } catch (err) {
    alert(err.message);
  }
});

$('btn-invitar').addEventListener('click', async () => {
  const opcion = $('select-vecino').selectedOptions[0];
  if (!opcion) return;
  try {
    await api(`/api/paseos/${idPaseo}/invitar`, { method: 'POST', body: { usuario_id: Number(opcion.value) } });
    $('aviso-invitar').textContent = '✅ Invitación enviada por correo.';
    cargar();
  } catch (err) {
    $('aviso-invitar').textContent = err.message;
  }
});

$('form-comentario').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/paseos/${idPaseo}/comentarios`, { method: 'POST', body: datosFormulario(e.target) });
    e.target.reset();
    $('aviso-comentario').className = '';
    $('aviso-comentario').textContent = '';
    await cargar();
    $('comentarios').lastElementChild?.scrollIntoView({ block: 'nearest' });
  } catch (err) {
    mostrarAviso($('aviso-comentario'), err.message);
  }
});

$('comentarios').addEventListener('click', async (e) => {
  const borrar = e.target.closest('[data-borrar]');
  const reportar = e.target.closest('[data-reportar-comentario]');
  if (reportar) abrirReporte('comentario', Number(reportar.dataset.reportarComentario), `Mensaje de ${reportar.dataset.autor}`);
  if (borrar && confirm('¿Borrar este mensaje?')) {
    await api(`/api/paseos/${idPaseo}/comentarios/${borrar.dataset.borrar}`, { method: 'DELETE' });
    cargar();
  }
});

requerirSesion().then((u) => u && cargar());
