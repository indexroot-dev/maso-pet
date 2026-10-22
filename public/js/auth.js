// Solo se permite volver a páginas internas (evita redirecciones a otros sitios)
function destino() {
  const volver = new URLSearchParams(location.search).get('volver') || '';
  return /^[\w-]+\.html(\?[\w=&-]*)?$/.test(volver) ? volver : 'mascotas.html';
}

const aviso = document.getElementById('aviso');

// Lleva a la pantalla del código, conservando a dónde quería ir la persona
function irAVerificar(email) {
  const params = new URLSearchParams({ email });
  const volver = new URLSearchParams(location.search).get('volver');
  if (volver) params.set('volver', volver);
  location.href = `verificar.html?${params}`;
}

document.getElementById('form-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth/login', { method: 'POST', body: datosFormulario(e.target) });
    location.href = destino();
  } catch (err) {
    if (err.datos?.verificar) return irAVerificar(err.datos.email);
    mostrarAviso(aviso, err.message);
  }
});

document.getElementById('form-registro')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = datosFormulario(e.target);
  if (datos.password !== datos.password2) return mostrarAviso(aviso, 'Las contraseñas no coinciden');
  const boton = e.target.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const { verificar, email } = await api('/api/auth/registro', { method: 'POST', body: datos });
    if (verificar) return irAVerificar(email);
    location.href = destino();
  } catch (err) {
    mostrarAviso(aviso, err.message);
    boton.disabled = false;
  }
});

// ---------- Verificar el correo con el código ----------
const formVerificar = document.getElementById('form-verificar');
if (formVerificar) {
  const email = new URLSearchParams(location.search).get('email') || '';
  if (!email) location.replace('registro.html');
  document.getElementById('email-verificar').textContent = email;
  formVerificar.codigo.focus();

  formVerificar.addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = formVerificar.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      await api('/api/auth/verificar', { method: 'POST', body: { email, codigo: formVerificar.codigo.value } });
      mostrarAviso(aviso, '¡Correo verificado! Entrando…', 'ok');
      setTimeout(() => { location.href = destino(); }, 800);
    } catch (err) {
      mostrarAviso(aviso, err.message);
      formVerificar.codigo.select();
      boton.disabled = false;
    }
  });

  // Para no pedir códigos sin parar: espera 60 segundos entre cada uno
  const reenviar = document.getElementById('btn-reenviar');
  const esperar = (segundos) => {
    reenviar.disabled = true;
    const tic = () => {
      if (segundos <= 0) {
        reenviar.disabled = false;
        reenviar.textContent = 'Enviarme otro código';
        return;
      }
      reenviar.textContent = `Enviarme otro código (espera ${segundos--} s)`;
      setTimeout(tic, 1000);
    };
    tic();
  };
  esperar(60);
  reenviar.addEventListener('click', async () => {
    try {
      const { mensaje } = await api('/api/auth/reenviar-codigo', { method: 'POST', body: { email } });
      mostrarAviso(aviso, mensaje, 'ok');
      formVerificar.codigo.value = '';
      esperar(60);
    } catch (err) {
      mostrarAviso(aviso, err.message);
    }
  });
}

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
    setTimeout(() => { location.href = 'mascotas.html'; }, 1200);
  } catch (err) {
    mostrarAviso(aviso, err.message);
  }
});

// En login, registro y "olvidé mi contraseña": si ya hay sesión, no tiene sentido mostrarlos
if (!document.getElementById('form-restablecer')) {
  usuarioActual.then((u) => { if (u) location.href = destino(); });
}
