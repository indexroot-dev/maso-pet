import { Router } from 'express';
import { db } from '../db.js';
import { texto, coordenadasValidas, fechaValida, horaValida, fechaLocal, nombreCorto, origenDe, distanciaKm, limitador } from '../config.js';
import { requiereLogin } from './auth.js';

const TIPOS = ['feria', 'vacunacion', 'encuentro', 'adopcion', 'taller', 'otro'];

function leerEvento(body) {
  const enlace = texto(body?.enlace, 300);
  return {
    titulo: texto(body?.titulo, 120),
    tipo: TIPOS.includes(body?.tipo) ? body.tipo : null,
    descripcion: texto(body?.descripcion, 2000),
    fecha: texto(body?.fecha, 10),
    hora_inicio: texto(body?.hora_inicio, 5),
    hora_fin: horaValida(body?.hora_fin) ? body.hora_fin : null,
    lugar: texto(body?.lugar, 150),
    direccion: texto(body?.direccion, 200),
    lat: Number(body?.lat),
    lng: Number(body?.lng),
    gratuito: body?.gratuito ? 1 : 0,
    precio: body?.gratuito ? null : texto(body?.precio, 80),
    organizador: texto(body?.organizador, 120),
    // Solo enlaces web (evita javascript: u otros esquemas)
    enlace: enlace && /^https?:\/\/[^\s]+$/i.test(enlace) ? enlace : null,
  };
}

function validarEvento(e) {
  if (!e.titulo) return 'Ponle un título al evento';
  if (!e.tipo) return 'Elige el tipo de evento';
  if (!fechaValida(e.fecha) || e.fecha < fechaLocal()) return 'Elige una fecha de hoy en adelante';
  if (!horaValida(e.hora_inicio)) return 'Indica la hora de inicio';
  if (e.hora_fin && e.hora_fin <= e.hora_inicio) return 'La hora de término debe ser después del inicio';
  if (!e.lugar) return 'Indica el lugar';
  if (!coordenadasValidas(e.lat, e.lng)) return 'Marca el lugar en el mapa';
  return null;
}

export const eventosRouter = Router();
eventosRouter.use(requiereLogin);

eventosRouter.get('/', (req, res) => {
  const origen = origenDe(req, db);
  const params = [req.usuario.id, req.usuario.id, fechaLocal()];
  let filtroTipo = '';
  if (TIPOS.includes(req.query.tipo)) { filtroTipo = 'AND e.tipo = ?'; params.push(req.query.tipo); }
  const eventos = db.prepare(`
    SELECT e.*, u.nombre AS autor,
      (SELECT COUNT(*) FROM eventos_asistentes a WHERE a.evento_id = e.id) AS asistentes,
      EXISTS (SELECT 1 FROM eventos_asistentes a WHERE a.evento_id = e.id AND a.usuario_id = ?) AS asistire,
      (e.usuario_id = ?) AS propio
    FROM eventos e JOIN usuarios u ON u.id = e.usuario_id
    WHERE e.oculto = 0 AND u.bloqueado = 0 AND e.fecha >= ? ${filtroTipo}
    ORDER BY e.fecha, e.hora_inicio LIMIT 300
  `).all(...params).map(({ usuario_id, autor, ...e }) => ({
    ...e,
    publicado_por: nombreCorto(autor),
    distancia_km: origen ? Math.round(distanciaKm(origen, e) * 10) / 10 : null,
  }));
  res.json(eventos);
});

eventosRouter.post('/', limitador({ max: 10, minutos: 60, mensaje: 'Has publicado muchos eventos seguidos. Espera un poco.' }), (req, res) => {
  const e = leerEvento(req.body);
  const error = validarEvento(e);
  if (error) return res.status(400).json({ error });
  const columnas = Object.keys(e);
  const { lastInsertRowid } = db.prepare(`INSERT INTO eventos (usuario_id, ${columnas.join(', ')}) VALUES (?, ${columnas.map(() => '?').join(', ')})`)
    .run(req.usuario.id, ...columnas.map((c) => e[c]));
  res.status(201).json({ id: Number(lastInsertRowid) });
});

function eventoPropio(req, res) {
  const e = db.prepare('SELECT * FROM eventos WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!e) res.status(404).json({ error: 'Evento no encontrado' });
  return e;
}

eventosRouter.put('/:id', (req, res) => {
  const anterior = eventoPropio(req, res);
  if (!anterior) return;
  if (req.body?.cancelado !== undefined && Object.keys(req.body).length === 1) {
    db.prepare('UPDATE eventos SET cancelado = ? WHERE id = ?').run(req.body.cancelado ? 1 : 0, anterior.id);
    return res.status(204).end();
  }
  const e = leerEvento(req.body);
  const error = validarEvento(e);
  if (error) return res.status(400).json({ error });
  db.prepare(`UPDATE eventos SET ${Object.keys(e).map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(e), anterior.id);
  res.status(204).end();
});

eventosRouter.delete('/:id', (req, res) => {
  const e = eventoPropio(req, res);
  if (!e) return;
  db.prepare('DELETE FROM eventos WHERE id = ?').run(e.id);
  res.status(204).end();
});

eventosRouter.put('/:id/asistire', (req, res) => {
  const e = db.prepare('SELECT id, cancelado FROM eventos WHERE id = ? AND oculto = 0').get(Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'Evento no encontrado' });
  if (e.cancelado) return res.status(400).json({ error: 'Este evento fue cancelado' });
  db.prepare('INSERT OR IGNORE INTO eventos_asistentes (evento_id, usuario_id) VALUES (?, ?)').run(e.id, req.usuario.id);
  res.status(204).end();
});

eventosRouter.delete('/:id/asistire', (req, res) => {
  db.prepare('DELETE FROM eventos_asistentes WHERE evento_id = ? AND usuario_id = ?').run(Number(req.params.id), req.usuario.id);
  res.status(204).end();
});
