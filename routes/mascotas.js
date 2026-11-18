import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { urlPublica, limitador, fechaLocal } from '../config.js';
import { guardarFoto, borrarFoto } from '../fotos.js';
import { requiereLogin } from './auth.js';
import { notificar } from '../notificaciones.js';
import { enviarCorreo, plantilla, boton, escHtml } from '../correo.js';
import { MAX_TUTORES, SQL_MIS_MASCOTAS, mascotaConAcceso, idsTutores } from '../tutores.js';

const CAMPOS_MASCOTA = ['nombre', 'especie', 'raza', 'sexo', 'fecha_nacimiento', 'color', 'peso', 'microchip', 'esterilizado', 'alergias', 'condiciones', 'notas', 'tamano', 'caracter'];

// Secciones del historial clínico. Los nombres de tabla y campos vienen de aquí, nunca del cliente.
const SECCIONES = {
  vacunas: {
    campos: ['nombre', 'fecha', 'proxima_fecha', 'veterinario', 'notas'],
    requeridos: ['nombre', 'fecha'],
    orden: 'fecha DESC',
  },
  desparasitaciones: {
    campos: ['producto', 'tipo', 'fecha', 'proxima_fecha', 'notas'],
    requeridos: ['producto', 'fecha'],
    orden: 'fecha DESC',
  },
  consultas: {
    campos: ['fecha', 'motivo', 'diagnostico', 'tratamiento', 'veterinario', 'peso'],
    requeridos: ['fecha', 'motivo'],
    orden: 'fecha DESC',
  },
  citas: {
    campos: ['fecha', 'hora', 'motivo', 'veterinario', 'notas'],
    requeridos: ['fecha', 'motivo'],
    orden: 'fecha DESC, hora DESC',
  },
  medicamentos: {
    campos: ['nombre', 'dosis', 'cada_dias', 'horario', 'fecha_inicio', 'fecha_fin', 'notas'],
    requeridos: ['nombre', 'fecha_inicio'],
    orden: 'fecha_inicio DESC, id DESC',
    validar: (d) => (d.fecha_fin && d.fecha_fin < d.fecha_inicio ? 'La fecha de término no puede ser anterior a la de inicio' : null),
  },
  libro: {
    campos: ['fecha', 'tipo', 'titulo', 'detalle', 'peso'],
    requeridos: ['fecha', 'tipo', 'titulo'],
    opciones: { tipo: ['control', 'peso', 'medicamento', 'alimentacion', 'higiene', 'ejercicio', 'comportamiento', 'sintoma', 'otro'] },
    orden: 'fecha DESC, id DESC',
  },
};

function limpiar(campo, valor) {
  if (campo === 'peso') {
    const numero = Number(valor);
    return valor === '' || valor == null || !Number.isFinite(numero) || numero < 0 ? null : numero;
  }
  if (campo === 'esterilizado') return valor === true || valor === 1 || valor === '1' || valor === 'on' ? 1 : 0;
  // Cada cuántos días se da un medicamento (1 = todos los días)
  if (campo === 'cada_dias') return Math.min(365, Math.max(1, Math.round(Number(valor)) || 1));
  if (campo === 'hora') return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(valor ?? '')) ? String(valor) : null;
  const texto = String(valor ?? '').trim().slice(0, 2000);
  return texto || null;
}

function extraer(body, campos) {
  return Object.fromEntries(campos.map((c) => [c, limpiar(c, body?.[c])]));
}

// La mascota si quien pide es su dueño o uno de sus tutores (pueden ver y editar la ficha y el libro)
function mascotaDelUsuario(req, res) {
  const mascota = mascotaConAcceso(req.usuario.id, Number(req.params.id));
  if (!mascota) res.status(404).json({ error: 'Mascota no encontrada' });
  return mascota;
}

export const mascotasRouter = Router();
mascotasRouter.use(requiereLogin);

