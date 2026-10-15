import { Router } from 'express';
import { db } from '../db.js';
import { fechaLocal, distanciaKm, limitador, urlPublica } from '../config.js';
import { enviarCorreo, plantilla, boton, escHtml } from '../correo.js';
import { requiereLogin } from './auth.js';

const HORARIOS = ['manana', 'tarde', 'noche'];
const RADIOS = [1, 3, 5, 10, 20];
const texto = (valor, max) => String(valor ?? '').trim().slice(0, max) || null;
// ~1 km de precisión: suficiente para encontrar vecinos sin revelar dónde vive nadie
const aproximar = (n) => Math.round(n * 100) / 100;
const distanciaVisible = (km) => Math.max(0.5, Math.round(km * 2) / 2);
const coordenadasValidas = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// Solo nombre e inicial del apellido
export function nombreCorto(nombre) {
  const [nombrePila, apellido] = String(nombre).trim().split(/\s+/);
  return apellido ? `${nombrePila} ${apellido[0]}.` : nombrePila;
}

const miPerfil = (usuarioId) => db.prepare('SELECT * FROM perfiles_paseo WHERE usuario_id = ?').get(usuarioId);
const radioPedido = (req) => (RADIOS.includes(Number(req.query.radio)) ? Number(req.query.radio) : 5);

function mascotasDePaseo(usuarioId) {
  return db.prepare(`
    SELECT m.id, m.nombre, m.especie, m.raza, m.foto, m.fecha_nacimiento, m.tamano, m.caracter
    FROM perfil_paseo_mascotas pm JOIN mascotas m ON m.id = pm.mascota_id
    WHERE pm.usuario_id = ? ORDER BY m.nombre
  `).all(usuarioId);
}

async function notificar(usuarioIds, asunto, titulo, cuerpo, enlace, textoBoton) {
  const usuarios = db.prepare(`SELECT nombre, email FROM usuarios WHERE bloqueado = 0 AND id IN (${usuarioIds.map(() => '?').join(',') || 'NULL'})`).all(...usuarioIds);
  for (const u of usuarios) {
    enviarCorreo({
      para: u.email,
      asunto,
      html: plantilla(titulo, `<p>Hola ${escHtml(nombreCorto(u.nombre))},</p>${cuerpo}${boton(enlace, textoBoton)}`),
      texto: `${titulo}. Míralo en ${enlace}`,
    }).catch((err) => console.error('No se pudo enviar aviso de paseo:', err.message));
  }
}

const fechaBonita = (fecha, hora) =>
  `${new Date(`${fecha}T00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })} a las ${hora}`;

export const paseosRouter = Router();
paseosRouter.use(requiereLogin);

// ---------- Perfil de paseo ----------
paseosRouter.get('/perfil', (req, res) => {
  const perfil = miPerfil(req.usuario.id);
  res.json({
    perfil: perfil ? { ...perfil, horarios: perfil.horarios ? perfil.horarios.split(',') : [] } : null,
    mascotas_ids: mascotasDePaseo(req.usuario.id).map((m) => m.id),
  });
});

paseosRouter.put('/perfil', (req, res) => {
  const activo = req.body?.activo ? 1 : 0;
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (activo && !coordenadasValidas(lat, lng)) return res.status(400).json({ error: 'Marca tu zona en el mapa' });

  const horarios = (Array.isArray(req.body?.horarios) ? req.body.horarios : []).filter((h) => HORARIOS.includes(h));
  const propias = new Set(db.prepare('SELECT id FROM mascotas WHERE usuario_id = ?').all(req.usuario.id).map((m) => m.id));
  const mascotas = [...new Set((Array.isArray(req.body?.mascotas) ? req.body.mascotas : []).map(Number))].filter((id) => propias.has(id));
  if (activo && !mascotas.length) return res.status(400).json({ error: 'Elige al menos una mascota que salga a pasear' });

  const anterior = miPerfil(req.usuario.id);
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO perfiles_paseo (usuario_id, activo, lat, lng, descripcion, horarios) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (usuario_id) DO UPDATE SET activo = excluded.activo, lat = excluded.lat, lng = excluded.lng,
        descripcion = excluded.descripcion, horarios = excluded.horarios, actualizado_en = datetime('now')
    `).run(req.usuario.id, activo,
      coordenadasValidas(lat, lng) ? aproximar(lat) : anterior?.lat ?? 0,
      coordenadasValidas(lat, lng) ? aproximar(lng) : anterior?.lng ?? 0,
      texto(req.body?.descripcion, 500), horarios.join(','));
    db.prepare('DELETE FROM perfil_paseo_mascotas WHERE usuario_id = ?').run(req.usuario.id);
    const insertar = db.prepare('INSERT INTO perfil_paseo_mascotas (usuario_id, mascota_id) VALUES (?, ?)');
    for (const id of mascotas) insertar.run(req.usuario.id, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ activo });
});

