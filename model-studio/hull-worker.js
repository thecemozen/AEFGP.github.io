// Photo → 3D engine (runs fully in the browser, no server, no AI service).
//
// Method: "shape from silhouette" (visual hull) with smooth signed-distance fields.
//  1. Every view (front/back/left/right/top) arrives as a cropped binary mask.
//  2. Each mask becomes a 2D signed distance image (+ inside, - outside).
//  3. A 3D field is the minimum of all views' distances (= the visual hull), optionally
//     with the crease between the two extrusions rounded ("roundness") so sections are not boxy.
//  4. Marching cubes (slice by slice, shared vertices → watertight indexed mesh).
//  5. Taubin smoothing (shrink-free) to remove the voxel staircase.
// Output is in millimetres, Y-up (the app converts to Z-up when writing the STL).

importScripts('mc-tables.js');
const edgeTable = self.MC_edgeTable, triTable = self.MC_triTable;

const post = (stage, pct) => self.postMessage({ type: 'progress', stage, pct });

/* ---------------- 2D signed distance (Felzenszwalb & Huttenlocher) ---------------- */
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
// squared distance from each pixel to the nearest pixel where target(px) is true
function edt2d(mask, w, h, target) {
  const INF = 1e20, out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (mask[i] === target) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}
function signedDistance(mask, w, h) {
  const dOut = edt2d(mask, w, h, 0), dIn = edt2d(mask, w, h, 1);
  const sd = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) sd[i] = mask[i] ? Math.sqrt(dOut[i]) - 0.5 : -(Math.sqrt(dIn[i]) - 0.5);
  return sd;
}

