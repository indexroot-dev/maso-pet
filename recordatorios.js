import { db } from './db.js';
import { fechaLocal, urlPublica } from './config.js';
import { enviarCorreo, plantilla, boton, escHtml } from './correo.js';
import { notificar } from './notificaciones.js';

const DIAS_AVISO = 7;
const CADA_HORAS = 6;

// Próximas dosis de un usuario. Solo cuenta la dosis más reciente de cada vacuna/producto.
export function proximasDosis(usuarioId, dias = DIAS_AVISO) {
  const desde = fechaLocal();
  const hasta = fechaLocal(dias);
  const vacunas = db.prepare(`
    SELECT 'vacunas' AS tabla, v.id, v.nombre AS item, v.proxima_fecha, m.nombre AS mascota, m.id AS mascota_id
    FROM vacunas v JOIN mascotas m ON m.id = v.mascota_id
    WHERE m.usuario_id = ? AND v.proxima_fecha BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM vacunas v2 WHERE v2.mascota_id = v.mascota_id AND v2.nombre = v.nombre AND v2.fecha > v.fecha)
  `).all(usuarioId, desde, hasta);
  const desparasitaciones = db.prepare(`
    SELECT 'desparasitaciones' AS tabla, d.id, d.producto AS item, d.proxima_fecha, m.nombre AS mascota, m.id AS mascota_id
    FROM desparasitaciones d JOIN mascotas m ON m.id = d.mascota_id
    WHERE m.usuario_id = ? AND d.proxima_fecha BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM desparasitaciones d2 WHERE d2.mascota_id = d.mascota_id AND d2.producto = d.producto AND d2.fecha > d.fecha)
  `).all(usuarioId, desde, hasta);
  return [...vacunas, ...desparasitaciones].sort((a, b) => a.proxima_fecha.localeCompare(b.proxima_fecha));
}

const fechaBonita = (iso) => new Date(`${iso}T00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });

export async function enviarRecordatorio(usuario, items) {
  const filas = items.map((i) => `<li style="margin-bottom:8px"><strong>${escHtml(i.mascota)}</strong>: ${i.tabla === 'vacunas' ? '💉 vacuna' : '🪱 desparasitación'} <strong>${escHtml(i.item)}</strong> — ${escHtml(fechaBonita(i.proxima_fecha))}</li>`).join('');
  const cuerpo = items.length
    ? `<p>Hola ${escHtml(usuario.nombre)}, se acercan estas dosis:</p><ul style="padding-left:18px">${filas}</ul>`
    : `<p>Hola ${escHtml(usuario.nombre)}, este es un correo de prueba. No tienes dosis pendientes en los próximos ${DIAS_AVISO} días. 🎉</p>`;
  await enviarCorreo({
    para: usuario.email,
    asunto: items.length ? `🐾 Recordatorio: ${items.length === 1 ? 'una dosis se acerca' : `${items.length} dosis se acercan`}` : '🐾 Recordatorios de MasoPet activados',
    html: plantilla('Recordatorio de vacunas y desparasitaciones', `${cuerpo}${boton(`${urlPublica()}/mascotas.html`, 'Ver mis mascotas')}
      <p style="color:#64748b;font-size:13px">Puedes desactivar estos correos en “Mi cuenta”.</p>`),
    texto: items.map((i) => `${i.mascota}: ${i.item} — ${i.proxima_fecha}`).join('\n') || 'Sin dosis pendientes.',
  });
}

export async function revisarRecordatorios() {
  const yaEnviado = db.prepare('SELECT 1 FROM recordatorios_enviados WHERE tabla = ? AND registro_id = ? AND proxima_fecha = ?');
  const marcar = db.prepare('INSERT OR IGNORE INTO recordatorios_enviados (tabla, registro_id, proxima_fecha) VALUES (?, ?, ?)');
  for (const usuario of db.prepare('SELECT id, nombre, email FROM usuarios WHERE recordatorios = 1 AND verificado = 1').all()) {
    const nuevos = proximasDosis(usuario.id).filter((i) => !yaEnviado.get(i.tabla, i.id, i.proxima_fecha));
    if (!nuevos.length) continue;
    try {
      await enviarRecordatorio(usuario, nuevos);
      for (const i of nuevos) {
        marcar.run(i.tabla, i.id, i.proxima_fecha);
        notificar([usuario.id], `${i.tabla === 'vacunas' ? '💉' : '🪱'} ${i.mascota}: toca ${i.tabla === 'vacunas' ? 'la vacuna' : 'la desparasitación'} ${i.item} el ${fechaBonita(i.proxima_fecha)}`, `ficha.html?id=${i.mascota_id}`);
      }
    } catch (err) {
      console.error(`No se pudo enviar el recordatorio a ${usuario.email}:`, err.message);
    }
  }
}

export function iniciarRecordatorios() {
  const ejecutar = () => revisarRecordatorios().catch((err) => console.error('Error en recordatorios:', err));
  setTimeout(ejecutar, 5000);
  setInterval(ejecutar, CADA_HORAS * 3600e3);
}
