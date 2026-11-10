/*
 * K1 Max Dilimleyici - dilimleme motoru (v2)
 * Tarayıcıda Web Worker içinde (importScripts) ve Node'da (require) çalışır.
 * Koordinatlar mm cinsindendir; Clipper için 1000 ile ölçeklenir (1 birim = 1 µm).
 *
 * Girdi:
 *   job = {
 *     parts: [{ positions: Float32Array (tablaya yerleşmiş üçgenler), slot: 0..3, name }],
 *     S: işlem + yazıcı ayarları (presets.js anahtarları),
 *     fils: [yuva 0..3 için filament ayarları],
 *     thumbnail: { w, h, b64 } | null
 *   }
 */
(function (root) {
  'use strict';

  var CL = root.ClipperLib || (typeof require !== 'undefined' ? require('clipper-lib') : null);
  var SCALE = 1000;

  // Önizleme hareket türleri
  var T = { OUTER: 0, INNER: 1, SOLID: 2, SPARSE: 3, SKIRT: 4, TRAVEL: 5, TOP: 6, SUPPORT: 7, IFACE: 8, BRIDGE: 9, IRON: 10, TOWER: 11, GAP: 12 };
  var PV = 11; // önizleme kaydı: x1 y1 z1 x2 y2 z2 tür yuva genişlik yükseklik hız

  // ---------------------------------------------------------------- Clipper yardımcıları
  function clipperOp(type, subj, clip) {
    var c = new CL.Clipper();
    c.AddPaths(subj, CL.PolyType.ptSubject, true);
    if (clip && clip.length) c.AddPaths(clip, CL.PolyType.ptClip, true);
    var out = new CL.Paths();
    c.Execute(type, out, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    return out;
  }
  function union(a) { return a.length ? clipperOp(CL.ClipType.ctUnion, a, null) : []; }
  function intersect(a, b) { return (a.length && b.length) ? clipperOp(CL.ClipType.ctIntersection, a, b) : []; }
  function difference(a, b) { if (!a.length) return []; if (!b.length) return a; return clipperOp(CL.ClipType.ctDifference, a, b); }

  function offset(paths, delta, round) {
    if (!paths.length) return [];
    if (!delta) return paths;
    var co = new CL.ClipperOffset(2, 0.25 * SCALE / 100);
    co.AddPaths(paths, round ? CL.JoinType.jtRound : CL.JoinType.jtMiter, CL.EndType.etClosedPolygon);
    var out = new CL.Paths();
    co.Execute(out, delta * SCALE);
    return out;
  }
  // morfolojik açma: genişliği d'den ince parçaları atar
  function opening(paths, d) { return offset(offset(paths, -d / 2, false), d / 2, false); }

  function areaOf(paths) {
    var a = 0;
    for (var i = 0; i < paths.length; i++) a += CL.Clipper.Area(paths[i]);
    return a / (SCALE * SCALE);
  }

  function polyTree(paths) {
    var c = new CL.Clipper();
    c.AddPaths(paths, CL.PolyType.ptSubject, true);
    var tree = new CL.PolyTree();
    c.Execute(CL.ClipType.ctUnion, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    return tree;
  }

  // Ada (dış kontur + delikler) listesi: [[outer, hole, hole...], ...]
  function islandsOf(paths) {
    if (!paths.length) return [];
    var res = [];
    (function walk(node) {
      var ch = node.Childs();
      for (var i = 0; i < ch.length; i++) {
        var n = ch[i];
        if (!n.IsHole()) {
          var isl = [n.Contour()];
          var holes = n.Childs();
          for (var j = 0; j < holes.length; j++) { isl.push(holes[j].Contour()); walk(holes[j]); }
          res.push(isl);
        }
      }
    })(polyTree(paths));
    return res;
  }

  function bboxOf(paths) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    paths.forEach(function (p) { p.forEach(function (pt) {
      if (pt.X < b.minX) b.minX = pt.X; if (pt.X > b.maxX) b.maxX = pt.X;
      if (pt.Y < b.minY) b.minY = pt.Y; if (pt.Y > b.maxY) b.maxY = pt.Y;
    }); });
    return b;
  }
  function rectPath(x0, y0, x1, y1) {
    return [{ X: Math.round(x0 * SCALE), Y: Math.round(y0 * SCALE) }, { X: Math.round(x1 * SCALE), Y: Math.round(y0 * SCALE) },
            { X: Math.round(x1 * SCALE), Y: Math.round(y1 * SCALE) }, { X: Math.round(x0 * SCALE), Y: Math.round(y1 * SCALE) }];
  }

  // XY telafisi: dış konturları ve delikleri ayrı ayrı büyütür/küçültür
  function xyCompensate(paths, contour, hole) {
    if (!paths.length || (!contour && !hole)) return paths;
    var outers = [], holes = [];
    islandsOf(paths).forEach(function (isl) {
      outers.push(isl[0]);
      for (var i = 1; i < isl.length; i++) holes.push(isl[i].slice().reverse());
    });
    // pozitif delik telafisi deliği büyütür
    return difference(offset(outers, contour, false), offset(holes, hole, false));
  }

  // ---------------------------------------------------------------- mesh
  function indexMesh(positions) {
    var map = new Map();
    var verts = [];
    var nTri = positions.length / 9;
    var idx = new Uint32Array(nTri * 3);
    var q = 1e4;
    for (var i = 0; i < nTri * 3; i++) {
      var x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      var key = Math.round(x * q) + ',' + Math.round(y * q) + ',' + Math.round(z * q);
      var id = map.get(key);
      if (id === undefined) { id = verts.length / 3; verts.push(x, y, z); map.set(key, id); }
      idx[i] = id;
    }
    var v = new Float64Array(verts);
    var maxZ = 0;
    for (var k = 2; k < v.length; k += 3) if (v[k] > maxZ) maxZ = v[k];
    return { v: v, idx: idx, nTri: nTri, maxZ: maxZ };
  }

  function sliceAt(mesh, tris, z) {
    var v = mesh.v, idx = mesh.idx;
    var segs = [];
    for (var t = 0; t < tris.length; t++) {
      var ti = tris[t] * 3;
      var ids = [idx[ti], idx[ti + 1], idx[ti + 2]];
      var pts = [];
      for (var e = 0; e < 3; e++) {
        var a = ids[e], b = ids[(e + 1) % 3];
        var za = v[a * 3 + 2], zb = v[b * 3 + 2];
        if ((za >= z) !== (zb >= z)) {
          var s = (z - za) / (zb - za);
          var key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
          pts.push(key, v[a * 3] + (v[b * 3] - v[a * 3]) * s, v[a * 3 + 1] + (v[b * 3 + 1] - v[a * 3 + 1]) * s);
        }
      }
      if (pts.length === 6) segs.push(pts);
    }
    var byKey = new Map();
    for (var k = 0; k < segs.length; k++) {
      for (var end = 0; end < 2; end++) {
        var kk = segs[k][end * 3];
        var arr = byKey.get(kk);
        if (!arr) { arr = []; byKey.set(kk, arr); }
        arr.push(k);
      }
    }
    var used = new Uint8Array(segs.length);
    var loops = [], open = [];
    var P = function (x, y) { return { X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }; };
    for (var st = 0; st < segs.length; st++) {
      if (used[st]) continue;
      used[st] = 1;
      var cur = segs[st];
      var loop = [P(cur[1], cur[2]), P(cur[4], cur[5])];
      var nextKey = cur[3], startKey = cur[0], guard = 0;
      while (nextKey !== startKey && guard++ < 1e7) {
        var cand = byKey.get(nextKey), found = -1;
        if (cand) for (var c = 0; c < cand.length; c++) if (!used[cand[c]]) { found = cand[c]; break; }
        if (found < 0) break;
        used[found] = 1;
        var sg = segs[found];
        if (sg[0] === nextKey) { nextKey = sg[3]; loop.push(P(sg[4], sg[5])); }
        else { nextKey = sg[0]; loop.push(P(sg[1], sg[2])); }
      }
      if (nextKey === startKey) { if (loop.length >= 3) loops.push(loop); }
      else if (loop.length >= 2) open.push(loop);
    }
    // Bozuk modellerde kapanmayan kesit zincirlerini en yakın uçlarından birleştir (en fazla 2 mm boşluk)
    var gapMax = 2 * SCALE;
    while (open.length) {
      var ch = open.shift(), grew = true;
      while (grew) {
        grew = false;
        var end = ch[ch.length - 1], bi = -1, bd = Infinity, rev = false;
        for (var oi = 0; oi < open.length; oi++) {
          var o2 = open[oi], d1 = Math.hypot(o2[0].X - end.X, o2[0].Y - end.Y), d2 = Math.hypot(o2[o2.length - 1].X - end.X, o2[o2.length - 1].Y - end.Y);
          if (d1 < bd) { bd = d1; bi = oi; rev = false; }
          if (d2 < bd) { bd = d2; bi = oi; rev = true; }
        }
        var dSelf = Math.hypot(ch[0].X - end.X, ch[0].Y - end.Y);
        if (bi >= 0 && bd <= gapMax && bd < dSelf) { var nx2 = open.splice(bi, 1)[0]; ch = ch.concat(rev ? nx2.reverse() : nx2); grew = true; }
      }
      if (ch.length >= 3) loops.push(ch); // birleşecek başka zincir yoksa kendi uçlarından kapat (katman kaybolmasın)
    }
    if (!loops.length) return [];
    var cl = new CL.Clipper();
    cl.AddPaths(loops, CL.PolyType.ptSubject, true);
    var out = new CL.Paths();
    cl.Execute(CL.ClipType.ctUnion, out, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftEvenOdd);
    out = CL.Clipper.CleanPolygons(out, 0.01 * SCALE);
    return out.filter(function (p) { return Math.abs(CL.Clipper.Area(p)) > 0.01 * SCALE * SCALE; });
  }

  // ---------------------------------------------------------------- dolgu desenleri
  function rotatePaths(paths, ang) {
    var c = Math.cos(ang), s = Math.sin(ang);
    return paths.map(function (p) {
      return p.map(function (pt) { return { X: Math.round(pt.X * c - pt.Y * s), Y: Math.round(pt.X * s + pt.Y * c) }; });
    });
  }

  // Paralel çizgiler: [[x1,y1,x2,y2,sıra], ...] (mm). Çizgiler global ızgaraya hizalıdır.
  function lineFill(region, spacing, angleDeg) {
    if (!region.length || spacing <= 0) return [];
    var ang = angleDeg * Math.PI / 180;
    var rot = rotatePaths(region, -ang);
    var b = bboxOf(rot);
    var sp = spacing * SCALE;
    var lines = [];
    for (var y = Math.ceil(b.minY / sp) * sp; y <= b.maxY; y += sp) {
      lines.push([{ X: b.minX - 10, Y: Math.round(y) }, { X: b.maxX + 10, Y: Math.round(y) }]);
    }
    if (!lines.length) return [];
    var c = new CL.Clipper();
    c.AddPaths(lines, CL.PolyType.ptSubject, false);
    c.AddPaths(rot, CL.PolyType.ptClip, true);
    var tree = new CL.PolyTree();
    c.Execute(CL.ClipType.ctIntersection, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    var open = CL.Clipper.OpenPathsFromPolyTree(tree);
    var cs = Math.cos(ang), sn = Math.sin(ang);
    var res = [];
    for (var i = 0; i < open.length; i++) {
      var p = open[i];
      if (p.length < 2) continue;
      var a = p[0], q = p[p.length - 1];
      if (a.X > q.X) { var tmp = a; a = q; q = tmp; }
      var ax = (a.X * cs - a.Y * sn) / SCALE, ay = (a.X * sn + a.Y * cs) / SCALE;
      var bx = (q.X * cs - q.Y * sn) / SCALE, by = (q.X * sn + q.Y * cs) / SCALE;
      var dx = bx - ax, dy = by - ay;
      if (dx * dx + dy * dy < 0.04) continue;
      res.push([ax, ay, bx, by, a.Y, a.X]);
    }
    return res;
  }

  function gyroidFill(region, spacing, z) {
    if (!region.length) return [];
    var b = bboxOf(region);
    var minX = b.minX / SCALE, maxX = b.maxX / SCALE, minY = b.minY / SCALE, maxY = b.maxY / SCALE;
    var period = spacing * 2;
    var k = 2 * Math.PI / period;
    var zz = z * k, sz = Math.sin(zz), cz = Math.cos(zz);
    var step = Math.max(0.25, period / 24);
    var nMin = Math.floor(minY / period) - 1, nMax = Math.ceil(maxY / period) + 1;
    var curves = [];
    for (var branch = 0; branch < 2; branch++) {
      for (var n = nMin; n <= nMax; n++) {
        var cur = null, prevY = null;
        for (var x = minX - step; x <= maxX + step; x += step) {
          var xx = x * k, sx = Math.sin(xx);
          var R = Math.sqrt(sx * sx + cz * cz);
          var rhs = -sz * Math.cos(xx);
          if (R < 1e-9 || Math.abs(rhs) > R) { if (cur && cur.length > 1) curves.push(cur); cur = null; prevY = null; continue; }
          var phi = Math.atan2(cz, sx);
          var as = Math.asin(rhs / R);
          var y = ((branch === 0 ? as : Math.PI - as) - phi + 2 * Math.PI * n) / k;
          if (prevY !== null && Math.abs(y - prevY) > period * 0.4) { if (cur && cur.length > 1) curves.push(cur); cur = null; }
          if (!cur) cur = [];
          cur.push({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) });
          prevY = y;
        }
        if (cur && cur.length > 1) curves.push(cur);
      }
    }
    return clipOpen(curves, region);
  }

  function clipOpen(curves, region) {
    if (!curves.length) return [];
    var c = new CL.Clipper();
    c.AddPaths(curves, CL.PolyType.ptSubject, false);
    c.AddPaths(region, CL.PolyType.ptClip, true);
    var tree = new CL.PolyTree();
    c.Execute(CL.ClipType.ctIntersection, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    return CL.Clipper.OpenPathsFromPolyTree(tree).filter(function (p) { return p.length >= 2; }).map(function (p) {
      return p.map(function (pt) { return [pt.X / SCALE, pt.Y / SCALE]; });
    });
  }

  // Eş merkezli halkalar (dıştan içe)
  function concentricFill(region, spacing) {
    var loops = [];
    var cur = offset(region, -spacing / 2, false);
    var guard = 0;
    while (cur.length && guard++ < 2000) {
      cur.forEach(function (p) { loops.push(p); });
      cur = offset(cur, -spacing, false);
    }
    return loops;
  }

  // ---------------------------------------------------------------- boşluk doldurma / ince duvarlar
  // Duvarların ve dolgunun kapatamadığı dar bölgelerin orta hattını (medial axis) bulur.
  // Yöntem: bölgeyi ince bir ızgaraya çiz, her hücrenin kenara uzaklığını hesapla (Öklid uzaklık dönüşümü),
  // şekli tek piksellik iskelete incelt (Zhang-Suen), iskeleti çizgilere çevir. Çizgi genişliği = 2 × kenara uzaklık.
  // Döndürür: [[[x, y, genişlik], ...], ...] (mm)
  var INF = 1e20;
  function edt1d(f, n, d, v, z) {
    var k = 0, q, s;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (q = 1; q < n; q++) {
      for (;;) {
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s <= z[k]) { k--; if (k < 0) { k = 0; break; } } else break;
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  }
  function edt2d(mask, W, H) {
    var f = new Float64Array(W * H), n = Math.max(W, H);
    var col = new Float64Array(n), dd = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    for (var i = 0; i < W * H; i++) f[i] = mask[i] ? INF : 0;
    for (var x = 0; x < W; x++) {
      for (var y = 0; y < H; y++) col[y] = f[y * W + x];
      edt1d(col, H, dd, v, z);
      for (y = 0; y < H; y++) f[y * W + x] = dd[y];
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) col[x] = f[y * W + x];
      edt1d(col, W, dd, v, z);
      for (x = 0; x < W; x++) f[y * W + x] = dd[x];
    }
    return f; // kare piksel uzaklığı
  }
  function thinZS(m, W, H) {
    var changed = true, del = [];
    while (changed) {
      changed = false;
      for (var pass = 0; pass < 2; pass++) {
        del.length = 0;
        for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
          var i = y * W + x; if (!m[i]) continue;
          var p2 = m[i - W], p3 = m[i - W + 1], p4 = m[i + 1], p5 = m[i + W + 1], p6 = m[i + W], p7 = m[i + W - 1], p8 = m[i - 1], p9 = m[i - W - 1];
          var B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          var A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (A !== 1) continue;
          if (pass === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
          del.push(i);
        }
        if (del.length) { changed = true; for (var k = 0; k < del.length; k++) m[del[k]] = 0; }
      }
    }
  }
  function rdpW(pts, tol) {
    if (pts.length < 3) return pts;
    var keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    (function rec(a, b) {
      var ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1], L = Math.hypot(bx - ax, by - ay) || 1e-9, md = -1, mi = -1;
      for (var i = a + 1; i < b; i++) {
        var d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
        var dw = Math.abs(pts[i][2] - (pts[a][2] + (pts[b][2] - pts[a][2]) * (i - a) / (b - a)));
        d = Math.max(d, dw * 0.5);
        if (d > md) { md = d; mi = i; }
      }
      if (md > tol) { keep[mi] = 1; rec(a, mi); rec(mi, b); }
    })(0, pts.length - 1);
    return pts.filter(function (_, i) { return keep[i]; });
  }
  function gapPolylines(region, minW, maxW) {
    var out = [];
    islandsOf(region).forEach(function (isl) {
      var b = bboxOf(isl);
      var x0 = b.minX / SCALE, y0 = b.minY / SCALE, wmm = (b.maxX - b.minX) / SCALE, hmm = (b.maxY - b.minY) / SCALE;
      if (wmm <= 0 || hmm <= 0) return;
      var res = Math.min(0.08, Math.max(0.025, Math.sqrt(wmm * hmm / 1.2e6)));
      var pad = 2, W = Math.ceil(wmm / res) + 2 * pad, H = Math.ceil(hmm / res) + 2 * pad;
      var mask = new Uint8Array(W * H);
      // tarama çizgisi ile doldur (dış kontur + delikler, çift-tek kuralı)
      var edges = [];
      isl.forEach(function (p) { for (var i = 0; i < p.length; i++) { var a = p[i], c = p[(i + 1) % p.length]; edges.push([a.X / SCALE, a.Y / SCALE, c.X / SCALE, c.Y / SCALE]); } });
      var xs = [];
      for (var j = 0; j < H; j++) {
        var yc = y0 + (j - pad + 0.5) * res;
        xs.length = 0;
        for (var e = 0; e < edges.length; e++) {
          var E = edges[e];
          if ((E[1] <= yc) !== (E[3] <= yc)) xs.push(E[0] + (yc - E[1]) / (E[3] - E[1]) * (E[2] - E[0]));
        }
        xs.sort(function (a, c) { return a - c; });
        for (var k = 0; k + 1 < xs.length; k += 2) {
          var i0 = Math.max(0, Math.ceil((xs[k] - x0) / res + pad - 0.5)), i1 = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / res + pad - 0.5));
          for (var ii = i0; ii <= i1; ii++) mask[j * W + ii] = 1;
        }
      }
      var dist = edt2d(mask, W, H);
      var sk = mask.slice();
      thinZS(sk, W, H);
      var halfW = function (i) { return Math.max(0, Math.sqrt(dist[i]) - 0.5) * res; };
      var N8 = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
      var deg = new Uint8Array(W * H);
      for (var c = 0; c < W * H; c++) if (sk[c]) { var dg = 0; for (var q = 0; q < 8; q++) if (sk[c + N8[q]]) dg++; deg[c] = dg; }
      var seen = new Set(), paths = [];
      var ek = function (a, c2) { return a < c2 ? a * 4194304 + c2 : c2 * 4194304 + a; };
      var walk = function (start, next) {
        var path = [start], prev = start, cur = next;
        seen.add(ek(start, next));
        for (var g = 0; g < 1e6; g++) {
          path.push(cur);
          if (deg[cur] !== 2 || cur === start) break;
          var nx = -1;
          for (var q2 = 0; q2 < 8; q2++) { var nb = cur + N8[q2]; if (sk[nb] && nb !== prev && !seen.has(ek(cur, nb))) { nx = nb; break; } }
          if (nx < 0) break;
          seen.add(ek(cur, nx)); prev = cur; cur = nx;
        }
        return path;
      };
      for (c = 0; c < W * H; c++) {
        if (!sk[c] || deg[c] === 2) continue;
        for (q = 0; q < 8; q++) { var nb2 = c + N8[q]; if (sk[nb2] && !seen.has(ek(c, nb2))) paths.push(walk(c, nb2)); }
      }
      for (c = 0; c < W * H; c++) {
        if (!sk[c] || deg[c] !== 2) continue;
        for (q = 0; q < 8; q++) { var nb3 = c + N8[q]; if (sk[nb3] && !seen.has(ek(c, nb3))) paths.push(walk(c, nb3)); }
      }
      // kısa çıkıntıları (köşelere uzanan iskelet dalları) at
      paths = paths.filter(function (pth) {
        var a = pth[0], z2 = pth[pth.length - 1];
        var spur = (deg[a] === 1 && deg[z2] >= 3) || (deg[z2] === 1 && deg[a] >= 3);
        if (!spur) return true;
        var j2 = deg[a] >= 3 ? a : z2;
        return pth.length * res > 2.2 * halfW(j2) + 2 * res;
      });
      paths.forEach(function (pth) {
        var cur = [];
        var flush = function () {
          if (cur.length >= 2) {
            var L = 0; for (var t = 1; t < cur.length; t++) L += Math.hypot(cur[t][0] - cur[t - 1][0], cur[t][1] - cur[t - 1][1]);
            if (L >= Math.max(0.4, 2 * minW)) out.push(rdpW(cur, res * 0.75));
          }
          cur = [];
        };
        pth.forEach(function (i) {
          var w = 2 * halfW(i);
          if (w < minW) { flush(); return; }
          var px = i % W, py = (i - px) / W;
          cur.push([x0 + (px - pad + 0.5) * res, y0 + (py - pad + 0.5) * res, Math.min(maxW, w)]);
        });
        flush();
      });
    });
    // uçları birbirine çok yakın parçaları birleştir (iskeletteki sahte kavşaklar)
    var joined = [];
    out.forEach(function (p) {
      for (var k = 0; k < joined.length; k++) {
        var q = joined[k], a = q[q.length - 1];
        if (Math.hypot(a[0] - p[0][0], a[1] - p[0][1]) < 0.12) { joined[k] = q.concat(p.slice(1)); return; }
      }
      joined.push(p);
    });
    return joined;
  }

  // ---------------------------------------------------------------- duvarları geçmeden dolaşma (combing)
  // Bir katmanın parça içi bölgesini adalara ayırır; her ada için kenar listesi ve yönlendirme düğümleri tutar.
  function combContext(region, nodeRegion) {
    var isl = islandsOf(region).map(function (paths) {
      var polys = paths.map(function (p) { return p.map(function (q) { return [q.X / SCALE, q.Y / SCALE]; }); });
      var b = bboxOf(paths);
      return { polys: polys, minX: b.minX / SCALE, minY: b.minY / SCALE, maxX: b.maxX / SCALE, maxY: b.maxY / SCALE, nodes: null };
    });
    var nodePaths = CL.Clipper.CleanPolygons(nodeRegion, 0.15 * SCALE);
    return { islands: isl, nodePaths: nodePaths };
  }
  function pip(polys, x, y) { // çift-tek kuralı
    var inside = false;
    for (var k = 0; k < polys.length; k++) {
      var p = polys[k];
      for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
        if (((p[i][1] > y) !== (p[j][1] > y)) && (x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0])) inside = !inside;
      }
    }
    return inside;
  }
  function segCross(ax, ay, bx, by, polys) {
    for (var k = 0; k < polys.length; k++) {
      var p = polys[k];
      for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
        var cx = p[j][0], cy = p[j][1], dx = p[i][0], dy = p[i][1];
        var d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
        var d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
      }
    }
    return false;
  }
  function segInside(isl, ax, ay, bx, by) { return !segCross(ax, ay, bx, by, isl.polys) && pip(isl.polys, (ax + bx) / 2, (ay + by) / 2); }
  function findIsland(ctx, x, y) {
    for (var i = 0; i < ctx.islands.length; i++) {
      var I = ctx.islands[i];
      if (x < I.minX || x > I.maxX || y < I.minY || y > I.maxY) continue;
      if (pip(I.polys, x, y)) return I;
    }
    return null;
  }
  // A'dan B'ye ada içinde kalan en kısa yol (görünürlük grafiği + Dijkstra). Bulunamazsa null.
  function combRoute(ctx, ax, ay, bx, by, maxNodes) {
    var I = findIsland(ctx, ax, ay);
    if (!I || I !== findIsland(ctx, bx, by)) return null;
    if (segInside(I, ax, ay, bx, by)) return [[bx, by]];
    if (!I.nodes) {
      I.nodes = [];
      ctx.nodePaths.forEach(function (p) {
        p.forEach(function (q) { var x = q.X / SCALE, y = q.Y / SCALE; if (x >= I.minX && x <= I.maxX && y >= I.minY && y <= I.maxY && pip(I.polys, x, y)) I.nodes.push([x, y]); });
      });
      if (I.nodes.length > maxNodes) I.nodes = I.nodes.filter(function (_, i) { return i % Math.ceil(I.nodes.length / maxNodes) === 0; });
      I.vis = {};
    }
    var N = I.nodes, n = N.length + 2;
    var P = function (i) { return i < N.length ? N[i] : (i === N.length ? [ax, ay] : [bx, by]); };
    var vis = function (i, j) {
      if (i < N.length && j < N.length) { var key = i < j ? i * 100000 + j : j * 100000 + i; if (I.vis[key] === undefined) { var a = P(i), b = P(j); I.vis[key] = segInside(I, a[0], a[1], b[0], b[1]); } return I.vis[key]; }
      var a2 = P(i), b2 = P(j); return segInside(I, a2[0], a2[1], b2[0], b2[1]);
    };
    var dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    var src = N.length, dst = N.length + 1;
    dist[src] = 0;
    for (var it = 0; it < n; it++) {
      var u = -1, best = Infinity;
      for (var k = 0; k < n; k++) if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
      if (u < 0 || u === dst) break;
      done[u] = 1;
      var pu = P(u);
      for (var v = 0; v < n; v++) {
        if (done[v] || v === src) continue;
        var pv = P(v), w = Math.hypot(pv[0] - pu[0], pv[1] - pu[1]);
        if (dist[u] + w >= dist[v]) continue;
        if (!vis(u, v)) continue;
        dist[v] = dist[u] + w; prev[v] = u;
      }
    }
    if (prev[dst] < 0) return null;
    var path = [], c = dst;
    while (c !== src && c >= 0) { path.unshift(P(c)); c = prev[c]; }
    return path;
  }

  // ---------------------------------------------------------------- yol sıralama
  function orderLines(lines, start) {
    var res = [];
    var used = new Uint8Array(lines.length);
    var px = start[0], py = start[1];
    for (var n = 0; n < lines.length; n++) {
      var best = -1, bestD = Infinity, flip = false;
      for (var i = 0; i < lines.length; i++) {
        if (used[i]) continue;
        var l = lines[i];
        var d1 = (l[0] - px) * (l[0] - px) + (l[1] - py) * (l[1] - py);
        var d2 = (l[2] - px) * (l[2] - px) + (l[3] - py) * (l[3] - py);
        if (d1 < bestD) { bestD = d1; best = i; flip = false; }
        if (d2 < bestD) { bestD = d2; best = i; flip = true; }
      }
      used[best] = 1;
      var L = lines[best];
      var seg = flip ? [[L[2], L[3]], [L[0], L[1]]] : [[L[0], L[1]], [L[2], L[3]]];
      res.push(seg);
      px = seg[1][0]; py = seg[1][1];
    }
    return res;
  }

  // Monoton sıralama: çizgiler tarama yönünde sırayla, hepsi aynı yönde basılır (üst yüzeyde düzgün görünüm)
  function orderMonotonic(lines) {
    return lines.slice().sort(function (a, b) { return a[4] - b[4] || a[5] - b[5]; })
      .map(function (L) { return [[L[0], L[1]], [L[2], L[3]]]; });
  }

  function orderPolylines(polys, start) {
    var res = [];
    var used = new Uint8Array(polys.length);
    var px = start[0], py = start[1];
    for (var n = 0; n < polys.length; n++) {
      var best = -1, bestD = Infinity, flip = false;
      for (var i = 0; i < polys.length; i++) {
        if (used[i]) continue;
        var p = polys[i], a = p[0], b = p[p.length - 1];
        var d1 = (a[0] - px) * (a[0] - px) + (a[1] - py) * (a[1] - py);
        var d2 = (b[0] - px) * (b[0] - px) + (b[1] - py) * (b[1] - py);
        if (d1 < bestD) { bestD = d1; best = i; flip = false; }
        if (d2 < bestD) { bestD = d2; best = i; flip = true; }
      }
      used[best] = 1;
      var seg = flip ? polys[best].slice().reverse() : polys[best];
      res.push(seg);
      px = seg[seg.length - 1][0]; py = seg[seg.length - 1][1];
    }
    return res;
  }

  function toPts(path) { return path.map(function (p) { return [p.X / SCALE, p.Y / SCALE]; }); }

  // Kapalı konturu dikiş noktasından başlatır
  function loopFrom(path, seam, near, bedCx) {
    var pts = toPts(path);
    var bi = 0, i;
    if (seam === 'rear') {
      var by = -Infinity;
      for (i = 0; i < pts.length; i++) {
        var score = pts[i][1] - Math.abs(pts[i][0] - bedCx) * 0.05;
        if (score > by) { by = score; bi = i; }
      }
    } else if (seam === 'random') {
      bi = Math.floor(Math.random() * pts.length);
    } else if (seam === 'corner') {
      // Dikişi en keskin (tercihen içbükey) köşeye sakla; köşe yoksa önceki katmanın dikişine hizala
      var n = pts.length, ccw = CL.Clipper.Orientation(path), bestS = -Infinity, bestSharp = 0;
      var nb = function (i0, dir) { var j = i0; for (var t = 0; t < n; t++) { j = (j + dir + n) % n; if (Math.hypot(pts[j][0] - pts[i0][0], pts[j][1] - pts[i0][1]) >= 0.4) return pts[j]; } return pts[(i0 + dir + n) % n]; };
      for (i = 0; i < n; i++) {
        var a = nb(i, -1), c = nb(i, 1), p = pts[i];
        var v1x = a[0] - p[0], v1y = a[1] - p[1], v2x = c[0] - p[0], v2y = c[1] - p[1];
        var ang = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / ((Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)) || 1))));
        var sharp = Math.PI - ang;
        var cross = (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]);
        var concave = ccw ? cross < 0 : cross > 0;
        var dn = Math.hypot(p[0] - near[0], p[1] - near[1]);
        var sc = sharp * (concave ? 1.5 : 0.8) - dn * 0.01;
        if (sc > bestS) { bestS = sc; bi = i; bestSharp = sharp; }
      }
      if (bestSharp < 0.35) { // belirgin köşe yok: hizala
        var bd2 = Infinity;
        for (i = 0; i < n; i++) { var d2 = Math.hypot(pts[i][0] - near[0], pts[i][1] - near[1]); if (d2 < bd2) { bd2 = d2; bi = i; } }
      }
    } else { // nearest, aligned (aligned için near = önceki katmanın dikişi)
      var bd = Infinity;
      for (i = 0; i < pts.length; i++) {
        var d = (pts[i][0] - near[0]) * (pts[i][0] - near[0]) + (pts[i][1] - near[1]) * (pts[i][1] - near[1]);
        if (d < bd) { bd = d; bi = i; }
      }
    }
    var out = pts.slice(bi).concat(pts.slice(0, bi));
    out.push(out[0]);
    return out;
  }

  function trimEnd(pts, len) {
    var res = pts.slice();
    var rem = len;
    while (res.length > 2 && rem > 0) {
      var a = res[res.length - 2], b = res[res.length - 1];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > rem) { res[res.length - 1] = [b[0] - dx / d * rem, b[1] - dy / d * rem]; break; }
      res.pop(); rem -= d;
    }
    return res;
  }

  // Katı yüzeylerde çizgiler arası mesafe: yuvarlak kenarlı ekstrüzyon kesiti (Slic3r/Orca modeli)
  function flowSpacing(w, h) { return w - h * (1 - Math.PI / 4); }

  function num(v, def) { return (v === null || v === undefined || v === '' || isNaN(v)) ? def : +v; }

  // ---------------------------------------------------------------- 1) katmanlar ve kesitler
  function makeLayers(S, maxZ) {
    var layers = [{ z: S.firstLayerHeight, h: S.firstLayerHeight }];
    var z = S.firstLayerHeight;
    while (z + S.layerHeight * 0.5 < maxZ) {
      z += S.layerHeight;
      layers.push({ z: Math.round(z * 1000) / 1000, h: S.layerHeight });
    }
    return layers;
  }

  function sliceParts(parts, layers, progress) {
    var nL = layers.length;
    parts.forEach(function (part, pi) {
      var mesh = part.mesh;
      var buckets = [];
      for (var b = 0; b < nL; b++) buckets.push([]);
      var v = mesh.v;
      for (var t = 0; t < mesh.nTri; t++) {
        var a0 = mesh.idx[t * 3], a1 = mesh.idx[t * 3 + 1], a2 = mesh.idx[t * 3 + 2];
        var z0 = v[a0 * 3 + 2], z1 = v[a1 * 3 + 2], z2 = v[a2 * 3 + 2];
        var zmin = Math.min(z0, z1, z2), zmax = Math.max(z0, z1, z2);
        for (var L = 0; L < nL; L++) {
          var sz = layers[L].z - layers[L].h / 2;
          if (sz < zmin) continue;
          if (sz > zmax) break;
          buckets[L].push(t);
        }
      }
      part.outline = [];
      for (var li = 0; li < nL; li++) {
        part.outline.push(sliceAt(mesh, buckets[li], layers[li].z - layers[li].h / 2 + 1e-5));
        if (li % 10 === 0) progress(0.25 * (pi + li / nL) / parts.length, 'Kesitler alınıyor (' + part.name + ') ' + (li + 1) + '/' + nL);
      }
    });
  }

  // ---------------------------------------------------------------- 2) bölge işleme (duvar, dolgu, üst/alt, köprü)
  function processPart(part, layers, S, below) {
    var nL = layers.length;
    var W = S.W;
    var wallsN = S.spiralVase ? 1 : Math.max(1, S.wallLoops);
    var R = part.regions = [];
    for (var li = 0; li < nL; li++) {
      var outline = part.outline[li];
      if (outline.length) {
        outline = xyCompensate(outline, S.xyContourCompensation, S.xyHoleCompensation);
        if (li === 0 && S.elephantFoot) outline = offset(outline, -S.elephantFoot, false);
      }
      var first = li === 0;
      var wo = first ? W.first : W.outer, wi = first ? W.first : W.inner;
      var walls = [];
      var hl = layers[li].h;
      var so = flowSpacing(wo, hl), si = flowSpacing(wi, hl);
      var cur = offset(outline, -wo / 2, false);
      for (var k = 0; k < wallsN && cur.length; k++) {
        walls.push(cur);
        if (k < wallsN - 1) cur = offset(cur, -(k === 0 ? (so + si) / 2 : si), false);
      }
      var lastW = walls.length > 1 ? wi : wo;
      var last = walls.length ? walls[walls.length - 1] : [];
      var fill = walls.length ? opening(offset(last, -lastW / 2 + S.infillOverlap / 100 * lastW, false), 0.1) : [];
      var ref = walls.length ? offset(last, -lastW / 2, false) : [];
      var gaps = [];
      if (S.gapFill && !S.spiralVase && outline.length) {
        var beads = [];
        walls.forEach(function (wp, k) { var ww = k === 0 ? wo : wi; beads = beads.concat(difference(offset(wp, ww / 2, false), offset(wp, -ww / 2, false))); });
        var uncovered = opening(difference(outline, union(beads.concat(fill))), S.gapFillMin);
        if (uncovered.length && Math.abs(areaOf(uncovered)) > S.gapFillMin * 0.5) gaps = gapPolylines(uncovered, S.gapFillMin, 2 * Math.max(wo, wi));
      }
      R.push({ outline: outline, walls: walls, fill: fill, ref: ref, gaps: gaps });
    }
    var topN = Math.max(S.topLayers, Math.ceil(S.topThickness / S.layerHeight - 1e-6));
    var botN = Math.max(S.bottomLayers, Math.ceil(S.bottomThickness / S.layerHeight - 1e-6));
    if (S.spiralVase) topN = 0;
    for (li = 0; li < nL; li++) {
      var r = R[li];
      if (!r.fill.length) { r.solid = []; r.sparse = []; r.top = []; r.bridge = []; continue; }
      var fill = r.fill, top = [], bottom = [];
      if (S.spiralVase && li >= botN) { r.solid = []; r.sparse = []; r.top = []; r.bridge = []; continue; }
      if (topN > 0) {
        if (li + topN >= nL) top = fill; else {
          var acc = fill;
          for (var k1 = 1; k1 <= topN && acc.length; k1++) acc = intersect(acc, R[li + k1].ref);
          top = difference(fill, acc);
        }
      }
      if (botN > 0) {
        if (li < botN) bottom = fill; else {
          var acc2 = fill;
          for (var k2 = 1; k2 <= botN && acc2.length; k2++) acc2 = intersect(acc2, R[li - k2].ref);
          bottom = difference(fill, acc2);
        }
      }
      var solid = union(top.concat(bottom));
      solid = intersect(offset(offset(solid, -W.solid * 0.3, false), W.solid * 0.6, false), fill);
      var density = S.spiralVase ? 0 : S.infillDensity;
      var sparse = density > 0 ? difference(fill, solid) : [];
      // küçük seyrek bölgeleri katı yap
      if (sparse.length && S.minSparseArea > 0) {
        var small = [];
        islandsOf(sparse).forEach(function (isl) { if (areaOf(isl) < S.minSparseArea) small = small.concat(isl); });
        if (small.length) { solid = union(solid.concat(intersect(small, fill))); sparse = difference(sparse, small); }
      }
      // köprüler: altında hiçbir şey olmayan katı alan
      var bridge = [];
      if (S.bridgeDetect && li > 0 && solid.length) {
        var unsupported = difference(fill, offset(below[li - 1], 0.05, false));
        unsupported = opening(unsupported, W.solid);
        if (unsupported.length) bridge = intersect(solid, offset(unsupported, W.solid, false));
      }
      r.solid = difference(solid, bridge);
      r.bridge = bridge;
      r.sparse = sparse;
      r.top = li === nL - 1 ? fill : opening(difference(fill, R[li + 1].fill), W.top);
    }
  }

  // ---------------------------------------------------------------- 3) destekler
  function computeSupports(U, layers, S, bed) {
    var nL = layers.length;
    var sup = [], iface = [];
    for (var i = 0; i < nL; i++) { sup.push([]); iface.push([]); }
    if (!S.supportEnable || nL < 3) return { sup: sup, iface: iface };
    var h = S.layerHeight;
    var ang = Math.max(1, Math.min(89, S.supportAngle)) * Math.PI / 180;
    var allow = h / Math.tan(ang);
    var gapTop = Math.max(0, Math.round(S.supportTopZ / h));
    var gapBot = Math.max(0, Math.round(S.supportBottomZ / h));
    var xy = S.supportXY;
    var ov = [[]];
    for (var li = 1; li < nL; li++) {
      var o = difference(U[li], offset(U[li - 1], allow, false));
      ov.push(opening(o, S.W.support * 1.5));
    }
    var P = [];
    for (li = nL - 1; li >= 0; li--) {
      var src = P.length ? P[0] : [];
      var add = (li + 1 + gapTop < nL) ? ov[li + 1 + gapTop] : [];
      var cur = add.length ? union(src.concat(add)) : src;
      cur = difference(cur, U[li]);           // modelin üstüne oturan destek burada biter
      P.unshift(cur);
    }
    // tabladan yükselebilen alan (yalnızca tabladan destek)
    var reach = S.supportBuildPlateOnly ? [rectPath(0, 0, bed.x, bed.y)] : null;
    for (li = 0; li < nL; li++) {
      if (reach) reach = difference(reach, offset(U[li], xy, false));
      var s = difference(P[li], offset(U[li], xy, false));
      for (var g = 1; g <= gapBot && li - g >= 0; g++) s = difference(s, U[li - g]);
      if (reach) s = intersect(s, reach);
      sup[li] = opening(s, S.W.support);
    }
    // arayüz: üstündeki N katman içinde biten destek
    var N = Math.max(0, S.supportInterfaceLayers);
    for (li = 0; li < nL; li++) {
      if (!sup[li].length || !N) continue;
      var cont = sup[li];
      for (var j = 1; j <= N && cont.length; j++) cont = li + j < nL ? intersect(cont, sup[li + j]) : [];
      iface[li] = difference(sup[li], cont);
      sup[li] = cont;
    }
    return { sup: sup, iface: iface };
  }

  // ---------------------------------------------------------------- 4) G-code
  function buildGcode(job, layers, parts, supports, progress) {
    var S = job.S, fils = job.fils;
    var out = [];
    var preview = [];
    var layerIndex = [];
    var pos = { x: 0, y: 0, z: 0 };
    var extruder = -1;
    var retracted = false;
    var curF = 0, curAccel = 0, fanState = {};
    var stats = { time: 0, e: [0, 0, 0, 0], toolChanges: 0, byType: {}, retracts: 0, combed: 0 };
    var lastPath = null, comb = null;
    var nL = layers.length;
    var bedCx = S.bedX / 2;
    var speedFactor = 1;
    var W = S.W;
    var lastSeam = [bedCx, S.bedY];

    function f3(n) { return (Math.round(n * 1000) / 1000).toString(); }
    function f5(n) { return (Math.round(n * 100000) / 100000).toString(); }
    function fil() { return fils[Math.max(0, extruder)] || fils[0]; }
    var calib = job.calib || null, calibRetract = null, calibSpeed = null, calibTemp = null, partFlow = 1;
    function retractLen() { return calibRetract !== null ? calibRetract : num(fil().retractLength, S.retractLength); }
    function retractSpd() { return num(fil().retractSpeed, S.retractSpeed); }
    function deretractSpd() { return num(fil().deretractSpeed, S.deretractSpeed); }
    function zHop() { return num(fil().zHop, S.zHop); }
    function fa() { var d = fil().filamentDiameter || 1.75; return Math.PI * d * d / 4; }

    function setAccel(a) {
      a = Math.min(a || S.accelDefault, S.machineMaxAccel);
      if (a === curAccel) return;
      out.push('SET_VELOCITY_LIMIT ACCEL=' + Math.round(a) + ' ACCEL_TO_DECEL=' + Math.round(a * S.accelToDecel / 100));
      curAccel = a;
    }
    function setFan(idx, pct) {
      var s = Math.round(255 * Math.max(0, Math.min(100, pct || 0)) / 100);
      if (fanState[idx] === s) return;
      out.push(idx === 0 ? 'M106 S' + s : 'M106 P' + idx + ' S' + s);
      fanState[idx] = s;
    }
    function moveTime(dist, speed, accel) {
      if (dist <= 0) return 0;
      var a = accel || 5000;
      if (dist >= speed * speed / a) return dist / speed + speed / a;
      return 2 * Math.sqrt(dist / a);
    }
    function retract() {
      var L = retractLen();
      if (retracted || L <= 0) return;
      // Silme: son çizginin üzerinde geri giderken filamentin bir kısmını geri çek (uçtaki damlayı siler)
      var wiped = 0;
      if (S.wipe && lastPath && lastPath.length > 1 && S.wipeDistance > 0) {
        var wl = S.wipeDistance, part = L * S.wipeRetractPart / 100, spdW = S.travelSpeed * 0.8, walked = 0;
        out.push('G1 E-' + f3(L - part) + ' F' + Math.round(retractSpd() * 60));
        stats.time += (L - part) / retractSpd();
        for (var wi = lastPath.length - 2; wi >= 0 && walked < wl; wi--) {
          var q = lastPath[wi], seg = Math.hypot(q[0] - pos.x, q[1] - pos.y);
          if (seg < 0.01) continue;
          var take = Math.min(seg, wl - walked), tx = pos.x + (q[0] - pos.x) * take / seg, ty = pos.y + (q[1] - pos.y) * take / seg;
          var e = part * take / wl;
          out.push('G1 X' + f3(tx) + ' Y' + f3(ty) + ' E-' + f5(e) + ' F' + Math.round(spdW * 60));
          stats.time += take / spdW; wiped += e; walked += take;
          preview.push(pos.x, pos.y, pos.z, tx, ty, pos.z, T.TRAVEL, extruder, 0, 0, spdW);
          pos.x = tx; pos.y = ty;
        }
        if (part - wiped > 0.0001) out.push('G1 E-' + f3(part - wiped) + ' F' + Math.round(retractSpd() * 60));
        curF = 0;
      } else {
        out.push('G1 E-' + f3(L) + ' F' + Math.round(retractSpd() * 60));
        stats.time += L / retractSpd();
      }
      lastPath = null;
      retracted = true;
      stats.retracts++;
      var zh = zHop();
      if (zh > 0) out.push('G1 Z' + f3(pos.z + zh) + ' F' + Math.round(S.zSpeed * 60));
    }
    function unretract() {
      if (!retracted) return;
      if (zHop() > 0) out.push('G1 Z' + f3(pos.z) + ' F' + Math.round(S.zSpeed * 60));
      out.push('G1 E' + f3(retractLen()) + ' F' + Math.round(deretractSpd() * 60));
      stats.time += retractLen() / deretractSpd();
      retracted = false;
    }
    function travel(x, y, sp) {
      var dx = x - pos.x, dy = y - pos.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.01) return;
      // Parçanın içinde kalan bir yol varsa onu izle; parçanın dışına çıkmıyorsa geri çekme gerekmez
      var route = null;
      if (comb && S.avoidCrossingWalls && d > 0.5) {
        route = combRoute(comb, pos.x, pos.y, x, y, 160);
        if (route) {
          var L = 0, px = pos.x, py = pos.y;
          route.forEach(function (q) { L += Math.hypot(q[0] - px, q[1] - py); px = q[0]; py = q[1]; });
          if (L > d * S.combMaxDetour + 5) route = null; // çok uzun dolambaç: düz git, geri çek
        }
      }
      if (route) stats.combed++;
      if (route ? (!S.retractOnlyCrossing && d > S.retractMinTravel) : d > S.retractMinTravel) retract();
      var spd = sp || S.travelSpeed;
      setAccel(S.accelTravel);
      (route || [[x, y]]).forEach(function (q) {
        var dd = Math.hypot(q[0] - pos.x, q[1] - pos.y);
        if (dd < 0.01) return;
        out.push('G0 X' + f3(q[0]) + ' Y' + f3(q[1]) + ' F' + Math.round(spd * 60));
        stats.time += moveTime(dd, spd, Math.min(S.accelTravel, S.machineMaxAccel)); // süre, sonraki yolun türüne yazılır
        preview.push(pos.x, pos.y, pos.z, q[0], q[1], pos.z, T.TRAVEL, extruder, 0, 0, spd); // kafa hareketi önizlemesi için hep kaydedilir
        pos.x = q[0]; pos.y = q[1];
      });
      curF = spd;
      lastPath = null;
    }
    // pts: [[x,y]] ya da spiral için [[x,y,z]]
    // Klipper köşe hızı (square corner velocity -> junction deviation)
    function junctionV(ux, uy, wx, wy, a) {
      var cosT = Math.max(-1, Math.min(1, -(ux * wx + uy * wy)));
      if (cosT < -0.999999) return Infinity;           // düz devam
      var sinH = Math.sqrt(0.5 * (1 - cosT));
      if (sinH > 0.999999) return 0;                    // tam geri dönüş
      var jd = S.squareCornerVelocity * S.squareCornerVelocity * (Math.SQRT2 - 1) / a;
      return Math.sqrt(a * jd * sinH / (1 - sinH));
    }
    // Bir yolun süresi: köşelerde köşe hızına kadar yavaşlama, kısa parçalarda tepe hıza ulaşamama
    function pathTime(seg, v, a) {
      var n = seg.length, t = 0;
      if (!n) return 0;
      var vj = [0];
      for (var i = 1; i < n; i++) vj.push(Math.min(v, junctionV(seg[i - 1].ux, seg[i - 1].uy, seg[i].ux, seg[i].uy, a)));
      vj.push(0);
      // ileri/geri geçiş: kavşak hızları ulaşılabilir olmalı
      for (i = 1; i <= n; i++) vj[i] = Math.min(vj[i], Math.sqrt(vj[i - 1] * vj[i - 1] + 2 * a * seg[i - 1].d));
      for (i = n - 1; i >= 0; i--) vj[i] = Math.min(vj[i], Math.sqrt(vj[i + 1] * vj[i + 1] + 2 * a * seg[i].d));
      for (i = 0; i < n; i++) {
        var d = seg[i].d, v0 = vj[i], v1 = vj[i + 1];
        var vc = Math.min(v, Math.sqrt((2 * a * d + v0 * v0 + v1 * v1) / 2));
        var da = (vc * vc - v0 * v0) / (2 * a), dd = (vc * vc - v1 * v1) / (2 * a);
        t += (vc - v0) / a + (vc - v1) / a + Math.max(0, d - da - dd) / vc;
      }
      return t;
    }
    function addTime(type, t) { stats.time += t; stats.byType[type] = (stats.byType[type] || 0) + t; }
    function extrudePath(pts, speed, width, height, type, accel, flow, noTravel) {
      if (pts.length < 2) return;
      var t0 = stats.time;
      if (!noTravel) travel(pts[0][0], pts[0][1]);
      unretract();
      if (stats.time > t0) { stats.byType[type] = (stats.byType[type] || 0) + (stats.time - t0); }
      setAccel(accel);
      var F = fil();
      var vmax = num(F.maxVolumetric, 20) / (width * height);
      var sp = Math.max(Math.min(speed * speedFactor, vmax, S.machineMaxSpeed), Math.min(S.minSpeedFloor, speed));
      var eArea = (width - height * (1 - Math.PI / 4)) * height * (flow || 1) * partFlow * num(F.flowRatio, 1) / fa();
      var first = true, seg = [];
      for (var i = 1; i < pts.length; i++) {
        var x = pts[i][0], y = pts[i][1], z = pts[i].length > 2 ? pts[i][2] : pos.z;
        var dx = x - pos.x, dy = y - pos.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.005) continue;
        seg.push({ d: d, ux: dx / d, uy: dy / d });
        var e = d * eArea * (pts[i].length > 3 ? pts[i][3] : 1);
        stats.e[Math.max(0, extruder)] += e;
        var line = 'G1 X' + f3(x) + ' Y' + f3(y) + (z !== pos.z ? ' Z' + f3(z) : '') + ' E' + f5(e);
        if (first || sp !== curF) { line += ' F' + Math.round(sp * 60); curF = sp; first = false; }
        out.push(line);
        preview.push(pos.x, pos.y, pos.z, x, y, z, type, extruder, width, height, sp);
        pos.x = x; pos.y = y; pos.z = z;
      }
      lastPath = pts;
      addTime(type, pathTime(seg, sp, Math.min(accel || S.accelDefault, S.machineMaxAccel)));
    }
    // Değişken genişlikli yol: pts = [[x, y, genişlik], ...]
    function extrudeVarPath(pts, speed, height, type, accel) {
      if (pts.length < 2) return;
      var t0 = stats.time;
      travel(pts[0][0], pts[0][1]);
      unretract();
      if (stats.time > t0) { stats.byType[type] = (stats.byType[type] || 0) + (stats.time - t0); }
      setAccel(accel);
      var F = fil(), wmax = 0;
      pts.forEach(function (p) { if (p[2] > wmax) wmax = p[2]; });
      var sp = Math.max(Math.min(speed * speedFactor, num(F.maxVolumetric, 20) / (wmax * height), S.machineMaxSpeed), Math.min(S.minSpeedFloor, speed));
      var k = height * partFlow * num(F.flowRatio, 1) / fa(), seg = [], first = true;
      for (var i = 1; i < pts.length; i++) {
        var x = pts[i][0], y = pts[i][1];
        var dx = x - pos.x, dy = y - pos.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.005) continue;
        var w = (pts[i - 1][2] + pts[i][2]) / 2;
        var e = d * (w - height * (1 - Math.PI / 4)) * k;
        if (e <= 0) { pos.x = x; pos.y = y; continue; }
        seg.push({ d: d, ux: dx / d, uy: dy / d });
        stats.e[Math.max(0, extruder)] += e;
        var line = 'G1 X' + f3(x) + ' Y' + f3(y) + ' E' + f5(e);
        if (first || sp !== curF) { line += ' F' + Math.round(sp * 60); curF = sp; first = false; }
        out.push(line);
        preview.push(pos.x, pos.y, pos.z, x, y, pos.z, type, extruder, w, height, sp);
        pos.x = x; pos.y = y;
      }
      lastPath = pts;
      addTime(type, pathTime(seg, sp, Math.min(accel || S.accelDefault, S.machineMaxAccel)));
    }
    function emitLinesJoined(lines, speed, width, height, type, accel, flow, monotonic) {
      if (!lines.length) return;
      if (monotonic) {
        orderMonotonic(lines).forEach(function (s) { extrudePath(s, speed, width, height, type, accel, flow); });
        return;
      }
      var ordered = orderLines(lines, [pos.x, pos.y]);
      var poly = null, polys = [];
      for (var i = 0; i < ordered.length; i++) {
        var s = ordered[i];
        if (poly) {
          var last = poly[poly.length - 1];
          var dx = s[0][0] - last[0], dy = s[0][1] - last[1];
          if (dx * dx + dy * dy <= (width * 1.9) * (width * 1.9)) { poly.push(s[0], s[1]); continue; }
          polys.push(poly);
        }
        poly = [s[0], s[1]];
      }
      if (poly) polys.push(poly);
      polys.forEach(function (p) { extrudePath(p, speed, width, height, type, accel, flow); });
    }
    // Seyrek dolgu çizgilerini tek hatta bağla: komşu çizgilerin uçları arasındaki bağlantı bölge içinde kalıyorsa
    function joinInRegion(lines, region, maxGap) {
      var ordered = orderLines(lines, [pos.x, pos.y]);
      region = offset(region, 0.05, false);
      var polys = [], poly = null;
      for (var i = 0; i < ordered.length; i++) {
        var s2 = ordered[i];
        if (poly) {
          var last = poly[poly.length - 1];
          var gap = Math.hypot(s2[0][0] - last[0], s2[0][1] - last[1]);
          if (gap <= maxGap && connectorInside(last, s2[0], region)) { poly.push(s2[0], s2[1]); continue; }
          polys.push(poly);
        }
        poly = [s2[0], s2[1]];
      }
      if (poly) polys.push(poly);
      return polys;
    }
    function connectorInside(a, b, region) {
      var seg = [[{ X: Math.round(a[0] * SCALE), Y: Math.round(a[1] * SCALE) }, { X: Math.round(b[0] * SCALE), Y: Math.round(b[1] * SCALE) }]];
      var c = clipOpen(seg, region);
      var L = 0; c.forEach(function (p) { for (var k = 1; k < p.length; k++) L += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); });
      return L >= Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.98;
    }
    function emitLinesSeparate(lines, speed, width, height, type, accel) {
      orderLines(lines, [pos.x, pos.y]).forEach(function (s) { extrudePath(s, speed, width, height, type, accel, 1); });
    }
    function emitLoops(paths, speed, width, height, type, accel, flow) {
      var done = new Uint8Array(paths.length);
      for (var n = 0; n < paths.length; n++) {
        var b = -1, bd = Infinity;
        for (var k = 0; k < paths.length; k++) {
          if (done[k]) continue;
          var p0 = paths[k][0];
          var d = (p0.X / SCALE - pos.x) * (p0.X / SCALE - pos.x) + (p0.Y / SCALE - pos.y) * (p0.Y / SCALE - pos.y);
          if (d < bd) { bd = d; b = k; }
        }
        done[b] = 1;
        extrudePath(loopFrom(paths[b], 'nearest', [pos.x, pos.y], bedCx), speed, width, height, type, accel, flow);
      }
    }
    function surfaceFill(region, pattern, width, angle, speed, height, type, accel, flow) {
      if (!region.length) return;
      var spc = flowSpacing(width, height);
      if (pattern === 'concentric') emitLoops(concentricFill(region, spc), speed, width, height, type, accel, flow);
      else if (pattern === 'monotonic') emitMonotonic(lineFill(region, spc, angle), region, spc, speed, width, height, type, accel, flow);
      else emitLinesJoined(lineFill(region, spc, angle), speed, width, height, type, accel, flow);
    }
    // Monoton zikzak: satırlar sırayla (yüzey hep aynı yönde dolar), her satırda yön değişir,
    // komşu satırlar bölge içinde kalan kısa bağlantıyla birleştirilir. Boşta geri dönüş yok.
    function emitMonotonic(lines, region, spc, speed, width, height, type, accel, flow) {
      if (!lines.length) return;
      var reg = offset(region, 0.05, false);
      var sorted = lines.slice().sort(function (a, b) { return a[4] - b[4] || a[5] - b[5]; });
      var rows = [];
      sorted.forEach(function (l) { var r = rows[rows.length - 1]; if (r && Math.abs(r.y - l[4]) < 2) r.items.push(l); else rows.push({ y: l[4], items: [l] }); });
      // başlangıç: tarama yönünün en yakın ucundan
      var first = rows[0].items[0], lastRow = rows[rows.length - 1].items[0];
      if (Math.hypot(lastRow[0] - pos.x, lastRow[1] - pos.y) < Math.hypot(first[0] - pos.x, first[1] - pos.y)) rows.reverse();
      var poly = null, dir = 1;
      var flush = function () { if (poly) extrudePath(poly, speed, width, height, type, accel, flow); poly = null; };
      rows.forEach(function (row) {
        var items = dir > 0 ? row.items : row.items.slice().reverse();
        items.forEach(function (l) {
          var a = [l[0], l[1]], b = [l[2], l[3]];
          if (dir < 0) { var t = a; a = b; b = t; }
          if (poly) {
            var last = poly[poly.length - 1];
            if (Math.hypot(a[0] - last[0], a[1] - last[1]) <= spc * 2.5 && connectorInside(last, a, reg)) { poly.push(a, b); return; }
            flush();
          }
          poly = [a, b];
        });
        dir = -dir;
      });
      flush();
    }
    // Üst yüzey yönü (otomatik): en az çizgi = en uzun çizgiler = en az çizgi ucu
    function longestAngle(region) {
      var best = 0, bestN = Infinity;
      for (var a = 0; a < 180; a += 15) { var n = lineFill(region, 2, a).length; if (n < bestN) { bestN = n; best = a; } }
      return best;
    }
    function fanPct(li) {
      var F = fil();
      if (li < F.fanOffLayers) return 0;
      if (li < F.fanFullLayer) return F.fanMin + (F.fanMax - F.fanMin) * (li - F.fanOffLayers + 1) / Math.max(1, F.fanFullLayer - F.fanOffLayers + 1);
      return F.fanMax;
    }
    function applyLayerFans(li) {
      setFan(0, fanPct(li));
      var F = fil();
      setFan(2, li < F.fanOffLayers ? 0 : num(F.auxFan, 0));
      setFan(3, num(F.chamberFan, 0));
    }
    function placeholders(str, extra) {
      var F0 = fils[job.firstSlot] || fils[0];
      var map = Object.assign({
        nozzle_first: F0.nozzleTempFirst, bed_first: F0.bedTempFirst, nozzle: F0.nozzleTemp, bed: F0.bedTemp,
        initial_tool: job.firstSlot, chamber: num(F0.chamberTemp, 0), first_layer_height: S.firstLayerHeight,
        bed_x: S.bedX, bed_y: S.bedY, layer_count: nL, filament_type: F0.filamentType || '',
      }, extra || {});
      return String(str || '').replace(/\{(\w+)\}/g, function (m, k) { return map[k] !== undefined ? map[k] : m; });
    }
    function pushBlock(str, extra) {
      if (!str) return;
      placeholders(str, extra).split('\n').forEach(function (l) { out.push(l); });
    }

    // ---- prime (temizleme) kulesi
    var tower = job.tower;
    function towerLayer(li, purgeVol) {
      if (!tower || li > tower.lastLayer) return;
      var h = layers[li].h, w = li === 0 ? W.first : W.support;
      var x0 = tower.x, y0 = tower.y, sz = tower.size;
      var sq = [rectPath(x0, y0, x0 + sz, y0 + sz)];
      out.push(';TYPE:Prime tower');
      var sp = li === 0 ? S.firstLayerSpeed : S.towerSpeed;
      extrudePath(loopFrom(offset(sq, -w / 2, false)[0], 'nearest', [pos.x, pos.y], bedCx), sp, w, h, T.TOWER, S.accelInfill, 1);
      var inner = offset(sq, -w, false);
      var full = sz * sz * h;
      var frac = li === 0 ? 1 : Math.min(1, Math.max(0.08, purgeVol / full));
      var spacing = w / frac;
      var ang = li % 2 ? 45 : -45;
      emitLinesJoined(lineFill(inner, spacing, ang), sp, w, h, T.TOWER, S.accelInfill, 1);
    }

    // ---- başlık
    var header = [];
    var body = out;

    out.push('; ---- start gcode ----');
    pushBlock(S.startGcode);
    out.push('G90', 'M83 ; relative extrusion', 'G92 E0');
    out.push('SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=' + S.squareCornerVelocity);
    out.push('SET_PRINT_STATS_INFO TOTAL_LAYER=' + nL);
    if (S.labelObjects) {
      parts.forEach(function (p, i) {
        var bb = p.bbox;
        out.push('EXCLUDE_OBJECT_DEFINE NAME=' + p.label + ' CENTER=' + f3((bb.minX + bb.maxX) / 2) + ',' + f3((bb.minY + bb.maxY) / 2) +
          ' POLYGON=[[' + f3(bb.minX) + ',' + f3(bb.minY) + '],[' + f3(bb.maxX) + ',' + f3(bb.minY) + '],[' + f3(bb.maxX) + ',' + f3(bb.maxY) + '],[' + f3(bb.minX) + ',' + f3(bb.maxY) + ']]');
        void i;
      });
    }
    extruder = job.firstSlot;
    if (job.multi) out.push('T' + extruder);
    pushBlock(fil().startGcode);
    if (num(fil().pressureAdvance, 0) > 0) out.push('SET_PRESSURE_ADVANCE ADVANCE=' + fil().pressureAdvance);
    setFan(0, 0);

    function toolChange(to, li) {
      if (to === extruder) return;
      var from = extruder;
      retract();
      pushBlock(fils[from].endGcode);
      var zl = pos.z + S.toolChangeLift;
      out.push('; ---- filament change T' + from + ' -> T' + to + ' ----');
      pushBlock(S.changeFilamentGcode, {
        current_tool: from, next_tool: to, next_temp: li === 0 ? fils[to].nozzleTempFirst : fils[to].nozzleTemp,
        z: f3(pos.z), z_lift: f3(zl), layer: li,
      });
      extruder = to;
      retracted = false; curF = 0;
      var t = li === 0 ? fils[to].nozzleTempFirst : fils[to].nozzleTemp;
      var tPrev = li === 0 ? fils[from].nozzleTempFirst : fils[from].nozzleTemp;
      if (t !== tPrev) out.push('M109 S' + t);
      pushBlock(fils[to].startGcode);
      if (num(fils[to].pressureAdvance, 0) > 0) out.push('SET_PRESSURE_ADVANCE ADVANCE=' + fils[to].pressureAdvance);
      out.push('G1 Z' + f3(pos.z) + ' F' + Math.round(S.zSpeed * 60));
      stats.toolChanges++;
      stats.time += S.toolChangeTime;
      applyLayerFans(li);
      towerLayer(li, S.purgeVolume * num(fils[to].purgeMultiplier, 1));
      return true;
    }

    // ---- katmanlar
    for (var li = 0; li < nL; li++) {
      var Ly = layers[li];
      var first = li === 0;
      var h = Ly.h;
      var spiral = S.spiralVase && li >= S.spiralStart;
      layerIndex.push(preview.length / PV);
      comb = null;
      if (S.avoidCrossingWalls && !spiral) {
        var reg = [], nodes = [];
        parts.forEach(function (p) {
          var r0 = p.regions[li]; if (!r0 || !r0.outline.length) return;
          var wo0 = li === 0 ? W.first : W.outer;
          reg = reg.concat(offset(r0.outline, -wo0 / 2 + 0.05, false));
          nodes = nodes.concat(offset(r0.outline, -wo0 * 1.1, false));
        });
        if (reg.length) comb = combContext(union(reg), union(nodes));
      }

      out.push(';LAYER_CHANGE', ';Z:' + f3(Ly.z), ';HEIGHT:' + f3(h), ';LAYER:' + li);
      out.push('SET_PRINT_STATS_INFO CURRENT_LAYER=' + (li + 1));
      pushBlock(S.layerChangeGcode, { layer: li, z: f3(Ly.z) });
      // Kalibrasyon testleri: katman yüksekliğine göre değişen değer
      if (calib) {
        var cz = Ly.z;
        if (calib.type === 'pa') {
          var pa = Math.max(0, calib.start + cz * calib.perMm);
          out.push('; CALIB pressure_advance=' + pa.toFixed(4) + ' z=' + f3(cz), 'SET_PRESSURE_ADVANCE ADVANCE=' + pa.toFixed(4));
        } else if (calib.type === 'temp') {
          var tt = calib.start - Math.floor((cz - 1e-6) / calib.blockH) * calib.step;
          if (tt !== calibTemp) { calibTemp = tt; out.push('; CALIB nozzle_temp=' + tt + ' z=' + f3(cz), 'M104 S' + tt); }
        } else if (calib.type === 'retract') {
          var rl = Math.round((calib.start + Math.min(9, Math.floor((cz - 1e-6) / calib.stepH)) * calib.step) * 100) / 100;
          if (rl !== calibRetract) { calibRetract = rl; out.push('; CALIB retract_length=' + rl + ' z=' + f3(cz)); }
        } else if (calib.type === 'vol') {
          var vol = calib.start + cz * calib.perMm;
          calibSpeed = vol / (S.W.outer * Ly.h);
          out.push('; CALIB volumetric=' + vol.toFixed(1) + ' mm3/s speed=' + Math.round(calibSpeed) + ' z=' + f3(cz));
        }
      }
      if (!spiral) {
        if (S.retractOnLayerChange) retract();
        out.push('G1 Z' + f3(Ly.z + (retracted && zHop() > 0 ? zHop() : 0)) + ' F' + Math.round(S.zSpeed * 60));
        pos.z = Ly.z;
      }
      if (li === 1) {
        var F1 = fil();
        if (F1.nozzleTemp !== F1.nozzleTempFirst) out.push('M104 S' + F1.nozzleTemp);
        var bedT = fils[job.firstSlot].bedTemp, bedT0 = fils[job.firstSlot].bedTempFirst;
        if (bedT !== bedT0) out.push('M140 S' + bedT);
      }
      applyLayerFans(li);

      // ilk katman hız rampası
      var ramp = (!first && S.slowLayers > 1 && li < S.slowLayers) ? li / S.slowLayers : 1;
      var spd = function (v) { return first ? Math.min(v, S.firstLayerSpeed) : (ramp < 1 ? S.firstLayerSpeed + (v - S.firstLayerSpeed) * ramp : v); };

      // bu katmanda iş olan yuvalar
      var bySlot = {};
      parts.forEach(function (p) { if (p.regions[li] && p.regions[li].outline.length) (bySlot[p.slot] = bySlot[p.slot] || []).push(p); });
      var supHere = supports.sup[li].length || supports.iface[li].length;
      if (supHere) bySlot[job.supportSlot] = bySlot[job.supportSlot] || [];
      var slots = Object.keys(bySlot).map(Number);
      slots.sort(function (a, b) { return (a === extruder ? -1 : 0) - (b === extruder ? -1 : 0) || a - b; });

      var snap = { pos: { x: pos.x, y: pos.y, z: pos.z }, e: stats.e.slice(), t: stats.time, pv: preview.length, out: out.length,
        retracted: retracted, curF: curF, curAccel: curAccel, fan: JSON.stringify(fanState), ext: extruder, tc: stats.toolChanges };
      speedFactor = 1;
      for (var attempt = 0; attempt < 2; attempt++) {
        emitLayer();
        var layerTime = stats.time - snap.t;
        var minT = num(fil().minLayerTime, 0);
        if (attempt === 0 && !first && !spiral && minT > 0 && layerTime < minT && layerTime > 0.1) {
          out.length = snap.out; preview.length = snap.pv;
          pos.x = snap.pos.x; pos.y = snap.pos.y; pos.z = snap.pos.z;
          stats.e = snap.e.slice(); stats.time = snap.t; retracted = snap.retracted; curF = snap.curF;
          curAccel = snap.curAccel; fanState = JSON.parse(snap.fan); extruder = snap.ext; stats.toolChanges = snap.tc;
          speedFactor = Math.max(layerTime / minT, (num(fil().minSpeed, 20)) / Math.max(1, S.outerWallSpeed));
          out.push('; min layer time: speed ' + Math.round(speedFactor * 100) + '%');
          continue;
        }
        break;
      }
      speedFactor = 1;

      function emitLayer() {
        var changed = false;
        var sk = job.skirt;
        if (sk && li < sk.layers && (sk.rings.length || (first && sk.brim.length))) {
          var wsk = first ? W.first : W.outer;
          if (sk.rings.length) { out.push(';TYPE:Skirt'); emitLoops(sk.rings, first ? S.firstLayerSpeed : S.outerWallSpeed, wsk, h, T.SKIRT, first ? S.accelFirst : S.accelOuterWall, 1); }
          if (first && sk.brim.length) { out.push(';TYPE:Brim'); emitLoops(sk.brim, S.firstLayerSpeed, wsk, h, T.SKIRT, S.accelFirst, 1); }
        }
        slots.forEach(function (slot) {
          if (slot !== extruder) { if (toolChange(slot, li)) changed = true; }
          bySlot[slot].forEach(function (p) { emitPart(p); });
          if (slot === job.supportSlot && supHere) emitSupport();
        });
        if (tower && li <= tower.lastLayer && !changed) towerLayer(li, 0);
      }

      function emitPart(p) {
        var r = p.regions[li];
        partFlow = p.flowMul || 1; // akış kalibrasyonu: parça başına akış çarpanı
        var N = Math.max(1, Math.min(4, S.infillEvery | 0));
        var combo = null;
        if (N > 1 && li > 0) {
          var gs = 1 + Math.floor((li - 1) / N) * N, ge = Math.min(nL - 1, gs + N - 1);
          p.combo = p.combo || {};
          if (!p.combo[gs]) {
            var c = p.regions[gs].sparse;
            for (var k = gs + 1; k <= ge && c.length; k++) c = intersect(c, p.regions[k].sparse);
            p.combo[gs] = { start: gs, end: ge, c: ge > gs ? opening(c, W.sparse * 2) : [] };
          }
          combo = p.combo[gs];
        }
        if (S.labelObjects) out.push('EXCLUDE_OBJECT_START NAME=' + p.label);
        islandsOf(r.outline).forEach(function (isl) {
          var big = offset(isl, 0.01, false);
          var wallSets = r.walls.map(function (wp) { return intersect(wp, big); });
          var wo = first ? W.first : W.outer, wi = first ? W.first : W.inner;
          if (spiral) { emitSpiral(wallSets[0] || [], wo); return; }
          if (S.wallOrder === 'outer-inner') { for (var a = 0; a < wallSets.length; a++) emitWall(wallSets[a], a === 0, wo, wi); }
          else { for (var b = wallSets.length - 1; b >= 0; b--) emitWall(wallSets[b], b === 0, wo, wi); }
          var solid = intersect(r.solid, big), top = intersect(r.top, big), sparse = intersect(r.sparse, big), bridge = intersect(r.bridge, big);
          var topOnly = intersect(top, solid);
          var solidNoTop = difference(solid, topOnly);
          var ang = (li % 2 === 0) ? S.solidAngle : S.solidAngle + 90;
          var ws = first ? W.first : W.solid;
          if (solidNoTop.length) {
            out.push(first ? ';TYPE:Bottom surface' : ';TYPE:Internal solid infill');
            surfaceFill(solidNoTop, first ? S.bottomPattern : 'lines', ws, ang, spd(first ? S.firstLayerInfillSpeed : S.solidInfillSpeed), h, T.SOLID, first ? S.accelFirst : S.accelInfill, 1);
          }
          if (bridge.length) {
            out.push(';TYPE:Bridge');
            var bf = fil();
            setFan(0, num(bf.bridgeFan, 100));
            emitLinesJoined(lineFill(bridge, W.solid, bridgeAngle(bridge)), S.bridgeSpeed, W.solid, h, T.BRIDGE, S.accelInfill, S.bridgeFlow);
            setFan(0, fanPct(li));
          }
          if (topOnly.length) {
            out.push(';TYPE:Top surface');
            var topAng = S.topAngleMode === 'auto' ? longestAngle(topOnly) : (S.topAngleMode === 'fixed' ? S.topAngle : ang);
            surfaceFill(topOnly, S.topPattern, W.top, topAng, spd(S.topSurfaceSpeed), h, T.TOP, S.accelTop, S.topFlow);
            if (S.ironing !== 'none') {
              var ir = offset(S.ironing === 'all' || li === nL - 1 ? topOnly : difference(topOnly, job.U[li + 1]), -S.ironingInset, false);
              if (ir.length) {
                out.push(';TYPE:Ironing');
                emitLinesJoined(lineFill(ir, S.ironingSpacing, topAng + 90), S.ironingSpeed, W.top, h, T.IRON, S.accelTop, S.ironingFlow / 100);
              }
            }
          }
          if (sparse.length || (N > 1 && combo && combo.c.length)) {
            if (N > 1 && !first && combo) {
              var own = difference(sparse, combo.c);
              if (own.length) { out.push(';TYPE:Sparse infill'); emitSparse(own); }
              if (li === combo.end) {
                var cc = intersect(combo.c, big);
                if (cc.length) { out.push(';TYPE:Sparse infill'); emitSparse(cc, combo.end - combo.start + 1); }
              }
            } else if (sparse.length) { out.push(';TYPE:Sparse infill'); emitSparse(sparse); }
          }
        });
        if (r.gaps && r.gaps.length) {
          out.push(';TYPE:Gap infill');
          orderPolylines(r.gaps, [pos.x, pos.y]).forEach(function (g) { extrudeVarPath(g, spd(first ? S.firstLayerSpeed : S.gapFillSpeed), h, T.GAP, first ? S.accelFirst : S.accelInnerWall); });
        }
        partFlow = 1;
        if (S.labelObjects) out.push('EXCLUDE_OBJECT_END NAME=' + p.label);
      }
      function bridgeAngle(region) {
        // köprüyü en kısa açıklık yönünde at: dört açıyı dene, en kısa ortalama çizgiyi seç
        var best = 0, bestLen = Infinity;
        [0, 45, 90, 135].forEach(function (a) {
          var ls = lineFill(region, W.solid * 3, a);
          if (!ls.length) return;
          var tot = 0; ls.forEach(function (l) { tot += Math.hypot(l[2] - l[0], l[3] - l[1]); });
          if (tot / ls.length < bestLen) { bestLen = tot / ls.length; best = a; }
        });
        return best;
      }
      // Çıkıntı sınıfı: 0 = alttaki katman tarafından taşınıyor, 1 = kısmen, 2 = havada
      var ovh = null;
      function overhangClass(x, y, w) {
        if (!ovh) {
          var below = li > 0 ? job.U[li - 1] : [];
          var mm = function (paths) { return paths.map(function (p) { return p.map(function (q) { return [q.X / SCALE, q.Y / SCALE]; }); }); };
          ovh = { s1: mm(offset(below, w * 0.25, false)), s2: mm(offset(below, w * 0.75, false)) };
        }
        if (pip(ovh.s1, x, y)) return 0;
        return pip(ovh.s2, x, y) ? 1 : 2;
      }
      // Eğimli (scarf) dikiş: halka alçaktan başlayıp yükselir, sonunda başlangıcın üzerinden azalan akışla geçilir
      function scarfLoop(pts, zTop, hh) {
        var Ls = S.scarfLength, f0 = S.scarfStartHeight / 100;
        var total = 0, i;
        for (i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (total < Ls * 2.2) return null;
        var z0 = zTop - hh * (1 - f0), outp = [[pts[0][0], pts[0][1], z0, 1]];
        var walk = function (from, to, fn) { // fn(s) -> [z, akış]
          var acc = 0, steps = Math.max(4, Math.round(Ls / 1.0)), res = [];
          for (var k = from; k < to; k++) {
            var a = pts[k], b2 = pts[k + 1], L = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
            var n = Math.max(1, Math.ceil(L / (Ls / steps)));
            for (var j = 1; j <= n; j++) { var t = j / n, sAt = acc + L * t, zf = fn(sAt); res.push([a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t, zf[0], zf[1]]); }
            acc += L;
            if (acc >= Ls) break;
          }
          return res;
        };
        // 1) yükselen başlangıç
        var up = walk(0, pts.length - 1, function (sv) { var r = Math.min(1, sv / Ls); return [z0 + (zTop - z0) * r, f0 + (1 - f0) * r]; });
        var lenUp = 0; up.forEach(function (q, k) { var pr = k ? up[k - 1] : outp[0]; lenUp += Math.hypot(q[0] - pr[0], q[1] - pr[1]); });
        outp = outp.concat(up);
        // 2) halkanın geri kalanı tam yükseklikte (yükselişin bittiği noktadan sonra)
        var acc2 = 0;
        for (i = 1; i < pts.length; i++) { acc2 += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc2 > lenUp + 1e-6) outp.push([pts[i][0], pts[i][1], zTop, 1]); }
        // 3) başlangıcın üzerinden tekrar: akış azalarak (kama doldurulur)
        outp = outp.concat(walk(0, pts.length - 1, function (sv) { var r = Math.min(1, sv / Ls); return [zTop, (1 - f0) * (1 - r)]; }));
        return outp;
      }
      function emitWall(paths, isOuter, wo, wi) {
        if (!paths.length) return;
        out.push(isOuter ? ';TYPE:Outer wall' : ';TYPE:Inner wall');
        var done = new Uint8Array(paths.length);
        var w = isOuter ? wo : wi, type = isOuter ? T.OUTER : T.INNER;
        var acc = first ? S.accelFirst : (isOuter ? S.accelOuterWall : S.accelInnerWall);
        var baseSp = spd(isOuter ? S.outerWallSpeed : S.innerWallSpeed);
        for (var n2 = 0; n2 < paths.length; n2++) {
          var b = -1, bd = Infinity;
          for (var k = 0; k < paths.length; k++) {
            if (done[k]) continue;
            var p0 = paths[k][0];
            var d = (p0.X / SCALE - pos.x) * (p0.X / SCALE - pos.x) + (p0.Y / SCALE - pos.y) * (p0.Y / SCALE - pos.y);
            if (d < bd) { bd = d; b = k; }
          }
          done[b] = 1;
          var seam = S.seam === 'aligned' ? 'nearest' : S.seam;
          var near = (S.seam === 'aligned' || S.seam === 'corner') ? lastSeam : [pos.x, pos.y];
          var pts = loopFrom(paths[b], seam, near, bedCx);
          if (isOuter) lastSeam = pts[0];
          // çıkıntı sınıfları
          var cls = null, anyOv = false;
          if (S.overhangSlowdown && li > 0 && !first) {
            cls = [];
            for (var i = 1; i < pts.length; i++) { var c = overhangClass((pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2, w); cls.push(c); if (c) anyOv = true; }
          }
          if (isOuter && !anyOv && S.scarfSeam === 'outer' && !first) {
            var sc = scarfLoop(pts, Ly.z, h);
            if (sc) {
              travel(sc[0][0], sc[0][1]);
              if (!retracted) out.push('G1 Z' + f3(sc[0][2]) + ' F' + Math.round(S.zSpeed * 60));
              pos.z = sc[0][2];
              extrudePath(sc, baseSp, w, h, type, acc, 1, true);
              pos.z = Ly.z;
              continue;
            }
          }
          if (isOuter && S.seamGap > 0) { pts = trimEnd(pts, S.seamGap / 100 * wo); if (cls) cls.length = pts.length - 1; }
          if (!anyOv) { extrudePath(pts, baseSp, w, h, type, acc, 1); continue; }
          // çıkıntılı bölümleri yavaşlat, havadakilerde fanı artır
          var spOf = function (c2) { return c2 === 2 ? Math.min(baseSp, S.overhangSpeed) : (c2 === 1 ? Math.min(baseSp, S.overhangSpeedMid) : baseSp); };
          var hasFull = cls.indexOf(2) >= 0;
          if (hasFull) setFan(0, Math.max(fanPct(li), num(fil().overhangFan, 100)));
          var run = [pts[0]], rc = cls[0];
          for (i = 1; i < pts.length; i++) {
            var ci = cls[i - 1];
            if (ci !== rc) { extrudePath(run, spOf(rc), w, h, type, acc, 1, run !== null && run[0] !== pts[0]); run = [pts[i - 1]]; rc = ci; }
            run.push(pts[i]);
          }
          extrudePath(run, spOf(rc), w, h, type, acc, 1, run[0] !== pts[0]);
          if (hasFull) setFan(0, fanPct(li));
        }
      }
      function emitSpiral(paths, w) {
        if (!paths.length) return;
        out.push(';TYPE:Outer wall');
        var path = paths.reduce(function (a, b) { return Math.abs(CL.Clipper.Area(b)) > Math.abs(CL.Clipper.Area(a)) ? b : a; });
        var pts = loopFrom(path, 'nearest', [pos.x, pos.y], bedCx);
        var tot = 0, i;
        for (i = 1; i < pts.length; i++) tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        var z0 = Ly.z - h, acc = 0;
        var zpts = [[pts[0][0], pts[0][1], z0]];
        for (i = 1; i < pts.length; i++) {
          acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          zpts.push([pts[i][0], pts[i][1], z0 + h * acc / tot]);
        }
        if (Math.hypot(pos.x - pts[0][0], pos.y - pts[0][1]) > 2) { travel(pts[0][0], pts[0][1]); }
        else { pos.x = pts[0][0]; pos.y = pts[0][1]; out.push('G1 X' + f3(pts[0][0]) + ' Y' + f3(pts[0][1])); }
        pos.z = z0;
        extrudePath(zpts, calibSpeed || S.outerWallSpeed, w, h, T.OUTER, S.accelOuterWall, 1, true);
      }
      function emitSparse(region, hMul) {
        var hh = h * (hMul || 1);
        var wsp = first ? W.first : W.sparse;
        var d = S.infillDensity / 100;
        var sp = spd(first ? S.firstLayerInfillSpeed : S.sparseInfillSpeed);
        var ac = first ? S.accelFirst : S.accelInfill;
        var A = S.infillAngle;
        var pat = S.infillPattern;
        var gi = Math.floor(li / (hMul || 1)); // katman grubu (birleştirilmiş dolguda yön değişimi için)
        var single = null; // tek yönlü desenler: açı
        if (pat === 'helix') single = A + gi * S.helixStep;
        else if (pat === 'golden') single = A + gi * 137.508;
        else if (pat === 'speed') single = speedAngles(region, wsp / d)[gi % 2];
        if (single !== null) {
          var ls = lineFill(region, wsp / d, single % 180);
          var polys = S.infillJoin ? joinInRegion(ls, region, (wsp / d) * 2.5) : orderLines(ls, [pos.x, pos.y]);
          polys.forEach(function (p) { extrudePath(p, sp, wsp, hh, T.SPARSE, ac, 1); });
          return;
        }
        if (pat === 'gyroid') {
          orderPolylines(gyroidFill(region, wsp / d, Ly.z), [pos.x, pos.y]).forEach(function (p) { extrudePath(p, sp, wsp, hh, T.SPARSE, ac, 1); });
        } else if (pat === 'concentric') {
          emitLoops(concentricFill(region, wsp / d), sp, wsp, hh, T.SPARSE, ac, 1);
        } else if (pat === 'grid') {
          var s2 = 2 * wsp / d;
          emitLinesSeparate(lineFill(region, s2, A).concat(lineFill(region, s2, A + 90)), sp, wsp, hh, T.SPARSE, ac);
        } else if (pat === 'triangles') {
          var s3 = 3 * wsp / d;
          emitLinesSeparate(lineFill(region, s3, A).concat(lineFill(region, s3, A + 60), lineFill(region, s3, A - 60)), sp, wsp, hh, T.SPARSE, ac);
        } else if (pat === 'cubic') {
          // 3 yönlü, z ile kayan çizgiler: kübik dolguya yakın bir yapı
          var s4 = 3 * wsp / d;
          var shift = (Ly.z % s4) / Math.SQRT2;
          var mk = function (a, sh) { return lineFill(region.map(function (pth) { return pth.map(function (q) { return { X: q.X + Math.round(sh * SCALE), Y: q.Y }; }); }), s4, a)
            .map(function (l) { return [l[0] - sh, l[1], l[2] - sh, l[3], l[4], l[5]]; }); };
          emitLinesSeparate(mk(A, shift).concat(mk(A + 60, -shift), mk(A - 60, shift * 0.5)), sp, wsp, hh, T.SPARSE, ac);
        } else { // rectilinear
          var rl = lineFill(region, wsp / d, gi % 2 ? A : A + 90);
          if (S.infillJoin) joinInRegion(rl, region, (wsp / d) * 2.5).forEach(function (p) { extrudePath(p, sp, wsp, hh, T.SPARSE, ac, 1); });
          else emitLinesJoined(rl, sp, wsp, hh, T.SPARSE, ac, 1);
        }
      }
      // Hızlı desen: aralarında en az 40° olan ve toplamda en az (yani en uzun) çizgiyi veren iki yön.
      // İnce duvarda iki yön de duvar boyunca uzanır; yuvarlak bölgede 90° farklı iki yön seçilir.
      function speedAngles(region, spacing) {
        var cnt = [];
        for (var a = 0; a < 180; a += 15) cnt.push([a, lineFill(region, spacing, a).length]);
        var best = [0, 90], bestC = Infinity, bestSep = 0;
        for (var i = 0; i < cnt.length; i++) for (var j = i + 1; j < cnt.length; j++) {
          var sep = Math.min(cnt[j][0] - cnt[i][0], 180 - (cnt[j][0] - cnt[i][0]));
          if (sep < 40) continue;
          var c = cnt[i][1] + cnt[j][1];
          if (c < bestC - 0.5 || (Math.abs(c - bestC) <= 0.5 && sep > bestSep)) { bestC = c; best = [cnt[i][0], cnt[j][0]]; bestSep = sep; }
        }
        return best;
      }
      function emitSupport() {
        var ws = first ? W.first : W.support;
        var base = supports.sup[li], ifc = supports.iface[li];
        if (base.length) {
          out.push(';TYPE:Support');
          if (S.supportPattern === 'grid') {
            emitLinesSeparate(lineFill(base, S.supportSpacing * 2, 0).concat(lineFill(base, S.supportSpacing * 2, 90)), spd(S.supportSpeed), ws, h, T.SUPPORT, S.accelInfill);
          } else {
            emitLinesJoined(lineFill(base, S.supportSpacing, first ? 90 : 0), spd(S.supportSpeed), ws, h, T.SUPPORT, first ? S.accelFirst : S.accelInfill, 1);
          }
        }
        if (ifc.length) {
          out.push(';TYPE:Support interface');
          emitLinesJoined(lineFill(ifc, S.supportInterfaceSpacing + ws, li % 2 ? 90 : 0), spd(S.supportInterfaceSpeed), ws, h, T.IFACE, S.accelInfill, 1);
        }
      }

      if (li % 3 === 0) progress(0.75 + 0.25 * li / nL, 'G-code ' + (li + 1) + '/' + nL);
    }

    // ---- bitiş
    retract();
    out.push('; ---- end gcode ----');
    pushBlock(fil().endGcode);
    out.push('M106 S0', 'M106 P2 S0');
    pushBlock(S.endGcode);

    // ---- istatistik
    // süre: model tahmini × düzeltme × öğrenilen oran + öğrenilen sabit süre (ısınma vb.)
    var timeS = Math.round(stats.time * S.timeFactor * num(S.timeScale, 1) + num(S.startupTime, 0));
    var perSlot = stats.e.map(function (e, i) {
      var F = fils[i] || fils[0];
      var d = F.filamentDiameter || 1.75;
      var g = e * Math.PI * d * d / 4 / 1000 * num(F.filamentDensity, 1.24);
      return { slot: i, mm: e, grams: g, cost: g / 1000 * num(F.cost, 0) };
    });
    var totMm = 0, totG = 0, totCost = 0;
    perSlot.forEach(function (p) { totMm += p.mm; totG += p.grams; totCost += p.cost; });

    // Başlık bloğu: Moonraker/Fluidd dilimleyiciyi "; generated by AD SÜRÜM on TARİH at SAAT" satırından tanır
    var now = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    header.push('; HEADER_BLOCK_START');
    header.push('; generated by K1MaxDilimleyici 2.8 on ' + now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate()) +
      ' at ' + p2(now.getHours()) + ':' + p2(now.getMinutes()) + ':' + p2(now.getSeconds()));
    header.push('; total layer number: ' + nL);
    header.push('; HEADER_BLOCK_END', '');
    // Önizleme resimleri (OrcaSlicer'ın K1 Max biçimi: 96x96 ve 300x300 PNG, satır başına 78 karakter)
    (job.thumbnails || []).forEach(function (th) {
      if (!th || !th.b64) return;
      var tb = th.b64;
      header.push('; THUMBNAIL_BLOCK_START', ';', '; thumbnail begin ' + th.w + 'x' + th.h + ' ' + tb.length);
      for (var ti = 0; ti < tb.length; ti += 78) header.push('; ' + tb.slice(ti, ti + 78));
      header.push('; thumbnail end', '; THUMBNAIL_BLOCK_END', '');
    });
    header.push('; printer_model = Creality K1 Max');
    header.push(';FLAVOR:Klipper');
    header.push(';TIME:' + timeS);
    header.push(';Filament used: ' + (totMm / 1000).toFixed(3) + 'm');
    header.push(';Layer height: ' + S.layerHeight);
    header.push(';LAYER_COUNT:' + nL);
    header.push('; estimated printing time (normal mode) = ' + fmtTime(timeS));
    header.push('; filament used [mm] = ' + perSlot.map(function (p) { return p.mm.toFixed(2); }).join(', '));
    header.push('; filament used [g] = ' + perSlot.map(function (p) { return p.grams.toFixed(2); }).join(', '));
    header.push('; total filament used [g] = ' + totG.toFixed(2));
    header.push('; total filament cost = ' + totCost.toFixed(2));
    header.push('; total filament change = ' + stats.toolChanges);
    header.push('; filament_type = ' + fils.map(function (f) { return f.filamentType || ''; }).join(';'));
    header.push('; filament_colour = ' + fils.map(function (f) { return f.color || ''; }).join(';'));
    header.push('; first_layer_height = ' + S.firstLayerHeight);
    header.push('; layer_height = ' + S.layerHeight);
    header.push('; nozzle_temperature = ' + fils.map(function (f) { return f.nozzleTemp; }).join(','));
    header.push('; bed_temperature = ' + fils[job.firstSlot].bedTemp);
    header.push('; sparse_infill_density = ' + S.infillDensity + '%');
    header.push('; max_z_height = ' + f3(layers[nL - 1].z));
    header.push('');

    return {
      gcode: header.join('\n') + body.join('\n') + '\n',
      preview: new Float32Array(preview),
      layerIndex: layerIndex,
      layerZ: layers.map(function (l) { return l.z; }),
      stats: { time: timeS, filamentMm: totMm, grams: totG, cost: totCost, layers: nL, toolChanges: stats.toolChanges, perSlot: perSlot, retracts: stats.retracts, combed: stats.combed,
        timeByType: Object.keys(stats.byType).reduce(function (o, k) { o[k] = Math.round(stats.byType[k] * S.timeFactor * 10) / 10; return o; }, {}) }
    };
  }

  // ---------------------------------------------------------------- ana giriş
  function slice(job, progress) {
    progress = progress || function () {};
    var S = Object.assign({}, job.S);
    var lw = S.lineWidth;
    S.W = {
      outer: num(S.outerWallLineWidth, lw), inner: num(S.innerWallLineWidth, lw), top: num(S.topLineWidth, lw),
      solid: num(S.solidLineWidth, lw), sparse: num(S.sparseLineWidth, lw), first: num(S.firstLayerLineWidth, lw),
      support: num(S.supportLineWidth, lw),
    };
    var fils = job.fils;
    var parts = job.parts.filter(function (p) { return p.positions && p.positions.length >= 9; }).map(function (p, i) {
      return { name: p.name || ('part' + i), label: 'part_' + i, slot: Math.max(0, Math.min(fils.length - 1, p.slot | 0)), mesh: indexMesh(p.positions), flowMul: +p.flowMul || 1 };
    });
    if (!parts.length) throw new Error('Dilimlenecek model yok.');
    if (S.spiralVase && parts.length > 1) throw new Error('Vazo modu yalnızca tek parçalı modellerde çalışır.');
    var maxZ = Math.max.apply(null, parts.map(function (p) { return p.mesh.maxZ; }));
    var layers = makeLayers(S, maxZ);
    S.spiralStart = Math.max(S.bottomLayers, 1);

    sliceParts(parts, layers, progress);

    // Boş üst katmanları at
    var nL = layers.length;
    while (nL > 0 && parts.every(function (p) { return !p.outline[nL - 1].length; })) nL--;
    if (!nL) throw new Error('Model kesilemedi (boş kesit). Modelin tablada olduğundan emin olun.');
    layers.length = nL;
    parts.forEach(function (p) { p.outline.length = nL; });

    // Çakışan parçalar: listede sonra gelen parça önceliklidir
    for (var pi = 0; pi < parts.length - 1; pi++) {
      for (var li = 0; li < nL; li++) {
        var later = [];
        for (var q = pi + 1; q < parts.length; q++) later = later.concat(parts[q].outline[li]);
        if (later.length && parts[pi].outline[li].length) parts[pi].outline[li] = difference(parts[pi].outline[li], later);
      }
    }
    var U = [];
    for (li = 0; li < nL; li++) {
      var all = [];
      parts.forEach(function (p) { all = all.concat(p.outline[li]); });
      U.push(union(all));
    }
    parts.forEach(function (p, i) {
      processPart(p, layers, S, U);
      var bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      p.outline.forEach(function (o) { if (o.length) { var b = bboxOf(o); bb.minX = Math.min(bb.minX, b.minX / SCALE); bb.minY = Math.min(bb.minY, b.minY / SCALE); bb.maxX = Math.max(bb.maxX, b.maxX / SCALE); bb.maxY = Math.max(bb.maxY, b.maxY / SCALE); } });
      p.bbox = bb;
      progress(0.25 + 0.35 * (i + 1) / parts.length, 'Duvarlar ve dolgu (' + p.name + ')');
    });

    progress(0.62, 'Destekler hesaplanıyor');
    var supports = computeSupports(U, layers, S, { x: S.bedX, y: S.bedY });

    // Kullanılan yuvalar ve prime kulesi
    var used = {};
    parts.forEach(function (p) { used[p.slot] = 1; });
    var usedSlots = Object.keys(used).map(Number).sort();
    var firstSlot = parts[0].slot;
    var supportSlot = S.supportSlot === 'auto' || S.supportSlot === undefined ? firstSlot : Math.min(fils.length - 1, +S.supportSlot);
    if (S.supportEnable) used[supportSlot] = 1;
    var multi = Object.keys(used).length > 1;
    // ilk katmanda ilk yuva, ilk katmanda bulunan parçanın yuvası olsun
    for (var fp = 0; fp < parts.length; fp++) if (parts[fp].outline[0].length) { firstSlot = parts[fp].slot; break; }

    var tower = null;
    if (multi && S.primeTower && !S.spiralVase) {
      // ekstrüder sırasını taklit ederek son renk değişiminin olduğu katmanı bul
      var lastChange = 0, curE = firstSlot;
      for (li = 0; li < nL; li++) {
        var here = Object.keys(used).map(Number).filter(function (sl) {
          return parts.some(function (p) { return p.slot === sl && p.outline[li].length; }) ||
            (sl === supportSlot && (supports.sup[li].length || supports.iface[li].length));
        });
        here.sort(function (a, b) { return (a === curE ? -1 : 0) - (b === curE ? -1 : 0) || a - b; });
        here.forEach(function (sl) { if (sl !== curE) { lastChange = li; curE = sl; } });
      }
      var size = Math.max(S.towerWidth, Math.sqrt(S.purgeVolume * 1.2 / S.layerHeight));
      var mb = bboxOf(U.reduce(function (a, b) { return a.concat(b); }, []));
      var tx = S.towerX, ty = S.towerY;
      if (S.towerAuto) {
        var gap = 8 + S.skirtDistance + S.brimWidth;
        tx = mb.maxX / SCALE + gap; ty = mb.maxY / SCALE - size;
        if (tx + size > S.bedX - 5) tx = mb.minX / SCALE - gap - size;
        if (tx < 5) { tx = Math.min(S.bedX - size - 5, Math.max(5, mb.minX / SCALE)); ty = mb.maxY / SCALE + gap; }
        if (ty + size > S.bedY - 5) ty = mb.minY / SCALE - gap - size;
        ty = Math.max(5, ty);
      }
      tower = { x: tx, y: ty, size: size, lastLayer: lastChange };
      // kule ilk katmanda tabla yapışması için etek alanına dahil
      U[0] = union(U[0].concat([rectPath(tx, ty, tx + size, ty + size)]));
    }

    var job2 = { calib: job.calib || null, S: S, fils: fils, multi: multi, firstSlot: firstSlot, supportSlot: supportSlot, tower: tower, thumbnails: job.thumbnails || (job.thumbnail ? [job.thumbnail] : null),
      U: U, skirt: skirtLoops(S, U[0], supports.sup[0].concat(supports.iface[0])) };
    var res = buildGcode(job2, layers, parts, supports, progress);
    res.stats.usedSlots = Object.keys(used).map(Number);
    return res;
  }

  // Etek ve kenarlık halkaları (ilk katman)
  function skirtLoops(S, U0, sup0) {
    var w = S.W.first;
    var brim = [], rings = [];
    var base = union(U0.concat(sup0));
    if (S.brimWidth > 0) {
      var nb = Math.max(1, Math.round(S.brimWidth / w));
      var outers = islandsOf(U0).map(function (isl) { return isl[0]; });
      for (var bi = nb; bi >= 1; bi--) offset(outers, S.brimGap + w * (bi - 0.5), false).forEach(function (p) { brim.push(p); });
      base = offset(base, S.brimGap + S.brimWidth, false);
    }
    if (S.skirtLoops > 0) {
      var sk = union(offset(base, S.skirtDistance, true));
      for (var si = S.skirtLoops - 1; si >= 0; si--) offset(sk, w * si, true).forEach(function (p) { rings.push(p); });
    }
    return { brim: brim, rings: rings, layers: Math.max(1, S.skirtHeight | 0) };
  }

  function fmtTime(s) {
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return (hh ? hh + 'h ' : '') + mm + 'm ' + ss + 's';
  }

  var api = { slice: slice, T: T, PV: PV, fmtTime: fmtTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.K1Slicer = api;
})(typeof self !== 'undefined' ? self : this);
