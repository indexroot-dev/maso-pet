const $ = (id) => document.getElementById(id);

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

requerirSesion().then((u) => {
  if (!u) return;
  $('nombre').textContent = u.nombre;
  $('email').textContent = u.email;
  $('chk-recordatorios').checked = Boolean(u.recordatorios);
});
