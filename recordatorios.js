import { db } from './db.js';
import { fechaLocal, urlPublica } from './config.js';
import { enviarCorreo, plantilla, boton, escHtml } from './correo.js';
import { notificar } from './notificaciones.js';
import { SQL_MIS_MASCOTAS } from './tutores.js';

const DIAS_AVISO = 7;          // vacunas y desparasitaciones: se avisa una semana antes
const REVISAR_CADA_MIN = 60;   // cada cuánto se revisan los recordatorios
const DESDE_HORA = 8;          // solo se avisa entre las 8:00 y las 21:59 (no de madrugada)
const HASTA_HORA = 21;

// Próximas dosis de las mascotas de un usuario (propias o como tutor). Solo cuenta la dosis más reciente de cada vacuna/producto.
export function proximasDosis(usuarioId, dias = DIAS_AVISO) {
  const desde = fechaLocal();
  const hasta = fechaLocal(dias);
  const vacunas = db.prepare(`
    SELECT 'vacunas' AS tabla, v.id, v.nombre AS item, v.proxima_fecha, m.nombre AS mascota, m.id AS mascota_id
    FROM vacunas v JOIN mascotas m ON m.id = v.mascota_id
    WHERE m.id IN (${SQL_MIS_MASCOTAS}) AND v.proxima_fecha BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM vacunas v2 WHERE v2.mascota_id = v.mascota_id AND v2.nombre = v.nombre AND v2.fecha > v.fecha)
  `).all(usuarioId, usuarioId, desde, hasta);
  const desparasitaciones = db.prepare(`
    SELECT 'desparasitaciones' AS tabla, d.id, d.producto AS item, d.proxima_fecha, m.nombre AS mascota, m.id AS mascota_id
    FROM desparasitaciones d JOIN mascotas m ON m.id = d.mascota_id
    WHERE m.id IN (${SQL_MIS_MASCOTAS}) AND d.proxima_fecha BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM desparasitaciones d2 WHERE d2.mascota_id = d.mascota_id AND d2.producto = d.producto AND d2.fecha > d.fecha)
  `).all(usuarioId, usuarioId, desde, hasta);
  return [...vacunas, ...desparasitaciones].sort((a, b) => a.proxima_fecha.localeCompare(b.proxima_fecha));
}

// Citas al veterinario de hoy y mañana: se avisa la víspera y el mismo día.
// "aviso" distingue los dos avisos de una misma cita para no repetirlos.
export function citasProximas(usuarioId) {
  const hoy = fechaLocal();
  return db.prepare(`
    SELECT 'citas' AS tabla, c.id, c.motivo AS item, c.hora, c.veterinario, c.fecha AS proxima_fecha, m.nombre AS mascota, m.id AS mascota_id
    FROM citas c JOIN mascotas m ON m.id = c.mascota_id
    WHERE m.id IN (${SQL_MIS_MASCOTAS}) AND c.fecha BETWEEN ? AND ?
    ORDER BY c.fecha, c.hora
  `).all(usuarioId, usuarioId, hoy, fechaLocal(1))
    .map((c) => ({ ...c, aviso: `${c.proxima_fecha}@${c.proxima_fecha === hoy ? 'hoy' : 'vispera'}` }));
}

// Medicamentos que tocan hoy: en curso (entre inicio y término) y hoy es uno de sus días (cada N días desde el inicio)
export function medicamentosDeHoy(usuarioId) {
  const hoy = fechaLocal();
  return db.prepare(`
    SELECT 'medicamentos' AS tabla, x.id, x.nombre AS item, x.dosis, x.horario, ? AS proxima_fecha, m.nombre AS mascota, m.id AS mascota_id
    FROM medicamentos x JOIN mascotas m ON m.id = x.mascota_id
    WHERE m.id IN (${SQL_MIS_MASCOTAS}) AND x.fecha_inicio <= ? AND (x.fecha_fin IS NULL OR x.fecha_fin >= ?)
      AND CAST(julianday(?) - julianday(x.fecha_inicio) AS INTEGER) % x.cada_dias = 0
    ORDER BY m.nombre, x.nombre
  `).all(hoy, usuarioId, usuarioId, hoy, hoy, hoy);
}

// Todo lo que hay que recordarle hoy a un usuario
export function recordatoriosDe(usuarioId) {
  return [...medicamentosDeHoy(usuarioId), ...citasProximas(usuarioId), ...proximasDosis(usuarioId)];
}

