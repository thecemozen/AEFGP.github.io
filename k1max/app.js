import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { CATEGORIES, SLOT_COLORS, SLOT_COUNT } from './presets.js';
import { load3MF } from './threemf.js';
import { K1MAX_BED_STL_B64 } from './bed-model.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'k1max-slicer-v2';
const bridge = window.AndroidBridge || null;
const clone = (o) => JSON.parse(JSON.stringify(o));

// ================================================================= durum ve profiller
let state = null;
state = loadState();
let viewRadius = 480;
let result = null;

function presetValues(cat, name) {
  const C = CATEGORIES[cat];
  const user = state && state.user && state.user[cat] && state.user[cat][name];
  if (user) return Object.assign(clone(C.base), clone(user));
  return Object.assign(clone(C.base), clone(C.presets[name] || C.presets[C.def] || {}));
}
function presetNames(cat) {
  return { sys: Object.keys(CATEGORIES[cat].presets), user: Object.keys((state.user && state.user[cat]) || {}) };
}
function presetExists(cat, name) { return !!(CATEGORIES[cat].presets[name] || (state.user[cat] || {})[name]); }

function defaultState() {
  const s = { user: { printer: {}, filament: {}, process: {} }, cat: 'process', filSlot: 0, sec: 'Kalite', advanced: false, colorBy: 'type' };
  s.printer = { name: CATEGORIES.printer.def, values: null };
  s.process = { name: CATEGORIES.process.def, values: null };
  s.slots = [];
  for (let i = 0; i < SLOT_COUNT; i++) s.slots.push({ name: 'Genel PLA', color: SLOT_COLORS[i], values: null });
  return s;
}
function loadState() {
  let s = defaultState();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const st = JSON.parse(raw);
      if (st && st.printer && st.process && Array.isArray(st.slots)) s = Object.assign(s, st);
    }
  } catch (e) { /* depolama yok */ }
  state = s; // presetValues state.user'ı okur
  const fix = (cat, w) => {
    if (!presetExists(cat, w.name)) w.name = CATEGORIES[cat].def;
    w.values = Object.assign(presetValues(cat, w.name), w.values || {});
  };
  fix('printer', s.printer); fix('process', s.process);
  while (s.slots.length < SLOT_COUNT) s.slots.push({ name: 'Genel PLA', color: SLOT_COLORS[s.slots.length], values: null });
  s.slots.forEach(sl => fix('filament', sl));
  return s;
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* yok say */ }
}
function working(cat) { return cat === 'filament' ? state.slots[state.filSlot] : state[cat]; }
function isModified(cat, w) {
  w = w || working(cat);
  const p = presetValues(cat, w.name);
  return Object.keys(CATEGORIES[cat].base).some(k => !same(p[k], w.values[k]));
}
function same(a, b) {
  if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return true;
  return String(a) === String(b);
}
function loadPreset(cat, name, w) {
  w = w || working(cat);
  w.name = name;
  w.values = presetValues(cat, name);
  saveState();
}

// ================================================================= ayarlar ekranı
function fillPresetSelect(sel, cat, cur) {
  const { sys, user } = presetNames(cat);
  sel.innerHTML = '';
  const g1 = document.createElement('optgroup'); g1.label = 'Hazır profiller';
  sys.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; g1.appendChild(o); });
  sel.appendChild(g1);
  if (user.length) {
    const g2 = document.createElement('optgroup'); g2.label = 'Kendi profillerim';
    user.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = '★ ' + n; g2.appendChild(o); });
    sel.appendChild(g2);
  }
  sel.value = cur;
}

function renderSettings() {
  const cat = state.cat;
  const C = CATEGORIES[cat];
  const w = working(cat);
  document.querySelectorAll('#cats button').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
  $('bedCard').hidden = cat !== 'printer';
  const fs = $('filSlots');
  fs.innerHTML = '';
  if (cat === 'filament') {
    state.slots.forEach((sl, i) => {
      const b = document.createElement('button');
      b.className = i === state.filSlot ? 'on' : '';
      b.innerHTML = `<span class="sw" style="background:${sl.color}"></span>Yuva ${i + 1}`;
      b.title = sl.name;
      b.onclick = () => { state.filSlot = i; saveState(); renderSettings(); };
      fs.appendChild(b);
    });
  }
  fillPresetSelect($('presetSel'), cat, w.name);
  const mod = isModified(cat, w);
  $('modBadge').hidden = !mod;
  $('pDelete').disabled = !(state.user[cat] || {})[w.name];
  $('pReset').disabled = !mod;
  $('advanced').checked = !!state.advanced;

  const q = $('search').value.trim().toLocaleLowerCase('tr');
  const secs = [...new Set(C.schema.map(g => g.sec).filter(Boolean))];
  const sc = $('secChips');
  sc.innerHTML = '';
  if (secs.length && !q) {
    if (!secs.includes(state.sec)) state.sec = secs[0];
    secs.forEach(s => {
      const b = document.createElement('button');
      b.textContent = s; b.className = s === state.sec ? 'on' : '';
      b.onclick = () => { state.sec = s; saveState(); renderSettings(); };
      sc.appendChild(b);
    });
  }
  const preset = presetValues(cat, w.name);
  const body = $('settingsBody');
  body.innerHTML = '';
  let shown = 0;
  C.schema.forEach(g => {
    if (secs.length && !q && g.sec !== state.sec) return;
    if (g.adv && !state.advanced && !q) return;
    const items = g.items.filter(it => {
      if (q) return (it.l + ' ' + (it.tip || '') + ' ' + g.g).toLocaleLowerCase('tr').includes(q);
      return state.advanced || !it.adv;
    });
    if (!items.length) return;
    const d = document.createElement('details');
    d.className = 'card'; d.open = true;
    const sm = document.createElement('summary'); sm.textContent = g.g; d.appendChild(sm);
    items.forEach(it => { d.appendChild(settingRow(cat, w, it, preset)); shown++; });
    body.appendChild(d);
  });
  if (!shown) body.innerHTML = '<p class="hint">Eşleşen ayar yok.</p>';
}

function settingRow(cat, w, it, preset) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('span');
  lab.className = 'lbl';
  lab.textContent = it.l;
  let tipEl = null;
  if (it.tip) {
    const qb = document.createElement('button');
    qb.className = 'q'; qb.type = 'button'; qb.textContent = '?';
    qb.onclick = () => { tipEl.hidden = !tipEl.hidden; };
    lab.appendChild(qb);
    tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.textContent = it.tip; tipEl.hidden = true;
  }
  row.appendChild(lab);
  const v = w.values[it.k];
  let input;
  const markMod = () => input.classList.toggle('mod', !same(preset[it.k], w.values[it.k]));
  const commit = (val) => { w.values[it.k] = val; markMod(); settingsChanged(cat); };
  if (it.t === 'g') {
    wrap.appendChild(row);
    input = document.createElement('textarea');
    input.value = v || '';
    input.onchange = () => commit(input.value);
    wrap.appendChild(input);
    if (tipEl) wrap.appendChild(tipEl);
    markMod();
    return wrap;
  }
  if (it.t === 'b') {
    input = document.createElement('input'); input.type = 'checkbox'; input.className = 'toggle'; input.checked = !!v;
    input.onchange = () => commit(input.checked);
    row.appendChild(input);
  } else if (it.t === 's') {
    input = document.createElement('select');
    Object.entries(it.o).forEach(([val, t]) => { const o = document.createElement('option'); o.value = val; o.textContent = t; input.appendChild(o); });
    input.value = String(v);
    input.onchange = () => commit(typeof CATEGORIES[cat].base[it.k] === 'number' ? +input.value : input.value);
    row.appendChild(input);
  } else if (it.t === 'x') {
    input = document.createElement('input'); input.type = 'text'; input.className = 'txt'; input.value = v ?? '';
    input.onchange = () => commit(input.value.trim());
    row.appendChild(input);
  } else { // n, on
    const box = document.createElement('span'); box.className = 'inp';
    input = document.createElement('input'); input.type = 'number';
    input.step = it.s; input.min = it.min; input.max = it.max;
    input.value = (v === null || v === undefined) ? '' : v;
    if (it.t === 'on') input.placeholder = cat === 'filament' ? 'yazıcı' : 'varsay.';
    input.onchange = () => {
      if (it.t === 'on' && input.value === '') { commit(null); return; }
      let x = parseFloat(input.value);
      if (isNaN(x)) x = (v === null || v === undefined) ? it.min : v;
      x = Math.min(it.max, Math.max(it.min, x));
      input.value = x; commit(x);
    };
    box.appendChild(input);
    if (it.u) { const em = document.createElement('em'); em.textContent = it.u; box.appendChild(em); }
    row.appendChild(box);
  }
  wrap.appendChild(row);
  if (tipEl) wrap.appendChild(tipEl);
  markMod();
  return wrap;
}

