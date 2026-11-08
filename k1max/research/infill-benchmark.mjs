import * as THREE from 'three';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('../slicer-core.js');
const P = await import('../presets.js');
const pos = (g) => { g = g.index ? g.toNonIndexed() : g; return new Float32Array(g.attributes.position.array); };
function place(arr) { // tabla ortasına, z=0
  let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9;
  for (let i=0;i<arr.length;i+=3){mnx=Math.min(mnx,arr[i]);mxx=Math.max(mxx,arr[i]);mny=Math.min(mny,arr[i+1]);mxy=Math.max(mxy,arr[i+1]);mnz=Math.min(mnz,arr[i+2]);}
  const dx=150-(mnx+mxx)/2, dy=150-(mny+mxy)/2; for (let i=0;i<arr.length;i+=3){arr[i]+=dx;arr[i+1]+=dy;arr[i+2]-=mnz;} return arr;
}
function shapeExtrude(pts, depth, holes=[]) {
  const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  holes.forEach(([x,y,r]) => { const h = new THREE.Path(); h.absarc(x,y,r,0,Math.PI*2,true); s.holes.push(h); });
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 32 });
}
const models = {
  'Kalibrasyon küpü (20 mm)': place(pos(new THREE.BoxGeometry(20, 20, 20))),
  'L braket (80×40×40)': (() => { const g = shapeExtrude([[0,0],[80,0],[80,40],[0,40]], 6, [[15,20,3],[65,20,3]]); const w = shapeExtrude([[0,0],[80,0],[80,34],[0,34]], 6, [[40,20,4]]); w.rotateX(Math.PI/2); w.translate(0,6,6);
    const a=pos(g), b=pos(w); const m=new Float32Array(a.length+b.length); m.set(a); m.set(b,a.length); return place(m); })(),
  'Silindir (Ø60×50)': place(pos(new THREE.CylinderGeometry(30, 30, 50, 96).rotateX(Math.PI/2))),
  'Telefon standı': (() => { const g = shapeExtrude([[0,0],[90,0],[90,8],[30,8],[62,70],[54,74],[14,8],[0,8]], 70); g.rotateX(Math.PI/2); return place(pos(g)); })(),
  'Organik düğüm': place(pos(new THREE.TorusKnotGeometry(22, 7, 220, 32))),
};
const ONLY = process.env.ONLY;
const variants = {
  'Izgara': { infillPattern: 'grid' },
  'Gyroid': { infillPattern: 'gyroid' },
  'Doğrusal': { infillPattern: 'rectilinear' },
  'Sarmal': { infillPattern: 'helix' },
  'Hızlı': { infillPattern: 'speed' },
  'Hızlı + tek hat': { infillPattern: 'speed', infillJoin: true },
  'Hızlı + tek hat + 2 katta bir': { infillPattern: 'speed', infillJoin: true, infillEvery: 2 },
  'Izgara + 2 katta bir': { infillPattern: 'grid', infillEvery: 2 },
};
const fil = Object.assign({}, P.FILAMENT_BASE, P.FILAMENT_PRESETS['Genel PLA']);
const res = {};
for (const [mn, arr] of Object.entries(models)) {
  if (ONLY && !mn.startsWith(ONLY)) continue;
  res[mn] = {};
  for (const [vn, v] of Object.entries(variants)) {
    const S = Object.assign({}, P.PRINTER_BASE, P.PROCESS_BASE, { thumbnail: false }, v);
    const t0 = Date.now();
    const r = core.slice({ parts: [{ positions: arr.slice(), slot: 0, name: mn }], S, fils: [fil, fil, fil, fil] }, () => {});
    const st = r.stats;
    if (ONLY) console.error(vn, st.time, JSON.stringify(st.timeByType));
    res[mn][vn] = { total: st.time, infill: st.timeByType[3] || 0, g: +st.grams.toFixed(1), travel: (r.gcode.match(/^G0 /gm) || []).length, retr: (r.gcode.match(/^G1 E-/gm) || []).length, ms: Date.now() - t0 };
    process.stderr.write('.');
  }
}
console.log(JSON.stringify(res));
