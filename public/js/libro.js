const idMascota = new URLSearchParams(location.search).get('id');
const $ = (id) => document.getElementById(id);
const form = $('form-anotacion');

const TIPOS = {
  control: { nombre: 'Control veterinario', icono: '🩺' },
  peso: { nombre: 'Control de peso', icono: '⚖️' },
  medicamento: { nombre: 'Medicamento', icono: '💊' },
  alimentacion: { nombre: 'Alimentación', icono: '🍖' },
  higiene: { nombre: 'Baño / peluquería', icono: '🛁' },
  ejercicio: { nombre: 'Paseo / ejercicio', icono: '🦮' },
  comportamiento: { nombre: 'Comportamiento', icono: '🧠' },
  sintoma: { nombre: 'Síntoma / malestar', icono: '🤒' },
  otro: { nombre: 'Otro', icono: '📝' },
};

let ficha = null;
let filtro = '';
let puntosPeso = [];

const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};
const kg = (n) => `${Number(n).toLocaleString('es-CL', { maximumFractionDigits: 2 })} kg`;
const fechaLarga = (iso) => new Date(`${iso}T00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });

// ---------- Resumen ----------
function pintarResumen() {
  const ultimo = puntosPeso.at(-1);
  const anterior = puntosPeso.at(-2);
  $('ind-peso').textContent = ultimo ? kg(ultimo.peso) : ficha.peso ? kg(ficha.peso) : '—';
  if (ultimo && anterior) {
    const dif = ultimo.peso - anterior.peso;
    $('ind-peso-delta').textContent = dif === 0
      ? 'Sin cambios desde el registro anterior'
      : `${dif > 0 ? '▲ +' : '▼ '}${kg(dif)} desde el ${formatearFecha(anterior.fecha)}`;
  } else {
    $('ind-peso-delta').textContent = ultimo ? `Registrado el ${formatearFecha(ultimo.fecha)}` : '';
  }
  $('ind-total').textContent = ficha.libro.length;
  $('ind-ultima').textContent = ficha.libro[0] ? fechaLarga(ficha.libro[0].fecha) : '—';
}

// ---------- Gráfico de peso ----------
function calcularPuntosPeso() {
  const puntos = [
    ...ficha.libro.filter((r) => r.peso != null).map((r) => ({ fecha: r.fecha, peso: r.peso, origen: 'Libro de control' })),
    ...ficha.consultas.filter((c) => c.peso != null).map((c) => ({ fecha: c.fecha, peso: c.peso, origen: 'Consulta veterinaria' })),
  ];
  return puntos.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function escalaY(min, max) {
  const rango = max - min || Math.max(max * 0.1, 1);
  const paso = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50].find((p) => rango / p <= 4) || 100;
  let bajo = Math.floor(min / paso) * paso;
  let alto = Math.ceil(max / paso) * paso;
  if (bajo === alto) { bajo -= paso; alto += paso; }
  bajo = Math.max(0, bajo);
  const ticks = [];
  for (let v = bajo; v <= alto + paso / 2; v += paso) ticks.push(Number(v.toFixed(2)));
  return { bajo, alto, ticks };
}

function pintarGrafico() {
  const cont = $('grafico');
  const tooltip = $('tooltip');
  cont.querySelector('svg')?.remove();
  cont.querySelector('.vacio')?.remove();
  tooltip.classList.add('oculto');

  $('detalle-tabla-peso').classList.toggle('oculto', !puntosPeso.length);
  $('tabla-peso').innerHTML = `<table><thead><tr><th>Fecha</th><th>Peso</th><th>Origen</th></tr></thead><tbody>${
    [...puntosPeso].reverse().map((p) => `<tr><td>${formatearFecha(p.fecha)}</td><td class="num">${kg(p.peso)}</td><td>${p.origen}</td></tr>`).join('')
  }</tbody></table>`;

  if (puntosPeso.length < 2) {
    cont.insertAdjacentHTML('afterbegin', `<p class="vacio">${puntosPeso.length
      ? 'Registra al menos dos pesos en fechas distintas para ver la evolución.'
      : 'Aún no hay pesos registrados. Anota el peso en una nueva anotación.'}</p>`);
    return;
  }

  const ancho = Math.max(cont.clientWidth, 280);
  const alto = 240;
  const m = { arriba: 16, derecha: 64, abajo: 28, izquierda: 40 };
  const t0 = new Date(`${puntosPeso[0].fecha}T00:00`).getTime();
  const t1 = new Date(`${puntosPeso.at(-1).fecha}T00:00`).getTime();
  const { bajo, alto: tope, ticks } = escalaY(Math.min(...puntosPeso.map((p) => p.peso)), Math.max(...puntosPeso.map((p) => p.peso)));

  const xT = (t) => m.izquierda + ((t - t0) / (t1 - t0 || 1)) * (ancho - m.izquierda - m.derecha);
  const x = (fecha) => xT(new Date(`${fecha}T00:00`).getTime());
  const y = (peso) => m.arriba + (1 - (peso - bajo) / (tope - bajo)) * (alto - m.arriba - m.abajo);
  const pts = puntosPeso.map((p) => ({ ...p, x: x(p.fecha), y: y(p.peso) }));

  // Etiquetas del eje X: hasta 4 fechas repartidas en el periodo
  const variosAnios = t1 - t0 > 300 * 864e5;
  const formatoX = (t) => new Date(t).toLocaleDateString('es-CL', variosAnios ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
  const nX = Math.min(4, Math.max(2, Math.floor((ancho - 100) / 110)));
  const ticksX = Array.from({ length: nX }, (_, i) => t0 + ((t1 - t0) * i) / (nX - 1));

  const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const base = y(bajo);
  const area = `${linea} L${pts.at(-1).x.toFixed(1)},${base} L${pts[0].x.toFixed(1)},${base} Z`;
  const fin = pts.at(-1);

  cont.insertAdjacentHTML('afterbegin', `
    <svg viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" tabindex="0"
         aria-label="Gráfico de evolución del peso. Usa las flechas para recorrer los registros.">
      <g class="g-grilla">
        ${ticks.map((v) => `<line x1="${m.izquierda}" x2="${ancho - m.derecha}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}
      </g>
      <g class="g-eje">
        ${ticks.map((v) => `<text x="${m.izquierda - 8}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString('es-CL')}</text>`).join('')}
        ${ticksX.map((t, i) => `<text x="${xT(t)}" y="${alto - 6}" text-anchor="${i === 0 ? 'start' : i === nX - 1 ? 'end' : 'middle'}">${formatoX(t)}</text>`).join('')}
      </g>
      <path class="g-area" d="${area}"/>
      <path class="g-linea" d="${linea}"/>
      <line class="g-cruz oculto" y1="${m.arriba}" y2="${base}"/>
      ${pts.map((p) => `<circle class="g-punto" cx="${p.x}" cy="${p.y}" r="4"/>`).join('')}
      <circle class="g-activo oculto" r="6"/>
      <text class="g-final" x="${fin.x + 10}" y="${fin.y + 4}">${kg(fin.peso)}</text>
    </svg>`);

  const svg = cont.querySelector('svg');
  const cruz = svg.querySelector('.g-cruz');
  const activo = svg.querySelector('.g-activo');
  let indice = pts.length - 1;

  const mostrar = (i) => {
    indice = i;
    const p = pts[i];
    cruz.setAttribute('x1', p.x); cruz.setAttribute('x2', p.x);
    activo.setAttribute('cx', p.x); activo.setAttribute('cy', p.y);
    cruz.classList.remove('oculto'); activo.classList.remove('oculto');
    tooltip.replaceChildren();
    const fecha = document.createElement('div'); fecha.className = 'sutil'; fecha.textContent = fechaLarga(p.fecha);
    const valor = document.createElement('strong'); valor.textContent = kg(p.peso);
    const origen = document.createElement('div'); origen.className = 'sutil'; origen.textContent = p.origen;
    tooltip.append(fecha, valor, origen);
    tooltip.classList.remove('oculto');
    const izquierda = Math.min(Math.max(p.x - tooltip.offsetWidth / 2, 0), ancho - tooltip.offsetWidth);
    tooltip.style.left = `${izquierda}px`;
    tooltip.style.top = `${Math.max(p.y - tooltip.offsetHeight - 12, 0)}px`;
  };
  const ocultar = () => { cruz.classList.add('oculto'); activo.classList.add('oculto'); tooltip.classList.add('oculto'); };

  // La cruz se ajusta al registro más cercano al puntero
  svg.addEventListener('pointermove', (e) => {
    const xPuntero = ((e.clientX - svg.getBoundingClientRect().left) / svg.clientWidth) * ancho;
    let cercano = 0;
    pts.forEach((p, i) => { if (Math.abs(p.x - xPuntero) < Math.abs(pts[cercano].x - xPuntero)) cercano = i; });
    mostrar(cercano);
  });
  svg.addEventListener('pointerleave', ocultar);
  svg.addEventListener('focus', () => mostrar(indice));
  svg.addEventListener('blur', ocultar);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && indice > 0) mostrar(indice - 1);
    else if (e.key === 'ArrowRight' && indice < pts.length - 1) mostrar(indice + 1);
    else return;
    e.preventDefault();
  });
}

// ---------- Anotaciones ----------
function pintarFiltros() {
  const usados = new Set(ficha.libro.map((r) => r.tipo));
  const chips = [['', 'Todas'], ...Object.entries(TIPOS).filter(([k]) => usados.has(k)).map(([k, t]) => [k, `${t.icono} ${t.nombre}`])];
  $('filtros').innerHTML = usados.size > 1
    ? chips.map(([k, n]) => `<button type="button" class="chip ${k === filtro ? 'activo' : ''}" data-tipo="${k}">${n}</button>`).join('')
    : '';
}

function pintarAnotaciones() {
  const lista = ficha.libro.filter((r) => !filtro || r.tipo === filtro);
  if (!lista.length) {
    $('anotaciones').innerHTML = '<p class="vacio">Todavía no hay anotaciones. Registra la primera arriba: un cambio de comida, un paseo, un síntoma, el peso…</p>';
    return;
  }
  const porMes = new Map();
  for (const r of lista) {
    const textoMes = new Date(`${r.fecha}T00:00`).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    const mes = textoMes[0].toUpperCase() + textoMes.slice(1);
    if (!porMes.has(mes)) porMes.set(mes, []);
    porMes.get(mes).push(r);
  }
  $('anotaciones').innerHTML = [...porMes].map(([mes, registros]) => `
    <h3 class="mes">${esc(mes)}</h3>
    <ol class="linea-tiempo">
      ${registros.map((r) => {
        const tipo = TIPOS[r.tipo] || TIPOS.otro;
        return `<li class="anotacion">
          <div class="anotacion-icono" aria-hidden="true">${tipo.icono}</div>
          <div class="anotacion-cuerpo">
            <div class="anotacion-meta"><span class="sutil">${formatearFecha(r.fecha)}</span> <span class="etiqueta">${tipo.nombre}</span>
              ${r.peso != null ? `<span class="etiqueta peso">⚖️ ${kg(r.peso)}</span>` : ''}</div>
            <div class="anotacion-titulo">${esc(r.titulo)}</div>
            ${r.detalle ? `<p class="anotacion-detalle">${esc(r.detalle)}</p>` : ''}
          </div>
          <button class="btn peligro chico no-imprimir" data-borrar="${r.id}" title="Eliminar anotación" aria-label="Eliminar anotación">✕</button>
        </li>`;
      }).join('')}
    </ol>`).join('');
}

async function cargar() {
  try {
    ficha = await api(`/api/mascotas/${encodeURIComponent(idMascota)}`);
  } catch (err) {
    mostrarAviso($('aviso-general'), err.message);
    $('titulo').textContent = 'Libro no disponible';
    return;
  }
  document.title = `Libro de control de ${ficha.nombre} — MasoPet`;
  $('titulo').textContent = ficha.nombre;
  if (ficha.foto) $('libro-foto').innerHTML = avatarMascota(ficha, 'grande');
  $('subtitulo').textContent = `${ICONOS_ESPECIE[ficha.especie] || '🐾'} ${[ficha.especie, ficha.raza, edad(ficha.fecha_nacimiento)].filter(Boolean).join(' · ')}`;
  $('enlace-ficha').href = `ficha.html?id=${ficha.id}`;
  if (!ficha.libro.some((r) => r.tipo === filtro)) filtro = '';
  puntosPeso = calcularPuntosPeso();
  pintarResumen();
  pintarGrafico();
  pintarFiltros();
  pintarAnotaciones();
}

// ---------- Eventos ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/mascotas/${idMascota}/libro`, { method: 'POST', body: datosFormulario(form) });
    form.reset();
    form.fecha.value = hoyISO();
    $('aviso-anotacion').className = '';
    $('aviso-anotacion').textContent = '';
    cargar();
  } catch (err) {
    mostrarAviso($('aviso-anotacion'), err.message);
  }
});

form.tipo.addEventListener('change', () => {
  form.peso.placeholder = form.tipo.value === 'peso' ? 'Ej: 12,5' : 'Opcional';
});

$('filtros').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-tipo]');
  if (!chip) return;
  filtro = chip.dataset.tipo;
  pintarFiltros();
  pintarAnotaciones();
});

$('anotaciones').addEventListener('click', async (e) => {
  const boton = e.target.closest('[data-borrar]');
  if (!boton || !confirm('¿Eliminar esta anotación?')) return;
  try {
    await api(`/api/mascotas/${idMascota}/libro/${boton.dataset.borrar}`, { method: 'DELETE' });
    cargar();
  } catch (err) {
    alert(err.message);
  }
});

let temporizador;
window.addEventListener('resize', () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => ficha && pintarGrafico(), 150);
});

// ---------- Inicio ----------
$('select-tipo').innerHTML = Object.entries(TIPOS).map(([k, t]) => `<option value="${k}">${t.icono} ${t.nombre}</option>`).join('');
form.fecha.value = hoyISO();
requerirSesion().then((u) => {
  if (!u) return;
  $('duenio').textContent = `Tutor/a: ${u.nombre}`;
  cargar();
});