// Mis mascotas: las propias y las que cuido como tutor
mascotasRouter.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT m.*, (m.usuario_id = ?) AS es_dueno, u.nombre AS dueno,
      (SELECT COUNT(*) FROM mascota_tutores t WHERE t.mascota_id = m.id AND t.estado = 'aceptado') AS otros_tutores
    FROM mascotas m JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.id IN (${SQL_MIS_MASCOTAS})
    ORDER BY m.nombre
  `).all(req.usuario.id, req.usuario.id, req.usuario.id));
});

// ---------- Invitaciones para ser tutor (van antes de las rutas /:id) ----------
mascotasRouter.get('/invitaciones', (req, res) => {
  res.json(db.prepare(`
    SELECT m.id AS mascota_id, m.nombre, m.especie, m.raza, m.foto, d.nombre AS dueno
    FROM mascota_tutores t JOIN mascotas m ON m.id = t.mascota_id JOIN usuarios d ON d.id = m.usuario_id
    WHERE t.usuario_id = ? AND t.estado = 'pendiente'
    ORDER BY t.creado_en DESC
  `).all(req.usuario.id));
});

mascotasRouter.post('/invitaciones/:mascotaId', (req, res) => {
  const mascotaId = Number(req.params.mascotaId);
  const invitacion = db.prepare(`
    SELECT m.id, m.nombre, m.usuario_id AS dueno_id FROM mascota_tutores t JOIN mascotas m ON m.id = t.mascota_id
    WHERE t.mascota_id = ? AND t.usuario_id = ? AND t.estado = 'pendiente'
  `).get(mascotaId, req.usuario.id);
  if (!invitacion) return res.status(404).json({ error: 'La invitación ya no existe' });

  if (req.body?.aceptar) {
    db.prepare("UPDATE mascota_tutores SET estado = 'aceptado' WHERE mascota_id = ? AND usuario_id = ?").run(mascotaId, req.usuario.id);
    notificar(idsTutores(mascotaId).filter((id) => id !== req.usuario.id),
      `👥 ${req.usuario.nombre} ahora también cuida a ${invitacion.nombre}`, `ficha.html?id=${mascotaId}`);
  } else {
    db.prepare('DELETE FROM mascota_tutores WHERE mascota_id = ? AND usuario_id = ?').run(mascotaId, req.usuario.id);
    notificar([invitacion.dueno_id], `${req.usuario.nombre} rechazó la invitación para cuidar a ${invitacion.nombre}`, `ficha.html?id=${mascotaId}`);
  }
  res.status(204).end();
});

mascotasRouter.post('/', (req, res) => {
  const datos = extraer(req.body, CAMPOS_MASCOTA);
  if (!datos.nombre || !datos.especie) return res.status(400).json({ error: 'Nombre y especie son obligatorios' });

  const columnas = ['usuario_id', ...CAMPOS_MASCOTA];
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO mascotas (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`
  ).run(req.usuario.id, ...CAMPOS_MASCOTA.map((c) => datos[c]));

  res.status(201).json(db.prepare('SELECT * FROM mascotas WHERE id = ?').get(lastInsertRowid));
});

// Ficha clínica completa (también la usa el enlace compartido con el veterinario)
export function fichaCompleta(mascota) {
  const ficha = { ...mascota };
  for (const [seccion, { orden }] of Object.entries(SECCIONES)) {
    ficha[seccion] = db.prepare(`SELECT * FROM ${seccion} WHERE mascota_id = ? ORDER BY ${orden}`).all(mascota.id);
  }
  return ficha;
}

mascotasRouter.get('/:id', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  res.json(fichaCompleta(mascota));
});

