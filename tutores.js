import { db } from './db.js';
import { notificar } from './notificaciones.js';

// Una mascota puede tener varios tutores: el dueño (quien la creó, mascotas.usuario_id)
// y las personas que él invitó y aceptaron (tabla mascota_tutores con estado 'aceptado').
export const MAX_TUTORES = 5; // contando al dueño

// Subconsulta con los id de las mascotas de un usuario (como dueño o tutor). Recibe el id del usuario DOS veces.
export const SQL_MIS_MASCOTAS = `
  SELECT id FROM mascotas WHERE usuario_id = ?
  UNION SELECT mascota_id FROM mascota_tutores WHERE usuario_id = ? AND estado = 'aceptado'`;

// La mascota si el usuario es su dueño o tutor; si no, undefined. Agrega es_dueno y el nombre del dueño.
export function mascotaConAcceso(usuarioId, mascotaId) {
  return db.prepare(`
    SELECT m.*, (m.usuario_id = ?) AS es_dueno, u.nombre AS dueno
    FROM mascotas m JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.id = ? AND m.id IN (${SQL_MIS_MASCOTAS})
  `).get(usuarioId, mascotaId, usuarioId, usuarioId);
}

// Todos los que cuidan la mascota (dueño + tutores aceptados): para avisarles a todos
export function idsTutores(mascotaId) {
  return db.prepare(`
    SELECT usuario_id AS id FROM mascotas WHERE id = ?1
    UNION SELECT usuario_id FROM mascota_tutores WHERE mascota_id = ?1 AND estado = 'aceptado'
  `).all(mascotaId).map((f) => f.id);
}

// Antes de eliminar una cuenta: cada mascota suya que tenga otro tutor pasa a ese tutor (el más antiguo),
// así no se borra la ficha de una mascota que otra persona también cuida.
export function traspasarMascotas(usuarioId) {
  const conTutor = db.prepare(`
    SELECT m.id, m.nombre, (
      SELECT t.usuario_id FROM mascota_tutores t
      WHERE t.mascota_id = m.id AND t.estado = 'aceptado' ORDER BY t.creado_en, t.usuario_id LIMIT 1
    ) AS nuevo
    FROM mascotas m WHERE m.usuario_id = ?
  `).all(usuarioId).filter((m) => m.nuevo);
  for (const m of conTutor) {
    db.prepare('UPDATE mascotas SET usuario_id = ? WHERE id = ?').run(m.nuevo, m.id);
    db.prepare('DELETE FROM mascota_tutores WHERE mascota_id = ? AND usuario_id = ?').run(m.id, m.nuevo);
    notificar([m.nuevo], `🐾 Ahora eres el tutor principal de ${m.nombre}: la otra persona eliminó su cuenta.`, `ficha.html?id=${m.id}`);
  }
  return conTutor.length;
}