const fechaBonita = (iso) => new Date(`${iso}T00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });

// Texto de cada recordatorio, ej: "💊 Amoxicilina (1 comprimido): hoy, 8:00 y 20:00"
function describir(i) {
  switch (i.tabla) {
    case 'medicamentos':
      return { icono: '💊', texto: `toca darle ${i.item}${i.dosis ? ` (${i.dosis})` : ''} hoy${i.horario ? `, ${i.horario}` : ''}` };
    case 'citas': {
      const cuando = i.proxima_fecha === fechaLocal() ? 'hoy' : 'mañana';
      return { icono: '🩺', texto: `cita al veterinario ${cuando}${i.hora ? ` a las ${i.hora}` : ''}: ${i.item}${i.veterinario ? ` (${i.veterinario})` : ''}` };
    }
    case 'vacunas':
      return { icono: '💉', texto: `toca la vacuna ${i.item} el ${fechaBonita(i.proxima_fecha)}` };
    default:
      return { icono: '🪱', texto: `toca la desparasitación ${i.item} el ${fechaBonita(i.proxima_fecha)}` };
  }
}

export async function enviarRecordatorio(usuario, items) {
  const filas = items.map((i) => {
    const { icono, texto } = describir(i);
    return `<li style="margin-bottom:8px">${icono} <strong>${escHtml(i.mascota)}</strong>: ${escHtml(texto)}</li>`;
  }).join('');
  const cuerpo = items.length
    ? `<p>Hola ${escHtml(usuario.nombre)}, no olvides:</p><ul style="padding-left:18px;list-style:none">${filas}</ul>`
    : `<p>Hola ${escHtml(usuario.nombre)}, este es un correo de prueba. Hoy no tienes recordatorios pendientes. 🎉</p>`;
  await enviarCorreo({
    para: usuario.email,
    asunto: items.length ? `🐾 ${items.length === 1 ? 'Tienes 1 recordatorio' : `Tienes ${items.length} recordatorios`} para tus mascotas` : '🐾 Recordatorios de MasoPet activados',
    html: plantilla('Recordatorios de tus mascotas', `${cuerpo}${boton(`${urlPublica()}/mascotas.html`, 'Ver mis mascotas')}
      <p style="color:#64748b;font-size:13px">Puedes desactivar estos correos en “Mi cuenta”.</p>`),
    texto: items.map((i) => `${i.mascota}: ${describir(i).texto}`).join('\n') || 'Sin recordatorios pendientes.',
  });
}

export async function revisarRecordatorios() {
  const hora = new Date().getHours();
  if (hora < DESDE_HORA || hora > HASTA_HORA) return;
  // Por persona: si una mascota tiene varios tutores, cada uno recibe su recordatorio
  const yaEnviado = db.prepare('SELECT 1 FROM recordatorios_avisados WHERE usuario_id = ? AND tabla = ? AND registro_id = ? AND proxima_fecha = ?');
  const marcar = db.prepare('INSERT OR IGNORE INTO recordatorios_avisados (usuario_id, tabla, registro_id, proxima_fecha) VALUES (?, ?, ?, ?)');
  for (const usuario of db.prepare('SELECT id, nombre, email FROM usuarios WHERE recordatorios = 1 AND verificado = 1').all()) {
    const nuevos = recordatoriosDe(usuario.id).filter((i) => !yaEnviado.get(usuario.id, i.tabla, i.id, i.aviso || i.proxima_fecha));
    if (!nuevos.length) continue;
    try {
      await enviarRecordatorio(usuario, nuevos);
      for (const i of nuevos) {
        marcar.run(usuario.id, i.tabla, i.id, i.aviso || i.proxima_fecha);
        const { icono, texto } = describir(i);
        notificar([usuario.id], `${icono} ${i.mascota}: ${texto}`, `ficha.html?id=${i.mascota_id}`);
      }
    } catch (err) {
      console.error(`No se pudo enviar el recordatorio a ${usuario.email}:`, err.message);
    }
  }
}

export function iniciarRecordatorios() {
  const ejecutar = () => revisarRecordatorios().catch((err) => console.error('Error en recordatorios:', err));
  setTimeout(ejecutar, 5000);
  setInterval(ejecutar, REVISAR_CADA_MIN * 60e3);
}