// ---------- Vecinos cerca ----------
paseosRouter.get('/vecinos', (req, res) => {
  const perfil = miPerfil(req.usuario.id);
  if (!perfil?.activo) return res.status(409).json({ error: 'Activa tu perfil de paseo para ver a tus vecinos', requierePerfil: true });
  const radio = radioPedido(req);

  const vecinos = db.prepare(`
    SELECT p.usuario_id, p.lat, p.lng, p.descripcion, p.horarios, u.nombre
    FROM perfiles_paseo p JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.activo = 1 AND u.bloqueado = 0 AND p.usuario_id != ?
  `).all(req.usuario.id)
    .map((v) => ({ ...v, km: distanciaKm(perfil, v) }))
    .filter((v) => v.km <= radio)
    .sort((a, b) => a.km - b.km)
    .map((v) => ({
      usuario_id: v.usuario_id,
      nombre: nombreCorto(v.nombre),
      distancia_km: distanciaVisible(v.km),
      descripcion: v.descripcion,
      horarios: v.horarios ? v.horarios.split(',') : [],
      mascotas: mascotasDePaseo(v.usuario_id),
    }))
    .filter((v) => v.mascotas.length);
  res.json(vecinos);
});

// ---------- Paseos ----------
function paseoVisible(req, res) {
  const paseo = db.prepare(`
    SELECT p.*, u.nombre AS organizador_nombre,
      (SELECT COUNT(*) FROM paseo_participantes pp WHERE pp.paseo_id = p.id AND pp.estado = 'va') AS asistentes,
      (SELECT estado FROM paseo_participantes pp WHERE pp.paseo_id = p.id AND pp.usuario_id = ?) AS mi_estado
    FROM paseos p JOIN usuarios u ON u.id = p.organizador_id
    WHERE p.id = ? AND p.oculto = 0 AND u.bloqueado = 0
  `).get(req.usuario.id, Number(req.params.id));
  if (!paseo || (paseo.privado && !paseo.mi_estado && paseo.organizador_id !== req.usuario.id)) {
    res.status(404).json({ error: 'Paseo no encontrado' });
    return null;
  }
  return { ...paseo, es_organizador: paseo.organizador_id === req.usuario.id, organizador_nombre: nombreCorto(paseo.organizador_nombre) };
}

paseosRouter.get('/', (req, res) => {
  const perfil = miPerfil(req.usuario.id);
  const latQ = Number(req.query.lat);
  const lngQ = Number(req.query.lng);
  const origen = perfil?.activo ? perfil : coordenadasValidas(latQ, lngQ) ? { lat: latQ, lng: lngQ } : null;
  const radio = radioPedido(req);

  const paseos = db.prepare(`
    SELECT p.id, p.titulo, p.fecha, p.hora, p.punto, p.lat, p.lng, p.cupo, p.privado, p.organizador_id, u.nombre AS organizador_nombre,
      (SELECT COUNT(*) FROM paseo_participantes pp WHERE pp.paseo_id = p.id AND pp.estado = 'va') AS asistentes,
      (SELECT estado FROM paseo_participantes pp WHERE pp.paseo_id = p.id AND pp.usuario_id = ?) AS mi_estado
    FROM paseos p JOIN usuarios u ON u.id = p.organizador_id
    WHERE p.cancelado = 0 AND p.oculto = 0 AND u.bloqueado = 0 AND p.fecha >= ?
    ORDER BY p.fecha, p.hora
  `).all(req.usuario.id, fechaLocal())
    .map((p) => ({
      ...p,
      organizador_nombre: nombreCorto(p.organizador_nombre),
      es_organizador: p.organizador_id === req.usuario.id,
      distancia_km: origen ? Math.round(distanciaKm(origen, p) * 10) / 10 : null,
    }))
    .filter((p) => p.es_organizador || p.mi_estado || (!p.privado && p.distancia_km != null && p.distancia_km <= radio));
  res.json({ paseos, tiene_origen: Boolean(origen) });
});

