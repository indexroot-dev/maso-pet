import { Router } from 'express';
import { db } from '../db.js';
import { limitador } from '../config.js';
import { MOTIVOS, TIPOS, vistaPrevia, revisarUmbral } from '../moderacion.js';
import { requiereLogin } from './auth.js';

export const reportesRouter = Router();
reportesRouter.use(requiereLogin);

reportesRouter.post('/', limitador({ max: 20, minutos: 60 }), async (req, res) => {
  const { tipo, motivo } = req.body || {};
  const objetoId = Number(req.body?.objeto_id);
  if (!TIPOS[tipo]) return res.status(400).json({ error: 'No se puede reportar esto' });
  if (!MOTIVOS[motivo]) return res.status(400).json({ error: 'Elige un motivo' });

  const objeto = vistaPrevia(tipo, objetoId);
  if (!objeto || objeto.oculto) return res.status(404).json({ error: 'El contenido ya no está disponible' });
  if (objeto.autor_id === req.usuario.id) return res.status(400).json({ error: 'No puedes reportar tu propio contenido' });

  const detalle = String(req.body?.detalle ?? '').trim().slice(0, 1000) || null;
  const { changes } = db.prepare(`
    INSERT OR IGNORE INTO reportes (tipo, objeto_id, usuario_id, motivo, detalle) VALUES (?, ?, ?, ?, ?)
  `).run(tipo, objetoId, req.usuario.id, motivo, detalle);
  if (!changes) return res.status(409).json({ error: 'Ya reportaste este contenido. Lo revisaremos pronto.' });

  const ocultado = await revisarUmbral(tipo, objetoId);
  res.status(201).json({ mensaje: 'Gracias por avisarnos. Un administrador lo revisará.', ocultado });
});
