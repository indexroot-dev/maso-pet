import { Router } from 'express';
import { db } from '../db.js';
import { texto, coordenadasValidas, aproximar, elegidos, separar, nombreCorto, origenDe, distanciaKm, limitador, urlPublica } from '../config.js';
import { enviarCorreo, plantilla, boton, escHtml } from '../correo.js';
import { guardarFoto, borrarFoto } from '../fotos.js';
import { requiereLogin } from './auth.js';

const SERVICIOS = ['paseo', 'cuidado', 'visita', 'guarderia'];
const ESPECIES = ['perro', 'gato', 'otro'];
const TAMANOS = ['pequeno', 'mediano', 'grande'];
const HORARIOS = ['manana', 'tarde', 'noche', 'fines'];
const COBERTURAS = [1, 3, 5, 10, 20];

const formatear = (c) => ({
  usuario_id: c.usuario_id,
  nombre: nombreCorto(c.nombre),
  foto: c.foto,
  servicios: separar(c.servicios),
  especies: separar(c.especies),
  tamanos: separar(c.tamanos),
  horarios: separar(c.horarios),
  tarifa: c.tarifa,
  descripcion: c.descripcion,
  cobertura_km: c.cobertura_km,
  promedio: c.promedio,
  total_resenas: c.total_resenas,
});

const SELECT_CUIDADOR = `
  SELECT c.*, u.nombre,
    (SELECT ROUND(AVG(estrellas), 1) FROM resenas_cuidador r WHERE r.cuidador_id = c.usuario_id AND r.oculto = 0) AS promedio,
    (SELECT COUNT(*) FROM resenas_cuidador r WHERE r.cuidador_id = c.usuario_id AND r.oculto = 0) AS total_resenas
  FROM perfiles_cuidador c JOIN usuarios u ON u.id = c.usuario_id`;

export const cuidadoresRouter = Router();
cuidadoresRouter.use(requiereLogin);

// ---------- Mi perfil de cuidador ----------
cuidadoresRouter.get('/perfil', (req, res) => {
  const p = db.prepare('SELECT * FROM perfiles_cuidador WHERE usuario_id = ?').get(req.usuario.id);
  res.json(p ? { ...p, servicios: separar(p.servicios), especies: separar(p.especies), tamanos: separar(p.tamanos), horarios: separar(p.horarios) } : null);
});

cuidadoresRouter.put('/perfil', (req, res) => {
  const anterior = db.prepare('SELECT * FROM perfiles_cuidador WHERE usuario_id = ?').get(req.usuario.id);
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const servicios = elegidos(req.body?.servicios, SERVICIOS);
  const contacto = texto(req.body?.contacto, 120);
  if (!servicios) return res.status(400).json({ error: 'Elige al menos un servicio que ofreces' });
  if (!contacto) return res.status(400).json({ error: 'Indica un teléfono o forma de contacto' });
  if (!coordenadasValidas(lat, lng) && !anterior) return res.status(400).json({ error: 'Marca en el mapa la zona donde trabajas' });

  let foto = anterior?.foto ?? null;
  if (req.body?.imagen) {
    foto = guardarFoto(req.body.imagen);
    if (!foto) return res.status(400).json({ error: 'La foto no es válida (usa JPG, PNG o WebP de menos de 3 MB)' });
    borrarFoto(anterior?.foto);
  }
  db.prepare(`
    INSERT INTO perfiles_cuidador (usuario_id, activo, foto, servicios, especies, tamanos, horarios, tarifa, descripcion, contacto, lat, lng, cobertura_km)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (usuario_id) DO UPDATE SET activo = excluded.activo, foto = excluded.foto, servicios = excluded.servicios,
      especies = excluded.especies, tamanos = excluded.tamanos, horarios = excluded.horarios, tarifa = excluded.tarifa,
      descripcion = excluded.descripcion, contacto = excluded.contacto, lat = excluded.lat, lng = excluded.lng,
      cobertura_km = excluded.cobertura_km, actualizado_en = datetime('now')
  `).run(
    req.usuario.id, req.body?.activo ? 1 : 0, foto, servicios,
    elegidos(req.body?.especies, ESPECIES), elegidos(req.body?.tamanos, TAMANOS), elegidos(req.body?.horarios, HORARIOS),
    texto(req.body?.tarifa, 120), texto(req.body?.descripcion, 2000), contacto,
    coordenadasValidas(lat, lng) ? aproximar(lat) : anterior.lat,
    coordenadasValidas(lat, lng) ? aproximar(lng) : anterior.lng,
    COBERTURAS.includes(Number(req.body?.cobertura_km)) ? Number(req.body.cobertura_km) : 5,
  );
  res.json({ activo: req.body?.activo ? 1 : 0 });
});

