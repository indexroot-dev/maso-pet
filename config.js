import os from 'node:os';

export const PUERTO = Number(process.env.PORT) || 3000;

// Dirección para abrir la app desde otro dispositivo (QR, enlaces en correos y fichas compartidas).
// En producción define PUBLIC_URL con el dominio real, ej: https://masopet.cl
export function urlPublica() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  const ip = ips.find((a) => a.startsWith('192.168.')) || ips.find((a) => a.startsWith('10.')) || ips[0];
  return ip ? `http://${ip}:${PUERTO}` : `http://localhost:${PUERTO}`;
}

// Fecha local en formato YYYY-MM-DD (n días desde hoy)
export function fechaLocal(dias = 0) {
  const d = new Date(Date.now() + dias * 864e5);
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}

// ---------- Validación de datos que llegan del cliente ----------
export const texto = (valor, max) => String(valor ?? '').trim().slice(0, max) || null;
export const coordenadasValidas = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
// ~1 km de precisión: sirve para calcular cercanía sin revelar direcciones
export const aproximar = (n) => Math.round(n * 100) / 100;
// Filtra una lista recibida dejando solo valores permitidos (se guarda como "a,b,c")
export const elegidos = (lista, validos) => [...new Set(Array.isArray(lista) ? lista : [])].filter((v) => validos.includes(v)).join(',');
export const separar = (csv) => (csv ? csv.split(',') : []);
export const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f || '');
export const horaValida = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h || '');

// Solo nombre e inicial del apellido
export function nombreCorto(nombre) {
  const [nombrePila, apellido] = String(nombre).trim().split(/\s+/);
  return apellido ? `${nombrePila} ${apellido[0]}.` : nombrePila;
}

// Punto desde el que medir distancias: ?lat&lng del navegador o, si no, la zona del perfil de paseo
export function origenDe(req, db) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (coordenadasValidas(lat, lng)) return { lat, lng };
  return db.prepare('SELECT lat, lng FROM perfiles_paseo WHERE usuario_id = ? AND activo = 1').get(req.usuario.id) || null;
}

// Distancia en km entre dos puntos {lat, lng}
export function distanciaKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Limita la cantidad de intentos por IP (login, registro, recuperar contraseña)
export function limitador({ max, minutos, mensaje = 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }) {
  const intentos = new Map();
  return (req, res, next) => {
    const ahora = Date.now();
    const recientes = (intentos.get(req.ip) || []).filter((t) => ahora - t < minutos * 6e4);
    if (recientes.length >= max) return res.status(429).json({ error: mensaje });
    recientes.push(ahora);
    intentos.set(req.ip, recientes);
    next();
  };
}
