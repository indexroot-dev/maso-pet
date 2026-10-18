const $ = (id) => document.getElementById(id);

// "hace 5 minutos", "ayer", "12 de octubre"
function hace(fechaUtc) {
  const fecha = new Date(fechaUtc.replace(' ', 'T') + 'Z');
  const minutos = Math.round((Date.now() - fecha) / 6e4);
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  if (horas < 48) return 'ayer';
  return fecha.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });
}

async function cargar() {
  const lista = await api('/api/notificaciones');
  $('btn-borrar').classList.toggle('oculto', !lista.length);
  $('lista').innerHTML = lista.map((n) => {
    const contenido = `<span class="texto">${esc(n.texto)}</span><span class="sutil">${hace(n.creado_en)}</span>`;
    return `<li class="${n.leida ? '' : 'nueva'}">${n.enlace ? `<a href="${esc(n.enlace)}">${contenido}</a>` : `<div>${contenido}</div>`}</li>`;
  }).join('') || '<li class="vacio">No tienes notificaciones todavía.</li>';

  // Al abrir la página se marcan como leídas (se siguen viendo destacadas hasta la próxima visita)
  if (lista.some((n) => !n.leida)) {
    await api('/api/notificaciones/leidas', { method: 'POST' });
    pintarGloboNotificaciones(0);
  }
}

$('btn-borrar').addEventListener('click', async () => {
  if (!confirm('¿Borrar todas tus notificaciones?')) return;
  await api('/api/notificaciones', { method: 'DELETE' });
  cargar();
});

requerirSesion().then((u) => { if (u) cargar(); });
