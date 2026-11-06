/*
 * K1 Max Dilimleyici - dilimleme motoru
 * Tarayıcıda Web Worker içinde (importScripts) ve Node'da (require) çalışır.
 * Koordinatlar mm cinsindendir; Clipper için 1000 ile ölçeklenir (1 birim = 1 µm).
 */
(function (root) {
  'use strict';

  var CL = root.ClipperLib || (typeof require !== 'undefined' ? require('clipper-lib') : null);
  var SCALE = 1000;
  var FIL_AREA_CACHE = {};

  // Önizleme renk tipleri
  var T = { OUTER: 0, INNER: 1, SOLID: 2, SPARSE: 3, SKIRT: 4, TRAVEL: 5, TOP: 6 };

  // ---------------------------------------------------------------- yardımcılar
  function filamentArea(d) {
    if (!FIL_AREA_CACHE[d]) FIL_AREA_CACHE[d] = Math.PI * (d / 2) * (d / 2);
    return FIL_AREA_CACHE[d];
  }

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
    var co = new CL.ClipperOffset(2, 0.25 * SCALE / 100);
    co.AddPaths(paths, round ? CL.JoinType.jtRound : CL.JoinType.jtMiter, CL.EndType.etClosedPolygon);
    var out = new CL.Paths();
    co.Execute(out, delta * SCALE);
    return out;
  }

  function area(paths) {
    var a = 0;
    for (var i = 0; i < paths.length; i++) a += CL.Clipper.Area(paths[i]);
    return a / (SCALE * SCALE);
  }

  // Ada (dış kontur + delikler) listesi: [[outer, hole, hole...], ...]
  function islandsOf(paths) {
    if (!paths.length) return [];
    var c = new CL.Clipper();
    c.AddPaths(paths, CL.PolyType.ptSubject, true);
    var tree = new CL.PolyTree();
    c.Execute(CL.ClipType.ctUnion, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    var res = [];
    (function walk(node) {
      var ch = node.Childs();
      for (var i = 0; i < ch.length; i++) {
        var n = ch[i];
        if (!n.IsHole()) {
          var isl = [n.Contour()];
          var holes = n.Childs();
          for (var j = 0; j < holes.length; j++) {
            isl.push(holes[j].Contour());
            walk(holes[j]);
          }
          res.push(isl);
        }
      }
    })(tree);
    return res;
  }

  // ---------------------------------------------------------------- mesh hazırlığı
  // positions: Float32Array (her üçgen için 9 değer), zaten tablaya yerleştirilmiş (mm)
  function indexMesh(positions) {
    var map = new Map();
    var verts = [];
    var nTri = positions.length / 9;
    var idx = new Uint32Array(nTri * 3);
    var q = 1e4; // 0.1 µm hassasiyet
    for (var i = 0; i < nTri * 3; i++) {
      var x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      var key = Math.round(x * q) + ',' + Math.round(y * q) + ',' + Math.round(z * q);
      var id = map.get(key);
      if (id === undefined) { id = verts.length / 3; verts.push(x, y, z); map.set(key, id); }
      idx[i] = id;
    }
    return { v: new Float64Array(verts), idx: idx, nTri: nTri };
  }

  // Bir z düzleminde kesit: kapalı konturlar (Clipper Paths) döndürür
  function sliceAt(mesh, tris, z) {
    var v = mesh.v, idx = mesh.idx;
    var segs = [];      // [keyA, keyB, ax, ay, bx, by]
    for (var t = 0; t < tris.length; t++) {
      var ti = tris[t] * 3;
      var i0 = idx[ti], i1 = idx[ti + 1], i2 = idx[ti + 2];
      var ids = [i0, i1, i2];
      var pts = [];
      for (var e = 0; e < 3; e++) {
        var a = ids[e], b = ids[(e + 1) % 3];
        var za = v[a * 3 + 2], zb = v[b * 3 + 2];
        var aAbove = za >= z, bAbove = zb >= z;
        if (aAbove !== bAbove) {
          var s = (z - za) / (zb - za);
          var x = v[a * 3] + (v[b * 3] - v[a * 3]) * s;
          var y = v[a * 3 + 1] + (v[b * 3 + 1] - v[a * 3 + 1]) * s;
          var key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
          pts.push(key, x, y);
        }
      }
      if (pts.length === 6) segs.push(pts);
    }
    // Kenar anahtarlarıyla zincirle
    var byKey = new Map();
    for (var k = 0; k < segs.length; k++) {
      var sg = segs[k];
      for (var end = 0; end < 2; end++) {
        var kk = sg[end * 3];
        var arr = byKey.get(kk);
        if (!arr) { arr = []; byKey.set(kk, arr); }
        arr.push(k);
      }
    }
    var used = new Uint8Array(segs.length);
    var loops = [];
    for (var st = 0; st < segs.length; st++) {
      if (used[st]) continue;
      used[st] = 1;
      var loop = [];
      var cur = segs[st];
      loop.push({ X: Math.round(cur[1] * SCALE), Y: Math.round(cur[2] * SCALE) });
      var nextKey = cur[3];
      loop.push({ X: Math.round(cur[4] * SCALE), Y: Math.round(cur[5] * SCALE) });
      var startKey = cur[0];
      var guard = 0;
      while (nextKey !== startKey && guard++ < 1e7) {
        var cand = byKey.get(nextKey);
        var found = -1;
        if (cand) for (var c = 0; c < cand.length; c++) if (!used[cand[c]]) { found = cand[c]; break; }
        if (found < 0) break; // açık zincir (bozuk mesh) - yine de kapat
        used[found] = 1;
        var sg2 = segs[found];
        if (sg2[0] === nextKey) { nextKey = sg2[3]; loop.push({ X: Math.round(sg2[4] * SCALE), Y: Math.round(sg2[5] * SCALE) }); }
        else { nextKey = sg2[0]; loop.push({ X: Math.round(sg2[1] * SCALE), Y: Math.round(sg2[2] * SCALE) }); }
      }
      if (loop.length >= 3) loops.push(loop);
    }
    if (!loops.length) return [];
    // EvenOdd birleşimi: yön hatalarına dayanıklı, dış/delik yönlerini düzeltir
    var cl = new CL.Clipper();
    cl.AddPaths(loops, CL.PolyType.ptSubject, true);
    var out = new CL.Paths();
    cl.Execute(CL.ClipType.ctUnion, out, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftEvenOdd);
    out = CL.Clipper.CleanPolygons(out, 0.01 * SCALE);
    // Çok küçük parçaları at
    var res = [];
    for (var i = 0; i < out.length; i++) if (Math.abs(CL.Clipper.Area(out[i])) > 0.01 * SCALE * SCALE) res.push(out[i]);
    return res;
  }

  // ---------------------------------------------------------------- dolgu
  function rotatePaths(paths, ang) {
    var c = Math.cos(ang), s = Math.sin(ang);
    return paths.map(function (p) {
      return p.map(function (pt) { return { X: Math.round(pt.X * c - pt.Y * s), Y: Math.round(pt.X * s + pt.Y * c) }; });
    });
  }

  // Bölgeyi açılı paralel çizgilerle doldurur. Döndürür: [[x1,y1,x2,y2], ...] (mm)
  function lineFill(region, spacing, angleDeg, phase) {
    if (!region.length || spacing <= 0) return [];
    var ang = angleDeg * Math.PI / 180;
    var rot = rotatePaths(region, -ang);
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rot.forEach(function (p) { p.forEach(function (pt) {
      if (pt.X < minX) minX = pt.X; if (pt.X > maxX) maxX = pt.X;
      if (pt.Y < minY) minY = pt.Y; if (pt.Y > maxY) maxY = pt.Y;
    }); });
    var sp = spacing * SCALE;
    var ph = (phase || 0) * SCALE;
    // Global ızgaraya hizala ki katmanlar arasında çizgiler üst üste gelsin
    var startY = Math.ceil((minY - ph) / sp) * sp + ph;
    var lines = [];
    for (var y = startY; y <= maxY; y += sp) {
      lines.push([{ X: minX - 10, Y: Math.round(y) }, { X: maxX + 10, Y: Math.round(y) }]);
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
      var a = p[0], b = p[p.length - 1];
      var ax = (a.X * cs - a.Y * sn) / SCALE, ay = (a.X * sn + a.Y * cs) / SCALE;
      var bx = (b.X * cs - b.Y * sn) / SCALE, by = (b.X * sn + b.Y * cs) / SCALE;
      var dx = bx - ax, dy = by - ay;
      if (dx * dx + dy * dy < 0.04) continue; // 0.2 mm'den kısa
      res.push([ax, ay, bx, by, a.Y]);
    }
    return res;
  }

  // Gyroid: sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0 yüzeyinin z kesiti
  function gyroidFill(region, spacing, z) {
    if (!region.length) return [];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    region.forEach(function (p) { p.forEach(function (pt) {
      if (pt.X < minX) minX = pt.X; if (pt.X > maxX) maxX = pt.X;
      if (pt.Y < minY) minY = pt.Y; if (pt.Y > maxY) maxY = pt.Y;
    }); });
    minX /= SCALE; maxX /= SCALE; minY /= SCALE; maxY /= SCALE;
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
          // sin(x)cos(y) + cos(z)sin(y) = -sin(z)cos(x)  =>  R sin(y+phi) = rhs
          var R = Math.sqrt(sx * sx + cz * cz);
          var rhs = -sz * Math.cos(xx);
          if (R < 1e-9 || Math.abs(rhs) > R) { if (cur && cur.length > 1) curves.push(cur); cur = null; prevY = null; continue; }
          var phi = Math.atan2(cz, sx);
          var as = Math.asin(rhs / R);
          var yy = (branch === 0 ? as : Math.PI - as) - phi + 2 * Math.PI * n;
          var y = yy / k;
          if (prevY !== null && Math.abs(y - prevY) > period * 0.4) { if (cur && cur.length > 1) curves.push(cur); cur = null; }
          if (!cur) cur = [];
          cur.push({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) });
          prevY = y;
        }
        if (cur && cur.length > 1) curves.push(cur);
      }
    }
    if (!curves.length) return [];
    var c = new CL.Clipper();
    c.AddPaths(curves, CL.PolyType.ptSubject, false);
    c.AddPaths(region, CL.PolyType.ptClip, true);
    var tree = new CL.PolyTree();
    c.Execute(CL.ClipType.ctIntersection, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    var open = CL.Clipper.OpenPathsFromPolyTree(tree);
    return open.filter(function (p) { return p.length >= 2; }).map(function (p) {
      return p.map(function (pt) { return [pt.X / SCALE, pt.Y / SCALE]; });
    });
  }

  // Çizgileri zikzak + en yakın komşu sırasına göre polyline listesine çevirir
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

  // Kapalı konturu mm noktalara çevirip dikiş noktasına göre döndürür
  function loopFrom(path, seam, near) {
    var pts = path.map(function (p) { return [p.X / SCALE, p.Y / SCALE]; });
    var bi = 0;
    if (seam === 'rear') {
      var by = -Infinity;
      for (var i = 0; i < pts.length; i++) {
        var score = pts[i][1] - Math.abs(pts[i][0] - 150) * 0.05;
        if (score > by) { by = score; bi = i; }
      }
    } else if (seam === 'random') {
      bi = Math.floor(Math.random() * pts.length);
    } else { // nearest
      var bd = Infinity;
      for (var j = 0; j < pts.length; j++) {
        var d = (pts[j][0] - near[0]) * (pts[j][0] - near[0]) + (pts[j][1] - near[1]) * (pts[j][1] - near[1]);
        if (d < bd) { bd = d; bi = j; }
      }
    }
    var out = pts.slice(bi).concat(pts.slice(0, bi));
    out.push(out[0]);
    return out;
  }

  // ---------------------------------------------------------------- ana dilimleme
  function slice(positions, S, progress) {
    progress = progress || function () {};
    var mesh = indexMesh(positions);
    var v = mesh.v;
    var maxZ = 0;
    for (var i = 2; i < v.length; i += 3) if (v[i] > maxZ) maxZ = v[i];

    // Katman z değerleri
    var layers = [];
    var z = S.firstLayerHeight;
    layers.push({ z: z, h: S.firstLayerHeight });
    while (z + S.layerHeight * 0.5 < maxZ) {
      z += S.layerHeight;
      layers.push({ z: Math.round(z * 1000) / 1000, h: S.layerHeight });
    }

    // Üçgenleri katman aralığına göre kovala
    var nL = layers.length;
    var buckets = [];
    for (var b = 0; b < nL; b++) buckets.push([]);
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

    // 1) Kesitler
    for (var li = 0; li < nL; li++) {
      var sliceZ = layers[li].z - layers[li].h / 2 + 1e-5;
      layers[li].outline = sliceAt(mesh, buckets[li], sliceZ);
      if (li % 5 === 0) progress(0.3 * li / nL, 'Kesitler alınıyor ' + (li + 1) + '/' + nL);
    }
    // Baştaki/sondaki boş katmanları at
    while (layers.length && !layers[layers.length - 1].outline.length) layers.pop();
    nL = layers.length;
    if (!nL) throw new Error('Model kesilemedi (boş kesit). Modelin tablada olduğundan emin olun.');

    var w = S.lineWidth;
    var overlap = S.infillOverlap / 100;

    // 2) Duvarlar ve dolgu bölgeleri
    for (li = 0; li < nL; li++) {
      var Ly = layers[li];
      var lw = li === 0 ? S.firstLayerLineWidth : w;
      var outline = Ly.outline;
      if (S.xyCompensation) outline = offset(outline, S.xyCompensation, false);
      if (li === 0 && S.elephantFoot) outline = offset(outline, -S.elephantFoot, false);
      Ly.walls = [];
      var cur = offset(outline, -lw / 2, false);
      for (var wi = 0; wi < S.walls && cur.length; wi++) {
        Ly.walls.push(cur);
        if (wi < S.walls - 1) cur = offset(cur, -lw, false);
      }
      var last = Ly.walls.length ? Ly.walls[Ly.walls.length - 1] : offset(outline, lw / 2, false);
      Ly.fillArea = offset(last, -lw / 2 + overlap * lw, false);
      Ly.fillArea = offset(offset(Ly.fillArea, -0.05, false), 0.05, false);
      Ly.solidRef = offset(last, -lw / 2, false); // üst/alt hesap referansı
      if (li % 5 === 0) progress(0.3 + 0.25 * li / nL, 'Duvarlar ' + (li + 1) + '/' + nL);
    }

    // 3) Üst/alt katı bölgeler
    for (li = 0; li < nL; li++) {
      var Lc = layers[li];
      var fill = Lc.fillArea;
      if (!fill.length) { Lc.solid = []; Lc.sparse = []; Lc.top = []; continue; }
      var top = [], bottom = [];
      // Üst yüzey: üstteki katmanlardan herhangi birinde bulunmayan alan
      if (li + S.topLayers >= nL) top = fill; else {
        var acc = fill;
        for (var k = 1; k <= S.topLayers && acc.length; k++) acc = intersect(acc, layers[li + k].solidRef);
        top = difference(fill, acc);
      }
      if (li < S.bottomLayers) bottom = fill; else {
        var acc2 = fill;
        for (var k2 = 1; k2 <= S.bottomLayers && acc2.length; k2++) acc2 = intersect(acc2, layers[li - k2].solidRef);
        bottom = difference(fill, acc2);
      }
      var solid = union(top.concat(bottom));
      // küçük katı adacıkları biraz genişlet ki dolguyla iyi bağlansın
      solid = intersect(offset(offset(solid, -w * 0.3, false), w * 0.6, false), fill);
      Lc.solid = solid;
      // en üst görünen yüzey (bir sonraki katmanda yok)
      Lc.top = li === nL - 1 ? fill : difference(fill, layers[li + 1].solidRef);
      Lc.sparse = S.infillDensity > 0 ? difference(fill, solid) : [];
      if (li % 5 === 0) progress(0.55 + 0.2 * li / nL, 'Üst/alt yüzeyler ' + (li + 1) + '/' + nL);
    }

    // 4) G-code üretimi
    return buildGcode(layers, S, progress);
  }

  // ---------------------------------------------------------------- G-code
  function buildGcode(layers, S, progress) {
    var out = [];
    var preview = [];      // [x1,y1,z1,x2,y2,z2,type, ...]
    var layerIndex = [];   // her katmanın preview başlangıç (segment sayısı)
    var pos = { x: 0, y: 0, z: 0 };
    var totalE = 0, totalTime = 0;
    var retracted = false;
    var fa = filamentArea(S.filamentDiameter);
    var curF = 0, curAccel = 0, curFan = -1;
    var nL = layers.length;

    function f3(n) { return (Math.round(n * 1000) / 1000).toString(); }
    function f5(n) { return (Math.round(n * 100000) / 100000).toString(); }

    function setAccel(a) {
      if (!a || a === curAccel) return;
      out.push('SET_VELOCITY_LIMIT ACCEL=' + Math.round(a) + ' ACCEL_TO_DECEL=' + Math.round(a / 2));
      curAccel = a;
    }
    function setFan(pct) {
      var s = Math.round(255 * Math.max(0, Math.min(100, pct)) / 100);
      if (s === curFan) return;
      out.push('M106 S' + s);
      curFan = s;
    }
    function moveTime(dist, speed, accel) {
      // trapez profilli kaba süre tahmini
      if (dist <= 0) return 0;
      var a = accel || 5000;
      var dAcc = speed * speed / a;
      if (dist >= dAcc) return dist / speed + speed / a;
      return 2 * Math.sqrt(dist / a);
    }
    function retract() {
      if (retracted || S.retractLength <= 0) return;
      out.push('G1 E-' + f3(S.retractLength) + ' F' + Math.round(S.retractSpeed * 60));
      totalTime += S.retractLength / S.retractSpeed;
      retracted = true;
      if (S.zHop > 0) { out.push('G1 Z' + f3(pos.z + S.zHop) + ' F' + Math.round(S.zHopSpeed * 60)); }
    }
    function unretract() {
      if (!retracted) return;
      if (S.zHop > 0) out.push('G1 Z' + f3(pos.z) + ' F' + Math.round(S.zHopSpeed * 60));
      out.push('G1 E' + f3(S.retractLength + S.retractExtra) + ' F' + Math.round(S.deretractSpeed * 60));
      totalTime += S.retractLength / S.deretractSpeed;
      retracted = false;
    }
    function travel(x, y, forceRetract) {
      var dx = x - pos.x, dy = y - pos.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.01) return;
      if (d > S.retractMinTravel || forceRetract) retract();
      setAccel(S.accelTravel);
      out.push('G0 X' + f3(x) + ' Y' + f3(y) + ' F' + Math.round(S.travelSpeed * 60));
      curF = S.travelSpeed;
      totalTime += moveTime(d, S.travelSpeed, S.accelTravel);
      if (S.previewTravel) preview.push(pos.x, pos.y, pos.z, x, y, pos.z, T.TRAVEL);
      pos.x = x; pos.y = y;
    }
    function extrudePath(pts, speed, width, height, type, accel, flow) {
      if (pts.length < 2) return;
      travel(pts[0][0], pts[0][1]);
      unretract();
      setAccel(accel);
      // hacimsel akış sınırı
      var vmax = S.maxVolumetric / (width * height);
      var sp = Math.min(speed, vmax) * Ly_speedFactor;
      sp = Math.max(sp, S.minSpeed);
      var first = true;
      var ePerMm = width * height * (flow || 1) * S.flowRatio / fa;
      // Ekstrüzyon için yükseklik düzeltmesi (yuvarlak kenar): Slic3r modeli
      ePerMm = (width - height * (1 - Math.PI / 4)) * height * (flow || 1) * S.flowRatio / fa;
      for (var i = 1; i < pts.length; i++) {
        var x = pts[i][0], y = pts[i][1];
        var dx = x - pos.x, dy = y - pos.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.005) continue;
        var e = d * ePerMm;
        totalE += e;
        var line = 'G1 X' + f3(x) + ' Y' + f3(y) + ' E' + f5(e);
        if (first || sp !== curF) { line += ' F' + Math.round(sp * 60); curF = sp; first = false; }
        out.push(line);
        totalTime += moveTime(d, sp, accel);
        preview.push(pos.x, pos.y, pos.z, x, y, pos.z, type);
        pos.x = x; pos.y = y;
      }
    }

    // ---- başlangıç
    var nz0 = S.nozzleTempFirst, bd0 = S.bedTempFirst;
    var header = [];
    var body = out;
    out.push('; ---- start gcode ----');
    S.startGcode.split('\n').forEach(function (l) {
      out.push(l.replace(/\{nozzle_first\}/g, nz0).replace(/\{bed_first\}/g, bd0)
        .replace(/\{nozzle\}/g, S.nozzleTemp).replace(/\{bed\}/g, S.bedTemp)
        .replace(/\{chamber\}/g, S.chamberTemp || 0));
    });
    out.push('G90');
    out.push('M83 ; relative extrusion');
    if (S.pressureAdvance > 0) out.push('SET_PRESSURE_ADVANCE ADVANCE=' + S.pressureAdvance);
    out.push('SET_PRINT_STATS_INFO TOTAL_LAYER=' + nL);
    out.push('G92 E0');
    setFan(0);

    var Ly_speedFactor = 1;
    var seamNear = [150, 300];

    for (var li = 0; li < nL; li++) {
      var Ly = layers[li];
      var first = li === 0;
      var h = Ly.h;
      var lw = first ? S.firstLayerLineWidth : S.lineWidth;
      layerIndex.push(preview.length / 7);
      var outStart = out.length;
      var timeStart = totalTime;

      out.push(';LAYER_CHANGE');
      out.push(';Z:' + f3(Ly.z));
      out.push(';HEIGHT:' + f3(h));
      out.push(';LAYER:' + li);
      out.push('SET_PRINT_STATS_INFO CURRENT_LAYER=' + (li + 1));
      retract();
      out.push('G1 Z' + f3(Ly.z + (retracted && S.zHop > 0 ? S.zHop : 0)) + ' F' + Math.round(S.zSpeed * 60));
      pos.z = Ly.z;

      if (li === 1) {
        if (S.nozzleTemp !== S.nozzleTempFirst) out.push('M104 S' + S.nozzleTemp);
        if (S.bedTemp !== S.bedTempFirst) out.push('M140 S' + S.bedTemp);
      }
      // fan
      if (li < S.fanOffLayers) setFan(0);
      else if (li < S.fanFullLayer) setFan(S.fanMin + (S.fanMax - S.fanMin) * (li - S.fanOffLayers + 1) / Math.max(1, S.fanFullLayer - S.fanOffLayers + 1));
      else setFan(S.fanMax);

      var markFanIdx = out.length - 1;

      // skirt / brim (ilk katman)
      if (first) {
        var base = union(layers[0].outline);
        if (S.brimWidth > 0) {
          var nb = Math.round(S.brimWidth / lw);
          var brimLoops = [];
          for (var bi = nb; bi >= 1; bi--) {
            offset(base, lw * (bi - 0.5), false).forEach(function (p) { brimLoops.push(p); });
          }
          out.push(';TYPE:Brim');
          brimLoops.forEach(function (p) {
            extrudePath(loopFrom(p, 'nearest', [pos.x, pos.y]), S.firstLayerSpeed, lw, h, T.SKIRT, S.accelFirst);
          });
          base = offset(base, S.brimWidth, false);
        }
        if (S.skirtLoops > 0) {
          out.push(';TYPE:Skirt');
          var sk = offset(base, S.skirtDistance, true);
          for (var si = S.skirtLoops - 1; si >= 0; si--) {
            var ring = offset(union(sk), lw * si, true);
            ring.forEach(function (p) {
              extrudePath(loopFrom(p, 'nearest', [pos.x, pos.y]), S.firstLayerSpeed, lw, h, T.SKIRT, S.accelFirst);
            });
          }
        }
      }

      // Adalar: her adayı sırayla bitir (gezinti azalır)
      var islands = islandsOf(Ly.outline);
      // en yakın ada sırası
      var order = [];
      var usedI = new Uint8Array(islands.length);
      var cx = pos.x, cy = pos.y;
      for (var n = 0; n < islands.length; n++) {
        var bestI = -1, bestD = Infinity;
        for (var ii = 0; ii < islands.length; ii++) {
          if (usedI[ii]) continue;
          var pt = islands[ii][0][0];
          var dd = (pt.X / SCALE - cx) * (pt.X / SCALE - cx) + (pt.Y / SCALE - cy) * (pt.Y / SCALE - cy);
          if (dd < bestD) { bestD = dd; bestI = ii; }
        }
        usedI[bestI] = 1; order.push(bestI);
        cx = islands[bestI][0][0].X / SCALE; cy = islands[bestI][0][0].Y / SCALE;
      }

      var spOuter = first ? S.firstLayerSpeed : S.outerWallSpeed;
      var spInner = first ? S.firstLayerSpeed : S.innerWallSpeed;
      var spSolid = first ? S.firstLayerSpeed : S.solidInfillSpeed;
      var spSparse = first ? S.firstLayerSpeed : S.sparseInfillSpeed;
      var spTop = S.topSurfaceSpeed;
      var acOuter = first ? S.accelFirst : S.accelOuterWall;
      var acInner = first ? S.accelFirst : S.accelInnerWall;
      var acInfill = first ? S.accelFirst : S.accelInfill;
      var acTop = S.accelTop;

      // Önce katmanı çiz, sonra minimum katman süresine göre yavaşlatma gerekiyorsa yeniden çiz
      var attempt = 0;
      Ly_speedFactor = 1;
      var snapshot = { pos: { x: pos.x, y: pos.y, z: pos.z }, e: totalE, t: totalTime, pv: preview.length, out: out.length, retracted: retracted, curF: curF, curAccel: curAccel, curFan: curFan };
      while (true) {
        emitIslands();
        var layerTime = totalTime - snapshot.t;
        if (attempt === 0 && !first && S.minLayerTime > 0 && layerTime < S.minLayerTime && layerTime > 0.1) {
          var factor = Math.max(layerTime / S.minLayerTime, S.minSpeedFactor);
          // geri al ve yavaş tekrar et
          out.length = snapshot.out; preview.length = snapshot.pv;
          pos.x = snapshot.pos.x; pos.y = snapshot.pos.y; pos.z = snapshot.pos.z;
          totalE = snapshot.e; totalTime = snapshot.t; retracted = snapshot.retracted; curF = snapshot.curF;
          curAccel = snapshot.curAccel; curFan = snapshot.curFan;
          Ly_speedFactor = factor;
          out.push('; min layer time: speed %' + Math.round(factor * 100));
          attempt++;
          continue;
        }
        break;
      }
      Ly_speedFactor = 1;

      function emitIslands() {
        for (var oi = 0; oi < order.length; oi++) {
          var isl = islands[order[oi]];
          var islArea = isl; // Paths
          var islBig = offset(islArea, 0.01, false);
          // duvarlar: içten dışa (dış duvar en son => daha iyi yüzey)
          var wallSets = Ly.walls.map(function (wp) { return intersect(wp, islBig); });
          if (S.wallOrder === 'inner-outer') {
            for (var wi = wallSets.length - 1; wi >= 0; wi--) emitWall(wallSets[wi], wi === 0);
          } else {
            for (var wj = 0; wj < wallSets.length; wj++) emitWall(wallSets[wj], wj === 0);
          }
          // dolgu
          var solid = intersect(Ly.solid, islBig);
          var top = intersect(Ly.top, islBig);
          var sparse = intersect(Ly.sparse, islBig);
          var topOnly = intersect(top, solid);
          var solidNoTop = difference(solid, topOnly);
          var ang = (li % 2 === 0) ? S.solidAngle : S.solidAngle + 90;
          if (solidNoTop.length) {
            out.push(';TYPE:Solid infill');
            emitLines(lineFill(solidNoTop, lw, ang, 0), spSolid, lw, h, T.SOLID, acInfill, 1);
          }
          if (topOnly.length) {
            out.push(';TYPE:Top surface');
            emitLines(lineFill(topOnly, lw, ang, 0), spTop, lw, h, T.TOP, acTop, S.topFlow);
          }
          if (sparse.length && S.infillDensity > 0) {
            out.push(';TYPE:Sparse infill');
            emitSparse(sparse);
          }
        }
      }
      function emitWall(paths, isOuter) {
        if (!paths.length) return;
        out.push(isOuter ? ';TYPE:Outer wall' : ';TYPE:Inner wall');
        var idxs = paths.slice();
        var done = new Uint8Array(idxs.length);
        for (var n2 = 0; n2 < idxs.length; n2++) {
          var b = -1, bd = Infinity;
          for (var k = 0; k < idxs.length; k++) {
            if (done[k]) continue;
            var p0 = idxs[k][0];
            var d = (p0.X / SCALE - pos.x) * (p0.X / SCALE - pos.x) + (p0.Y / SCALE - pos.y) * (p0.Y / SCALE - pos.y);
            if (d < bd) { bd = d; b = k; }
          }
          done[b] = 1;
          var pts = loopFrom(idxs[b], isOuter ? S.seam : (S.seam === 'rear' ? 'rear' : 'nearest'), [pos.x, pos.y]);
          if (isOuter && S.seamGap > 0) pts = trimEnd(pts, S.seamGap * lw);
          extrudePath(pts, isOuter ? spOuter : spInner, lw, h, isOuter ? T.OUTER : T.INNER, isOuter ? acOuter : acInner, 1);
        }
      }
      function emitLines(lines, speed, width, height, type, accel, flow) {
        if (!lines.length) return;
        var ordered = orderLines(lines, [pos.x, pos.y]);
        // ardışık kısa bağlantıları tek bir polyline'a birleştir (zikzak)
        var poly = null;
        var polys = [];
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
      function emitSparse(region) {
        var d = S.infillDensity / 100;
        var pat = S.infillPattern;
        if (pat === 'gyroid') {
          var curves = gyroidFill(region, lw / d, Ly.z);
          orderPolylines(curves, [pos.x, pos.y]).forEach(function (p) {
            extrudePath(p, spSparse, lw, h, T.SPARSE, acInfill, 1);
          });
          return;
        }
        var lines = [];
        if (pat === 'grid') {
          var sp = 2 * lw / d;
          lines = lineFill(region, sp, 45, 0).concat(lineFill(region, sp, -45, 0));
          emitLinesNoJoin(lines);
        } else if (pat === 'triangles') {
          var sp3 = 3 * lw / d;
          lines = lineFill(region, sp3, 0, 0).concat(lineFill(region, sp3, 60, 0), lineFill(region, sp3, -60, 0));
          emitLinesNoJoin(lines);
        } else { // lines / rectilinear
          var spl = lw / d;
          lines = lineFill(region, spl, li % 2 ? 45 : -45, 0);
          emitLines(lines, spSparse, lw, h, T.SPARSE, acInfill, 1);
        }
      }
      function emitLinesNoJoin(lines) {
        orderLines(lines, [pos.x, pos.y]).forEach(function (s) {
          extrudePath(s, spSparse, lw, h, T.SPARSE, acInfill, 1);
        });
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

      void outStart; void timeStart; void markFanIdx;
      if (li % 3 === 0) progress(0.75 + 0.25 * li / nL, 'G-code ' + (li + 1) + '/' + nL);
    }

    // ---- bitiş
    retract();
    out.push('; ---- end gcode ----');
    out.push('M106 S0');
    S.endGcode.split('\n').forEach(function (l) { out.push(l); });

    var filLen = totalE + 0; // mm
    var filVol = filLen * fa; // mm3
    var grams = filVol / 1000 * S.filamentDensity;
    var timeS = Math.round(totalTime * S.timeFactor);
    header.push('; generated by K1 Max Web Slicer (AEFGP)');
    header.push('; printer_model = Creality K1 Max');
    header.push(';FLAVOR:Klipper');
    header.push(';TIME:' + timeS);
    header.push(';Filament used: ' + (filLen / 1000).toFixed(3) + 'm');
    header.push(';Layer height: ' + S.layerHeight);
    header.push(';LAYER_COUNT:' + nL);
    header.push('; estimated printing time (normal mode) = ' + fmtTime(timeS));
    header.push('; total filament used [g] = ' + grams.toFixed(2));
    header.push('; filament_type = ' + (S.filamentType || ''));
    header.push('; nozzle_temperature = ' + S.nozzleTemp);
    header.push('; bed_temperature = ' + S.bedTemp);
    header.push('; layer_height = ' + S.layerHeight);
    header.push('; sparse_infill_density = ' + S.infillDensity + '%');
    header.push('');

    return {
      gcode: header.join('\n') + body.join('\n') + '\n',
      preview: new Float32Array(preview),
      layerIndex: layerIndex,
      layerZ: layers.map(function (l) { return l.z; }),
      stats: { time: timeS, filamentMm: filLen, grams: grams, layers: nL }
    };
  }

  function fmtTime(s) {
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return (hh ? hh + 'h ' : '') + mm + 'm ' + ss + 's';
  }

  var api = { slice: slice, T: T, fmtTime: fmtTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.K1Slicer = api;
})(typeof self !== 'undefined' ? self : this);