mascotasRouter.put('/:id', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  const datos = extraer(req.body, CAMPOS_MASCOTA);
  if (!datos.nombre || !datos.especie) return res.status(400).json({ error: 'Nombre y especie son obligatorios' });

  db.prepare(`UPDATE mascotas SET ${CAMPOS_MASCOTA.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...CAMPOS_MASCOTA.map((c) => datos[c]), mascota.id);
  res.json(db.prepare('SELECT * FROM mascotas WHERE id = ?').get(mascota.id));
});

mascotasRouter.delete('/:id', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  if (!mascota.es_dueno) return res.status(403).json({ error: `Solo ${mascota.dueno} puede eliminar la ficha de ${mascota.nombre}. Si ya no la cuidas, usa “Dejar de ser tutor”.` });
  db.prepare('DELETE FROM mascotas WHERE id = ?').run(mascota.id);
  borrarFoto(mascota.foto);
  res.status(204).end();
});

// ---------- Foto ----------
mascotasRouter.put('/:id/foto', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  const foto = guardarFoto(req.body?.imagen);
  if (!foto) return res.status(400).json({ error: 'La imagen no es válida (usa JPG, PNG o WebP de menos de 3 MB)' });
  db.prepare('UPDATE mascotas SET foto = ? WHERE id = ?').run(foto, mascota.id);
  borrarFoto(mascota.foto);
  res.json({ foto });
});

mascotasRouter.delete('/:id/foto', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  db.prepare('UPDATE mascotas SET foto = NULL WHERE id = ?').run(mascota.id);
  borrarFoto(mascota.foto);
  res.status(204).end();
});

// ---------- Compartir con el veterinario ----------
const DURACIONES = { 1: '24 horas', 7: '7 días', 30: '30 días' };
const conUrl = (enlace) => ({ ...enlace, url: `${urlPublica()}/compartido.html?t=${enlace.token}` });

mascotasRouter.get('/:id/compartir', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  db.prepare('DELETE FROM compartidos WHERE expira <= ?').run(Date.now());
  res.json(db.prepare('SELECT id, token, expira FROM compartidos WHERE mascota_id = ? ORDER BY expira DESC').all(mascota.id).map(conUrl));
});

mascotasRouter.post('/:id/compartir', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  const dias = Number(req.body?.dias);
  if (!DURACIONES[dias]) return res.status(400).json({ error: 'Duración no válida' });
  const token = crypto.randomBytes(24).toString('base64url');
  const expira = Date.now() + dias * 864e5;
  const { lastInsertRowid } = db.prepare('INSERT INTO compartidos (mascota_id, token, expira) VALUES (?, ?, ?)').run(mascota.id, token, expira);
  res.status(201).json(conUrl({ id: Number(lastInsertRowid), token, expira }));
});

mascotasRouter.delete('/:id/compartir/:enlaceId', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  db.prepare('DELETE FROM compartidos WHERE id = ? AND mascota_id = ?').run(Number(req.params.enlaceId), mascota.id);
  res.status(204).end();
});

// ---------- Tutores (van antes de las rutas genéricas /:id/:seccion) ----------
mascotasRouter.get('/:id/tutores', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  const dueno = db.prepare('SELECT id, nombre FROM usuarios WHERE id = ?').get(mascota.usuario_id);
  const tutores = db.prepare(`
    SELECT u.id, u.nombre, u.email, t.estado FROM mascota_tutores t JOIN usuarios u ON u.id = t.usuario_id
    WHERE t.mascota_id = ? ORDER BY t.estado = 'pendiente', t.creado_en
  `).all(mascota.id)
    // Las invitaciones pendientes y los correos solo los ve el dueño
    .filter((t) => mascota.es_dueno || t.estado === 'aceptado')
    .map((t) => ({ id: t.id, nombre: t.nombre, estado: t.estado, ...(mascota.es_dueno ? { email: t.email } : {}) }));
  res.json({ es_dueno: Boolean(mascota.es_dueno), dueno, tutores, max: MAX_TUTORES });
});

mascotasRouter.post('/:id/tutores', limitador({ max: 20, minutos: 60, mensaje: 'Has enviado muchas invitaciones seguidas. Espera un poco.' }), async (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  if (!mascota.es_dueno) return res.status(403).json({ error: `Solo ${mascota.dueno} puede invitar a otros tutores` });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const invitado = db.prepare('SELECT id, nombre, email, bloqueado FROM usuarios WHERE lower(email) = ?').get(email);
  if (!invitado || invitado.bloqueado) {
    return res.status(404).json({ error: 'No hay una cuenta de MasoPet con ese correo. Pídele a esa persona que se registre primero.' });
  }
  if (invitado.id === req.usuario.id) return res.status(400).json({ error: 'Ese es tu propio correo' });
  const actual = db.prepare('SELECT estado FROM mascota_tutores WHERE mascota_id = ? AND usuario_id = ?').get(mascota.id, invitado.id);
  if (actual) return res.status(409).json({ error: actual.estado === 'aceptado' ? `${invitado.nombre} ya es tutor de ${mascota.nombre}` : `Ya invitaste a ${invitado.nombre}; falta que acepte` });
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM mascota_tutores WHERE mascota_id = ?').get(mascota.id);
  if (total + 1 >= MAX_TUTORES) return res.status(400).json({ error: `Una mascota puede tener hasta ${MAX_TUTORES} tutores, contándote a ti` });

  db.prepare('INSERT INTO mascota_tutores (mascota_id, usuario_id, invitado_por) VALUES (?, ?, ?)').run(mascota.id, invitado.id, req.usuario.id);
  notificar([invitado.id], `👥 ${req.usuario.nombre} te invitó a ser tutor/a de ${mascota.nombre}`, 'mascotas.html#invitaciones');
  enviarCorreo({
    para: invitado.email,
    asunto: `👥 ${req.usuario.nombre} te invitó a cuidar a ${mascota.nombre} en MasoPet`,
    html: plantilla(`Te invitaron a cuidar a ${mascota.nombre}`, `
      <p>Hola ${escHtml(invitado.nombre)}, ${escHtml(req.usuario.nombre)} quiere que también seas tutor/a de <strong>${escHtml(mascota.nombre)}</strong>.</p>
      <p>Si aceptas, verás y podrás editar su ficha clínica y su libro de control, y recibirás los recordatorios de sus vacunas.</p>
      ${boton(`${urlPublica()}/mascotas.html#invitaciones`, 'Ver la invitación')}`),
    texto: `${req.usuario.nombre} te invitó a cuidar a ${mascota.nombre} en MasoPet: ${urlPublica()}/mascotas.html#invitaciones`,
  }).catch((err) => console.error('No se pudo enviar la invitación de tutor:', err.message));
  res.status(201).json({ id: invitado.id, nombre: invitado.nombre, email: invitado.email, estado: 'pendiente' });
});

