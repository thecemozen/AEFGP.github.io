import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PRINTER, FILAMENTS, QUALITIES, buildSettings } from './presets.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'k1max-slicer-v1';

// ------------------------------------------------------------ ayar şeması
// [anahtar, etiket, birim, adım, min, max, ipucu] ya da seçim için {opts}
const GROUPS = [
  { title: 'Kalite', open: true, items: [
    ['layerHeight', 'Katman yüksekliği', 'mm', 0.01, 0.04, 0.32],
    ['firstLayerHeight', 'İlk katman yüksekliği', 'mm', 0.01, 0.1, 0.35],
    ['lineWidth', 'Çizgi genişliği', 'mm', 0.01, 0.3, 0.8],
    ['firstLayerLineWidth', 'İlk katman çizgi gen.', 'mm', 0.01, 0.3, 0.8],
    ['seam', 'Dikiş konumu', { rear: 'Arka (hizalı)', nearest: 'En yakın', random: 'Rastgele' }],
  ]},
  { title: 'Duvarlar ve yüzeyler', open: true, items: [
    ['walls', 'Duvar sayısı', '', 1, 1, 10],
    ['topLayers', 'Üst katman sayısı', '', 1, 0, 20],
    ['bottomLayers', 'Alt katman sayısı', '', 1, 0, 20],
    ['wallOrder', 'Duvar sırası', { 'inner-outer': 'İç → Dış (daha iyi yüzey)', 'outer-inner': 'Dış → İç (daha iyi ölçü)' }],
    ['elephantFoot', 'Fil ayağı telafisi', 'mm', 0.01, 0, 0.5],
    ['xyCompensation', 'XY boyut telafisi', 'mm', 0.01, -0.5, 0.5],
  ]},
  { title: 'Dolgu', open: true, items: [
    ['infillDensity', 'Dolgu yoğunluğu', '%', 1, 0, 100],
    ['infillPattern', 'Dolgu deseni', { grid: 'Izgara', gyroid: 'Gyroid', triangles: 'Üçgen', lines: 'Çizgi' }],
    ['infillOverlap', 'Dolgu/duvar bindirme', '%', 1, 0, 50],
  ]},
  { title: 'Sıcaklık ve soğutma', open: true, items: [
    ['nozzleTempFirst', 'Nozul (ilk katman)', '°C', 1, 150, 300],
    ['nozzleTemp', 'Nozul', '°C', 1, 150, 300],
    ['bedTempFirst', 'Tabla (ilk katman)', '°C', 1, 0, 110],
    ['bedTemp', 'Tabla', '°C', 1, 0, 110],
    ['fanOffLayers', 'Fan kapalı katman', '', 1, 0, 20],
    ['fanFullLayer', 'Tam fan katmanı', '', 1, 0, 30],
    ['fanMin', 'Fan (min)', '%', 1, 0, 100],
    ['fanMax', 'Fan (max)', '%', 1, 0, 100],
    ['minLayerTime', 'Min. katman süresi', 'sn', 1, 0, 60],
  ]},
  { title: 'Hız', items: [
    ['outerWallSpeed', 'Dış duvar', 'mm/s', 5, 10, 600],
    ['innerWallSpeed', 'İç duvar', 'mm/s', 5, 10, 600],
    ['sparseInfillSpeed', 'Seyrek dolgu', 'mm/s', 5, 10, 600],
    ['solidInfillSpeed', 'Katı dolgu', 'mm/s', 5, 10, 600],
    ['topSurfaceSpeed', 'Üst yüzey', 'mm/s', 5, 10, 600],
    ['firstLayerSpeed', 'İlk katman', 'mm/s', 5, 5, 200],
    ['travelSpeed', 'Boş hareket', 'mm/s', 10, 50, 800],
    ['maxVolumetric', 'Maks. hacimsel akış', 'mm³/s', 0.5, 1, 45],
  ]},
  { title: 'İvme', items: [
    ['accelOuterWall', 'Dış duvar', 'mm/s²', 500, 500, 20000],
    ['accelInnerWall', 'İç duvar', 'mm/s²', 500, 500, 20000],
    ['accelInfill', 'Dolgu', 'mm/s²', 500, 500, 20000],
    ['accelTop', 'Üst yüzey', 'mm/s²', 500, 500, 20000],
    ['accelFirst', 'İlk katman', 'mm/s²', 100, 100, 20000],
    ['accelTravel', 'Boş hareket', 'mm/s²', 500, 500, 20000],
  ]},
  { title: 'Geri çekme', items: [
    ['retractLength', 'Uzunluk', 'mm', 0.05, 0, 5],
    ['retractSpeed', 'Hız', 'mm/s', 1, 5, 100],
    ['deretractSpeed', 'Geri itme hızı', 'mm/s', 1, 5, 100],
    ['retractMinTravel', 'Min. hareket mesafesi', 'mm', 0.1, 0, 10],
    ['zHop', 'Z kaldırma', 'mm', 0.05, 0, 2],
  ]},
  { title: 'Yapışma (skirt / brim)', items: [
    ['skirtLoops', 'Etek tur sayısı', '', 1, 0, 10],
    ['skirtDistance', 'Etek mesafesi', 'mm', 0.5, 0, 30],
    ['brimWidth', 'Kenarlık genişliği', 'mm', 0.5, 0, 20],
  ]},
  { title: 'Filament', items: [
    ['flowRatio', 'Akış oranı', '', 0.01, 0.8, 1.2],
    ['pressureAdvance', 'Pressure advance', '', 0.005, 0, 0.3],
    ['filamentDiameter', 'Filament çapı', 'mm', 0.01, 1.6, 3],
    ['filamentDensity', 'Yoğunluk', 'g/cm³', 0.01, 0.8, 2],
  ]},
  { title: 'G-code', items: [
    ['startGcode', 'Başlangıç G-code', 'text'],
    ['endGcode', 'Bitiş G-code', 'text'],
  ]},
];

