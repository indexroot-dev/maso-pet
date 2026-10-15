import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { limitador, urlPublica } from '../config.js';
import { enviarCorreo, plantilla, boton, escHtml } from '../correo.js';
import { enviarRecordatorio, proximasDosis } from '../recordatorios.js';

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
      WHERE s.token_hash = ? AND s.expira > ? AND u.bloqueado = 0
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

authRouter.post('/registro', limitador({ max: 10, minutos: 60 }), (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!nombre || nombre.length > 100) return res.status(400).json({ error: 'Ingresa tu nombre' });
  if (!EMAIL_VALIDO.test(email) || email.length > 200) return res.status(400).json({ error: 'El correo no es válido' });
  const errorPassword = validarPassword(password);
  if (errorPassword) return res.status(400).json({ error: errorPassword });

  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
  }

  const { lastInsertRowid } = db.prepare('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)')
    .run(nombre, email, hashPassword(password));
  crearSesion(res, lastInsertRowid);
  res.status(201).json({ id: Number(lastInsertRowid), nombre, email });
});

authRouter.post('/login', limitador({ max: 10, minutos: 15 }), (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);

  if (!usuario || !verificarPassword(password, usuario.password_hash)) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  if (usuario.bloqueado) return res.status(403).json({ error: CUENTA_SUSPENDIDA });
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
  res.json(req.usuario || null);
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

  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), fila.usuario_id);
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

authRouter.post('/recordatorio-prueba', requiereLogin, limitador({ max: 3, minutos: 60 }), async (req, res) => {
  try {
    await enviarRecordatorio(req.usuario, proximasDosis(req.usuario.id));
    res.json({ mensaje: `Te enviamos un correo de prueba a ${req.usuario.email}` });
  } catch (err) {
    console.error('Error al enviar correo de prueba:', err.message);
    res.status(502).json({ error: 'No pudimos enviar el correo. Revisa la configuración SMTP.' });
  }
});
