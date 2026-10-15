// Solo se permite volver a páginas internas (evita redirecciones a otros sitios)
function destino() {
  const volver = new URLSearchParams(location.search).get('volver') || '';
  return /^[\w-]+\.html(\?[\w=&-]*)?$/.test(volver) ? volver : 'mapa.html';
}

const aviso = document.getElementById('aviso');

document.getElementById('form-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth/login', { method: 'POST', body: datosFormulario(e.target) });
    location.href = destino();
  } catch (err) {
    mostrarAviso(aviso, err.message);
  }
});

document.getElementById('form-registro')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = datosFormulario(e.target);
  if (datos.password !== datos.password2) return mostrarAviso(aviso, 'Las contraseñas no coinciden');
  try {
    await api('/api/auth/registro', { method: 'POST', body: datos });
    location.href = destino();
  } catch (err) {
    mostrarAviso(aviso, err.message);
  }
});

document.getElementById('form-olvide')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = e.target.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const { mensaje } = await api('/api/auth/olvide', { method: 'POST', body: datosFormulario(e.target) });
    mostrarAviso(aviso, `${mensaje} Revisa también la carpeta de spam.`, 'ok');
  } catch (err) {
    mostrarAviso(aviso, err.message);
  } finally {
    boton.disabled = false;
  }
});

document.getElementById('form-restablecer')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = datosFormulario(e.target);
  if (datos.password !== datos.password2) return mostrarAviso(aviso, 'Las contraseñas no coinciden');
  try {
    const token = new URLSearchParams(location.search).get('token');
    await api('/api/auth/restablecer', { method: 'POST', body: { token, password: datos.password } });
    mostrarAviso(aviso, '¡Listo! Tu contraseña fue cambiada. Entrando…', 'ok');
    setTimeout(() => { location.href = 'mapa.html'; }, 1200);
  } catch (err) {
    mostrarAviso(aviso, err.message);
  }
});

// En login, registro y "olvidé mi contraseña": si ya hay sesión, no tiene sentido mostrarlos
if (!document.getElementById('form-restablecer')) {
  usuarioActual.then((u) => { if (u) location.href = destino(); });
}