function settingsChanged(cat) {
  saveState();
  $('modBadge').hidden = !isModified(cat);
  $('pReset').disabled = !isModified(cat);
  if (cat === 'printer') { syncDeviceFields(); buildBed(); placeAll(); }
  renderQuick();
  invalidate();
}
function invalidate() {
  if (result) $('stats').innerHTML = '<span>Ayarlar değişti — güncel G-code için tekrar <b>Dilimle</b>.</span>';
}

$('cats').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.cat = b.dataset.cat; $('search').value = ''; saveState(); renderSettings(); });
$('search').addEventListener('input', renderSettings);
$('advanced').addEventListener('change', () => { state.advanced = $('advanced').checked; saveState(); renderSettings(); });
$('presetSel').addEventListener('change', async () => {
  const cat = state.cat, name = $('presetSel').value, w = working(cat);
  if (isModified(cat) && !(await confirmDlg('Kaydedilmemiş değişiklikler', `"${w.name}" profilindeki değişiklikler kaybolacak.`, 'Profili değiştir'))) {
    $('presetSel').value = w.name; return;
  }
  loadPreset(cat, name); renderSettings(); renderQuick(); invalidate();
  if (cat === 'printer') { syncDeviceFields(); buildBed(); placeAll(); }
});
$('pSave').addEventListener('click', async () => {
  const cat = state.cat, w = working(cat);
  if ((state.user[cat] || {})[w.name]) {
    state.user[cat][w.name] = clone(w.values);
    saveState(); renderSettings(); renderQuick(); toast(`"${w.name}" kaydedildi.`);
  } else saveAs();
});
$('pSaveAs').addEventListener('click', saveAs);
async function saveAs() {
  const cat = state.cat, w = working(cat);
  const name = await promptDlg('Profili farklı kaydet', 'Profil adı', (state.user[cat] || {})[w.name] ? w.name : w.name + ' (kendi)');
  if (!name) return;
  if (CATEGORIES[cat].presets[name]) { toast('Hazır profil adı kullanılamaz.', true); return; }
  state.user[cat] = state.user[cat] || {};
  state.user[cat][name] = clone(w.values);
  w.name = name;
  saveState(); renderSettings(); renderQuick(); toast(`"${name}" kaydedildi.`);
}
$('pDelete').addEventListener('click', async () => {
  const cat = state.cat, w = working(cat);
  if (!(state.user[cat] || {})[w.name]) return;
  if (!(await confirmDlg('Profili sil', `"${w.name}" silinsin mi?`, 'Sil'))) return;
  const gone = w.name;
  delete state.user[cat][gone];
  if (cat === 'filament') state.slots.forEach(sl => { if (sl.name === gone) loadPreset('filament', CATEGORIES.filament.def, sl); });
  else loadPreset(cat, CATEGORIES[cat].def);
  saveState(); renderSettings(); renderQuick();
});
$('pReset').addEventListener('click', () => {
  const cat = state.cat; loadPreset(cat, working(cat).name); renderSettings(); renderQuick(); invalidate();
  if (cat === 'printer') { syncDeviceFields(); buildBed(); placeAll(); }
});
$('exportProfile').addEventListener('click', () => {
  download(new Blob([JSON.stringify({ k1maxProfiles: 2, user: state.user, printer: state.printer, process: state.process, slots: state.slots }, null, 2)], { type: 'application/json' }), 'k1max-profiller.json');
});
$('importProfile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d.user) throw new Error('geçersiz');
    ['printer', 'filament', 'process'].forEach(c => { state.user[c] = Object.assign(state.user[c] || {}, d.user[c] || {}); });
    if (d.printer) state.printer = d.printer;
    if (d.process) state.process = d.process;
    if (Array.isArray(d.slots)) state.slots = d.slots;
    saveState(); state = loadState(); renderAll(); buildBed(); placeAll(); toast('Profiller içe aktarıldı.');
  } catch (err) { toast('Profil dosyası okunamadı.', true); }
});
$('resetAll').addEventListener('click', async () => {
  if (!(await confirmDlg('Fabrika ayarları', 'Kendi profilleriniz dahil tüm ayarlar silinecek.', 'Hepsini sıfırla'))) return;
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* yok */ }
  state = loadState(); renderAll(); buildBed(); placeAll(); toast('Varsayılan K1 Max ayarlarına dönüldü.');
});

$('bedTexFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  try { localStorage.setItem(BED_TEX_KEY, url); buildBed(); toast('Tabla dokusu güncellendi.'); }
  catch (err) { toast('Resim çok büyük, saklanamadı. Daha küçük bir resim deneyin (en fazla ~4 MB).', true); }
});
$('bedTexReset').addEventListener('click', () => { try { localStorage.removeItem(BED_TEX_KEY); } catch (e) { /* yok */ } buildBed(); });

// ================================================================= Model sekmesi: hızlı seçim ve yuvalar
function renderQuick() {
  fillPresetSelect($('qPrinter'), 'printer', state.printer.name);
  fillPresetSelect($('qProcess'), 'process', state.process.name);
  const P = state.process.values;
  const pat = { grid: 'ızgara', gyroid: 'gyroid', cubic: 'kübik', triangles: 'üçgen', rectilinear: 'doğrusal', concentric: 'eş merkezli' }[P.infillPattern] || P.infillPattern;
  $('qHint').textContent = `Katman ${P.layerHeight} mm · ${P.wallLoops} duvar · %${P.infillDensity} ${pat}` +
    (P.supportEnable ? ' · destek açık' : '') + (P.spiralVase ? ' · vazo modu' : '') +
    (isModified('process', state.process) ? ' · (değiştirildi)' : '');
  const list = $('slotList');
  list.innerHTML = '';
  state.slots.forEach((sl, i) => {
    const row = document.createElement('div'); row.className = 'slot';
    const n = document.createElement('b'); n.textContent = i + 1;
    const col = document.createElement('input'); col.type = 'color'; col.value = sl.color;
    col.oninput = () => { sl.color = col.value; saveState(); recolorParts(); renderParts(); refreshPreviewColors(); };
    const sel = document.createElement('select');
    fillPresetSelect(sel, 'filament', sl.name);
    sel.onchange = () => { loadPreset('filament', sel.value, sl); if (state.cat === 'filament') renderSettings(); renderQuick(); invalidate(); };
    row.append(n, col, sel);
    if (isModified('filament', sl)) { const m = document.createElement('span'); m.className = 'badge'; m.textContent = '*'; m.title = 'değiştirildi'; row.appendChild(m); }
    list.appendChild(row);
  });
  renderParts();
}
$('qPrinter').addEventListener('change', async () => {
  if (isModified('printer', state.printer) && !(await confirmDlg('Kaydedilmemiş değişiklikler', 'Yazıcı profilindeki değişiklikler kaybolacak.', 'Değiştir'))) { renderQuick(); return; }
  loadPreset('printer', $('qPrinter').value, state.printer); renderAll(); buildBed(); placeAll();
});
$('qProcess').addEventListener('change', async () => {
  if (isModified('process', state.process) && !(await confirmDlg('Kaydedilmemiş değişiklikler', 'İşlem profilindeki değişiklikler kaybolacak.', 'Değiştir'))) { renderQuick(); return; }
  loadPreset('process', $('qProcess').value, state.process); renderAll(); invalidate();
});

