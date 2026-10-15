const $ = (id) => document.getElementById(id);
const PESTANAS = ['resumen', 'reportes', 'usuarios', 'contenido'];
const ICONO_TIPO = { lugar: '📍', resena: '⭐', perdida: '🚨', paseo: '🦮', comentario: '💬', adopcion: '🏠', cuidador: '🤝', resena_cuidador: '⭐', evento: '📅' };
let yo = null;

const fechaCorta = (sqlFecha) => new Date(`${sqlFecha.replace(' ', 'T')}Z`).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
const conDebounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- Pestañas ----------
function mostrarPestana(nombre) {
  if (!PESTANAS.includes(nombre)) nombre = 'resumen';
  document.querySelectorAll('[data-pestana]').forEach((b) => b.setAttribute('aria-selected', b.dataset.pestana === nombre));
  PESTANAS.forEach((p) => $(`pestana-${p}`).classList.toggle('oculto', p !== nombre));
  history.replaceState(null, '', `#${nombre}`);
  ({ resumen: cargarResumen, reportes: cargarReportes, usuarios: cargarUsuarios, contenido: cargarContenido })[nombre]();
}

// ---------- Resumen ----------
async function cargarResumen() {
  const r = await api('/api/admin/resumen');
  actualizarContador(r.reportes_pendientes);
  const tiles = [
    ['Usuarios', r.usuarios, r.usuarios_nuevos ? `+${r.usuarios_nuevos} esta semana` : 'Sin registros nuevos esta semana'],
    ['Mascotas registradas', r.mascotas],
    ['Lugares en el mapa', r.lugares, r.lugares_nuevos ? `+${r.lugares_nuevos} esta semana` : ''],
    ['Reseñas', r.resenas],
    ['Mascotas perdidas (activas)', r.perdidas_activas, `${r.reencuentros} reencuentro${r.reencuentros === 1 ? '' : 's'} 🎉`],
    ['Paseos próximos', r.paseos_proximos, `${r.perfiles_paseo} perfil${r.perfiles_paseo === 1 ? '' : 'es'} de paseo activo${r.perfiles_paseo === 1 ? '' : 's'}`],
    ['En adopción', r.adopciones_activas, `${r.adoptados} adoptada${r.adoptados === 1 ? '' : 's'} 🏠`],
    ['Paseadores y cuidadores', r.cuidadores],
    ['Eventos próximos', r.eventos_proximos],
    ['Reportes por revisar', r.reportes_pendientes, r.reportes_pendientes ? '<a href="#reportes" data-ir="reportes">Revisar ahora →</a>' : 'Todo al día ✅', r.reportes_pendientes > 0],
    ['Contenido oculto', r.ocultos, 'Por reportes, en espera de revisión', r.ocultos > 0],
    ['Usuarios bloqueados', r.bloqueados],
  ];
  $('indicadores').innerHTML = tiles.map(([titulo, valor, nota = '', alerta]) => `
    <div class="tarjeta indicador ${alerta ? 'alerta' : ''}">
      <div class="sutil">${titulo}</div>
      <div class="valor">${valor.toLocaleString('es-CL')}</div>
      <div class="sutil">${nota}</div>
    </div>`).join('');
}

function actualizarContador(n) {
  $('contador-reportes').textContent = n;
  $('contador-reportes').classList.toggle('oculto', !n);
}

