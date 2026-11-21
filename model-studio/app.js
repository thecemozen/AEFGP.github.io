import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const isMobile = () => matchMedia('(max-width: 760px)').matches;

/* =========================================================
   Renderer / scene
   ========================================================= */
const canvas = $('#view');
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1e26');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
camera.position.set(4, 3.2, 5);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(5, 10, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 40 });
scene.add(sun);

const grid = new THREE.GridHelper(20, 40, 0x555b6e, 0x2c303c);
grid.material.transparent = true; grid.material.opacity = 0.7;
scene.add(grid);
const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.25 }));
shadowFloor.rotation.x = -Math.PI / 2; shadowFloor.receiveShadow = true; shadowFloor.position.y = -0.001;
scene.add(shadowFloor);

// Everything the user creates lives in `world` (this is what gets exported)
const world = new THREE.Group();
world.name = 'Sahne';
scene.add(world);

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.target.set(0, 0.5, 0);

const gizmo = new TransformControls(camera, canvas);
gizmo.setSize(isMobile() ? 1.25 : 1);
scene.add(gizmo);
gizmo.addEventListener('dragging-changed', e => {
  orbit.enabled = !e.value;
  if (e.value && selected) beginTransformUndo(selected);
});
gizmo.addEventListener('objectChange', () => queuePropSync());

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

renderer.setAnimationLoop(() => { orbit.update(); renderer.render(scene, camera); });

/* =========================================================
   UI helpers
   ========================================================= */
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function busy(on, text = 'Yükleniyor…') { $('#busy').hidden = !on; $('#busyText').textContent = text; }
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Tabs
$$('.tab').forEach(b => b.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === b));
  $$('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === b.dataset.tab));
  setSheet(true);
});
// Mobile bottom sheet
function setSheet(open) {
  $('#panel').classList.toggle('collapsed', !open);
  document.body.classList.toggle('sheet-open', open);
}
$('#panelHandle').onclick = () => setSheet($('#panel').classList.contains('collapsed'));
setSheet(true);

/* =========================================================
   Undo
   ========================================================= */
const undoStack = [];
function pushUndo(fn) { undoStack.push(fn); if (undoStack.length > 60) undoStack.shift(); }
function undo() {
  const fn = undoStack.pop();
  if (!fn) return toast('Geri alınacak işlem yok');
  fn(); refreshOutliner(); syncProps();
}
function beginTransformUndo(obj) {
  const p = obj.position.clone(), q = obj.quaternion.clone(), s = obj.scale.clone();
  pushUndo(() => { obj.position.copy(p); obj.quaternion.copy(q); obj.scale.copy(s); });
}

/* =========================================================
   Objects
   ========================================================= */
const palette = ['#8ab4ff', '#ff9f7c', '#9be59b', '#f5d76e', '#d59bff', '#7ce0e0', '#ff7ca8'];
let colorIdx = 0, counter = 0;
let font = null;

function makeMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.5 });
}

const TR = { box: 'Küp', sphere: 'Küre', cylinder: 'Silindir', cone: 'Koni', torus: 'Simit', capsule: 'Kapsül',
  plane: 'Düzlem', knot: 'Düğüm', ico: 'İkosa', ring: 'Halka', tube: 'Boru', text3d: 'Yazı' };

async function makeGeometry(type) {
  switch (type) {
    case 'box': return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere': return new THREE.SphereGeometry(0.6, 48, 32);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1.2, 48);
    case 'cone': return new THREE.ConeGeometry(0.6, 1.2, 48);
    case 'torus': return new THREE.TorusGeometry(0.5, 0.18, 24, 64);
    case 'capsule': return new THREE.CapsuleGeometry(0.35, 0.7, 12, 32);
    case 'plane': { const g = new THREE.PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2); return g; }
    case 'knot': return new THREE.TorusKnotGeometry(0.45, 0.14, 160, 24);
    case 'ico': return new THREE.IcosahedronGeometry(0.6, 0);
    case 'ring': { const g = new THREE.RingGeometry(0.3, 0.6, 48); g.rotateX(-Math.PI / 2); return g; }
    case 'tube': {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1, 0, 0), new THREE.Vector3(-0.4, 0.6, 0.3),
        new THREE.Vector3(0.4, -0.2, -0.3), new THREE.Vector3(1, 0.4, 0)]);
      return new THREE.TubeGeometry(curve, 96, 0.12, 16, false);
    }
    case 'text3d': {
      const txt = prompt('Yazı:', 'Merhaba');
      if (!txt) return null;
      if (!font) {
        busy(true, 'Yazı tipi yükleniyor…');
        try {
          font = await new FontLoader().loadAsync('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json');
        } finally { busy(false); }
      }
      const g = new TextGeometry(txt, { font, size: 0.5, height: 0.15, curveSegments: 8,
        bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 3 });
      g.center();
      return g;
    }
  }
}

