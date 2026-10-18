import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const carpetaDatos = path.join(__dirname, 'data');
fs.mkdirSync(carpetaDatos, { recursive: true });

export const db = new DatabaseSync(path.join(carpetaDatos, 'masopet.db'));

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lugares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    categoria TEXT NOT NULL,
    direccion TEXT,
    descripcion TEXT,
    mascotas_admitidas TEXT NOT NULL DEFAULT 'todas',
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mascotas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    especie TEXT NOT NULL,
    raza TEXT,
    sexo TEXT,
    fecha_nacimiento TEXT,
    color TEXT,
    peso REAL,
    microchip TEXT,
    esterilizado INTEGER NOT NULL DEFAULT 0,
    alergias TEXT,
    condiciones TEXT,
    notas TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vacunas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    fecha TEXT NOT NULL,
    proxima_fecha TEXT,
    veterinario TEXT,
    notas TEXT
  );

  CREATE TABLE IF NOT EXISTS desparasitaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
    producto TEXT NOT NULL,
    tipo TEXT,
    fecha TEXT NOT NULL,
    proxima_fecha TEXT,
    notas TEXT
  );

  CREATE TABLE IF NOT EXISTS consultas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
    fecha TEXT NOT NULL,
    motivo TEXT NOT NULL,
    diagnostico TEXT,
    tratamiento TEXT,
    veterinario TEXT,
    peso REAL
  );

  -- Libro de control: anotaciones del día a día (peso, alimentación, medicamentos, síntomas…)
  CREATE TABLE IF NOT EXISTS libro (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
    fecha TEXT NOT NULL,
    tipo TEXT NOT NULL,
    titulo TEXT NOT NULL,
    detalle TEXT,
    peso REAL
  );

  CREATE TABLE IF NOT EXISTS resenas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lugar_id INTEGER NOT NULL REFERENCES lugares(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    estrellas INTEGER NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
    comentario TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (lugar_id, usuario_id)
  );

  CREATE TABLE IF NOT EXISTS favoritos (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    lugar_id INTEGER NOT NULL REFERENCES lugares(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, lugar_id)
  );

  -- Enlaces temporales para que el veterinario vea la ficha sin crear cuenta
  CREATE TABLE IF NOT EXISTS compartidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expira INTEGER NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS perdidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    fecha TEXT NOT NULL,
    descripcion TEXT,
    contacto TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    estado TEXT NOT NULL DEFAULT 'perdida',
    encontrada_en TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS restablecimientos (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira INTEGER NOT NULL
  );

  -- Evita enviar dos veces el mismo recordatorio de vacuna/desparasitación
  CREATE TABLE IF NOT EXISTS recordatorios_enviados (
    tabla TEXT NOT NULL,
    registro_id INTEGER NOT NULL,
    proxima_fecha TEXT NOT NULL,
    enviado_en TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tabla, registro_id, proxima_fecha)
  );
`);

// Columnas agregadas después de la primera versión (bases de datos existentes)
function agregarColumna(tabla, columna, definicion) {
  const existe = db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === columna);
  if (!existe) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
}
agregarColumna('mascotas', 'foto', 'TEXT');
agregarColumna('usuarios', 'recordatorios', 'INTEGER NOT NULL DEFAULT 1');
agregarColumna('usuarios', 'rol', "TEXT NOT NULL DEFAULT 'usuario'");
agregarColumna('usuarios', 'bloqueado', 'INTEGER NOT NULL DEFAULT 0');
// Contenido oculto automáticamente por reportes, a la espera de revisión
agregarColumna('lugares', 'oculto', 'INTEGER NOT NULL DEFAULT 0');
agregarColumna('resenas', 'oculto', 'INTEGER NOT NULL DEFAULT 0');
agregarColumna('perdidas', 'oculto', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
  CREATE TABLE IF NOT EXISTS reportes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    objeto_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    motivo TEXT NOT NULL,
    detalle TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    resuelto_en TEXT,
    UNIQUE (tipo, objeto_id, usuario_id)
  );
  CREATE INDEX IF NOT EXISTS reportes_pendientes ON reportes (estado, tipo, objeto_id);

  -- Paseos en compañía. La zona del perfil se guarda aproximada (~1 km), nunca la dirección.
  CREATE TABLE IF NOT EXISTS perfiles_paseo (
    usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    activo INTEGER NOT NULL DEFAULT 1,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    descripcion TEXT,
    horarios TEXT,
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS perfil_paseo_mascotas (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, mascota_id)
  );

  CREATE TABLE IF NOT EXISTS paseos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organizador_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    descripcion TEXT,
    fecha TEXT NOT NULL,
    hora TEXT NOT NULL,
    punto TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    cupo INTEGER,
    privado INTEGER NOT NULL DEFAULT 0,
    cancelado INTEGER NOT NULL DEFAULT 0,
    oculto INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS paseo_participantes (
    paseo_id INTEGER NOT NULL REFERENCES paseos(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    estado TEXT NOT NULL, -- 'va' o 'invitado'
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (paseo_id, usuario_id)
  );

  CREATE TABLE IF NOT EXISTS paseo_comentarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paseo_id INTEGER NOT NULL REFERENCES paseos(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    oculto INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  -- Adopciones (puede vincularse a una mascota registrada para mostrar su ficha de salud)
  CREATE TABLE IF NOT EXISTS adopciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    mascota_id INTEGER REFERENCES mascotas(id) ON DELETE SET NULL,
    nombre TEXT NOT NULL,
    especie TEXT NOT NULL,
    raza TEXT,
    sexo TEXT,
    edad TEXT,
    tamano TEXT,
    caracter TEXT,
    esterilizado INTEGER NOT NULL DEFAULT 0,
    vacunado INTEGER NOT NULL DEFAULT 0,
    descripcion TEXT,
    requisitos TEXT,
    publicador TEXT NOT NULL DEFAULT 'persona',
    organizacion TEXT,
    contacto TEXT NOT NULL,
    comuna TEXT,
    lat REAL,
    lng REAL,
    foto TEXT,
    estado TEXT NOT NULL DEFAULT 'disponible',
    oculto INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS solicitudes_adopcion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adopcion_id INTEGER NOT NULL REFERENCES adopciones(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    mensaje TEXT NOT NULL,
    telefono TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (adopcion_id, usuario_id)
  );

  -- Paseadores y cuidadores (un perfil por usuario)
  CREATE TABLE IF NOT EXISTS perfiles_cuidador (
    usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    activo INTEGER NOT NULL DEFAULT 1,
    foto TEXT,
    servicios TEXT NOT NULL,
    especies TEXT,
    tamanos TEXT,
    horarios TEXT,
    tarifa TEXT,
    descripcion TEXT,
    contacto TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    cobertura_km INTEGER NOT NULL DEFAULT 5,
    oculto INTEGER NOT NULL DEFAULT 0,
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS resenas_cuidador (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cuidador_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    estrellas INTEGER NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
    comentario TEXT,
    oculto INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (cuidador_id, usuario_id)
  );

  -- Eventos pet-friendly
  CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    tipo TEXT NOT NULL,
    descripcion TEXT,
    fecha TEXT NOT NULL,
    hora_inicio TEXT NOT NULL,
    hora_fin TEXT,
    lugar TEXT NOT NULL,
    direccion TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    gratuito INTEGER NOT NULL DEFAULT 1,
    precio TEXT,
    organizador TEXT,
    enlace TEXT,
    cancelado INTEGER NOT NULL DEFAULT 0,
    oculto INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS eventos_asistentes (
    evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    PRIMARY KEY (evento_id, usuario_id)
  );
`);

