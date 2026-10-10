// Fotos: lectura con orientación EXIF corregida, redimensionado y miniaturas (todo en el móvil).
export class PhotoError extends Error {
  constructor(kind, msg) { super(msg); this.kind = kind; }
}

const MAX_FILE = 40 * 1024 * 1024;

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (_) {
    // Alternativa: <img> también respeta la orientación EXIF en Chrome.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

function canvasBlob(c, type, q) {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type, q));
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export async function prepare(file, max = 1536, quality = 0.85) {
  if (!file) throw new PhotoError('none', 'No se ha elegido ninguna foto.');
  if (file.type && !file.type.startsWith('image/')) throw new PhotoError('type', 'Ese archivo no es una foto. Elige una imagen JPG o PNG.');
  if (file.size > MAX_FILE) throw new PhotoError('large', 'La foto es demasiado grande (más de 40 MB). Prueba con otra o hazla con menos resolución.');
  let src;
  try { src = await decode(file); } catch (_) {
    throw new PhotoError('decode', 'No se ha podido leer la foto. Si es formato HEIC, cámbialo a JPG o hazla de nuevo con la cámara.');
  }
  const w0 = src.width, h0 = src.height;
  if (!w0 || !h0) throw new PhotoError('decode', 'No se ha podido leer la foto.');
  if (Math.min(w0, h0) < 256) throw new PhotoError('small', 'La foto es demasiado pequeña. Haz una foto con más resolución.');
  const sc = Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * sc), h = Math.round(h0 * sc);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();
  const blob = await canvasBlob(c, 'image/jpeg', quality);
  return { blob, w, h, url: URL.createObjectURL(blob) };
}

export async function thumbnail(blob, max = 320) {
  const bmp = await createImageBitmap(blob);
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return canvasBlob(c, 'image/jpeg', 0.8);
}

export async function sizeOf(blob) {
  const bmp = await createImageBitmap(blob);
  const r = { w: bmp.width, h: bmp.height };
  bmp.close && bmp.close();
  return r;
}

export function b64ToBlob(b64, type = 'image/jpeg') {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type });
}
