const $ = (id) => document.getElementById(id);
let zona = null;
let selectorZona = null;

$('form-nombre').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/cuenta/nombre', { method: 'PUT', body: datosFormulario(e.target) });
    mostrarAviso($('aviso-nombre'), 'Nombre actualizado ✅', 'ok');
    iniciarNav();
  } catch (err) {
    mostrarAviso($('aviso-nombre'), err.message);
  }
});

// ---------- Mi zona ----------
async function guardarZona(mensaje) {
  try {
    await api('/api/cuenta/zona', { method: 'PUT', body: { lat: zona?.lat ?? null, lng: zona?.lng ?? null, avisos_cerca: $('chk-avisos-cerca').checked } });
    $('btn-zona-quitar').classList.toggle('oculto', !zona);
    mostrarAviso($('aviso-zona'), mensaje, 'ok');
  } catch (err) {
    mostrarAviso($('aviso-zona'), err.message);
  }
}

async function cargarZona() {
  const datos = await api('/api/cuenta/zona');
  $('radio-km').textContent = datos.radio_km;
  $('chk-avisos-cerca').checked = Boolean(datos.avisos_cerca);
  let mostrandoGuardada = Boolean(datos.zona);
  selectorZona = mapaSelector('mapa-zona', (latlng) => {
    zona = { lat: latlng.lat, lng: latlng.lng };
    if (!mostrandoGuardada) guardarZona('Zona guardada ✅');
  });
  if (datos.zona) {
    selectorZona.marcar(datos.zona, true); // solo la muestra, sin volver a guardarla
    mostrandoGuardada = false;
    $('btn-zona-quitar').classList.remove('oculto');
  }
}

$('btn-zona-ubicacion').addEventListener('click', async () => {
  try {
    const punto = await ubicacionNavegador();
    selectorZona.marcar(punto, true);
  } catch (err) {
    mostrarAviso($('aviso-zona'), err.message);
  }
});

$('btn-zona-quitar').addEventListener('click', () => {
  if (!confirm('¿Quitar tu zona? Ya no te avisaremos de mascotas perdidas cerca.')) return;
  zona = null;
  selectorZona.limpiar();
  guardarZona('Zona quitada');
});

$('chk-avisos-cerca').addEventListener('change', (e) => {
  guardarZona(e.target.checked ? 'Avisos de mascotas perdidas activados ✅' : 'Avisos de mascotas perdidas desactivados');
});

$('chk-recordatorios').addEventListener('change', async (e) => {
  try {
    const { recordatorios } = await api('/api/auth/preferencias', { method: 'PUT', body: { recordatorios: e.target.checked } });
    mostrarAviso($('aviso-recordatorios'), recordatorios ? 'Recordatorios activados ✅' : 'Recordatorios desactivados', 'ok');
  } catch (err) {
    e.target.checked = !e.target.checked;
    mostrarAviso($('aviso-recordatorios'), err.message);
  }
});

$('btn-prueba').addEventListener('click', async () => {
  try {
    const { mensaje } = await api('/api/auth/recordatorio-prueba', { method: 'POST' });
    mostrarAviso($('aviso-recordatorios'), mensaje, 'ok');
  } catch (err) {
    mostrarAviso($('aviso-recordatorios'), err.message);
  }
});

$('form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = datosFormulario(e.target);
  if (datos.nueva !== datos.nueva2) return mostrarAviso($('aviso-password'), 'Las contraseñas nuevas no coinciden');
  try {
    const { mensaje } = await api('/api/auth/password', { method: 'PUT', body: datos });
    e.target.reset();
    mostrarAviso($('aviso-password'), `${mensaje} ✅`, 'ok');
  } catch (err) {
    mostrarAviso($('aviso-password'), err.message);
  }
});

$('form-eliminar').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!confirm('¿Seguro que quieres eliminar tu cuenta y todos tus datos? No se puede deshacer.')) return;
  try {
    await api('/api/auth/cuenta', { method: 'DELETE', body: datosFormulario(e.target) });
    alert('Tu cuenta fue eliminada. ¡Gracias por haber usado MasoPet! 🐾');
    location.href = '/';
  } catch (err) {
    mostrarAviso($('aviso-eliminar'), err.message);
  }
});

requerirSesion().then((u) => {
  if (!u) return;
  $('form-nombre').nombre.value = u.nombre;
  $('email').textContent = u.email;
  $('chk-recordatorios').checked = Boolean(u.recordatorios);
  cargarZona().catch((err) => mostrarAviso($('aviso-zona'), err.message));
});
