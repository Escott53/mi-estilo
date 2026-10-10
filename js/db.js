// Almacenamiento local: IndexedDB (historial + clave cifrada con una clave de dispositivo no extraíble).
const DB_NAME = 'mi-estilo';
const DB_VER = 1;
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('history')) d.createObjectStore('history', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    let out;
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
export const kvDel = (k) => tx('kv', 'readwrite', (s) => s.delete(k));

export const histAll = () => tx('history', 'readonly', (s) => s.getAll()).then((a) => (a || []).sort((x, y) => y.date - x.date));
export const histGet = (id) => tx('history', 'readonly', (s) => s.get(id));
export const histPut = (it) => tx('history', 'readwrite', (s) => s.put(it));
export const histDel = (id) => tx('history', 'readwrite', (s) => s.delete(id));
export const histClear = () => tx('history', 'readwrite', (s) => s.clear());

export async function histPrune(max = 40) {
  const all = await histAll();
  for (const it of all.slice(max)) await histDel(it.id);
}

// ---------- Clave de OpenAI ----------
// Se cifra con AES-GCM usando una CryptoKey generada en este dispositivo y marcada como NO extraíble:
// el navegador la guarda en IndexedDB pero ningún script puede leer sus bytes.
async function deviceKey() {
  let k = await kvGet('deviceKey');
  if (!k) {
    k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await kvSet('deviceKey', k);
  }
  return k;
}

export async function saveApiKey(plain) {
  if (!window.crypto || !crypto.subtle) throw new Error('Este navegador no permite guardar la clave de forma segura (se necesita HTTPS).');
  const k = await deviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plain));
  await kvSet('apiKey', { iv, ct, hint: plain.slice(-4), saved: Date.now() });
}

export async function loadApiKey() {
  const r = await kvGet('apiKey');
  if (!r) return null;
  const k = await kvGet('deviceKey');
  if (!k) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv }, k, r.ct);
    return new TextDecoder().decode(pt);
  } catch (_) { return null; }
}

export async function apiKeyInfo() {
  const r = await kvGet('apiKey');
  return r ? { hint: r.hint, saved: r.saved } : null;
}

export const deleteApiKey = () => kvDel('apiKey');
