const $ = (id) => document.getElementById(id);
let textoTransferencia = '';

async function copiar(texto, boton) {
  const original = boton.textContent;
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // Navegadores sin permiso de portapapeles (ej: http en red local)
    const area = Object.assign(document.createElement('textarea'), { value: texto });
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  boton.textContent = '✅ Copiado';
  setTimeout(() => { boton.textContent = original; }, 2000);
}

function pintarTransferencia(t) {
  const filas = [
    ['Banco', t.banco],
    ['Tipo de cuenta', t.tipo],
    ['Número de cuenta', t.numero],
    ['Titular', t.titular],
    ['RUT', t.rut],
    ['Correo', t.correo],
  ].filter(([, valor]) => valor);
  $('banco-transferencia').textContent = t.banco ? `· ${t.banco}` : '';
  $('datos-transferencia').innerHTML = filas.map(([nombre, valor]) => `
    <div><dt>${nombre}</dt><dd><span>${esc(valor)}</span>
      <button type="button" class="enlace-boton" data-copiar="${esc(valor)}" aria-label="Copiar ${nombre.toLowerCase()}">Copiar</button></dd></div>`).join('');
  // Formato que se pega fácil en la app del banco al agregar un destinatario
  textoTransferencia = filas.map(([nombre, valor]) => `${nombre}: ${valor}`).join('\n');
  $('caja-transferencia').classList.remove('oculto');
}

enlacesPublicos.then(({ donaciones: url, transferencia, ...redes }) => {
  if (pintarRedes($('redes'), redes)) $('siguenos').classList.remove('oculto');
  if (url) {
    $('btn-donar').href = url;
    $('btn-donar').classList.remove('oculto');
  }
  if (transferencia) pintarTransferencia(transferencia);
  $('sin-donaciones').classList.toggle('oculto', Boolean(url || transferencia));
});

$('datos-transferencia').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-copiar]');
  if (boton) copiar(boton.dataset.copiar, boton);
});
$('btn-copiar').addEventListener('click', (e) => copiar(textoTransferencia, e.currentTarget));
