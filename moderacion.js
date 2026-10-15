import { db } from './db.js';
import { urlPublica } from './config.js';
import { enviarCorreo, plantilla, boton, escHtml } from './correo.js';

// Reportes de personas distintas necesarios para ocultar algo automáticamente
export const UMBRAL_OCULTAR = 3;

export const MOTIVOS = {
  falso: 'Información falsa o engañosa',
  no_admite: 'Ya no admite mascotas / no existe',
  ofensivo: 'Contenido ofensivo o inapropiado',
  spam: 'Spam o publicidad',
  otro: 'Otro motivo',
};

// Qué se puede reportar. Las tablas y consultas vienen de aquí, nunca del cliente.
export const TIPOS = {
  lugar: {
    nombre: 'Lugar',
    tabla: 'lugares',
    vista: `SELECT l.id, l.nombre AS titulo, l.descripcion AS texto, l.categoria AS extra, l.oculto,
              u.id AS autor_id, u.nombre AS autor, u.email AS autor_email
            FROM lugares l LEFT JOIN usuarios u ON u.id = l.creado_por WHERE l.id = ?`,
  },
  resena: {
    nombre: 'Reseña',
    tabla: 'resenas',
    vista: `SELECT r.id, 'Reseña de ' || l.nombre AS titulo, r.comentario AS texto, r.estrellas || ' ★' AS extra, r.oculto,
              u.id AS autor_id, u.nombre AS autor, u.email AS autor_email
            FROM resenas r JOIN lugares l ON l.id = r.lugar_id JOIN usuarios u ON u.id = r.usuario_id WHERE r.id = ?`,
  },
  perdida: {
    nombre: 'Aviso de mascota perdida',
    tabla: 'perdidas',
    vista: `SELECT p.id, 'Se busca: ' || m.nombre AS titulo, p.descripcion AS texto, p.contacto AS extra, p.oculto, m.foto,
              u.id AS autor_id, u.nombre AS autor, u.email AS autor_email
            FROM perdidas p JOIN mascotas m ON m.id = p.mascota_id JOIN usuarios u ON u.id = p.usuario_id WHERE p.id = ?`,
  },
  paseo: {
    nombre: 'Paseo',
    tabla: 'paseos',
    vista: `SELECT p.id, 'Paseo: ' || p.titulo AS titulo, p.descripcion AS texto, p.punto || ' · ' || p.fecha || ' ' || p.hora AS extra, p.oculto,
              u.id AS autor_id, u.nombre AS autor, u.email AS autor_email
            FROM paseos p JOIN usuarios u ON u.id = p.organizador_id WHERE p.id = ?`,
  },
  comentario: {
    nombre: 'Mensaje en un paseo',
    tabla: 'paseo_comentarios',
    vista: `SELECT c.id, 'Mensaje en “' || p.titulo || '”' AS titulo, c.texto, NULL AS extra, c.oculto,
              u.id AS autor_id, u.nombre AS autor, u.email AS autor_email
            FROM paseo_comentarios c JOIN paseos p ON p.id = c.paseo_id JOIN usuarios u ON u.id = c.usuario_id WHERE c.id = ?`,
  },
  adopcion: {
    nombre: 'Publicación de adopción',
    tabla: 'adopciones',
    vista: `SELECT a.id, 'En adopción: ' || a.nombre AS titulo, a.descripcion AS texto, a.contacto AS extra, a.oculto, a.foto,
              u.id AS autor_id, u.nombre AS autor, u.email AS autor_email
            FROM adopciones a JOIN usuarios u ON u.id = a.usuario_id WHERE a.id = ?`,
  },
  cuidador: {
    nombre: 'Perfil de cuidador/paseador',
    tabla: 'perfiles_cuidador',
    clave: 'usuario_id',
    vista: `SELECT c.usuario_id AS id, 'Cuidador: ' || u.nombre AS titulo, c.descripcion AS texto, c.tarifa AS extra, c.oculto, c.foto,
              u.id AS autor_id, u.nombre AS autor, u.email AS autor_email
            FROM perfiles_cuidador c JOIN usuarios u ON u.id = c.usuario_id WHERE c.usuario_id = ?`,
  },
  resena_cuidador: {
    nombre: 'Reseña de cuidador',
    tabla: 'resenas_cuidador',
    vista: `SELECT r.id, 'Reseña a ' || c.nombre AS titulo, r.comentario AS texto, r.estrellas || ' ★' AS extra, r.oculto,
              u.id AS autor_id, u.nombre AS autor, u.email AS autor_email
            FROM resenas_cuidador r JOIN usuarios c ON c.id = r.cuidador_id JOIN usuarios u ON u.id = r.usuario_id WHERE r.id = ?`,
  },
  evento: {
    nombre: 'Evento',
    tabla: 'eventos',
    vista: `SELECT e.id, 'Evento: ' || e.titulo AS titulo, e.descripcion AS texto, e.lugar || ' · ' || e.fecha AS extra, e.oculto,
              u.id AS autor_id, u.nombre AS autor, u.email AS autor_email
            FROM eventos e JOIN usuarios u ON u.id = e.usuario_id WHERE e.id = ?`,
  },
};

const clave = (tipo) => TIPOS[tipo].clave || 'id';

export const vistaPrevia = (tipo, id) => db.prepare(TIPOS[tipo].vista).get(id);

export function eliminarObjeto(tipo, id) {
  db.prepare(`DELETE FROM ${TIPOS[tipo].tabla} WHERE ${clave(tipo)} = ?`).run(id);
  db.prepare("UPDATE reportes SET estado = 'resuelto', resuelto_en = datetime('now') WHERE tipo = ? AND objeto_id = ? AND estado = 'pendiente'").run(tipo, id);
}

export function mantenerObjeto(tipo, id) {
  db.prepare(`UPDATE ${TIPOS[tipo].tabla} SET oculto = 0 WHERE ${clave(tipo)} = ?`).run(id);
  db.prepare("UPDATE reportes SET estado = 'descartado', resuelto_en = datetime('now') WHERE tipo = ? AND objeto_id = ? AND estado = 'pendiente'").run(tipo, id);
}

// Tras un reporte nuevo: si se alcanza el umbral, oculta el contenido y avisa a los administradores
export async function revisarUmbral(tipo, id) {
  const { total } = db.prepare("SELECT COUNT(*) AS total FROM reportes WHERE tipo = ? AND objeto_id = ? AND estado = 'pendiente'").get(tipo, id);
  const objeto = vistaPrevia(tipo, id);
  if (total < UMBRAL_OCULTAR || !objeto || objeto.oculto) return false;

  db.prepare(`UPDATE ${TIPOS[tipo].tabla} SET oculto = 1 WHERE ${clave(tipo)} = ?`).run(id);
  const admins = db.prepare("SELECT email FROM usuarios WHERE rol = 'admin' AND bloqueado = 0").all();
  for (const { email } of admins) {
    enviarCorreo({
      para: email,
      asunto: `🚩 Contenido oculto por reportes: ${objeto.titulo}`,
      html: plantilla('Contenido oculto automáticamente', `
        <p>${escHtml(TIPOS[tipo].nombre)} <strong>“${escHtml(objeto.titulo)}”</strong> recibió ${total} reportes y quedó oculto hasta que lo revises.</p>
        ${boton(`${urlPublica()}/admin.html#reportes`, 'Revisar reportes')}`),
      texto: `${objeto.titulo} recibió ${total} reportes. Revisa en ${urlPublica()}/admin.html#reportes`,
    }).catch((err) => console.error('No se pudo avisar al administrador:', err.message));
  }
  return true;
}
