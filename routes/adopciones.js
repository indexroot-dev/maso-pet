import { Router } from 'express';
import { db } from '../db.js';
import { texto, coordenadasValidas, aproximar, nombreCorto, origenDe, distanciaKm, limitador, urlPublica } from '../config.js';
import { enviarCorreo, plantilla, boton, escHtml } from '../correo.js';
import { guardarFoto, copiarFoto, borrarFoto } from '../fotos.js';
import { notificar } from '../notificaciones.js';
import { requiereLogin } from './auth.js';

const ESPECIES = ['perro', 'gato', 'ave', 'conejo', 'roedor', 'reptil', 'otro'];
const TAMANOS = ['pequeno', 'mediano', 'grande'];
const CARACTERES = ['sociable', 'selectivo', 'timido', 'no_sociable'];
const ESTADOS = ['disponible', 'en_proceso', 'adoptado'];
const opcion = (valor, validos) => (validos.includes(valor) ? valor : null);
const siNo = (valor) => (valor === true || valor === 1 || valor === '1' || valor === 'on' ? 1 : 0);

function edadDesde(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const nac = new Date(`${fechaNacimiento}T00:00`);
  const meses = (new Date().getFullYear() - nac.getFullYear()) * 12 + new Date().getMonth() - nac.getMonth();
  if (meses < 0) return null;
  if (meses < 12) return `${meses} mes${meses === 1 ? '' : 'es'}`;
  return `${Math.floor(meses / 12)} año${meses >= 24 ? 's' : ''}`;
}

// Datos que se pueden escribir en una publicación
function leerDatos(body) {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  return {
    nombre: texto(body?.nombre, 80),
    especie: opcion(body?.especie, ESPECIES),
    raza: texto(body?.raza, 80),
    sexo: opcion(body?.sexo, ['macho', 'hembra']),
    edad: texto(body?.edad, 40),
    tamano: opcion(body?.tamano, TAMANOS),
    caracter: opcion(body?.caracter, CARACTERES),
    esterilizado: siNo(body?.esterilizado),
    vacunado: siNo(body?.vacunado),
    descripcion: texto(body?.descripcion, 2000),
    requisitos: texto(body?.requisitos, 1000),
    publicador: body?.publicador === 'refugio' ? 'refugio' : 'persona',
    organizacion: body?.publicador === 'refugio' ? texto(body?.organizacion, 120) : null,
    contacto: texto(body?.contacto, 120),
    comuna: texto(body?.comuna, 80),
    lat: coordenadasValidas(lat, lng) ? aproximar(lat) : null,
    lng: coordenadasValidas(lat, lng) ? aproximar(lng) : null,
  };
}

function validar(d) {
  if (!d.nombre) return 'Indica el nombre de la mascota';
  if (!d.especie) return 'Indica la especie';
  if (!d.contacto) return 'Indica un teléfono o forma de contacto';
  if (d.publicador === 'refugio' && !d.organizacion) return 'Indica el nombre del refugio u organización';
  return null;
}

export const adopcionesRouter = Router();
adopcionesRouter.use(requiereLogin);

adopcionesRouter.get('/', (req, res) => {
  const filtros = ['a.oculto = 0', 'u.bloqueado = 0'];
  const params = [req.usuario.id];
  if (req.query.estado === 'adoptado') filtros.push("a.estado = 'adoptado'");
  else filtros.push("a.estado != 'adoptado'");
  if (ESPECIES.includes(req.query.especie)) { filtros.push('a.especie = ?'); params.push(req.query.especie); }
  if (TAMANOS.includes(req.query.tamano)) { filtros.push('a.tamano = ?'); params.push(req.query.tamano); }

  const origen = origenDe(req, db);
  const lista = db.prepare(`
    SELECT a.id, a.nombre, a.especie, a.raza, a.sexo, a.edad, a.tamano, a.caracter, a.esterilizado, a.vacunado, a.publicador,
      a.organizacion, a.comuna, a.lat, a.lng, a.foto, a.estado, a.creado_en, (a.usuario_id = ?) AS propia,
      (a.mascota_id IS NOT NULL) AS con_ficha
    FROM adopciones a JOIN usuarios u ON u.id = a.usuario_id
    WHERE ${filtros.join(' AND ')} ORDER BY a.creado_en DESC LIMIT 300
  `).all(...params).map(({ lat, lng, ...a }) => ({
    ...a,
    distancia_km: origen && lat != null ? Math.max(0.5, Math.round(distanciaKm(origen, { lat, lng }) * 2) / 2) : null,
  }));
  if (origen) lista.sort((a, b) => (a.distancia_km ?? 1e9) - (b.distancia_km ?? 1e9));
  res.json(lista);
});

