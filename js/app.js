import * as db from './db.js';
import * as api from './api.js';
import { prepare, thumbnail, sizeOf, blobToDataURL, PhotoError } from './image.js';
import { LOOK_SCHEMA, LOOK_SYSTEM, lookUserText, HAIR_SCHEMA, HAIR_SYSTEM, hairUserText, HAIR_PRESETS, editPrompt, refEditPrompt, COMPARE_SCHEMA, COMPARE_SYSTEM, compareUserText } from './prompts.js';

export const APP_VERSION = '1.2.0';

// ------------------------------------------------------------------ utilidades
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtDate = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const hexOk = (h) => /^#[0-9a-f]{6}$/i.test(h || '') ? h : '#888888';

// ------------------------------------------------------------------ ajustes y contador
const SETTINGS_KEY = 'mi-estilo-ajustes';
const STATS_KEY = 'mi-estilo-uso';
export const DEFAULTS = {
  visionModel: 'gpt-5.4', visionFallback: 'gpt-5-mini', reasoning: 'low',
  imageModel: 'gpt-image-2', imageFallback: 'gpt-image-1-mini', imageQuality: 'medium',
  onboarded: false
};
const settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

const monthKey = () => new Date().toISOString().slice(0, 7);
function stats() {
  const s = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
  if (s.month !== monthKey()) return { month: monthKey(), look: 0, hair: 0, edit: 0, eur: 0 };
  return s;
}
function addStat(kind, eur) {
  const s = stats();
  s[kind] = (s[kind] || 0) + 1;
  s.eur = (s.eur || 0) + (eur || api.estimateEur(kind, settings));
  localStorage.setItem(STATS_KEY, JSON.stringify(s));
}

// ------------------------------------------------------------------ estado en memoria
const state = {
  hasKey: false, keyHint: '',
  look: { photo: null, occasion: '', weather: '', question: '' },
  hair: { set: newSet(), question: '', lastId: null },
  tryOn: { set: newSet(), refs: newSet(), copyColor: false, alsoProfile: false, choice: null, custom: '', fromId: null },
  urls: []
};
function objUrl(blob) { const u = URL.createObjectURL(blob); state.urls.push(u); return u; }
function freeUrls() { state.urls.splice(0).forEach((u) => URL.revokeObjectURL(u)); }

// ------------------------------------------------------------------ avisos
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

function errorCard(err) {
  const icons = { offline: '📡', network: '📡', key: '🔑', nokey: '🔑', quota: '💳', rate: '⏳', large: '🖼️', policy: '🚫', model: '🧩', verify: '🪪', server: '🛠️', timeout: '⌛', photo: '📷' };
  const kind = err instanceof PhotoError ? 'photo' : err.kind;
  const title = err.title || (err instanceof PhotoError ? 'Problema con la foto' : 'Algo ha fallado');
  const action = (kind === 'key' || kind === 'nokey' || kind === 'model') ? '<a class="btn btn-ghost sm" href="#/ajustes">Ir a Ajustes</a>'
    : kind === 'quota' ? '<a class="btn btn-ghost sm" href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener">Añadir saldo</a>' : '';
  return `<div class="card err-card pop"><div class="err-ic">${icons[kind] || '⚠️'}</div><div><h3>${esc(title)}</h3><p>${esc(err.message)}</p>${action}</div></div>`;
}

// ------------------------------------------------------------------ overlay de progreso
let currentAbort = null;
function showProgress({ title, sub, estimate }) {
  const o = $('#overlay');
  o.innerHTML = `<div class="prog-card pop">
      <div class="prog-ring"><span></span><span></span><b>✦</b></div>
      <h2>${esc(title)}</h2>
      <p class="prog-sub">${esc(sub)}</p>
      <div class="bar"><i id="pbar"></i></div>
      <p class="prog-time"><span id="ptime">0 s</span> · suele tardar ${esc(estimate[0])}–${esc(estimate[1])} s</p>
      <p class="prog-tip" id="ptip"></p>
      <button class="btn btn-ghost" id="pcancel">Cancelar</button>
    </div>`;
  o.classList.remove('hidden');
  const t0 = Date.now();
  const mid = (estimate[0] + estimate[1]) / 2;
  const tips = ['Enviando la foto de forma segura a OpenAI…', 'El estilista está mirando cada detalle…', 'Preparando consejos concretos para ti…', 'Casi listo…'];
  const iv = setInterval(() => {
    const s = (Date.now() - t0) / 1000;
    const p = 1 - Math.exp(-s / mid * 1.4);
    $('#pbar') && ($('#pbar').style.width = (Math.min(p, 0.96) * 100).toFixed(1) + '%');
    $('#ptime') && ($('#ptime').textContent = Math.round(s) + ' s');
    const tip = s > estimate[1] ? 'Está tardando más de lo normal, un poco de paciencia…' : tips[Math.min(tips.length - 1, Math.floor(s / (mid / 2.5)))];
    $('#ptip') && ($('#ptip').textContent = tip);
  }, 250);
  const ctrl = new AbortController();
  currentAbort = ctrl;
  const timer = setTimeout(() => ctrl.abort('timeout'), 180000);
  $('#pcancel').onclick = () => ctrl.abort('user');
  return { signal: ctrl.signal, done: () => { clearInterval(iv); clearTimeout(timer); o.classList.add('hidden'); o.innerHTML = ''; currentAbort = null; } };
}

function confirmBox(text, okLabel = 'Borrar') {
  return new Promise((res) => {
    const o = $('#overlay');
    o.innerHTML = `<div class="prog-card pop"><h2>${esc(text)}</h2><div class="row2"><button class="btn btn-ghost" data-r="0">Cancelar</button><button class="btn btn-danger" data-r="1">${esc(okLabel)}</button></div></div>`;
    o.classList.remove('hidden');
    o.onclick = (e) => { const b = e.target.closest('[data-r]'); if (!b) return; o.classList.add('hidden'); o.innerHTML = ''; o.onclick = null; res(b.dataset.r === '1'); };
  });
}

// ------------------------------------------------------------------ router
const routes = {};
let lastRoute = '';
async function route() {
  const hash = location.hash.slice(2) || '';
  if (!hash) { location.replace(settings.onboarded ? '#/inicio' : '#/bienvenida'); return; }
  const [name, arg] = hash.split('/');
  const fn = routes[name] || routes.inicio;
  freeUrls();
  const back = lastRoute && order(name) < order(lastRoute.split('/')[0]);
  lastRoute = hash;
  $('#tabs').classList.toggle('hidden', name === 'bienvenida');
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (name === 'r' ? 'historial' : name)));
  app.innerHTML = '';
  const view = document.createElement('main');
  view.className = 'view' + (back ? ' back-anim' : '');
  app.appendChild(view);
  await fn(view, arg);
  window.scrollTo(0, 0);
}
const ORDER = ['bienvenida', 'inicio', 'look', 'pelo', 'probar', 'historial', 'r', 'ajustes'];
const order = (n) => ORDER.indexOf(n);
window.addEventListener('hashchange', route);

