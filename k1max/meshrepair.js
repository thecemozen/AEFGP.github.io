/*
 * STL/3MF onarımı: köşe kaynaştırma, bozuk/tekrarlı üçgen silme, yön tutarlılığı, delik kapatma.
 * Girdi ve çıktı: indekssiz üçgen dizisi (Float32Array, üçgen başına 9 sayı).
 */
import * as THREE from 'three';

export function repairMesh(positions) {
  const report = { welded: 0, degenerate: 0, duplicate: 0, flipped: 0, holes: 0, holeTris: 0, nonManifold: 0 };
  const q = 1e4, map = new Map(), verts = [];
  const nIn = positions.length / 9;
  const tris = [];
  const vid = (x, y, z) => {
    const k = Math.round(x * q) + ',' + Math.round(y * q) + ',' + Math.round(z * q);
    let id = map.get(k);
    if (id === undefined) { id = verts.length / 3; verts.push(x, y, z); map.set(k, id); }
    return id;
  };
  for (let t = 0; t < nIn; t++) {
    const o = t * 9;
    tris.push([vid(positions[o], positions[o + 1], positions[o + 2]), vid(positions[o + 3], positions[o + 4], positions[o + 5]), vid(positions[o + 6], positions[o + 7], positions[o + 8])]);
  }
  report.welded = nIn * 3 - verts.length / 3;
  const V = (i) => [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]];
  const area2 = (t) => {
    const a = V(t[0]), b = V(t[1]), c = V(t[2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  // bozuk ve tekrarlı üçgenler
  const seen = new Set(), good = [];
  for (const t of tris) {
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2] || area2(t) < 1e-9) { report.degenerate++; continue; }
    const key = t.slice().sort((a, b) => a - b).join(',');
    if (seen.has(key)) { report.duplicate++; continue; }
    seen.add(key); good.push(t);
  }
  // kenar -> üçgenler
  const ek = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;
  const buildEdges = () => {
    const E = new Map();
    good.forEach((t, i) => { for (let k = 0; k < 3; k++) { const key = ek(t[k], t[(k + 1) % 3]); let l = E.get(key); if (!l) E.set(key, l = []); l.push(i); } });
    return E;
  };
  let E = buildEdges();
  E.forEach(l => { if (l.length > 2) report.nonManifold++; });
  // yön tutarlılığı: komşu üçgen ortak kenarı aynı yönde kullanıyorsa ters çevir (BFS)
  const dir = (t, a, b) => { for (let k = 0; k < 3; k++) if (t[k] === a && t[(k + 1) % 3] === b) return true; return false; };
  const visited = new Uint8Array(good.length);
  for (let s = 0; s < good.length; s++) {
    if (visited[s]) continue;
    const comp = [s]; visited[s] = 1;
    for (let h = 0; h < comp.length; h++) {
      const t = good[comp[h]];
      for (let k = 0; k < 3; k++) {
        const a = t[k], b = t[(k + 1) % 3], l = E.get(ek(a, b));
        if (!l || l.length !== 2) continue;
        const o = l[0] === comp[h] ? l[1] : l[0];
        if (visited[o]) continue;
        if (dir(good[o], a, b)) { good[o] = [good[o][0], good[o][2], good[o][1]]; report.flipped++; }
        visited[o] = 1; comp.push(o);
      }
    }
    // gövdenin hacmi negatifse (içe bakıyorsa) hepsini çevir
    let vol = 0;
    comp.forEach(i => { const a = V(good[i][0]), b = V(good[i][1]), c = V(good[i][2]); vol += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); });
    if (vol < 0) comp.forEach(i => { good[i] = [good[i][0], good[i][2], good[i][1]]; });
  }
  // delik kapatma: tek üçgene ait (sınır) kenarları halkalara topla, düzleme izdüşürüp üçgenle
  E = buildEdges();
  const next = new Map();
  E.forEach((l, key) => {
    if (l.length !== 1) return;
    const t = good[l[0]];
    for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3]; if (ek(a, b) === key) next.set(b, a); } // delik halkası ters yönde dolaşılır
  });
  const used = new Set();
  next.forEach((_, start) => {
    if (used.has(start)) return;
    const loop = [start]; used.add(start);
    let c = next.get(start), guard = 0;
    while (c !== undefined && c !== start && !used.has(c) && guard++ < 100000) { loop.push(c); used.add(c); c = next.get(c); }
    if (c !== start || loop.length < 3 || loop.length > 5000) return;
    // Newell normali ve düzlem koordinatları
    let nx = 0, ny = 0, nz = 0;
    const P = loop.map(V);
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    const n = new THREE.Vector3(nx, ny, nz); if (n.lengthSq() < 1e-12) return; n.normalize();
    const u = new THREE.Vector3(1, 0, 0); if (Math.abs(n.x) > 0.9) u.set(0, 1, 0);
    u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    const p2 = P.map(p => new THREE.Vector2(p[0] * u.x + p[1] * u.y + p[2] * u.z, p[0] * w.x + p[1] * w.y + p[2] * w.z));
    let faces = [];
    try { faces = THREE.ShapeUtils.triangulateShape(p2, []); } catch (e) { faces = []; }
    if (!faces.length) { // yedek: merkezden yelpaze
      const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length, cz = P.reduce((s, p) => s + p[2], 0) / P.length;
      const ci = verts.length / 3; verts.push(cx, cy, cz);
      for (let i = 0; i < loop.length; i++) good.push([loop[i], loop[(i + 1) % loop.length], ci]);
      report.holeTris += loop.length;
    } else {
      const ccw = !THREE.ShapeUtils.isClockWise(p2);
      faces.forEach(f => { good.push(ccw ? [loop[f[0]], loop[f[1]], loop[f[2]]] : [loop[f[0]], loop[f[2]], loop[f[1]]]); });
      report.holeTris += faces.length;
    }
    report.holes++;
  });
  const out = new Float32Array(good.length * 9);
  good.forEach((t, i) => { for (let k = 0; k < 3; k++) { const v = V(t[k]); out[i * 9 + k * 3] = v[0]; out[i * 9 + k * 3 + 1] = v[1]; out[i * 9 + k * 3 + 2] = v[2]; } });
  report.changed = report.degenerate + report.duplicate + report.flipped + report.holes > 0;
  return { positions: out, report };
}

export function repairSummary(r) {
  const p = [];
  if (r.holes) p.push(`${r.holes} delik kapatıldı`);
  if (r.flipped) p.push(`${r.flipped} ters üçgen düzeltildi`);
  if (r.degenerate + r.duplicate) p.push(`${r.degenerate + r.duplicate} bozuk/tekrarlı üçgen silindi`);
  if (r.nonManifold) p.push(`${r.nonManifold} çok yüzlü kenar (onarılamadı, dilimleme yine de denenir)`);
  return p.join(', ');
}