// ================================================================= 3B sahne
const wrap = $('canvasWrap');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
wrap.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(150, 150, 20);
controls.enableDamping = true;
function addLights(sc) {
  sc.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.6); d1.position.set(200, -100, 400); sc.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.6); d2.position.set(-100, 400, 200); sc.add(d2);
}
addLights(scene);
const bedSize = () => ({ x: state.printer.values.bedX, y: state.printer.values.bedY, z: state.printer.values.bedZ });

function themeColors() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? { bg: 0x2a2c30, vol: 0x45484f } : { bg: 0xd7dade, vol: 0xb4b9c1 };
}
const BED_TEX_KEY = 'k1max-bed-texture';
let bedGroup, bedPlateGeom = null, gridTexture = null;

// K1 Max tabla modeli (yüklediğiniz STL): merkezi orijinde, üst yüzeyi z=0
function k1PlateGeometry() {
  if (!bedPlateGeom) {
    const bin = atob(K1MAX_BED_STL_B64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    bedPlateGeom = new STLLoader().parse(u8.buffer);
    bedPlateGeom.computeVertexNormals();
  }
  return bedPlateGeom;
}
// Creality Print tarzı ızgara: 10 mm ince, 50 mm kalın çizgi, kesişimlerde nokta
function gridCanvasTexture(bx, by) {
  const ppm = 2048 / Math.max(bx, by);
  const cv = document.createElement('canvas');
  cv.width = Math.round(bx * ppm); cv.height = Math.round(by * ppm);
  const g = cv.getContext('2d');
  const X = (mm) => mm * ppm, Y = (mm) => cv.height - mm * ppm;
  const line = (x0, y0, x1, y1, w, a) => { g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w; g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke(); };
  for (let x = 0; x <= bx + 0.01; x += 10) line(x, 0, x, by, x % 50 === 0 ? 2.6 : 1.4, x % 50 === 0 ? 0.24 : 0.12);
  for (let y = 0; y <= by + 0.01; y += 10) line(0, y, bx, y, y % 50 === 0 ? 2.6 : 1.4, y % 50 === 0 ? 0.24 : 0.12);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (let x = 50; x < bx; x += 50) for (let y = 50; y < by; y += 50) { g.beginPath(); g.arc(X(x), Y(y), 4, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 4; g.strokeRect(2, 2, cv.width - 4, cv.height - 4);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function bedTexture(bx, by, cb) {
  let custom = null;
  try { custom = localStorage.getItem(BED_TEX_KEY); } catch (e) { /* yok */ }
  if (custom) {
    new THREE.TextureLoader().load(custom, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); cb(t, true); },
      undefined, () => cb(gridCanvasTexture(bx, by), false));
  } else cb(gridCanvasTexture(bx, by), false);
}

function buildBed() {
  if (bedGroup) { scene.remove(bedGroup); if (gridTexture) gridTexture.dispose(); }
  const c = themeColors(), B = bedSize();
  scene.background = new THREE.Color(c.bg);
  bedGroup = new THREE.Group();
  const isK1 = B.x === 300 && B.y === 300;
  // tabla gövdesi
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x3a3d43, roughness: 0.75, metalness: 0.25 });
  let plate;
  if (isK1) {
    plate = new THREE.Mesh(k1PlateGeometry(), plateMat);
    plate.position.set(B.x / 2, B.y / 2, 0);
  } else {
    plate = new THREE.Mesh(new THREE.BoxGeometry(B.x + 10, B.y + 10, 1), plateMat);
    plate.position.set(B.x / 2, B.y / 2, -0.5);
  }
  bedGroup.add(plate);
  // ızgara / doku: baskı alanının üstüne ince bir katman
  const top = new THREE.Mesh(new THREE.PlaneGeometry(B.x, B.y),
    new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  top.position.set(B.x / 2, B.y / 2, 0.01);
  top.renderOrder = 1;
  bedGroup.add(top);
  bedTexture(B.x, B.y, (t, custom) => {
    gridTexture = t; top.material.map = t;
    if (custom) { top.material.transparent = false; top.material.color.set(0xffffff); }
    top.material.needsUpdate = true;
  });
  // eksen göstergesi (0,0 noktası)
  const ax = (x, y, z, col) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.05, x, y, z + 0.05], 3));
    bedGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: col })));
  };
  ax(25, 0, 0, 0xe5484d); ax(0, 25, 0, 0x2fbf6c); ax(0, 0, 25, 0x4b82f5);
  // baskı hacmi (soluk)
  const vol = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(B.x, B.y, B.z)), c.vol);
  vol.material.transparent = true; vol.material.opacity = 0.35;
  bedGroup.add(vol);
  scene.add(bedGroup);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', buildBed);

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

function setView(v) {
  // dikey (telefon) ekranda yatay görüş daraldığı için uzaklaş
  const t = controls.target, r = viewRadius / Math.min(1, camera.aspect) * (parts.length ? 1 : 1.1);
  if (v === 'top') camera.position.set(t.x, t.y - 0.01, t.z + r);
  else if (v === 'front') camera.position.set(t.x, t.y - r, t.z + 20);
  else camera.position.set(t.x - r * 0.45, t.y - r * 0.6, t.z + r * 0.5);
  controls.update();
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ================================================================= parçalar
let parts = []; // { name, geom (model uzayı), slot, mesh }
const partsGroup = new THREE.Group();
scene.add(partsGroup);

function partMaterial(slot) {
  return new THREE.MeshStandardMaterial({ color: state.slots[slot] ? state.slots[slot].color : '#2fa36b', roughness: 0.55, metalness: 0.05 });
}
function recolorParts() { parts.forEach(p => { if (p.mesh) p.mesh.material.color.set(state.slots[p.slot].color); }); }

function addParts(list, replace) {
  if (replace) { parts.forEach(p => { partsGroup.remove(p.mesh); p.mesh.geometry.dispose(); }); parts = []; $('scale').value = 100; }
  list.forEach(p => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), partMaterial(p.slot || 0));
    partsGroup.add(mesh);
    parts.push({ name: p.name, geom: g, slot: p.slot || 0, mesh });
  });
  placeAll();
  clearPreview();
  renderParts();
}

function placeAll() {
  const s = (parseFloat($('scale').value) || 100) / 100;
  if (!parts.length) { $('modelInfo').textContent = 'Model yüklenmedi. STL ya da 3MF açın veya buraya sürükleyin.'; updateButtons(false); return; }
  const bb = new THREE.Box3();
  parts.forEach(p => { p.geom.computeBoundingBox(); bb.union(p.geom.boundingBox); });
  const B = bedSize();
  const off = new THREE.Vector3(B.x / 2 - (bb.min.x + bb.max.x) / 2 * s, B.y / 2 - (bb.min.y + bb.max.y) / 2 * s, -bb.min.z * s);
  let tris = 0;
  parts.forEach(p => {
    const g = p.geom.clone(); g.scale(s, s, s); g.translate(off.x, off.y, off.z); g.computeVertexNormals(); g.computeBoundingBox();
    p.mesh.geometry.dispose(); p.mesh.geometry = g;
    tris += g.attributes.position.count / 3;
  });
  const sx = (bb.max.x - bb.min.x) * s, sy = (bb.max.y - bb.min.y) * s, sz = (bb.max.z - bb.min.z) * s;
  const fits = sx <= B.x && sy <= B.y && sz <= B.z;
  $('modelInfo').innerHTML = `${sx.toFixed(1)} × ${sy.toFixed(1)} × ${sz.toFixed(1)} mm · ${tris.toLocaleString('tr-TR')} üçgen · ${parts.length} parça` +
    (fits ? '' : '<br><span class="err">Model tablaya sığmıyor! Ölçeği küçültün.</span>');
  partsGroup.visible = $('showModel').checked || !result;
  controls.target.set(B.x / 2, B.y / 2, sz / 2);
  viewRadius = Math.min(560, Math.max(110, Math.max(sx, sy, sz) * 2.6));
  parts.forEach(p => p.mesh.material.emissive.set(fits ? 0x000000 : 0x550000));
  updateButtons(fits);
}