function header(title, sub, { back, gear = true } = {}) {
  return `<header class="vh">
    ${back ? `<button class="icon-btn" data-act="back" aria-label="Volver">←</button>` : ''}
    <div class="vh-t"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
    ${gear ? '<a class="icon-btn" href="#/ajustes" aria-label="Ajustes">⚙️</a>' : ''}
  </header>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="back"]');
  if (b) { e.preventDefault(); if (history.length > 1) history.back(); else location.hash = '#/inicio'; }
});

function keyBanner() {
  return state.hasKey ? '' : `<a class="card banner pop" href="#/ajustes"><span>🔑</span><div><b>Falta tu clave de OpenAI</b><small>Pégala en Ajustes para empezar</small></div><span class="chev">›</span></a>`;
}

// ------------------------------------------------------------------ BIENVENIDA
routes.bienvenida = async (v) => {
  v.classList.add('onb');
  v.innerHTML = `
    <div class="onb-hero">
      <div class="logo-big">${LOGO}</div>
      <h1>Mi <em>Estilo</em></h1>
      <p class="lead">Tu asesor de imagen personal: hazte una foto y recibe consejos de un estilista y un barbero expertos.</p>
    </div>
    <div class="card onb-steps">
      <div class="st"><span>1</span><p><b>Necesitas una clave de OpenAI.</b> Créala en <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a> (necesita saldo en la cuenta) y cópiala.</p></div>
      <div class="st"><span>2</span><p><b>Pégala aquí una sola vez.</b> Se guarda cifrada solo en este móvil. No se envía a ningún otro sitio.</p></div>
      <div class="st"><span>3</span><p><b>Tus fotos son privadas.</b> Solo se envían a OpenAI cuando pulsas <i>Analizar</i> o <i>Generar</i>. El historial se queda en el móvil.</p></div>
    </div>
    <form class="card key-form" id="kf" autocomplete="off">
      <label for="kin">Tu clave de OpenAI</label>
      <input id="kin" type="password" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Pega aquí tu clave">
      <div id="kmsg"></div>
      <button class="btn btn-gold big" type="submit">Guardar y empezar</button>
    </form>
    <button class="btn btn-link" id="skip">Ahora no, solo quiero mirar</button>`;
  $('#kf', v).onsubmit = async (e) => {
    e.preventDefault();
    const val = $('#kin', v).value.trim();
    if (!(await storeKey(val, $('#kmsg', v)))) return;
    $('#kin', v).value = '';
    settings.onboarded = true; saveSettings();
    location.hash = '#/inicio';
  };
  $('#skip', v).onclick = () => { settings.onboarded = true; saveSettings(); location.hash = '#/inicio'; };
};

async function storeKey(val, msgEl) {
  if (!val || val.length < 20 || /\s/.test(val)) { msgEl.innerHTML = '<p class="msg bad">Esa clave no parece completa. Cópiala entera desde OpenAI y pégala de nuevo.</p>'; return false; }
  try {
    await db.saveApiKey(val);
    const info = await db.apiKeyInfo();
    state.hasKey = true; state.keyHint = info.hint;
    toast('Clave guardada en este móvil 🔒');
    return true;
  } catch (e) {
    msgEl.innerHTML = `<p class="msg bad">${esc(e.message)}</p>`; return false;
  }
}

// ------------------------------------------------------------------ INICIO
const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9cf8f"/><stop offset="1" stop-color="#b8893b"/></linearGradient></defs><path d="M32 12a5 5 0 1 1 5 5c-2 0-5 1.6-5 4.5v1.2L54 38c2.6 1.8 1.4 5.5-1.7 5.5H11.7c-3.1 0-4.3-3.7-1.7-5.5l22-15.3" fill="none" stroke="url(#lg)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 50h20" stroke="url(#lg)" stroke-width="3.6" stroke-linecap="round"/></svg>`;

routes.inicio = async (v) => {
  const s = stats();
  const h = new Date().getHours();
  const hello = h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const recent = (await db.histAll()).slice(0, 3);
  const total = (s.look || 0) + (s.hair || 0) + (s.edit || 0);
  const mes = new Date().toLocaleDateString('es-ES', { month: 'long' });
  v.innerHTML = `
    <header class="home-head">
      <div><p class="date">${esc(cap(new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })))}</p>
      <h1>${hello},<br><span>¿cómo vamos hoy?</span></h1></div>
      <a class="icon-btn" href="#/ajustes" aria-label="Ajustes">⚙️</a>
    </header>
    ${keyBanner()}
    <div class="feature-list">
      <a class="feature f-look pop" href="#/look" style="--d:0ms"><span class="f-ic">👔</span><div><h2>Mi look</h2><p>Foto de tu ropa y te digo qué funciona, colores, talla y calzado.</p></div><span class="chev">›</span></a>
      <a class="feature f-hair pop" href="#/pelo" style="--d:60ms"><span class="f-ic">💈</span><div><h2>Mi pelo</h2><p>Corte, peinado, productos y qué pedirle al barbero.</p></div><span class="chev">›</span></a>
      <a class="feature f-try pop" href="#/probar" style="--d:120ms"><span class="f-ic">✨</span><div><h2>Probar peinado</h2><p>Mira cómo te quedaría otro corte antes de ir al barbero.</p></div><span class="chev">›</span></a>
    </div>
    <div class="card usage pop" style="--d:180ms">
      <div class="u-head"><h3>Uso en ${esc(mes)}</h3><span class="muted">${total} ${total === 1 ? 'acción' : 'acciones'}</span></div>
      <div class="u-grid">
        <div><b>${s.look || 0}</b><span>looks</span></div>
        <div><b>${s.hair || 0}</b><span>pelo</span></div>
        <div><b>${s.edit || 0}</b><span>peinados</span></div>
        <div><b>${api.fmtEur(s.eur || 0).replace('≈ ', '')}</b><span>aprox.</span></div>
      </div>
    </div>
    ${recent.length ? `<div class="sec-head"><h3>Últimos</h3><a href="#/historial">Ver todo</a></div><div class="recent">${recent.map(histCard).join('')}</div>` : ''}`;
  hydrateThumbs(v, recent);
};

// ------------------------------------------------------------------ selector de foto (reutilizable)
function photoPicker(id, photo, { front = false, hint, alt = 'Tu foto', icon } = {}) {
  return `<div class="picker ${photo ? 'has' : ''}" id="${id}">
    ${photo ? `<div class="pv"><img src="${photo.url}" alt="${alt}"><button class="pv-x" data-pick="clear" aria-label="Quitar foto">✕</button></div>` :
      `<div class="pk-empty"><span class="pk-ic">${icon || (front ? '🤳' : '📸')}</span><p>${esc(hint)}</p></div>`}
    <div class="row2">
      <label class="btn btn-navy big"><input type="file" accept="image/*" capture="${front ? 'user' : 'environment'}" data-pick="cam" hidden>📷 ${photo ? 'Repetir' : 'Cámara'}</label>
      <label class="btn btn-ghost big"><input type="file" accept="image/*" data-pick="gal" hidden>🖼️ Galería</label>
    </div>
  </div>`;
}

function bindPicker(root, onPhoto) {
  root.addEventListener('change', async (e) => {
    const inp = e.target.closest('input[data-pick]');
    if (!inp || !inp.files || !inp.files[0]) return;
    const f = inp.files[0];
    inp.value = '';
    const pid = (inp.closest('.picker') || {}).id;
    try { onPhoto(await prepare(f), pid); }
    catch (err) { toast(err.message, 4200); }
  });
  root.addEventListener('click', (e) => { const x = e.target.closest('[data-pick="clear"]'); if (x) onPhoto(null, (x.closest('.picker') || {}).id); });
}

// ------------------------------------------------------------------ conjunto de fotos (varios ángulos)
function newSet() { return { photos: [], main: null }; }
const MAX_OWN = 5, MAX_REF = 3;
const SLOTS = [['frente', 'Frente', '🤳'], ['perfil', 'Perfil', '👤'], ['atras', 'Atrás/Coronilla', '🔙']];
const SLOT_LABEL = Object.fromEntries(SLOTS.map(([k, l]) => [k, l]));
function slotLabel(set, p, isRef) {
  if (isRef) return 'ángulo ' + (set.photos.indexOf(p) + 1);
  if (SLOT_LABEL[p.slot]) return SLOT_LABEL[p.slot];
  return 'Extra ' + (set.photos.filter((x) => x.slot === 'extra').indexOf(p) + 1);
}
function mainOf(set) {
  return set.photos.find((p) => p.id === set.main) || set.photos.find((p) => p.slot === 'frente') || set.photos[0] || null;
}
// Principal primero, luego el resto en orden de ranura.
function ordered(set) {
  const m = mainOf(set); if (!m) return [];
  const rank = (p) => { const i = SLOTS.findIndex(([k]) => k === p.slot); return i < 0 ? 9 : i; };
  return [m, ...set.photos.filter((p) => p !== m).sort((a, b) => rank(a) - rank(b))];
}
function addToSet(set, p, prefer, isRef) {
  const max = isRef ? MAX_REF : MAX_OWN;
  if (set.photos.length >= max) return false;
  p.id = uid();
  if (isRef) p.slot = 'ref';
  else {
    const free = SLOTS.map(([k]) => k).filter((k) => !set.photos.some((x) => x.slot === k));
    p.slot = prefer && free.includes(prefer) ? prefer : (prefer === 'extra' ? 'extra' : free[0] || 'extra');
  }
  set.photos.push(p);
  return true;
}

function photoSet(id, set, { refs = false, hint } = {}) {
  const max = refs ? MAX_REF : MAX_OWN, m = mainOf(set), n = set.photos.length;
  const inp = (slot, cam) => `<label class="pt-b" aria-label="${cam ? 'Cámara' : 'Galería'}"><input type="file" accept="image/*" ${cam ? `capture="${refs ? 'environment' : 'user'}"` : 'multiple'} data-pick="${cam ? 'cam' : 'gal'}" data-slot="${slot}" hidden>${cam ? '📷' : '🖼️'}</label>`;
  const filled = (p) => `<div class="pt has ${!refs && p === m && n > 1 ? 'main' : ''}" data-pid="${p.id}">
      <img src="${p.url}" alt="${esc(slotLabel(set, p, refs))}"><span class="pt-lab">${esc(cap(slotLabel(set, p, refs)))}</span>
      <button type="button" class="pt-x" data-pick="del" aria-label="Quitar foto">✕</button>
      ${!refs && n > 1 ? `<button type="button" class="pt-star" data-pick="main">${p === m ? '★ Principal' : '☆ Usar como principal'}</button>` : ''}</div>`;
  const empty = (slot, label, ic, guided) => `<div class="pt empty ${guided ? 'guided' : ''}" data-slot="${slot}"><span class="pt-ic">${ic}</span><b>${esc(label)}</b><div class="pt-btns">${inp(slot, true)}${inp(slot, false)}</div></div>`;
  let tiles = '';
  if (refs) {
    tiles = set.photos.map(filled).join('') + (n < max ? empty('ref', n ? 'Otro ángulo' : 'Referencia', n ? '➕' : '💇', !n) : '');
  } else {
    tiles = SLOTS.map(([k, l, ic]) => { const p = set.photos.find((x) => x.slot === k); return p ? filled(p) : (n < max ? empty(k, l, ic, true) : ''); }).join('')
      + set.photos.filter((p) => p.slot === 'extra').map(filled).join('')
      + (n < max ? empty('extra', 'Extra', '➕', false) : '');
  }
  return `<div class="pset" id="${id}" data-ref="${refs ? 1 : 0}">
    <div class="pset-grid">${tiles}</div>
    <div class="pset-foot"><span class="muted small">${n}/${max} fotos${refs ? '' : n < 3 ? ' · recomendadas 3' : ''}</span>
      ${n < max ? `<label class="btn btn-ghost sm"><input type="file" accept="image/*" multiple data-pick="gal" data-slot="" hidden>🖼️ Elegir varias</label>` : ''}</div>
    ${hint ? `<p class="muted small pset-hint">${esc(hint)}</p>` : ''}
  </div>`;
}

// sets: { [id]: { set, refs } }. onChange() se llama tras cada cambio.
function bindSets(root, getSets, onChange) {
  root.addEventListener('change', async (e) => {
    const inp = e.target.closest('input[data-pick]');
    const box = inp && inp.closest('.pset');
    if (!box || !inp.files || !inp.files.length) return;
    const files = [...inp.files]; inp.value = '';
    const { set, refs } = getSets()[box.id];
    let first = inp.dataset.slot || '', skipped = 0, bad = null;
    for (const f of files) {
      try {
        const p = await prepare(f);
        if (!addToSet(set, p, first, refs)) skipped++;
        first = first === 'extra' ? 'extra' : '';
      } catch (err) { bad = err; }
    }
    if (bad) toast(bad.message, 4200);
    else if (skipped) toast(`Máximo ${refs ? MAX_REF : MAX_OWN} fotos: ${skipped} no se ${skipped === 1 ? 'ha' : 'han'} añadido`, 3600);
    onChange(box.id);
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick="del"],[data-pick="main"]');
    const box = b && b.closest('.pset'); if (!box) return;
    const { set } = getSets()[box.id];
    const pid = b.closest('[data-pid]').dataset.pid;
    if (b.dataset.pick === 'del') { set.photos = set.photos.filter((p) => p.id !== pid); if (set.main === pid) set.main = null; }
    else { set.main = pid; toast('Foto principal: es la que se retoca'); }
    onChange(box.id);
  });
}