function prepObject(obj) {
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
}

function addObject(obj, { select: sel = true, undoable = true } = {}) {
  prepObject(obj);
  world.add(obj);
  if (undoable) pushUndo(() => { removeObject(obj, false); });
  refreshOutliner();
  if (sel) select(obj);
  return obj;
}

function removeObject(obj, undoable = true) {
  if (!obj) return;
  const parent = obj.parent;
  if (selected === obj) select(null);
  parent.remove(obj);
  if (undoable) pushUndo(() => { parent.add(obj); });
  refreshOutliner();
}

async function addPrimitive(type, fromUser = true) {
  const geo = await makeGeometry(type);
  if (!geo) return;
  const mesh = new THREE.Mesh(geo, makeMaterial(palette[colorIdx++ % palette.length]));
  mesh.name = `${TR[type]} ${++counter}`;
  addObject(mesh);
  // place on ground, spread slightly so new objects don't stack exactly
  placeFree(mesh);
  if (fromUser && isMobile()) setSheet(false);
}
$$('[data-prim]').forEach(b => b.onclick = () => addPrimitive(b.dataset.prim));

// put a new object on the ground near the view center, sliding right until it doesn't overlap others
function placeFree(obj) {
  obj.position.set(Math.round(orbit.target.x * 4) / 4, 0, Math.round(orbit.target.z * 4) / 4);
  groundObject(obj, false);
  const others = world.children.filter(o => o !== obj && o.visible).map(o => new THREE.Box3().setFromObject(o));
  for (let i = 0; i < 30; i++) {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj).expandByScalar(0.05);
    const hit = others.find(o => o.intersectsBox(b));
    if (!hit) break;
    obj.position.x += hit.max.x - b.min.x + 0.1;
  }
  syncProps();
}

function groundObject(obj, undoable = true) {
  if (undoable) beginTransformUndo(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (!box.isEmpty()) obj.position.y -= box.min.y;
  syncProps();
}

function fitObject(obj, size = 2) {
  // scale imported models to a sensible size and put them on the ground at origin
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const dims = box.getSize(new THREE.Vector3());
  const max = Math.max(dims.x, dims.y, dims.z);
  if (max > 0 && (max > size * 4 || max < size / 8)) obj.scale.multiplyScalar(size / max);
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj);
  const c = b2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b2.min.y;
}

/* =========================================================
   Selection
   ========================================================= */
let selected = null;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downPos = null;

canvas.addEventListener('pointerdown', e => { downPos = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => {
  if (!downPos || gizmo.dragging) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 6) return;
  if (gizmo.axis) return; // tapped on gizmo handle
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(world.children, true).filter(h => h.object.visible);
  if (!hits.length) return select(null);
  let o = hits[0].object;
  while (o.parent && o.parent !== world) o = o.parent;
  select(o);
});

function select(obj) {
  selected = obj;
  if (obj) gizmo.attach(obj); else gizmo.detach();
  syncProps();
  refreshOutliner();
}

function meshesOf(obj) {
  const out = [];
  obj?.traverse(o => { if (o.isMesh && o.material) out.push(o); });
  return out;
}
function firstMaterial(obj) {
  const m = meshesOf(obj)[0]?.material;
  return Array.isArray(m) ? m[0] : m;
}
function eachMaterial(obj, fn) {
  meshesOf(obj).forEach(m => (Array.isArray(m.material) ? m.material : [m.material]).forEach(fn));
}

