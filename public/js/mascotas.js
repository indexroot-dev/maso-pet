const form = document.getElementById('form-mascota');
const lista = document.getElementById('lista');

async function cargar() {
  const mascotas = await api('/api/mascotas');
  if (!mascotas.length) {
    lista.innerHTML = `<div class="tarjeta">
      <p>Aún no tienes mascotas registradas.</p>
      <p class="sutil">Crea la ficha clínica de tu mascota para llevar el control de vacunas, desparasitaciones y consultas veterinarias.</p>
    </div>`;
    form.classList.remove('oculto');
    return;
  }
  lista.innerHTML = mascotas.map((m) => `
    <div class="tarjeta tarjeta-mascota">
      ${avatarMascota(m, 'grande')}
      <h2>${esc(m.nombre)}</h2>
      <div class="sutil">${esc([m.raza, m.sexo, edad(m.fecha_nacimiento)].filter(Boolean).join(' · ') || m.especie)}</div>
      <div class="mascota-enlaces">
        <a class="btn chico" href="ficha.html?id=${m.id}">🩺 Ficha clínica</a>
        <a class="btn sec chico" href="libro.html?id=${m.id}">📖 Libro de control</a>
      </div>
    </div>`).join('');
}

document.getElementById('btn-nueva').addEventListener('click', () => {
  form.classList.remove('oculto');
  form.nombre.focus();
});
document.getElementById('btn-cancelar').addEventListener('click', () => {
  form.classList.add('oculto');
  form.reset();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const mascota = await api('/api/mascotas', { method: 'POST', body: datosFormulario(form) });
    location.href = `ficha.html?id=${mascota.id}`;
  } catch (err) {
    mostrarAviso(document.getElementById('aviso'), err.message);
  }
});

requerirSesion().then((u) => u && cargar());