function renderParts() {
  const list = $('partList');
  list.innerHTML = '';
  parts.forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'part';
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = state.slots[p.slot].color;
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = p.name; nm.title = p.name;
    const sel = document.createElement('select');
    state.slots.forEach((sl, k) => { const o = document.createElement('option'); o.value = k; o.textContent = `Yuva ${k + 1}`; sel.appendChild(o); });
    sel.value = p.slot;
    sel.onchange = () => { p.slot = +sel.value; p.mesh.material.color.set(state.slots[p.slot].color); sw.style.background = state.slots[p.slot].color; invalidate(); };
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Parçayı kaldır';
    x.onclick = () => { partsGroup.remove(p.mesh); parts.splice(i, 1); placeAll(); clearPreview(); renderParts(); };
    row.append(sw, nm, sel, x);
    list.appendChild(row);
  });
}

function transformAll(m) {
  parts.forEach(p => p.geom.applyMatrix4(m));
  placeAll(); clearPreview();
}
document.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => {
  const m = new THREE.Matrix4(), a = b.dataset.rot;
  if (a === 'x') m.makeRotationX(Math.PI / 2); else if (a === 'y') m.makeRotationY(Math.PI / 2); else m.makeRotationZ(Math.PI / 2);
  transformAll(m);
}));
$('scale').addEventListener('change', () => { placeAll(); clearPreview(); });
$('layflat').addEventListener('click', () => {
  if (!parts.length) return;
  const acc = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  parts.forEach(pt => {
    const p = pt.geom.attributes.position.array;
    for (let i = 0; i < p.length; i += 9) {
      a.set(p[i], p[i + 1], p[i + 2]); b.set(p[i + 3], p[i + 4], p[i + 5]); c.set(p[i + 6], p[i + 7], p[i + 8]);
      n.subVectors(b, a).cross(c.clone().sub(a));
      const area = n.length() / 2; if (area < 1e-9) continue;
      n.normalize();
      const key = `${Math.round(n.x * 50)},${Math.round(n.y * 50)},${Math.round(n.z * 50)}`;
      const e = acc.get(key) || { area: 0, n: new THREE.Vector3() };
      e.area += area; e.n.addScaledVector(n, area); acc.set(key, e);
    }
  });
  let best = null;
  acc.forEach(e => { if (!best || e.area > best.area) best = e; });
  if (!best) return;
  const q = new THREE.Quaternion().setFromUnitVectors(best.n.clone().normalize(), new THREE.Vector3(0, 0, -1));
  transformAll(new THREE.Matrix4().makeRotationFromQuaternion(q));
  toast('En geniş yüzey tablaya yatırıldı.');
});

// Birbirine değmeyen gövdeleri ayrı parçalara böl
$('split').addEventListener('click', () => {
  if (!parts.length) return;
  const out = [];
  parts.forEach(p => {
    const pos = p.geom.attributes.position.array;
    const nT = pos.length / 9;
    const key = (i) => `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
    const vid = new Map(); const idx = new Uint32Array(nT * 3);
    for (let i = 0; i < nT * 3; i++) { const k = key(i); let id = vid.get(k); if (id === undefined) { id = vid.size; vid.set(k, id); } idx[i] = id; }
    const parent = new Int32Array(vid.size).map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let t = 0; t < nT; t++) { const r0 = find(idx[t * 3]); parent[find(idx[t * 3 + 1])] = r0; parent[find(idx[t * 3 + 2])] = find(idx[t * 3]); }
    const groups = new Map();
    for (let t = 0; t < nT; t++) { const r = find(idx[t * 3]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); }
    if (groups.size === 1) { out.push({ name: p.name, positions: pos, slot: p.slot }); return; }
    let k = 1;
    [...groups.values()].sort((A, B) => B.length - A.length).forEach(ts => {
      const arr = new Float32Array(ts.length * 9);
      ts.forEach((t, j) => arr.set(pos.subarray(t * 9, t * 9 + 9), j * 9));
      out.push({ name: `${p.name} #${k++}`, positions: arr, slot: p.slot });
    });
  });
  const before = parts.length;
  const keepScale = $('scale').value;
  addParts(out, true);
  $('scale').value = keepScale; placeAll();
  toast(out.length > before ? `${out.length} parçaya ayrıldı. Her parçaya yuva atayabilirsiniz.` : 'Ayrılacak ayrı gövde bulunamadı.');
});

// Parçaları tablaya yan yana diz
$('arrange').addEventListener('click', () => {
  if (parts.length < 2) return;
  const s = (parseFloat($('scale').value) || 100) / 100, gap = 8 / s, B = bedSize();
  const items = parts.map(p => { p.geom.computeBoundingBox(); return { p, b: p.geom.boundingBox.clone() }; })
    .sort((a, b) => (b.b.max.y - b.b.min.y) - (a.b.max.y - a.b.min.y));
  let x = 0, y = 0, rowH = 0;
  const maxW = (B.x - 20) / s;
  items.forEach(({ p, b }) => {
    const w = b.max.x - b.min.x, h = b.max.y - b.min.y;
    if (x > 0 && x + w > maxW) { x = 0; y += rowH + gap; rowH = 0; }
    p.geom.translate(x - b.min.x, y - b.min.y, -b.min.z);
    x += w + gap; rowH = Math.max(rowH, h);
  });
  placeAll(); clearPreview();
});

// ================================================================= dosya yükleme
const stlLoader = new STLLoader();
async function readModel(file) {
  const buf = await file.arrayBuffer();
  const name = (file.name || 'model').replace(/\.(stl|3mf)$/i, '');
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (/\.3mf$/i.test(file.name) || isZip) {
    const r = await load3MF(buf);
    r.warnings.forEach(w => toast(w, true));
    return r.parts;
  }
  const geom = stlLoader.parse(buf);
  const g = geom.index ? geom.toNonIndexed() : geom;
  if (!g.attributes.position || g.attributes.position.count < 3) throw new Error('boş model');
  return [{ name, positions: new Float32Array(g.attributes.position.array), slot: 0 }];
}
async function loadFiles(files, replace) {
  files = [...files].filter(Boolean);
  if (!files.length) return;
  try {
    let all = [];
    for (const f of files) {
      if (/\.[a-z0-9]{2,5}$/i.test(f.name) && !/\.(stl|3mf)$/i.test(f.name)) { toast('Yalnızca STL ve 3MF dosyaları destekleniyor.', true); continue; }
      all = all.concat(await readModel(f));
    }
    if (!all.length) return;
    // eklenen STL parçaları boş yuvalara dağıt
    if (!replace && parts.length) {
      const usedSlots = new Set(parts.map(p => p.slot));
      all.forEach(p => { if (p.slot === 0) { for (let k = 0; k < SLOT_COUNT; k++) if (!usedSlots.has(k)) { p.slot = k; usedSlots.add(k); break; } } });
    }
    addParts(all, replace);
    setView('iso');
    setTab('view');
    if (parts.length > 1) toast(`${parts.length} parça yüklendi. Model sekmesinden her parçanın yuvasını seçebilirsiniz.`);
  } catch (e) { toast('Dosya okunamadı: ' + e.message, true); }
}
$('file').addEventListener('change', e => { loadFiles(e.target.files, true); e.target.value = ''; });
$('fileAdd').addEventListener('change', e => { loadFiles(e.target.files, !parts.length); e.target.value = ''; });
['dragenter', 'dragover'].forEach(t => window.addEventListener(t, e => { e.preventDefault(); $('drop').classList.add('on'); }));
window.addEventListener('dragleave', e => { if (!e.relatedTarget) $('drop').classList.remove('on'); });
window.addEventListener('drop', e => { e.preventDefault(); $('drop').classList.remove('on'); loadFiles(e.dataTransfer.files, true); });

