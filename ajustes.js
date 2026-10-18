import { db } from './db.js';

// Ajustes que el administrador cambia desde el panel. Solo se aceptan estas claves.
export const AJUSTES = {
  donaciones_url: { max: 300 },
  // Datos para donar por transferencia (se muestran públicamente en "Apoyar MasoPet")
  transferencia_banco: { max: 40 },
  transferencia_tipo: { max: 40 },
  transferencia_numero: { max: 30 },
  transferencia_titular: { max: 100 },
  transferencia_rut: { max: 12 },
  transferencia_correo: { max: 200 },
  tiktok_url: { max: 200 },
  instagram_url: { max: 200 },
};

export const BANCOS = ['BancoEstado', 'Banco de Chile', 'Santander', 'BCI', 'Scotiabank', 'Itaú', 'Banco Falabella', 'Banco Ripley',
  'Banco Security', 'Banco BICE', 'Banco Consorcio', 'Banco Internacional', 'Mercado Pago', 'Tenpo', 'Coopeuch'];
export const TIPOS_CUENTA = ['CuentaRUT', 'Cuenta Vista', 'Cuenta Corriente', 'Cuenta de Ahorro', 'Chequera Electrónica'];

// RUT chileno con su dígito verificador. Devuelve el RUT con formato 12.345.678-9, o null si no es válido.
export function rutValido(rut) {
  const limpio = String(rut || '').replace(/[.\s-]/g, '').toUpperCase();
  if (!/^\d{7,8}[\dK]$/.test(limpio)) return null;
  const cuerpo = limpio.slice(0, -1);
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const esperado = 11 - (suma % 11);
  const dv = esperado === 11 ? '0' : esperado === 10 ? 'K' : String(esperado);
  if (dv !== limpio.slice(-1)) return null;
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

// Lo que se muestra en la página pública: null si no hay número de cuenta
export function datosTransferencia(a = leerAjustes()) {
  if (!a.transferencia_numero) return null;
  return {
    banco: a.transferencia_banco, tipo: a.transferencia_tipo, numero: a.transferencia_numero,
    titular: a.transferencia_titular, rut: a.transferencia_rut, correo: a.transferencia_correo,
  };
}

export function leerAjustes() {
  const filas = db.prepare('SELECT clave, valor FROM ajustes').all();
  const guardados = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return Object.fromEntries(Object.keys(AJUSTES).map((clave) => [clave, guardados[clave] ?? null]));
}

export function guardarAjuste(clave, valor) {
  const limpio = String(valor ?? '').trim().slice(0, AJUSTES[clave].max) || null;
  db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor').run(clave, limpio);
  return limpio;
}

// Solo enlaces https (Mercado Pago, PayPal, Ko-fi, etc.), para no mandar a nadie a una página insegura
export function enlaceValido(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

// Redes sociales: acepta el enlace completo o solo el usuario ("@masopet" o "masopet").
// Devuelve el enlace https listo, '' si viene vacío, o null si no es de esa red.
const REDES = {
  tiktok: { dominio: 'tiktok.com', perfil: (u) => `https://www.tiktok.com/@${u}` },
  instagram: { dominio: 'instagram.com', perfil: (u) => `https://www.instagram.com/${u}/` },
};

export function enlaceRed(red, valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  const usuario = texto.replace(/^@/, '');
  if (/^[\w.]{1,30}$/.test(usuario)) return REDES[red].perfil(usuario);
  try {
    const url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
    const host = url.hostname.toLowerCase();
    const esDeLaRed = host === REDES[red].dominio || host.endsWith(`.${REDES[red].dominio}`);
    if (!esDeLaRed) return null;
    url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}