adopcionesRouter.post('/', limitador({ max: 10, minutos: 60, mensaje: 'Has publicado muchas adopciones seguidas. Espera un poco.' }), (req, res) => {
  const datos = leerDatos(req.body);
  let mascotaId = null;
  let foto = null;

  // Publicar una mascota ya registrada: completa lo que falte desde su ficha
  if (req.body?.mascota_id) {
    const m = db.prepare('SELECT * FROM mascotas WHERE id = ? AND usuario_id = ?').get(Number(req.body.mascota_id), req.usuario.id);
    if (!m) return res.status(400).json({ error: 'Esa mascota no es tuya' });
    mascotaId = m.id;
    datos.nombre ??= m.nombre;
    datos.especie ??= opcion(m.especie, ESPECIES);
    datos.raza ??= m.raza;
    datos.sexo ??= opcion(m.sexo, ['macho', 'hembra']);
    datos.edad ??= edadDesde(m.fecha_nacimiento);
    datos.tamano ??= opcion(m.tamano, TAMANOS);
    datos.caracter ??= opcion(m.caracter, CARACTERES);
    if (!req.body?.esterilizado) datos.esterilizado = m.esterilizado;
    if (m.foto && !req.body?.imagen) foto = copiarFoto(m.foto);
  }
  const error = validar(datos);
  if (error) return res.status(400).json({ error });
  if (req.body?.imagen) {
    foto = guardarFoto(req.body.imagen);
    if (!foto) return res.status(400).json({ error: 'La foto no es válida (usa JPG, PNG o WebP de menos de 3 MB)' });
  }

  const columnas = Object.keys(datos);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO adopciones (usuario_id, mascota_id, foto, ${columnas.join(', ')}) VALUES (?, ?, ?, ${columnas.map(() => '?').join(', ')})
  `).run(req.usuario.id, mascotaId, foto, ...columnas.map((c) => datos[c]));
  res.status(201).json({ id: Number(lastInsertRowid) });
});

function publicacion(req, res) {
  const a = db.prepare(`
    SELECT a.*, u.nombre AS autor FROM adopciones a JOIN usuarios u ON u.id = a.usuario_id
    WHERE a.id = ? AND a.oculto = 0 AND u.bloqueado = 0
  `).get(Number(req.params.id));
  if (!a) res.status(404).json({ error: 'Publicación no encontrada' });
  return a;
}

adopcionesRouter.get('/:id', (req, res) => {
  const a = publicacion(req, res);
  if (!a) return;
  const propia = a.usuario_id === req.usuario.id;

  // Ficha de salud de la mascota vinculada
  let salud = null;
  if (a.mascota_id) {
    const m = db.prepare('SELECT alergias, condiciones, peso, microchip FROM mascotas WHERE id = ?').get(a.mascota_id);
    salud = {
      ...m,
      microchip: Boolean(m.microchip),
      vacunas: db.prepare('SELECT nombre, fecha, proxima_fecha FROM vacunas WHERE mascota_id = ? ORDER BY fecha DESC').all(a.mascota_id),
      desparasitaciones: db.prepare('SELECT producto, tipo, fecha FROM desparasitaciones WHERE mascota_id = ? ORDER BY fecha DESC').all(a.mascota_id),
      ultima_consulta: db.prepare('SELECT fecha, motivo FROM consultas WHERE mascota_id = ? ORDER BY fecha DESC LIMIT 1').get(a.mascota_id) || null,
    };
  }
  const solicitudes = propia
    ? db.prepare(`
        SELECT s.id, s.mensaje, s.telefono, s.creado_en, u.nombre, u.email FROM solicitudes_adopcion s
        JOIN usuarios u ON u.id = s.usuario_id WHERE s.adopcion_id = ? ORDER BY s.creado_en DESC
      `).all(a.id)
    : null;
  const yaSolicite = Boolean(db.prepare('SELECT 1 FROM solicitudes_adopcion WHERE adopcion_id = ? AND usuario_id = ?').get(a.id, req.usuario.id));

  const { usuario_id, mascota_id, lat, lng, autor, ...publico } = a;
  res.json({
    ...publico,
    publicado_por: a.publicador === 'refugio' ? a.organizacion : nombreCorto(autor),
    propia,
    con_ficha: Boolean(mascota_id),
    salud,
    solicitudes,
    ya_solicite: yaSolicite,
  });
});

adopcionesRouter.put('/:id', (req, res) => {
  const a = publicacion(req, res);
  if (!a) return;
  if (a.usuario_id !== req.usuario.id) return res.status(403).json({ error: 'Solo quien publicó puede editar' });

  // Cambio rápido de estado (disponible / en proceso / adoptado)
  if (req.body?.estado && Object.keys(req.body).length === 1) {
    if (!ESTADOS.includes(req.body.estado)) return res.status(400).json({ error: 'Estado no válido' });
    db.prepare('UPDATE adopciones SET estado = ? WHERE id = ?').run(req.body.estado, a.id);
    return res.status(204).end();
  }
  const datos = leerDatos(req.body);
  const error = validar(datos);
  if (error) return res.status(400).json({ error });
  if (ESTADOS.includes(req.body?.estado)) datos.estado = req.body.estado;
  if (req.body?.imagen) {
    const foto = guardarFoto(req.body.imagen);
    if (!foto) return res.status(400).json({ error: 'La foto no es válida (usa JPG, PNG o WebP de menos de 3 MB)' });
    datos.foto = foto;
    borrarFoto(a.foto);
  }
  db.prepare(`UPDATE adopciones SET ${Object.keys(datos).map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(datos), a.id);
  res.status(204).end();
});