const NUM_KEYS = new Set();
GROUPS.forEach(g => g.items.forEach(it => { if (typeof it[2] === 'string' && it[2] !== 'text') NUM_KEYS.add(it[0]); }));

// ------------------------------------------------------------ durum
let state = loadState();
let viewRadius = 480;
let settings = state.settings;

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.settings) {
        s.settings = Object.assign(buildSettings(s.filament || 'pla', s.quality || 'standard'), s.settings);
        return s;
      }
    }
  } catch (e) { /* depolama yoksa varsayılan */ }
  return { filament: 'pla', quality: 'standard', settings: buildSettings('pla', 'standard') };
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* yok say */ }
}

// ------------------------------------------------------------ ayar formu
function renderSettings() {
  const host = $('settings');
  host.innerHTML = '';
  GROUPS.forEach(g => {
    const d = document.createElement('details');
    d.className = 'card';
    if (g.open) d.open = true;
    const sm = document.createElement('summary');
    sm.textContent = g.title;
    d.appendChild(sm);
    g.items.forEach(it => {
      const [key, label, unitOrOpts, step, min, max] = it;
      if (unitOrOpts === 'text') {
        const wrap = document.createElement('label');
        wrap.style.display = 'block';
        wrap.innerHTML = `<span style="font-size:13px">${label}</span>`;
        const ta = document.createElement('textarea');
        ta.value = settings[key] || '';
        ta.dataset.key = key;
        ta.addEventListener('change', () => { settings[key] = ta.value; changed(); });
        wrap.appendChild(ta);
        d.appendChild(wrap);
        return;
      }
      const row = document.createElement('label');
      row.className = 'row';
      const sp = document.createElement('span');
      sp.textContent = label;
      row.appendChild(sp);
      if (typeof unitOrOpts === 'object') {
        const sel = document.createElement('select');
        Object.entries(unitOrOpts).forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
        sel.value = settings[key];
        sel.dataset.key = key;
        sel.addEventListener('change', () => { settings[key] = sel.value; changed(); });
        row.appendChild(sel);
      } else {
        const box = document.createElement('span');
        box.className = 'inp';
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = step; inp.min = min; inp.max = max;
        inp.value = settings[key];
        inp.dataset.key = key;
        inp.addEventListener('change', () => {
          let v = parseFloat(inp.value);
          if (isNaN(v)) v = settings[key];
          v = Math.min(max, Math.max(min, v));
          inp.value = v; settings[key] = v; changed();
        });
        box.appendChild(inp);
        const em = document.createElement('em'); em.textContent = unitOrOpts; box.appendChild(em);
        row.appendChild(box);
      }
      d.appendChild(row);
    });
    host.appendChild(d);
  });
}

