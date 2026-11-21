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
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
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
  if (!world.children.length) { ul.innerHTML = '<li class="muted">Sahne boş — şekil ekleyin veya fotoğraftan model oluşturun.</li>'; return; }
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
  // fit using the narrower of the vertical/horizontal field of view (portrait phones)
  const vf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hf = Math.atan(Math.tan(vf) * camera.aspect);
  camera.position.copy(c).addScaledVector(dir, r / Math.sin(Math.min(vf, hf)) * 1.15);
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
   Photo → 3D (multi-view)
   ========================================================= */
const VIEW_NAMES = { front: 'Ön', back: 'Arka', left: 'Sol', right: 'Sağ', top: 'Üst' };
const views = {};          // name -> { file, img (canvas), mirror, mask }
let engine = 'local';
let resultObj = null;      // mesh in scene
let resultStl = null;      // ArrayBuffer (binary STL, mm, Z-up)
let resultGeo = null;      // BufferGeometry in mm, Y-up

$$('#engineSeg button').forEach(b => b.onclick = () => {
  engine = b.dataset.engine;
  $$('#engineSeg button').forEach(x => x.classList.toggle('active', x === b));
  $$('.local-only').forEach(el => el.hidden = engine !== 'local');
  $$('.server-only').forEach(el => el.hidden = engine !== 'server');
  $$('.slot').forEach(s => drawSlot(s.dataset.view));
});
$('#srvUrl').value = localStorage.getItem('ms_server') || '';
$('#srvUrl').onchange = e => localStorage.setItem('ms_server', e.target.value.trim());

async function loadImageCanvas(file, max) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

// Background removal: flood-fill from the image border over pixels close to the background colour,
// keep the largest remaining blob, crop to its bounding box (+padding).
function computeMask(img, thr, holes) {
  const w = img.width, h = img.height, N = w * h;
  const d = img.getContext('2d').getImageData(0, 0, w, h).data;
  const bg = new Uint8Array(N);
  let transparent = 0;
  for (let i = 0; i < N; i++) if (d[i * 4 + 3] < 128) transparent++;
  if (transparent > N * 0.01) {
    for (let i = 0; i < N; i++) bg[i] = d[i * 4 + 3] < 128 ? 1 : 0;
  } else {
    // background colour = median of the border pixels
    const rs = [], gs = [], bs = [];
    const take = i => { rs.push(d[i * 4]); gs.push(d[i * 4 + 1]); bs.push(d[i * 4 + 2]); };
    for (let x = 0; x < w; x++) { take(x); take((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { take(y * w); take(y * w + w - 1); }
    const med = a => a.sort((p, q) => p - q)[a.length >> 1];
    const R = med(rs), G = med(gs), B = med(bs);
    const t2 = thr * thr;
    const near = i => { const r = d[i * 4] - R, g = d[i * 4 + 1] - G, b = d[i * 4 + 2] - B; return 0.3 * r * r + 0.59 * g * g + 0.11 * b * b < t2; };
    if (holes) for (let i = 0; i < N; i++) bg[i] = near(i) ? 1 : 0;
    else {
      const st = new Int32Array(N); let sp = 0;
      const push = i => { if (!bg[i] && near(i)) { bg[i] = 1; st[sp++] = i; } };
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (sp) {
        const i = st[--sp], x = i % w;
        if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
        if (i >= w) push(i - w); if (i < N - w) push(i + w);
      }
    }
  }
  // largest connected object component
  const lab = new Int32Array(N); let best = 0, bestSize = 0, cur = 0;
  const st = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (bg[s] || lab[s]) continue;
    cur++; let sp = 0, size = 0; st[sp++] = s; lab[s] = cur;
    while (sp) {
      const i = st[--sp], x = i % w; size++;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < N - w ? i + w : -1];
      for (const j of nb) if (j >= 0 && !bg[j] && !lab[j]) { lab[j] = cur; st[sp++] = j; }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
  }
  if (!best || bestSize < N * 0.002) return null;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < N; i++) if (lab[i] === best) {
    const x = i % w, y = (i / w) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const pad = 6, cw = x1 - x0 + 1, ch = y1 - y0 + 1, W = cw + 2 * pad, H = ch + 2 * pad;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) mask[(y + pad) * W + x + pad] = lab[(y + y0) * w + x + x0] === best ? 1 : 0;
  majority(mask, W, H); majority(mask, W, H);
  return { mask, w: W, h: H, pad, bbox: [x0, y0, x1, y1], full: lab, best, fullCovered: bestSize / N };
}

// 3x3 majority filter: removes single-pixel spurs and notches along the outline
function majority(m, w, h) {
  const src = m.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += src[(y + dy) * w + x + dx];
    m[y * w + x] = c >= 5 ? 1 : 0;
  }
}