// Örnek modeller
function demoParts(multi) {
  const shape = new THREE.Shape(); const r = 3, W = 30;
  shape.moveTo(r, 0); shape.lineTo(W - r, 0); shape.quadraticCurveTo(W, 0, W, r); shape.lineTo(W, W - r);
  shape.quadraticCurveTo(W, W, W - r, W); shape.lineTo(r, W); shape.quadraticCurveTo(0, W, 0, W - r);
  shape.lineTo(0, r); shape.quadraticCurveTo(0, 0, r, 0);
  const pos = (g) => new Float32Array((g.index ? g.toNonIndexed() : g).attributes.position.array);
  if (!multi) {
    const hole = new THREE.Path(); hole.absarc(W / 2, W / 2, 7, 0, Math.PI * 2, true); shape.holes.push(hole);
    const base = new THREE.ExtrudeGeometry(shape, { depth: 15, bevelEnabled: false, curveSegments: 24 });
    const cyl = new THREE.CylinderGeometry(5, 5, 20, 48); cyl.rotateX(Math.PI / 2); cyl.translate(W / 2, W + 12, 10);
    const sph = new THREE.SphereGeometry(9, 48, 32); sph.translate(W + 16, W / 2, 9);
    const merged = [pos(base), pos(cyl), pos(sph)];
    const arr = new Float32Array(merged.reduce((n, a) => n + a.length, 0)); let o = 0;
    merged.forEach(a => { arr.set(a, o); o += a.length; });
    return [{ name: 'ornek-model', positions: arr, slot: 0 }];
  }
  // iki renkli rozet: taban (yuva 1) + kabartma yıldız (yuva 2)
  const base = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false, curveSegments: 16 });
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 4.5 : 11;
    const x = W / 2 + Math.cos(a) * rr, y = W / 2 + Math.sin(a) * rr;
    if (i) star.lineTo(x, y); else star.moveTo(x, y);
  }
  const top = new THREE.ExtrudeGeometry(star, { depth: 2, bevelEnabled: false }); top.translate(0, 0, 3);
  return [{ name: 'taban', positions: pos(base), slot: 0 }, { name: 'yildiz', positions: pos(top), slot: 1 }];
}
$('demo').addEventListener('click', () => { addParts(demoParts(false), true); setView('iso'); setTab('view'); });
$('demo2').addEventListener('click', () => $('demo').click());
$('demoMulti').addEventListener('click', () => { addParts(demoParts(true), true); setView('iso'); setTab('view'); toast('İki renkli örnek: taban Yuva 1, yıldız Yuva 2.'); });

// Android: dosya yöneticisinden "Birlikte aç"
window.k1LoadBase64 = (name, b64) => {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  loadFiles([new File([u8], name || 'model.stl')], true);
};

// ================================================================= dilimleme
let worker = null;
let preview = null;
const TYPE_INFO = [
  ['Dış duvar', 0xff8a3d], ['İç duvar', 0xffd23f], ['Katı dolgu', 0xb34ddb], ['Seyrek dolgu', 0xd9534f],
  ['Etek / kenarlık', 0x3fb8af], ['Boş hareket', 0x7aa7ff], ['Üst yüzey', 0xff4f8b], ['Destek', 0x46a35e],
  ['Destek arayüzü', 0x2e7d4a], ['Köprü', 0x4f8bd6], ['Ütüleme', 0xffb3c7], ['Temizleme kulesi', 0x9aa3ad],
];
const PV = 8;

function buildJob() {
  const S = Object.assign({}, state.printer.values, state.process.values);
  const fils = state.slots.map(sl => Object.assign({}, sl.values, { color: sl.color, name: sl.name }));
  const jobParts = parts.map(p => ({ name: p.name, slot: p.slot, positions: new Float32Array(p.mesh.geometry.attributes.position.array) }));
  return { parts: jobParts, S, fils };
}

function slice() {
  if (!parts.length || $('slice').disabled) return;
  const job = buildJob();
  if (job.S.thumbnail) {
    try { job.thumbnail = makeThumbnail(+job.S.thumbnailSize || 300); } catch (e) { job.thumbnail = null; }
  }
  if (worker) worker.terminate();
  $('busy').hidden = false; $('busyBar').style.width = '0%'; $('busyText').textContent = 'Hazırlanıyor…';
  updateButtons();
  startWorker(makeWorker(), job);
}
$('slice').addEventListener('click', slice);

function makeWorker() {
  if (window.K1_WORKER_SRC) {
    try { return new Worker(URL.createObjectURL(new Blob([window.K1_WORKER_SRC], { type: 'text/javascript' }))); }
    catch (e) { return mainThreadWorker(); }
  }
  return new Worker('slicer-worker.js');
}
function mainThreadWorker() {
  const w = { onmessage: null, onerror: null, terminate() { w.dead = true; } };
  w.postMessage = (msg) => setTimeout(() => {
    const send = (data) => { if (!w.dead && w.onmessage) w.onmessage({ data }); };
    try {
      const res = window.K1Slicer.slice(msg.job, (p, text) => send({ type: 'progress', p, text }));
      res.stats.ms = 0;
      send({ type: 'done', result: res });
    } catch (e) { send({ type: 'error', message: e && e.message ? e.message : String(e) }); }
  }, 50);
  return w;
}
function startWorker(w, job) {
  worker = w;
  let heard = false;
  const backup = window.K1Slicer ? { ...job, parts: job.parts.map(p => ({ ...p, positions: p.positions.slice() })) } : null;
  const done = () => { $('busy').hidden = true; updateButtons(); };
  worker.onmessage = (ev) => {
    heard = true;
    const m = ev.data;
    if (m.type === 'progress') { $('busyBar').style.width = (m.p * 100).toFixed(0) + '%'; $('busyText').textContent = m.text; }
    else if (m.type === 'done') { $('busy').hidden = true; onResult(m.result); worker.terminate(); worker = null; }
    else if (m.type === 'error') { done(); toast('Dilimleme hatası: ' + m.message, true); worker.terminate(); worker = null; }
  };
  worker.onerror = (e) => {
    if (!heard && backup) {
      worker.terminate();
      $('busyText').textContent = 'Dilimleniyor… (bu biraz sürebilir)';
      startWorker(mainThreadWorker(), backup);
      return;
    }
    done(); toast('Dilimleme hatası: ' + (e.message || 'bilinmeyen'), true);
  };
  const transfer = worker instanceof Worker ? job.parts.map(p => p.positions.buffer) : [];
  worker.postMessage({ type: 'slice', job }, transfer);
}

function onResult(res) {
  result = res;
  result.name = gcodeName();
  clearPreviewObj();
  const pv = res.preview, nSeg = pv.length / PV;
  const pos = new Float32Array(nSeg * 6);
  for (let i = 0; i < nSeg; i++) pos.set(pv.subarray(i * PV, i * PV + 6), i * 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nSeg * 6), 3));
  preview = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
  preview.userData.layerIndex = res.layerIndex.concat([nSeg]);
  scene.add(preview);
  const multi = res.stats.usedSlots && res.stats.usedSlots.length > 1;
  if (multi && state.colorBy !== 'slot') { state.colorBy = 'slot'; saveState(); }
  refreshPreviewColors();
  $('showModel').checked = false; partsGroup.visible = false;
  const L = res.layerZ.length;
  $('layer').max = L - 1; $('layer').value = L - 1; $('layerMax').textContent = L;
  $('layerbar').hidden = false;
  $('colorBy').hidden = false; $('colorBy').value = state.colorBy;
  updateLayer();
  updateButtons();
  setTab('view');
  const st = res.stats;
  const per = multi ? ' · ' + st.perSlot.filter(p => p.mm > 0).map(p => `<span class="sw" style="background:${state.slots[p.slot].color}"></span> ${p.grams.toFixed(1)} g`).join(' ') : '';
  $('stats').innerHTML = `Süre: <b>${fmtTime(st.time)}</b> · Filament: <b>${(st.filamentMm / 1000).toFixed(2)} m</b> (<b>${st.grams.toFixed(1)} g</b>)` +
    (st.cost > 0 ? ` · Maliyet: <b>${st.cost.toFixed(2)} ₺</b>` : '') +
    (multi ? ` · Renk değişimi: <b>${st.toolChanges}</b>` : '') + per +
    ` · Katman: <b>${st.layers}</b>` + (st.ms ? ` · ${(st.ms / 1000).toFixed(1)} sn` : '');
  $('sendHint').textContent = `${result.name} hazır (${fmtTime(st.time)}).`;
}

