import { Router } from 'express';
import { db } from '../db.js';
import { MOTIVOS, TIPOS, vistaPrevia, eliminarObjeto, mantenerObjeto } from '../moderacion.js';
import { requiereAdmin } from './auth.js';
import { leerAjustes, guardarAjuste, enlaceValido, enlaceRed, rutValido, BANCOS, TIPOS_CUENTA } from '../ajustes.js';

export const adminRouter = Router();
adminRouter.use(requiereAdmin);

const contar = (sql, ...params) => db.prepare(sql).get(...params).n;

// ---------- Resumen ----------
adminRouter.get('/resumen', (req, res) => {
  res.json({
    usuarios: contar('SELECT COUNT(*) AS n FROM usuarios'),
    usuarios_nuevos: contar("SELECT COUNT(*) AS n FROM usuarios WHERE creado_en >= datetime('now', '-7 days')"),
    bloqueados: contar('SELECT COUNT(*) AS n FROM usuarios WHERE bloqueado = 1'),
    mascotas: contar('SELECT COUNT(*) AS n FROM mascotas'),
    lugares: contar('SELECT COUNT(*) AS n FROM lugares'),
    lugares_nuevos: contar("SELECT COUNT(*) AS n FROM lugares WHERE creado_en >= datetime('now', '-7 days')"),
    resenas: contar('SELECT COUNT(*) AS n FROM resenas'),
    perdidas_activas: contar("SELECT COUNT(*) AS n FROM perdidas WHERE estado = 'perdida'"),
    reencuentros: contar("SELECT COUNT(*) AS n FROM perdidas WHERE estado = 'encontrada'"),
    paseos_proximos: contar("SELECT COUNT(*) AS n FROM paseos WHERE cancelado = 0 AND fecha >= date('now', 'localtime')"),
    perfiles_paseo: contar('SELECT COUNT(*) AS n FROM perfiles_paseo WHERE activo = 1'),
    adopciones_activas: contar("SELECT COUNT(*) AS n FROM adopciones WHERE estado != 'adoptado'"),
    adoptados: contar("SELECT COUNT(*) AS n FROM adopciones WHERE estado = 'adoptado'"),
    cuidadores: contar('SELECT COUNT(*) AS n FROM perfiles_cuidador WHERE activo = 1'),
    eventos_proximos: contar("SELECT COUNT(*) AS n FROM eventos WHERE cancelado = 0 AND fecha >= date('now', 'localtime')"),
    reportes_pendientes: contar("SELECT COUNT(DISTINCT tipo || ':' || objeto_id) AS n FROM reportes WHERE estado = 'pendiente'"),
    ocultos: ['lugares', 'resenas', 'perdidas', 'paseos', 'paseo_comentarios', 'adopciones', 'perfiles_cuidador', 'resenas_cuidador', 'eventos'].reduce((s, t) => s + contar(`SELECT COUNT(*) AS n FROM ${t} WHERE oculto = 1`), 0),
  });
});

// ---------- Ajustes (donaciones y redes sociales) ----------
adminRouter.get('/ajustes', (req, res) => res.json(leerAjustes()));

adminRouter.put('/ajustes', (req, res) => {
  const url = String(req.body?.donaciones_url || '').trim();
  if (url && !enlaceValido(url)) return res.status(400).json({ error: 'El enlace de donación debe empezar con https:// (cópialo completo desde tu página de donaciones)' });
  const tiktok = enlaceRed('tiktok', req.body?.tiktok_url);
  if (tiktok === null) return res.status(400).json({ error: 'El enlace de TikTok no es válido. Pega el enlace de tu perfil o solo tu usuario (ej: @masopet).' });
  const instagram = enlaceRed('instagram', req.body?.instagram_url);
  if (instagram === null) return res.status(400).json({ error: 'El enlace de Instagram no es válido. Pega el enlace de tu perfil o solo tu usuario (ej: @masopet).' });

  // Transferencia: si hay número de cuenta, se piden los demás datos para que la persona pueda transferir
  const t = Object.fromEntries(['banco', 'tipo', 'numero', 'titular', 'rut', 'correo'].map((c) => [c, String(req.body?.[`transferencia_${c}`] || '').trim()]));
  t.numero = t.numero.replace(/\s/g, '');
  if (t.numero) {
    if (!/^[\d-]{4,30}$/.test(t.numero)) return res.status(400).json({ error: 'El número de cuenta solo puede tener números (y guiones)' });
    if (!BANCOS.includes(t.banco)) return res.status(400).json({ error: 'Elige el banco' });
    if (!TIPOS_CUENTA.includes(t.tipo)) return res.status(400).json({ error: 'Elige el tipo de cuenta' });
    if (!t.titular) return res.status(400).json({ error: 'Escribe el nombre del titular de la cuenta' });
    t.rut = rutValido(t.rut);
    if (!t.rut) return res.status(400).json({ error: 'El RUT del titular no es válido (revisa el dígito verificador)' });
    if (t.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.correo)) return res.status(400).json({ error: 'El correo para el comprobante no es válido' });
  } else {
    for (const c of Object.keys(t)) t[c] = ''; // sin número de cuenta no se muestra nada
  }

  guardarAjuste('donaciones_url', url);
  for (const [c, valor] of Object.entries(t)) guardarAjuste(`transferencia_${c}`, valor);
  guardarAjuste('tiktok_url', tiktok);
  guardarAjuste('instagram_url', instagram);
  res.json(leerAjustes());
});