function changed() {
  state.settings = settings;
  saveState();
  if (result) { $('stats').innerHTML = '<span>Ayarlar değişti — güncel G-code için tekrar <b>Dilimle</b>.</span>'; }
}

function fillPresetSelects() {
  const f = $('filament'), q = $('quality');
  Object.entries(FILAMENTS).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v.label; f.appendChild(o); });
  Object.entries(QUALITIES).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v.label; q.appendChild(o); });
  f.value = state.filament; q.value = state.quality;
  updatePresetHint();
}
function updatePresetHint() {
  const fl = FILAMENTS[$('filament').value];
  $('presetHint').textContent = `${fl.label}: nozul ${fl.nozzleTemp}°C, tabla ${fl.bedTemp}°C, fan %${fl.fanMax}` +
    (fl.filamentType === 'ABS' || fl.filamentType === 'ASA' ? ' — üst kapağı kapalı tutun.' : '.');
}
$('filament').addEventListener('change', updatePresetHint);
$('applyPreset').addEventListener('click', () => {
  state.filament = $('filament').value;
  state.quality = $('quality').value;
  const keepG = { startGcode: settings.startGcode, endGcode: settings.endGcode };
  settings = buildSettings(state.filament, state.quality);
  Object.assign(settings, keepG);
  state.settings = settings;
  saveState(); renderSettings(); changed();
  toast('Hazır ayar uygulandı.');
});

$('exportProfile').addEventListener('click', () => {
  download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), 'k1max-profil.json');
});
$('importProfile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!s.settings) throw new Error('geçersiz');
    state = s; state.settings = Object.assign(buildSettings(s.filament || 'pla', s.quality || 'standard'), s.settings);
    settings = state.settings; saveState(); renderSettings();
    $('filament').value = state.filament; $('quality').value = state.quality;
    toast('Profil yüklendi.');
  } catch (err) { toast('Profil okunamadı.', true); }
  e.target.value = '';
});
$('resetProfile').addEventListener('click', () => {
  state = { filament: 'pla', quality: 'standard', settings: buildSettings('pla', 'standard') };
  settings = state.settings; saveState(); renderSettings();
  $('filament').value = 'pla'; $('quality').value = 'standard'; updatePresetHint();
  toast('Varsayılan K1 Max ayarlarına dönüldü.');
});

// ------------------------------------------------------------ 3B sahne
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

scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const dl = new THREE.DirectionalLight(0xffffff, 1.6);
dl.position.set(200, -100, 400); scene.add(dl);
const dl2 = new THREE.DirectionalLight(0xffffff, 0.6);
dl2.position.set(-100, 400, 200); scene.add(dl2);

function themeColors() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? { bed: 0x23282f, grid: 0x3a414c, grid2: 0x2d333c, bg: 0x0f1216 } : { bed: 0xdfe3e9, grid: 0xb8bfca, grid2: 0xccd2da, bg: 0xe9ecf1 };
}
let bedGroup;
function buildBed() {
  if (bedGroup) scene.remove(bedGroup);
  const c = themeColors();
  scene.background = new THREE.Color(c.bg);
  bedGroup = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(PRINTER.bedX, PRINTER.bedY),
    new THREE.MeshStandardMaterial({ color: c.bed, roughness: 0.9 }));
  plate.position.set(PRINTER.bedX / 2, PRINTER.bedY / 2, -0.05);
  bedGroup.add(plate);
  const pts = [];
  for (let i = 0; i <= PRINTER.bedX; i += 10) pts.push(i, 0, 0, i, PRINTER.bedY, 0);
  for (let j = 0; j <= PRINTER.bedY; j += 10) pts.push(0, j, 0, PRINTER.bedX, j, 0);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  bedGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: c.grid2 })));
  const box = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(PRINTER.bedX, PRINTER.bedY, PRINTER.bedZ)), c.grid);
  bedGroup.add(box);
  scene.add(bedGroup);
}
buildBed();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', buildBed);

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
resize();
setView('iso');
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