// ---------- Reportes ----------
async function cargarReportes() {
  const grupos = await api('/api/admin/reportes');
  actualizarContador(grupos.length);
  $('lista-reportes').innerHTML = grupos.map((g) => `
    <article class="tarjeta reporte">
      <div class="reporte-cabecera">
        <span class="etiqueta">${ICONO_TIPO[g.tipo]} ${esc(g.tipo_nombre)}</span>
        ${g.objeto.oculto ? '<span class="etiqueta alerta">Oculto automáticamente</span>' : ''}
        <span class="sutil">${g.total} reporte${g.total === 1 ? '' : 's'}</span>
      </div>
      <div class="reporte-objeto">
        ${g.objeto.foto ? `<img class="foto-mascota" src="/fotos/${encodeURIComponent(g.objeto.foto)}" alt="">` : ''}
        <div>
          <h3>${esc(g.objeto.titulo)}</h3>
          ${g.objeto.texto ? `<p>${esc(g.objeto.texto)}</p>` : ''}
          <div class="sutil">${g.objeto.extra ? `${esc(g.objeto.extra)} · ` : ''}Publicado por ${g.objeto.autor ? `${esc(g.objeto.autor)} (${esc(g.objeto.autor_email)})` : 'MasoPet (lugar de ejemplo)'}</div>
        </div>
      </div>
      <ul class="motivos-reporte">
        ${g.reportes.map((r) => `<li><strong>${esc(r.motivo_texto)}</strong>${r.detalle ? `: “${esc(r.detalle)}”` : ''}
          <span class="sutil">— ${esc(r.reportado_por)}, ${fechaCorta(r.creado_en)}</span></li>`).join('')}
      </ul>
      <div class="acciones">
        <button class="btn peligro chico" data-accion="eliminar" data-tipo="${g.tipo}" data-id="${g.objeto_id}">🗑️ Eliminar contenido</button>
        <button class="btn sec chico" data-accion="mantener" data-tipo="${g.tipo}" data-id="${g.objeto_id}">✅ Mantener y descartar reportes</button>
        ${g.objeto.autor_email ? `<button class="btn sec chico" data-ver-usuario="${esc(g.objeto.autor_email)}">👤 Ver autor</button>` : ''}
      </div>
    </article>`).join('') || '<div class="tarjeta"><p class="vacio">No hay reportes pendientes. ✅</p></div>';
}