// Datos de la mascota útiles para pasear en grupo
agregarColumna('mascotas', 'tamano', 'TEXT');
agregarColumna('mascotas', 'caracter', 'TEXT');

// Foto y horario de los lugares del mapa
agregarColumna('lugares', 'foto', 'TEXT');
agregarColumna('lugares', 'horario', 'TEXT');

// Zona del usuario (aproximada, ~1 km) para avisarle de mascotas perdidas cerca
agregarColumna('usuarios', 'zona_lat', 'REAL');
agregarColumna('usuarios', 'zona_lng', 'REAL');
agregarColumna('usuarios', 'avisos_cerca', 'INTEGER NOT NULL DEFAULT 1');

// Verificación del correo con un código al crear la cuenta.
// DEFAULT 1: las cuentas que ya existían quedan verificadas; las nuevas se crean con 0.
agregarColumna('usuarios', 'verificado', 'INTEGER NOT NULL DEFAULT 1');
db.exec(`
  CREATE TABLE IF NOT EXISTS verificaciones (
    usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    codigo_hash TEXT NOT NULL,
    expira INTEGER NOT NULL,
    intentos INTEGER NOT NULL DEFAULT 0
  );
`);

// Ajustes generales que el administrador cambia desde el panel (ej: enlace de donaciones)
db.exec('CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT)');

// Notificaciones dentro de la app (la campanita del menú)
db.exec(`
  CREATE TABLE IF NOT EXISTS notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    enlace TEXT,
    leida INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS notificaciones_usuario ON notificaciones (usuario_id, leida);
`);

// Lugares de ejemplo (ficticios) para que el mapa no parta vacío
const { total } = db.prepare('SELECT COUNT(*) AS total FROM lugares').get();
if (total === 0) {
  const insertar = db.prepare(`
    INSERT INTO lugares (nombre, categoria, direccion, descripcion, mascotas_admitidas, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const ejemplos = [
    ['Café Patitas', 'cafe', 'Providencia, Santiago', 'Lugar de ejemplo. Terraza con bebederos para perros.', 'todas', -33.4262, -70.6110],
    ['Parque Huellitas', 'parque', 'Vitacura, Santiago', 'Lugar de ejemplo. Zona cercada para que los perros corran sueltos.', 'perros', -33.3990, -70.5990],
    ['Hotel Cola Feliz', 'hotel', 'Santiago Centro', 'Lugar de ejemplo. Habitaciones pet-friendly con cama para mascotas.', 'todas', -33.4410, -70.6510],
    ['Restaurante El Hueso', 'restaurante', 'Ñuñoa, Santiago', 'Lugar de ejemplo. Admite mascotas en la terraza.', 'perros', -33.4560, -70.5970],
    ['Tienda Bigotes', 'tienda', 'Las Condes, Santiago', 'Lugar de ejemplo. Puedes entrar con tu mascota con correa.', 'todas', -33.4130, -70.5800],
    ['Clínica Veterinaria Ejemplo', 'veterinaria', 'La Reina, Santiago', 'Lugar de ejemplo. Atención de urgencias 24 horas.', 'todas', -33.4450, -70.5500],
  ];
  for (const fila of ejemplos) insertar.run(...fila);
}