function setView(v) {
  const t = controls.target;
  const r = viewRadius;
  if (v === 'top') camera.position.set(t.x, t.y - 0.01, t.z + r);
  else if (v === 'front') camera.position.set(t.x, t.y - r, t.z + 20);
  else camera.position.set(t.x - r * 0.45, t.y - r * 0.6, t.z + r * 0.5);
  controls.update();
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ------------------------------------------------------------ model
let baseGeom = null;    // kullanıcı dönüşümleri uygulanmış, orijinal ölçekte
let mesh = null;
let modelName = 'model';
const modelMat = new THREE.MeshStandardMaterial({ color: 0x2fa36b, roughness: 0.55, metalness: 0.05 });

function setModel(geom, name) {
  geom.deleteAttribute('normal');
  geom = geom.index ? geom.toNonIndexed() : geom;
  baseGeom = geom;
  modelName = (name || 'model').replace(/\.stl$/i, '');
  $('scale').value = 100;
  placeModel();
  $('slice').disabled = false;
  clearPreview();
}

function placeModel() {
  if (!baseGeom) return;
  const g = baseGeom.clone();
  const s = parseFloat($('scale').value) / 100 || 1;
  g.scale(s, s, s);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(PRINTER.bedX / 2 - (bb.min.x + bb.max.x) / 2, PRINTER.bedY / 2 - (bb.min.y + bb.max.y) / 2, -bb.min.z);
  g.computeVertexNormals();
  g.computeBoundingBox();
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  mesh = new THREE.Mesh(g, modelMat);
  mesh.visible = $('showModel').checked || !result;
  scene.add(mesh);
  const b = g.boundingBox;
  const sx = (b.max.x - b.min.x), sy = (b.max.y - b.min.y), sz = (b.max.z - b.min.z);
  const fits = b.min.x >= 0 && b.min.y >= 0 && b.max.x <= PRINTER.bedX && b.max.y <= PRINTER.bedY && b.max.z <= PRINTER.bedZ;
  const tris = g.attributes.position.count / 3;
  $('modelInfo').innerHTML = `<b>${escapeHtml(modelName)}</b><br>${sx.toFixed(1)} × ${sy.toFixed(1)} × ${sz.toFixed(1)} mm · ${tris.toLocaleString('tr-TR')} üçgen` +
    (fits ? '' : '<br><span class="err">Model tablaya sığmıyor! Ölçeği küçültün.</span>');
  $('slice').disabled = !fits;
  controls.target.set(PRINTER.bedX / 2, PRINTER.bedY / 2, sz / 2);
  viewRadius = Math.min(560, Math.max(110, Math.max(sx, sy, sz) * 2.6));
  modelMat.color.set(fits ? 0x2fa36b : 0xd9534f);
}

function rotateModel(axis) {
  if (!baseGeom) return;
  const m = new THREE.Matrix4();
  if (axis === 'x') m.makeRotationX(Math.PI / 2);
  else if (axis === 'y') m.makeRotationY(Math.PI / 2);
  else m.makeRotationZ(Math.PI / 2);
  baseGeom.applyMatrix4(m);
  placeModel(); clearPreview();
}
document.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => rotateModel(b.dataset.rot)));
$('scale').addEventListener('change', () => { placeModel(); clearPreview(); });

$('layflat').addEventListener('click', () => {
  if (!baseGeom) return;
  const p = baseGeom.attributes.position.array;
  const acc = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    a.set(p[i], p[i + 1], p[i + 2]); b.set(p[i + 3], p[i + 4], p[i + 5]); c.set(p[i + 6], p[i + 7], p[i + 8]);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const area = n.length() / 2; if (area < 1e-9) continue;
    n.normalize();
    const key = `${Math.round(n.x * 50)},${Math.round(n.y * 50)},${Math.round(n.z * 50)}`;
    const e = acc.get(key) || { area: 0, n: new THREE.Vector3() };
    e.area += area; e.n.addScaledVector(n, area); acc.set(key, e);
  }
  let best = null;
  acc.forEach(e => { if (!best || e.area > best.area) best = e; });
  if (!best) return;
  const q = new THREE.Quaternion().setFromUnitVectors(best.n.clone().normalize(), new THREE.Vector3(0, 0, -1));
  baseGeom.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
  placeModel(); clearPreview();
  toast('En geniş yüzey tablaya yatırıldı.');
});

