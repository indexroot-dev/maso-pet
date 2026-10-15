import { Router } from 'express';
import { db } from '../db.js';
import { requiereLogin } from './auth.js';

const texto = (valor, max) => String(valor ?? '').trim().slice(0, max) || null;
const DIAS_REENCUENTROS = 14;

export const perdidasRouter = Router();
perdidasRouter.use(requiereLogin);

// Avisos activos y reencuentros recientes
perdidasRouter.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT p.*, m.nombre, m.especie, m.raza, m.sexo, m.color, m.foto, u.nombre AS tutor, (p.usuario_id = ?) AS propia
    FROM perdidas p
    JOIN mascotas m ON m.id = p.mascota_id
    JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.oculto = 0 AND (p.estado = 'perdida' OR p.encontrada_en >= datetime('now', ?))
    ORDER BY p.estado = 'perdida' DESC, p.fecha DESC, p.id DESC
  `).all(req.usuario.id, `-${DIAS_REENCUENTROS} days`));
});

perdidasRouter.post('/', (req, res) => {
  const mascota = db.prepare('SELECT id FROM mascotas WHERE id = ? AND usuario_id = ?')
    .get(Number(req.body?.mascota_id), req.usuario.id);
  if (!mascota) return res.status(400).json({ error: 'Elige una de tus mascotas' });
  if (db.prepare("SELECT 1 FROM perdidas WHERE mascota_id = ? AND estado = 'perdida'").get(mascota.id)) {
    return res.status(409).json({ error: 'Esta mascota ya tiene un aviso activo' });
  }

  const fecha = texto(req.body?.fecha, 10);
  const contacto = texto(req.body?.contacto, 120);
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Indica la fecha en que se perdió' });
  if (!contacto) return res.status(400).json({ error: 'Indica un teléfono o forma de contacto' });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'Marca en el mapa dónde se vio por última vez' });
  }

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO perdidas (mascota_id, usuario_id, fecha, descripcion, contacto, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(mascota.id, req.usuario.id, fecha, texto(req.body?.descripcion, 1000), contacto, lat, lng);
  res.status(201).json({ id: Number(lastInsertRowid) });
});

perdidasRouter.put('/:id/encontrada', (req, res) => {
  const { changes } = db.prepare(`
    UPDATE perdidas SET estado = 'encontrada', encontrada_en = datetime('now')
    WHERE id = ? AND usuario_id = ? AND estado = 'perdida'
  `).run(Number(req.params.id), req.usuario.id);
  if (!changes) return res.status(404).json({ error: 'Aviso no encontrado' });
  res.status(204).end();
});

perdidasRouter.delete('/:id', (req, res) => {
  const { changes } = db.prepare('DELETE FROM perdidas WHERE id = ? AND usuario_id = ?').run(Number(req.params.id), req.usuario.id);
  if (!changes) return res.status(404).json({ error: 'Aviso no encontrado' });
  res.status(204).end();
});