/* ---------- property panel ---------- */
let syncQueued = false;
function queuePropSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => { syncQueued = false; syncProps(); });
}
const RAD = 180 / Math.PI;
function syncProps() {
  const has = !!selected;
  $('#noSel').hidden = has; $('#selProps').hidden = !has;
  if (!has) return;
  const active = document.activeElement;
  const set = (el, v) => { if (el !== active) el.value = v; };
  set($('#pName'), selected.name || '');
  const m = firstMaterial(selected);
  if (m) {
    if (m.color) set($('#pColor'), '#' + m.color.getHexString());
    set($('#pMetal'), m.metalness ?? 0);
    set($('#pRough'), m.roughness ?? 0.5);
    set($('#pOpacity'), m.opacity ?? 1);
    $('#pWire').checked = !!m.wireframe;
    $('#pFlat').checked = !!m.flatShading;
  }
  $$('.xyz input').forEach(inp => {
    const t = inp.dataset.t, a = inp.dataset.a;
    let v = selected[t][a];
    if (t === 'rotation') v *= RAD;
    set(inp, +v.toFixed(3));
  });
}

let matUndoArmed = false;
function armMaterialUndo() {
  if (matUndoArmed || !selected) return;
  matUndoArmed = true;
  const obj = selected;
  const snap = [];
  eachMaterial(obj, m => snap.push([m, m.color?.clone(), m.metalness, m.roughness, m.opacity, m.transparent, m.wireframe, m.flatShading]));
  pushUndo(() => snap.forEach(([m, c, me, r, o, t, w, f]) => {
    if (c) m.color.copy(c);
    Object.assign(m, { metalness: me, roughness: r, opacity: o, transparent: t, wireframe: w, flatShading: f });
    m.needsUpdate = true;
  }));
}
['#pColor', '#pMetal', '#pRough', '#pOpacity'].forEach(id => {
  $(id).addEventListener('pointerdown', armMaterialUndo);
  $(id).addEventListener('focus', armMaterialUndo);
  $(id).addEventListener('change', () => { matUndoArmed = false; });
});
$('#pColor').oninput = e => eachMaterial(selected, m => m.color?.set(e.target.value));
$('#pMetal').oninput = e => eachMaterial(selected, m => { if ('metalness' in m) m.metalness = +e.target.value; });
$('#pRough').oninput = e => eachMaterial(selected, m => { if ('roughness' in m) m.roughness = +e.target.value; });
$('#pOpacity').oninput = e => eachMaterial(selected, m => { m.opacity = +e.target.value; m.transparent = m.opacity < 1; m.needsUpdate = true; });
$('#pWire').onchange = e => { armMaterialUndo(); matUndoArmed = false; eachMaterial(selected, m => { m.wireframe = e.target.checked; }); };
$('#pFlat').onchange = e => { armMaterialUndo(); matUndoArmed = false; eachMaterial(selected, m => { m.flatShading = e.target.checked; m.needsUpdate = true; }); };
$('#pName').oninput = e => { if (selected) { selected.name = e.target.value; refreshOutliner(); } };

$$('.xyz input').forEach(inp => {
  inp.addEventListener('focus', () => selected && beginTransformUndo(selected));
  inp.addEventListener('input', () => {
    if (!selected) return;
    let v = parseFloat(inp.value);
    if (!isFinite(v)) return;
    if (inp.dataset.t === 'rotation') v /= RAD;
    selected[inp.dataset.t][inp.dataset.a] = v;
  });
});

$('#btnDel').onclick = () => removeObject(selected);
$('#btnGround').onclick = () => selected && groundObject(selected);
$('#btnDup').onclick = () => duplicate(false);
$('#btnMirror').onclick = () => duplicate(true);

function duplicate(mirror) {
  if (!selected) return;
  const c = selected.clone(true);
  // deep-copy materials so the copy can be recolored independently
  c.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); });
  c.name = (selected.name || 'Nesne') + (mirror ? ' (ayna)' : ' kopya');
  if (mirror) { c.scale.x *= -1; c.position.x = -c.position.x; if (Math.abs(c.position.x) < 0.01) c.position.x = 1.2; }
  else c.position.x += 1.2;
  addObject(c);
}

