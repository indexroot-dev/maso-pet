import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUERTO, urlPublica } from './config.js';
import { db } from './db.js';
import { correoConfigurado } from './correo.js';
import { CARPETA_FOTOS } from './fotos.js';
import { iniciarRecordatorios } from './recordatorios.js';
import { authRouter, cargarUsuario } from './routes/auth.js';
import { lugaresRouter } from './routes/lugares.js';
import { mascotasRouter } from './routes/mascotas.js';
import { compartidoRouter } from './routes/compartido.js';
import { perdidasRouter } from './routes/perdidas.js';
import { reportesRouter } from './routes/reportes.js';
import { adminRouter } from './routes/admin.js';
import { paseosRouter } from './routes/paseos.js';
import { adopcionesRouter } from './routes/adopciones.js';
import { cuidadoresRouter } from './routes/cuidadores.js';
import { eventosRouter } from './routes/eventos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Detrás de un proxy (Cloudflare Tunnel): req.ip toma la IP real del visitante
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

// Las fotos llegan en base64, por eso esas rutas aceptan cuerpos más grandes
const jsonNormal = express.json({ limit: '100kb' });
const jsonFotos = express.json({ limit: '5mb' });
const RUTAS_CON_FOTO = /^\/api\/(mascotas\/\d+\/foto|adopciones(\/\d+)?|cuidadores\/perfil)$/;
app.use((req, res, next) => (RUTAS_CON_FOTO.test(req.path) ? jsonFotos : jsonNormal)(req, res, next));
app.use(cargarUsuario);

app.get('/api/info', (req, res) => res.json({ urlApp: urlPublica() }));

// Contador público de la portada (solo el total, guardado 1 minuto en memoria)
let estadisticas = { usuarios: 0, calculado: 0 };
app.get('/api/estadisticas', (req, res) => {
  if (Date.now() - estadisticas.calculado > 60_000) {
    estadisticas = { usuarios: db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE bloqueado = 0').get().n, calculado: Date.now() };
  }
  res.set('Cache-Control', 'public, max-age=60').json({ usuarios: estadisticas.usuarios });
});
app.use('/api/auth', authRouter);
app.use('/api/lugares', lugaresRouter);
app.use('/api/mascotas', mascotasRouter);
app.use('/api/compartido', compartidoRouter);
app.use('/api/perdidas', perdidasRouter);
app.use('/api/reportes', reportesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/paseos', paseosRouter);
app.use('/api/adopciones', adopcionesRouter);
app.use('/api/cuidadores', cuidadoresRouter);
app.use('/api/eventos', eventosRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.use('/fotos', express.static(CARPETA_FOTOS, {
  maxAge: '30d',
  immutable: true,
  setHeaders: (res) => res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }),
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande' });
  console.error(err);
  res.status(err.status || 500).json({ error: err.status === 400 ? 'Datos inválidos' : 'Error interno del servidor' });
});

app.listen(PUERTO, () => {
  console.log(`🐾 MasoPet funcionando en http://localhost:${PUERTO}`);
  console.log(`📱 Desde el celular (misma red WiFi): ${urlPublica()}`);
  if (!correoConfigurado) console.log('✉️  Sin SMTP configurado: los correos se guardan en data/correos (ver .env.example)');
  iniciarRecordatorios();
});
