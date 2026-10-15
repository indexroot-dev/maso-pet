import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { urlPublica } from '../config.js';
import { guardarFoto, borrarFoto } from '../fotos.js';
import { requiereLogin } from './auth.js';

const CAMPOS_MASCOTA = ['nombre', 'especie', 'raza', 'sexo', 'fecha_nacimiento', 'color', 'peso', 'microchip', 'esterilizado', 'alergias', 'condiciones', 'notas', 'tamano', 'caracter'];

// Secciones del historial clínico. Los nombres de tabla y campos vienen de aquí, nunca del cliente.
const SECCIONES = {
  vacunas: {
    campos: ['nombre', 'fecha', 'proxima_fecha', 'veterinario', 'notas'],
    requeridos: ['nombre', 'fecha'],
    orden: 'fecha DESC',
  },
  desparasitaciones: {
    campos: ['producto', 'tipo', 'fecha', 'proxima_fecha', 'notas'],
    requeridos: ['producto', 'fecha'],
    orden: 'fecha DESC',
  },
  consultas: {
    campos: ['fecha', 'motivo', 'diagnostico', 'tratamiento', 'veterinario', 'peso'],
    requeridos: ['fecha', 'motivo'],
    orden: 'fecha DESC',
  },
  libro: {
    campos: ['fecha', 'tipo', 'titulo', 'detalle', 'peso'],
    requeridos: ['fecha', 'tipo', 'titulo'],
    opciones: { tipo: ['control', 'peso', 'medicamento', 'alimentacion', 'higiene', 'ejercicio', 'comportamiento', 'sintoma', 'otro'] },
    orden: 'fecha DESC, id DESC',
  },
};

function limpiar(campo, valor) {
  if (campo === 'peso') {
    const numero = Number(valor);
    return valor === '' || valor == null || !Number.isFinite(numero) || numero < 0 ? null : numero;
  }
  if (campo === 'esterilizado') return valor === true || valor === 1 || valor === '1' || valor === 'on' ? 1 : 0;
  const texto = String(valor ?? '').trim().slice(0, 2000);
  return texto || null;
}

function extraer(body, campos) {
  return Object.fromEntries(campos.map((c) => [c, limpiar(c, body?.[c])]));
}

function mascotaDelUsuario(req, res) {
  const mascota = db.prepare('SELECT * FROM mascotas WHERE id = ? AND usuario_id = ?')
    .get(Number(req.params.id), req.usuario.id);
  if (!mascota) res.status(404).json({ error: 'Mascota no encontrada' });
  return mascota;
}

export const mascotasRouter = Router();
mascotasRouter.use(requiereLogin);

mascotasRouter.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM mascotas WHERE usuario_id = ? ORDER BY nombre').all(req.usuario.id));
});

mascotasRouter.post('/', (req, res) => {
  const datos = extraer(req.body, CAMPOS_MASCOTA);
  if (!datos.nombre || !datos.especie) return res.status(400).json({ error: 'Nombre y especie son obligatorios' });

  const columnas = ['usuario_id', ...CAMPOS_MASCOTA];
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO mascotas (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`
  ).run(req.usuario.id, ...CAMPOS_MASCOTA.map((c) => datos[c]));

  res.status(201).json(db.prepare('SELECT * FROM mascotas WHERE id = ?').get(lastInsertRowid));
});

// Ficha clínica completa (también la usa el enlace compartido con el veterinario)
export function fichaCompleta(mascota) {
  const ficha = { ...mascota };
  for (const [seccion, { orden }] of Object.entries(SECCIONES)) {
    ficha[seccion] = db.prepare(`SELECT * FROM ${seccion} WHERE mascota_id = ? ORDER BY ${orden}`).all(mascota.id);
  }
  return ficha;
}

mascotasRouter.get('/:id', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  res.json(fichaCompleta(mascota));
});

mascotasRouter.put('/:id', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  const datos = extraer(req.body, CAMPOS_MASCOTA);
  if (!datos.nombre || !datos.especie) return res.status(400).json({ error: 'Nombre y especie son obligatorios' });

  db.prepare(`UPDATE mascotas SET ${CAMPOS_MASCOTA.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...CAMPOS_MASCOTA.map((c) => datos[c]), mascota.id);
  res.json(db.prepare('SELECT * FROM mascotas WHERE id = ?').get(mascota.id));
});

mascotasRouter.delete('/:id', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  db.prepare('DELETE FROM mascotas WHERE id = ?').run(mascota.id);
  borrarFoto(mascota.foto);
  res.status(204).end();
});

