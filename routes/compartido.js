import { Router } from 'express';
import { db } from '../db.js';
import { fichaCompleta } from './mascotas.js';

// Ruta pública: el veterinario abre la ficha con el enlace, sin crear cuenta
export const compartidoRouter = Router();

compartidoRouter.get('/:token', (req, res) => {
  const enlace = db.prepare('SELECT mascota_id, expira FROM compartidos WHERE token = ? AND expira > ?')
    .get(String(req.params.token), Date.now());
  if (!enlace) return res.status(404).json({ error: 'Este enlace no existe o ya venció. Pide al tutor que comparta uno nuevo.' });

  const mascota = db.prepare(`
    SELECT m.*, u.nombre AS tutor FROM mascotas m JOIN usuarios u ON u.id = m.usuario_id WHERE m.id = ?
  `).get(enlace.mascota_id);
  const { usuario_id, ...ficha } = fichaCompleta(mascota);
  res.set('Cache-Control', 'no-store').json({ ...ficha, expira: enlace.expira });
});
