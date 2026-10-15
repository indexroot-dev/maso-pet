# 🐾 MasoPet

Aplicación web para:

- **Encontrar lugares pet-friendly** en un mapa (restaurantes, cafés, hoteles, parques, playas, tiendas, veterinarias): filtrar por categoría, buscar, ordenar por cercanía o por valoración y ver cómo llegar.
- **Reseñas y estrellas** de cada lugar, y **lugares favoritos**.
- **Mascotas perdidas**: avisos con foto, contacto y el lugar donde se vio por última vez, también visibles en el mapa.
- **Ficha clínica** de cada mascota, con foto: datos generales, vacunas, desparasitaciones y consultas, con recordatorios de próximas dosis.
- **Compartir la ficha con el veterinario** mediante un enlace o QR temporal de solo lectura (no necesita cuenta).
- **Libro de control**: anotaciones del día a día (peso, alimentación, medicamentos, paseos, síntomas…) y gráfico de evolución del peso.
- **Recordatorios por correo** 7 días antes de cada vacuna o desparasitación.
- **Cuentas de usuario** con recuperación y cambio de contraseña. El mapa y las fichas son solo para usuarios registrados.
- **Paseos en compañía**: perfil de paseo opcional con zona aproximada (~1 km), vecinos cercanos con sus mascotas (tamaño y carácter), paseos grupales públicos o privados con cupo, invitaciones y conversación de cada paseo. Avisos por correo al invitar, al unirse y al cancelar.
- **Adopciones**: personas y refugios publican mascotas en adopción (con su ficha de salud si están registradas); los interesados envían una solicitud que llega por correo; estados disponible, en proceso y adoptado.
- **Paseadores y cuidadores**: perfiles de servicios (paseos, cuidado, visitas, guardería) con tarifa, zona aproximada y cobertura; búsqueda por cercanía o valoración, mensajes por correo y reseñas con estrellas.
- **Eventos pet-friendly**: ferias, vacunaciones, encuentros, jornadas de adopción y talleres, con filtro por tipo y botón "Asistiré".
- **Reportes y moderación**: los usuarios reportan cualquier contenido publicado; con 3 reportes el contenido se oculta solo hasta que un administrador lo revise.
- **Panel de administración**: resumen de la app, revisión de reportes, gestión de usuarios (bloquear, nombrar administradores, borrar su contenido) y de todo el contenido publicado.

## Requisitos