// El dueño quita a un tutor (o anula una invitación); un tutor puede quitarse a sí mismo
mascotasRouter.delete('/:id/tutores/:usuarioId', (req, res) => {
  const mascotaId = Number(req.params.id);
  const usuarioId = Number(req.params.usuarioId);
  const mascota = db.prepare('SELECT m.id, m.nombre, m.usuario_id FROM mascotas m WHERE m.id = ?').get(mascotaId);
  const esDueno = mascota?.usuario_id === req.usuario.id;
  const esElMismo = usuarioId === req.usuario.id;
  if (!mascota || (!esDueno && !(esElMismo && mascotaConAcceso(req.usuario.id, mascotaId)))) {
    return res.status(404).json({ error: 'Mascota no encontrada' });
  }
  if (usuarioId === mascota.usuario_id) return res.status(400).json({ error: 'El dueño no puede quitarse; puede eliminar la ficha' });
  const { changes } = db.prepare('DELETE FROM mascota_tutores WHERE mascota_id = ? AND usuario_id = ?').run(mascotaId, usuarioId);
  if (!changes) return res.status(404).json({ error: 'Esa persona no es tutor de esta mascota' });
  if (esElMismo) notificar([mascota.usuario_id], `${req.usuario.nombre} dejó de ser tutor de ${mascota.nombre}`, `ficha.html?id=${mascotaId}`);
  else notificar([usuarioId], `Ya no eres tutor de ${mascota.nombre}`, null);
  res.status(204).end();
});

// ---------- "✓ Ya se lo di": registra una dosis en el libro de control y avisa a los otros tutores ----------
const dosAdigitos = (n) => String(n).padStart(2, '0');