const loader = new STLLoader();
async function loadFile(file) {
  if (!file) return;
  if (!/\.stl$/i.test(file.name)) { toast('Şimdilik yalnızca STL dosyaları destekleniyor.', true); return; }
  try {
    const buf = await file.arrayBuffer();
    const geom = loader.parse(buf);
    if (!geom.attributes.position || geom.attributes.position.count < 3) throw new Error('boş');
    setModel(geom, file.name);
    setView('iso');
  } catch (e) { toast('STL okunamadı: ' + e.message, true); }
}
$('file').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
['dragenter', 'dragover'].forEach(t => window.addEventListener(t, e => { e.preventDefault(); $('drop').classList.add('on'); }));
['dragleave', 'drop'].forEach(t => window.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement || !e.relatedTarget) $('drop').classList.remove('on'); }));
window.addEventListener('drop', e => { $('drop').classList.remove('on'); loadFile(e.dataTransfer.files[0]); });

// Örnek model: kalibrasyon küpü benzeri delikli kutu + yuvarlatılmış kule
$('demo').addEventListener('click', () => {
  const parts = [];
  const shape = new THREE.Shape();
  const r = 3, W = 30;
  shape.moveTo(r, 0); shape.lineTo(W - r, 0); shape.quadraticCurveTo(W, 0, W, r); shape.lineTo(W, W - r);
  shape.quadraticCurveTo(W, W, W - r, W); shape.lineTo(r, W); shape.quadraticCurveTo(0, W, 0, W - r);
  shape.lineTo(0, r); shape.quadraticCurveTo(0, 0, r, 0);
  const hole = new THREE.Path(); hole.absarc(W / 2, W / 2, 7, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  parts.push(new THREE.ExtrudeGeometry(shape, { depth: 15, bevelEnabled: false, curveSegments: 24 }));
  const cyl = new THREE.CylinderGeometry(5, 5, 20, 48); cyl.rotateX(Math.PI / 2); cyl.translate(W / 2, W + 12, 10);
  parts.push(cyl);
  const sph = new THREE.SphereGeometry(9, 48, 32); sph.translate(W + 16, W / 2, 9);
  parts.push(sph);
  const merged = mergeGeoms(parts.map(p => p.index ? p.toNonIndexed() : p));
  setModel(merged, 'ornek-model.stl');
  setView('iso');
});
function mergeGeoms(list) {
  let n = 0; list.forEach(g => n += g.attributes.position.array.length);
  const arr = new Float32Array(n); let o = 0;
  list.forEach(g => { arr.set(g.attributes.position.array, o); o += g.attributes.position.array.length; });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return g;
}

// ------------------------------------------------------------ dilimleme
let worker = null;
let result = null;
let preview = null;

const TYPE_INFO = [
  ['Dış duvar', 0xff8a3d], ['İç duvar', 0xffd23f], ['Katı dolgu', 0xb34ddb], ['Seyrek dolgu', 0xd9534f],
  ['Etek / kenarlık', 0x3fb8af], ['Boş hareket', 0x7aa7ff], ['Üst yüzey', 0xff4f8b],
];

$('slice').addEventListener('click', () => {
  if (!mesh) return;
  if (worker) worker.terminate();
  worker = new Worker('slicer-worker.js');
  const positions = new Float32Array(mesh.geometry.attributes.position.array);
  $('busy').hidden = false; $('busyBar').style.width = '0%'; $('busyText').textContent = 'Hazırlanıyor…';
  $('slice').disabled = true;
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'progress') { $('busyBar').style.width = (m.p * 100).toFixed(0) + '%'; $('busyText').textContent = m.text; }
    else if (m.type === 'done') { $('busy').hidden = true; $('slice').disabled = false; onResult(m.result); worker.terminate(); worker = null; }
    else if (m.type === 'error') { $('busy').hidden = true; $('slice').disabled = false; toast('Dilimleme hatası: ' + m.message, true); worker.terminate(); worker = null; }
  };
  worker.onerror = (e) => { $('busy').hidden = true; $('slice').disabled = false; toast('Dilimleme hatası: ' + e.message, true); };
  worker.postMessage({ type: 'slice', positions, settings: Object.assign({}, settings) }, [positions.buffer]);
});