- [Node.js](https://nodejs.org) 22.13 o superior (usa la base de datos SQLite integrada en Node).

## Cómo ejecutarla

```bash
npm install
npm start
```

Abre <http://localhost:3000> en el navegador.

Para desarrollo (se reinicia sola al guardar cambios): `npm run dev`

## Administradores

Para nombrar administrador a un usuario ya registrado:

```bash
npm run admin -- correo@ejemplo.cl
```

Luego esa persona debe cerrar sesión y volver a entrar. Verá **🛡️ Admin** en el menú (`/admin.html`). Desde el panel se pueden nombrar otros administradores.

## Correos (recordatorios y recuperar contraseña)

Copia `.env.example` como `.env` y completa los datos SMTP (por ejemplo, Gmail con una contraseña de aplicación). Luego reinicia la app.

Mientras no haya SMTP configurado, los correos **no se envían**: se guardan como archivos HTML en `data/correos/` y su enlace aparece en la consola, para poder probar todo en local.

## Estructura

```
server.js              Servidor Express
config.js              Puerto, URL pública, fechas y límite de intentos
db.js                  Base de datos SQLite (data/masopet.db) y lugares de ejemplo
correo.js              Envío de correos (SMTP o archivos en data/correos)
recordatorios.js       Revisión periódica de próximas dosis y envío de avisos
fotos.js               Guardado de fotos de mascotas (data/fotos)
routes/auth.js         Registro, sesiones, contraseña y preferencias
routes/lugares.js      Lugares, reseñas y favoritos
routes/mascotas.js     Mascotas, ficha clínica, libro, foto y enlaces compartidos
routes/compartido.js   Ficha pública para el veterinario (con enlace temporal)
routes/perdidas.js     Avisos de mascotas perdidas
routes/paseos.js       Perfil de paseo, vecinos cercanos, paseos grupales y su conversación
routes/adopciones.js   Publicaciones de adopción y solicitudes
routes/cuidadores.js   Perfiles de paseadores/cuidadores, búsqueda, mensajes y reseñas
routes/eventos.js      Eventos pet-friendly y asistencia
routes/reportes.js     Reportar contenido
routes/admin.js        API del panel de administración
moderacion.js          Reglas de reportes: motivos, ocultado automático, eliminar/mantener
scripts/admin.js       Nombrar administrador desde la terminal
public/                Páginas web
```

## API

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/registro` · `/login` · `/logout` | Cuenta y sesión |
| GET | `/api/auth/me` | Usuario actual |
| POST | `/api/auth/olvide` · `/restablecer` | Recuperar contraseña por correo |
| PUT | `/api/auth/password` · `/preferencias` | Cambiar contraseña · activar/desactivar recordatorios |
| POST | `/api/auth/recordatorio-prueba` | Enviar un correo de recordatorio de prueba |
| GET/POST | `/api/lugares?categoria=&q=&favoritos=1` | Listar (con promedio de estrellas) / agregar lugar |
| DELETE | `/api/lugares/:id` | Eliminar un lugar propio |
| GET/PUT/DELETE | `/api/lugares/:id/resenas` | Ver reseñas / publicar o editar la propia / borrarla |
| PUT/DELETE | `/api/lugares/:id/favorito` | Guardar / quitar de favoritos |
| GET/POST | `/api/mascotas` | Listar / crear mascotas |
| GET/PUT/DELETE | `/api/mascotas/:id` | Ficha completa / editar / eliminar |
| PUT/DELETE | `/api/mascotas/:id/foto` | Subir (`{imagen: dataURL}`) / quitar foto |
| POST | `/api/mascotas/:id/{vacunas\|desparasitaciones\|consultas\|libro}` | Agregar registro clínico o anotación del libro |
| DELETE | `/api/mascotas/:id/{seccion}/:registroId` | Eliminar registro |
| GET/POST/DELETE | `/api/mascotas/:id/compartir[/:enlaceId]` | Enlaces temporales para el veterinario |
| GET | `/api/compartido/:token` | Ficha de solo lectura (pública, con token) |
| GET/POST | `/api/perdidas` | Avisos activos y reencuentros / publicar aviso |
| PUT/DELETE | `/api/perdidas/:id/encontrada` · `/api/perdidas/:id` | Marcar como encontrada / eliminar aviso |
| GET/PUT | `/api/paseos/perfil` | Mi perfil de paseo `{activo, lat, lng, horarios[], mascotas[], descripcion}` |
| GET | `/api/paseos/vecinos?radio=` | Vecinos con perfil activo (1, 3, 5, 10 o 20 km) |
| GET/POST | `/api/paseos` | Próximos paseos cerca / organizar uno (`invitados[]`, `privado`, `cupo`) |
| GET/DELETE | `/api/paseos/:id` | Detalle con participantes y conversación / cancelar (organizador) |
| POST/DELETE | `/api/paseos/:id/unirme` | Unirse / dejar de ir |
| POST | `/api/paseos/:id/invitar` · `/api/paseos/:id/comentarios` | Invitar a un vecino · escribir en la conversación |
| GET/POST | `/api/adopciones?especie=&tamano=&estado=&lat=&lng=` | Listar / publicar (`mascota_id` opcional para incluir su ficha, `imagen` en base64) |
| GET/PUT/DELETE | `/api/adopciones/:id` | Detalle (con salud y, para quien publicó, solicitudes) / editar o cambiar estado / eliminar |
| POST | `/api/adopciones/:id/solicitudes` | "Me interesa adoptar" `{mensaje, telefono}` |
| GET/PUT | `/api/cuidadores/perfil` | Mi perfil de paseador/cuidador |
| GET | `/api/cuidadores?servicio=&especie=&radio=&orden=&lat=&lng=` | Buscar cuidadores |
| GET | `/api/cuidadores/:id` | Perfil con reseñas y contacto |
| POST | `/api/cuidadores/:id/mensaje` | Enviar mensaje por correo |
| PUT/DELETE | `/api/cuidadores/:id/resenas` | Publicar o editar / borrar mi reseña |
| GET/POST | `/api/eventos?tipo=&lat=&lng=` | Próximos eventos / publicar |
| PUT/DELETE | `/api/eventos/:id` | Editar o cancelar / eliminar (quien publicó) |
| PUT/DELETE | `/api/eventos/:id/asistire` | Marcar / desmarcar asistencia |
| POST | `/api/reportes` | Reportar `{tipo, objeto_id, motivo, detalle}` (tipo: lugar, resena, perdida, paseo, comentario, adopcion, cuidador, resena_cuidador o evento) |
| GET | `/api/admin/resumen` · `/reportes` · `/usuarios?q=` · `/contenido/:tipo?q=` | Panel (solo administradores) |
| POST | `/api/admin/reportes/:tipo/:id` | `{accion: eliminar|mantener}` |
| PUT/DELETE | `/api/admin/usuarios/:id` · `/api/admin/usuarios/:id/contenido` | Bloquear / cambiar rol · borrar su contenido público |
| DELETE | `/api/admin/contenido/:tipo/:id` | Eliminar contenido |

Todas las rutas, salvo registro, login, recuperar contraseña y la ficha compartida, requieren sesión.

## Notas

- Los lugares precargados son **ficticios** (de ejemplo, en Santiago) para que el mapa no aparezca vacío. Puedes quitarlos en `db.js`.
- Las contraseñas se guardan con `scrypt`, las sesiones con cookies `HttpOnly` y hay límite de intentos en login, registro y recuperación.
- Las fotos se guardan con nombres aleatorios en `data/fotos`. Respalda la carpeta `data/` completa.
- Antes de publicarla en internet: usar HTTPS (`NODE_ENV=production` activa cookies `Secure`) y definir `PUBLIC_URL`.

## Instalar en el celular (QR)

La portada muestra un código QR para abrir MasoPet en el celular e instalarla como app (PWA), sin pasar por ninguna tienda de aplicaciones.

- **En tu red local:** el QR apunta automáticamente a la IP de este computador (ej. `http://192.168.x.x:3000`). El celular debe estar en la misma red WiFi, y puede que tengas que permitir Node.js en el Firewall de Windows.
- **Publicada en internet:** define `PUBLIC_URL` con tu dominio (ej. `PUBLIC_URL=https://masopet.cl`). Para que la instalación completa funcione en Android, el sitio debe usar HTTPS.

## App para Android (APK)

La carpeta `android/` contiene una app nativa mínima que abre MasoPet en pantalla completa (WebView): con ícono propio, subida de fotos, permiso de ubicación y enlaces de teléfono, WhatsApp y mapas que se abren en su app.

Para construirla (necesita Android Studio instalado, no usa Gradle):

```powershell
powershell -ExecutionPolicy Bypass -File android\construir-apk.ps1
# o apuntando a otro servidor / nueva versión:
powershell -ExecutionPolicy Bypass -File android\construir-apk.ps1 -Url https://masopet.cl -Version 1.1 -Codigo 2
```

El resultado queda en `android/MasoPet.apk` y en `public/descargas/MasoPet.apk`, y la portada muestra el botón **"Descargar app para Android"**.

- La app solo muestra la web: **el servidor debe estar encendido** y, en la versión local, el celular debe estar en la **misma red WiFi**.
- La **llave de firma** se crea la primera vez en `android/firma/`. **Respáldala**: Android solo acepta actualizaciones firmadas con la misma llave.
- Para cada versión nueva, sube `-Codigo` (2, 3, 4…).