function drawSlot(name) {
  const slot = $(`.slot[data-view="${name}"]`);
  const cv = slot.querySelector('canvas'), ph = slot.querySelector('.ph');
  const v = views[name];
  slot.classList.toggle('filled', !!v);
  slot.classList.toggle('bad', !!v && engine === 'local' && !v.mask);
  cv.style.transform = v?.mirror ? 'scaleX(-1)' : '';
  if (!v) { cv.width = cv.height = 0; ph.hidden = false; return; }
  ph.hidden = true;
  const img = v.img;
  const k = 220 / Math.max(img.width, img.height);
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0, cv.width, cv.height);
  if (engine !== 'local' || !v.mask) return;
  // darken background, outline bbox
  const sm = document.createElement('canvas'); sm.width = img.width; sm.height = img.height;
  const sg = sm.getContext('2d'), id = sg.createImageData(img.width, img.height);
  const lab = v.mask.full, best = v.mask.best;
  for (let i = 0; i < lab.length; i++) { if (lab[i] !== best) { id.data[i * 4 + 3] = 170; } }
  sg.putImageData(id, 0, 0);
  g.drawImage(sm, 0, 0, cv.width, cv.height);
  const [x0, y0, x1, y1] = v.mask.bbox;
  g.strokeStyle = '#7c9cff'; g.lineWidth = 2;
  g.strokeRect(x0 * k, y0 * k, (x1 - x0 + 1) * k, (y1 - y0 + 1) * k);
}

function remask(name) {
  const v = views[name];
  if (!v) return;
  v.mask = computeMask(v.img, +$('#phThr').value, $('#phHoles').checked);
  drawSlot(name);
}
let remaskTimer;
const remaskAll = () => { clearTimeout(remaskTimer); remaskTimer = setTimeout(() => Object.keys(views).forEach(remask), 120); };
$('#phThr').oninput = remaskAll;
$('#phHoles').onchange = remaskAll;

$$('.slot').forEach(slot => {
  const name = slot.dataset.view;
  slot.querySelector('input').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    busy(true, VIEW_NAMES[name] + ' görseli işleniyor…');
    try {
      views[name] = { file, img: await loadImageCanvas(file, 640), mirror: false };
      remask(name);
      if (!views[name].mask) toast(VIEW_NAMES[name] + ': nesne bulunamadı — hassasiyeti değiştirin', 4000);
    } catch (err) { toast('Görsel açılamadı: ' + err.message); }
    finally { busy(false); }
  };
  slot.querySelector('[data-act="mirror"]').onclick = () => { if (views[name]) { views[name].mirror = !views[name].mirror; drawSlot(name); } };
  slot.querySelector('[data-act="clear"]').onclick = () => { delete views[name]; drawSlot(name); };
  // drag & drop on desktop
  slot.addEventListener('dragover', e => e.preventDefault());
  slot.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0]; if (!f) return;
    const inp = slot.querySelector('input'); const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; inp.onchange({ target: inp });
  });
  drawSlot(name);
});

function phProgress(on, pct = 0, text = '') {
  $('#phProgress').hidden = !on; $('#phBar').style.width = pct + '%'; $('#phStatus').textContent = text;
}

// Binary STL writer: input mm Y-up → output mm Z-up (3D printing convention)
function writeStl(geo) {
  const pos = geo.attributes.position.array, idx = geo.index ? geo.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const buf = new ArrayBuffer(84 + triCount * 50), dv = new DataView(buf);
  const hdr = 'Model Studyo - mm, Z-up';
  for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
  dv.setUint32(80, triCount, true);
  const P = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const vi = idx ? idx[t * 3 + c] : t * 3 + c;
      P[c * 3] = pos[vi * 3]; P[c * 3 + 1] = -pos[vi * 3 + 2]; P[c * 3 + 2] = pos[vi * 3 + 1];
    }
    const ux = P[3] - P[0], uy = P[4] - P[1], uz = P[5] - P[2], vx = P[6] - P[0], vy = P[7] - P[1], vz = P[8] - P[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, P[k], true);
    o += 50;
  }
  return buf;
}

function showResult(geo, stl, label) {
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  resultGeo = geo; resultStl = stl;
  if (resultObj?.parent) removeObject(resultObj, false);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#d9dde8', metalness: 0.05, roughness: 0.55 }));
  mesh.name = label;
  const sz = geo.boundingBox.getSize(new THREE.Vector3());
  mesh.scale.setScalar(2 / Math.max(sz.x, sz.y, sz.z)); // display size; STL keeps real mm
  resultObj = mesh;
  addObject(mesh);
  placeFree(mesh);
  focusSelection();
  const tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  $('#phStats').innerHTML = `<b>${label}</b><br>${Math.round(tris).toLocaleString('tr-TR')} üçgen · ` +
    `${sz.x.toFixed(1)} × ${sz.z.toFixed(1)} × ${sz.y.toFixed(1)} mm (G × D × Y) · STL ${(stl.byteLength / 1048576).toFixed(1)} MB`;
  $('#phResult').hidden = false;
}