// ---------- Reportes (agrupados por contenido) ----------
adminRouter.get('/reportes', (req, res) => {
  const grupos = db.prepare(`
    SELECT tipo, objeto_id, COUNT(*) AS total, MAX(creado_en) AS ultimo
    FROM reportes WHERE estado = 'pendiente'
    GROUP BY tipo, objeto_id ORDER BY total DESC, ultimo DESC
  `).all();
  const detalle = db.prepare(`
    SELECT r.motivo, r.detalle, r.creado_en, u.nombre AS reportado_por
    FROM reportes r JOIN usuarios u ON u.id = r.usuario_id
    WHERE r.tipo = ? AND r.objeto_id = ? AND r.estado = 'pendiente' ORDER BY r.creado_en DESC
  `);
  const resultado = [];
  for (const g of grupos) {
    const objeto = vistaPrevia(g.tipo, g.objeto_id);
    if (!objeto) { // el contenido ya fue borrado por su autor
      db.prepare("UPDATE reportes SET estado = 'resuelto', resuelto_en = datetime('now') WHERE tipo = ? AND objeto_id = ?").run(g.tipo, g.objeto_id);
      continue;
    }
    resultado.push({
      ...g,
      tipo_nombre: TIPOS[g.tipo].nombre,
      objeto,
      reportes: detalle.all(g.tipo, g.objeto_id).map((r) => ({ ...r, motivo_texto: MOTIVOS[r.motivo] })),
    });
  }
  res.json(resultado);
});

adminRouter.post('/reportes/:tipo/:id', (req, res) => {
  const { tipo } = req.params;
  const id = Number(req.params.id);
  if (!TIPOS[tipo] || !vistaPrevia(tipo, id)) return res.status(404).json({ error: 'Contenido no encontrado' });
  if (req.body?.accion === 'eliminar') eliminarObjeto(tipo, id);
  else if (req.body?.accion === 'mantener') mantenerObjeto(tipo, id);
  else return res.status(400).json({ error: 'Acción no válida' });
  res.status(204).end();
});

// ---------- Usuarios ----------
adminRouter.get('/usuarios', (req, res) => {
  const q = `%${String(req.query.q || '').slice(0, 100)}%`;
  res.json(db.prepare(`
    SELECT u.id, u.nombre, u.email, u.rol, u.bloqueado, u.verificado, u.creado_en,
      (SELECT COUNT(*) FROM mascotas WHERE usuario_id = u.id) AS mascotas,
      (SELECT COUNT(*) FROM lugares WHERE creado_por = u.id) AS lugares,
      (SELECT COUNT(*) FROM resenas WHERE usuario_id = u.id) AS resenas,
      (SELECT COUNT(*) FROM reportes r WHERE r.estado = 'pendiente' AND (
         (r.tipo = 'lugar' AND r.objeto_id IN (SELECT id FROM lugares WHERE creado_por = u.id)) OR
         (r.tipo = 'resena' AND r.objeto_id IN (SELECT id FROM resenas WHERE usuario_id = u.id)) OR
         (r.tipo = 'perdida' AND r.objeto_id IN (SELECT id FROM perdidas WHERE usuario_id = u.id)) OR
         (r.tipo = 'paseo' AND r.objeto_id IN (SELECT id FROM paseos WHERE organizador_id = u.id)) OR
         (r.tipo = 'comentario' AND r.objeto_id IN (SELECT id FROM paseo_comentarios WHERE usuario_id = u.id)) OR
         (r.tipo = 'adopcion' AND r.objeto_id IN (SELECT id FROM adopciones WHERE usuario_id = u.id)) OR
         (r.tipo = 'cuidador' AND r.objeto_id = u.id) OR
         (r.tipo = 'resena_cuidador' AND r.objeto_id IN (SELECT id FROM resenas_cuidador WHERE usuario_id = u.id)) OR
         (r.tipo = 'evento' AND r.objeto_id IN (SELECT id FROM eventos WHERE usuario_id = u.id))
      )) AS reportes_recibidos
    FROM usuarios u
    WHERE u.nombre LIKE ? OR u.email LIKE ?
    ORDER BY reportes_recibidos DESC, u.creado_en DESC
    LIMIT 200
  `).all(q, q));
});