/* ---------- outliner ---------- */
function refreshOutliner() {
  const ul = $('#outliner');
  ul.innerHTML = '';
  if (!world.children.length) { ul.innerHTML = '<li class="muted">Sahne boş — yukarıdan şekil ekleyin veya AI ile üretin.</li>'; return; }
  world.children.forEach(o => {
    const li = document.createElement('li');
    if (o === selected) li.classList.add('sel');
    const dot = document.createElement('span'); dot.className = 'dot';
    const m = firstMaterial(o);
    dot.style.background = m?.color ? '#' + m.color.getHexString() : '#888';
    const name = document.createElement('span'); name.textContent = o.name || 'Nesne';
    const eye = document.createElement('button'); eye.className = 'eye'; eye.textContent = o.visible ? '👁' : '—';
    eye.onclick = ev => { ev.stopPropagation(); o.visible = !o.visible; if (!o.visible && selected === o) select(null); refreshOutliner(); };
    li.append(dot, name, eye);
    li.onclick = () => select(o);
    ul.appendChild(li);
  });
}
refreshOutliner();

/* =========================================================
   Toolbar & shortcuts
   ========================================================= */
function setMode(mode) {
  gizmo.setMode(mode);
  $$('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}
$$('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('#btnUndo').onclick = undo;
$('#btnFocus').onclick = focusSelection;

function focusSelection() {
  const target = selected || (world.children.length ? world : null);
  if (!target) return;
  const box = new THREE.Box3().setFromObject(target);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const dir = camera.position.clone().sub(orbit.target).normalize();
  orbit.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1);
}

addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicate(false); }
  else if (k === 'w') setMode('translate');
  else if (k === 'e') setMode('rotate');
  else if (k === 'r') setMode('scale');
  else if (k === 'f') focusSelection();
  else if (k === 'delete' || k === 'backspace') removeObject(selected);
  else if (k === 'escape') select(null);
});

/* =========================================================
   Scene options
   ========================================================= */
$('#optGrid').onchange = e => { grid.visible = e.target.checked; };
$('#optBg').oninput = e => scene.background.set(e.target.value);
$('#optSnap').onchange = e => {
  const on = e.target.checked;
  gizmo.setTranslationSnap(on ? 0.25 : null);
  gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
  gizmo.setScaleSnap(on ? 0.1 : null);
};
$('#btnClear').onclick = () => {
  if (!world.children.length || !confirm('Sahnedeki tüm nesneler silinsin mi?')) return;
  const items = [...world.children];
  select(null);
  items.forEach(o => world.remove(o));
  pushUndo(() => items.forEach(o => world.add(o)));
  refreshOutliner();
};

/* =========================================================
   Import
   ========================================================= */
const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
const gltfLoader = new GLTFLoader().setDRACOLoader(draco);

async function loadModelBuffer(buf, name) {
  const ext = name.split('.').pop().toLowerCase();
  let obj;
  if (ext === 'glb' || ext === 'gltf') {
    const g = await gltfLoader.parseAsync(buf, '');
    obj = g.scene;
  } else if (ext === 'obj') {
    obj = new OBJLoader().parse(new TextDecoder().decode(buf));
    obj.traverse(o => { if (o.isMesh) o.material = makeMaterial('#cccccc'); });
  } else if (ext === 'stl') {
    const geo = new STLLoader().parse(buf);
    geo.computeVertexNormals();
    obj = new THREE.Mesh(geo, makeMaterial('#c9ccd6'));
    obj.rotation.x = -Math.PI / 2; // STL is usually Z-up
    const wrap = new THREE.Group(); wrap.add(obj); obj = wrap;
  } else throw new Error('Desteklenmeyen dosya: ' + ext);
  obj.name = name.replace(/\.[^.]+$/, '');
  return obj;
}

async function importFiles(files) {
  for (const f of files) {
    busy(true, f.name + ' yükleniyor…');
    try {
      const obj = await loadModelBuffer(await f.arrayBuffer(), f.name);
      fitObject(obj);
      addObject(obj);
      toast(f.name + ' eklendi');
    } catch (err) { console.error(err); toast('Hata: ' + err.message, 4000); }
    finally { busy(false); }
  }
  focusSelection();
}
$('#importFile').onchange = e => { importFiles([...e.target.files]); e.target.value = ''; };
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', e => {
  e.preventDefault();
  const files = [...e.dataTransfer.files].filter(f => /\.(glb|gltf|obj|stl)$/i.test(f.name));
  if (files.length) importFiles(files);
});

/* =========================================================
   Export
   ========================================================= */
