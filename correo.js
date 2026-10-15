import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const carpetaDesarrollo = path.join(__dirname, 'data', 'correos');

// Si no hay SMTP configurado (archivo .env), los correos se guardan como HTML en data/correos
const transporte = process.env.SMTP_HOST
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  })
  : null;

export const correoConfigurado = Boolean(transporte);

export const escHtml = (valor) => String(valor ?? '')
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function plantilla(titulo, cuerpo) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f6f8f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2933">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="font-size:22px;font-weight:800;margin-bottom:16px"><span style="color:#20b6a3">🐾 MASO</span> <span style="font-family:Georgia,serif">PET</span></div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
      <h1 style="font-size:20px;margin:0 0 12px">${escHtml(titulo)}</h1>
      ${cuerpo}
    </div>
    <p style="color:#64748b;font-size:12px;margin-top:16px">Recibes este correo porque tienes una cuenta en MasoPet.</p>
  </div></body></html>`;
}

export const boton = (url, texto) =>
  `<p style="margin:20px 0"><a href="${escHtml(url)}" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escHtml(texto)}</a></p>`;

export async function enviarCorreo({ para, asunto, html, texto }) {
  if (transporte) {
    await transporte.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: para, subject: asunto, html, text: texto });
    return;
  }
  fs.mkdirSync(carpetaDesarrollo, { recursive: true });
  const archivo = path.join(carpetaDesarrollo, `${Date.now()}-${para.replace(/[^\w.@-]/g, '_')}.html`);
  fs.writeFileSync(archivo, html);
  console.log(`✉️  [sin SMTP] Correo para ${para}: "${asunto}"\n   Guardado en ${archivo}${texto ? `\n   ${texto.split('\n').join('\n   ')}` : ''}`);
}
