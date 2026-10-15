// Uso: npm run admin -- correo@ejemplo.cl   (nombra administrador a ese usuario)
import { db } from '../db.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.log('Uso: npm run admin -- correo@ejemplo.cl');
  process.exit(1);
}
const { changes } = db.prepare("UPDATE usuarios SET rol = 'admin', bloqueado = 0 WHERE email = ?").run(email);
console.log(changes ? `✅ ${email} ahora es administrador. Cierra sesión y vuelve a entrar.` : `❌ No existe un usuario con el correo ${email}`);