// Prepara las fotos del conjunto para enviarlas: principal a 1536 px, contexto a 1024 px.
async function setPayload(set, isRef, ctxMax = 1024) {
  const list = isRef ? set.photos : ordered(set);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const small = (isRef || i > 0) && Math.max(p.w, p.h) > ctxMax ? (await prepare(p.blob, ctxMax)).blob : p.blob;
    out.push({ p, blob: small, label: slotLabel(set, p, isRef) });
  }
  return out;
}
async function setThumbs(items) { const o = []; for (const x of items) o.push({ label: x.label, thumb: await thumbnail(x.p.blob, 240) }); return o; }
function strip(list, title) {
  if (!list || !list.length) return '';
  return `<div class="card pop set-strip"><p class="small"><b>${esc(title)}</b></p><div class="ss-row">${list.map((x) => `<figure><img src="${objUrl(x.thumb)}" alt=""><figcaption>${esc(cap(x.label))}</figcaption></figure>`).join('')}</div></div>`;
}
function extraNote(kind, nExtra) {
  return nExtra ? ` · incluye ${nExtra} foto${nExtra > 1 ? 's' : ''} extra (+${api.fmtEur(nExtra * api.extraImgEur(kind, settings)).replace('≈ ', '≈')})` : '';
}

function chips(group, options, selected) {
  return `<div class="chips" data-group="${group}">${options.map(([val, label]) => `<button type="button" class="chip ${selected === val ? 'on' : ''}" data-val="${esc(val)}">${label}</button>`).join('')}</div>`;
}

function bindChips(root, cb) {
  root.addEventListener('click', (e) => {
    const c = e.target.closest('.chip[data-val]');
    if (!c) return;
    const g = c.parentElement.dataset.group;
    const was = c.classList.contains('on');
    $$('.chip', c.parentElement).forEach((x) => x.classList.remove('on'));
    if (!was) c.classList.add('on');
    cb(g, was ? '' : c.dataset.val);
  });
}

async function getKeyOrFail() {
  const k = await db.loadApiKey();
  if (!k) throw api.ERR.nokey();
  return k;
}

// ------------------------------------------------------------------ MI LOOK
const OCCASIONS = [['trabajo', '💼 Trabajo'], ['casual', '☕ Casual'], ['cena', '🍷 Cena'], ['boda o evento', '🥂 Boda / evento'], ['golf', '⛳ Golf'], ['deporte', '🏃 Deporte']];
const WEATHER = [['calor', '☀️ Calor'], ['templado', '🌤️ Templado'], ['frío', '❄️ Frío'], ['lluvia', '🌧️ Lluvia']];