function refreshPreviewColors() {
  if (!preview || !result) return;
  const pv = result.preview, nSeg = pv.length / PV;
  const col = preview.geometry.attributes.color.array;
  const bySlot = state.colorBy === 'slot';
  const tcols = TYPE_INFO.map(t => new THREE.Color(t[1]));
  const scols = state.slots.map(s => new THREE.Color(s.color));
  for (let i = 0; i < nSeg; i++) {
    const t = pv[i * PV + 6], sl = pv[i * PV + 7];
    const c = bySlot ? (t === 5 ? tcols[5] : (scols[sl] || scols[0])) : (tcols[t] || tcols[0]);
    col[i * 6] = col[i * 6 + 3] = c.r; col[i * 6 + 1] = col[i * 6 + 4] = c.g; col[i * 6 + 2] = col[i * 6 + 5] = c.b;
  }
  preview.geometry.attributes.color.needsUpdate = true;
  buildLegend();
}
function buildLegend() {
  const lg = $('legend');
  if (!result) { lg.hidden = true; return; }
  const pv = result.preview, present = new Set(), slots = new Set();
  for (let i = 6; i < pv.length; i += PV) { present.add(pv[i]); slots.add(pv[i + 1]); }
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  lg.innerHTML = state.colorBy === 'slot'
    ? [...slots].sort().map(s => `<div><i style="background:${state.slots[s].color}"></i>Yuva ${s + 1}: ${escapeHtml(state.slots[s].name)}</div>`).join('')
    : TYPE_INFO.map((t, i) => present.has(i) ? `<div><i style="background:${hex(t[1])}"></i>${t[0]}</div>` : '').join('');
  lg.hidden = false;
}
$('colorBy').addEventListener('change', () => { state.colorBy = $('colorBy').value; saveState(); refreshPreviewColors(); });

function updateLayer() {
  if (!preview) return;
  const li = parseInt($('layer').value, 10);
  const idx = preview.userData.layerIndex;
  const start = $('onlyLayer').checked ? idx[li] : 0;
  preview.geometry.setDrawRange(start * 2, (idx[li + 1] - start) * 2);
  $('layerNum').textContent = li + 1;
  $('layerZ').textContent = result.layerZ[li].toFixed(2);
}
$('layer').addEventListener('input', updateLayer);
$('onlyLayer').addEventListener('change', updateLayer);
$('layerUp').addEventListener('click', () => { const r = $('layer'); r.value = Math.min(+r.max, +r.value + 1); updateLayer(); });
$('layerDown').addEventListener('click', () => { const r = $('layer'); r.value = Math.max(0, +r.value - 1); updateLayer(); });
$('showModel').addEventListener('change', () => { partsGroup.visible = $('showModel').checked; });
window.addEventListener('keydown', e => {
  if (!preview || (e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'TEXTAREA') return;
  const r = $('layer');
  if (e.key === 'ArrowUp') { r.value = Math.min(+r.max, +r.value + 1); updateLayer(); e.preventDefault(); }
  if (e.key === 'ArrowDown') { r.value = Math.max(0, +r.value - 1); updateLayer(); e.preventDefault(); }
});

function clearPreviewObj() { if (preview) { scene.remove(preview); preview.geometry.dispose(); preview = null; } }
function clearPreview() {
  clearPreviewObj();
  result = null;
  $('layerbar').hidden = true; $('legend').hidden = true; $('colorBy').hidden = true;
  $('stats').textContent = '';
  $('sendHint').textContent = 'Önce modeli dilimleyin.';
  partsGroup.visible = true; $('showModel').checked = true;
  updateButtons();
}

// Fluidd/Mainsail için önizleme resmi
let thumbRenderer = null;
function makeThumbnail(size) {
  if (!thumbRenderer) thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  thumbRenderer.setPixelRatio(1);
  thumbRenderer.setSize(size, size, false);
  const sc = new THREE.Scene();
  addLights(sc);
  const bb = new THREE.Box3();
  parts.forEach(p => { sc.add(new THREE.Mesh(p.mesh.geometry, p.mesh.material)); bb.union(p.mesh.geometry.boundingBox); });
  const c = bb.getCenter(new THREE.Vector3()), r = bb.getSize(new THREE.Vector3()).length() / 2;
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 5000); cam.up.set(0, 0, 1);
  const d = r / Math.sin(THREE.MathUtils.degToRad(17.5)) * 1.05;
  cam.position.set(c.x - d * 0.5, c.y - d * 0.7, c.z + d * 0.5); cam.lookAt(c);
  thumbRenderer.render(sc, cam);
  return { w: size, h: size, b64: thumbRenderer.domElement.toDataURL('image/png').split(',')[1] };
}

// ================================================================= dosya çıktısı
function gcodeName() {
  const F = state.slots[parts[0] ? parts[0].slot : 0].values;
  const nm = parts.length ? parts[0].name.replace(/ #\d+$/, '') : 'model';
  const used = new Set(parts.map(p => p.slot));
  const t = result ? fmtTime(result.stats.time).replace(/\s/g, '') : '';
  return `${nm}_K1Max_${used.size > 1 ? used.size + 'renk' : F.filamentType}_${state.process.values.layerHeight}mm_${t}.gcode`.replace(/[^\w.\-çğıöşüÇĞİÖŞÜ]/g, '_');
}
$('download').addEventListener('click', () => { if (result) download(new Blob([result.gcode], { type: 'text/plain' }), result.name); });

function download(blob, name) {
  if (bridge) { blob.text().then(t => toast(bridge.saveFile(name, t))); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ================================================================= cihaz (Moonraker)
const dev = { connected: false, base: '', timer: null, state: null };
function syncDeviceFields() {
  $('devIp').value = state.printer.values.hostIp || '';
  $('devPort').value = state.printer.values.hostPort || 7125;
}
function saveDeviceFields() {
  state.printer.values.hostIp = $('devIp').value.trim();
  state.printer.values.hostPort = +$('devPort').value || 7125;
  saveState();
}
$('devIp').addEventListener('change', () => { saveDeviceFields(); disconnect(); });
$('devPort').addEventListener('change', () => { saveDeviceFields(); disconnect(); });

let httpSeq = 0;
const httpPending = new Map();
window.k1HttpCb = (id, status, text) => {
  const p = httpPending.get(id); if (!p) return;
  httpPending.delete(id);
  if (status < 0) p.reject(new Error(text || 'bağlantı hatası')); else p.resolve({ status, text });
};
window.k1HttpProgress = (id, f) => { const p = httpPending.get(id); if (p && p.onProgress) p.onProgress(f); };

function http(method, url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  const key = state.printer.values.apiKey;
  if (key) headers['X-Api-Key'] = key;
  if (bridge && bridge.http) {
    return new Promise((resolve, reject) => {
      const id = 'h' + (++httpSeq);
      httpPending.set(id, { resolve, reject, onProgress: opts.onProgress });
      const meta = { method, url, headers, timeout: opts.timeout || 8000,
        upload: opts.upload ? { field: 'file', filename: opts.upload.name, fields: opts.upload.fields || {} } : null };
      bridge.http(id, JSON.stringify(meta), opts.upload ? opts.upload.content : (opts.body || ''));
    });
  }
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    x.timeout = opts.timeout || 8000;
    Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
    x.onload = () => resolve({ status: x.status, text: x.responseText });
    x.onerror = () => reject(new Error('cors'));
    x.ontimeout = () => reject(new Error('zaman aşımı'));
    if (opts.onProgress && x.upload) x.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress(e.loaded / e.total); };
    if (opts.upload) {
      const fd = new FormData();
      Object.entries(opts.upload.fields || {}).forEach(([k, v]) => fd.append(k, v));
      fd.append('file', new Blob([opts.upload.content], { type: 'text/plain' }), opts.upload.name);
      x.send(fd);
    } else x.send(opts.body || null);
  });
}
const json = (r) => { try { return JSON.parse(r.text); } catch (e) { return null; } };