paseosRouter.post('/', limitador({ max: 10, minutos: 60, mensaje: 'Has creado muchos paseos seguidos. Espera un poco.' }), (req, res) => {
  const titulo = texto(req.body?.titulo, 120);
  const punto = texto(req.body?.punto, 150);
  const fecha = texto(req.body?.fecha, 10);
  const hora = texto(req.body?.hora, 5);
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const cupo = req.body?.cupo ? Number(req.body.cupo) : null;

  if (!titulo) return res.status(400).json({ error: 'Ponle un título al paseo' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') || fecha < fechaLocal()) return res.status(400).json({ error: 'Elige una fecha de hoy en adelante' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora || '')) return res.status(400).json({ error: 'Indica la hora de encuentro' });
  if (!punto) return res.status(400).json({ error: 'Indica el punto de encuentro' });
  if (!coordenadasValidas(lat, lng)) return res.status(400).json({ error: 'Marca el punto de encuentro en el mapa' });
  if (cupo !== null && (!Number.isInteger(cupo) || cupo < 2 || cupo > 50)) return res.status(400).json({ error: 'El cupo debe ser entre 2 y 50 personas' });

  // Solo se puede invitar a personas con perfil de paseo activo (aceptaron ser contactadas)
  const invitados = [...new Set((Array.isArray(req.body?.invitados) ? req.body.invitados : []).map(Number))]
    .filter((id) => id !== req.usuario.id && db.prepare(`
      SELECT 1 FROM perfiles_paseo p JOIN usuarios u ON u.id = p.usuario_id WHERE p.usuario_id = ? AND p.activo = 1 AND u.bloqueado = 0
    `).get(id));

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO paseos (organizador_id, titulo, descripcion, fecha, hora, punto, lat, lng, cupo, privado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.usuario.id, titulo, texto(req.body?.descripcion, 1000), fecha, hora, punto, lat, lng, cupo, req.body?.privado ? 1 : 0);
  const id = Number(lastInsertRowid);
  db.prepare("INSERT INTO paseo_participantes (paseo_id, usuario_id, estado) VALUES (?, ?, 'va')").run(id, req.usuario.id);
  const invitar = db.prepare("INSERT OR IGNORE INTO paseo_participantes (paseo_id, usuario_id, estado) VALUES (?, ?, 'invitado')");
  for (const invitado of invitados) invitar.run(id, invitado);

  if (invitados.length) {
    notificar(invitados, `🦮 ${nombreCorto(req.usuario.nombre)} te invita a pasear`, 'Te invitaron a un paseo',
      `<p><strong>${escHtml(nombreCorto(req.usuario.nombre))}</strong> te invita a <strong>${escHtml(titulo)}</strong>: ${escHtml(fechaBonita(fecha, hora))} en ${escHtml(punto)}.</p>`,
      `${urlPublica()}/paseo.html?id=${id}`, 'Ver invitación');
  }
  res.status(201).json({ id, invitados: invitados.length });
});

paseosRouter.get('/:id', (req, res) => {
  const paseo = paseoVisible(req, res);
  if (!paseo) return;
  const participantes = db.prepare(`
    SELECT pp.usuario_id, pp.estado, u.nombre FROM paseo_participantes pp JOIN usuarios u ON u.id = pp.usuario_id
    WHERE pp.paseo_id = ? AND u.bloqueado = 0 ORDER BY pp.usuario_id = ? DESC, pp.creado_en
  `).all(paseo.id, paseo.organizador_id).map((p) => ({
    usuario_id: p.usuario_id,
    estado: p.estado,
    nombre: nombreCorto(p.nombre),
    organizador: p.usuario_id === paseo.organizador_id,
    mascotas: mascotasDePaseo(p.usuario_id),
  }));
  const comentarios = db.prepare(`
    SELECT c.id, c.texto, c.creado_en, c.usuario_id, u.nombre FROM paseo_comentarios c JOIN usuarios u ON u.id = c.usuario_id
    WHERE c.paseo_id = ? AND c.oculto = 0 AND u.bloqueado = 0 ORDER BY c.creado_en, c.id
  `).all(paseo.id).map((c) => ({
    id: c.id, texto: c.texto, creado_en: c.creado_en, autor: nombreCorto(c.nombre),
    propio: c.usuario_id === req.usuario.id, de_organizador: c.usuario_id === paseo.organizador_id,
  }));
  const { organizador_id, ...publico } = paseo;
  res.json({ ...publico, participantes, comentarios });
});

paseosRouter.post('/:id/unirme', (req, res) => {
  const paseo = paseoVisible(req, res);
  if (!paseo) return;
  if (paseo.cancelado) return res.status(400).json({ error: 'Este paseo fue cancelado' });
  if (paseo.fecha < fechaLocal()) return res.status(400).json({ error: 'Este paseo ya pasó' });
  if (paseo.mi_estado === 'va') return res.status(204).end();
  if (paseo.cupo && paseo.asistentes >= paseo.cupo) return res.status(409).json({ error: 'El paseo ya está completo' });

  db.prepare(`
    INSERT INTO paseo_participantes (paseo_id, usuario_id, estado) VALUES (?, ?, 'va')
    ON CONFLICT (paseo_id, usuario_id) DO UPDATE SET estado = 'va'
  `).run(paseo.id, req.usuario.id);
  notificar([paseo.organizador_id], `🐾 ${nombreCorto(req.usuario.nombre)} se unió a tu paseo`, 'Alguien se unió a tu paseo',
    `<p><strong>${escHtml(nombreCorto(req.usuario.nombre))}</strong> irá a <strong>${escHtml(paseo.titulo)}</strong> (${escHtml(fechaBonita(paseo.fecha, paseo.hora))}).</p>`,
    `${urlPublica()}/paseo.html?id=${paseo.id}`, 'Ver paseo');
  res.status(204).end();
});

paseosRouter.delete('/:id/unirme', (req, res) => {
  const paseo = paseoVisible(req, res);
  if (!paseo) return;
  if (paseo.es_organizador) return res.status(400).json({ error: 'Eres quien organiza: si no puedes ir, cancela el paseo' });
  db.prepare('DELETE FROM paseo_participantes WHERE paseo_id = ? AND usuario_id = ?').run(paseo.id, req.usuario.id);
  res.status(204).end();
});

paseosRouter.post('/:id/invitar', (req, res) => {
  const paseo = paseoVisible(req, res);
  if (!paseo) return;
  if (!paseo.es_organizador) return res.status(403).json({ error: 'Solo quien organiza puede invitar' });
  const invitado = Number(req.body?.usuario_id);
  const valido = invitado !== req.usuario.id && db.prepare(`
    SELECT 1 FROM perfiles_paseo p JOIN usuarios u ON u.id = p.usuario_id WHERE p.usuario_id = ? AND p.activo = 1 AND u.bloqueado = 0
  `).get(invitado);
  if (!valido) return res.status(400).json({ error: 'Solo puedes invitar a vecinos con perfil de paseo activo' });
  const { changes } = db.prepare("INSERT OR IGNORE INTO paseo_participantes (paseo_id, usuario_id, estado) VALUES (?, ?, 'invitado')").run(paseo.id, invitado);
  if (changes) {
    notificar([invitado], `🦮 ${nombreCorto(req.usuario.nombre)} te invita a pasear`, 'Te invitaron a un paseo',
      `<p><strong>${escHtml(nombreCorto(req.usuario.nombre))}</strong> te invita a <strong>${escHtml(paseo.titulo)}</strong>: ${escHtml(fechaBonita(paseo.fecha, paseo.hora))} en ${escHtml(paseo.punto)}.</p>`,
      `${urlPublica()}/paseo.html?id=${paseo.id}`, 'Ver invitación');
  }
  res.status(204).end();
});

// Cancelar (solo quien organiza). Se avisa a los participantes.
paseosRouter.delete('/:id', (req, res) => {
  const paseo = paseoVisible(req, res);
  if (!paseo) return;
  if (!paseo.es_organizador) return res.status(403).json({ error: 'Solo quien organiza puede cancelar el paseo' });
  db.prepare('UPDATE paseos SET cancelado = 1 WHERE id = ?').run(paseo.id);
  const avisar = db.prepare('SELECT usuario_id FROM paseo_participantes WHERE paseo_id = ? AND usuario_id != ?').all(paseo.id, req.usuario.id).map((p) => p.usuario_id);
  if (avisar.length) {
    notificar(avisar, `❌ Se canceló el paseo “${paseo.titulo}”`, 'Paseo cancelado',
      `<p>El paseo <strong>${escHtml(paseo.titulo)}</strong> del ${escHtml(fechaBonita(paseo.fecha, paseo.hora))} fue cancelado por quien lo organizaba.</p>`,
      `${urlPublica()}/paseos.html`, 'Buscar otros paseos');
  }
  res.status(204).end();
});

// ---------- Conversación del paseo ----------
paseosRouter.post('/:id/comentarios', limitador({ max: 40, minutos: 60 }), (req, res) => {
  const paseo = paseoVisible(req, res);
  if (!paseo) return;
  const comentario = texto(req.body?.texto, 1000);
  if (!comentario) return res.status(400).json({ error: 'Escribe un mensaje' });
  db.prepare('INSERT INTO paseo_comentarios (paseo_id, usuario_id, texto) VALUES (?, ?, ?)').run(paseo.id, req.usuario.id, comentario);
  res.status(201).end();
});

paseosRouter.delete('/:id/comentarios/:comentarioId', (req, res) => {
  const paseo = paseoVisible(req, res);
  if (!paseo) return;
  const { changes } = db.prepare('DELETE FROM paseo_comentarios WHERE id = ? AND paseo_id = ? AND (usuario_id = ? OR ?)')
    .run(Number(req.params.comentarioId), paseo.id, req.usuario.id, paseo.es_organizador ? 1 : 0);
  if (!changes) return res.status(404).json({ error: 'Mensaje no encontrado' });
  res.status(204).end();
});
