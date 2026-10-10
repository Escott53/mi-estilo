// Llamadas directas a la API de OpenAI desde el navegador (la API admite CORS).
import { b64ToBlob } from './image.js';

const BASE = 'https://api.openai.com/v1';

export class AppError extends Error {
  constructor(kind, title, message, extra = {}) {
    super(message);
    this.kind = kind; this.title = title;
    Object.assign(this, extra);
  }
}

export const ERR = {
  offline: () => new AppError('offline', 'Sin conexión a internet', 'Comprueba el wifi o los datos móviles y vuelve a intentarlo.'),
  network: () => new AppError('network', 'No se ha podido conectar con OpenAI', 'Puede ser la conexión o un corte momentáneo. Inténtalo de nuevo en unos segundos.'),
  nokey: () => new AppError('nokey', 'Falta tu clave de OpenAI', 'Pégala una vez en Ajustes y ya podrás usar la app.'),
  key: () => new AppError('key', 'Clave no válida', 'OpenAI no reconoce la clave. Puede que esté mal copiada o que se haya borrado. Pega una nueva en Ajustes.'),
  quota: () => new AppError('quota', 'Sin saldo en OpenAI', 'Tu cuenta de OpenAI no tiene crédito. Añade saldo en platform.openai.com → Billing y vuelve a intentarlo.'),
  rate: () => new AppError('rate', 'Demasiadas peticiones seguidas', 'OpenAI pide esperar un poco. Espera un minuto y vuelve a intentarlo.'),
  large: () => new AppError('large', 'Foto demasiado grande', 'Prueba con otra foto o hazla con menos resolución.'),
  policy: () => new AppError('policy', 'Contenido no permitido', 'OpenAI ha rechazado esta foto o petición por sus normas de contenido. Prueba con otra foto (de frente, con ropa normal) o cambia el texto.'),
  model: (m) => new AppError('model', 'Modelo no disponible', `Tu clave no tiene acceso al modelo ${m || ''}. Elige otro en Ajustes.`),
  verify: () => new AppError('verify', 'Cuenta sin verificar', 'OpenAI exige verificar la organización para usar este modelo de imagen (platform.openai.com → Settings → Organization). Mientras, se usará el modelo alternativo.'),
  server: () => new AppError('server', 'OpenAI no responde bien', 'Sus servidores están saturados o con problemas. Inténtalo de nuevo en unos minutos.'),
  timeout: () => new AppError('timeout', 'Ha tardado demasiado', 'La respuesta no ha llegado a tiempo. Inténtalo de nuevo.'),
  abort: () => new AppError('abort', 'Cancelado', 'Has cancelado la operación.'),
  cut: () => new AppError('cut', 'Respuesta incompleta', 'La respuesta se ha cortado. Vuelve a intentarlo.'),
  parse: () => new AppError('parse', 'Respuesta inesperada', 'No se ha podido leer la respuesta de OpenAI. Vuelve a intentarlo.')
};

function mapError(status, e = {}) {
  const code = String(e.code || ''), type = String(e.type || ''), msg = String(e.message || ''), param = String(e.param || '');
  let err;
  if (status === 401) err = ERR.key();
  else if (code === 'insufficient_quota' || type === 'insufficient_quota' || code === 'credit_balance_exhausted' || code === 'billing_hard_limit_reached' || (status === 429 && /quota|billing|credit/i.test(msg))) err = ERR.quota();
  else if (status === 429) err = ERR.rate();
  else if (status === 413 || /too large|exceeds.*(size|limit)|maximum.*size/i.test(msg) && /image|file|payload|request/i.test(msg)) err = ERR.large();
  else if (/content_policy|moderation|safety/i.test(code) || /safety system|content policy|moderation|not allowed by our safety/i.test(msg)) err = ERR.policy();
  else if (status === 403 && /verif/i.test(msg)) err = ERR.verify();
  else if (status === 404 || code === 'model_not_found' || (status === 403 && /model/i.test(msg)) || (param === 'model')) err = ERR.model();
  else if (status >= 500) err = ERR.server();
  else err = new AppError('bad', 'Petición rechazada', 'OpenAI ha rechazado la petición: ' + (msg || 'error ' + status));
  err.status = status; err.code = code; err.param = param; err.raw = msg;
  return err;
}