function otroUsuario(req, res) {
  const usuario = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(Number(req.params.id));
  if (!usuario) res.status(404).json({ error: 'Usuario no encontrado' });
  else if (usuario.id === req.usuario.id) res.status(400).json({ error: 'No puedes modificar tu propia cuenta desde aquí' });
  else return usuario;
  return null;
}

adminRouter.put('/usuarios/:id', (req, res) => {
  const usuario = otroUsuario(req, res);
  if (!usuario) return;
  if (req.body?.bloqueado !== undefined) {
    db.prepare('UPDATE usuarios SET bloqueado = ? WHERE id = ?').run(req.body.bloqueado ? 1 : 0, usuario.id);
    if (req.body.bloqueado) db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(usuario.id);
  }
  // Por si a alguien no le llega el correo con el código
  if (req.body?.verificado) {
    db.prepare('UPDATE usuarios SET verificado = 1 WHERE id = ?').run(usuario.id);
    db.prepare('DELETE FROM verificaciones WHERE usuario_id = ?').run(usuario.id);
  }
  if (req.body?.rol !== undefined) {
    if (!['usuario', 'admin'].includes(req.body.rol)) return res.status(400).json({ error: 'Rol no válido' });
    db.prepare('UPDATE usuarios SET rol = ? WHERE id = ?').run(req.body.rol, usuario.id);
  }
  res.status(204).end();
});

// Borra todo lo público de un usuario (útil contra spam): lugares, reseñas y avisos
adminRouter.delete('/usuarios/:id/contenido', (req, res) => {
  const usuario = otroUsuario(req, res);
  if (!usuario) return;
  const borrados = {
    lugares: db.prepare('SELECT id FROM lugares WHERE creado_por = ?').all(usuario.id),
    resenas: db.prepare('SELECT id FROM resenas WHERE usuario_id = ?').all(usuario.id),
    perdidas: db.prepare('SELECT id FROM perdidas WHERE usuario_id = ?').all(usuario.id),
    paseos: db.prepare('SELECT id FROM paseos WHERE organizador_id = ?').all(usuario.id),
    comentarios: db.prepare('SELECT id FROM paseo_comentarios WHERE usuario_id = ?').all(usuario.id),
    adopciones: db.prepare('SELECT id FROM adopciones WHERE usuario_id = ?').all(usuario.id),
    resenas_cuidador: db.prepare('SELECT id FROM resenas_cuidador WHERE usuario_id = ?').all(usuario.id),
    eventos: db.prepare('SELECT id FROM eventos WHERE usuario_id = ?').all(usuario.id),
  };
  for (const { id } of borrados.lugares) eliminarObjeto('lugar', id);
  for (const { id } of borrados.resenas) eliminarObjeto('resena', id);
  for (const { id } of borrados.perdidas) eliminarObjeto('perdida', id);
  for (const { id } of borrados.paseos) eliminarObjeto('paseo', id);
  for (const { id } of borrados.comentarios) eliminarObjeto('comentario', id);
  for (const { id } of borrados.adopciones) eliminarObjeto('adopcion', id);
  for (const { id } of borrados.resenas_cuidador) eliminarObjeto('resena_cuidador', id);
  for (const { id } of borrados.eventos) eliminarObjeto('evento', id);
  if (db.prepare('SELECT 1 FROM perfiles_cuidador WHERE usuario_id = ?').get(usuario.id)) eliminarObjeto('cuidador', usuario.id);
  db.prepare('DELETE FROM perfiles_paseo WHERE usuario_id = ?').run(usuario.id);
  res.json(Object.fromEntries(Object.entries(borrados).map(([k, v]) => [k, v.length])));
});

