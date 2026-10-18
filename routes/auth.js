import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { limitador, urlPublica } from '../config.js';
import { enviarCorreo, plantilla, boton, escHtml } from '../correo.js';
import { enviarRecordatorio, proximasDosis } from '../recordatorios.js';
import { borrarFoto } from '../fotos.js';

const DIAS_SESION = 7;
const MS_SESION = DIAS_SESION * 24 * 60 * 60 * 1000;
const MS_RESTABLECER = 60 * 60 * 1000;
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashPassword(password) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

function verificarPassword(password, guardado) {
  const [sal, hash] = guardado.split(':');
  const calculado = crypto.scryptSync(password, sal, 64);
  return crypto.timingSafeEqual(calculado, Buffer.from(hash, 'hex'));
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [clave, ...valor] = parte.trim().split('=');
    if (clave === nombre) return decodeURIComponent(valor.join('='));
  }
  return null;
}

function crearSesion(res, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES (?, ?, ?)')
    .run(hashToken(token), usuarioId, Date.now() + MS_SESION);
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MS_SESION,
  });
}

const validarPassword = (password) => (String(password || '').length < 8 ? 'La contraseña debe tener al menos 8 caracteres' : null);

// Middleware: si hay una sesión válida deja el usuario en req.usuario
export function cargarUsuario(req, res, next) {
  const token = leerCookie(req, 'sid');
  if (token) {
    const usuario = db.prepare(`
      SELECT u.id, u.nombre, u.email, u.recordatorios, u.rol FROM sesiones s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira > ? AND u.bloqueado = 0 AND u.verificado = 1
    `).get(hashToken(token), Date.now());
    if (usuario) req.usuario = usuario;
  }
  next();
}

export function requiereLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'Debes iniciar sesión' });
  next();
}

export function requiereAdmin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'Debes iniciar sesión' });
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo para administradores' });
  next();
}

const CUENTA_SUSPENDIDA = 'Tu cuenta está suspendida. Si crees que es un error, escríbenos.';

export const authRouter = Router();

// ---------- Verificar el correo con un código ----------
const MINUTOS_CODIGO = 15;
const MAX_INTENTOS_CODIGO = 5;
const NO_SE_ENVIO_CODIGO = 'No pudimos enviarte el código. Inténtalo de nuevo en unos minutos.';

// Crea un código nuevo de 6 números (anula el anterior) y lo envía por correo
async function enviarCodigo(usuario) {
  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare(`
    INSERT INTO verificaciones (usuario_id, codigo_hash, expira, intentos) VALUES (?, ?, ?, 0)
    ON CONFLICT (usuario_id) DO UPDATE SET codigo_hash = excluded.codigo_hash, expira = excluded.expira, intentos = 0
  `).run(usuario.id, hashToken(codigo), Date.now() + MINUTOS_CODIGO * 6e4);
  await enviarCorreo({
    para: usuario.email,
    asunto: `🐾 Tu código de MasoPet: ${codigo}`,
    html: plantilla('Verifica tu correo', `
      <p>Hola ${escHtml(usuario.nombre)}, este es tu código para activar tu cuenta de MasoPet:</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:8px;margin:20px 0;color:#0f766e">${codigo}</p>
      <p style="color:#64748b;font-size:13px">Vence en ${MINUTOS_CODIGO} minutos. Si no creaste una cuenta, ignora este correo.</p>`),
    texto: `Tu código de MasoPet es ${codigo} (vence en ${MINUTOS_CODIGO} minutos).`,
  });
}

const pedirVerificacion = (res, email, status = 201) =>
  res.status(status).json({ verificar: true, email, error: status === 403 ? 'Primero verifica tu correo: te enviamos un código.' : undefined });

authRouter.post('/registro', limitador({ max: 10, minutos: 60 }), async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!nombre || nombre.length > 100) return res.status(400).json({ error: 'Ingresa tu nombre' });
  if (!EMAIL_VALIDO.test(email) || email.length > 200) return res.status(400).json({ error: 'El correo no es válido' });
  const errorPassword = validarPassword(password);
  if (errorPassword) return res.status(400).json({ error: errorPassword });

  // Si la cuenta existe pero nunca se verificó, nadie ha probado ser dueño de ese correo:
  // se actualizan los datos y se envía un código nuevo
  const existente = db.prepare('SELECT id, verificado FROM usuarios WHERE email = ?').get(email);
  if (existente?.verificado) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
  let id = existente?.id;
  if (id) {
    db.prepare('UPDATE usuarios SET nombre = ?, password_hash = ? WHERE id = ?').run(nombre, hashPassword(password), id);
  } else {
    id = Number(db.prepare('INSERT INTO usuarios (nombre, email, password_hash, verificado) VALUES (?, ?, ?, 0)')
      .run(nombre, email, hashPassword(password)).lastInsertRowid);
  }

  try {
    await enviarCodigo({ id, nombre, email });
  } catch (err) {
    console.error('No se pudo enviar el código de verificación:', err.message);
    return res.status(502).json({ error: NO_SE_ENVIO_CODIGO });
  }
  pedirVerificacion(res, email);
});