let worker = null;
function buildLocal() {
  const payload = {};
  for (const k of Object.keys(VIEW_NAMES)) {
    const v = views[k];
    if (!v) continue;
    if (!v.mask) throw new Error(VIEW_NAMES[k] + ' görselinde nesne bulunamadı');
    payload[k] = { mask: v.mask.mask, w: v.mask.w, h: v.mask.h, pad: v.mask.pad, mirror: v.mirror };
  }
  if (!(payload.front || payload.back)) throw new Error('Ön veya arka görsel ekleyin');
  if (!(payload.left || payload.right)) throw new Error('Sol veya sağ görsel ekleyin');
  return new Promise((resolve, reject) => {
    worker?.terminate();
    worker = new Worker('hull-worker.js');
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') phProgress(true, m.pct, m.stage + '…');
      else if (m.type === 'error') { reject(new Error(m.message)); worker.terminate(); }
      else if (m.type === 'done') {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
        resolve(geo); worker.terminate();
      }
    };
    worker.onerror = e => reject(new Error(e.message || 'İşlem hatası'));
    worker.postMessage({ views: payload, res: +$('#phRes').value, roundness: +$('#phRound').value,
      smooth: +$('#phSmooth').value, heightMm: +$('#phHeight').value || 100 });
  });
}

async function buildServer() {
  let url = $('#srvUrl').value.trim().replace(/\/+$/, '');
  if (!url) url = location.origin; // the server also hosts this app
  const fd = new FormData();
  let n = 0;
  for (const k of ['front', 'back', 'left', 'right']) {
    const v = views[k]; if (!v) continue;
    let c = await loadImageCanvas(v.file, 1024);
    if (v.mirror) { const m = document.createElement('canvas'); m.width = c.width; m.height = c.height; const g = m.getContext('2d'); g.scale(-1, 1); g.drawImage(c, -c.width, 0); c = m; }
    fd.append(k, await new Promise(r => c.toBlob(r, 'image/png')), k + '.png'); n++;
  }
  if (!views.front) throw new Error('AI sunucusu için ön görsel gerekli');
  fd.append('octree_resolution', $('#srvRes').value);
  fd.append('steps', $('#srvSteps').value);
  fd.append('height_mm', $('#phHeight').value || '100');
  phProgress(true, 10, `${n} görsel sunucuya gönderildi, AI modeli üretiyor (1-3 dk)…`);
  let fake = 10;
  const tick = setInterval(() => { fake = Math.min(92, fake + 1.5); $('#phBar').style.width = fake + '%'; }, 1500);
  try {
    let res;
    try { res = await fetch(url + '/generate', { method: 'POST', body: fd }); }
    catch { throw new Error('Sunucuya bağlanılamadı. Adres doğru mu, sunucu açık mı?'); }
    if (!res.ok) throw new Error('Sunucu hatası: ' + (await res.text()).slice(0, 200));
    const stl = await res.arrayBuffer();
    const geo = new STLLoader().parse(stl);      // mm, Z-up
    geo.rotateX(-Math.PI / 2);                   // → Y-up for display
    return { geo, stl };
  } finally { clearInterval(tick); }
}

$('#btnBuild').onclick = async () => {
  const btn = $('#btnBuild');
  btn.disabled = true;
  $('#phResult').hidden = true;
  phProgress(true, 1, 'Başlıyor…');
  try {
    const t0 = performance.now();
    if (engine === 'local') {
      const geo = await buildLocal();
      showResult(geo, writeStl(geo), 'Görselden model');
    } else {
      const { geo, stl } = await buildServer();
      showResult(geo, stl, 'AI model');
    }
    phProgress(true, 100, `Hazır (${((performance.now() - t0) / 1000).toFixed(1)} sn)`);
    setTimeout(() => phProgress(false), 2500);
  } catch (e) {
    console.error(e); phProgress(false); toast(e.message, 5000);
  } finally { btn.disabled = false; }
};

$('#btnStl').onclick = () => resultStl && download(new Blob([resultStl], { type: 'model/stl' }), 'model.stl');
$('#btnObjRes').onclick = () => {
  if (!resultGeo) return;
  const m = new THREE.Mesh(resultGeo);  // OBJ: mm, Y-up
  download(new Blob([new OBJExporter().parse(m)], { type: 'text/plain' }), 'model.obj');
};

/* =========================================================
   PWA
   ========================================================= */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
