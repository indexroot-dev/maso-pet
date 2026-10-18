import { db } from './db.js';
import { distanciaKm, urlPublica } from './config.js';
import { enviarCorreo, plantilla, boton, escHtml } from './correo.js';

const MAX_GUARDADAS = 100;
export const RADIO_AVISOS_KM = 5;

// Deja una notificación en la campanita de cada usuario. enlace es relativo, ej: "paseo.html?id=3"
export function notificar(usuarioIds, texto, enlace = null) {
  const insertar = db.prepare('INSERT INTO notificaciones (usuario_id, texto, enlace) VALUES (?, ?, ?)');
  const recortar = db.prepare(`
    DELETE FROM notificaciones WHERE usuario_id = ?1 AND id NOT IN (
      SELECT id FROM notificaciones WHERE usuario_id = ?1 ORDER BY id DESC LIMIT ${MAX_GUARDADAS})
  `);
  for (const id of new Set(usuarioIds)) {
    insertar.run(id, String(texto).slice(0, 300), enlace);
    recortar.run(id);
  }
}

// Zona de cada usuario: la que eligió en "Mi cuenta" o, si no, la de su perfil de paseo
function usuariosCercaDe(punto, excepto) {
  return db.prepare(`
    SELECT u.id, u.nombre, u.email, COALESCE(u.zona_lat, p.lat) AS lat, COALESCE(u.zona_lng, p.lng) AS lng
    FROM usuarios u LEFT JOIN perfiles_paseo p ON p.usuario_id = u.id AND p.activo = 1
    WHERE u.avisos_cerca = 1 AND u.bloqueado = 0 AND u.verificado = 1 AND u.id != ?
      AND COALESCE(u.zona_lat, p.lat) IS NOT NULL
  `).all(excepto).filter((u) => distanciaKm(punto, u) <= RADIO_AVISOS_KM);
}

// Aviso nuevo de mascota perdida: notifica (campanita + correo) a quienes viven cerca
export function avisarPerdidaCerca(aviso, mascota, autorId) {
  const vecinos = usuariosCercaDe(aviso, autorId);
  if (!vecinos.length) return;
  const enlace = `perdidas.html#aviso-${aviso.id}`;
  notificar(vecinos.map((v) => v.id), `🚨 Se perdió ${mascota.nombre} cerca de tu zona. ¿Lo has visto?`, enlace);
  for (const v of vecinos) {
    enviarCorreo({
      para: v.email,
      asunto: `🚨 Se perdió ${mascota.nombre} cerca de ti`,
      html: plantilla(`Se busca: ${mascota.nombre}`, `
        <p>Hola ${escHtml(v.nombre)}, alguien perdió a su mascota a menos de ${RADIO_AVISOS_KM} km de tu zona.</p>
        ${aviso.descripcion ? `<p>${escHtml(aviso.descripcion)}</p>` : ''}
        ${boton(`${urlPublica()}/${enlace}`, 'Ver el aviso')}
        <p style="color:#64748b;font-size:13px">Puedes desactivar estos avisos en “Mi cuenta”.</p>`),
      texto: `Se perdió ${mascota.nombre} cerca de tu zona: ${urlPublica()}/${enlace}`,
    }).catch((err) => console.error('No se pudo enviar el aviso de mascota perdida:', err.message));
  }
}