// ---------- Contenido ----------
const CONSULTAS_CONTENIDO = {
  lugar: `SELECT l.id, l.nombre AS titulo, l.direccion AS texto, l.categoria AS extra, l.oculto, l.creado_en, u.nombre AS autor
          FROM lugares l LEFT JOIN usuarios u ON u.id = l.creado_por
          WHERE l.nombre LIKE ? OR l.direccion LIKE ? ORDER BY l.creado_en DESC LIMIT 200`,
  resena: `SELECT r.id, l.nombre AS titulo, r.comentario AS texto, r.estrellas || ' ★' AS extra, r.oculto, r.creado_en, u.nombre AS autor
          FROM resenas r JOIN lugares l ON l.id = r.lugar_id JOIN usuarios u ON u.id = r.usuario_id
          WHERE l.nombre LIKE ? OR IFNULL(r.comentario, '') LIKE ? ORDER BY r.creado_en DESC LIMIT 200`,
  perdida: `SELECT p.id, m.nombre AS titulo, p.descripcion AS texto, p.estado AS extra, p.oculto, p.creado_en, u.nombre AS autor
          FROM perdidas p JOIN mascotas m ON m.id = p.mascota_id JOIN usuarios u ON u.id = p.usuario_id
          WHERE m.nombre LIKE ? OR IFNULL(p.descripcion, '') LIKE ? ORDER BY p.creado_en DESC LIMIT 200`,
  paseo: `SELECT p.id, p.titulo, p.descripcion AS texto, p.fecha || ' ' || p.hora || CASE WHEN p.cancelado THEN ' (cancelado)' ELSE '' END AS extra,
            p.oculto, p.creado_en, u.nombre AS autor
          FROM paseos p JOIN usuarios u ON u.id = p.organizador_id
          WHERE p.titulo LIKE ? OR IFNULL(p.descripcion, '') LIKE ? ORDER BY p.creado_en DESC LIMIT 200`,
  comentario: `SELECT c.id, p.titulo, c.texto, NULL AS extra, c.oculto, c.creado_en, u.nombre AS autor
          FROM paseo_comentarios c JOIN paseos p ON p.id = c.paseo_id JOIN usuarios u ON u.id = c.usuario_id
          WHERE p.titulo LIKE ? OR c.texto LIKE ? ORDER BY c.creado_en DESC LIMIT 200`,
  adopcion: `SELECT a.id, a.nombre AS titulo, a.descripcion AS texto, a.estado AS extra, a.oculto, a.creado_en, u.nombre AS autor
          FROM adopciones a JOIN usuarios u ON u.id = a.usuario_id
          WHERE a.nombre LIKE ? OR IFNULL(a.descripcion, '') LIKE ? ORDER BY a.creado_en DESC LIMIT 200`,
  cuidador: `SELECT c.usuario_id AS id, u.nombre AS titulo, c.descripcion AS texto, c.servicios AS extra, c.oculto, c.actualizado_en AS creado_en, u.nombre AS autor
          FROM perfiles_cuidador c JOIN usuarios u ON u.id = c.usuario_id
          WHERE u.nombre LIKE ? OR IFNULL(c.descripcion, '') LIKE ? ORDER BY c.actualizado_en DESC LIMIT 200`,
  resena_cuidador: `SELECT r.id, c.nombre AS titulo, r.comentario AS texto, r.estrellas || ' ★' AS extra, r.oculto, r.creado_en, u.nombre AS autor
          FROM resenas_cuidador r JOIN usuarios c ON c.id = r.cuidador_id JOIN usuarios u ON u.id = r.usuario_id
          WHERE c.nombre LIKE ? OR IFNULL(r.comentario, '') LIKE ? ORDER BY r.creado_en DESC LIMIT 200`,
  evento: `SELECT e.id, e.titulo, e.descripcion AS texto, e.fecha || ' · ' || e.lugar || CASE WHEN e.cancelado THEN ' (cancelado)' ELSE '' END AS extra,
            e.oculto, e.creado_en, u.nombre AS autor
          FROM eventos e JOIN usuarios u ON u.id = e.usuario_id
          WHERE e.titulo LIKE ? OR IFNULL(e.descripcion, '') LIKE ? ORDER BY e.creado_en DESC LIMIT 200`,
};

adminRouter.get('/contenido/:tipo', (req, res) => {
  const consulta = CONSULTAS_CONTENIDO[req.params.tipo];
  if (!consulta) return res.status(404).json({ error: 'Tipo no válido' });
  const q = `%${String(req.query.q || '').slice(0, 100)}%`;
  res.json(db.prepare(consulta).all(q, q));
});

adminRouter.delete('/contenido/:tipo/:id', (req, res) => {
  const { tipo } = req.params;
  const id = Number(req.params.id);
  if (!TIPOS[tipo] || !vistaPrevia(tipo, id)) return res.status(404).json({ error: 'Contenido no encontrado' });
  eliminarObjeto(tipo, id);
  res.status(204).end();
});
