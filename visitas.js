import crypto from 'node:crypto';
import { db } from './db.js';
import { leerCookie } from './routes/auth.js';

const COOKIE = 'visitante';
const MS_COOKIE = 2 * 365 * 24 * 60 * 60 * 1000;
// Buscadores, vistas previas de enlaces (WhatsApp, Instagram…) y programas: no son personas
const NO_PERSONA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|headless|monitor/i;

const registrar = db.prepare(`
  INSERT INTO visitas (visitante, dia, app) VALUES (?, date('now', 'localtime'), ?)
  ON CONFLICT (visitante, dia) DO UPDATE SET app = MAX(app, excluded.app)
`);
const registrarActividad = db.prepare("INSERT OR IGNORE INTO actividad_usuarios (usuario_id, dia) VALUES (?, date('now', 'localtime'))");

// Desde la app instalada: el APK agrega "MasoPetAndroid" a su navegador y el ícono de la
// pantalla de inicio abre /?app=1 (start_url del manifest)
const desdeApp = (req) => /MasoPetAndroid/.test(req.get('user-agent') || '') || req.query.app === '1';

// Middleware: cuenta a cada persona una vez por día al abrir cualquier página (no las fotos, estilos ni la API)
export function contarVisitas(req, res, next) {
  const esPagina = req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'));
  if (!esPagina || req.usuario?.rol === 'admin' || NO_PERSONA.test(req.get('user-agent') || '')) return next();

  let visitante = leerCookie(req, COOKIE);
  if (!/^[a-f0-9]{32}$/.test(visitante || '')) {
    visitante = crypto.randomBytes(16).toString('hex');
    res.cookie(COOKIE, visitante, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: MS_COOKIE,
    });
  }
  registrar.run(visitante, desdeApp(req) ? 1 : 0);
  next();
}

// Middleware: marca como activo hoy a cada usuario con sesión (una escritura por usuario y día)
let hoy = '';
let activosHoy = new Set();
export function contarActividad(req, res, next) {
  if (req.usuario && req.usuario.rol !== 'admin') {
    const dia = new Date().toLocaleDateString('sv');
    if (dia !== hoy) { hoy = dia; activosHoy = new Set(); }
    if (!activosHoy.has(req.usuario.id)) {
      registrarActividad.run(req.usuario.id);
      activosHoy.add(req.usuario.id);
    }
  }
  next();
}