mascotasRouter.post('/:id/medicamentos/:medId/dosis', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  const med = db.prepare('SELECT * FROM medicamentos WHERE id = ? AND mascota_id = ?').get(Number(req.params.medId), mascota.id);
  if (!med) return res.status(404).json({ error: 'Medicamento no encontrado' });

  const ahora = new Date();
  const hora = `${dosAdigitos(ahora.getHours())}:${dosAdigitos(ahora.getMinutes())}`;
  const quien = req.usuario.nombre.trim().split(/\s+/)[0];
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO libro (mascota_id, fecha, tipo, titulo, detalle, medicamento_id, usuario_id, hora)
    VALUES (?, ?, 'medicamento', ?, ?, ?, ?, ?)
  `).run(mascota.id, fechaLocal(), `${med.nombre}${med.dosis ? ` (${med.dosis})` : ''}`, `${quien} se lo dio a las ${hora}`, med.id, req.usuario.id, hora);
  notificar(idsTutores(mascota.id).filter((id) => id !== req.usuario.id),
    `💊 ${quien} le dio ${med.nombre} a ${mascota.nombre} a las ${hora}`, `ficha.html?id=${mascota.id}`);
  res.status(201).json(db.prepare('SELECT * FROM libro WHERE id = ?').get(lastInsertRowid));
});

// ---------- Agregar una cita o un medicamento al calendario del celular (archivo .ics) ----------
// Horas que aparecen en el texto del horario, ej: "8:00 y 20:00" → ['08:00', '20:00']
export function horasDelHorario(horario) {
  const horas = [...String(horario || '').matchAll(/\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/g)].map((m) => `${dosAdigitos(m[1])}:${m[2]}`);
  return [...new Set(horas)].sort();
}
const icsTexto = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsFecha = (iso) => iso.replaceAll('-', '');
const icsHora = (hhmm) => `${hhmm.replace(':', '')}00`;
// El formato pide cortar las líneas largas en trozos de máximo 75 bytes (las siguientes empiezan con un espacio)
function icsPlegar(linea) {
  const trozos = [];
  let actual = '';
  for (const caracter of linea) {
    if (Buffer.byteLength(actual + caracter) > (trozos.length ? 74 : 75)) { trozos.push(actual); actual = ''; }
    actual += caracter;
  }
  trozos.push(actual);
  return trozos.join('\r\n ');
}

mascotasRouter.get('/:id/:seccion/:registroId/calendario.ics', (req, res) => {
  const { seccion } = req.params;
  if (!['citas', 'medicamentos'].includes(seccion)) return res.status(404).json({ error: 'Sección no válida' });
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  const r = db.prepare(`SELECT * FROM ${seccion} WHERE id = ? AND mascota_id = ?`).get(Number(req.params.registroId), mascota.id);
  if (!r) return res.status(404).json({ error: 'Registro no encontrado' });

  const sello = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const enlace = `${urlPublica()}/ficha.html?id=${mascota.id}`;
  const eventos = [];
  if (seccion === 'citas') {
    const inicio = r.hora ? `DTSTART:${icsFecha(r.fecha)}T${icsHora(r.hora)}` : `DTSTART;VALUE=DATE:${icsFecha(r.fecha)}`;
    eventos.push([
      'BEGIN:VEVENT', `UID:masopet-cita-${r.id}@masopet.cl`, `DTSTAMP:${sello}`, inicio,
      r.hora ? 'DURATION:PT1H' : 'DURATION:P1D',
      `SUMMARY:${icsTexto(`🩺 ${mascota.nombre}: ${r.motivo}`)}`,
      r.veterinario ? `LOCATION:${icsTexto(r.veterinario)}` : null,
      `DESCRIPTION:${icsTexto([r.notas, `Ficha en MasoPet: ${enlace}`].filter(Boolean).join('\n'))}`,
      // Aviso el día anterior y 1 hora antes (o a las 9:00 del día anterior si no tiene hora)
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsTexto(`Mañana: cita de ${mascota.nombre}`)}`, `TRIGGER:${r.hora ? '-P1D' : '-PT15H'}`, 'END:VALARM',
      ...(r.hora ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsTexto(`En 1 hora: cita de ${mascota.nombre}`)}`, 'TRIGGER:-PT1H', 'END:VALARM'] : []),
      'END:VEVENT',
    ]);
  } else {
    // Un evento que se repite por cada hora del horario (si no indica horas, a las 9:00)
    for (const hora of horasDelHorario(r.horario).length ? horasDelHorario(r.horario) : ['09:00']) {
      eventos.push([
        'BEGIN:VEVENT', `UID:masopet-medicamento-${r.id}-${hora.replace(':', '')}@masopet.cl`, `DTSTAMP:${sello}`,
        `DTSTART:${icsFecha(r.fecha_inicio)}T${icsHora(hora)}`, 'DURATION:PT15M',
        `RRULE:FREQ=DAILY;INTERVAL=${r.cada_dias}${r.fecha_fin ? `;UNTIL=${icsFecha(r.fecha_fin)}T235959` : ''}`,
        `SUMMARY:${icsTexto(`💊 ${mascota.nombre}: ${r.nombre}${r.dosis ? ` (${r.dosis})` : ''}`)}`,
        `DESCRIPTION:${icsTexto([r.notas, `Marca la dosis con “✓ Ya se lo di” en MasoPet: ${enlace}`].filter(Boolean).join('\n'))}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsTexto(`Toca darle ${r.nombre} a ${mascota.nombre}`)}`, 'TRIGGER:PT0M', 'END:VALARM',
        'END:VEVENT',
      ]);
    }
  }
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MasoPet//Recordatorios//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...eventos.flat().filter(Boolean), 'END:VCALENDAR'].map(icsPlegar).join('\r\n');
  const nombre = `${seccion === 'citas' ? 'cita' : 'medicamento'}-${mascota.nombre}`.normalize('NFD').replace(/[^\w-]+/g, '').toLowerCase();
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombre || 'masopet'}.ics"`, 'Cache-Control': 'no-store' });
  res.send(`${ics}\r\n`);
});