async function tryConnect(ip, port) {
  const base = `http://${ip}:${port}`;
  const r = await http('GET', base + '/server/info', { timeout: 4000 });
  const j = json(r);
  if (r.status !== 200 || !j || !j.result) throw new Error('Moonraker yanıt vermedi (HTTP ' + r.status + ')');
  return { base, info: j.result };
}
async function connect(silent) {
  saveDeviceFields();
  const ip = state.printer.values.hostIp;
  if (!ip) { if (!silent) toast('Önce yazıcının IP adresini girin ya da "Ağda ara"ya dokunun.', true); return false; }
  $('devHint').textContent = 'Bağlanılıyor…';
  const ports = [state.printer.values.hostPort || 7125, 7125, 4408, 4409, 80].filter((v, i, a) => a.indexOf(v) === i);
  let lastErr = null;
  for (const port of ports) {
    try {
      const { base, info } = await tryConnect(ip, port);
      dev.connected = true; dev.base = base;
      if (port !== state.printer.values.hostPort) { state.printer.values.hostPort = port; $('devPort').value = port; saveState(); }
      $('devHint').innerHTML = `Bağlandı: <b>${escapeHtml(ip)}:${port}</b> · Klipper: ${escapeHtml(info.klippy_state || '?')}`;
      $('devStatusCard').hidden = false;
      pollStatus(); startPolling();
      updateButtons();
      return true;
    } catch (e) {
      lastErr = e;
      if (e.message === 'cors') break; // tarayıcı engeli: diğer portları denemek anlamsız
    }
  }
  dev.connected = false;
  $('devStatusCard').hidden = true;
  if (lastErr && lastErr.message === 'cors' && !bridge) {
    $('devHint').innerHTML = 'Yazıcıya ulaşılamadı ya da tarayıcı güvenliği yanıtı okumayı engelledi. Durum bilgisi için Android uygulamasını kullanın. ' +
      'Dosya göndermeyi yine de deneyebilirsiniz (sonucu Fluidd\'den kontrol edin).';
  } else {
    $('devHint').textContent = `Bağlanılamadı (${lastErr ? lastErr.message : 'bilinmeyen'}). IP adresini, telefonun yazıcıyla aynı Wi-Fi ağında olduğunu ve Moonraker'ın çalıştığını kontrol edin.`;
  }
  updateButtons();
  return false;
}
function disconnect() { dev.connected = false; stopPolling(); $('devStatusCard').hidden = true; updateButtons(); }
$('devConnect').addEventListener('click', () => connect(false));

const STATE_TR = { standby: 'Hazır', printing: 'Basıyor', paused: 'Duraklatıldı', complete: 'Tamamlandı', cancelled: 'İptal edildi', error: 'Hata' };
async function pollStatus() {
  if (!dev.connected) return;
  try {
    const r = await http('GET', dev.base + '/printer/objects/query?print_stats&display_status&extruder&heater_bed', { timeout: 4000 });
    const st = json(r).result.status;
    dev.state = st.print_stats.state;
    $('stState').textContent = STATE_TR[dev.state] || dev.state;
    $('stNozzle').textContent = `${Math.round(st.extruder.temperature)}/${Math.round(st.extruder.target)}°`;
    $('stBed').textContent = `${Math.round(st.heater_bed.temperature)}/${Math.round(st.heater_bed.target)}°`;
    const prog = st.display_status ? st.display_status.progress : 0;
    $('stProg').textContent = Math.round(prog * 100) + '%';
    $('stBar').style.width = (prog * 100).toFixed(1) + '%';
    $('stFile').textContent = st.print_stats.filename ? 'Dosya: ' + st.print_stats.filename : '';
    $('devPause').disabled = dev.state !== 'printing';
    $('devResume').disabled = dev.state !== 'paused';
    $('devCancel').disabled = !(dev.state === 'printing' || dev.state === 'paused');
  } catch (e) {
    $('stState').textContent = 'Bağlantı yok';
  }
}
function startPolling() { stopPolling(); dev.timer = setInterval(() => { if (!document.hidden && (document.body.dataset.tab === 'device' || window.innerWidth > 820)) pollStatus(); }, 3000); }
function stopPolling() { if (dev.timer) clearInterval(dev.timer); dev.timer = null; }
async function printerCmd(path, okMsg) {
  try {
    const r = await http('POST', dev.base + path, { timeout: 6000 });
    if (r.status === 200) toast(okMsg); else toast('Yazıcı komutu reddetti (HTTP ' + r.status + ').', true);
  } catch (e) { toast('Komut gönderilemedi: ' + e.message, true); }
  setTimeout(pollStatus, 800);
}
$('devPause').addEventListener('click', () => printerCmd('/printer/print/pause', 'Duraklatılıyor…'));
$('devResume').addEventListener('click', () => printerCmd('/printer/print/resume', 'Devam ediliyor…'));
$('devCancel').addEventListener('click', async () => {
  if (await confirmDlg('Baskıyı iptal et', 'Devam eden baskı iptal edilsin mi?', 'İptal et')) printerCmd('/printer/print/cancel', 'İptal ediliyor…');
});
$('devWeb').addEventListener('click', () => {
  const ip = $('devIp').value.trim();
  if (!ip) { toast('Önce IP adresini girin.', true); return; }
  window.open(`http://${ip}:4408`, '_blank');
});

// Ağda yazıcı arama (yalnızca Android uygulamasında)
let scanSeq = 0;
const scanPending = new Map();
window.k1ScanCb = (id, list) => { const f = scanPending.get(id); if (f) { scanPending.delete(id); f(JSON.parse(list || '[]')); } };
window.k1ScanProgress = (id, f) => { $('devHint').textContent = `Ağ taranıyor… %${Math.round(f * 100)}`; };
$('devScan').addEventListener('click', async () => {
  if (!bridge || !bridge.scan) {
    toast('Ağ taraması yalnızca Android uygulamasında çalışır. IP adresini yazıcının ekranından (Ayarlar → Ağ) öğrenebilirsiniz.', true);
    return;
  }
  $('scanList').innerHTML = '';
  $('devHint').textContent = 'Ağ taranıyor…';
  const id = 's' + (++scanSeq);
  const hosts = await new Promise(res => { scanPending.set(id, res); bridge.scan(id, 7125); });
  const found = [];
  for (const ip of hosts) {
    try { const { info } = await tryConnect(ip, 7125); found.push({ ip, host: info.hostname || '' }); } catch (e) { /* Moonraker değil */ }
  }
  if (!found.length) { $('devHint').textContent = 'Ağda Moonraker çalışan yazıcı bulunamadı. Telefonun yazıcıyla aynı Wi-Fi ağında olduğundan emin olun.'; return; }
  $('devHint').textContent = `${found.length} yazıcı bulundu. Seçmek için dokunun.`;
  found.forEach(f => {
    const row = document.createElement('div'); row.className = 'part';
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = `${f.ip}${f.host ? ' · ' + f.host : ''}`;
    const b = document.createElement('button'); b.className = 'btn small'; b.textContent = 'Seç';
    b.onclick = () => { $('devIp').value = f.ip; $('devPort').value = 7125; saveDeviceFields(); $('scanList').innerHTML = ''; connect(false); };
    row.append(nm, b); $('scanList').appendChild(row);
  });
});