async function request(path, { key, json, form, signal, method }) {
  if (!key) throw ERR.nokey();
  if (navigator.onLine === false) throw ERR.offline();
  let res;
  try {
    res = await fetch(BASE + path, {
      method: method || (json || form ? 'POST' : 'GET'),
      headers: { Authorization: 'Bearer ' + key, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
      signal
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw (signal && signal.reason === 'timeout') ? ERR.timeout() : ERR.abort();
    throw navigator.onLine === false ? ERR.offline() : ERR.network();
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* cuerpo vacío */ }
  if (!res.ok) throw mapError(res.status, data && data.error);
  return data;
}

// ---------- Precios aproximados (USD por millón de tokens) para estimar el coste ----------
const USD_EUR = 0.86;
const TEXT_PRICES = [
  ['gpt-5.5', 5, 30], ['gpt-5.4-mini', 0.75, 4.5], ['gpt-5.4-nano', 0.2, 1.25], ['gpt-5.4', 2.5, 15],
  ['gpt-5-mini', 0.25, 2], ['gpt-5-nano', 0.05, 0.4], ['gpt-5', 1.25, 10],
  ['gpt-4.1-mini', 0.4, 1.6], ['gpt-4.1-nano', 0.1, 0.4], ['gpt-4.1', 2, 8], ['gpt-4o-mini', 0.15, 0.6], ['gpt-4o', 2.5, 10]
];
const IMAGE_PRICES = { // [texto entrada, imagen entrada, imagen salida]
  'gpt-image-2': [5, 8, 30], 'gpt-image-1.5': [5, 8, 32], 'gpt-image-1-mini': [2, 2.5, 8], 'gpt-image-1': [5, 10, 40]
};

export function textCostEur(model, usage) {
  if (!usage) return null;
  const p = TEXT_PRICES.find(([m]) => model && model.startsWith(m));
  if (!p) return null;
  return ((usage.input_tokens || 0) * p[1] + (usage.output_tokens || 0) * p[2]) / 1e6 * USD_EUR;
}

export function imageCostEur(model, usage) {
  const key = Object.keys(IMAGE_PRICES).sort((a, b) => b.length - a.length).find((m) => model && model.startsWith(m));
  const p = IMAGE_PRICES[key || 'gpt-image-2'];
  if (!usage) return null;
  const d = usage.input_tokens_details || {};
  const txt = d.text_tokens ?? 0, img = d.image_tokens ?? Math.max(0, (usage.input_tokens || 0) - txt);
  return (txt * p[0] + img * p[1] + (usage.output_tokens || 0) * p[2]) / 1e6 * USD_EUR;
}

// Coste típico estimado (para el aviso antes de pulsar).
export function estimateEur(kind, s) {
  if (kind === 'edit') {
    const m = s.imageModel || 'gpt-image-2';
    const base = m.startsWith('gpt-image-1-mini') ? 0.02 : 0.06;
    return s.imageQuality === 'high' ? base * 3 : s.imageQuality === 'low' ? base / 3 : base;
  }
  return textCostEur(s.visionModel, { input_tokens: 3500, output_tokens: kind === 'hair' ? 3500 : 3000 }) ?? 0.05;
}

export function fmtEur(v) {
  if (v == null || isNaN(v)) return '—';
  if (v < 0.01) return '< 0,01 €';
  return '≈ ' + v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// ---------- Análisis de imagen con salida JSON estructurada (Responses API) ----------
const isReasoning = (m) => /^(gpt-5|o\d)/.test(m) && !/chat/.test(m);

async function responsesOnce({ key, model, reasoning, system, userText, dataUrl, schema, schemaName, signal, useReasoning = true }) {
  const body = {
    model,
    instructions: system,
    input: [{ role: 'user', content: [
      { type: 'input_text', text: userText },
      { type: 'input_image', image_url: dataUrl, detail: 'high' }
    ] }],
    text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
    max_output_tokens: 12000,
    store: false
  };
  if (useReasoning && isReasoning(model) && reasoning) body.reasoning = { effort: reasoning };
  let data;
  try {
    data = await request('/responses', { key, json: body, signal });
  } catch (e) {
    if (e.kind === 'bad' && /reasoning/.test(e.param || '') && useReasoning) {
      return responsesOnce({ key, model, reasoning, system, userText, dataUrl, schema, schemaName, signal, useReasoning: false });
    }
    if (e.kind === 'bad' && /image|modalit|vision/i.test(e.raw || '')) { e.kind = 'model'; }
    if (e.kind === 'model') e.message = `Tu clave no tiene acceso al modelo ${model} o no admite fotos. Elige otro en Ajustes.`;
    throw e;
  }
  if (data.status === 'incomplete') throw ERR.cut();
  let text = '';
  for (const o of data.output || []) {
    if (o.type !== 'message') continue;
    for (const c of o.content || []) {
      if (c.type === 'refusal') throw ERR.policy();
      if (c.type === 'output_text') text += c.text;
    }
  }
  if (!text && data.output_text) text = data.output_text;
  let result;
  try { result = JSON.parse(text); } catch (_) { throw ERR.parse(); }
  const usedModel = data.model || model;
  return { result, usage: data.usage || null, model: usedModel, cost: textCostEur(usedModel, data.usage) };
}

export async function analyze({ key, models, ...rest }) {
  let last;
  for (const model of [...new Set(models.filter(Boolean))]) {
    try { return await responsesOnce({ key, model, ...rest }); }
    catch (e) { last = e; if (e.kind !== 'model' && e.kind !== 'verify') throw e; }
  }
  throw last;
}

// ---------- Edición de imagen (peinado) ----------
function pickSize(w, h) {
  const r = w / h;
  if (r < 0.85) return '1024x1536';
  if (r > 1.18) return '1536x1024';
  return '1024x1024';
}

async function editOnce({ key, model, blob, w, h, prompt, quality, signal, minimal = false }) {
  const f = new FormData();
  f.append('model', model);
  f.append('image', blob, 'foto.jpg');
  f.append('prompt', prompt);
  f.append('n', '1');
  f.append('size', pickSize(w, h));
  if (!minimal) {
    if (quality) f.append('quality', quality);
    f.append('output_format', 'jpeg');
    f.append('output_compression', '90');
  }
  try {
    const data = await request('/images/edits', { key, form: f, signal });
    const item = data && data.data && data.data[0];
    if (!item || !item.b64_json) throw ERR.parse();
    const b = item.b64_json;
    const type = b.startsWith('/9j') ? 'image/jpeg' : b.startsWith('iVBOR') ? 'image/png' : b.startsWith('UklGR') ? 'image/webp' : 'image/jpeg';
    return { blob: b64ToBlob(item.b64_json, type), usage: data.usage || null, model, cost: imageCostEur(model, data.usage) };
  } catch (e) {
    if (e.kind === 'bad' && !minimal && /quality|output_format|output_compression|size/.test(e.param || e.raw || '')) {
      return editOnce({ key, model, blob, w, h, prompt, quality, signal, minimal: true });
    }
    if (e.kind === 'model') e.message = `Tu clave no tiene acceso al modelo de imagen ${model}. Elige otro en Ajustes.`;
    throw e;
  }
}

export async function editImage({ key, models, ...rest }) {
  let last;
  for (const model of [...new Set(models.filter(Boolean))]) {
    try { return await editOnce({ key, model, ...rest }); }
    catch (e) { last = e; if (e.kind !== 'model' && e.kind !== 'verify') throw e; }
  }
  throw last;
}

// ---------- Probar clave ----------
export async function testKey(key, s) {
  const data = await request('/models', { key });
  const ids = new Set((data.data || []).map((m) => m.id));
  const out = { ok: true, vision: ids.has(s.visionModel), image: ids.has(s.imageModel), visionFallback: ids.has(s.visionFallback), imageFallback: ids.has(s.imageFallback), credit: null, ids };
  // Mini-petición de texto (coste ínfimo) para comprobar si hay saldo.
  const cheap = ['gpt-4.1-nano', 'gpt-5-nano', 'gpt-4o-mini'].find((m) => ids.has(m));
  if (cheap) {
    try {
      await request('/responses', { key, json: { model: cheap, input: 'Responde solo: ok', max_output_tokens: 16, store: false } });
      out.credit = true;
    } catch (e) {
      if (e.kind === 'quota') out.credit = false; else if (e.kind !== 'rate') out.creditError = e;
    }
  }
  return out;
}