adopcionesRouter.delete('/:id', (req, res) => {
  const a = publicacion(req, res);
  if (!a) return;
  if (a.usuario_id !== req.usuario.id) return res.status(403).json({ error: 'Solo quien publicó puede eliminar' });
  db.prepare('DELETE FROM adopciones WHERE id = ?').run(a.id);
  borrarFoto(a.foto);
  res.status(204).end();
});

// "Me interesa adoptar": queda registrado y se avisa por correo a quien publicó
adopcionesRouter.post('/:id/solicitudes', limitador({ max: 15, minutos: 60 }), async (req, res) => {
  const a = publicacion(req, res);
  if (!a) return;
  if (a.usuario_id === req.usuario.id) return res.status(400).json({ error: 'Es tu propia publicación' });
  if (a.estado === 'adoptado') return res.status(400).json({ error: 'Esta mascota ya fue adoptada' });
  const mensaje = texto(req.body?.mensaje, 1500);
  const telefono = texto(req.body?.telefono, 40);
  if (!mensaje) return res.status(400).json({ error: 'Cuéntale a quien publicó por qué quieres adoptar' });

  const { changes } = db.prepare('INSERT OR IGNORE INTO solicitudes_adopcion (adopcion_id, usuario_id, mensaje, telefono) VALUES (?, ?, ?, ?)')
    .run(a.id, req.usuario.id, mensaje, telefono);
  if (!changes) return res.status(409).json({ error: 'Ya enviaste tu interés por esta mascota' });

  notificar([a.usuario_id], `🏠 ${nombreCorto(req.usuario.nombre)} quiere adoptar a ${a.nombre}`, `adopcion.html?id=${a.id}`);
  const duenio = db.prepare('SELECT email FROM usuarios WHERE id = ?').get(a.usuario_id);
  enviarCorreo({
    para: duenio.email,
    asunto: `🏠 Alguien quiere adoptar a ${a.nombre}`,
    html: plantilla(`Nueva solicitud para adoptar a ${a.nombre}`, `
      <p><strong>${escHtml(req.usuario.nombre)}</strong> está interesado/a en adoptar a <strong>${escHtml(a.nombre)}</strong>:</p>
      <blockquote style="border-left:3px solid #20b6a3;margin:0;padding:6px 12px;color:#334155">${escHtml(mensaje)}</blockquote>
      <p>📧 ${escHtml(req.usuario.email)}${telefono ? `<br>📞 ${escHtml(telefono)}` : ''}</p>
      ${boton(`${urlPublica()}/adopcion.html?id=${a.id}`, 'Ver todas las solicitudes')}`),
    texto: `${req.usuario.nombre} (${req.usuario.email}${telefono ? `, ${telefono}` : ''}) quiere adoptar a ${a.nombre}: ${mensaje}`,
  }).catch((err) => console.error('No se pudo avisar la solicitud de adopción:', err.message));
  res.status(201).json({ mensaje: 'Le enviamos tu mensaje a quien publicó. Te contactará pronto.' });
});
