import { Router } from 'express';
import { db } from '../db.js';
import { requiereLogin } from './auth.js';
import { guardarFoto, borrarFoto } from '../fotos.js';
import { notificar } from '../notificaciones.js';
import { nombreCorto } from '../config.js';

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
  const lugar = db.prepare('SELECT id, nombre, creado_por FROM lugares WHERE id = ? AND oculto = 0').get(Number(req.params.id));
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

// Valida los datos del formulario de lugar. Devuelve { error } o { datos }
function datosLugar(body) {
  const datos = {
    nombre: texto(body?.nombre, 120),
    categoria: body?.categoria,
    mascotas_admitidas: ADMITIDAS.includes(body?.mascotas_admitidas) ? body.mascotas_admitidas : 'todas',
    direccion: texto(body?.direccion, 200),
    descripcion: texto(body?.descripcion, 1000),
    horario: texto(body?.horario, 200),
    lat: Number(body?.lat),
    lng: Number(body?.lng),
  };
  if (!datos.nombre) return { error: 'El nombre es obligatorio' };
  if (!CATEGORIAS.includes(datos.categoria)) return { error: 'Categoría no válida' };
  if (!Number.isFinite(datos.lat) || !Number.isFinite(datos.lng) || Math.abs(datos.lat) > 90 || Math.abs(datos.lng) > 180) {
    return { error: 'Selecciona la ubicación en el mapa' };
  }
  return { datos };
}
const COLUMNAS_LUGAR = ['nombre', 'categoria', 'mascotas_admitidas', 'direccion', 'descripcion', 'horario', 'lat', 'lng'];
const FOTO_INVALIDA = 'La foto no es válida (usa JPG, PNG o WebP de menos de 3 MB)';

lugaresRouter.post('/', (req, res) => {
  const { error, datos } = datosLugar(req.body);
  if (error) return res.status(400).json({ error });
  let foto = null;
  if (req.body?.imagen) {
    foto = guardarFoto(req.body.imagen);
    if (!foto) return res.status(400).json({ error: FOTO_INVALIDA });
  }

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO lugares (${COLUMNAS_LUGAR.join(', ')}, foto, creado_por) VALUES (${COLUMNAS_LUGAR.map(() => '?').join(', ')}, ?, ?)
  `).run(...COLUMNAS_LUGAR.map((c) => datos[c]), foto, req.usuario.id);

  res.status(201).json(db.prepare(`${SELECT_LUGAR} WHERE l.id = ?`).get(req.usuario.id, lastInsertRowid));
});

// Solo quien lo agregó puede editarlo. imagen: foto nueva; quitar_foto: true para borrarla
lugaresRouter.put('/:id', (req, res) => {
  const lugar = db.prepare('SELECT id, foto FROM lugares WHERE id = ? AND creado_por = ?').get(Number(req.params.id), req.usuario.id);
  if (!lugar) return res.status(404).json({ error: 'Lugar no encontrado o no te pertenece' });
  const { error, datos } = datosLugar(req.body);
  if (error) return res.status(400).json({ error });

  let foto = lugar.foto;
  if (req.body?.imagen) {
    foto = guardarFoto(req.body.imagen);
    if (!foto) return res.status(400).json({ error: FOTO_INVALIDA });
  } else if (req.body?.quitar_foto) {
    foto = null;
  }
  db.prepare(`UPDATE lugares SET ${COLUMNAS_LUGAR.map((c) => `${c} = ?`).join(', ')}, foto = ? WHERE id = ?`)
    .run(...COLUMNAS_LUGAR.map((c) => datos[c]), foto, lugar.id);
  if (foto !== lugar.foto) borrarFoto(lugar.foto);
  res.json(db.prepare(`${SELECT_LUGAR} WHERE l.id = ?`).get(req.usuario.id, lugar.id));
});

lugaresRouter.delete('/:id', (req, res) => {
  const lugar = db.prepare('SELECT id, foto FROM lugares WHERE id = ? AND creado_por = ?').get(Number(req.params.id), req.usuario.id);
  if (!lugar) return res.status(404).json({ error: 'Lugar no encontrado o no te pertenece' });
  db.prepare('DELETE FROM lugares WHERE id = ?').run(lugar.id);
  borrarFoto(lugar.foto);
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
  const lugar = lugarExiste(req, res);
  if (!lugar) return;
  const estrellas = Number(req.body?.estrellas);
  if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) {
    return res.status(400).json({ error: 'Elige de 1 a 5 estrellas' });
  }
  db.prepare(`
    INSERT INTO resenas (lugar_id, usuario_id, estrellas, comentario) VALUES (?, ?, ?, ?)
    ON CONFLICT (lugar_id, usuario_id) DO UPDATE SET
      estrellas = excluded.estrellas, comentario = excluded.comentario, creado_en = datetime('now')
  `).run(Number(req.params.id), req.usuario.id, estrellas, texto(req.body?.comentario, 1000));
  if (lugar.creado_por && lugar.creado_por !== req.usuario.id) {
    notificar([lugar.creado_por], `⭐ ${nombreCorto(req.usuario.nombre)} dejó una reseña de ${estrellas} ${estrellas === 1 ? 'estrella' : 'estrellas'} en “${lugar.nombre}”`, `mapa.html?lugar=${lugar.id}`);
  }
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
