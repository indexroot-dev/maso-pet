import { Router } from 'express';
import { db } from '../db.js';
import { requiereLogin } from './auth.js';

export const notificacionesRouter = Router();
notificacionesRouter.use(requiereLogin);

export const noLeidas = (usuarioId) =>
  db.prepare('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ? AND leida = 0').get(usuarioId).n;

notificacionesRouter.get('/', (req, res) => {
  res.json(db.prepare('SELECT id, texto, enlace, leida, creado_en FROM notificaciones WHERE usuario_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.usuario.id));
});

notificacionesRouter.get('/contador', (req, res) => {
  res.json({ no_leidas: noLeidas(req.usuario.id) });
});

notificacionesRouter.post('/leidas', (req, res) => {
  db.prepare('UPDATE notificaciones SET leida = 1 WHERE usuario_id = ? AND leida = 0').run(req.usuario.id);
  res.status(204).end();
});

notificacionesRouter.delete('/', (req, res) => {
  db.prepare('DELETE FROM notificaciones WHERE usuario_id = ?').run(req.usuario.id);
  res.status(204).end();
});