// ---------- Buscar ----------
cuidadoresRouter.get('/', (req, res) => {
  const origen = origenDe(req, db);
  const radio = COBERTURAS.includes(Number(req.query.radio)) ? Number(req.query.radio) : 10;
  let lista = db.prepare(`${SELECT_CUIDADOR} WHERE c.activo = 1 AND c.oculto = 0 AND u.bloqueado = 0`).all()
    .filter((c) => !SERVICIOS.includes(req.query.servicio) || separar(c.servicios).includes(req.query.servicio))
    .filter((c) => !ESPECIES.includes(req.query.especie) || separar(c.especies).includes(req.query.especie))
    .map((c) => ({ ...formatear(c), km: origen ? distanciaKm(origen, c) : null, propio: c.usuario_id === req.usuario.id }));
  if (origen) lista = lista.filter((c) => c.km <= radio);
  lista.sort((a, b) => (req.query.orden === 'valoracion' || !origen
    ? (b.promedio || 0) - (a.promedio || 0) || b.total_resenas - a.total_resenas
    : a.km - b.km));
  res.json({
    cuidadores: lista.map(({ km, ...c }) => ({ ...c, distancia_km: km == null ? null : Math.max(0.5, Math.round(km * 2) / 2) })),
    tiene_origen: Boolean(origen),
  });
});

function cuidador(req, res) {
  const c = db.prepare(`${SELECT_CUIDADOR} WHERE c.usuario_id = ? AND c.oculto = 0 AND u.bloqueado = 0 AND (c.activo = 1 OR c.usuario_id = ?)`)
    .get(Number(req.params.id), req.usuario.id);
  if (!c) res.status(404).json({ error: 'Perfil no encontrado' });
  return c;
}

cuidadoresRouter.get('/:id', (req, res) => {
  const c = cuidador(req, res);
  if (!c) return;
  const resenas = db.prepare(`
    SELECT r.id, r.estrellas, r.comentario, r.creado_en, u.nombre, (r.usuario_id = ?) AS propia
    FROM resenas_cuidador r JOIN usuarios u ON u.id = r.usuario_id
    WHERE r.cuidador_id = ? AND r.oculto = 0 AND u.bloqueado = 0 ORDER BY r.creado_en DESC
  `).all(req.usuario.id, c.usuario_id).map(({ nombre, ...r }) => ({ ...r, autor: nombreCorto(nombre) }));
  const origen = origenDe(req, db);
  res.json({
    ...formatear(c),
    contacto: c.contacto,
    activo: c.activo,
    propio: c.usuario_id === req.usuario.id,
    distancia_km: origen ? Math.max(0.5, Math.round(distanciaKm(origen, c) * 2) / 2) : null,
    resenas,
  });
});

// Mensaje al cuidador: llega a su correo con los datos de quien escribe para que responda
cuidadoresRouter.post('/:id/mensaje', limitador({ max: 15, minutos: 60 }), async (req, res) => {
  const c = cuidador(req, res);
  if (!c) return;
  if (c.usuario_id === req.usuario.id) return res.status(400).json({ error: 'Es tu propio perfil' });
  const mensaje = texto(req.body?.mensaje, 1500);
  if (!mensaje) return res.status(400).json({ error: 'Escribe tu mensaje' });
  const destino = db.prepare('SELECT email FROM usuarios WHERE id = ?').get(c.usuario_id);
  try {
    await enviarCorreo({
      para: destino.email,
      asunto: `🐾 ${nombreCorto(req.usuario.nombre)} quiere contratar tus servicios`,
      html: plantilla('Nuevo mensaje desde MasoPet', `
        <p><strong>${escHtml(req.usuario.nombre)}</strong> te escribió por tu perfil de cuidador/paseador:</p>
        <blockquote style="border-left:3px solid #20b6a3;margin:0;padding:6px 12px;color:#334155">${escHtml(mensaje)}</blockquote>
        <p>Responde directamente a 📧 <a href="mailto:${escHtml(req.usuario.email)}">${escHtml(req.usuario.email)}</a></p>
        ${boton(`${urlPublica()}/cuidador.html?id=${c.usuario_id}`, 'Ver mi perfil')}`),
      texto: `${req.usuario.nombre} (${req.usuario.email}) te escribió: ${mensaje}`,
    });
  } catch (err) {
    console.error('No se pudo enviar el mensaje al cuidador:', err.message);
    return res.status(502).json({ error: 'No pudimos enviar el mensaje. Inténtalo más tarde.' });
  }
  res.status(201).json({ mensaje: 'Mensaje enviado. Te responderá a tu correo.' });
});

// ---------- Reseñas ----------
cuidadoresRouter.put('/:id/resenas', (req, res) => {
  const c = cuidador(req, res);
  if (!c) return;
  if (c.usuario_id === req.usuario.id) return res.status(400).json({ error: 'No puedes reseñarte a ti mismo' });
  const estrellas = Number(req.body?.estrellas);
  if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) return res.status(400).json({ error: 'Elige de 1 a 5 estrellas' });
  db.prepare(`
    INSERT INTO resenas_cuidador (cuidador_id, usuario_id, estrellas, comentario) VALUES (?, ?, ?, ?)
    ON CONFLICT (cuidador_id, usuario_id) DO UPDATE SET estrellas = excluded.estrellas, comentario = excluded.comentario, creado_en = datetime('now')
  `).run(c.usuario_id, req.usuario.id, estrellas, texto(req.body?.comentario, 1000));
  res.status(204).end();
});

cuidadoresRouter.delete('/:id/resenas', (req, res) => {
  db.prepare('DELETE FROM resenas_cuidador WHERE cuidador_id = ? AND usuario_id = ?').run(Number(req.params.id), req.usuario.id);
  res.status(204).end();
});