/* ---------------- a view: sampling helpers ---------------- */
// mask has `pad` empty pixels around the object's bounding box; u,v ∈ [0,1] cover the bbox.
function makeView(m) {
  const { w, h, pad } = m;
  const mask = m.mirror ? flipX(m.mask, w, h) : m.mask;
  const sd = blur2d(signedDistance(mask, w, h), w, h, Math.max(1.2, Math.min(w, h) / 300));
  const cw = w - 2 * pad, ch = h - 2 * pad;
  return {
    w, h, pad, cw, ch, sd,
    px(u) { return pad + u * cw - 0.5; },
    py(v) { return pad + v * ch - 0.5; },
    // bilinear signed distance in pixels
    sample(u, v) {
      let x = this.px(u), y = this.py(v);
      x = Math.min(Math.max(x, 0), w - 1.001); y = Math.min(Math.max(y, 0), h - 1.001);
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
      const a = sd[i], b = sd[i + 1], c = sd[i + w], d = sd[i + w + 1];
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    },
  };
}
// separable gaussian blur (removes 1-pixel jaggies along the silhouette edge)
function blur2d(a, w, h, sigma) {
  const r = Math.ceil(sigma * 2.5), k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += a[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
    t[y * w + x] = acc;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += t[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
    o[y * w + x] = acc;
  }
  return o;
}

// For every inside cell: the largest distance value inside its horizontal run (= half-thickness of
// that part in this row), then smoothed vertically so the rounding radius changes gradually.
function halfThickness(D, n, ny, radius) {
  const T = new Float32Array(D.length);
  for (let j = 0; j < ny; j++) {
    let c = 0;
    while (c < n) {
      if (!(D[j * n + c] > 0)) { c++; continue; }
      const s0 = c; let m = 0;
      while (c < n && D[j * n + c] > 0) { m = Math.max(m, D[j * n + c]); c++; }
      for (let q = s0; q < c; q++) T[j * n + q] = m;
    }
  }
  const O = T.slice();
  for (let j = 0; j < ny; j++) for (let c = 0; c < n; c++) {
    if (!(T[j * n + c] > 0)) continue;
    let sum = 0, w = 0;
    for (let d = -radius; d <= radius; d++) {
      const jj = j + d; if (jj < 0 || jj >= ny) continue;
      const t = T[jj * n + c]; if (!(t > 0)) continue;
      const g = Math.exp(-2 * d * d / (radius * radius)); sum += t * g; w += g;
    }
    O[j * n + c] = sum / w;
  }
  return O;
}

function flipX(mask, w, h) {
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = mask[y * w + (w - 1 - x)];
  return o;
}

/* ---------------- main build ---------------- */
self.onmessage = e => {
  try { build(e.data); }
  catch (err) { self.postMessage({ type: 'error', message: err.message || String(err) }); }
};

function build({ views: raw, res, roundness, smooth, heightMm }) {
  post('Silüetler hazırlanıyor', 2);
  const V = {};
  for (const k of ['front', 'back', 'left', 'right', 'top']) if (raw[k]) V[k] = makeView(raw[k]);
  const fv = V.front || V.back, sv = V.left || V.right;
  if (!fv || !sv) throw new Error('En az bir ön/arka ve bir sol/sağ görsel gerekli');

  // Object size in normalised units (height = 1)
  const H = 1;
  const X = fv.cw / fv.ch, Z = sv.cw / sv.ch;

  // Grid
  const s = Math.max(X, H, Z) / res;
  const M = 2; // empty margin cells
  const nx = Math.ceil(X / s) + 2 * M + 1, ny = Math.ceil(H / s) + 2 * M + 1, nz = Math.ceil(Z / s) + 2 * M + 1;
  const x0 = -X / 2 - M * s, y0 = -M * s, z0 = -Z / 2 - M * s;

  // Distance scale: pixels → normalised units (per view)
  const kF = H / fv.ch, kS = H / sv.ch;

  // Opposing views are combined as a consensus (average of their signed distances): photos and
  // AI turnarounds never match pixel-perfectly, and a strict intersection would cut terraces.
  const pair = (a, b) => a === Infinity ? b : (a + b) / 2;
  // Precompute per (i,j) front/back terms and per (k,j) side terms → the 3D loop only takes minima.
  const FB = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const v = 1 - (y0 + j * s) / H;
    for (let i = 0; i < nx; i++) {
      const u = (x0 + i * s + X / 2) / X;
      let d = Infinity;
      if (V.front) d = V.front.sample(u, v) * kF;
      if (V.back) d = pair(d, V.back.sample(1 - u, v) * (H / V.back.ch));
      FB[j * nx + i] = d;
    }
  }
  const SD = new Float32Array(nz * ny);
  for (let j = 0; j < ny; j++) {
    const v = 1 - (y0 + j * s) / H;
    for (let k = 0; k < nz; k++) {
      const uL = (z0 + k * s + Z / 2) / Z;  // left camera sits at -X, its image-right is +Z
      let d = Infinity;
      if (V.left) d = V.left.sample(uL, v) * kS;
      if (V.right) d = pair(d, V.right.sample(1 - uL, v) * (H / V.right.ch));
      SD[j * nz + k] = d;
    }
  }

  let TOP = null;
  if (V.top) {
    // top camera looks down; image top = back (-Z), image right = +X
    TOP = new Float32Array(nx * nz);
    const kT = (X / V.top.cw + Z / V.top.ch) / 2;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      TOP[k * nx + i] = V.top.sample((x0 + i * s + X / 2) / X, (z0 + k * s + Z / 2) / Z) * kT;
    }
  }

  // Roundness. The plain visual hull is the intersection of two extrusions, so its horizontal
  // cross-sections are rectangles. We round the crease between them with a radius proportional to
  // the local half-thickness of the part (its maximum inscribed distance), which turns
  // rectangles into stadium/ellipse-like sections: r = roundness * min(halfWidthX, halfWidthZ).
  const FBt = halfThickness(FB, nx, ny, Math.max(2, Math.round(res / 50)));
  const SDt = halfThickness(SD, nz, ny, Math.max(2, Math.round(res / 50)));

  function fillSlice(k, out) {
    for (let j = 0; j < ny; j++) {
      const b = SD[j * nz + k], bt = SDt[j * nz + k];
      for (let i = 0; i < nx; i++) {
        const a = FB[j * nx + i];
        let f;
        if (roundness > 0 && a > 0 && b > 0) {
          const r = roundness * Math.min(FBt[j * nx + i], bt) + 1e-6;
          const ea = Math.max(r - a, 0), eb = Math.max(r - b, 0);
          f = r - Math.sqrt(ea * ea + eb * eb);
        } else f = Math.min(a, b);
        if (TOP) f = Math.min(f, TOP[k * nx + i]);
        out[j * nx + i] = f === 0 ? 1e-7 : f;
      }
    }
  }

  /* ---------- marching cubes, slice by slice ---------- */
  post('Hacim oluşturuluyor', 8);
  const pos = [], idx = [];
  const vmap = new Map();
  let f0 = new Float32Array(nx * ny), f1 = new Float32Array(nx * ny);
  fillSlice(0, f0);
  const cv = new Float32Array(8);
  const CI = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  // edge → [cornerA, cornerB, dir, di, dj, dk] (base grid point of the edge)
  const E = [[0, 1, 0, 0, 0, 0], [1, 2, 1, 1, 0, 0], [3, 2, 0, 0, 1, 0], [0, 3, 1, 0, 0, 0],
    [4, 5, 0, 0, 0, 1], [5, 6, 1, 1, 0, 1], [7, 6, 0, 0, 1, 1], [4, 7, 1, 0, 0, 1],
    [0, 4, 2, 0, 0, 0], [1, 5, 2, 1, 0, 0], [2, 6, 2, 1, 1, 0], [3, 7, 2, 0, 1, 0]];
  const ev = new Int32Array(12);

  for (let k = 0; k < nz - 1; k++) {
    fillSlice(k + 1, f1);
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        cv[0] = f0[a]; cv[1] = f0[a + 1]; cv[2] = f0[a + nx + 1]; cv[3] = f0[a + nx];
        cv[4] = f1[a]; cv[5] = f1[a + 1]; cv[6] = f1[a + nx + 1]; cv[7] = f1[a + nx];
        let ci = 0;
        for (let c = 0; c < 8; c++) if (cv[c] < 0) ci |= 1 << c;
        const bits = edgeTable[ci];
        if (!bits) continue;
        for (let e = 0; e < 12; e++) {
          if (!(bits & (1 << e))) continue;
          const [ca, cb, dir, di, dj, dk] = E[e];
          const key = (((k + dk) * ny + (j + dj)) * nx + (i + di)) * 3 + dir;
          let vi = vmap.get(key);
          if (vi === undefined) {
            const va = cv[ca], vb = cv[cb];
            const t = va / (va - vb);
            const A = CI[ca], B = CI[cb];
            vi = pos.length / 3;
            pos.push(
              x0 + (i + A[0] + (B[0] - A[0]) * t) * s,
              y0 + (j + A[1] + (B[1] - A[1]) * t) * s,
              z0 + (k + A[2] + (B[2] - A[2]) * t) * s);
            vmap.set(key, vi);
          }
          ev[e] = vi;
        }
        const tb = ci * 16;
        for (let t = 0; triTable[tb + t] !== -1; t += 3) {
          const A = ev[triTable[tb + t]], B = ev[triTable[tb + t + 1]], C = ev[triTable[tb + t + 2]];
          if (A !== B && B !== C && A !== C) idx.push(A, B, C);
        }
      }
    }
    const tmp = f0; f0 = f1; f1 = tmp;
    if (k % 4 === 0) post('Hacim oluşturuluyor', 8 + Math.round(72 * k / nz));
  }
  vmap.clear();
  if (!idx.length) throw new Error('Model oluşmadı — maskeleri kontrol edin (nesne seçili görünmeli)');

  let P = new Float32Array(pos);
  const I = new Uint32Array(idx);

  /* ---------- orientation: make normals point outwards ---------- */
  let vol = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
         - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
         + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (vol < 0) for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }

  /* ---------- Taubin smoothing ---------- */
  if (smooth > 0) {
    post('Pürüzsüzleştiriliyor', 82);
    P = taubin(P, I, smooth);
  }

  /* ---------- scale to millimetres, sit on the ground ---------- */
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < P.length; i += 3) { if (P[i] < minY) minY = P[i]; if (P[i] > maxY) maxY = P[i]; }
  const scale = heightMm / (maxY - minY);
  const bb = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    P[i] *= scale; P[i + 1] = (P[i + 1] - minY) * scale; P[i + 2] *= scale;
    for (let a = 0; a < 3; a++) { bb[a * 2] = Math.min(bb[a * 2], P[i + a]); bb[a * 2 + 1] = Math.max(bb[a * 2 + 1], P[i + a]); }
  }
  post('Bitti', 100);
  self.postMessage({ type: 'done', positions: P, indices: I,
    size: [bb[1] - bb[0], bb[3] - bb[2], bb[5] - bb[4]] }, [P.buffer, I.buffer]);
}