function onResult(res) {
  result = res;
  clearPreviewObj();
  const pv = res.preview;
  const nSeg = pv.length / 7;
  const pos = new Float32Array(nSeg * 6), col = new Float32Array(nSeg * 6);
  const cols = TYPE_INFO.map(t => new THREE.Color(t[1]));
  for (let i = 0; i < nSeg; i++) {
    const o = i * 7;
    pos.set([pv[o], pv[o + 1], pv[o + 2], pv[o + 3], pv[o + 4], pv[o + 5]], i * 6);
    const c = cols[pv[o + 6]] || cols[0];
    col[i * 6] = col[i * 6 + 3] = c.r; col[i * 6 + 1] = col[i * 6 + 4] = c.g; col[i * 6 + 2] = col[i * 6 + 5] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  preview = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
  preview.userData.layerIndex = res.layerIndex.concat([nSeg]);
  scene.add(preview);
  $('showModel').checked = false;
  if (mesh) mesh.visible = false;

  const L = res.layerZ.length;
  $('layer').max = L - 1; $('layer').value = L - 1; $('layerMax').textContent = L;
  $('layerbar').hidden = false; $('download').disabled = false;
  updateLayer();
  buildLegend();
  const st = res.stats;
  $('stats').innerHTML = `Süre: <b>${fmtTime(st.time)}</b> · Filament: <b>${(st.filamentMm / 1000).toFixed(2)} m</b> (<b>${st.grams.toFixed(1)} g</b>) · Katman: <b>${st.layers}</b> · Dilimleme: ${(st.ms / 1000).toFixed(1)} sn`;
}
function buildLegend() {
  const lg = $('legend');
  lg.innerHTML = TYPE_INFO.filter((t, i) => i !== 5 || settings.previewTravel)
    .map(t => `<div><i style="background:#${t[1].toString(16).padStart(6, '0')}"></i>${t[0]}</div>`).join('');
  lg.hidden = false;
}
function updateLayer() {
  if (!preview) return;
  const li = parseInt($('layer').value, 10);
  const idx = preview.userData.layerIndex;
  const start = $('onlyLayer').checked ? idx[li] : 0;
  const end = idx[li + 1];
  preview.geometry.setDrawRange(start * 2, (end - start) * 2);
  $('layerNum').textContent = li + 1;
  $('layerZ').textContent = result.layerZ[li].toFixed(2);
}
$('layer').addEventListener('input', updateLayer);
$('onlyLayer').addEventListener('change', updateLayer);
$('showModel').addEventListener('change', () => { if (mesh) mesh.visible = $('showModel').checked; });
window.addEventListener('keydown', e => {
  if (!preview || e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  const r = $('layer');
  if (e.key === 'ArrowUp') { r.value = Math.min(+r.max, +r.value + 1); updateLayer(); e.preventDefault(); }
  if (e.key === 'ArrowDown') { r.value = Math.max(0, +r.value - 1); updateLayer(); e.preventDefault(); }
});

function clearPreviewObj() {
  if (preview) { scene.remove(preview); preview.geometry.dispose(); preview = null; }
}
function clearPreview() {
  clearPreviewObj();
  result = null;
  $('layerbar').hidden = true; $('legend').hidden = true; $('download').disabled = true;
  $('stats').textContent = '';
  if (mesh) { mesh.visible = true; $('showModel').checked = true; }
}

$('download').addEventListener('click', () => {
  if (!result) return;
  const fl = (FILAMENTS[state.filament] || {}).filamentType || 'PLA';
  const name = `${modelName}_K1Max_${fl}_${settings.layerHeight}mm_${fmtTime(result.stats.time).replace(/\s/g, '')}.gcode`;
  download(new Blob([result.gcode], { type: 'text/plain' }), name);
});

// ------------------------------------------------------------ yardımcılar
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function fmtTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${m} dk ${s % 60} sn`;
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastTimer;
function toast(msg, err) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div'); t.className = 'toast';
    Object.assign(t.style, { position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: 10,
      padding: '10px 16px', borderRadius: '10px', background: 'var(--card)', border: '1px solid var(--line)',
      boxShadow: '0 8px 24px rgba(0,0,0,.25)', maxWidth: 'calc(100vw - 32px)' });
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.color = err ? '#e5484d' : 'var(--text)'; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3500);
}

// başlat
fillPresetSelects();
renderSettings();