routes.look = async (v) => {
  const L = state.look;
  const draw = () => {
    v.innerHTML = `${header('Mi <em>look</em>', 'Hazte una foto de cuerpo entero, con buena luz')}
      ${keyBanner()}
      ${photoPicker('pk', L.photo, { hint: 'De pie, de cuerpo entero y de frente. Mejor si te la hace otra persona o frente a un espejo.' })}
      <div class="card form-card">
        <h3>¿Para qué ocasión? <small>(opcional)</small></h3>
        ${chips('occasion', OCCASIONS, L.occasion)}
        <h3>¿Qué tiempo hace?</h3>
        ${chips('weather', WEATHER, L.weather)}
        <h3>¿Alguna pregunta?</h3>
        <textarea id="q" rows="2" maxlength="400" placeholder="Por ejemplo: ¿pega este cinturón? ¿Me pongo americana?">${esc(L.question)}</textarea>
      </div>
      <div id="err"></div>
      <button class="btn btn-gold big wide" id="go" ${L.photo ? '' : 'disabled'}>✦ Analizar mi look</button>
      <p class="cost-note">Coste aproximado por análisis: ${api.fmtEur(api.estimateEur('look', settings))} · ${esc(settings.visionModel)}</p>`;
    $('#q', v).oninput = (e) => { L.question = e.target.value; };
    $('#go', v).onclick = runLook;
  };
  bindPicker(v, (p) => { if (L.photo) URL.revokeObjectURL(L.photo.url); L.photo = p; draw(); });
  bindChips(v, (g, val) => { L[g] = val; });
  draw();

  async function runLook() {
    $('#err', v).innerHTML = '';
    let prog;
    try {
      const key = await getKeyOrFail();
      prog = showProgress({ title: 'Analizando tu look', sub: 'Colores, talla, calzado y alternativas', estimate: [15, 45] });
      const dataUrl = await blobToDataURL(L.photo.blob);
      const r = await api.analyze({
        key, models: [settings.visionModel, settings.visionFallback], reasoning: settings.reasoning,
        system: LOOK_SYSTEM, userText: lookUserText(L), dataUrl, schema: LOOK_SCHEMA, schemaName: 'analisis_look', signal: prog.signal
      });
      prog.done();
      addStat('look', r.cost);
      const item = { id: uid(), type: 'look', date: Date.now(), photo: L.photo.blob, thumb: await thumbnail(L.photo.blob), result: r.result, model: r.model, cost: r.cost, ctx: { occasion: L.occasion, weather: L.weather, question: L.question } };
      await db.histPut(item); await db.histPrune();
      location.hash = '#/r/' + item.id;
    } catch (err) {
      prog && prog.done();
      if (err.kind === 'abort') return toast('Cancelado');
      $('#err', v).innerHTML = errorCard(err);
      $('#err', v).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
};

// ------------------------------------------------------------------ MI PELO
const OWN_HINT = 'Frente, perfil y atrás/coronilla, con buena luz y sin gorra. Con 3 ángulos el análisis ve coronilla, laterales y nuca.';
routes.pelo = async (v) => {
  const H = state.hair;
  const draw = () => {
    const n = H.set.photos.length;
    v.innerHTML = `${header('Mi <em>pelo</em>', 'Hasta 5 fotos: frente, perfil y atrás')}
      ${keyBanner()}
      ${photoSet('ps', H.set, { hint: OWN_HINT })}
      <div class="card form-card">
        <h3>¿Alguna pregunta? <small>(opcional)</small></h3>
        <textarea id="q" rows="2" maxlength="400" placeholder="Por ejemplo: ¿me dejo crecer arriba? ¿Cómo disimulo las entradas?">${esc(H.question)}</textarea>
      </div>
      <div id="err"></div>
      <button class="btn btn-gold big wide" id="go" ${n ? '' : 'disabled'}>✦ Analizar mi pelo${n > 1 ? ` (${n} fotos)` : ''}</button>
      <p class="cost-note">Coste aproximado: ${api.fmtEur(api.estimateEur('hair', settings, Math.max(0, n - 1)))} · ${esc(settings.visionModel)}${extraNote('hair', Math.max(0, n - 1))}</p>`;
    $('#q', v).oninput = (e) => { H.question = e.target.value; };
    $('#go', v).onclick = runHair;
  };
  bindSets(v, () => ({ ps: { set: H.set, refs: false } }), draw);
  draw();

  async function runHair() {
    $('#err', v).innerHTML = '';
    let prog;
    try {
      const key = await getKeyOrFail();
      const n = H.set.photos.length;
      prog = showProgress({ title: 'Analizando tu pelo', sub: n > 1 ? `${n} fotos: cara, coronilla, laterales y nuca` : 'Forma de la cara, corte, peinado y productos', estimate: n > 1 ? [20, 60] : [15, 45] });
      const items = await setPayload(H.set, false);
      const dataUrls = []; for (const x of items) dataUrls.push(await blobToDataURL(x.blob));
      const r = await api.analyze({
        key, models: [settings.visionModel, settings.visionFallback], reasoning: settings.reasoning,
        system: HAIR_SYSTEM, userText: hairUserText({ question: H.question, labels: items.map((x) => x.label) }), dataUrls, schema: HAIR_SCHEMA, schemaName: 'analisis_pelo', signal: prog.signal
      });
      prog.done();
      addStat('hair', r.cost);
      const m = items[0].p;
      const item = { id: uid(), type: 'hair', date: Date.now(), photo: m.blob, w: m.w, h: m.h, thumb: await thumbnail(m.blob), set: await setThumbs(items), result: r.result, model: r.model, cost: r.cost, ctx: { question: H.question } };
      await db.histPut(item); await db.histPrune();
      H.lastId = item.id;
      location.hash = '#/r/' + item.id;
    } catch (err) {
      prog && prog.done();
      if (err.kind === 'abort') return toast('Cancelado');
      $('#err', v).innerHTML = errorCard(err);
      $('#err', v).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
};

// ------------------------------------------------------------------ PROBAR PEINADO
function setFromHist(src, sz) { const s = newSet(); s.photos.push({ id: uid(), slot: 'frente', blob: src.photo, ...sz, url: URL.createObjectURL(src.photo) }); return s; }
const copySet = (s) => ({ photos: [...s.photos], main: s.main });

routes.probar = async (v, arg) => {
  const T = state.tryOn, H = state.hair;
  const all = await db.histAll();
  const lastHair = all.find((x) => x.type === 'hair' && x.result && x.result.foto_valida !== false);
  const load = async (src) => {
    // Si es el análisis recién hecho en esta sesión, se reutiliza el conjunto completo de fotos.
    if (H.lastId === src.id && H.set.photos.length) T.set = copySet(H.set);
    else T.set = setFromHist(src, src.w ? { w: src.w, h: src.h } : await sizeOf(src.photo));
    T.fromId = src.id;
  };
  if (arg) {
    const [hid, n] = arg.split(':');
    const src = all.find((x) => x.id === hid);
    if (src && src.photo) {
      await load(src);
      const cut = src.result && src.result.cortes && src.result.cortes[+n];
      if (cut) T.choice = { label: cut.nombre, text: cut.prompt_edicion || cut.descripcion };
    }
    history.replaceState(null, '', '#/probar');
  } else if (!T.set.photos.length && H.set.photos.length) {
    T.set = copySet(H.set); T.fromId = H.lastId;
  } else if (!T.set.photos.length && lastHair && lastHair.photo) {
    await load(lastHair);
  }
  const srcItem = all.find((x) => x.id === T.fromId) || lastHair;
  const cuts = (srcItem && srcItem.result && srcItem.result.cortes) || [];

  const draw = () => {
    const opts = [
      ...cuts.map((c) => ({ label: c.nombre, text: c.prompt_edicion || c.descripcion, rec: true })),
      ...HAIR_PRESETS.map((p) => ({ label: p.label, text: p.text }))
    ];
    const n = T.set.photos.length, nr = T.refs.photos.length, has = n > 0;
    const m = mainOf(T.set), prof = T.set.photos.find((p) => p.slot === 'perfil');
    const canProf = prof && prof !== m;
    const editCost = (extraImgs) => api.estimateEur('edit', settings, extraImgs) * (canProf && T.alsoProfile ? 2 : 1);
    const profNote = canProf && T.alsoProfile ? ' · ×2 por el perfil' : '';
    v.innerHTML = `${header('Probar <em>peinado</em>', 'Mira cómo te quedaría antes de ir al barbero')}
      ${keyBanner()}
      ${photoSet('ps', T.set, { hint: (n > 1 ? 'Se retoca la foto ★ principal; las demás ayudan a la IA a ver tu pelo real (densidad, coronilla, entradas). ' : '') + (n ? '' : 'Si ya analizaste tu pelo, se usan esas fotos. ') + OWN_HINT })}
      ${canProf ? `<label class="tgl"><input type="checkbox" id="prof" ${T.alsoProfile ? 'checked' : ''}> Generar también el perfil <small class="muted">(otra imagen, ${api.fmtEur(api.estimateEur('edit', settings, n - 1 + nr))} más)</small></label>` : ''}
      <div class="card form-card ref-card">
        <h3>Fotos de referencia (estilo a copiar) <small>(opcional, hasta 3)</small></h3>
        <p class="muted small">Un famoso, una revista, Instagram… Varias fotos del mismo peinado desde distintos ángulos ayudan a copiarlo mejor.</p>
        ${photoSet('pr', T.refs, { refs: true })}
        ${nr ? `<label class="tgl"><input type="checkbox" id="col" ${T.copyColor ? 'checked' : ''}> Copiar también el color</label>` : ''}
      </div>
      ${nr ? `<div id="err"></div>
      <button class="btn btn-gold big wide" id="goref" ${has ? '' : 'disabled'}>✂️ Copiar este peinado</button>
      <p class="cost-note">Tarda 20–60 s · ${api.fmtEur(editCost(n - 1 + nr))} · ${esc(settings.imageModel)}${extraNote('edit', n - 1 + nr)}${profNote}</p>
      <button class="btn btn-navy big wide" id="cmp" ${has ? '' : 'disabled'}>🔍 Comparar con mi pelo</button>
      <p class="cost-note">Diferencias, si te favorece y qué pedir al barbero · ${api.fmtEur(api.estimateEur('hair', settings, n + nr - 2))}${extraNote('hair', n + nr - 2)}</p>
      <h3 class="sec-title">…o prueba otro peinado</h3>` : ''}
      <div class="card form-card">
        <h3>Elige un peinado</h3>
        ${cuts.length ? '<p class="muted small">⭐ Recomendados en tu último análisis</p>' : ''}
        <div class="chips wrap" id="opts">${opts.map((o, i) => `<button type="button" class="chip ${o.rec ? 'rec' : ''} ${T.choice && T.choice.label === o.label && !T.custom ? 'on' : ''}" data-i="${i}">${o.rec ? '⭐ ' : ''}${esc(o.label)}</button>`).join('')}</div>
        <h3>…o escríbelo tú</h3>
        <textarea id="custom" rows="2" maxlength="300" placeholder="Por ejemplo: más corto a los lados y peinado hacia atrás">${esc(T.custom)}</textarea>
      </div>
      ${nr ? '' : '<div id="err"></div>'}
      <button class="btn ${nr ? 'btn-ghost' : 'btn-gold'} big wide" id="go" ${has ? '' : 'disabled'}>✦ Generar peinado</button>
      <p class="cost-note">Tarda 20–60 s · coste aproximado ${api.fmtEur(editCost(n - 1))} · ${esc(settings.imageModel)}${extraNote('edit', n - 1)}${profNote}</p>`;
    $('#opts', v).onclick = (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      T.choice = opts[+b.dataset.i]; T.custom = ''; $('#custom', v).value = '';
      $$('.chip', $('#opts', v)).forEach((x) => x.classList.toggle('on', x === b));
    };
    $('#custom', v).oninput = (e) => { T.custom = e.target.value; if (T.custom.trim()) $$('.chip', $('#opts', v)).forEach((x) => x.classList.remove('on')); };
    $('#go', v).onclick = () => runEdit(false);
    if (canProf) $('#prof', v).onchange = (e) => { T.alsoProfile = e.target.checked; draw(); };
    if (nr) {
      $('#goref', v).onclick = () => runEdit(true);
      $('#cmp', v).onclick = runCompare;
      $('#col', v).onchange = (e) => { T.copyColor = e.target.checked; };
    }
  };
  bindSets(v, () => ({ ps: { set: T.set, refs: false }, pr: { set: T.refs, refs: true } }), (id) => { if (id === 'ps') T.fromId = null; draw(); });

  const fail = (err, prog) => {
    prog && prog.done();
    if (err.kind === 'abort') return toast('Cancelado');
    $('#err', v).innerHTML = errorCard(err);
    $('#err', v).scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Edición: se retoca solo la principal; el resto de fotos propias y las referencias van como contexto.
  async function runEdit(useRef) {
    $('#err', v).innerHTML = '';
    const note = T.custom.trim();
    const request = useRef ? note : note || (T.choice && T.choice.text);
    const label = useRef ? 'Peinado de la referencia' + (T.copyColor ? ' (con color)' : '') : note || (T.choice && T.choice.label);
    if (!useRef && !request) { toast('Elige un peinado o escribe lo que quieres'); return; }
    const m = mainOf(T.set), prof = T.set.photos.find((p) => p.slot === 'perfil');
    const doProf = T.alsoProfile && prof && prof !== m;
    let prog;
    try {
      const key = await getKeyOrFail();
      prog = showProgress({ title: useRef ? 'Copiando el peinado' : 'Creando tu nuevo peinado', sub: (useRef ? 'Aplicando la referencia a tu foto' : label) + (doProf ? ' · frente y perfil' : ''), estimate: doProf ? [45, 130] : useRef ? [25, 75] : [20, 60] });
      const own = await setPayload(T.set, false);
      const refs = useRef ? await setPayload(T.refs, true) : [];
      const one = async (mainIdx) => {
        const list = [own[mainIdx], ...own.filter((_, i) => i !== mainIdx)];
        const main = list[0].p;
        const ownLabels = list.map((x) => x.label), refLabels = refs.map((x) => x.label);
        const prompt = useRef ? refEditPrompt({ copyColor: T.copyColor, note, ownLabels, refLabels }) : editPrompt(request, ownLabels);
        return { main, r: await api.editImage({ key, models: [settings.imageModel, settings.imageFallback], blob: main.blob, extra: [...list.slice(1), ...refs].map((x) => x.blob), w: main.w, h: main.h, prompt, quality: settings.imageQuality, signal: prog.signal }) };
      };
      const a = await one(0);
      addStat('edit', a.r.cost);
      let extraRes = null;
      if (doProf) { const b = await one(own.findIndex((x) => x.p === prof)); addStat('edit', b.r.cost); extraRes = { photo: prof.blob, after: b.r.blob, label: 'Perfil', cost: b.r.cost }; }
      prog.done();
      const item = { id: uid(), type: 'edit', date: Date.now(), photo: a.main.blob, after: a.r.blob, ref: refs[0] ? refs[0].p.blob : undefined, thumb: await thumbnail(a.r.blob),
        set: own.length > 1 ? await setThumbs(own) : undefined, refs: refs.length ? await setThumbs(refs) : undefined, extra: extraRes,
        label, request: useRef ? note : request, model: a.r.model, cost: (a.r.cost || 0) + ((extraRes && extraRes.cost) || 0) || a.r.cost };
      await db.histPut(item); await db.histPrune();
      location.hash = '#/r/' + item.id;
    } catch (err) { fail(err, prog); }
  }
  async function runCompare() {
    $('#err', v).innerHTML = '';
    let prog;
    try {
      const key = await getKeyOrFail();
      prog = showProgress({ title: 'Comparando peinados', sub: `Tu pelo (${T.set.photos.length} foto${T.set.photos.length > 1 ? 's' : ''}) frente a la referencia`, estimate: [15, 60] });
      const own = await setPayload(T.set, false), refs = await setPayload(T.refs, true);
      const dataUrls = []; for (const x of [...own, ...refs]) dataUrls.push(await blobToDataURL(x.blob));
      const r = await api.analyze({
        key, models: [settings.visionModel, settings.visionFallback], reasoning: settings.reasoning,
        system: COMPARE_SYSTEM, userText: compareUserText({ note: T.custom.trim(), labels: own.map((x) => x.label), refLabels: refs.map((x) => x.label) }), dataUrls, schema: COMPARE_SCHEMA, schemaName: 'comparar_peinado', signal: prog.signal
      });
      prog.done();
      addStat('hair', r.cost);
      const item = { id: uid(), type: 'compare', date: Date.now(), photo: own[0].p.blob, ref: refs[0].p.blob, thumb: await thumbnail(refs[0].p.blob),
        set: own.length > 1 ? await setThumbs(own) : undefined, refs: refs.length > 1 ? await setThumbs(refs) : undefined, result: r.result, model: r.model, cost: r.cost };
      await db.histPut(item); await db.histPrune();
      location.hash = '#/r/' + item.id;
    } catch (err) { fail(err, prog); }
  }
  draw();
};

// ------------------------------------------------------------------ HISTORIAL
const TYPE_LABEL = { look: 'Look', hair: 'Pelo', edit: 'Peinado', compare: 'Comparar' };
function histCard(it) {
  const sub = it.type === 'look' ? (it.result && it.result.veredicto) : it.type === 'hair' ? (it.result && it.result.corte_actual && it.result.corte_actual.valoracion) : it.type === 'compare' ? (it.result && it.result.estilo_referencia) : it.label;
  const score = it.type === 'look' && it.result ? it.result.puntuacion : it.type === 'hair' && it.result && it.result.corte_actual ? it.result.corte_actual.puntuacion : null;
  return `<div class="hist pop" data-id="${it.id}">
    <a class="h-main" href="#/r/${it.id}">
      <img class="h-thumb" data-thumb="${it.id}" alt="">
      <div class="h-txt"><span class="tag t-${it.type}">${TYPE_LABEL[it.type]}</span>${score ? `<span class="h-score">${score}/10</span>` : ''}
        <p>${esc(sub || '')}</p><small>${fmtDate(it.date)}</small></div>
    </a>
    <button class="h-del" data-del="${it.id}" aria-label="Borrar">🗑️</button>
  </div>`;
}
function hydrateThumbs(root, items) {
  for (const it of items) { const img = $(`[data-thumb="${it.id}"]`, root); if (img && it.thumb) img.src = objUrl(it.thumb); }
}

routes.historial = async (v) => {
  const items = await db.histAll();
  v.innerHTML = `${header('Historial', 'Se guarda solo en este móvil')}
    ${items.length ? `<div class="hist-list">${items.map(histCard).join('')}</div>
      <button class="btn btn-ghost wide" id="clear">Borrar todo el historial</button>` :
      `<div class="empty card"><span>🗂️</span><p>Aún no hay nada. Analiza tu look o tu pelo y aparecerá aquí.</p><a class="btn btn-gold" href="#/look">Empezar</a></div>`}`;
  hydrateThumbs(v, items);
  v.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (d) {
      if (!(await confirmBox('¿Borrar este elemento?'))) return;
      await db.histDel(d.dataset.del);
      const el = d.closest('.hist'); el.classList.add('out'); setTimeout(() => route(), 250);
    }
    if (e.target.id === 'clear') {
      if (!(await confirmBox('¿Borrar todo el historial?', 'Borrar todo'))) return;
      await db.histClear(); route();
    }
  });
};

// ------------------------------------------------------------------ RESULTADO
routes.r = async (v, id) => {
  const it = await db.histGet(id);
  if (!it) { v.innerHTML = `${header('No encontrado', '', { back: true })}<div class="empty card"><p>Este elemento ya no existe.</p></div>`; return; }
  if (it.type === 'look') renderLook(v, it);
  else if (it.type === 'hair') renderHair(v, it);
  else if (it.type === 'compare') renderCompare(v, it);
  else renderEdit(v, it);
};

function ring(score) {
  const s = Math.max(0, Math.min(10, Number(score) || 0));
  const c = 2 * Math.PI * 42;
  const col = s >= 8 ? 'var(--ok)' : s >= 6 ? 'var(--gold)' : 'var(--warn)';
  return `<div class="ring" style="--c:${c};--v:${c * (1 - s / 10)};--col:${col}"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="r-bg"/><circle cx="50" cy="50" r="42" class="r-fg"/></svg><div><b>${s}</b><small>/10</small></div></div>`;
}
const list = (arr, cls = '') => `<ul class="ls ${cls}">${(arr || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const footer = (it) => `<p class="res-foot">${esc(fmtDate(it.date))} · ${esc(it.model || '')} · ${api.fmtEur(it.cost)}</p>`;
const badPhoto = (it, msg) => `<div class="card err-card pop"><div class="err-ic">📷</div><div><h3>La foto no sirve para analizar</h3><p>${esc(msg || 'Prueba con otra foto con mejor luz.')}</p><a class="btn btn-gold sm" href="#/${it.type === 'look' ? 'look' : 'pelo'}">Hacer otra foto</a></div></div>`;

function renderLook(v, it) {
  const r = it.result || {};
  const ctx = it.ctx || {};
  const ctxTxt = [ctx.occasion, ctx.weather].filter(Boolean).join(' · ');
  if (r.foto_valida === false) { v.innerHTML = header('Mi <em>look</em>', '', { back: true }) + badPhoto(it, r.problema_foto); return; }
  const col = r.colores || {};
  const shoes = r.calzado || {};
  v.innerHTML = `${header('Tu <em>look</em>', esc(ctxTxt), { back: true })}
    <section class="hero card pop">
      <img class="hero-img" data-ph alt="Tu foto">
      <div class="hero-txt">${ring(r.puntuacion)}<p class="verdict">${esc(r.veredicto)}</p></div>
    </section>
    <div class="card pop"><p class="lead">${esc(r.resumen)}</p>${r.ocasion ? `<p class="occ">🎯 ${esc(r.ocasion)}</p>` : ''}</div>

    <div class="card pop"><h3 class="ch"><span>🎨</span>Colores <span class="badge ${col.combinan ? 'b-ok' : 'b-warn'}">${col.combinan ? 'Combinan' : 'Mejorable'}</span></h3>
      <div class="swatches">${(col.paleta || []).map((p) => `<div class="sw"><i style="background:${hexOk(p.hex)}"></i><b>${esc(p.nombre)}</b><small>${esc(p.prenda)}</small><code>${esc(hexOk(p.hex).toUpperCase())}</code></div>`).join('')}</div>
      <p>${esc(col.explicacion)}</p>${col.cambiar ? `<p class="tip">💡 ${esc(col.cambiar)}</p>` : ''}</div>

    <div class="card pop"><h3 class="ch"><span>📏</span>Talla y ajuste</h3>
      ${(r.ajuste || []).map((a) => `<div class="fit"><span class="dot d-${esc(a.estado)}"></span><div><b>${esc(a.prenda)}</b> <small class="st-${esc(a.estado)}">${esc(a.estado)}</small><p>${esc(a.valoracion)}</p>${a.consejo ? `<p class="tip">💡 ${esc(a.consejo)}</p>` : ''}</div></div>`).join('')}</div>

    <div class="card pop"><h3 class="ch"><span>👞</span>Calzado</h3>
      <div class="shoe"><div><small>Llevas</small><p>${esc(shoes.actual)}</p></div><span class="arrow">→</span><div class="rec"><small>Mejor</small><p><b>${esc(shoes.recomendado)}</b></p></div></div>
      <p>${esc(shoes.por_que)}</p>
      ${(shoes.alternativas || []).length ? `<div class="chips static">${shoes.alternativas.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}</div>

    <div class="card pop"><h3 class="ch"><span>✅</span>Lo que funciona</h3>${list(r.funciona, 'ok')}</div>

    <div class="card pop"><h3 class="ch"><span>🔧</span>Qué cambiar</h3>
      <ol class="prio">${(r.cambiar || []).map((c) => `<li><div><b>${esc(c.cambio)}</b> <span class="imp i-${esc(c.impacto)}">impacto ${esc(c.impacto)}</span><p>${esc(c.motivo)}</p></div></li>`).join('')}</ol></div>

    <h3 class="sec-title">Alternativas</h3>
    <div class="alts">${(r.alternativas || []).map((a, i) => `<div class="card alt pop" style="--d:${i * 60}ms"><h4>${esc(a.titulo)}</h4><small>${esc(a.ocasion)}</small>
      <div class="chips static">${(a.prendas || []).map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div><p>${esc(a.por_que)}</p></div>`).join('')}</div>

    <div class="card pop"><h3 class="ch"><span>⌚</span>Accesorios</h3>
      ${(r.accesorios || []).map((a) => `<p><b>${esc(a.accesorio)}:</b> ${esc(a.consejo)}</p>`).join('')}</div>
    ${footer(it)}
    <div class="row2"><a class="btn btn-ghost big" href="#/historial">Historial</a><a class="btn btn-gold big" href="#/look">Otro look</a></div>`;
  $('[data-ph]', v).src = objUrl(it.photo || it.thumb);
}

function renderHair(v, it) {
  const r = it.result || {};
  if (r.foto_valida === false) { v.innerHTML = header('Mi <em>pelo</em>', '', { back: true }) + badPhoto(it, r.problema_foto); return; }
  const fc = r.forma_cara || {}, tp = r.tipo_pelo || {}, ca = r.corte_actual || {}, pe = r.peinado || {}, ba = r.barbero || {};
  v.innerHTML = `${header('Tu <em>pelo</em>', '', { back: true })}
    <section class="hero card pop">
      <img class="hero-img" data-ph alt="Tu foto">
      <div class="hero-txt">${ring(ca.puntuacion)}<p class="verdict">${ca.le_favorece ? 'Tu corte te favorece' : 'Tu corte se puede mejorar'}</p><span class="badge ${ca.le_favorece ? 'b-ok' : 'b-warn'}">Cara ${esc((fc.forma || '').toLowerCase())}</span></div>
    </section>
    <div class="card pop"><p class="lead">${esc(r.resumen)}</p></div>

    <div class="card pop"><h3 class="ch"><span>🧑</span>Cara y tipo de pelo</h3>
      <p><b>Forma ${esc((fc.forma || '').toLowerCase())}:</b> ${esc(fc.explicacion)}</p>
      <div class="facts">
        <div><small>Textura</small><b>${esc(tp.textura)}</b></div><div><small>Grosor</small><b>${esc(tp.grosor)}</b></div>
        <div><small>Densidad</small><b>${esc(tp.densidad)}</b></div><div><small>Canas</small><b>${esc(tp.canas)}</b></div>
      </div>
      ${tp.entradas_coronilla ? `<p class="muted small">${esc(tp.entradas_coronilla)}</p>` : ''}</div>

    <div class="card pop"><h3 class="ch"><span>✂️</span>Tu corte actual</h3><p>${esc(ca.descripcion)}</p><p>${esc(ca.valoracion)}</p></div>

    <div class="card pop"><h3 class="ch"><span>🪮</span>Cómo mejorar el peinado</h3><p class="muted">${esc(pe.actual)}</p>${list(pe.mejoras, 'ok')}</div>

    <div class="card pop"><h3 class="ch"><span>🏠</span>Paso a paso en casa</h3>
      <ol class="steps">${(r.pasos || []).map((p) => `<li><b>${esc(p.titulo)}</b><p>${esc(p.detalle)}</p></li>`).join('')}</ol></div>

    <div class="card pop"><h3 class="ch"><span>🧴</span>Productos</h3>
      ${(r.productos || []).map((p) => `<div class="prod"><h4>${esc(p.producto)}</h4><p>${esc(p.para_que)}</p>
        <div class="facts f3"><div><small>Cantidad</small><b>${esc(p.cantidad)}</b></div><div><small>Cuándo</small><b>${esc(p.cuando)}</b></div></div><p class="tip">👉 ${esc(p.como)}</p></div>`).join('')}</div>

    <div class="card pop barber"><h3 class="ch"><span>💈</span>Qué pedirle al barbero</h3>
      <blockquote id="bq">«${esc(ba.frase)}»</blockquote>
      <button class="btn btn-ghost sm" id="copy">📋 Copiar frase</button>
      <div class="facts f1"><div><small>Laterales</small><b>${esc(ba.laterales)}</b></div><div><small>Arriba</small><b>${esc(ba.arriba)}</b></div><div><small>Nuca</small><b>${esc(ba.nuca)}</b></div></div>
      <details><summary>Qué significa cada término</summary>${(ba.terminos || []).map((t) => `<p><b>${esc(t.termino)}:</b> ${esc(t.significado)}</p>`).join('')}</details></div>

    <h3 class="sec-title">3 cortes para ti</h3>
    <div class="alts">${(r.cortes || []).map((c, i) => `<div class="card alt cut pop" style="--d:${i * 60}ms"><span class="num">${i + 1}</span><h4>${esc(c.nombre)}</h4><p>${esc(c.descripcion)}</p><p class="muted small">${esc(c.por_que)}</p><p class="small">🗓️ ${esc(c.mantenimiento)}</p>
      <a class="btn btn-gold wide" href="#/probar/${it.id}:${i}">✨ Probar este corte</a></div>`).join('')}</div>

    ${r.barba ? `<div class="card pop"><h3 class="ch"><span>🧔</span>Barba</h3><p>${esc(r.barba)}</p></div>` : ''}
    ${it.set && it.set.length > 1 ? strip(it.set, `Analizado con ${it.set.length} fotos`) : ''}
    ${footer(it)}`;
  $('[data-ph]', v).src = objUrl(it.photo || it.thumb);
  $('#copy', v).onclick = async () => { try { await navigator.clipboard.writeText(ba.frase || ''); toast('Frase copiada'); } catch (_) { toast('No se pudo copiar'); } };
}

function renderCompare(v, it) {
  const r = it.result || {};
  const head = header('Comparar <em>peinado</em>', esc(r.estilo_referencia || ''), { back: true });
  const pair = `<div class="pair pop"><figure><img src="${objUrl(it.photo)}" alt="Tu pelo"><figcaption>Tú ahora</figcaption></figure><figure><img src="${objUrl(it.ref)}" alt="Referencia"><figcaption>Referencia</figcaption></figure></div>`;
  if (r.fotos_validas === false) { v.innerHTML = head + pair + `<div class="card err-card pop"><div class="err-ic">📷</div><div><h3>Alguna foto no sirve</h3><p>${esc(r.problema_foto)}</p><a class="btn btn-gold sm" href="#/probar">Cambiar fotos</a></div></div>`; return; }
  const lf = r.le_favorece || {}, ba = r.barbero || {};
  v.innerHTML = `${head}${pair}
    <div class="card pop score-card">${ring(lf.puntuacion)}<div><h3>¿Te favorece?</h3><p>${esc(lf.adaptacion)}</p></div></div>
    <div class="card pop"><h3 class="ch"><span>↔️</span>Diferencias</h3>
      ${(r.diferencias || []).map((d) => `<div class="diff"><h4>${esc(d.aspecto)}</h4><div class="facts f3"><div><small>Tú</small><b>${esc(d.tu_pelo)}</b></div><div><small>Referencia</small><b>${esc(d.referencia)}</b></div></div></div>`).join('')}</div>
    <div class="card pop"><h3 class="ch"><span>🙂</span>Para ti</h3>
      <p><b>Forma de cara:</b> ${esc(lf.forma_cara)}</p><p><b>Tipo de pelo:</b> ${esc(lf.tipo_pelo)}</p><p><b>Edad y estilo:</b> ${esc(lf.edad)}</p></div>
    <div class="card pop barber"><h3 class="ch"><span>💈</span>Qué pedirle al barbero</h3>
      <blockquote>«${esc(ba.frase)}»</blockquote>
      <button class="btn btn-ghost sm" id="copy">📋 Copiar frase</button>
      <div class="facts f1"><div><small>Laterales</small><b>${esc(ba.laterales)}</b></div><div><small>Arriba</small><b>${esc(ba.arriba)}</b></div><div><small>Nuca</small><b>${esc(ba.nuca)}</b></div></div></div>
    <div class="card pop"><h3 class="ch"><span>🏠</span>Cómo peinarlo</h3>
      <ol class="steps">${(r.pasos || []).map((p) => `<li><b>${esc(p.titulo)}</b><p>${esc(p.detalle)}</p></li>`).join('')}</ol></div>
    <div class="card pop"><h3 class="ch"><span>🧴</span>Productos</h3>
      ${(r.productos || []).map((p) => `<div class="prod"><h4>${esc(p.producto)}</h4><p class="small"><b>Cantidad:</b> ${esc(p.cantidad)}</p><p class="tip">👉 ${esc(p.como)}</p></div>`).join('')}</div>
    <div class="card pop"><h3 class="ch"><span>🗓️</span>Mantenimiento</h3><p>${esc(r.mantenimiento)}</p></div>
    ${strip(it.set, 'Tus fotos')}${strip(it.refs, 'Referencias')}
    <a class="btn btn-gold big wide" href="#/probar">✂️ Probar este peinado en mi foto</a>
    ${footer(it)}`;
  $('#copy', v).onclick = async () => { try { await navigator.clipboard.writeText(ba.frase || ''); toast('Frase copiada'); } catch (_) { toast('No se pudo copiar'); } };
}

function renderEdit(v, it) {
  const before = objUrl(it.photo), after = objUrl(it.after);
  v.innerHTML = `${header('Tu nuevo <em>peinado</em>', esc(it.label || ''), { back: true })}
    <div class="ba pop" id="ba" style="--pos:50%">
      <img src="${before}" alt="Antes" class="ba-before" draggable="false">
      <div class="ba-after"><img src="${after}" alt="Después" draggable="false"></div>
      <span class="ba-lab l">Antes</span><span class="ba-lab r">Después</span>
      <div class="ba-handle"><span>⇆</span></div>
      <input type="range" min="0" max="100" value="50" aria-label="Comparar antes y después" id="bar">
    </div>
    <p class="muted small center">Desliza para comparar antes y después</p>
    <div class="row2"><button class="btn btn-navy big" id="save">⬇️ Guardar</button><button class="btn btn-gold big" id="share">📤 Compartir</button></div>
    <div class="row2"><button class="btn btn-ghost big" id="only">👁️ Ver solo después</button><a class="btn btn-ghost big" href="#/probar">✨ Probar otro</a></div>
    ${it.extra ? `<h3 class="sec-title">También de perfil</h3><div class="pair pop"><figure><img src="${objUrl(it.extra.photo)}" alt="Perfil antes"><figcaption>Antes</figcaption></figure><figure><img src="${objUrl(it.extra.after)}" alt="Perfil después"><figcaption>Después</figcaption></figure></div>` : ''}
    ${strip(it.set, 'Fotos usadas como contexto (la ★ primera es la retocada)')}
    ${it.refs && it.refs.length > 1 ? strip(it.refs, 'Referencias copiadas') : ''}
    ${it.ref && !(it.refs && it.refs.length > 1) ? `<div class="card pop ref-thumb"><img src="${objUrl(it.ref)}" alt="Referencia"><div><p class="small"><b>Referencia copiada</b></p><p class="small muted">Peinado adaptado a tu cabeza y entradas.</p></div></div>` : ''}
    <div class="card pop"><p class="small"><b>Peinado:</b> ${esc(it.label || '')}</p><p class="small muted">Es una simulación hecha por IA: úsala como idea para hablar con tu barbero.</p></div>
    ${footer(it)}`;
  const ba = $('#ba', v), bar = $('#bar', v);
  const set = (p) => { ba.style.setProperty('--pos', p + '%'); bar.value = p; };
  bar.oninput = () => set(bar.value);
  // Arrastrar en cualquier punto de la imagen
  let drag = false;
  const at = (e) => { const r = ba.getBoundingClientRect(); set(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)).toFixed(1)); };
  ba.addEventListener('pointerdown', (e) => { drag = true; ba.setPointerCapture(e.pointerId); at(e); });
  ba.addEventListener('pointermove', (e) => drag && at(e));
  ba.addEventListener('pointerup', () => { drag = false; });
  ba.addEventListener('pointercancel', () => { drag = false; });
  // Pequeña animación de bienvenida
  setTimeout(() => { ba.classList.add('anim'); set(25); setTimeout(() => { set(50); setTimeout(() => ba.classList.remove('anim'), 600); }, 600); }, 400);

  const ext = it.after.type === 'image/png' ? 'png' : 'jpg';
  const fname = `mi-estilo-peinado-${new Date(it.date).toISOString().slice(0, 10)}.${ext}`;
  $('#save', v).onclick = () => { const a = document.createElement('a'); a.href = after; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); toast('Imagen guardada en Descargas'); };
  $('#share', v).onclick = async () => {
    const file = new File([it.after], fname, { type: it.after.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Mi nuevo peinado', text: 'Mira este peinado (simulación de Mi Estilo)' }); }
      catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir'); }
    } else { $('#save', v).click(); }
  };
  $('#only', v).onclick = (e) => { const on = ba.classList.toggle('only'); e.target.textContent = on ? '⇆ Comparar' : '👁️ Ver solo después'; };
}

// ------------------------------------------------------------------ AJUSTES
const VISION_MODELS = [['gpt-5.5', 'gpt-5.5 · la mejor calidad (más cara)'], ['gpt-5.4', 'gpt-5.4 · recomendado'], ['gpt-5.4-mini', 'gpt-5.4-mini · rápido y barato'], ['gpt-5-mini', 'gpt-5-mini · muy barato'], ['gpt-4.1', 'gpt-4.1 · sin razonamiento'], ['gpt-4o', 'gpt-4o']];
const IMAGE_MODELS = [['gpt-image-2', 'gpt-image-2 · recomendado'], ['gpt-image-1.5', 'gpt-image-1.5'], ['gpt-image-1-mini', 'gpt-image-1-mini · barato']];
const sel = (id, opts, val) => `<select id="${id}">${opts.some(([v]) => v === val) ? '' : `<option value="${esc(val)}" selected>${esc(val)}</option>`}${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

routes.ajustes = async (v) => {
  const info = await db.apiKeyInfo();
  v.innerHTML = `${header('Ajustes', '', { back: true, gear: false })}
    <div class="card pop"><h3 class="ch"><span>🔑</span>Clave de OpenAI</h3>
      ${info ? `<div class="key-show"><code>••••••••${esc(info.hint)}</code><span class="badge b-ok">Guardada</span></div>
        <p class="muted small">Guardada cifrada solo en este móvil el ${esc(new Date(info.saved).toLocaleDateString('es-ES'))}.</p>` :
        `<p class="muted">Aún no has guardado ninguna clave. Créala en <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a> y pégala aquí.</p>`}
      <form id="kf" autocomplete="off"><input id="kin" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${info ? 'Pegar una clave nueva' : 'Pega aquí tu clave'}">
      <button class="btn btn-gold wide" type="submit">Guardar clave</button></form>
      <div id="kmsg"></div>
      <div class="row2"><button class="btn btn-navy" id="test" ${info ? '' : 'disabled'}>🧪 Probar clave</button><button class="btn btn-ghost danger-t" id="del" ${info ? '' : 'disabled'}>🗑️ Borrar clave</button></div>
    </div>

    <div class="card pop"><h3 class="ch"><span>🧠</span>Modelos</h3>
      <label>Análisis de fotos (look y pelo)</label>${sel('vm', VISION_MODELS, settings.visionModel)}
      <label>Si falla, usar</label>${sel('vf', VISION_MODELS, settings.visionFallback)}
      <label>Profundidad del análisis</label>${sel('rs', [['none', 'Mínima · más rápido'], ['low', 'Normal · recomendado'], ['medium', 'Alta · más lento y caro']], settings.reasoning)}
      <label>Probar peinado (edición de imagen)</label>${sel('im', IMAGE_MODELS, settings.imageModel)}
      <label>Si falla, usar</label>${sel('if', IMAGE_MODELS, settings.imageFallback)}
      <label>Calidad de imagen</label>${sel('iq', [['low', 'Baja · barata'], ['medium', 'Media · recomendada'], ['high', 'Alta · ~3× más cara']], settings.imageQuality)}
      <button class="btn btn-link" id="reset">Restaurar valores recomendados</button>
    </div>

    <div class="card pop"><h3 class="ch"><span>💶</span>Coste aproximado</h3>
      <p>Análisis de look: <b>${api.fmtEur(api.estimateEur('look', settings))}</b><br>Análisis de pelo: <b>${api.fmtEur(api.estimateEur('hair', settings))}</b><br>Probar peinado: <b>${api.fmtEur(api.estimateEur('edit', settings))}</b></p>
      <p class="muted small">Calculado con las tarifas públicas de OpenAI y los tokens usados. Lo que cuenta es tu factura en platform.openai.com.</p>
      <button class="btn btn-link" id="rstats">Poner a cero el contador del mes</button>
    </div>

    <div class="card pop"><h3 class="ch"><span>🔒</span>Privacidad</h3>
      <p class="small">La clave y el historial se guardan solo en este móvil. Las fotos solo se envían a OpenAI cuando pulsas <b>Analizar</b> o <b>Generar</b>, y se piden sin almacenamiento (<i>store: false</i>). Esta app no tiene servidor propio.</p>
      <button class="btn btn-ghost wide" id="onb">Ver pantalla de bienvenida</button>
    </div>
    <p class="res-foot">Mi Estilo ${APP_VERSION}</p>`;

  $('#kf', v).onsubmit = async (e) => {
    e.preventDefault();
    const val = $('#kin', v).value.trim();
    if (await storeKey(val, $('#kmsg', v))) { $('#kin', v).value = ''; route(); }
  };
  $('#test', v).onclick = async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Probando…';
    const m = $('#kmsg', v);
    try {
      const key = await getKeyOrFail();
      const r = await api.testKey(key, settings);
      const ok = (x) => x ? '✅' : '❌';
      m.innerHTML = `<div class="msg ${r.credit === false ? 'bad' : 'good'}"><b>La clave funciona.</b><br>
        ${ok(r.vision)} ${esc(settings.visionModel)} &nbsp; ${ok(r.image)} ${esc(settings.imageModel)}<br>
        ${r.credit === true ? '✅ Hay saldo en la cuenta' : r.credit === false ? '❌ La cuenta no tiene saldo: añade crédito en platform.openai.com → Billing' : 'Saldo: no se ha podido comprobar'}</div>`;
    } catch (err) { m.innerHTML = errorCard(err); }
    b.disabled = false; b.textContent = '🧪 Probar clave';
  };
  $('#del', v).onclick = async () => {
    if (!(await confirmBox('¿Borrar la clave de este móvil?', 'Borrar clave'))) return;
    await db.deleteApiKey(); state.hasKey = false; state.keyHint = ''; toast('Clave borrada'); route();
  };
  const bind = (id, k) => { $('#' + id, v).onchange = (e) => { settings[k] = e.target.value; saveSettings(); toast('Guardado'); }; };
  bind('vm', 'visionModel'); bind('vf', 'visionFallback'); bind('rs', 'reasoning'); bind('im', 'imageModel'); bind('if', 'imageFallback'); bind('iq', 'imageQuality');
  $('#reset', v).onclick = () => { Object.assign(settings, { ...DEFAULTS, onboarded: true }); saveSettings(); toast('Valores recomendados'); route(); };
  $('#rstats', v).onclick = async () => { if (await confirmBox('¿Poner a cero el contador de este mes?', 'Poner a cero')) { localStorage.removeItem(STATS_KEY); toast('Contador a cero'); } };
  $('#onb', v).onclick = () => { location.hash = '#/bienvenida'; };
};

// ------------------------------------------------------------------ arranque
async function init() {
  try { const info = await db.apiKeyInfo(); state.hasKey = !!info; state.keyHint = info ? info.hint : ''; } catch (_) { /* IndexedDB no disponible */ }
  window.addEventListener('offline', () => toast('Sin conexión a internet 📡'));
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