function exportTarget() {
  if ($('#expSel').checked) {
    if (!selected) { toast('Önce bir nesne seçin'); return null; }
    return selected;
  }
  if (!world.children.length) { toast('Sahne boş'); return null; }
  return world;
}
function exportGLTF(target, binary) {
  return new Promise((res, rej) => new GLTFExporter().parse(target, res, rej, { binary, onlyVisible: true }));
}
async function doExport(kind) {
  const base = ($('#expSel').checked && selected?.name) ? selected.name.replace(/\s+/g, '_') : 'model';
  if (kind === 'png') {
    const gv = grid.visible; grid.visible = false; gizmo.visible = false;
    renderer.render(scene, camera);
    canvas.toBlob(b => download(b, base + '.png'));
    grid.visible = gv; gizmo.visible = true;
    return;
  }
  const target = exportTarget();
  if (!target) return;
  busy(true, 'Dışa aktarılıyor…');
  try {
    if (kind === 'glb') download(new Blob([await exportGLTF(target, true)], { type: 'model/gltf-binary' }), base + '.glb');
    if (kind === 'gltf') download(new Blob([JSON.stringify(await exportGLTF(target, false))], { type: 'model/gltf+json' }), base + '.gltf');
    if (kind === 'obj') download(new Blob([new OBJExporter().parse(target)], { type: 'text/plain' }), base + '.obj');
    if (kind === 'stl') download(new Blob([new STLExporter().parse(target, { binary: true })], { type: 'model/stl' }), base + '.stl');
    toast('İndirildi: ' + base + '.' + kind);
  } catch (err) { console.error(err); toast('Dışa aktarma hatası: ' + err.message, 4000); }
  finally { busy(false); }
}
$$('[data-export]').forEach(b => b.onclick = () => doExport(b.dataset.export));

