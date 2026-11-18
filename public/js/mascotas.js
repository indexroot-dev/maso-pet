const form = document.getElementById('form-mascota');
const lista = document.getElementById('lista');
const invitaciones = document.getElementById('invitaciones');

// Quién más la cuida: "Compartida con 2 personas" o "La cuidas junto a Ana"
function etiquetaTutores(m) {
  if (!m.es_dueno) return `<div class="etiqueta tutores">👥 La cuidas junto a ${esc(m.dueno)}</div>`;
  if (m.otros_tutores > 0) return `<div class="etiqueta tutores">👥 Compartida con ${m.otros_tutores} ${m.otros_tutores === 1 ? 'persona' : 'personas'}</div>`;
  return '';
}

async function cargarInvitaciones() {
  const pendientes = await api('/api/mascotas/invitaciones');
  invitaciones.classList.toggle('oculto', !pendientes.length);
  invitaciones.innerHTML = pendientes.map((i) => `
    <div class="tarjeta invitacion">
      ${avatarMascota({ ...i, id: i.mascota_id })}
      <div class="invitacion-texto">
        <strong>${esc(i.dueno)} te invitó a ser tutor/a de ${esc(i.nombre)}</strong>
        <div class="sutil">Si aceptas, verás y podrás editar su ficha clínica y su libro de control, y recibirás los recordatorios de sus vacunas.</div>
      </div>
      <div class="acciones">
        <button class="btn chico" type="button" data-aceptar="${i.mascota_id}">Aceptar</button>
        <button class="btn sec chico" type="button" data-rechazar="${i.mascota_id}">Rechazar</button>
      </div>
    </div>`).join('');
}

invitaciones.addEventListener('click', async (e) => {
  const boton = e.target.closest('[data-aceptar], [data-rechazar]');
  if (!boton) return;
  const aceptar = 'aceptar' in boton.dataset;
  const id = boton.dataset.aceptar || boton.dataset.rechazar;
  if (!aceptar && !confirm('¿Rechazar la invitación?')) return;
  try {
    await api(`/api/mascotas/invitaciones/${id}`, { method: 'POST', body: { aceptar } });
  } catch (err) {
    alert(err.message);
  }
  cargarInvitaciones();
  cargar();
});

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
      ${etiquetaTutores(m)}
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

requerirSesion().then((u) => {
  if (!u) return;
  cargarInvitaciones().catch(() => {});
  cargar();
});