// Validaciones comunes al crear y al editar un registro del historial
function problemaRegistro(config, datos) {
  const faltante = config.requeridos.find((c) => !datos[c]);
  if (faltante) return `El campo "${faltante.replace('_', ' ')}" es obligatorio`;
  const invalido = Object.entries(config.opciones || {}).find(([c, validos]) => !validos.includes(datos[c]));
  if (invalido) return `El valor de "${invalido[0]}" no es válido`;
  return config.validar?.(datos) || null;
}

// Editar un registro: PUT /api/mascotas/:id/vacunas/5 (también medicamentos, citas, consultas, etc.)
mascotasRouter.put('/:id/:seccion/:registroId', (req, res) => {
  const config = SECCIONES[req.params.seccion];
  if (!config) return res.status(404).json({ error: 'Sección no válida' });
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;

  const datos = extraer(req.body, config.campos);
  const problema = problemaRegistro(config, datos);
  if (problema) return res.status(400).json({ error: problema });

  const { changes } = db.prepare(`UPDATE ${req.params.seccion} SET ${config.campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND mascota_id = ?`)
    .run(...config.campos.map((c) => datos[c]), Number(req.params.registroId), mascota.id);
  if (!changes) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json(db.prepare(`SELECT * FROM ${req.params.seccion} WHERE id = ?`).get(Number(req.params.registroId)));
});

// Registros del historial: /api/mascotas/:id/vacunas, /desparasitaciones, /consultas, /libro
mascotasRouter.post('/:id/:seccion', (req, res) => {
  const config = SECCIONES[req.params.seccion];
  if (!config) return res.status(404).json({ error: 'Sección no válida' });
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;

  const datos = extraer(req.body, config.campos);
  const problema = problemaRegistro(config, datos);
  if (problema) return res.status(400).json({ error: problema });

  const columnas = ['mascota_id', ...config.campos];
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO ${req.params.seccion} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`
  ).run(mascota.id, ...config.campos.map((c) => datos[c]));

  res.status(201).json(db.prepare(`SELECT * FROM ${req.params.seccion} WHERE id = ?`).get(lastInsertRowid));
});

mascotasRouter.delete('/:id/:seccion/:registroId', (req, res) => {
  if (!SECCIONES[req.params.seccion]) return res.status(404).json({ error: 'Sección no válida' });
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;

  const { changes } = db.prepare(`DELETE FROM ${req.params.seccion} WHERE id = ? AND mascota_id = ?`)
    .run(Number(req.params.registroId), mascota.id);
  if (!changes) return res.status(404).json({ error: 'Registro no encontrado' });
  res.status(204).end();
});