function taubin(P, I, iters) {
  const n = P.length / 3;
  // CSR adjacency
  const deg = new Uint32Array(n);
  for (let t = 0; t < I.length; t++) deg[I[t]] += 2;
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
  const fill = start.slice(0, n), nb = new Uint32Array(start[n]);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    nb[fill[a]++] = b; nb[fill[a]++] = c;
    nb[fill[b]++] = a; nb[fill[b]++] = c;
    nb[fill[c]++] = a; nb[fill[c]++] = b;
  }
  let A = P, B = new Float32Array(P.length);
  const step = (lambda) => {
    for (let v = 0; v < n; v++) {
      let sx = 0, sy = 0, sz = 0;
      const s0 = start[v], s1 = start[v + 1];
      for (let q = s0; q < s1; q++) { const u = nb[q] * 3; sx += A[u]; sy += A[u + 1]; sz += A[u + 2]; }
      const c = s1 - s0, o = v * 3;
      if (!c) { B[o] = A[o]; B[o + 1] = A[o + 1]; B[o + 2] = A[o + 2]; continue; }
      B[o] = A[o] + lambda * (sx / c - A[o]);
      B[o + 1] = A[o + 1] + lambda * (sy / c - A[o + 1]);
      B[o + 2] = A[o + 2] + lambda * (sz / c - A[o + 2]);
    }
    const t = A; A = B; B = t;
  };
  for (let it = 0; it < iters; it++) {
    step(0.5); step(-0.53);
    if (it % 2 === 0) post('Pürüzsüzleştiriliyor', 82 + Math.round(16 * it / iters));
  }
  return A;
}