$('lista-reportes').addEventListener('click', async (e) => {
  const accion = e.target.closest('[data-accion]');
  const verUsuario = e.target.closest('[data-ver-usuario]');
  if (verUsuario) {
    $('buscar-usuarios').value = verUsuario.dataset.verUsuario;
    mostrarPestana('usuarios');
    return;
  }
  if (!accion) return;
  const eliminar = accion.dataset.accion === 'eliminar';
  if (!confirm(eliminar ? '¿Eliminar este contenido para siempre?' : '¿Mantener el contenido y descartar los reportes?')) return;
  try {
    await api(`/api/admin/reportes/${accion.dataset.tipo}/${accion.dataset.id}`, { method: 'POST', body: { accion: accion.dataset.accion } });
    cargarReportes();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Usuarios ----------
async function cargarUsuarios() {
  const usuarios = await api(`/api/admin/usuarios?q=${encodeURIComponent($('buscar-usuarios').value.trim())}`);
  $('tabla-usuarios').innerHTML = `
    <thead><tr><th>Usuario</th><th>Registro</th><th class="num">Mascotas</th><th class="num">Lugares</th><th class="num">Reseñas</th><th class="num">Reportes</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody>${usuarios.map((u) => {
      const esYo = u.id === yo.id;
      return `<tr class="${u.bloqueado ? 'fila-bloqueada' : ''}">
        <td><strong>${esc(u.nombre)}</strong><div class="sutil">${esc(u.email)}</div></td>
        <td>${fechaCorta(u.creado_en)}</td>
        <td class="num">${u.mascotas}</td><td class="num">${u.lugares}</td><td class="num">${u.resenas}</td>
        <td class="num">${u.reportes_recibidos ? `<span class="etiqueta alerta">${u.reportes_recibidos}</span>` : '0'}</td>
        <td>${u.rol === 'admin' ? '<span class="etiqueta">🛡️ Admin</span> ' : ''}${u.bloqueado ? '<span class="etiqueta alerta">Bloqueado</span>' : '<span class="sutil">Activo</span>'}</td>
        <td>${esYo ? '<span class="sutil">(tú)</span>' : `<div class="acciones-tabla">
          <button class="btn ${u.bloqueado ? 'sec' : 'peligro'} chico" data-usuario="${u.id}" data-bloquear="${u.bloqueado ? 0 : 1}">${u.bloqueado ? 'Desbloquear' : 'Bloquear'}</button>
          <button class="btn sec chico" data-usuario="${u.id}" data-rol="${u.rol === 'admin' ? 'usuario' : 'admin'}">${u.rol === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
          ${u.lugares + u.resenas ? `<button class="btn peligro chico" data-usuario="${u.id}" data-borrar-contenido="${esc(u.nombre)}">Borrar su contenido</button>` : ''}
        </div>`}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="vacio">Sin resultados.</td></tr>'}</tbody>`;
}

$('buscar-usuarios').addEventListener('input', conDebounce(cargarUsuarios));

$('tabla-usuarios').addEventListener('click', async (e) => {
  const boton = e.target.closest('[data-usuario]');
  if (!boton) return;
  const id = boton.dataset.usuario;
  try {
    if (boton.dataset.bloquear !== undefined) {
      const bloquear = boton.dataset.bloquear === '1';
      if (!confirm(bloquear ? '¿Bloquear a este usuario? Se cerrarán sus sesiones y no podrá entrar.' : '¿Desbloquear a este usuario?')) return;
      await api(`/api/admin/usuarios/${id}`, { method: 'PUT', body: { bloqueado: bloquear } });
    } else if (boton.dataset.rol) {
      if (!confirm(boton.dataset.rol === 'admin' ? '¿Dar permisos de administrador a este usuario?' : '¿Quitarle los permisos de administrador?')) return;
      await api(`/api/admin/usuarios/${id}`, { method: 'PUT', body: { rol: boton.dataset.rol } });
    } else if (boton.dataset.borrarContenido) {
      if (!confirm(`¿Borrar TODOS los lugares, reseñas y avisos de ${boton.dataset.borrarContenido}? No se puede deshacer.`)) return;
      const r = await api(`/api/admin/usuarios/${id}/contenido`, { method: 'DELETE' });
      alert(`Se borraron ${r.lugares} lugares, ${r.resenas} reseñas y ${r.perdidas} avisos.`);
    }
    cargarUsuarios();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Contenido ----------
async function cargarContenido() {
  const tipo = $('tipo-contenido').value;
  const filas = await api(`/api/admin/contenido/${tipo}?q=${encodeURIComponent($('buscar-contenido').value.trim())}`);
  const columnaExtra = { lugar: 'Categoría', resena: 'Estrellas', perdida: 'Estado', paseo: 'Cuándo', comentario: '—', adopcion: 'Estado', cuidador: 'Servicios', resena_cuidador: 'Estrellas', evento: 'Cuándo y dónde' }[tipo];
  const columnaTitulo = { lugar: 'Nombre', resena: 'Lugar', perdida: 'Mascota', paseo: 'Paseo', comentario: 'Paseo', adopcion: 'Mascota', cuidador: 'Cuidador/a', resena_cuidador: 'Reseña a', evento: 'Evento' }[tipo];
  $('tabla-contenido').innerHTML = `
    <thead><tr><th>${columnaTitulo}</th><th>${tipo === 'lugar' ? 'Dirección' : 'Texto'}</th><th>${columnaExtra}</th><th>Autor</th><th>Fecha</th><th></th></tr></thead>
    <tbody>${filas.map((f) => `<tr>
      <td><strong>${esc(f.titulo)}</strong>${f.oculto ? ' <span class="etiqueta alerta">Oculto</span>' : ''}</td>
      <td class="texto-largo">${esc(f.texto || '—')}</td>
      <td>${esc(f.extra || '—')}</td>
      <td>${esc(f.autor || 'MasoPet')}</td>
      <td>${fechaCorta(f.creado_en)}</td>
      <td><button class="btn peligro chico" data-borrar="${f.id}">Eliminar</button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin resultados.</td></tr>'}</tbody>`;
}

$('tipo-contenido').addEventListener('change', cargarContenido);
$('buscar-contenido').addEventListener('input', conDebounce(cargarContenido));
$('tabla-contenido').addEventListener('click', async (e) => {
  const boton = e.target.closest('[data-borrar]');
  if (!boton || !confirm('¿Eliminar este contenido para siempre?')) return;
  try {
    await api(`/api/admin/contenido/${$('tipo-contenido').value}/${boton.dataset.borrar}`, { method: 'DELETE' });
    cargarContenido();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Inicio ----------
document.querySelector('.pestanas').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-pestana]');
  if (boton) mostrarPestana(boton.dataset.pestana);
});
$('indicadores').addEventListener('click', (e) => {
  const enlace = e.target.closest('[data-ir]');
  if (enlace) { e.preventDefault(); mostrarPestana(enlace.dataset.ir); }
});

requerirSesion().then((u) => {
  if (!u) return;
  if (u.rol !== 'admin') {
    mostrarAviso($('aviso-general'), 'Esta sección es solo para administradores.');
    return;
  }
  yo = u;
  $('panel-admin').classList.remove('oculto');
  mostrarPestana(location.hash.slice(1));
});