authRouter.post('/verificar', limitador({ max: 20, minutos: 15 }), (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const codigo = String(req.body?.codigo || '').replace(/\D/g, '');
  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!usuario) return res.status(400).json({ error: 'El código no es correcto' });
  if (usuario.verificado) return res.status(400).json({ error: 'Esta cuenta ya está verificada. Inicia sesión.' });
  if (usuario.bloqueado) return res.status(403).json({ error: CUENTA_SUSPENDIDA });

  const fila = db.prepare('SELECT * FROM verificaciones WHERE usuario_id = ?').get(usuario.id);
  if (!fila || fila.expira <= Date.now()) return res.status(400).json({ error: 'El código venció. Pide uno nuevo.' });
  if (fila.intentos >= MAX_INTENTOS_CODIGO) return res.status(400).json({ error: 'Demasiados intentos. Pide un código nuevo.' });

  const correcto = codigo.length === 6 && crypto.timingSafeEqual(Buffer.from(hashToken(codigo)), Buffer.from(fila.codigo_hash));
  if (!correcto) {
    db.prepare('UPDATE verificaciones SET intentos = intentos + 1 WHERE usuario_id = ?').run(usuario.id);
    const quedan = MAX_INTENTOS_CODIGO - fila.intentos - 1;
    return res.status(400).json({ error: quedan ? `El código no es correcto. Te quedan ${quedan} ${quedan === 1 ? 'intento' : 'intentos'}.` : 'Demasiados intentos. Pide un código nuevo.' });
  }

  db.prepare('UPDATE usuarios SET verificado = 1 WHERE id = ?').run(usuario.id);
  db.prepare('DELETE FROM verificaciones WHERE usuario_id = ?').run(usuario.id);
  crearSesion(res, usuario.id);
  res.json({ id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol });
});

// Siempre responde lo mismo, para no revelar qué correos están registrados
authRouter.post('/reenviar-codigo', limitador({ max: 5, minutos: 60, mensaje: 'Ya pediste varios códigos. Espera un rato e inténtalo de nuevo.' }), async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const usuario = db.prepare('SELECT id, nombre, email FROM usuarios WHERE email = ? AND verificado = 0 AND bloqueado = 0').get(email);
  if (usuario) {
    try {
      await enviarCodigo(usuario);
    } catch (err) {
      console.error('No se pudo reenviar el código de verificación:', err.message);
      return res.status(502).json({ error: NO_SE_ENVIO_CODIGO });
    }
  }
  res.json({ mensaje: 'Te enviamos un código nuevo. Revisa tu correo (también la carpeta de spam).' });
});

authRouter.post('/login', limitador({ max: 10, minutos: 15 }), async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);

  if (!usuario || !verificarPassword(password, usuario.password_hash)) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  if (usuario.bloqueado) return res.status(403).json({ error: CUENTA_SUSPENDIDA });
  // Contraseña correcta pero correo sin verificar: se envía un código nuevo
  if (!usuario.verificado) {
    try {
      await enviarCodigo(usuario);
    } catch (err) {
      console.error('No se pudo enviar el código de verificación:', err.message);
      return res.status(502).json({ error: NO_SE_ENVIO_CODIGO });
    }
    return pedirVerificacion(res, usuario.email, 403);
  }
  db.prepare('DELETE FROM sesiones WHERE expira <= ?').run(Date.now());
  crearSesion(res, usuario.id);
  res.json({ id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol });
});

authRouter.post('/logout', (req, res) => {
  const token = leerCookie(req, 'sid');
  if (token) db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie('sid');
  res.status(204).end();
});

authRouter.get('/me', (req, res) => {
  if (!req.usuario) return res.json(null);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ? AND leida = 0').get(req.usuario.id);
  res.json({ ...req.usuario, no_leidas: n });
});

// ---------- Recuperar contraseña ----------
// Siempre responde lo mismo, exista o no la cuenta, para no revelar qué correos están registrados
authRouter.post('/olvide', limitador({ max: 5, minutos: 60 }), async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const usuario = db.prepare('SELECT id, nombre, email FROM usuarios WHERE email = ?').get(email);
  if (usuario) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM restablecimientos WHERE usuario_id = ? OR expira <= ?').run(usuario.id, Date.now());
    db.prepare('INSERT INTO restablecimientos (token_hash, usuario_id, expira) VALUES (?, ?, ?)')
      .run(hashToken(token), usuario.id, Date.now() + MS_RESTABLECER);
    const enlace = `${urlPublica()}/restablecer.html?token=${token}`;
    try {
      await enviarCorreo({
        para: usuario.email,
        asunto: '🐾 Restablece tu contraseña de MasoPet',
        html: plantilla('Restablecer contraseña', `
          <p>Hola ${escHtml(usuario.nombre)}, recibimos una solicitud para cambiar tu contraseña.</p>
          ${boton(enlace, 'Crear nueva contraseña')}
          <p style="color:#64748b;font-size:13px">El enlace vence en 1 hora. Si no fuiste tú, ignora este correo: tu contraseña no cambiará.</p>`),
        texto: `Crea una nueva contraseña aquí (vence en 1 hora): ${enlace}`,
      });
    } catch (err) {
      console.error('No se pudo enviar el correo de recuperación:', err.message);
      return res.status(502).json({ error: 'No pudimos enviar el correo. Inténtalo más tarde.' });
    }
  }
  res.json({ mensaje: 'Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña.' });
});