async function upload(start) {
  if (!result) { toast('Önce dilimleyin.', true); return; }
  saveDeviceFields();
  const ip = state.printer.values.hostIp;
  if (!ip) { setTab('device'); toast('Yazıcının IP adresini girin.', true); return; }
  if (!dev.connected) await connect(true);
  const base = dev.base || `http://${ip}:${state.printer.values.hostPort || 7125}`;
  if (start && dev.connected) {
    await pollStatus();
    if (dev.state === 'printing' || dev.state === 'paused') { toast('Yazıcı şu an başka bir baskıda. Dosya yalnızca yüklenecek.', true); start = false; }
  }
  const fields = { root: 'gcodes' };
  if (state.printer.values.uploadFolder) fields.path = state.printer.values.uploadFolder;
  if (start) fields.print = 'true';
  $('upBarWrap').hidden = false; $('upBar').style.width = '0%';
  try {
    const r = await http('POST', base + '/server/files/upload', {
      timeout: 600000, upload: { name: result.name, content: result.gcode, fields },
      onProgress: (f) => { $('upBar').style.width = (f * 100).toFixed(0) + '%'; },
    });
    $('upBar').style.width = '100%';
    if (r.status === 200 || r.status === 201) {
      toast(start ? 'Gönderildi, baskı başlıyor.' : 'Dosya yazıcıya yüklendi.');
      setTimeout(pollStatus, 1500);
    } else toast('Yükleme başarısız (HTTP ' + r.status + '): ' + (r.text || '').slice(0, 120), true);
  } catch (e) {
    if (e.message === 'cors' && !bridge) {
      // tarayıcı yanıtı okuyamıyor: isteği yine de gönder (yanıt alınamaz)
      const fd = new FormData();
      Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
      fd.append('file', new Blob([result.gcode], { type: 'text/plain' }), result.name);
      try { await fetch(base + '/server/files/upload', { method: 'POST', body: fd, mode: 'no-cors' }); toast('Gönderildi (yanıt okunamadı). Fluidd\'den kontrol edin.'); }
      catch (e2) { toast('Gönderilemedi: yazıcıya ulaşılamıyor.', true); }
    } else toast('Gönderilemedi: ' + e.message, true);
  }
  setTimeout(() => { $('upBarWrap').hidden = true; }, 1500);
}
$('devUpload').addEventListener('click', () => upload(false));
$('devUploadStart').addEventListener('click', () => upload(true));
async function sendDialog() {
  if (!result) return;
  if (!state.printer.values.hostIp) { setTab('device'); toast('Önce yazıcının IP adresini girin ya da ağda arayın.', true); return; }
  const c = await choiceDlg('Yazıcıya gönder', `${escapeHtml(result.name)}<br><span class="hint">${escapeHtml(state.printer.values.hostIp)}</span>`,
    [['cancel', 'Vazgeç'], ['up', 'Yalnızca yükle'], ['start', 'Yükle ve başlat']]);
  if (c === 'up') upload(false); else if (c === 'start') upload(true);
}
$('send').addEventListener('click', sendDialog);

// ================================================================= düğmeler, sekmeler, mobil
function updateButtons(fits) {
  if (fits === undefined) fits = parts.length > 0 && !$('modelInfo').querySelector('.err');
  const busy = !$('busy').hidden;
  $('slice').disabled = !parts.length || !fits || busy;
  $('download').disabled = !result;
  $('send').disabled = !result;
  $('devUpload').disabled = !result;
  $('devUploadStart').disabled = !result;
  mirror();
}
function mirror() {
  $('mSlice').disabled = $('slice').disabled;
  $('mDownload').disabled = $('download').disabled;
  $('mSend').disabled = $('send').disabled;
  $('mShare').disabled = $('download').disabled;
}
const isDesktop = () => window.innerWidth > 820;
function setTab(tab) {
  if (tab === 'view' && isDesktop()) return; // masaüstünde görünüm hep açık
  document.body.dataset.tab = tab;
  document.querySelectorAll('.tabs button, .ptabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'view') requestAnimationFrame(() => { resize(); if (!parts.length) setView('iso'); });
  if (tab === 'device' && dev.connected) pollStatus();
  if (tab === 'device' && !dev.connected && state.printer.values.hostIp) connect(true);
}
document.querySelectorAll('.tabs button, .ptabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('mSlice').addEventListener('click', slice);
$('mDownload').addEventListener('click', () => $('download').click());
$('mSend').addEventListener('click', sendDialog);

const canShareFiles = (() => {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.gcode', { type: 'text/plain' })] })); }
  catch (e) { return false; }
})();
if (canShareFiles || bridge) $('mShare').hidden = false;
$('mShare').addEventListener('click', async () => {
  if (!result) return;
  if (bridge) { bridge.shareFile(result.name, result.gcode); return; }
  try { await navigator.share({ files: [new File([result.gcode], result.name, { type: 'text/plain' })], title: result.name }); }
  catch (e) { if (e.name !== 'AbortError') toast('Paylaşılamadı, İndir düğmesini kullanın.', true); }
});

let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('install').hidden = false; });
$('install').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt(); await installEvt.userChoice.catch(() => {});
  installEvt = null; $('install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; toast('Uygulama yüklendi.'); });
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.K1_STANDALONE) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async params => {
    if (params.files && params.files.length) loadFiles(await Promise.all(params.files.map(f => f.getFile())), true);
  });
}

// ================================================================= diyaloglar ve yardımcılar
function dialog(title, bodyHtml, buttons, onOpen) {
  return new Promise(res => {
    $('mTitle').textContent = title;
    $('mBody').innerHTML = bodyHtml;
    const bb = $('mBtns'); bb.innerHTML = '';
    const close = (v) => { $('modal').hidden = true; res(v); };
    buttons.forEach(([v, label, cls]) => {
      const b = document.createElement('button'); b.className = 'btn small ' + (cls || ''); b.textContent = label;
      b.onclick = () => close(typeof v === 'function' ? v() : v);
      bb.appendChild(b);
    });
    $('modal').onclick = (e) => { if (e.target === $('modal')) close(null); };
    $('modal').hidden = false;
    if (onOpen) onOpen();
  });
}
const confirmDlg = (t, msg, okLabel) => dialog(t, `<p>${escapeHtml(msg)}</p>`, [[false, 'Vazgeç'], [true, okLabel || 'Tamam', 'primary']]);
const choiceDlg = (t, html, opts) => dialog(t, `<p>${html}</p>`, opts.map(([v, l], i) => [v === 'cancel' ? null : v, l, i === opts.length - 1 ? 'accent' : '']));
function promptDlg(t, label, def) {
  return dialog(t, `<label class="hint">${escapeHtml(label)}</label><input type="text" id="dlgInput">`,
    [[null, 'Vazgeç'], [() => ($('dlgInput').value || '').trim() || null, 'Kaydet', 'primary']],
    () => { const i = $('dlgInput'); i.value = def || ''; i.focus(); i.select(); });
}

function fmtTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${m} dk ${s % 60} sn`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastTimer;
window.k1Toast = (m) => toast(m);
function toast(msg, err) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div'); t.className = 'toast';
    Object.assign(t.style, { position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: 30,
      padding: '10px 16px', borderRadius: '10px', background: 'var(--card)', border: '1px solid var(--line)',
      boxShadow: '0 8px 24px rgba(0,0,0,.25)', maxWidth: 'calc(100vw - 32px)' });
    document.body.appendChild(t);
  }
  t.style.bottom = isDesktop() ? '24px' : '150px';
  t.textContent = msg; t.style.color = err ? 'var(--danger)' : 'var(--text)'; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, err ? 6000 : 3500);
}

// ================================================================= başlat
function renderAll() { renderQuick(); renderSettings(); syncDeviceFields(); }
buildBed();
resize();
setView('iso');
renderAll();
setTab('model');
updateButtons(false);
if (state.printer.values.hostIp) connect(true);
