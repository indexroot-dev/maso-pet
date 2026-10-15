import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CARPETA_FOTOS = path.join(__dirname, 'data', 'fotos');
fs.mkdirSync(CARPETA_FOTOS, { recursive: true });

const MAX_BYTES = 3 * 1024 * 1024;
const FORMATOS = {
  'image/jpeg': { ext: 'jpg', firma: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', firma: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  'image/webp': { ext: 'webp', firma: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};

// Recibe una imagen como data URL (base64). Devuelve el nombre del archivo guardado o null si no es válida.
// El nombre es aleatorio: solo quien conoce el enlace puede ver la foto.
export function guardarFoto(dataUrl) {
  const partes = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  const formato = partes && FORMATOS[partes[1]];
  if (!formato) return null;
  const datos = Buffer.from(partes[2], 'base64');
  if (datos.length < 12 || datos.length > MAX_BYTES || !formato.firma(datos)) return null;
  const nombre = `${crypto.randomBytes(16).toString('hex')}.${formato.ext}`;
  fs.writeFileSync(path.join(CARPETA_FOTOS, nombre), datos);
  return nombre;
}

// Copia una foto existente con un nombre nuevo (para que cada publicación tenga la suya)
export function copiarFoto(nombre) {
  if (!nombre || !/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(nombre)) return null;
  const nuevo = `${crypto.randomBytes(16).toString('hex')}.${nombre.split('.').pop()}`;
  try {
    fs.copyFileSync(path.join(CARPETA_FOTOS, nombre), path.join(CARPETA_FOTOS, nuevo));
    return nuevo;
  } catch {
    return null;
  }
}

export function borrarFoto(nombre) {
  if (nombre && /^[a-f0-9]{32}\.(jpg|png|webp)$/.test(nombre)) {
    fs.rm(path.join(CARPETA_FOTOS, nombre), { force: true }, () => {});
  }
}