authRouter.post('/restablecer', limitador({ max: 10, minutos: 60 }), (req, res) => {
  const token = String(req.body?.token || '');
  const errorPassword = validarPassword(req.body?.password);
  if (errorPassword) return res.status(400).json({ error: errorPassword });

  const fila = db.prepare('SELECT r.usuario_id, u.bloqueado FROM restablecimientos r JOIN usuarios u ON u.id = r.usuario_id WHERE r.token_hash = ? AND r.expira > ?')
    .get(hashToken(token), Date.now());
  if (!fila) return res.status(400).json({ error: 'El enlace no es válido o ya venció. Solicita uno nuevo.' });
  if (fila.bloqueado) return res.status(403).json({ error: CUENTA_SUSPENDIDA });

  // Abrir el enlace del correo también demuestra que el correo es suyo
  db.prepare('UPDATE usuarios SET password_hash = ?, verificado = 1 WHERE id = ?').run(hashPassword(req.body.password), fila.usuario_id);
  db.prepare('DELETE FROM verificaciones WHERE usuario_id = ?').run(fila.usuario_id);
  db.prepare('DELETE FROM restablecimientos WHERE usuario_id = ?').run(fila.usuario_id);
  db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(fila.usuario_id);
  crearSesion(res, fila.usuario_id);
  res.json({ mensaje: 'Contraseña actualizada' });
});

// ---------- Mi cuenta ----------
authRouter.put('/password', requiereLogin, limitador({ max: 10, minutos: 15 }), (req, res) => {
  const usuario = db.prepare('SELECT password_hash FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!verificarPassword(String(req.body?.actual || ''), usuario.password_hash)) {
    return res.status(400).json({ error: 'La contraseña actual no es correcta' });
  }
  const errorPassword = validarPassword(req.body?.nueva);
  if (errorPassword) return res.status(400).json({ error: errorPassword });

  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.nueva), req.usuario.id);
  // Cierra las demás sesiones abiertas y deja solo la actual
  db.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND token_hash != ?').run(req.usuario.id, hashToken(leerCookie(req, 'sid')));
  res.json({ mensaje: 'Contraseña actualizada' });
});

authRouter.put('/preferencias', requiereLogin, (req, res) => {
  db.prepare('UPDATE usuarios SET recordatorios = ? WHERE id = ?').run(req.body?.recordatorios ? 1 : 0, req.usuario.id);
  res.json({ recordatorios: req.body?.recordatorios ? 1 : 0 });
});

// Borra la cuenta y todo lo suyo (mascotas, fichas, publicaciones, reseñas…) gracias a ON DELETE CASCADE.
// Los lugares que agregó al mapa se mantienen, pero sin autor.
authRouter.delete('/cuenta', requiereLogin, limitador({ max: 10, minutos: 15 }), (req, res) => {
  const usuario = db.prepare('SELECT password_hash, rol FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!verificarPassword(String(req.body?.password || ''), usuario.password_hash)) {
    return res.status(400).json({ error: 'La contraseña no es correcta' });
  }
  if (usuario.rol === 'admin') {
    const { otros } = db.prepare("SELECT COUNT(*) AS otros FROM usuarios WHERE rol = 'admin' AND bloqueado = 0 AND id != ?").get(req.usuario.id);
    if (!otros) return res.status(400).json({ error: 'Eres el único administrador. Nombra a otro administrador antes de eliminar tu cuenta.' });
  }

  const fotos = db.prepare(`
    SELECT foto FROM mascotas WHERE usuario_id = ?1
    UNION SELECT foto FROM adopciones WHERE usuario_id = ?1
    UNION SELECT foto FROM perfiles_cuidador WHERE usuario_id = ?1
  `).all(req.usuario.id);
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.usuario.id);
  for (const { foto } of fotos) borrarFoto(foto);
  res.clearCookie('sid');
  res.status(204).end();
});

authRouter.post('/recordatorio-prueba', requiereLogin, limitador({ max: 3, minutos: 60 }), async (req, res) => {
  try {
    await enviarRecordatorio(req.usuario, proximasDosis(req.usuario.id));
    res.json({ mensaje: `Te enviamos un correo de prueba a ${req.usuario.email}` });
  } catch (err) {
    console.error('Error al enviar correo de prueba:', err.message);
    res.status(502).json({ error: 'No pudimos enviar el correo. Revisa la configuración SMTP.' });
  }
});
