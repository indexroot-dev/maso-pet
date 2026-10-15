import { Router } from 'express';
import { db } from '../db.js';
import { requiereLogin } from './auth.js';

export const CATEGORIAS = ['restaurante', 'cafe', 'hotel', 'parque', 'playa', 'tienda', 'veterinaria', 'otro'];
const ADMITIDAS = ['todas', 'perros', 'gatos'];

const texto = (valor, max = 500) => {
  const limpio = String(valor ?? '').trim().slice(0, max);
  return limpio || null;
};

// Lugar con su promedio de estrellas y si es favorito del usuario
const SELECT_LUGAR = `
  SELECT l.*,
    (SELECT ROUND(AVG(estrellas), 1) FROM resenas r WHERE r.lugar_id = l.id AND r.oculto = 0) AS promedio,
    (SELECT COUNT(*) FROM resenas r WHERE r.lugar_id = l.id AND r.oculto = 0) AS total_resenas,
    EXISTS (SELECT 1 FROM favoritos f WHERE f.lugar_id = l.id AND f.usuario_id = ?) AS es_favorito
  FROM lugares l`;

export const lugaresRouter = Router();
lugaresRouter.use(requiereLogin);

function lugarExiste(req, res) {
  const lugar = db.prepare('SELECT id FROM lugares WHERE id = ? AND oculto = 0').get(Number(req.params.id));
  if (!lugar) res.status(404).json({ error: 'Lugar no encontrado' });
  return lugar;
}

lugaresRouter.get('/', (req, res) => {
  const filtros = ['l.oculto = 0'];
  const params = [req.usuario.id];
  if (CATEGORIAS.includes(req.query.categoria)) {
    filtros.push('l.categoria = ?');
    params.push(req.query.categoria);
  }
  if (req.query.q) {
    filtros.push('(l.nombre LIKE ? OR l.direccion LIKE ? OR l.descripcion LIKE ?)');
    const patron = `%${String(req.query.q).slice(0, 100)}%`;
    params.push(patron, patron, patron);
  }
  if (req.query.favoritos === '1') {
    filtros.push('EXISTS (SELECT 1 FROM favoritos f WHERE f.lugar_id = l.id AND f.usuario_id = ?)');
    params.push(req.usuario.id);
  }
  const where = `WHERE ${filtros.join(' AND ')}`;
  res.json(db.prepare(`${SELECT_LUGAR} ${where} ORDER BY l.nombre`).all(...params));
});

lugaresRouter.post('/', (req, res) => {
  const nombre = texto(req.body?.nombre, 120);
  const categoria = req.body?.categoria;
  const admitidas = ADMITIDAS.includes(req.body?.mascotas_admitidas) ? req.body.mascotas_admitidas : 'todas';
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);

  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!CATEGORIAS.includes(categoria)) return res.status(400).json({ error: 'Categoría no válida' });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'Selecciona la ubicación en el mapa' });
  }

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO lugares (nombre, categoria, direccion, descripcion, mascotas_admitidas, lat, lng, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nombre, categoria, texto(req.body.direccion, 200), texto(req.body.descripcion, 1000), admitidas, lat, lng, req.usuario.id);

  res.status(201).json(db.prepare(`${SELECT_LUGAR} WHERE l.id = ?`).get(req.usuario.id, lastInsertRowid));
});

lugaresRouter.delete('/:id', (req, res) => {
  const { changes } = db.prepare('DELETE FROM lugares WHERE id = ? AND creado_por = ?')
    .run(Number(req.params.id), req.usuario.id);
  if (!changes) return res.status(404).json({ error: 'Lugar no encontrado o no te pertenece' });
  res.status(204).end();
});

// ---------- Reseñas ----------
lugaresRouter.get('/:id/resenas', (req, res) => {
  if (!lugarExiste(req, res)) return;
  res.json(db.prepare(`
    SELECT r.id, r.estrellas, r.comentario, r.creado_en, u.nombre AS autor, (r.usuario_id = ?) AS propia
    FROM resenas r JOIN usuarios u ON u.id = r.usuario_id
    WHERE r.lugar_id = ? AND r.oculto = 0 ORDER BY r.creado_en DESC
  `).all(req.usuario.id, Number(req.params.id)));
});

// Cada usuario tiene una reseña por lugar: si ya existe, se actualiza
lugaresRouter.put('/:id/resenas', (req, res) => {
  if (!lugarExiste(req, res)) return;
  const estrellas = Number(req.body?.estrellas);
  if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) {
    return res.status(400).json({ error: 'Elige de 1 a 5 estrellas' });
  }
  db.prepare(`
    INSERT INTO resenas (lugar_id, usuario_id, estrellas, comentario) VALUES (?, ?, ?, ?)
    ON CONFLICT (lugar_id, usuario_id) DO UPDATE SET
      estrellas = excluded.estrellas, comentario = excluded.comentario, creado_en = datetime('now')
  `).run(Number(req.params.id), req.usuario.id, estrellas, texto(req.body?.comentario, 1000));
  res.json(db.prepare(`${SELECT_LUGAR} WHERE l.id = ?`).get(req.usuario.id, Number(req.params.id)));
});

lugaresRouter.delete('/:id/resenas', (req, res) => {
  db.prepare('DELETE FROM resenas WHERE lugar_id = ? AND usuario_id = ?').run(Number(req.params.id), req.usuario.id);
  res.status(204).end();
});

// ---------- Favoritos ----------
lugaresRouter.put('/:id/favorito', (req, res) => {
  if (!lugarExiste(req, res)) return;
  db.prepare('INSERT OR IGNORE INTO favoritos (usuario_id, lugar_id) VALUES (?, ?)').run(req.usuario.id, Number(req.params.id));
  res.status(204).end();
});

lugaresRouter.delete('/:id/favorito', (req, res) => {
  db.prepare('DELETE FROM favoritos WHERE usuario_id = ? AND lugar_id = ?').run(req.usuario.id, Number(req.params.id));
  res.status(204).end();
});