// ---------- Foto ----------
mascotasRouter.put('/:id/foto', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  const foto = guardarFoto(req.body?.imagen);
  if (!foto) return res.status(400).json({ error: 'La imagen no es válida (usa JPG, PNG o WebP de menos de 3 MB)' });
  db.prepare('UPDATE mascotas SET foto = ? WHERE id = ?').run(foto, mascota.id);
  borrarFoto(mascota.foto);
  res.json({ foto });
});

mascotasRouter.delete('/:id/foto', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  db.prepare('UPDATE mascotas SET foto = NULL WHERE id = ?').run(mascota.id);
  borrarFoto(mascota.foto);
  res.status(204).end();
});

// ---------- Compartir con el veterinario ----------
const DURACIONES = { 1: '24 horas', 7: '7 días', 30: '30 días' };
const conUrl = (enlace) => ({ ...enlace, url: `${urlPublica()}/compartido.html?t=${enlace.token}` });

mascotasRouter.get('/:id/compartir', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  db.prepare('DELETE FROM compartidos WHERE expira <= ?').run(Date.now());
  res.json(db.prepare('SELECT id, token, expira FROM compartidos WHERE mascota_id = ? ORDER BY expira DESC').all(mascota.id).map(conUrl));
});

mascotasRouter.post('/:id/compartir', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  const dias = Number(req.body?.dias);
  if (!DURACIONES[dias]) return res.status(400).json({ error: 'Duración no válida' });
  const token = crypto.randomBytes(24).toString('base64url');
  const expira = Date.now() + dias * 864e5;
  const { lastInsertRowid } = db.prepare('INSERT INTO compartidos (mascota_id, token, expira) VALUES (?, ?, ?)').run(mascota.id, token, expira);
  res.status(201).json(conUrl({ id: Number(lastInsertRowid), token, expira }));
});

mascotasRouter.delete('/:id/compartir/:enlaceId', (req, res) => {
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;
  db.prepare('DELETE FROM compartidos WHERE id = ? AND mascota_id = ?').run(Number(req.params.enlaceId), mascota.id);
  res.status(204).end();
});

// Registros del historial: /api/mascotas/:id/vacunas, /desparasitaciones, /consultas, /libro
mascotasRouter.post('/:id/:seccion', (req, res) => {
  const config = SECCIONES[req.params.seccion];
  if (!config) return res.status(404).json({ error: 'Sección no válida' });
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;

  const datos = extraer(req.body, config.campos);
  const faltante = config.requeridos.find((c) => !datos[c]);
  if (faltante) return res.status(400).json({ error: `El campo "${faltante.replace('_', ' ')}" es obligatorio` });
  const invalido = Object.entries(config.opciones || {}).find(([c, validos]) => !validos.includes(datos[c]));
  if (invalido) return res.status(400).json({ error: `El valor de "${invalido[0]}" no es válido` });

  const columnas = ['mascota_id', ...config.campos];
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO ${req.params.seccion} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`
  ).run(mascota.id, ...config.campos.map((c) => datos[c]));

  res.status(201).json(db.prepare(`SELECT * FROM ${req.params.seccion} WHERE id = ?`).get(lastInsertRowid));
});

mascotasRouter.delete('/:id/:seccion/:registroId', (req, res) => {
  if (!SECCIONES[req.params.seccion]) return res.status(404).json({ error: 'Sección no válida' });
  const mascota = mascotaDelUsuario(req, res);
  if (!mascota) return;

  const { changes } = db.prepare(`DELETE FROM ${req.params.seccion} WHERE id = ? AND mascota_id = ?`)
    .run(Number(req.params.registroId), mascota.id);
  if (!changes) return res.status(404).json({ error: 'Registro no encontrado' });
  res.status(204).end();
});