/* =========================================================
   Save / load on device (IndexedDB)
   ========================================================= */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('model-studio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
$('#btnSaveLocal').onclick = async () => {
  if (!world.children.length) return toast('Sahne boş');
  busy(true, 'Kaydediliyor…');
  try { await idbSet('scene', await exportGLTF(world, true)); toast('Sahne bu cihaza kaydedildi'); }
  catch (e) { toast('Kaydedilemedi: ' + e.message); }
  finally { busy(false); }
};
$('#btnLoadLocal').onclick = async () => {
  const buf = await idbGet('scene').catch(() => null);
  if (!buf) return toast('Kayıtlı sahne yok');
  busy(true);
  try {
    const g = await gltfLoader.parseAsync(buf, '');
    // the exported root is the "Sahne" group; unwrap its children
    const root = g.scene.children.length === 1 && g.scene.children[0].name === 'Sahne' ? g.scene.children[0] : g.scene;
    select(null);
    [...world.children].forEach(o => world.remove(o));
    [...root.children].forEach(o => { prepObject(o); world.add(o); });
    undoStack.length = 0;
    refreshOutliner(); focusSelection();
    toast('Kayıt yüklendi');
  } catch (e) { toast('Yüklenemedi: ' + e.message); }
  finally { busy(false); }
};

/* =========================================================
   AI generation (Meshy API)
   ========================================================= */
const TEST_KEY = 'msy_dummy_api_key_for_test_mode_12345678';
const LS = {
  get key() { return localStorage.getItem('ms_key') || ''; },
  set key(v) { localStorage.setItem('ms_key', v); },
  get proxy() { return localStorage.getItem('ms_proxy') || ''; },
  set proxy(v) { localStorage.setItem('ms_proxy', v); },
  get history() { try { return JSON.parse(localStorage.getItem('ms_history') || '[]'); } catch { return []; } },
  set history(v) { localStorage.setItem('ms_history', JSON.stringify(v.slice(0, 40))); },
};
$('#aiKey').value = LS.key;
$('#aiProxy').value = LS.proxy;
$('#btnSaveKey').onclick = () => { LS.key = $('#aiKey').value.trim(); LS.proxy = $('#aiProxy').value.trim(); toast('Kaydedildi'); };
$('#btnTestKey').onclick = () => { $('#aiKey').value = TEST_KEY; LS.key = TEST_KEY; toast('Test anahtarı: örnek modeller döner, kredi harcamaz'); };
$('#aiProxy').onchange = () => { LS.proxy = $('#aiProxy').value.trim(); };

const apiBase = () => (LS.proxy ? LS.proxy.replace(/\/+$/, '') : 'https://api.meshy.ai');
const ENDPOINT = { text: '/openapi/v2/text-to-3d', refine: '/openapi/v2/text-to-3d', image: '/openapi/v1/image-to-3d' };

async function api(path, body) {
  const key = ($('#aiKey').value || LS.key).trim();
  if (!key) throw new Error('Önce API anahtarı girin');
  let res;
  try {
    res = await fetch(apiBase() + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Bağlantı kurulamadı (CORS/ağ). Gelişmiş bölümünden proxy tanımlayın.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `API hatası (${res.status})`);
  return data;
}

// mode switch
let aiMode = 'text';
$$('#aiModeSeg button').forEach(b => b.onclick = () => {
  aiMode = b.dataset.ai;
  $$('#aiModeSeg button').forEach(x => x.classList.toggle('active', x === b));
  $('#aiText').hidden = aiMode !== 'text';
  $('#aiImage').hidden = aiMode !== 'image';
});

// image picking (+ downscale to keep request small)
let imageDataUrl = null;
async function pickImage(file) {
  if (!file) return;
  const img = await createImageBitmap(file);
  const s = Math.min(1, 1024 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  imageDataUrl = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92);
  $('#aiImgPrev').src = imageDataUrl; $('#aiImgPrev').hidden = false; $('#aiImgHint').hidden = true;
}
$('#aiImgFile').onchange = e => pickImage(e.target.files[0]);
const drop = $('#imgDrop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); pickImage(e.dataTransfer.files[0]); });

function showProgress(on, pct = 0, text = '') {
  $('#aiProgress').hidden = !on;
  $('#aiBar').style.width = pct + '%';
  $('#aiStatus').textContent = text;
}

function updateHistory(id, patch) {
  const h = LS.history;
  const i = h.findIndex(x => x.id === id);
  if (i >= 0) { h[i] = { ...h[i], ...patch }; LS.history = h; }
  renderHistory();
}

$('#btnGenerate').onclick = async () => {
  const btn = $('#btnGenerate');
  const poly = +$('#aiPoly').value;
  const tex = $('#aiPbr').checked;
  try {
    btn.disabled = true;
    let kind, body, label;
    if (aiMode === 'text') {
      const p = $('#aiPrompt').value.trim();
      if (!p) throw new Error('Bir açıklama yazın');
      kind = 'text'; label = p;
      body = { mode: 'preview', prompt: p, art_style: $('#aiStyle').value, should_remesh: true, target_polycount: poly };
      const neg = $('#aiNeg').value.trim();
      if (neg) body.negative_prompt = neg;
    } else {
      if (!imageDataUrl) throw new Error('Bir görsel seçin');
      kind = 'image'; label = 'Görselden model';
      body = { image_url: imageDataUrl, should_remesh: true, target_polycount: poly, should_texture: tex, enable_pbr: tex };
    }
    showProgress(true, 2, 'Görev gönderiliyor…');
    const r = await api(ENDPOINT[kind], body);
    const id = r.result;
    LS.history = [{ id, kind, prompt: label, status: 'PENDING', created: Date.now(), autoRefine: kind === 'text' && tex }, ...LS.history];
    renderHistory();
    await poll(id, kind);
  } catch (e) {
    toast(e.message, 4500); showProgress(false);
  } finally { btn.disabled = false; }
};

const polling = new Set();
async function poll(id, kind) {
  if (polling.has(id)) return;
  polling.add(id);
  try {
    while (true) {
      const t = await api(`${ENDPOINT[kind]}/${id}`);
      const pct = t.progress ?? 0;
      const step = kind === 'refine' ? 'Doku işleniyor' : 'Model oluşturuluyor';
      showProgress(true, Math.max(3, pct), `${step}… %${pct}`);
      updateHistory(id, { status: t.status, progress: pct, thumb: t.thumbnail_url || undefined });
      if (t.status === 'SUCCEEDED') {
        const glb = t.model_urls?.glb;
        updateHistory(id, { glb, thumb: t.thumbnail_url });
        showProgress(true, 100, 'Hazır!');
        const item = LS.history.find(x => x.id === id);
        if (item?.autoRefine) {
          updateHistory(id, { autoRefine: false });
          if (glb) await loadRemote(glb, item.prompt + ' (taslak)');
          await startRefine(id, item.prompt);
        } else if (glb) {
          await loadRemote(glb, item?.prompt || 'AI model');
          setTimeout(() => showProgress(false), 1500);
        }
        break;
      }
      if (t.status === 'FAILED' || t.status === 'CANCELED' || t.status === 'EXPIRED') {
        throw new Error('Üretim başarısız: ' + (t.task_error?.message || t.status));
      }
      await new Promise(r => setTimeout(r, 4000));
    }
  } catch (e) {
    toast(e.message, 5000); showProgress(false);
    updateHistory(id, { status: 'FAILED' });
  } finally { polling.delete(id); }
}

async function startRefine(previewId, prompt) {
  showProgress(true, 2, 'Doku adımı başlatılıyor…');
  const r = await api(ENDPOINT.refine, { mode: 'refine', preview_task_id: previewId, enable_pbr: true });
  const id = r.result;
  LS.history = [{ id, kind: 'refine', prompt: prompt + ' (dokulu)', status: 'PENDING', created: Date.now() }, ...LS.history];
  renderHistory();
  await poll(id, 'refine');
}

async function fetchAsset(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    return await r.arrayBuffer();
  } catch (e) {
    if (!LS.proxy) throw new Error('Model indirilemedi (CORS). Proxy tanımlayın.');
    const r = await fetch(LS.proxy.replace(/\/+$/, '') + '/fetch?url=' + encodeURIComponent(url));
    if (!r.ok) throw new Error('Model indirilemedi');
    return await r.arrayBuffer();
  }
}

async function loadRemote(url, name) {
  busy(true, 'Model sahneye yükleniyor…');
  try {
    const buf = await fetchAsset(url);
    const obj = await loadModelBuffer(buf, 'm.glb');
    obj.name = name.slice(0, 40);
    fitObject(obj);
    // offset next to existing objects
    if (world.children.length) {
      const box = new THREE.Box3().setFromObject(world);
      obj.position.x += box.max.x + 1.2;
    }
    addObject(obj);
    focusSelection();
    toast('Model sahneye eklendi');
    return obj;
  } catch (e) { toast(e.message, 5000); }
  finally { busy(false); }
}

const STATUS_TR = { PENDING: 'Sırada', IN_PROGRESS: 'Üretiliyor', SUCCEEDED: 'Hazır', FAILED: 'Başarısız', CANCELED: 'İptal', EXPIRED: 'Süresi doldu' };
function renderHistory() {
  const ul = $('#aiHistory');
  const h = LS.history;
  ul.innerHTML = h.length ? '' : '<li class="muted small">Henüz üretim yok.</li>';
  h.forEach(item => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    if (item.thumb) img.src = item.thumb;
    const meta = document.createElement('div'); meta.className = 'meta';
    const title = document.createElement('div'); title.textContent = item.prompt;
    const st = document.createElement('div'); st.className = 'small muted';
    st.textContent = `${STATUS_TR[item.status] || item.status}${item.status === 'IN_PROGRESS' ? ' %' + (item.progress || 0) : ''} · ${new Date(item.created).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}`;
    meta.append(title, st);
    const acts = document.createElement('div'); acts.className = 'acts';
    if (item.glb) {
      const add = document.createElement('button'); add.textContent = 'Sahneye ekle';
      add.onclick = () => loadRemote(item.glb, item.prompt);
      acts.append(add);
      if (item.kind === 'text') {
        const ref = document.createElement('button'); ref.textContent = 'Doku ekle';
        ref.onclick = () => startRefine(item.id, item.prompt).catch(e => toast(e.message, 4500));
        acts.append(ref);
      }
    }
    const del = document.createElement('button'); del.textContent = '✕';
    del.onclick = () => { LS.history = LS.history.filter(x => x.id !== item.id); renderHistory(); };
    acts.append(del);
    li.append(img, meta, acts);
    ul.appendChild(li);
  });
}
renderHistory();
// resume unfinished tasks after a reload
LS.history.filter(x => x.status === 'PENDING' || x.status === 'IN_PROGRESS').forEach(x => poll(x.id, x.kind));

/* =========================================================
   Starter scene + PWA
   ========================================================= */
(async () => {
  await addPrimitive('box', false);
  undoStack.length = 0;
  select(null);
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
