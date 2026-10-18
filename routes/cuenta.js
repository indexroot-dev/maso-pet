import { Router } from 'express';
import { db } from '../db.js';
import { aproximar, coordenadasValidas, fechaLocal } from '../config.js';
import { RADIO_AVISOS_KM } from '../notificaciones.js';
import { requiereLogin } from './auth.js';
import { fichaCompleta } from './mascotas.js';

export const cuentaRouter = Router();
cuentaRouter.use(requiereLogin);

cuentaRouter.put('/nombre', (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre || nombre.length > 100) return res.status(400).json({ error: 'Ingresa tu nombre' });
  db.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').run(nombre, req.usuario.id);
  res.json({ nombre });
});

// ---------- Mi zona (avisos de mascotas perdidas cerca) ----------
cuentaRouter.get('/zona', (req, res) => {
  const u = db.prepare('SELECT zona_lat AS lat, zona_lng AS lng, avisos_cerca FROM usuarios WHERE id = ?').get(req.usuario.id);
  res.json({ zona: u.lat != null ? { lat: u.lat, lng: u.lng } : null, avisos_cerca: u.avisos_cerca, radio_km: RADIO_AVISOS_KM });
});

// Se guarda aproximada (~1 km): sirve para saber qué es "cerca" sin guardar la dirección exacta
cuentaRouter.put('/zona', (req, res) => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const quitar = req.body?.lat === null;
  if (!quitar && !coordenadasValidas(lat, lng)) return res.status(400).json({ error: 'Marca tu zona en el mapa' });
  db.prepare('UPDATE usuarios SET zona_lat = ?, zona_lng = ?, avisos_cerca = ? WHERE id = ?')
    .run(quitar ? null : aproximar(lat), quitar ? null : aproximar(lng), req.body?.avisos_cerca === false ? 0 : 1, req.usuario.id);
  res.status(204).end();
});

// ---------- Descargar mis datos ----------
// Todo lo que la persona ha guardado o publicado, en un archivo. No incluye datos de otras personas.
cuentaRouter.get('/mis-datos', (req, res) => {
  const id = req.usuario.id;
  const todos = (sql) => db.prepare(sql).all(id);
  const datos = {
    descargado_en: new Date().toISOString(),
    cuenta: db.prepare('SELECT nombre, email, creado_en, recordatorios, zona_lat, zona_lng, avisos_cerca FROM usuarios WHERE id = ?').get(id),
    mascotas: todos('SELECT * FROM mascotas WHERE usuario_id = ? ORDER BY nombre').map(fichaCompleta),
    lugares_agregados: todos('SELECT id, nombre, categoria, direccion, descripcion, horario, mascotas_admitidas, lat, lng, creado_en FROM lugares WHERE creado_por = ?'),
    resenas_de_lugares: todos('SELECT l.nombre AS lugar, r.estrellas, r.comentario, r.creado_en FROM resenas r JOIN lugares l ON l.id = r.lugar_id WHERE r.usuario_id = ?'),
    lugares_favoritos: todos('SELECT l.nombre FROM favoritos f JOIN lugares l ON l.id = f.lugar_id WHERE f.usuario_id = ?').map((f) => f.nombre),
    avisos_mascota_perdida: todos('SELECT m.nombre AS mascota, p.fecha, p.descripcion, p.contacto, p.lat, p.lng, p.estado, p.encontrada_en FROM perdidas p JOIN mascotas m ON m.id = p.mascota_id WHERE p.usuario_id = ?'),
    perfil_de_paseo: db.prepare('SELECT activo, lat, lng, descripcion, horarios FROM perfiles_paseo WHERE usuario_id = ?').get(id) || null,
    paseos_organizados: todos('SELECT titulo, descripcion, fecha, hora, punto, cupo, privado, cancelado FROM paseos WHERE organizador_id = ?'),
    mensajes_en_paseos: todos('SELECT p.titulo AS paseo, c.texto, c.creado_en FROM paseo_comentarios c JOIN paseos p ON p.id = c.paseo_id WHERE c.usuario_id = ?'),
    adopciones_publicadas: todos('SELECT nombre, especie, raza, sexo, edad, tamano, caracter, descripcion, requisitos, contacto, comuna, estado, creado_en FROM adopciones WHERE usuario_id = ?'),
    solicitudes_de_adopcion_enviadas: todos('SELECT a.nombre AS mascota, s.mensaje, s.telefono, s.creado_en FROM solicitudes_adopcion s JOIN adopciones a ON a.id = s.adopcion_id WHERE s.usuario_id = ?'),
    perfil_de_cuidador: db.prepare('SELECT activo, servicios, especies, tamanos, horarios, tarifa, descripcion, contacto, lat, lng, cobertura_km FROM perfiles_cuidador WHERE usuario_id = ?').get(id) || null,
    resenas_a_cuidadores: todos('SELECT u.nombre AS cuidador, r.estrellas, r.comentario, r.creado_en FROM resenas_cuidador r JOIN usuarios u ON u.id = r.cuidador_id WHERE r.usuario_id = ?'),
    eventos_publicados: todos('SELECT titulo, tipo, descripcion, fecha, hora_inicio, hora_fin, lugar, direccion, organizador, enlace, cancelado FROM eventos WHERE usuario_id = ?'),
  };
  res.set('Content-Disposition', `attachment; filename="masopet-mis-datos-${fechaLocal()}.json"`);
  res.type('application/json').send(JSON.stringify(datos, null, 2));
});
