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
    // ofset, dokulu yüzeylerde nokta sayısını katlar: çözünürlük altındaki ayrıntıyı at (sonraki tüm işlemler hızlanır)
    if (RES > 0) {
      var res = [];
      for (var i = 0; i < out.length; i++) { var q = out[i].length > 16 ? simplifyClosed(out[i], RES * SCALE) : out[i]; if (q.length >= 3) res.push(q); }
      out = res;
    }
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

  var RES = 0.0125;
  var FILL_RULE = null; // dilimlemede ayarlanır (sıfırdan farklı / çift-tek)
  var SMOOTH = false, FACETS = 0, POLYHOLE = false;
  // Çokgen delik (Orca: hole to polyhole, Nophead): yuvarlak delik, kenar sayısı çapa göre seçilmiş bir çokgene
  // dönüşür; kenarlar daireye teğet olur ki vida/pim tam ölçüde girsin (yuvarlak delikler genelde dar çıkar)
  function polyhole(path) {
    if (CL.Clipper.Area(path) >= 0 || path.length < 8) return path;   // yalnızca delikler
    var cx = 0, cy = 0; path.forEach(function (p) { cx += p.X; cy += p.Y; }); cx /= path.length; cy /= path.length;
    var rmin = Infinity, rmax = 0; path.forEach(function (p) { var r0 = Math.hypot(p.X - cx, p.Y - cy); if (r0 < rmin) rmin = r0; if (r0 > rmax) rmax = r0; });
    var r = (rmin + rmax) / 2;
    if (r <= 0 || (rmax - rmin) / r > 0.08 || r > 10 * SCALE) return path;           // daire değil ya da büyük
    var nS = Math.max(3, Math.round(4 * r / SCALE)), rc = r / Math.cos(Math.PI / nS), out2 = [];
    for (var k = 0; k < nS; k++) { var a = -k / nS * Math.PI * 2; out2.push({ X: Math.round(cx + rc * Math.cos(a)), Y: Math.round(cy + rc * Math.sin(a)) }); }
    return out2;
  } // kavis yumuşatma; düşük çözünürlüklü kavis sayacı (öneri için)
  // Düşük çözünürlüklü STL kavisleri: uzun düz parçalar ve aralarında küçük açılar (çokgen gibi görünür).
  // Keskin köşelere (35°'den fazla dönüş) dokunmadan, köşe noktalarından geçen bir eğri (Catmull-Rom) çizilir.
  function turnInfo(pts) {
    var n = pts.length, smooth = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      var ax = b.X - a.X, ay = b.Y - a.Y, bx = c.X - b.X, by = c.Y - b.Y;
      var la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < 1 || lb < 1) continue;
      var ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * 180 / Math.PI;
      if (ang < 35) { smooth[i] = 1; if (ang > 4 && la > 1.2 * SCALE && lb > 1.2 * SCALE) FACETS++; }
    }
    return smooth;
  }
  function smoothLoop(pts) {
    // neredeyse düz (1.5°'den az dönen) ara noktaları at: eğri yalnızca gerçek köşe noktalarından geçsin
    var n0 = pts.length, q = [];
    for (var i0 = 0; i0 < n0; i0++) {
      var a0 = pts[(i0 - 1 + n0) % n0], b0 = pts[i0], c0 = pts[(i0 + 1) % n0];
      var ux = b0.X - a0.X, uy = b0.Y - a0.Y, vx = c0.X - b0.X, vy = c0.Y - b0.Y, lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu > 0 && lv > 0 && (ux * vx + uy * vy) / (lu * lv) > Math.cos(1.5 * Math.PI / 180)) continue;
      q.push(b0);
    }
    if (q.length < 4) return pts;
    pts = q;
    var n = pts.length;
    var sm = turnInfo(pts), out = [], step = 0.3 * SCALE;
    var lerp = function (a, b, ta, tb, t) { var w = (tb - ta) || 1; return { x: ((tb - t) * a.x + (t - ta) * b.x) / w, y: ((tb - t) * a.y + (t - ta) * b.y) / w }; };
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      out.push(p1);
      var len = Math.hypot(p2.X - p1.X, p2.Y - p1.Y);
      // yalnızca iki ucu da yumuşak (hafif açılı) olan uzun parçalar eğriye dönüşür
      if (!sm[i] || !sm[(i + 1) % n] || len < 0.6 * SCALE) continue;
      // merkezcil Catmull-Rom (düzensiz nokta aralığında taşma ve çökme yapmaz)
      var P0 = { x: p0.X, y: p0.Y }, P1 = { x: p1.X, y: p1.Y }, P2 = { x: p2.X, y: p2.Y }, P3 = { x: p3.X, y: p3.Y };
      var t0 = 0, t1 = t0 + Math.sqrt(Math.hypot(P1.x - P0.x, P1.y - P0.y)), t2 = t1 + Math.sqrt(len), t3 = t2 + Math.sqrt(Math.hypot(P3.x - P2.x, P3.y - P2.y));
      var k = Math.min(24, Math.ceil(len / step));
      for (var j = 1; j < k; j++) {
        var t = t1 + (t2 - t1) * j / k;
        var A1 = lerp(P0, P1, t0, t1, t), A2 = lerp(P1, P2, t1, t2, t), A3 = lerp(P2, P3, t2, t3, t);
        var B1 = lerp(A1, A2, t0, t2, t), B2 = lerp(A2, A3, t1, t3, t), C = lerp(B1, B2, t1, t2, t);
        out.push({ X: Math.round(C.x), Y: Math.round(C.y) });
      }
    }
    return out;
  }
  // Kapalı çokgeni Douglas-Peucker ile sadeleştir (tol: Clipper birimi)
  function simplifyClosed(pts, tol) {
    var n = pts.length;
    if (n < 8) return pts;
    // en uzak iki noktadan böl, iki yarıyı ayrı sadeleştir
    var far = 0, fd = -1;
    for (var i = 1; i < n; i++) { var dx = pts[i].X - pts[0].X, dy = pts[i].Y - pts[0].Y, d = dx * dx + dy * dy; if (d > fd) { fd = d; far = i; } }
    var keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
    var tol2 = tol * tol, stack = [[0, far], [far, n]];
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1], A = pts[a], B = pts[b % n];
      if (b - a < 2) continue;
      var ex = B.X - A.X, ey = B.Y - A.Y, el = ex * ex + ey * ey, best = -1, bd = tol2;
      for (var k = a + 1; k < b; k++) {
        var px = pts[k].X - A.X, py = pts[k].Y - A.Y, dd;
        if (el === 0) dd = px * px + py * py;
        else { var cr = px * ey - py * ex; dd = cr * cr / el; }
        if (dd > bd) { bd = dd; best = k; }
      }
      if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    var out = [];
    for (i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
    return out;
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
      if (pts.length === 6) {
        // üçgenin dış normali (XY): kesit döngüsünün yönünü belirlemek için
        var i0 = ids[0] * 3, i1 = ids[1] * 3, i2 = ids[2] * 3;
        var ux = v[i1] - v[i0], uy = v[i1 + 1] - v[i0 + 1], uz = v[i1 + 2] - v[i0 + 2];
        var wx = v[i2] - v[i0], wy = v[i2 + 1] - v[i0 + 1], wz = v[i2 + 2] - v[i0 + 2];
        pts.push(uy * wz - uz * wy, uz * wx - ux * wz);
        segs.push(pts);
      }
    }
    // yön oyu: dış normal yürüme yönünün sağında olmalı (dış sınır saat yönünün tersine, delik saat yönünde)
    var vote = function (sg, ax, ay, bx, by) { return (by - ay) * sg[6] - (bx - ax) * sg[7]; };
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
      var vt = vote(cur, cur[1], cur[2], cur[4], cur[5]);
      var nextKey = cur[3], startKey = cur[0], guard = 0;
      while (nextKey !== startKey && guard++ < 1e7) {
        var cand = byKey.get(nextKey), found = -1;
        if (cand) for (var c = 0; c < cand.length; c++) if (!used[cand[c]]) { found = cand[c]; break; }
        if (found < 0) break;
        used[found] = 1;
        var sg = segs[found];
        if (sg[0] === nextKey) { nextKey = sg[3]; loop.push(P(sg[4], sg[5])); vt += vote(sg, sg[1], sg[2], sg[4], sg[5]); }
        else { nextKey = sg[0]; loop.push(P(sg[1], sg[2])); vt += vote(sg, sg[4], sg[5], sg[1], sg[2]); }
      }
      if (vt < 0) loop.reverse();
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
    // Çözünürlük: çok yoğun (milyonlarca üçgenli) modellerde kesit binlerce minik noktadan oluşur;
    // nozulun basamayacağı ayrıntıyı at (Orca: "resolution" 0.012 mm). Dilimleme bu sayede kat kat hızlanır.
    if (RES > 0) loops = loops.map(function (l) { return simplifyClosed(l, RES * SCALE); }).filter(function (l) { return l.length >= 3; });
    if (SMOOTH) loops = loops.map(smoothLoop); else loops.forEach(turnInfo); // ikinci durumda yalnızca köşeli kavisleri say
    var cl = new CL.Clipper();
    cl.AddPaths(loops, CL.PolyType.ptSubject, true);
    var out = new CL.Paths();
    // İç içe geçmiş gövdeler (indirilen modellerde sık) birleşsin: yönlü döngülerle sıfırdan farklı sarım kuralı.
    // Çift-tek kural üst üste binen bölgeleri boşluk sayıyordu. Delikler ters yönde olduğu için delik kalır.
    cl.Execute(CL.ClipType.ctUnion, out, FILL_RULE, FILL_RULE);
    out = CL.Clipper.CleanPolygons(out, 0.01 * SCALE);
    if (POLYHOLE) out = out.map(polyhole);
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

  // Parçaları uçlarından zincirle (eşleşen uç noktalar)
  function chainSegs(segs) {
    var key = function (p) { return Math.round(p[0] * 200) + ',' + Math.round(p[1] * 200); };
    var ends = new Map(), used = new Uint8Array(segs.length), out = [];
    segs.forEach(function (sg, i) { [0, 1].forEach(function (e) { var k = key(sg[e]); var l = ends.get(k); if (!l) ends.set(k, l = []); l.push(i); }); });
    for (var i = 0; i < segs.length; i++) {
      if (used[i]) continue; used[i] = 1;
      var line = [segs[i][0], segs[i][1]];
      for (var dir = 0; dir < 2; dir++) {
        for (var g = 0; g < 100000; g++) {
          var endP = dir ? line[0] : line[line.length - 1], l2 = ends.get(key(endP)), nx = -1;
          if (l2) for (var q = 0; q < l2.length; q++) if (!used[l2[q]]) { nx = l2[q]; break; }
          if (nx < 0) break;
          used[nx] = 1;
          var sg = segs[nx], other = key(sg[0]) === key(endP) ? sg[1] : sg[0];
          if (dir) line.unshift(other); else line.push(other);
        }
      }
      out.push(line);
    }
    return out;
  }
  function toClPaths(lines) { return lines.map(function (l) { return l.map(function (p) { return { X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }; }); }); }
  // Örtük yüzeyin (f = 0) bu katmandaki eş-değer eğrileri (kare yürütme)
  function contourFill(region, f, res) {
    if (!region.length) return [];
    var b = bboxOf(region), x0 = b.minX / SCALE - res, y0 = b.minY / SCALE - res;
    var nx = Math.ceil((b.maxX - b.minX) / SCALE / res) + 3, ny = Math.ceil((b.maxY - b.minY) / SCALE / res) + 3;
    if (nx * ny > 4e6) return [];
    var v = new Float32Array(nx * ny), i, j;
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) v[j * nx + i] = f(x0 + i * res, y0 + j * res);
    var segs = [], P = function (i1, j1, i2, j2) { var a = v[j1 * nx + i1], c = v[j2 * nx + i2], t = a / (a - c); return [x0 + (i1 + (i2 - i1) * t) * res, y0 + (j1 + (j2 - j1) * t) * res]; };
    for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
      var b0 = v[j * nx + i] > 0, b1 = v[j * nx + i + 1] > 0, b2 = v[(j + 1) * nx + i + 1] > 0, b3 = v[(j + 1) * nx + i] > 0;
      var e = [];
      if (b0 !== b1) e.push(P(i, j, i + 1, j));
      if (b1 !== b2) e.push(P(i + 1, j, i + 1, j + 1));
      if (b2 !== b3) e.push(P(i, j + 1, i + 1, j + 1));
      if (b3 !== b0) e.push(P(i, j, i, j + 1));
      if (e.length === 2) segs.push([e[0], e[1]]); else if (e.length === 4) { segs.push([e[0], e[1]]); segs.push([e[2], e[3]]); }
    }
    return clipOpen(toClPaths(chainSegs(segs).map(function (l) { return simplifyOpen(l, 0.02); })), region);
  }
  // Açık çoklu çizgiyi Douglas–Peucker ile sadeleştir (mm)
  function simplifyOpen(l, tol) {
    if (l.length < 3) return l;
    var keep = new Uint8Array(l.length), st = [[0, l.length - 1]]; keep[0] = keep[l.length - 1] = 1;
    while (st.length) {
      var se = st.pop(), a = l[se[0]], b = l[se[1]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9, mx = -1, mi = -1;
      for (var i = se[0] + 1; i < se[1]; i++) { var dd = Math.abs((l[i][0] - a[0]) * dy - (l[i][1] - a[1]) * dx) / L; if (dd > mx) { mx = dd; mi = i; } }
      if (mx > tol) { keep[mi] = 1; st.push([se[0], mi], [mi, se[1]]); }
    }
    return l.filter(function (p, i) { return keep[i]; });
  }
  // Schwarz elmas (TPMS-D) dolgu
  function tpmsdFill(region, spacing, z) {
    var k = 2 * Math.PI / (spacing * 2.85), Z = z * k, sZ = Math.sin(Z), cZ = Math.cos(Z);
    return contourFill(region, function (x, y) { var X = x * k, Y = y * k, sx = Math.sin(X), cx = Math.cos(X), sy = Math.sin(Y), cy = Math.cos(Y);
      return sx * sy * sZ + sx * cy * cZ + cx * sy * cZ + cx * cy * sZ; }, Math.max(0.15, spacing / 10));
  }
  // Petek (altıgen) dolgu: yinelenmeyen kenarlar; 3B petekte altıgenler yükseklikle kayar
  function honeycombFill(region, spacing, z, threeD) {
    if (!region.length) return [];
    var b = bboxOf(region), s = spacing, h = s * Math.sqrt(3) / 2;
    var shift = threeD ? s * 0.75 * Math.sin(2 * Math.PI * z / (3 * s)) : 0;
    var x0 = b.minX / SCALE - 2 * s, x1 = b.maxX / SCALE + 2 * s, y0 = b.minY / SCALE - 2 * h, y1 = b.maxY / SCALE + 2 * h;
    var seen = new Set(), segs = [];
    var R = function (v) { return Math.round(v * 1000) / 1000; };
    var add = function (ax, ay, bx, by) { var k = Math.round((ax + bx) * 50) + ',' + Math.round((ay + by) * 50); if (seen.has(k)) return; seen.add(k); segs.push([[R(ax), R(ay)], [R(bx), R(by)]]); };
    for (var col = 0, cx = x0 + shift; cx <= x1; col++, cx += 1.5 * s) {
      for (var cy = y0 + (col % 2 ? h : 0); cy <= y1; cy += 2 * h) {
        for (var e = 0; e < 6; e++) { var a1 = e * Math.PI / 3, a2 = (e + 1) * Math.PI / 3; add(cx + s * Math.cos(a1), cy + s * Math.sin(a1), cx + s * Math.cos(a2), cy + s * Math.sin(a2)); }
      }
    }
    return clipOpen(toClPaths(chainSegs(segs)), region);
  }
  // Üst yüzey desenleri: Hilbert eğrisi, Arşimet spirali, sekiz köşeli yıldız spirali
  function curvePattern(region, spacing, pattern) {
    if (!region.length) return [];
    var b = bboxOf(region), x0 = b.minX / SCALE, y0 = b.minY / SCALE, w = (b.maxX - b.minX) / SCALE, hh = (b.maxY - b.minY) / SCALE, pts = [];
    if (pattern === 'hilbert') {
      var n = 1; while (n * spacing < Math.max(w, hh)) n *= 2;
      if (n > 1024) n = 1024;
      for (var d = 0; d < n * n; d++) {
        var rx, ry, t = d, x = 0, y = 0;
        for (var s2 = 1; s2 < n; s2 *= 2) { rx = 1 & (t / 2); ry = 1 & (t ^ rx); if (ry === 0) { if (rx === 1) { x = s2 - 1 - x; y = s2 - 1 - y; } var tmp = x; x = y; y = tmp; } x += s2 * rx; y += s2 * ry; t = Math.floor(t / 4); }
        pts.push({ X: Math.round((x0 + (x + 0.5) * spacing) * SCALE), Y: Math.round((y0 + (y + 0.5) * spacing) * SCALE) });
      }
    } else {
      var cx = x0 + w / 2, cy = y0 + hh / 2, Rm = Math.hypot(w, hh) / 2 + spacing, a = spacing / (2 * Math.PI);
      for (var th = 0; a * th <= Rm; ) {
        var r = a * th, rr = pattern === 'octagram' ? r * (1 + 0.12 * Math.cos(8 * th)) : r;
        pts.push({ X: Math.round((cx + rr * Math.cos(th)) * SCALE), Y: Math.round((cy + rr * Math.sin(th)) * SCALE) });
        th += Math.min(0.5, 0.8 / Math.max(0.5, r));   // ~0.8 mm kirişler
      }
    }
    return clipOpen([pts], region);
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

  // Bölge kenarları için ızgara dizini (bölge dizisinin üzerinde önbelleklenir)
  function edgeGrid(region) {
    if (region._grid) return region._grid;
    var cell = 2 * SCALE, cells = new Map(), ex = [];
    region.forEach(function (path) {
      for (var i = 0; i < path.length; i++) {
        var p = path[i], q = path[(i + 1) % path.length], id = ex.length / 4;
        ex.push(p.X, p.Y, q.X, q.Y);
        var x0 = Math.floor(Math.min(p.X, q.X) / cell), x1 = Math.floor(Math.max(p.X, q.X) / cell);
        var y0 = Math.floor(Math.min(p.Y, q.Y) / cell), y1 = Math.floor(Math.max(p.Y, q.Y) / cell);
        for (var gx = x0; gx <= x1; gx++) for (var gy = y0; gy <= y1; gy++) {
          var k = gx * 100003 + gy, l = cells.get(k); if (!l) cells.set(k, l = []); l.push(id);
        }
      }
    });
    region._grid = { cell: cell, cells: cells, ex: ex, stamp: new Int32Array(ex.length / 4), gen: 0 };
    return region._grid;
  }
  function segCrossesRegion(a, b, region) {
    var G = edgeGrid(region), ex = G.ex, cell = G.cell;
    var ax = a[0] * SCALE, ay = a[1] * SCALE, bx = b[0] * SCALE, by = b[1] * SCALE;
    var x0 = Math.floor(Math.min(ax, bx) / cell), x1 = Math.floor(Math.max(ax, bx) / cell);
    var y0 = Math.floor(Math.min(ay, by) / cell), y1 = Math.floor(Math.max(ay, by) / cell);
    var gen = ++G.gen;
    var dx = bx - ax, dy = by - ay;
    for (var gx = x0; gx <= x1; gx++) for (var gy = y0; gy <= y1; gy++) {
      var l = G.cells.get(gx * 100003 + gy); if (!l) continue;
      for (var i = 0; i < l.length; i++) {
        var e = l[i]; if (G.stamp[e] === gen) continue; G.stamp[e] = gen;
        var px = ex[e * 4], py = ex[e * 4 + 1], qx = ex[e * 4 + 2], qy = ex[e * 4 + 3];
        var ex2 = qx - px, ey2 = qy - py, den = dx * ey2 - dy * ex2;
        if (den === 0) continue;
        var t = ((px - ax) * ey2 - (py - ay) * ex2) / den, u = ((px - ax) * dy - (py - ay) * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) return true;
      }
    }
    return false;
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
      // m-bitişiklik: köşegen komşu, aynı köşeye bir düz komşu üzerinden ulaşılabiliyorsa sayılmaz (merdiven
      // biçimli iskelette sahte kavşak oluşmasın; halkalar tek parça kalsın)
      var DIAG = { 0: [1, 3], 2: [1, 4], 5: [3, 6], 7: [4, 6] };
      var isNb = function (c, q) {
        if (!sk[c + N8[q]]) return false;
        var dq = DIAG[q]; if (!dq) return true;
        return !sk[c + N8[dq[0]]] && !sk[c + N8[dq[1]]];
      };
      var deg = new Uint8Array(W * H);
      for (var c = 0; c < W * H; c++) if (sk[c]) { var dg = 0; for (var q = 0; q < 8; q++) if (isNb(c, q)) dg++; deg[c] = dg; }
      var seen = new Set(), paths = [];
      var ek = function (a, c2) { return a < c2 ? a * 4194304 + c2 : c2 * 4194304 + a; };
      var walk = function (start, next) {
        var path = [start], prev = start, cur = next;
        seen.add(ek(start, next));
        for (var g = 0; g < 1e6; g++) {
          path.push(cur);
          if (deg[cur] !== 2 || cur === start) break;
          var nx = -1;
          for (var q2 = 0; q2 < 8; q2++) { var nb = cur + N8[q2]; if (isNb(cur, q2) && nb !== prev && !seen.has(ek(cur, nb))) { nx = nb; break; } }
          if (nx < 0) break;
          seen.add(ek(cur, nx)); prev = cur; cur = nx;
        }
        return path;
      };
      for (c = 0; c < W * H; c++) {
        if (!sk[c] || deg[c] === 2) continue;
        for (q = 0; q < 8; q++) { var nb2 = c + N8[q]; if (isNb(c, q) && !seen.has(ek(c, nb2))) paths.push(walk(c, nb2)); }
      }
      for (c = 0; c < W * H; c++) {
        if (!sk[c] || deg[c] !== 2) continue;
        for (q = 0; q < 8; q++) { var nb3 = c + N8[q]; if (isNb(c, q) && !seen.has(ek(c, nb3))) paths.push(walk(c, nb3)); }
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
  // Tarama çizgilerinde (lineFill: L[4] = satır konumu) başlangıç, satırların iki ucundan kafaya yakın olanıdır.
  // Ortadaki bir çizgiden başlanırsa dolgu iki yarıya bölünür ve yarıların arasında uzun bir boş gidiş olur.
  function edgeStart(lines, start) {
    if (lines.length < 3 || lines[0].length < 5) return start;
    var i;
    var lo = Infinity, hi = -Infinity;
    for (i = 0; i < lines.length; i++) { if (lines[i][4] < lo) lo = lines[i][4]; if (lines[i][4] > hi) hi = lines[i][4]; }
    var eps = 1, best = null, bd = Infinity;   // tam en uçtaki satır (köşedeki kısa çizgiler sona kalmasın)
    for (i = 0; i < lines.length; i++) {
      var l = lines[i]; if (l[4] - lo > eps && hi - l[4] > eps) continue;
      for (var k = 0; k < 4; k += 2) { var d = (l[k] - start[0]) * (l[k] - start[0]) + (l[k + 1] - start[1]) * (l[k + 1] - start[1]); if (d < bd) { bd = d; best = [l[k], l[k + 1]]; } }
    }
    return best || start;
  }
  // İki başlangıcı da dene (en yakın çizgi / taramanın kenarı), toplam boş gidişi az olanı kullan
  // Katı yüzeylerde (alt/üst/iç katı) her zaman kenardan: ortadan başlayıp iki yana yayılan dolguda iki yarının
  // birleştiği çizgi soğumuş komşuya yanaşır ve iz bırakabilir.
  function orderLines(lines, start, edge) {
    var es = edgeStart(lines, start);
    if (es === start || (es[0] === start[0] && es[1] === start[1])) return orderLinesFrom(lines, start);
    if (edge) return orderLinesFrom(lines, es);
    var a = orderLinesFrom(lines, start), b = orderLinesFrom(lines, es);
    var cost = function (o) { var c = 0, px = start[0], py = start[1]; for (var i = 0; i < o.length; i++) { c += Math.hypot(o[i][0][0] - px, o[i][0][1] - py); px = o[i][1][0]; py = o[i][1][1]; } return c; };
    return cost(b) < cost(a) ? b : a;
  }
  function orderLinesFrom(lines, start) {
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
  function orderMonotonic(lines, start) {
    var asc = true;
    if (start && lines.length > 1) {   // kafaya yakın uçtan başla (yön tüm çizgilerde aynı kalır)
      var lo = lines[0], hi = lines[0];
      lines.forEach(function (l) { if (l[4] < lo[4]) lo = l; if (l[4] > hi[4]) hi = l; });
      var dl = Math.min(Math.hypot(lo[0] - start[0], lo[1] - start[1]), Math.hypot(lo[2] - start[0], lo[3] - start[1]));
      var dh = Math.min(Math.hypot(hi[0] - start[0], hi[1] - start[1]), Math.hypot(hi[2] - start[0], hi[3] - start[1]));
      asc = dl <= dh;
    }
    return lines.slice().sort(function (a, b) { return asc ? (a[4] - b[4] || a[5] - b[5]) : (b[4] - a[4] || a[5] - b[5]); })
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

  // Kapalı konturu verilen noktaya en yakın kenar noktasından başlat (gerekirse oraya yeni köşe ekler)
  function loopAt(path, q) {
    var r = toPts(path), n = r.length, bd = Infinity, bi = 0, bp = r[0];
    for (var i = 0; i < n; i++) {
      var a = r[i], b = r[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1e-12;
      var t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L)), px = a[0] + dx * t, py = a[1] + dy * t, d = (px - q[0]) * (px - q[0]) + (py - q[1]) * (py - q[1]);
      if (d < bd) { bd = d; bi = i; bp = [px, py]; }
    }
    var o = [bp].concat(r.slice(bi + 1), r.slice(0, bi + 1));
    if (Math.hypot(o[1][0] - bp[0], o[1][1] - bp[1]) < 0.01) o.shift();
    o.push(o[0]);
    return o;
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

  // Uyarlanabilir katman yüksekliği: eğik/kavisli yüzeylerde ince, dik duvarlarda kalın katman.
  // Merdiven (cusp) yüksekliği c = h·|nz| sınırı → h = c / |nz|. Düz (yatay) yüzler sınırlamaz (üst/alt katmanlar halleder).
  function makeAdaptiveLayers(S, parts, maxZ) {
    var hMin = Math.max(0.04, Math.min(S.adaptiveMinH, S.adaptiveMaxH)), hMax = Math.max(hMin, S.adaptiveMaxH);
    var q = Math.max(0, Math.min(100, S.adaptiveQuality)) / 100;
    var cusp = 0.22 - 0.16 * q; // %0 → 0.22 mm (hızlı), %50 → 0.14 (0.20 mm sabit katmanın 45°'deki basamağı), %100 → 0.06
    var tris = [];
    parts.forEach(function (p) {
      var m = p.mesh, v = m.v;
      for (var t = 0; t < m.nTri; t++) {
        var a = m.idx[t * 3] * 3, b = m.idx[t * 3 + 1] * 3, c = m.idx[t * 3 + 2] * 3;
        var ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
        var wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
        var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1e-12) continue;
        var az = Math.abs(nz / len);
        if (az < 0.02 || az > 0.995) continue; // dik duvar ya da düz yüzey: sınırlamaz
        var hT = cusp / az;
        if (hT >= hMax) continue;
        tris.push({ z0: Math.min(v[a + 2], v[b + 2], v[c + 2]), z1: Math.max(v[a + 2], v[b + 2], v[c + 2]), h: hT });
      }
    });
    tris.sort(function (x, y) { return x.z0 - y.z0; });
    var hs = [], zs = [], z = S.firstLayerHeight, ti = 0, active = [];
    while (z + hMin * 0.5 < maxZ && hs.length < 20000) {
      while (ti < tris.length && tris[ti].z0 <= z + hMax) active.push(tris[ti++]);
      var h = hMax, keep = [];
      for (var i = 0; i < active.length; i++) {
        var tr = active[i];
        if (tr.z1 < z) continue;
        keep.push(tr);
        if (tr.z0 <= z + h && tr.h < h) h = tr.h;
      }
      active = keep;
      h = Math.max(hMin, h);
      hs.push(h); z += h; zs.push(z);
    }
    // yumuşatma: komşu katmanlar arasında ani sıçrama olmasın (en fazla %50 / adım)
    for (var pass = 0; pass < 2; pass++) {
      for (i = 1; i < hs.length; i++) hs[i] = Math.min(hs[i], hs[i - 1] * 1.5);
      for (i = hs.length - 2; i >= 0; i--) hs[i] = Math.min(hs[i], hs[i + 1] * 1.5);
    }
    var layers = [{ z: S.firstLayerHeight, h: S.firstLayerHeight }];
    z = S.firstLayerHeight;
    var top = Math.round(maxZ * 1000) / 1000;
    for (i = 0; z < top - 1e-6 && i < 40000; i++) {
      var hh = Math.min(Math.round((hs[Math.min(i, hs.length - 1)] || hMax) * 1000) / 1000, Math.round((top - z) * 1000) / 1000);
      var prev = layers[layers.length - 1];
      // son kalan parça çok inceyse bir önceki katmanı kalınlaştır (sığmıyorsa ince katman olarak bas)
      if (hh < hMin * 0.5 && layers.length > 1 && prev.h + hh <= hMax * 1.15) { prev.h = Math.round((prev.h + hh) * 1000) / 1000; prev.z = top; break; }
      z = Math.round((z + Math.max(hh, 0.04)) * 1000) / 1000;
      layers.push({ z: z, h: Math.max(hh, 0.04) });
    }
    return layers;
  }

  function sliceParts(parts, layers, progress) {
    var nL = layers.length;
    parts.forEach(function (part, pi) {
      var mesh = part.mesh;
      var buckets = [], mids = new Float64Array(nL);
      for (var b = 0; b < nL; b++) { buckets.push([]); mids[b] = layers[b].z - layers[b].h / 2; }
      var v = mesh.v;
      for (var t = 0; t < mesh.nTri; t++) {
        var a0 = mesh.idx[t * 3], a1 = mesh.idx[t * 3 + 1], a2 = mesh.idx[t * 3 + 2];
        var z0 = v[a0 * 3 + 2], z1 = v[a1 * 3 + 2], z2 = v[a2 * 3 + 2];
        var zmin = Math.min(z0, z1, z2), zmax = Math.max(z0, z1, z2);
        // ilk uygun katmanı ikili aramayla bul (milyonlarca üçgende baştan taramak çok yavaş)
        var lo = 0, hi = nL;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (mids[mid] < zmin) lo = mid + 1; else hi = mid; }
        for (var L = lo; L < nL && mids[L] <= zmax; L++) buckets[L].push(t);
      }
      part.outline = [];
      for (var li = 0; li < nL; li++) {
        part.outline.push(sliceAt(mesh, buckets[li], layers[li].z - layers[li].h / 2 + 1e-5));
        if (li % 10 === 0) progress(0.25 * (pi + li / nL) / parts.length, 'Kesitler alınıyor (' + part.name + ') ' + (li + 1) + '/' + nL);
      }
    });
  }

  // ---------------------------------------------------------------- 2) bölge işleme (duvar, dolgu, üst/alt, köprü)
  // Katman bölgesi, 1. aşama: yalnızca o katmanın kesitine bağlı (duvarlar, dolgu alanı, boşluk dolgusu).
  // Saf işlev: katmanlar birbirinden bağımsız hesaplanabilir (çok çekirdekte paralel).
  function regionA(outline, li, layers, S) {
    var W = S.W;
    var wallsN = S.spiralVase ? 1 : Math.max(1, S.wallLoops);
    if (outline.length) {
      outline = xyCompensate(outline, S.xyContourCompensation, S.xyHoleCompensation);
      if (li === 0 && S.elephantFoot) outline = offset(outline, -S.elephantFoot, false);
    }
    var first = li === 0;
    var wo = first ? W.first : W.outer, wi = first ? W.first : W.inner;
    var walls = [];
    var hl = layers[li].h;
    var so = flowSpacing(wo, hl), si = flowSpacing(wi, hl);
    // İnce bölgeler (Arachne benzeri): bir duvar halkasının merkez çizgisi poligonu çizgi aralığından darsa, o kısımda
    // halkanın iki kenarı üst üste basılır (fazla malzeme, pütür). O dar kısımlar halkadan çıkarılır; kalan boşluğu
    // boşluk dolgusu ortasından geçen tek, değişken kalınlıklı çizgiyle doldurur. Dar kısmı olmayan modellerde değişmez.
    var thinOk = S.thinWalls !== false && !S.spiralVase;
    var trimThin = function (poly, spc) {
      if (!thinOk || !poly.length) return poly;
      var op = opening(poly, spc * 0.9);
      return Math.abs(areaOf(poly) - areaOf(op)) > 0.02 ? op : poly;
    };
    var cur = offset(outline, -wo / 2, false);
    for (var k = 0; k < wallsN && cur.length; k++) {
      cur = trimThin(cur, k === 0 ? so : si);
      if (!cur.length) break;
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
    return { outline: outline, walls: walls, fill: fill, ref: ref, gaps: gaps };
  }

  // Üst/alt kabuk parametreleri ve bir katmanın kaç katman yukarı/aşağı bakması gerektiği
  function shellInfo(layers, S) {
    var nL = layers.length;
    var topN = Math.max(S.topLayers, Math.ceil(S.topThickness / S.layerHeight - 1e-6));
    var botN = Math.max(S.bottomLayers, Math.ceil(S.bottomThickness / S.layerHeight - 1e-6));
    if (S.spiralVase) topN = 0;
    var adaptive = !!S.adaptiveActive;
    // değişken katmanda kabuk, sabit katmandakiyle aynı fiziksel kalınlıkta olsun
    var tT = Math.max(S.topThickness, topN * S.layerHeight * 0.999), bT = Math.max(S.bottomThickness, botN * S.layerHeight * 0.999);
    // değişken katmanlarda: istenen kalınlığa ulaşmak için gereken katman sayısı (en az katman sayısı ayarı kadar)
    function nUp(li) {
      if (!adaptive || topN === 0) return topN;
      var t = 0, k = 0;
      while (li + k + 1 < nL && (k < 2 || t < tT - 1e-6)) { k++; t += layers[li + k].h; }
      return (k < 2 || t < tT - 1e-6) ? nL : k; // üstte yeterli kalınlık yok: tamamı üst yüzey
    }
    function nDown(li) {
      if (!adaptive || botN === 0) return botN;
      var t = 0, k = 0;
      while (li - k - 1 >= 0 && (k < 2 || t < bT - 1e-6)) { k++; t += layers[li - k].h; }
      return (k < 2 || t < bT - 1e-6) ? li + 1 : k; // altta yeterli kalınlık yok: tamamı alt yüzey
    }
    return { topN: topN, botN: botN, nUp: nUp, nDown: nDown };
  }

  // Katman bölgesi, 2. aşama: komşu katmanlara bakar (üst/alt yüzey, katı/seyrek dolgu, köprü).
  // R: en az [li-aşağı .. li+yukarı] aralığındaki 1. aşama sonuçları; below: birleşik kesitler (U).
  function regionB(li, R, layers, S, below, sh) {
    var nL = layers.length, W = S.W;
    var topN = sh.topN, botN = sh.botN;
    var r = R[li];
    if (!r.fill.length) { r.solid = []; r.sparse = []; r.top = []; r.bridge = []; return r; }
    var fill = r.fill, top = [], bottom = [];
    if (S.spiralVase && li >= botN) { r.solid = []; r.sparse = []; r.top = []; r.bridge = []; return r; }
    var tN = sh.nUp(li), bN = sh.nDown(li);
    if (topN > 0) {
      if (li + tN >= nL) top = fill; else {
        var acc = fill;
        for (var k1 = 1; k1 <= tN && acc.length; k1++) acc = intersect(acc, R[li + k1].ref);
        top = difference(fill, acc);
      }
    }
    if (botN > 0) {
      if (li < bN) bottom = fill; else {
        var acc2 = fill;
        for (var k2 = 1; k2 <= bN && acc2.length; k2++) acc2 = intersect(acc2, R[li - k2].ref);
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
    return r;
  }

  // Yükseklik aralığı ayarları (Orca: height range modifier): nesnenin belli bir Z aralığında duvar sayısı, dolgu
  // yoğunluğu/deseni ve dolgu hızı farklı olabilir. ranges = [{ z0, z1, S: { ... } }]
  var RANGE_KEYS = ['wallLoops', 'infillDensity', 'infillPattern', 'sparseInfillSpeed'];
  function layerS(S, ranges, z) {
    if (!ranges || !ranges.length) return S;
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      if (z > r.z0 + 1e-6 && z <= r.z1 + 1e-6) {
        if (!r._S) { r._S = Object.assign({}, S); RANGE_KEYS.forEach(function (k) { if (r.S && r.S[k] !== undefined && r.S[k] !== '' && r.S[k] !== null) r._S[k] = r.S[k]; }); }
        return r._S;
      }
    }
    return S;
  }
  function processPart(part, layers, S, below) {
    var nL = layers.length;
    var R = part.regions = [];
    for (var li = 0; li < nL; li++) R.push(regionA(part.outline[li], li, layers, layerS(S, part.ranges, layers[li].z)));
    var sh = shellInfo(layers, S);
    for (li = 0; li < nL; li++) regionB(li, R, layers, layerS(S, part.ranges, layers[li].z), below, sh);
  }

  // Tüm parçaların katman planlarını yardımcılara dağıtır (G-code yazımından önce)
  function plansParallel(q, pool, progress) {
    var layers = q.layers, S = q.S, nL = layers.length, parts = q.parts;
    var nChunk = Math.max(1, Math.min(nL, pool.size * 4)), size = Math.ceil(nL / nChunk), tasks = [];
    for (var a = 0; a < nL; a += size) {
      var items = [];
      for (var li = a; li < Math.min(nL, a + size); li++) {
        items.push({ li: li, Unext: q.U[li + 1] || [], Uprev: li > 0 ? q.U[li - 1] : null, comb: !!(S.avoidCrossingWalls && !(S.spiralVase && li >= S.spiralStart)), parts: parts.map(function (p) {
          var r = p.regions[li];
          if (!r || !r.outline.length) return null;
          return { r: { outline: r.outline, walls: r.walls, fill: r.fill, solid: r.solid, top: r.top, sparse: r.sparse, bridge: r.bridge, lightning: r.lightning, adapt: r.adapt }, combo: comboFor(p, li, nL, S), ranges: p.ranges };
        }) });
      }
      tasks.push({ kind: 'C', S: S, layers: layers, items: items });
    }
    progress(0.72, 'Dolgu çizgileri · ' + pool.size + ' çekirdek');
    return pool.run(tasks).then(function (res) {
      parts.forEach(function (p) { p.plans = p.plans || []; });
      q.job.combPre = [];
      res.forEach(function (list) { list.forEach(function (x) {
        x.plans.forEach(function (pl, pi) { if (pl) parts[pi].plans[x.li] = pl; });
        if (x.comb !== undefined) q.job.combPre[x.li] = x.comb;
      }); });
    });
  }

  // Paralel çalıştırma: yardımcı iş parçacığında tek bir görev (paylaşılan durum yok)
  function runTask(t) {
    RES = Math.max(0, num(t.S.resolution, 0.0125));
    if (t.kind === 'C') {
      var nL = t.layers.length;
      return t.items.map(function (it) {
        var Ly = t.layers[it.li], spiral = t.S.spiralVase && it.li >= t.S.spiralStart;
        var res = { li: it.li, plans: it.parts.map(function (pp) { return pp ? planPart(pp.r, it.li, nL, layerS(t.S, pp.ranges, Ly.z), Ly.h, Ly.z, spiral, pp.combo, it.Unext, it.Uprev) : null; }) };
        if (it.comb) res.comb = combRegions(it.parts.filter(Boolean).map(function (pp) { return pp.r.outline; }), it.li, t.S.W);
        return res;
      });
    }
    if (t.kind === 'A') return t.items.map(function (it) { return { li: it.li, r: regionA(it.outline, it.li, t.layers, layerS(t.S, t.ranges, t.layers[it.li].z)) }; });
    var sh = shellInfo(t.layers, t.S);
    return t.items.map(function (li) {
      var r = regionB(li, t.R, t.layers, layerS(t.S, t.ranges, t.layers[li].z), t.below, sh);
      return { li: li, solid: r.solid, sparse: r.sparse, top: r.top, bridge: r.bridge };
    });
  }

  // Bir parçanın bölgelerini yardımcı iş parçacıklarına bölüştürerek hesaplar. pool.run(görevler) → Promise<sonuçlar[]>
  function processPartParallel(part, layers, S, below, pool, progress, label) {
    var nL = layers.length, R = part.regions = new Array(nL);
    var nChunk = Math.max(1, Math.min(nL, pool.size * 4)), size = Math.ceil(nL / nChunk);
    var tasks = [];
    for (var a = 0; a < nL; a += size) {
      var items = [];
      for (var li = a; li < Math.min(nL, a + size); li++) items.push({ li: li, outline: part.outline[li] });
      tasks.push({ kind: 'A', S: S, layers: layers, items: items, ranges: part.ranges });
    }
    progress(0.3, 'Duvarlar ve dolgu (' + label + ') · ' + pool.size + ' çekirdek');
    return pool.run(tasks).then(function (res) {
      res.forEach(function (list) { list.forEach(function (x) { R[x.li] = x.r; }); });
      var sh = shellInfo(layers, S), tasksB = [];
      for (var a2 = 0; a2 < nL; a2 += size) {
        var b2 = Math.min(nL, a2 + size), lo = a2, hi = b2;
        var its = [];
        for (var l2 = a2; l2 < b2; l2++) {
          its.push(l2);
          lo = Math.min(lo, l2 - Math.min(l2, sh.nDown(l2)) - 1);
          hi = Math.max(hi, Math.min(nL - 1, l2 + Math.min(nL, sh.nUp(l2))) + 2);
        }
        lo = Math.max(0, lo); hi = Math.min(nL, hi);
        var win = {}, bel = {};
        for (var j = lo; j < hi; j++) win[j] = R[j];
        for (j = Math.max(0, a2 - 1); j < b2; j++) bel[j] = below[j];
        tasksB.push({ kind: 'B', S: S, layers: layers, items: its, R: win, below: bel, ranges: part.ranges });
      }
      progress(0.45, 'Üst/alt yüzeyler (' + label + ') · ' + pool.size + ' çekirdek');
      return pool.run(tasksB);
    }).then(function (res) {
      res.forEach(function (list) { list.forEach(function (x) { var r = R[x.li]; r.solid = x.solid; r.sparse = x.sparse; r.top = x.top; r.bridge = x.bridge; }); });
    });
  }

  // ---------------------------------------------------------------- yıldırım ve uyarlanabilir kübik dolgu (katmanlar arası, sırayla)
  // Bölgeyi ızgaraya boya (çift-tek, tarama çizgisi). G = { x0, y0, res, W, H }
  function rasterize(paths, G, mask) {
    mask = mask || new Uint8Array(G.W * G.H);
    if (!paths || !paths.length) return mask;
    var edges = [];
    paths.forEach(function (p) { for (var i = 0; i < p.length; i++) { var a = p[i], c = p[(i + 1) % p.length]; edges.push(a.X / SCALE, a.Y / SCALE, c.X / SCALE, c.Y / SCALE); } });
    var xs = [];
    for (var j = 0; j < G.H; j++) {
      var yc = G.y0 + (j + 0.5) * G.res; xs.length = 0;
      for (var e = 0; e < edges.length; e += 4) { var y1 = edges[e + 1], y2 = edges[e + 3]; if ((y1 <= yc) !== (y2 <= yc)) xs.push(edges[e] + (yc - y1) / (y2 - y1) * (edges[e + 2] - edges[e])); }
      xs.sort(function (a, b) { return a - b; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        var i0 = Math.max(0, Math.ceil((xs[k] - G.x0) / G.res - 0.5)), i1 = Math.min(G.W - 1, Math.floor((xs[k + 1] - G.x0) / G.res - 0.5));
        for (var ii = i0; ii <= i1; ii++) mask[j * G.W + ii] = 1;
      }
    }
    return mask;
  }
  function partGrid(part, res, maxCells) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    part.outline.forEach(function (o) { if (o.length) { var q = bboxOf(o); b.minX = Math.min(b.minX, q.minX); b.minY = Math.min(b.minY, q.minY); b.maxX = Math.max(b.maxX, q.maxX); b.maxY = Math.max(b.maxY, q.maxY); } });
    if (!isFinite(b.minX)) return null;
    var w = (b.maxX - b.minX) / SCALE + 2, hh = (b.maxY - b.minY) / SCALE + 2;
    res = Math.max(res, Math.sqrt(w * hh / maxCells));
    return { x0: b.minX / SCALE - 1, y0: b.minY / SCALE - 1, res: res, W: Math.ceil(w / res) + 1, H: Math.ceil(hh / res) + 1 };
  }

  // Yıldırım dolgu (Orca/Cura: lightning): yalnızca üst yüzeylerin altına, duvarlara doğru eğilerek inen dallar.
  // Her katmanda dal düğümleri en yakın duvara doğru (uzaklık alanının eğimi boyunca) kayar; duvara ulaşan dal biter.
  function computeLightning(part, layers, S) {
    var nL = layers.length, W = S.W, d = Math.max(0.05, S.infillDensity / 100);
    var sp = W.sparse / d;                       // düğüm aralığı ≈ dolgu çizgi aralığı
    var G = partGrid(part, 0.4, 250000); if (!G) return;
    var lean = Math.tan(Math.max(10, Math.min(70, num(S.lightningAngle, 40))) * Math.PI / 180);
    var nodes = [];
    for (var li = nL - 1; li >= 0; li--) {
      var r = part.regions[li]; r.lightning = [];
      if (!r.sparse || !r.sparse.length) { nodes = []; continue; }
      var sparseM = rasterize(r.sparse, G), dist = edt2d(sparseM, G.W, G.H);
      var at = function (x, y) { var i = Math.floor((x - G.x0) / G.res), j = Math.floor((y - G.y0) / G.res); return (i < 0 || j < 0 || i >= G.W || j >= G.H) ? -1 : j * G.W + i; };
      // yeni düğümler: üstteki katmanın katı/üst yüzeyi bu katmanda seyrek dolguya oturuyorsa
      var ra = li + 1 < nL ? part.regions[li + 1] : null;
      if (ra) {
        var need = intersect(union((ra.solid || []).concat(ra.top || [], ra.bridge || [])), r.sparse);
        if (need.length) {
          var needM = rasterize(need, G), stepC = Math.max(1, Math.round(sp / G.res)), occ = new Set();
          nodes.forEach(function (n) { occ.add(Math.floor(n.x / sp) + ',' + Math.floor(n.y / sp)); });
          for (var j = Math.floor(stepC / 2); j < G.H; j += stepC) for (var i = Math.floor(stepC / 2); i < G.W; i += stepC) {
            var c = j * G.W + i; if (!needM[c]) continue;
            var x = G.x0 + (i + 0.5) * G.res, y = G.y0 + (j + 0.5) * G.res, key = Math.floor(x / sp) + ',' + Math.floor(y / sp);
            if (!occ.has(key)) { occ.add(key); nodes.push({ x: x, y: y }); }
          }
        }
      }
      var h = layers[li].h, step = h * lean, keep = [], merged = new Set();
      for (var k = 0; k < nodes.length; k++) {
        var nd = nodes[k], c0 = at(nd.x, nd.y);
        if (c0 < 0 || !sparseM[c0]) continue;          // katı bölgeye ya da duvara oturdu: dal bitti
        var dv = Math.sqrt(dist[c0]) * G.res;
        if (dv <= W.sparse) { r.lightning.push([nd.x, nd.y, nd.x, nd.y, 0, 0, 'pt']); continue; } // duvara ulaştı
        // en yakın duvara doğru: uzaklık alanının azalan yönü
        var ci = c0 % G.W, cj = (c0 - ci) / G.W, gx = 0, gy = 0;
        if (ci > 0 && ci < G.W - 1) gx = Math.sqrt(dist[c0 + 1]) - Math.sqrt(dist[c0 - 1]);
        if (cj > 0 && cj < G.H - 1) gy = Math.sqrt(dist[c0 + G.W]) - Math.sqrt(dist[c0 - G.W]);
        var gl = Math.hypot(gx, gy) || 1, ux = -gx / gl, uy = -gy / gl;
        var nx = nd.x + ux * step, ny = nd.y + uy * step;
        // basılan parça: düğümden duvar yönüne en az 1 mm (katmanlar üst üste eğik bir dal oluşturur)
        var segL = Math.max(1.0, step);
        r.lightning.push([nd.x, nd.y, nd.x + ux * segL, nd.y + uy * segL, 0, 0]);
        var mk = Math.round(nx / (sp * 0.5)) + ',' + Math.round(ny / (sp * 0.5));
        if (merged.has(mk)) continue;                    // birbirine yaklaşan dallar birleşir
        merged.add(mk); keep.push({ x: nx, y: ny });
      }
      nodes = keep;
      r.lightning = r.lightning.filter(function (l) { return l[6] !== 'pt'; });
    }
  }

  // Uyarlanabilir kübik (Orca: adaptive cubic): üst/alt yüzeye ve duvara uzak derin bölgelerde çizgiler seyrekleşir.
  // Seviye 0: normal, 1: her 2 çizgiden 1'i, 2: her 4 çizgiden 1'i. Izgara her katman için seviye tutar.
  function computeAdaptive(part, layers, S) {
    var nL = layers.length, G = partGrid(part, 1.0, 90000); if (!G) return;
    var n = G.W * G.H, masks = [];
    for (var li = 0; li < nL; li++) masks.push(rasterize(part.regions[li].sparse || [], G));
    var up = new Float32Array(n), down = new Float32Array(n), downs = [];
    for (li = 0; li < nL; li++) { var m = masks[li], hh = layers[li].h; for (var c = 0; c < n; c++) down[c] = m[c] ? down[c] + hh : 0; downs.push(down.slice()); }
    var L1 = num(S.adaptiveCubicDepth, 3), L2 = L1 * 3;
    for (li = nL - 1; li >= 0; li--) {
      var m2 = masks[li], hh2 = layers[li].h;
      var dist = edt2d(m2, G.W, G.H), lv = new Uint8Array(n);
      for (c = 0; c < n; c++) {
        up[c] = m2[c] ? up[c] + hh2 : 0;
        if (!m2[c]) continue;
        var depth = Math.min(up[c], downs[li][c], Math.sqrt(dist[c]) * G.res);
        lv[c] = depth >= L2 ? 2 : depth >= L1 ? 1 : 0;
      }
      part.regions[li].adapt = { x0: G.x0, y0: G.y0, res: G.res, W: G.W, H: G.H, lv: lv };
    }
  }
  // kübik çizgileri derinliğe göre seyrelt: çizgi sırası (satır no) seviyeye göre atlanır, çizgi gerektiği yerde bölünür
  function thinByLevel(lines, sp, A, ad) {
    if (!ad) return lines;
    var out = [], ang = A * Math.PI / 180;
    lines.forEach(function (l) {
      var row = Math.round(l[4] / (sp * SCALE));
      var keepAt = function (x, y) {
        var i = Math.floor((x - ad.x0) / ad.res), j = Math.floor((y - ad.y0) / ad.res);
        var lv = (i < 0 || j < 0 || i >= ad.W || j >= ad.H) ? 0 : ad.lv[j * ad.W + i];
        return lv === 0 || row % (1 << lv) === 0;
      };
      var L = Math.hypot(l[2] - l[0], l[3] - l[1]), nS = Math.max(1, Math.ceil(L / 1.0)), start = null;
      for (var k = 0; k <= nS; k++) {
        var t = k / nS, x = l[0] + (l[2] - l[0]) * t, y = l[1] + (l[3] - l[1]) * t, ok = keepAt(x, y);
        if (ok && start === null) start = [x, y];
        if ((!ok || k === nS) && start !== null) {
          var ex = ok ? x : l[0] + (l[2] - l[0]) * (k - 1) / nS, ey = ok ? y : l[1] + (l[3] - l[1]) * (k - 1) / nS;
          if (Math.hypot(ex - start[0], ey - start[1]) > 0.8) out.push([start[0], start[1], ex, ey, l[4], l[5]]);
          start = null;
        }
      }
    });
    void ang;
    return out;
  }

  // ---------------------------------------------------------------- katman planı (saf: paralel hesaplanabilir)
  // Üst yüzey yönü (otomatik): en az çizgi = en uzun çizgiler = en az çizgi ucu
  function longestAngle(region) {
    var best = 0, bestN = Infinity;
    for (var a = 0; a < 180; a += 15) { var n = lineFill(region, 2, a).length; if (n < bestN) { bestN = n; best = a; } }
    return best;
  }
  // köprüyü en kısa açıklık yönünde at: dört açıyı dene, en kısa ortalama çizgiyi seç
  function bridgeAngleOf(region, W) {
    var best = 0, bestLen = Infinity;
    [0, 45, 90, 135].forEach(function (a) {
      var ls = lineFill(region, W.solid * 3, a);
      if (!ls.length) return;
      var tot = 0; ls.forEach(function (l) { tot += Math.hypot(l[2] - l[0], l[3] - l[1]); });
      if (tot / ls.length < bestLen) { bestLen = tot / ls.length; best = a; }
    });
    return best;
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
  // Seyrek dolgu çizgileri (desene göre). Gyroid ve eş merkezli için null: onlar basılırken üretilir.
  function sparseLines(region, hMul, li, z, S, W, first, adapt) {
    var wsp = first ? W.first : W.sparse, d = S.infillDensity / 100, A = S.infillAngle, pat = S.infillPattern;
    var gi = Math.floor(li / (hMul || 1));
    var single = null;
    if (pat === 'helix') single = A + gi * S.helixStep;
    else if (pat === 'golden') single = A + gi * 137.508;
    else if (pat === 'speed') single = speedAngles(region, wsp / d)[gi % 2];
    if (single !== null) return lineFill(region, wsp / d, single % 180);
    if (pat === 'gyroid' || pat === 'concentric' || pat === 'honeycomb' || pat === '3dhoneycomb' || pat === 'tpmsd') return null;
    // çapraz tarama: belirli yükseklik bloklarında ±45° arasında yön değiştiren çizgiler
    if (pat === 'crosshatch') return lineFill(region, wsp / d, Math.floor(z / (2 * wsp / d)) % 2 ? A + 45 : A - 45);
    if (pat === 'grid') { var s2 = 2 * wsp / d; return lineFill(region, s2, A).concat(lineFill(region, s2, A + 90)); }
    if (pat === 'triangles') { var s3 = 3 * wsp / d; return lineFill(region, s3, A).concat(lineFill(region, s3, A + 60), lineFill(region, s3, A - 60)); }
    if (pat === 'cubic' || pat === 'adaptivecubic') {
      // 3 yönlü, z ile kayan çizgiler: kübik dolguya yakın bir yapı
      var s4 = 3 * wsp / d, shift = (z % s4) / Math.SQRT2;
      var mk = function (a, sh) { return lineFill(region.map(function (pth) { return pth.map(function (q) { return { X: q.X + Math.round(sh * SCALE), Y: q.Y }; }); }), s4, a)
        .map(function (l) { return [l[0] - sh, l[1], l[2] - sh, l[3], l[4], l[5]]; }); };
      if (pat === 'adaptivecubic' && adapt) return thinByLevel(mk(A, shift), s4, A, adapt).concat(thinByLevel(mk(A + 60, -shift), s4, A + 60, adapt), thinByLevel(mk(A - 60, shift * 0.5), s4, A - 60, adapt));
      return mk(A, shift).concat(mk(A + 60, -shift), mk(A - 60, shift * 0.5));
    }
    if (pat === 'lightning') return null; // planda, katmanlar arası hesaplanmış dallardan
    return lineFill(region, wsp / d, gi % 2 ? A : A + 90); // doğrusal
  }
  // Bir parçanın bir katmandaki planı: adalar, ada başına duvar kümeleri, dolgu bölgeleri ve hazır dolgu çizgileri.
  // Yazıcı kafasının konumuna bağlı değildir; sıralama ve G-code yazımı sonra, sırayla yapılır.
  function planPart(r, li, nL, S, h, z, spiral, combo, Unext, Uprev) {
    var W = S.W, first = li === 0;
    var N = S.adaptiveActive ? 1 : Math.max(1, Math.min(4, S.infillEvery | 0));
    return islandsOf(r.outline).map(function (isl) {
      var big = offset(isl, 0.01, false);
      var P = { wallSets: r.walls.map(function (wp) { return intersect(wp, big); }) };
      if (spiral) return P;
      var solid = intersect(r.solid, big), top = intersect(r.top, big), sparse = intersect(r.sparse, big), bridge = intersect(r.bridge, big);
      // Üst yüzeyde tek duvar (Orca: only one wall on top): adanın dolgusu tamamen üst yüzeyse iç duvarlar kalkar,
      // o alan da üst yüzey çizgileriyle dolar — daha düzgün ve tek parça görünen üst yüzey, daha az kafa hareketi
      if (S.onlyOneWallTop && !first && P.wallSets.length > 1 && top.length) {
        var fillHere = intersect(r.fill, big), fa = Math.abs(areaOf(fillHere));
        if (fa > 0 && Math.abs(areaOf(intersect(top, fillHere))) >= fa * 0.95) {
          var wo1 = W.outer, inside = opening(offset(isl, -wo1 + S.infillOverlap / 100 * W.top, false), 0.1);
          P.wallSets = [P.wallSets[0]];
          top = inside; solid = inside; sparse = []; bridge = intersect(bridge, inside);
          P.oneWall = isl; // bu adadaki eski boşluk dolgusu çizgileri basılmasın
        }
      }
      var topOnly = intersect(top, solid);
      var solidNoTop = difference(solid, topOnly);
      var ang = ((li + (S.solidParity | 0)) % 2 === 0) ? S.solidAngle : S.solidAngle + 90;
      var ws = first ? W.first : W.solid;
      // Çıkıntılarda ek duvar (Orca: extra perimeters on overhangs): alt katmanın taşımadığı dolgu bölgesi (köprü
      // değilse) dolgu yerine çevresinden içe doğru duvar halkalarıyla basılır — sarkan kenar daha sağlam olur
      // Gerçek köprü (iki ya da daha çok yerden tutunan) köprü olarak kalır; yalnızca tek taraftan tutunan sarkan
      // bölümler (konsol) halkalarla basılır.
      if (S.extraPerimetersOverhang && li > 0 && Uprev && r.fill) {
        var ovR = difference(intersect(r.fill, big), offset(Uprev, W.inner * 0.5, false)), keepBridge = [];
        if (bridge.length) {
          var supd = intersect(Uprev, big);
          islandsOf(bridge).forEach(function (bc) {
            var anchors = opening(intersect(difference(offset(bc, W.solid * 1.5, false), bc), supd), W.solid * 0.5);
            if (islandsOf(anchors).length >= 2) keepBridge = keepBridge.concat(bc);
          });
        }
        ovR = opening(difference(ovR, keepBridge), W.inner * 2);
        if (ovR.length && Math.abs(areaOf(ovR)) > 1) {
          bridge = difference(bridge, ovR);
          P.extraLoops = concentricFill(ovR, flowSpacing(W.inner, h));
          sparse = difference(sparse, ovR); solidNoTop = difference(solidNoTop, ovR); topOnly = difference(topOnly, ovR);
        }
      }
      P.solidNoTop = solidNoTop; P.ang = ang;
      var solidPat = first ? S.bottomPattern : 'lines';
      if (solidNoTop.length && solidPat !== 'concentric') P.solidLines = lineFill(solidNoTop, flowSpacing(ws, h), ang);
      if (solidNoTop.length && solidPat === 'monotonic') P.solidReg = offset(solidNoTop, 0.05, false);
      P.bridge = bridge;
      if (bridge.length) P.bridgeLines = lineFill(bridge, W.solid, bridgeAngleOf(bridge, W));
      P.topOnly = topOnly;
      if (topOnly.length) {
        P.topAng = S.topAngleMode === 'auto' ? longestAngle(topOnly) : (S.topAngleMode === 'fixed' ? S.topAngle : ang);
        if (['concentric', 'hilbert', 'archimedean', 'octagram'].indexOf(S.topPattern) < 0) P.topLines = lineFill(topOnly, flowSpacing(W.top, h), P.topAng);
        if (S.topPattern === 'monotonic') P.topReg = offset(topOnly, 0.05, false);
        if (S.ironing !== 'none') {
          var ir = offset(S.ironing === 'all' || li === nL - 1 ? topOnly : difference(topOnly, Unext), -S.ironingInset, false);
          if (ir.length) P.irLines = lineFill(ir, S.ironingSpacing, P.topAng + 90);
        }
      }
      P.sparse = [];
      if (sparse.length || (N > 1 && combo && combo.c.length)) {
        if (N > 1 && !first && combo) {
          var own = difference(sparse, combo.c);
          if (own.length) P.sparse.push({ region: own, hMul: 0 });
          if (li === combo.end) {
            var cc = intersect(combo.c, big);
            if (cc.length) P.sparse.push({ region: cc, hMul: combo.end - combo.start + 1 });
          }
        } else if (sparse.length) P.sparse.push({ region: sparse, hMul: 0 });
      }
      var joinable = S.infillJoin && ['helix', 'golden', 'speed', 'rectilinear'].indexOf(S.infillPattern) >= 0;
      P.sparse.forEach(function (it) {
        it.lines = sparseLines(it.region, it.hMul || 1, li, z, S, W, first, r.adapt);
        if (S.infillPattern === 'lightning') {
          // bu adanın seyrek bölgesindeki yıldırım dalları
          var pp = it.region.map(function (q) { return q.map(function (v) { return [v.X / SCALE, v.Y / SCALE]; }); });
          it.lines = (r.lightning || []).filter(function (l) { return pip(pp, (l[0] + l[2]) / 2, (l[1] + l[3]) / 2); });
        }
        if (joinable) it.reg = offset(it.region, 0.05, false);
      });
      return P;
    });
  }
  // Duvarları geçmeden dolaşma için katmanın bölgesi (parça içi) ve yönlendirme düğüm bölgesi
  function combRegions(outlines, li, W) {
    var reg = [], nodes = [];
    outlines.forEach(function (o) {
      var wo0 = li === 0 ? W.first : W.outer;
      reg = reg.concat(offset(o, -wo0 / 2 + 0.05, false));
      nodes = nodes.concat(offset(o, -wo0 * 1.1, false));
    });
    return reg.length ? { reg: union(reg), nodes: union(nodes) } : null;
  }
  // birleştirilmiş dolgu (N katmanda bir) grubu: emitPart ile aynı kurallar
  function comboFor(p, li, nL, S) {
    var N = S.adaptiveActive ? 1 : Math.max(1, Math.min(4, S.infillEvery | 0));
    if (!(N > 1 && li > 0)) return null;
    var gs = 1 + Math.floor((li - 1) / N) * N, ge = Math.min(nL - 1, gs + N - 1);
    p.combo = p.combo || {};
    if (!p.combo[gs]) {
      var c = p.regions[gs].sparse;
      for (var k = gs + 1; k <= ge && c.length; k++) c = intersect(c, p.regions[k].sparse);
      p.combo[gs] = { start: gs, end: ge, c: ge > gs ? opening(c, S.W.sparse * 2) : [] };
    }
    return p.combo[gs];
  }

  // ---------------------------------------------------------------- 3) destekler
  // ---------------------------------------------------------------- boyama (dikiş, destek, renk)
  // pos: dünya koordinatında üçgen dizisi (9 sayı/üçgen), arr: üçgen başına boya değeri
  function layerRange(layers, zmin, zmax, mid) {
    var nL = layers.length, lo = 0, hi = nL;
    while (lo < hi) { var m = (lo + hi) >> 1; var zz = mid ? layers[m].z - layers[m].h / 2 : layers[m].z; if (zz < zmin) lo = m + 1; else hi = m; }
    var a = lo; lo = a; hi = nL;
    while (lo < hi) { var m2 = (lo + hi) >> 1; var z2 = mid ? layers[m2].z - layers[m2].h / 2 : layers[m2].z - layers[m2].h; if (z2 <= zmax) lo = m2 + 1; else hi = m2; }
    return [a, lo];
  }
  // Boyalı üçgenlerin katman orta düzlemiyle kesişim parçaları: katman başına [[x1, y1], [x2, y2]] listesi
  function paintSegs(pos, arr, val, layers) {
    var out = layers.map(function () { return []; });
    for (var t = 0; t < arr.length; t++) {
      if (arr[t] !== val) continue;
      var o = t * 9, P = [[pos[o], pos[o + 1], pos[o + 2]], [pos[o + 3], pos[o + 4], pos[o + 5]], [pos[o + 6], pos[o + 7], pos[o + 8]]];
      var zmin = Math.min(P[0][2], P[1][2], P[2][2]), zmax = Math.max(P[0][2], P[1][2], P[2][2]);
      var rg = layerRange(layers, zmin, zmax, true);
      for (var li = rg[0]; li < rg[1]; li++) {
        var zc = layers[li].z - layers[li].h / 2, pts = [];
        for (var e = 0; e < 3; e++) {
          var A = P[e], B = P[(e + 1) % 3];
          if ((A[2] - zc) * (B[2] - zc) < 0) { var k = (zc - A[2]) / (B[2] - A[2]); pts.push([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k]); }
        }
        if (pts.length === 2) out[li].push(pts);
      }
    }
    return out;
  }
  // Yataya yakın boyalı üçgenlerin XY izdüşümü, z ± dz aralığındaki katmanlara (renk boyamada üst/alt yüzeyler)
  function paintFlat(pos, arr, val, layers, dz, flatOnly) {
    var out = layers.map(function () { return []; });
    for (var t = 0; t < arr.length; t++) {
      if (arr[t] !== val) continue;
      var o = t * 9;
      var ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2], vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
      if (flatOnly && Math.abs(nz / nl) < 0.5) continue;
      var zmin = Math.min(pos[o + 2], pos[o + 5], pos[o + 8]) - dz, zmax = Math.max(pos[o + 2], pos[o + 5], pos[o + 8]) + dz;
      var tri = [{ X: Math.round(pos[o] * SCALE), Y: Math.round(pos[o + 1] * SCALE) }, { X: Math.round(pos[o + 3] * SCALE), Y: Math.round(pos[o + 4] * SCALE) }, { X: Math.round(pos[o + 6] * SCALE), Y: Math.round(pos[o + 7] * SCALE) }];
      if (Math.abs(CL.Clipper.Area(tri)) < 1) continue;
      if (CL.Clipper.Area(tri) < 0) tri.reverse();
      var rg = layerRange(layers, zmin, zmax, false);
      for (var li = rg[0]; li < rg[1]; li++) out[li].push(tri);
    }
    return out;
  }
  function offsetOpen(lines, r) {
    if (!lines.length) return [];
    var co = new CL.ClipperOffset(2, 0.01 * SCALE), sol = new CL.Paths();
    co.AddPaths(lines.map(function (l) { return l.map(function (q) { return { X: Math.round(q[0] * SCALE), Y: Math.round(q[1] * SCALE) }; }); }), CL.JoinType.jtRound, CL.EndType.etOpenRound);
    co.Execute(sol, r * SCALE);
    return sol;
  }
  // Dikiş boyası: önce zorunlu dikiş noktasına en yakın kenar noktasından başla; yoksa yasaklı bölgeden kaç
  function seamPaint(pts, E, B) {
    if ((!E || !E.length) && (!B || !B.length)) return pts;
    var ring = pts.slice(0, -1), n = ring.length, tol = 2.0, i, j;
    if (n < 3) return pts;
    if (E && E.length) {
      var bd = tol * tol, bi = -1, bq = null;
      for (i = 0; i < n; i++) {
        var a = ring[i], b = ring[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1e-12;
        for (j = 0; j < E.length; j++) {
          var e = E[j], t = Math.max(0, Math.min(1, ((e[0] - a[0]) * dx + (e[1] - a[1]) * dy) / L)), qx = a[0] + dx * t, qy = a[1] + dy * t, d = (qx - e[0]) * (qx - e[0]) + (qy - e[1]) * (qy - e[1]);
          if (d < bd) { bd = d; bi = i; bq = [qx, qy, t]; }
        }
      }
      if (bi >= 0) {
        var r2;
        if (bq[2] < 1e-3) r2 = ring.slice(bi).concat(ring.slice(0, bi));
        else if (bq[2] > 1 - 1e-3) { var k2 = (bi + 1) % n; r2 = ring.slice(k2).concat(ring.slice(0, k2)); }
        else r2 = [[bq[0], bq[1]]].concat(ring.slice(bi + 1), ring.slice(0, bi + 1));
        r2.push(r2[0]); return r2;
      }
    }
    if (B && B.length) {
      var blocked = function (p) { for (var q = 0; q < B.length; q++) if (Math.abs(B[q][0] - p[0]) < tol && Math.abs(B[q][1] - p[1]) < tol && Math.hypot(B[q][0] - p[0], B[q][1] - p[1]) < tol) return true; return false; };
      if (!blocked(ring[0])) return pts;
      for (var k = 1; k <= n / 2; k++) {
        var c = blocked(ring[k]) ? (blocked(ring[n - k]) ? -1 : n - k) : k;
        if (c >= 0) { var r3 = ring.slice(c).concat(ring.slice(0, c)); r3.push(r3[0]); return r3; }
      }
    }
    return pts;
  }

  function computeSupports(U, layers, S, bed, paint) {
    var nL = layers.length;
    var sup = [], iface = [];
    for (var i = 0; i < nL; i++) { sup.push([]); iface.push([]); }
    var enf = paint && paint.enf, blk = paint && paint.blk, anyEnf = !!(enf && enf.some(function (l) { return l.length; }));
    if ((!S.supportEnable && !anyEnf) || nL < 3) return { sup: sup, iface: iface };
    var h = S.layerHeight;
    var ang = Math.max(1, Math.min(89, S.supportAngle)) * Math.PI / 180;
    var gapTop = Math.max(0, Math.round(S.supportTopZ / h));
    var gapBot = Math.max(0, Math.round(S.supportBottomZ / h));
    var xy = S.supportXY;
    var ov = [[]];
    for (var li = 1; li < nL; li++) {
      if (!S.supportEnable) { ov.push([]); continue; }   // yalnızca boyanan zorunlu destekler
      var o = difference(U[li], offset(U[li - 1], layers[li].h / Math.tan(ang), false)); // değişken katmanda katmanın kendi yüksekliği
      ov.push(opening(o, S.W.support * 1.5));
    }
    // Destek boyası (Orca: support enforcer / blocker)
    if (enf || blk) for (li = 1; li < nL; li++) {
      if (enf && enf[li] && enf[li].length) ov[li] = union(ov[li].concat(offset(union(enf[li]), 0.3, false)));
      if (blk && blk[li] && blk[li].length && ov[li].length) ov[li] = difference(ov[li], offset(union(blk[li]), 1.5, false));
    }
    if (S.supportType === 'tree') return treeSupports(U, layers, S, bed, ov, gapTop, gapBot);
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

  // Ağaç destek (Orca: tree support): çıkıntıların altında uçlar açılır; uçlar her katmanda komşu dallara doğru eğilip
  // birleşir, kalınlaşır ve modele olan uzaklık alanıyla modelden kaçarak tablaya iner. Tepede, arayüz katmanlarında
  // çıkıntı alanının tamamı desteklenir.
  function treeSupports(U, layers, S, bed, ov, gapTop, gapBot) {
    var nL = layers.length, sup = [], iface = [], xy = S.supportXY, i, li;
    for (i = 0; i < nL; i++) { sup.push([]); iface.push([]); }
    // ızgara: tüm modelin kapladığı alan + 15 mm pay
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    U.forEach(function (u) { if (u.length) { var q = bboxOf(u); b.minX = Math.min(b.minX, q.minX); b.minY = Math.min(b.minY, q.minY); b.maxX = Math.max(b.maxX, q.maxX); b.maxY = Math.max(b.maxY, q.maxY); } });
    if (!isFinite(b.minX)) return { sup: sup, iface: iface };
    var x0 = Math.max(0, b.minX / SCALE - 15), y0 = Math.max(0, b.minY / SCALE - 15), x1 = Math.min(bed.x, b.maxX / SCALE + 15), y1 = Math.min(bed.y, b.maxY / SCALE + 15);
    var res = Math.max(0.4, Math.sqrt((x1 - x0) * (y1 - y0) / 160000));
    var G = { x0: x0, y0: y0, res: res, W: Math.ceil((x1 - x0) / res) + 1, H: Math.ceil((y1 - y0) / res) + 1 };
    var tipR = Math.max(0.5, num(S.treeTipDiameter, 1.6) / 2), maxR = num(S.treeMaxDiameter, 10) / 2;
    var lean = Math.tan(Math.max(10, Math.min(80, num(S.treeBranchAngle, 40))) * Math.PI / 180);
    var spacing = Math.max(1.5, num(S.treeTipSpacing, 3));
    var nIf = Math.max(0, S.supportInterfaceLayers);
    var circle = function (x, y, r) { var p = []; for (var k = 0; k < 20; k++) { var a = k / 20 * Math.PI * 2; p.push({ X: Math.round((x + r * Math.cos(a)) * SCALE), Y: Math.round((y + r * Math.sin(a)) * SCALE) }); } return p; };
    var nodes = [], contact = [];
    for (li = nL - 1; li >= 0; li--) {
      var h = layers[li].h, step = h * lean;
      // modelden uzaklık (boş alan = 1)
      var modelM = rasterize(U[li], G), free = new Uint8Array(G.W * G.H);
      for (i = 0; i < free.length; i++) free[i] = modelM[i] ? 0 : 1;
      var dist = edt2d(free, G.W, G.H);
      var dAt = function (x, y) { var ci = Math.floor((x - G.x0) / G.res), cj = Math.floor((y - G.y0) / G.res); if (ci < 1 || cj < 1 || ci >= G.W - 1 || cj >= G.H - 1) return { d: 1e9, gx: 0, gy: 0 }; var c = cj * G.W + ci;
        return { d: Math.sqrt(dist[c]) * G.res, gx: Math.sqrt(dist[c + 1]) - Math.sqrt(dist[c - 1]), gy: Math.sqrt(dist[c + G.W]) - Math.sqrt(dist[c - G.W]) }; };
      // yeni uçlar: bu katmanın üstündeki çıkıntı (üst Z boşluğu kadar yukarıda)
      var ovA = (li + 1 + gapTop < nL) ? ov[li + 1 + gapTop] : [];
      if (ovA.length) {
        contact.push({ area: ovA, until: li - nIf + 1 });
        var m2 = rasterize(ovA, G), st = Math.max(1, Math.round(spacing / G.res)), occ = new Set();
        nodes.forEach(function (n) { occ.add(Math.floor(n.x / spacing) + ',' + Math.floor(n.y / spacing)); });
        var spawned = 0;
        for (var j = Math.floor(st / 2); j < G.H; j += st) for (var ii = Math.floor(st / 2); ii < G.W; ii += st) {
          if (!m2[j * G.W + ii]) continue;
          var x = G.x0 + (ii + 0.5) * G.res, y = G.y0 + (j + 0.5) * G.res, key = Math.floor(x / spacing) + ',' + Math.floor(y / spacing);
          if (occ.has(key)) continue; occ.add(key); nodes.push({ x: x, y: y, r: tipR }); spawned++;
        }
        if (!spawned) { var q2 = bboxOf(ovA); nodes.push({ x: (q2.minX + q2.maxX) / 2 / SCALE, y: (q2.minY + q2.maxY) / 2 / SCALE, r: tipR }); }
      }
      // hareket: komşu dalların ağırlık merkezine doğru (birleşmek için), modelden kaçarak
      var moved = [];
      for (i = 0; i < nodes.length; i++) {
        // en yakın dala doğru (ikişer ikişer birleşerek az sayıda gövdeye iner)
        var n = nodes[i], best = null, bd = 25;
        for (var k2 = 0; k2 < nodes.length; k2++) { if (k2 === i) continue; var o = nodes[k2], dd = Math.hypot(o.x - n.x, o.y - n.y); if (dd < bd) { bd = dd; best = o; } }
        var nx = n.x, ny = n.y;
        if (best && bd > 1e-6) { var mv = Math.min(step, bd / 2); nx += (best.x - n.x) / bd * mv; ny += (best.y - n.y) / bd * mv; }
        var D = dAt(nx, ny), need = n.r + xy;
        if (D.d < need) { // modele çok yakın: uzaklık alanının artan yönünde kaç
          var gl = Math.hypot(D.gx, D.gy);
          if (gl > 1e-6) { nx += D.gx / gl * Math.min(step * 1.5, need - D.d + 0.1); ny += D.gy / gl * Math.min(step * 1.5, need - D.d + 0.1); }
          D = dAt(nx, ny);
        }
        if (D.d < Math.max(0.2, xy * 0.5)) continue; // modelin içine düştü: bu dal modelin üstünde biter
        moved.push({ x: nx, y: ny, r: Math.min(maxR, n.r + h * 0.03) });
      }
      // birleştirme
      var merged = [];
      moved.sort(function (a, c) { return c.r - a.r; });
      moved.forEach(function (n) {
        for (var k3 = 0; k3 < merged.length; k3++) { var m = merged[k3]; if (Math.hypot(m.x - n.x, m.y - n.y) < (m.r + n.r) * 0.6) {
          var A = m.r * m.r, B = n.r * n.r; m.x = (m.x * A + n.x * B) / (A + B); m.y = (m.y * A + n.y * B) / (A + B); m.r = Math.min(maxR, Math.sqrt(A + B)); return; } }
        merged.push({ x: n.x, y: n.y, r: n.r });
      });
      nodes = merged;
      // bu katmanın destek bölgesi: dallar + arayüz katmanlarında çıkıntı alanı
      var polys = nodes.map(function (n) { return circle(n.x, n.y, n.r); });
      contact = contact.filter(function (c) { if (li >= c.until) { polys = polys.concat(c.area); return true; } return false; });
      var sreg = polys.length ? difference(union(polys), offset(U[li], xy, false)) : [];
      for (var g = 1; g <= gapBot && li - g >= 0 && sreg.length; g++) sreg = difference(sreg, U[li - g]);
      sup[li] = sreg;
    }
    // arayüz: üstündeki N katman içinde biten destek
    for (li = 0; li < nL; li++) {
      if (!sup[li].length || !nIf) continue;
      var cont = sup[li];
      for (var j2 = 1; j2 <= nIf && cont.length; j2++) cont = li + j2 < nL ? intersect(cont, sup[li + j2]) : [];
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
    var curF = 0, curAccel = 0, fanState = {}, partS = null;
    var stats = { time: 0, e: [0, 0, 0, 0], toolChanges: 0, byType: {}, retracts: 0, combed: 0 };
    var lastPath = null, comb = null;
    var nL = layers.length;
    var bedCx = S.bedX / 2;
    var speedFactor = 1;
    var W = S.W;
    // Başlangıç makrosunun temizleme (purge) çizgisi biliniyorsa kafa onun sonundadır; ilk katman oradan başlar
    var posKnown = false;
    if (Array.isArray(S.purgeEnd) && isFinite(S.purgeEnd[0]) && isFinite(S.purgeEnd[1])) { pos.x = +S.purgeEnd[0]; pos.y = +S.purgeEnd[1]; posKnown = true; }
    var lastSeam = [bedCx, S.bedY], islandSeam = null, prevSeams = [], curSeams = [], seamLi = -1;
    // Duvar halkalarını konturlarına göre grupla: her dış halka (ada konturu ya da delik) ve onun içe doğru halkaları.
    // Böylece bir deliğin bütün duvarları bitirilip sonraki deliğe geçilir; her duvar sırası için bütün delikler
    // tek tek dolaşılmaz.
    function wallGroups(wallSets) {
      var outers = wallSets[0] || [], groups = outers.map(function (o) { return { outer: o, levels: wallSets.map(function () { return []; }) }; });
      outers.forEach(function (o, i) { groups[i].levels[0].push(o); });
      if (!groups.length) { groups.push({ outer: null, levels: wallSets.map(function (ws) { return ws.slice(); }) }); groups[0].levels[0] = []; return groups; }
      var samp = outers.map(function (o) { var st = Math.max(1, Math.floor(o.length / 64)), r = []; for (var k = 0; k < o.length; k += st) r.push(o[k]); return r; });
      for (var L = 1; L < wallSets.length; L++) wallSets[L].forEach(function (pth) {
        var q = pth[0], bg = 0, bd = Infinity;
        for (var g = 0; g < samp.length; g++) for (var k = 0; k < samp[g].length; k++) { var dx = samp[g][k].X - q.X, dy = samp[g][k].Y - q.Y, d = dx * dx + dy * dy; if (d < bd) { bd = d; bg = g; } }
        groups[bg].levels[L].push(pth);
      });
      return groups;
    }

    function f3(n) { return (Math.round(n * 1000) / 1000).toString(); }
    function f5(n) { return (Math.round(n * 100000) / 100000).toString(); }
    function fil() { return fils[Math.max(0, extruder)] || fils[0]; }
    var calib = job.calib || null, calibRetract = null, calibSpeed = null, calibTemp = null, partFlow = 1;
    function retractLen() { return calibRetract !== null ? calibRetract : num(fil().retractLength, S.retractLength); }
    function retractSpd() { return num(fil().retractSpeed, S.retractSpeed); }
    function deretractSpd() { return num(fil().deretractSpeed, S.deretractSpeed); }
    function zHop() { return num(fil().zHop, S.zHop); }
    var hopped = 0, pendingHop = 0; // uygulanmış ve bekleyen Z kaldırma
    // Hıza göre pressure advance (Orca: adaptive pressure advance): kalibrasyon tablosundan (PA, akış mm³/s, ivme)
    // her hareketin akışına ve ivmesine göre PA hesaplanıp değiştiğinde yazıcıya gönderilir
    var curPA = null;
    function paModel() {
      var F = fil(); if (F._paModel !== undefined) return F._paModel;
      var rows = String(F.paModel || '').split(/\n|;/).map(function (l) { return l.split(',').map(parseFloat); }).filter(function (r) { return r.length >= 3 && r.every(isFinite); });
      var byA = {}; rows.forEach(function (r) { (byA[r[2]] = byA[r[2]] || []).push([r[1], r[0]]); });
      var accs = Object.keys(byA).map(Number).sort(function (a, b) { return a - b; });
      accs.forEach(function (a) { byA[a].sort(function (p, q) { return p[0] - q[0]; }); });
      return (F._paModel = accs.length ? { accs: accs, byA: byA } : null);
    }
    function paAt(list, flow) { // akışa göre doğrusal ara değer
      if (flow <= list[0][0]) return list[0][1];
      for (var i = 1; i < list.length; i++) if (flow <= list[i][0]) { var a = list[i - 1], b = list[i]; return a[1] + (b[1] - a[1]) * (flow - a[0]) / ((b[0] - a[0]) || 1); }
      return list[list.length - 1][1];
    }
    function adaptPA(flow, accel) {
      var m = paModel(); if (!m) return;
      var A = m.accs, pa;
      if (accel <= A[0]) pa = paAt(m.byA[A[0]], flow);
      else if (accel >= A[A.length - 1]) pa = paAt(m.byA[A[A.length - 1]], flow);
      else for (var i = 1; i < A.length; i++) if (accel <= A[i]) { var p0 = paAt(m.byA[A[i - 1]], flow), p1 = paAt(m.byA[A[i]], flow); pa = p0 + (p1 - p0) * (accel - A[i - 1]) / (A[i] - A[i - 1]); break; }
      pa = Math.round(Math.max(0, pa) * 1000) / 1000;
      if (curPA === null || Math.abs(pa - curPA) >= 0.002) { out.push('SET_PRESSURE_ADVANCE ADVANCE=' + pa.toFixed(3)); curPA = pa; }
    }
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
      if (zh > 0) {
        if (S.zHopType === 'slope') pendingHop = zh;             // kalkış bir sonraki boş hareketle eğimli yapılır
        else { out.push('G1 Z' + f3(pos.z + zh) + ' F' + Math.round(S.zSpeed * 60)); hopped = zh; }
      }
    }
    function unretract() {
      if (!retracted) return;
      if (hopped > 0) out.push('G1 Z' + f3(pos.z) + ' F' + Math.round(S.zSpeed * 60));
      hopped = 0; pendingHop = 0;
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
        // Eğimli Z kaldırma (Orca: z_hop_types Slope): nozul yerinde dikey kalkmaz, ilerlerken yükselir;
        // ip ve damla bırakma ihtimali azalır, kalkış süresi gizlenir
        if (pendingHop > 0) {
          var tanA = Math.tan(Math.max(1, Math.min(60, num(S.travelSlope, 3))) * Math.PI / 180), ramp = pendingHop / tanA;
          var lift = Math.min(pendingHop, dd * tanA), rl = Math.min(dd, ramp), rx = pos.x + (q[0] - pos.x) * rl / dd, ry = pos.y + (q[1] - pos.y) * rl / dd;
          out.push('G0 X' + f3(rx) + ' Y' + f3(ry) + ' Z' + f3(pos.z + lift) + ' F' + Math.round(spd * 60));
          stats.time += moveTime(rl, spd, Math.min(S.accelTravel, S.machineMaxAccel));
          if (posKnown) preview.push(pos.x, pos.y, pos.z, rx, ry, pos.z, T.TRAVEL, extruder, 0, 0, spd);
          pos.x = rx; pos.y = ry; hopped = lift; pendingHop = 0;
          dd = Math.hypot(q[0] - pos.x, q[1] - pos.y);
          if (dd < 0.01) return;
        }
        out.push('G0 X' + f3(q[0]) + ' Y' + f3(q[1]) + ' F' + Math.round(spd * 60));
        stats.time += moveTime(dd, spd, Math.min(S.accelTravel, S.machineMaxAccel)); // süre, sonraki yolun türüne yazılır
        // kafa hareketi önizlemesi için hep kaydedilir; ilk hareket hariç (başlangıç makrosundan sonra kafanın nerede
        // olduğu bilinmez, tablanın köşesinden çizilen yanıltıcı bir çizgi olurdu)
        if (posKnown) preview.push(pos.x, pos.y, pos.z, q[0], q[1], pos.z, T.TRAVEL, extruder, 0, 0, spd);
        posKnown = true;
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
      if (F.adaptivePA && !calib) adaptPA(sp * (width - height * (1 - Math.PI / 4)) * height, accel);
      var first = true, seg = [];
      // küçük alan akış telafisi: kısa katı dolgu/üst yüzey çizgilerinde (Orca: çizgi boyuna göre) daha az akış
      var smallF = 1;
      if (S.smallAreaFlowComp && (type === T.SOLID || type === T.TOP)) {
        var Lp = 0; for (var q = 1; q < pts.length && Lp < 10; q++) Lp += Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]);
        if (Lp < 10) smallF = smallFlowFactor(Lp);
      }
      // yay birleştirme: düzlemsel yolda art arda noktalar bir çembere oturuyorsa tek G2/G3 komutu yazılır
      var arcs = S.arcFitting && pts.length >= 6 && pts.every(function (q) { return q.length === 2; }) ? fitArcs(pts) : null, ai = 0;
      for (var i = 1; i < pts.length; i++) {
        var x = pts[i][0], y = pts[i][1], z = pts[i].length > 2 ? pts[i][2] : pos.z;
        var dx = x - pos.x, dy = y - pos.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.005) continue;
        if (arcs) while (ai < arcs.length && arcs[ai].i < i - 1) ai++;
        if (arcs && ai < arcs.length && arcs[ai].i === i - 1) {
          var A = arcs[ai++], eSum = 0, sx = pos.x, sy = pos.y;
          for (var k2 = A.i + 1; k2 <= A.j; k2++) {
            var px = pts[k2][0], py = pts[k2][1], dd = Math.hypot(px - pos.x, py - pos.y);
            if (dd < 0.005) continue;
            seg.push({ d: dd, ux: (px - pos.x) / dd, uy: (py - pos.y) / dd });
            eSum += dd * eArea * smallF;
            preview.push(pos.x, pos.y, pos.z, px, py, pos.z, type, extruder, width, height, sp);
            pos.x = px; pos.y = py;
          }
          stats.e[Math.max(0, extruder)] += eSum;
          var ln = (A.cw ? 'G2' : 'G3') + ' X' + f3(pos.x) + ' Y' + f3(pos.y) + ' I' + f3(A.cx - sx) + ' J' + f3(A.cy - sy) + ' E' + f5(eSum);
          if (first || sp !== curF) { ln += ' F' + Math.round(sp * 60); curF = sp; first = false; }
          out.push(ln);
          i = A.j;
          continue;
        }
        seg.push({ d: d, ux: dx / d, uy: dy / d });
        var e = d * eArea * (pts[i].length > 3 ? pts[i][3] : 1);
        e *= smallF;
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
    // Orca'nın varsayılan küçük alan akış eğrisi (çizgi boyu mm → akış çarpanı)
    var SMALL_FLOW = [[0, 0], [0.2, 0.4444], [0.4, 0.6145], [0.6, 0.7059], [0.8, 0.7619], [1.5, 0.8571], [2, 0.8889], [3, 0.9231], [5, 0.952], [10, 1]];
    function smallFlowFactor(d) {
      for (var i = 1; i < SMALL_FLOW.length; i++) if (d <= SMALL_FLOW[i][0]) { var a = SMALL_FLOW[i - 1], b = SMALL_FLOW[i]; return a[1] + (b[1] - a[1]) * (d - a[0]) / (b[0] - a[0]); }
      return 1;
    }
    // Yay uydurma: noktaları açgözlü olarak çemberlere uydur (0.02 mm sapma, en az 5 parça, yarıçap 0.5–300 mm)
    function fitArcs(pts) {
      var res = [], n = pts.length, i = 0, tol = 0.02;
      var circ = function (a, b, c) {
        var ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1], D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(D) < 1e-9) return null;
        var a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
        var ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / D, uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D;
        return { x: ux, y: uy, r: Math.hypot(ax - ux, ay - uy) };
      };
      var fits = function (i0, j0) {
        var c = circ(pts[i0], pts[(i0 + j0) >> 1], pts[j0]);
        if (!c || c.r < 0.5 || c.r > 300) return null;
        var sgn = 0, sweep = 0;
        for (var k = i0 + 1; k <= j0; k++) {
          if (Math.abs(Math.hypot(pts[k][0] - c.x, pts[k][1] - c.y) - c.r) > tol) return null;
          var ux = pts[k - 1][0] - c.x, uy = pts[k - 1][1] - c.y, vx = pts[k][0] - c.x, vy = pts[k][1] - c.y;
          var cr = ux * vy - uy * vx, sg = cr > 0 ? 1 : -1;
          if (!sgn) sgn = sg; else if (sg !== sgn) return null;
          var sl = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
          if (sl > c.r * 0.7 || sl > 5) return null;   // seyrek noktalar: yay değil çokgen (köşeli kalmalı)
          sweep += Math.atan2(Math.abs(cr), ux * vx + uy * vy);
        }
        // kesişen ya da başa dönen yay (tam daire) G2/G3'te belirsiz olur; 300° üstüne izin verme
        if (sweep > 5.2) return null;
        // yay ortası bir kirişin hemen yanında: orta noktaların da çember üstünde olduğunu kontrol et
        for (k = i0 + 1; k <= j0; k++) { var mx = (pts[k][0] + pts[k - 1][0]) / 2, my = (pts[k][1] + pts[k - 1][1]) / 2;
          if (c.r - Math.hypot(mx - c.x, my - c.y) > 0.05) return null; }
        return { i: i0, j: j0, cx: c.x, cy: c.y, cw: sgn < 0 };
      };
      while (i < n - 5) {
        var best = null;
        for (var j = i + 5; j < n && j - i <= 400; j++) { var f = fits(i, j); if (!f) break; best = f; }
        if (best) { res.push(best); i = best.j; } else i++;
      }
      return res;
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
        orderMonotonic(lines, [pos.x, pos.y]).forEach(function (s) { extrudePath(s, speed, width, height, type, accel, flow); });
        return;
      }
      var ordered = orderLines(lines, [pos.x, pos.y], type === T.SOLID || type === T.TOP || type === T.BRIDGE);
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
    function joinInRegion(lines, region, maxGap, preReg) {
      var ordered = orderLines(lines, [pos.x, pos.y]);
      region = preReg || offset(region, 0.05, false);
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
    // Bağlantı çizgisi bölgenin içinde mi? Uçlar bölgenin içindedir (çizgi uçları, 0.05 mm dışa genişletilmiş bölge);
    // o hâlde kenarlardan hiçbirini kesmiyorsa tamamen içeridedir. Kenarlar ızgarada tutulur: her bağlantı için
    // ayrı bir Clipper işlemi yerine yalnızca yakındaki birkaç kenar denetlenir.
    function connectorInside(a, b, region) { return !segCrossesRegion(a, b, region); }
    function emitLinesSeparate(lines, speed, width, height, type, accel) {
      orderLines(lines, [pos.x, pos.y]).forEach(function (s) { extrudePath(s, speed, width, height, type, accel, 1); });
    }
    function emitLoops(paths, speed, width, height, type, accel, flow, near) {
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
        extrudePath(near ? loopAt(paths[b], near) : loopFrom(paths[b], 'nearest', [pos.x, pos.y], bedCx), speed, width, height, type, accel, flow);
      }
    }
    function surfaceFill(region, pattern, width, angle, speed, height, type, accel, flow, pre, preReg) {
      if (!region.length) return;
      var spc = flowSpacing(width, height);
      if (pattern === 'concentric') { emitLoops(concentricFill(region, spc), speed, width, height, type, accel, flow); return; }
      if (pattern === 'hilbert' || pattern === 'archimedean' || pattern === 'octagram') {
        orderPolylines(curvePattern(region, spc, pattern), [pos.x, pos.y]).forEach(function (p) { extrudePath(p, speed, width, height, type, accel, flow); });
        return;
      }
      var lines = pre || lineFill(region, spc, angle);
      if (pattern === 'monotonic') emitMonotonic(lines, region, spc, speed, width, height, type, accel, flow, preReg);
      else emitLinesJoined(lines, speed, width, height, type, accel, flow);
    }
    // Monoton zikzak: satırlar sırayla (yüzey hep aynı yönde dolar), her satırda yön değişir,
    // komşu satırlar bölge içinde kalan kısa bağlantıyla birleştirilir. Boşta geri dönüş yok.
    function emitMonotonic(lines, region, spc, speed, width, height, type, accel, flow, preReg) {
      if (!lines.length) return;
      var reg = preReg || offset(region, 0.05, false);
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
      var defd = {};
      parts.forEach(function (p, i) {
        var bb = p.bbox;
        if (defd[p.label]) return; defd[p.label] = 1;   // renk boyası sanal parçaları aynı nesnedir
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

    // katman planı: paralel dilimlemede önceden hazırdır; yoksa burada bir kez hesaplanır (en kısa katman süresi tekrarında yeniden kullanılır)
    function planOf(p) {
      p.plans = p.plans || [];
      return p.plans[li] || (p.plans[li] = planPart(p.regions[li], li, nL, layerS(S, p.ranges, Ly.z), h, Ly.z, spiral, comboFor(p, li, nL, S), job.U[li + 1] || [], li > 0 ? job.U[li - 1] : null));
    }
    // bu katmanda bir yuvanın parçalarının seyrek dolgu hacmi (yıkamanın dolguya yapılabilecek kısmı)
    function sparseVolume(slot) {
      var v = 0, area = (W.sparse - h * (1 - Math.PI / 4)) * h;
      (bySlot[slot] || []).forEach(function (p) {
        planOf(p).forEach(function (P) { (P.sparse || []).forEach(function (it) {
          if (!it.lines) return;
          it.lines.forEach(function (l) { v += Math.hypot(l[2] - l[0], l[3] - l[1]) * area * (it.hMul || 1); });
        }); });
      });
      return v;
    }
    function toolChange(to, li) {
      if (to === extruder) return;
      var from = extruder;
      retract();
      pushBlock(fils[from].endGcode);
      var zl = pos.z + S.toolChangeLift;
      out.push('; ---- filament change T' + from + ' -> T' + to + ' ----');
      // yıkama hacmi: yuva çifti matrisi (renklere göre) varsa ondan, yoksa sabit hacim × filament çarpanı
      var flushVol = job.flush && job.flush[from] && job.flush[from][to] !== undefined ? +job.flush[from][to]
        : S.purgeVolume * num(fils[to].purgeMultiplier, 1);
      var dia = num(fils[to].filamentDiameter, 1.75);
      pushBlock(S.changeFilamentGcode, {
        current_tool: from, next_tool: to, next_temp: li === 0 ? fils[to].nozzleTempFirst : fils[to].nozzleTemp,
        z: f3(pos.z), z_lift: f3(zl), layer: li,
        flush_volume: Math.round(flushVol), flush_length: f3(flushVol / (Math.PI * dia * dia / 4)),
      });
      out.push('; flush_volume = ' + Math.round(flushVol) + ' mm3 (T' + from + ' -> T' + to + ')');
      extruder = to;
      retracted = false; curF = 0;
      var t = li === 0 ? fils[to].nozzleTempFirst : fils[to].nozzleTemp;
      var tPrev = li === 0 ? fils[from].nozzleTempFirst : fils[from].nozzleTemp;
      if (t !== tPrev) out.push('M109 S' + t);
      pushBlock(fils[to].startGcode);
      if (num(fils[to].pressureAdvance, 0) > 0) out.push('SET_PRESSURE_ADVANCE ADVANCE=' + fils[to].pressureAdvance);
      curPA = null;
      out.push('G1 Z' + f3(pos.z) + ' F' + Math.round(S.zSpeed * 60));
      stats.toolChanges++;
      stats.time += S.toolChangeTime;
      applyLayerFans(li);
      // CFS atık kanalı: asıl yıkamayı yazıcı yapar, kulede yalnızca küçük temizleme
      var towerVol = S.flushTarget === 'tower' ? flushVol : S.purgeVolume * num(fils[to].purgeMultiplier, 1);
      // yıkamanın bir kısmı yeni rengin parçalarının iç dolgusuna (önce dolgu basılır, karışık renk içeride kalır)
      if (S.flushIntoInfill && S.flushTarget === 'tower' && !spiral) {
        var take = Math.min(sparseVolume(to), towerVol);
        if (take > 1) { towerVol -= take; flushFirstSlot = to; stats.flushInfill = (stats.flushInfill || 0) + take; out.push('; flush into infill = ' + Math.round(take) + ' mm3'); }
      }
      towerLayer(li, towerVol);
      return true;
    }

    // ---- katmanlar
    for (var li = 0; li < nL; li++) {
      var Ly = layers[li];
      var first = li === 0;
      var h = Ly.h;
      var spiral = S.spiralVase && li >= S.spiralStart;
      // Timelapse (K1 kamerası / moonraker-timelapse): biten katmanın karesi. 'park' modunda kafa önce kenara çekilir,
      // kısa bekler, sonra kare alınır — karelerde nozul modelin üstünde görünmez, video akıcı olur
      if (S.timelapse && S.timelapse !== 'none' && li > 0) {
        if (S.timelapse === 'park' && !spiral) {
          var cm0 = comb; comb = null;
          retract();
          travel(Math.max(0, Math.min(S.bedX, num(S.timelapseParkX, S.bedX - 10))), Math.max(0, Math.min(S.bedY, num(S.timelapseParkY, S.bedY - 10))));
          comb = cm0;
          var dw = Math.max(0, num(S.timelapseDwell, 300));
          if (dw) { out.push('G4 P' + Math.round(dw)); stats.time += dw / 1000; }
        }
        out.push('TIMELAPSE_TAKE_FRAME');
      }
      layerIndex.push(preview.length / PV);
      comb = null;
      if (S.avoidCrossingWalls && !spiral) {
        var cr = job.combPre && job.combPre[li] !== undefined ? job.combPre[li]
          : combRegions(parts.map(function (p) { var r0 = p.regions[li]; return r0 && r0.outline.length ? r0.outline : null; }).filter(Boolean), li, W);
        if (cr) comb = combContext(cr.reg, cr.nodes);
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
        var hopNow = retracted && zHop() > 0 ? zHop() : 0;
        out.push('G1 Z' + f3(Ly.z + hopNow) + ' F' + Math.round(S.zSpeed * 60));
        hopped = hopNow; pendingHop = 0;
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
      if (first) Object.keys(bySlot).forEach(function (k) {   // ilk katmanda temizleme çizgisine yakın parçadan başla
        bySlot[k].sort(function (A, B) { var da = Math.hypot((A.bbox.minX + A.bbox.maxX) / 2 - pos.x, (A.bbox.minY + A.bbox.maxY) / 2 - pos.y), db = Math.hypot((B.bbox.minX + B.bbox.maxX) / 2 - pos.x, (B.bbox.minY + B.bbox.maxY) / 2 - pos.y); return da - db; });
      });
      var slots = Object.keys(bySlot).map(Number);
      slots.sort(function (a, b) { return (a === extruder ? -1 : 0) - (b === extruder ? -1 : 0) || a - b; });

      var snap = { pos: { x: pos.x, y: pos.y, z: pos.z }, e: stats.e.slice(), t: stats.time, pv: preview.length, out: out.length,
        retracted: retracted, curF: curF, curAccel: curAccel, fan: JSON.stringify(fanState), ext: extruder, tc: stats.toolChanges,
        hopped: hopped, pendingHop: pendingHop, pa: curPA, fseed: fuzzSeed };
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
          hopped = snap.hopped; pendingHop = snap.pendingHop; curPA = snap.pa; fuzzSeed = snap.fseed;
          speedFactor = Math.max(layerTime / minT, (num(fil().minSpeed, 20)) / Math.max(1, S.outerWallSpeed));
          out.push('; min layer time: speed ' + Math.round(speedFactor * 100) + '%');
          continue;
        }
        break;
      }
      speedFactor = 1;

      function emitLayer() {
        var changed = false;
        flushFirstSlot = -1;
        fuzzSeed = 12345 + li * 7919; // her katmanda farklı desen (üst üste binip dikey çizgi yapmasın)
        var sk = job.skirt;
        if (sk && li < sk.layers && (sk.rings.length || (first && sk.brim.length))) {
          var wsk = first ? W.first : W.outer;
          // Etek, modelin dikişinin bekleneceği yere en yakın noktadan başlar (ve orada biter): etekten sonra
          // kafa tablanın öbür ucundaki dikişe boşuna gitmez
          var skNear = null;
          if (!first && S.seam !== 'nearest' && S.seam !== 'random' && slots.length && bySlot[slots[0]].length) {
            // ilk basılacak parçanın ilk adasının dış duvar dikişi
            var fp = bySlot[slots[0]][0], fpl = planOf(fp), ws0 = fpl && fpl[0] && fpl[0].wallSets && fpl[0].wallSets[0];
            if (ws0 && ws0.length) {
              var big0 = ws0[0], ba0 = 0; ws0.forEach(function (q) { var a3 = Math.abs(CL.Clipper.Area(q)); if (a3 > ba0) { ba0 = a3; big0 = q; } });
              var nr1 = lastSeam; if (prevSeams.length) nr1 = prevSeams[0];
              skNear = loopFrom(big0, S.seam === 'aligned' ? 'nearest' : S.seam, nr1, bedCx)[0];
            }
          }
          if (sk.rings.length) { out.push(';TYPE:Skirt'); emitLoops(sk.rings, first ? S.firstLayerSpeed : S.outerWallSpeed, wsk, h, T.SKIRT, first ? S.accelFirst : S.accelOuterWall, 1, skNear); }
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
        partS = layerS(S, p.ranges, Ly.z);
        // katman planı: paralel dilimlemede önceden hazırdır; yoksa burada bir kez hesaplanır (en kısa katman süresi tekrarında yeniden kullanılır)
        var plan = planOf(p);
        if (S.labelObjects) out.push('EXCLUDE_OBJECT_START NAME=' + p.label);
        plan.forEach(function (P) {
          var wallSets = P.wallSets;
          var wo = first ? W.first : W.outer, wi = first ? W.first : W.inner;
          if (spiral) { emitSpiral(wallSets[0] || [], wo); return; }
          // "bir ters bir düz": tek katmanlarda duvar yönü ters; 'order' modunda ayrıca önce dolgu, sonra duvarlar ters sırada
          var odd = !first && li % 2 === 1, altMode = S.alternateLayers || 'none';
          wallRev = odd && altMode !== 'none';
          // Adanın dikiş noktası önce dış duvar için seçilir; iç duvarlar da oradan başlar. Yoksa iç duvar kendi
          // "köşesini" seçip dış duvar başka yerden başlayınca her katmanda tablanın bir ucundan öbürüne boş gidilir.
          var groupSeam = function (o) {
            if (seamLi !== li) { prevSeams = curSeams; curSeams = []; seamLi = li; }
            var sm0 = S.seam === 'aligned' ? 'nearest' : S.seam, nr0 = [pos.x, pos.y];
            // ilk katman: temizleme çizgisinin bittiği yere (kafanın o anki yerine) en yakın noktadan başla; sonraki
            // katmanların hizalı dikişi de buna göre oluşur
            if (first) sm0 = 'nearest';
            else if (S.seam === 'aligned' || S.seam === 'corner') {
              // önceki katmanda bu konturun dikişine en yakın nokta (yoksa genel son dikiş)
              nr0 = lastSeam; var bd0 = Infinity, c0 = o[0];
              prevSeams.forEach(function (q) { var d = Math.hypot(q[0] - c0.X / SCALE, q[1] - c0.Y / SCALE); if (d < bd0) { bd0 = d; nr0 = q; } });
              if (prevSeams.length) { bd0 = Infinity; for (var k = 0; k < o.length; k += Math.max(1, Math.floor(o.length / 64))) prevSeams.forEach(function (q) { var d = Math.hypot(q[0] - o[k].X / SCALE, q[1] - o[k].Y / SCALE); if (d < bd0) { bd0 = d; nr0 = q; } }); }
            }
            var sp0 = loopFrom(o, sm0, nr0, bedCx);
            if (job.seamE) sp0 = seamPaint(sp0, job.seamE[li], job.seamB[li]);
            return sp0[0];
          };
          var emitWalls = function (revOrder) {
            var outerFirst = (S.wallOrder === 'outer-inner') !== revOrder;
            var groups = wallGroups(wallSets);
            groups.forEach(function (g) { g.seam = g.outer ? groupSeam(g.outer) : null; });
            var left = groups.slice();
            while (left.length) {
              var bi = 0, bd1 = Infinity;
              left.forEach(function (g, i) { var q = g.seam || (g.levels.find(function (l) { return l.length; }) || [[{ X: 0, Y: 0 }]])[0][0]; var qx = q.X !== undefined ? q.X / SCALE : q[0], qy = q.Y !== undefined ? q.Y / SCALE : q[1];
                var d = Math.hypot(qx - pos.x, qy - pos.y); if (d < bd1) { bd1 = d; bi = i; } });
              var g = left.splice(bi, 1)[0];
              islandSeam = g.seam;
              if (g.seam) curSeams.push(g.seam);
              var n0 = g.levels.length;
              for (var a = 0; a < n0; a++) { var lv = outerFirst ? a : n0 - 1 - a; if (g.levels[lv].length) emitWall(g.levels[lv], lv === 0, wo, wi); }
            }
            islandSeam = null;
          };
          var altOrder = odd && altMode === 'order';
          var fillFirst = altOrder || flushFirstSlot === p.slot; // renk değişiminden sonra yıkama dolguya
          if (!fillFirst) emitWalls(false);
          if (P.extraLoops && P.extraLoops.length) emitWall(P.extraLoops, false, wo, wi);
          emitFills();
          if (fillFirst) emitWalls(altOrder);
          wallRev = false;
          function emitFills() {
            var ws = first ? W.first : W.solid;
            if (P.solidNoTop.length) {
              out.push(first ? ';TYPE:Bottom surface' : ';TYPE:Internal solid infill');
              surfaceFill(P.solidNoTop, first ? S.bottomPattern : 'lines', ws, P.ang, spd(first ? S.firstLayerInfillSpeed : S.solidInfillSpeed), h, T.SOLID, first ? S.accelFirst : S.accelInfill, 1, P.solidLines, P.solidReg);
            }
            if (P.bridge.length) {
              out.push(';TYPE:Bridge');
              var bf = fil();
              setFan(0, num(bf.bridgeFan, 100));
              emitLinesJoined(P.bridgeLines, S.bridgeSpeed, W.solid, h, T.BRIDGE, S.accelInfill, S.bridgeFlow);
              setFan(0, fanPct(li));
            }
            if (P.topOnly.length) {
              out.push(';TYPE:Top surface');
              surfaceFill(P.topOnly, S.topPattern, W.top, P.topAng, spd(S.topSurfaceSpeed), h, T.TOP, S.accelTop, S.topFlow, P.topLines, P.topReg);
              if (P.irLines) {
                out.push(';TYPE:Ironing');
                emitLinesJoined(P.irLines, S.ironingSpeed, W.top, h, T.IRON, S.accelTop, S.ironingFlow / 100);
              }
            }
            P.sparse.forEach(function (it) { out.push(';TYPE:Sparse infill'); emitSparse(it.region, it.hMul || undefined, it.lines, it.reg); });
          }
        });
        var gaps = r.gaps;
        var ow = plan.filter(function (P) { return P.oneWall; });
        if (ow.length && gaps && gaps.length) {
          var owp = ow.map(function (P) { return P.oneWall.map(function (pp) { return pp.map(function (q) { return [q.X / SCALE, q.Y / SCALE]; }); }); });
          gaps = gaps.filter(function (g) { return !owp.some(function (pp) { return pip(pp, g[0][0], g[0][1]); }); });
        }
        if (gaps && gaps.length) {
          out.push(';TYPE:Gap infill');
          orderPolylines(gaps, [pos.x, pos.y]).forEach(function (g) { extrudeVarPath(g, spd(first ? S.firstLayerSpeed : S.gapFillSpeed), h, T.GAP, first ? S.accelFirst : S.accelInnerWall); });
        }
        partFlow = 1;
        if (S.labelObjects) out.push('EXCLUDE_OBJECT_END NAME=' + p.label);
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
      var wallRev = false, flushFirstSlot = -1;
      // bulanık yüzey için tekrarlanabilir rastgele sayı (aynı model hep aynı G-code'u versin)
      var fuzzSeed = 12345;
      function rnd() { fuzzSeed = (fuzzSeed * 1103515245 + 12345) & 0x7fffffff; return fuzzSeed / 0x7fffffff; }
      // Bulanık yüzey (Orca: fuzzy skin): dış duvar noktaları belli aralıklarla duvara dik rastgele kaydırılır
      function fuzzLoop(pts) {
        var t = num(S.fuzzyThickness, 0.3), pd = Math.max(0.1, num(S.fuzzyPointDist, 0.8)), out2 = [pts[0]], acc = 0;
        for (var i = 1; i < pts.length; i++) {
          var a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
          if (L < 1e-6) continue;
          var nx = -dy / L, ny = dx / L, s2 = pd - acc;
          while (s2 < L) { var o = (rnd() * 2 - 1) * t; out2.push([a[0] + dx * s2 / L + nx * o, a[1] + dy * s2 / L + ny * o]); s2 += pd; }
          acc = L - (s2 - pd);
        }
        out2.push(pts[pts.length - 1]);
        return out2;
      }
      function emitWall(paths, isOuter, wo, wi) {
        if (!paths.length) return;
        out.push(isOuter ? ';TYPE:Outer wall' : ';TYPE:Inner wall');
        var done = new Uint8Array(paths.length);
        var w = isOuter ? wo : wi, type = isOuter ? T.OUTER : T.INNER;
        var acc = first ? S.accelFirst : (isOuter ? S.accelOuterWall : S.accelInnerWall);
        var wallSp = spd(isOuter ? S.outerWallSpeed : S.innerWallSpeed), baseSp = wallSp;
        var smallLen = 2 * Math.PI * num(S.smallPerimeterThreshold, 0) * SCALE;
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
          if (islandSeam) { seam = 'nearest'; near = islandSeam; }
          else if (!isOuter) { seam = 'nearest'; near = [pos.x, pos.y]; }
          // küçük çevreler (delik, ince kıvrım): yavaş bas, köşeler ve daireler düzgün çıksın (Orca: small perimeters)
          baseSp = wallSp;
          if (smallLen > 0 && !first) {
            var per = 0, pb = paths[b];
            for (var q2 = 0; q2 < pb.length; q2++) { var qa = pb[q2], qb = pb[(q2 + 1) % pb.length]; per += Math.hypot(qb.X - qa.X, qb.Y - qa.Y); }
            if (per <= smallLen) baseSp = Math.max(S.minSpeedFloor || 20, wallSp * num(S.smallPerimeterSpeed, 100) / 100);
          }
          var pts = loopFrom(paths[b], seam, near, bedCx);
          if (job.seamE) pts = seamPaint(pts, job.seamE[li], job.seamB[li]);
          if (wallRev) pts.reverse(); // kapalı döngü: başlangıç (dikiş) noktası aynı kalır
          if (S.fuzzySkin && S.fuzzySkin !== 'none' && !first && (isOuter || S.fuzzySkin === 'all')) pts = fuzzLoop(pts);
          if (isOuter) lastSeam = pts[0];
          // çıkıntı sınıfları
          var cls = null, anyOv = false;
          if (S.overhangSlowdown && li > 0 && !first) {
            cls = [];
            for (var i = 1; i < pts.length; i++) { var c = overhangClass((pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2, w); cls.push(c); if (c) anyOv = true; }
            // Çıkıntıda yönü katman katman ters çevir (Orca: overhang reversal): kenar kıvrılması dengelenir
            if (anyOv && S.overhangReverse && li % 2 === 1) { pts.reverse(); cls.reverse(); }
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
      function emitSparse(region, hMul, pre, preReg) {
        var hh = h * (hMul || 1), PS = partS || S;
        var wsp = first ? W.first : W.sparse;
        var d = PS.infillDensity / 100;
        if (d <= 0) return;
        var sp = spd(first ? S.firstLayerInfillSpeed : PS.sparseInfillSpeed);
        var ac = first ? S.accelFirst : S.accelInfill;
        var pat = PS.infillPattern;
        var ls = pre !== undefined ? pre : sparseLines(region, hMul || 1, li, Ly.z, PS, W, first);
        if (pat === 'helix' || pat === 'golden' || pat === 'speed' || pat === 'lightning') {
          var polys = S.infillJoin && pat !== 'lightning' ? joinInRegion(ls || [], region, (wsp / d) * 2.5, preReg) : orderLines(ls || [], [pos.x, pos.y]);
          polys.forEach(function (p) { extrudePath(p, sp, wsp, hh, T.SPARSE, ac, 1); });
          return;
        }
        if (pat === 'gyroid' || pat === 'honeycomb' || pat === '3dhoneycomb' || pat === 'tpmsd') {
          var polys2 = pat === 'gyroid' ? gyroidFill(region, wsp / d, Ly.z) : pat === 'tpmsd' ? tpmsdFill(region, wsp / d, Ly.z)
            : honeycombFill(region, 2 * wsp / (Math.sqrt(3) * d), Ly.z, pat === '3dhoneycomb');
          orderPolylines(polys2, [pos.x, pos.y]).forEach(function (p) { extrudePath(p, sp, wsp, hh, T.SPARSE, ac, 1); });
        } else if (pat === 'concentric') {
          emitLoops(concentricFill(region, wsp / d), sp, wsp, hh, T.SPARSE, ac, 1);
        } else if (pat === 'grid' || pat === 'triangles' || pat === 'cubic' || pat === 'crosshatch') {
          emitLinesSeparate(ls, sp, wsp, hh, T.SPARSE, ac);
        } else { // doğrusal
          if (S.infillJoin) joinInRegion(ls, region, (wsp / d) * 2.5, preReg).forEach(function (p) { extrudePath(p, sp, wsp, hh, T.SPARSE, ac, 1); });
          else emitLinesJoined(ls, sp, wsp, hh, T.SPARSE, ac, 1);
        }
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
          // Destek ütüleme (Orca: support ironing): en üst arayüz katmanı az akışla düzlenir, üstüne gelen yüzey düzgün olur
          if (S.supportIroning && (li + 1 >= nL || !supports.iface[li + 1].length)) {
            var irs = offset(ifc, -0.2, false);
            if (irs.length) { out.push(';TYPE:Ironing'); emitLinesJoined(lineFill(irs, S.ironingSpacing, li % 2 ? 0 : 90), S.ironingSpeed, W.top, h, T.IRON, S.accelTop, S.ironingFlow / 100); }
          }
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
    header.push('; generated by K1MaxDilimleyici 2.31 on ' + now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate()) +
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
    // Renkler Creality Print'teki gibi büyük harfli #RRGGBB (CFS renk eşleştirmesi bu biçimi okur)
    var colHex = function (c) { c = String(c || '#FFFFFF').trim(); if (/^#[0-9a-f]{8}$/i.test(c)) c = c.slice(0, 7); if (/^#[0-9a-f]{3}$/i.test(c)) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]; return /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : '#FFFFFF'; };
    var filCols = fils.map(function (f) { return colHex(f.color); }), filTypes = fils.map(function (f) { return f.filamentType || 'PLA'; });
    header.push('; filament_colour = ' + filCols.join(';'));
    header.push('; first_layer_height = ' + S.firstLayerHeight);
    header.push('; layer_height = ' + S.layerHeight);
    header.push('; nozzle_temperature = ' + fils.map(function (f) { return f.nozzleTemp; }).join(','));
    header.push('; bed_temperature = ' + fils[job.firstSlot].bedTemp);
    header.push('; sparse_infill_density = ' + S.infillDensity + '%');
    header.push('; max_z_height = ' + f3(layers[nL - 1].z));
    header.push('');

    // Orca / Creality Print uyumlu ayar bloğu (yazıcı ve Fluidd/Moonraker dosya bilgisi buradan da okur)
    var cfgBlock = ['', '; CONFIG_BLOCK_START',
      '; default_filament_colour = ' + filCols.join(';'),
      '; default_filament_type = ' + filTypes.join(';'),
      '; filament_colour = ' + filCols.join(';'),
      '; filament_type = ' + filTypes.join(';'),
      '; filament_settings_id = ' + fils.map(function (f) { return '"' + String(f.name || f.filamentType || 'PLA').replace(/"/g, '') + '"'; }).join(';'),
      '; layer_height = ' + S.layerHeight,
      '; nozzle_diameter = ' + num(S.nozzleDiameter, 0.4),
      '; printer_model = Creality K1 Max',
      '; CONFIG_BLOCK_END', ''];
    return {
      gcode: header.join('\n') + body.join('\n') + '\n' + cfgBlock.join('\n'),
      preview: new Float32Array(preview),
      layerIndex: layerIndex,
      layerZ: layers.map(function (l) { return l.z; }),
      layerH: layers.map(function (l) { return l.h; }), adaptive: !!S.adaptiveActive,
      stats: { facets: Math.round(FACETS / Math.max(1, nL)), time: timeS, filamentMm: totMm, grams: totG, cost: totCost, layers: nL, toolChanges: stats.toolChanges, perSlot: perSlot, retracts: stats.retracts, combed: stats.combed,
        timeByType: Object.keys(stats.byType).reduce(function (o, k) { o[k] = Math.round(stats.byType[k] * S.timeFactor * 10) / 10; return o; }, {}) }
    };
  }

  // ---------------------------------------------------------------- ana giriş
  function slice(job, progress) {
    var g = sliceGen(job, progress), r = g.next();
    while (!r.done) { var q = r.value; if (q.kind === 'regions') q.parts.forEach(function (p) { processPart(p, q.layers, q.S, q.U); }); r = g.next(); }
    return r.value;
  }
  // Çok çekirdekli dilimleme: pool = { size, run(görevler) → Promise<sonuçlar> } (görevler runTask ile çözülür)
  function sliceParallel(job, progress, pool) {
    progress = progress || function () {};
    var g = sliceGen(job, progress), r = g.next();
    if (r.done) return Promise.resolve(r.value);
    var q = r.value, chain = Promise.resolve();
    q.parts.forEach(function (p) { chain = chain.then(function () { return processPartParallel(p, q.layers, q.S, q.U, pool, progress, p.name); }); });
    return chain.then(function () {
      var r2 = g.next();
      if (r2.done) return r2.value;
      return plansParallel(r2.value, pool, progress).then(function () { var r3 = g.next(); while (!r3.done) r3 = g.next(); return r3.value; });
    });
  }
  function* sliceGen(job, progress) {
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
      return { name: p.name || ('part' + i), label: 'part_' + i, slot: Math.max(0, Math.min(fils.length - 1, p.slot | 0)), mesh: indexMesh(p.positions), flowMul: +p.flowMul || 1,
        negative: p.role === 'negative', pos: p.paint ? p.positions : null, paint: p.paint || null, ranges: Array.isArray(p.ranges) && p.ranges.length ? p.ranges.map(function (r) { return { z0: +r.z0 || 0, z1: +r.z1 || 0, S: r.S || {} }; }) : null };
    });
    if (!parts.some(function (p) { return !p.negative; })) throw new Error('Dilimlenecek model yok (yalnızca negatif parça var).');
    if (!parts.length) throw new Error('Dilimlenecek model yok.');
    if (S.spiralVase && parts.length > 1) throw new Error('Vazo modu yalnızca tek parçalı modellerde çalışır.');
    var maxZ = Math.max.apply(null, parts.filter(function (p) { return !p.negative; }).map(function (p) { return p.mesh.maxZ; }));
    RES = Math.max(0, num(S.resolution, 0.0125));
    FILL_RULE = S.sliceMode === 'evenodd' ? CL.PolyFillType.pftEvenOdd : CL.PolyFillType.pftNonZero;
    SMOOTH = !!S.smoothCurves; FACETS = 0; POLYHOLE = !!S.polyholes;
    S.adaptiveActive = !!S.adaptiveLayers && !S.spiralVase && !job.calib;
    var layers = S.adaptiveActive ? makeAdaptiveLayers(S, parts, maxZ) : makeLayers(S, maxZ);
    S.spiralStart = Math.max(S.bottomLayers, 1);

    sliceParts(parts, layers, progress);

    // Negatif parçalar (Orca: negative part): kesitleri diğer parçalardan çıkarılır (delik, oyuk, pim yuvası, yazı oyma)
    var negs = parts.filter(function (p) { return p.negative; });
    if (negs.length) {
      parts = parts.filter(function (p) { return !p.negative; });
      for (var ln = 0; ln < layers.length; ln++) {
        var cutN = []; negs.forEach(function (q) { cutN = cutN.concat(q.outline[ln] || []); });
        if (cutN.length) parts.forEach(function (p) { if (p.outline[ln].length) p.outline[ln] = difference(p.outline[ln], cutN); });
      }
      parts.forEach(function (p, i) { p.label = 'part_' + i; });
    }

    // Boyama verisi: dikiş noktaları, destek zorlama/engelleme alanları, renk bölgeleri (sanal parçalar)
    var seamE = null, seamB = null, supPaint = null;
    parts.slice().forEach(function (p) {
      var pt = p.paint; if (!pt) return;
      var addPts = function (dst, segs) { segs.forEach(function (list, li) { list.forEach(function (sg) { dst[li].push(sg[0], sg[1], [(sg[0][0] + sg[1][0]) / 2, (sg[0][1] + sg[1][1]) / 2]); }); }); };
      if (pt.seam) {
        if (!seamE) { seamE = layers.map(function () { return []; }); seamB = layers.map(function () { return []; }); }
        addPts(seamE, paintSegs(p.pos, pt.seam, 1, layers)); addPts(seamB, paintSegs(p.pos, pt.seam, 2, layers));
      }
      if (pt.support) {
        if (!supPaint) supPaint = { enf: layers.map(function () { return []; }), blk: layers.map(function () { return []; }) };
        [[1, supPaint.enf], [2, supPaint.blk]].forEach(function (vk) {
          // katmanın alt ve üst düzlemi arasındaki üçgen dilimlerinin izdüşümü
          paintFlat(p.pos, pt.support, vk[0], layers, 0, false).forEach(function (list, li) { list.forEach(function (tri) { vk[1][li].push(tri); }); });
        });
      }
      if (pt.color) {
        var vals = {}; for (var t = 0; t < pt.color.length; t++) if (pt.color[t]) vals[pt.color[t]] = 1;
        var depth = Math.max(0.4, num(S.paintDepth, 1.2));
        Object.keys(vals).map(Number).sort().forEach(function (v) {
          var segs = paintSegs(p.pos, pt.color, v, layers), flat = paintFlat(p.pos, pt.color, v, layers, depth, true);
          var vp = { name: p.name + ' (boya ' + v + ')', label: p.label, slot: Math.max(0, Math.min(fils.length - 1, v - 1)), flowMul: p.flowMul, ranges: p.ranges, outline: [] };
          var any = false;
          for (var li = 0; li < layers.length; li++) {
            var reg = [];
            if (segs[li].length) reg = offsetOpen(chainSegs(segs[li]), depth);
            if (flat[li].length) reg = reg.concat(union(flat[li]));
            var R = reg.length && p.outline[li].length ? intersect(p.outline[li], union(reg)) : [];
            if (R.length) { p.outline[li] = difference(p.outline[li], R); any = true; }
            vp.outline.push(R);
          }
          if (any) parts.splice(parts.indexOf(p) + 1, 0, vp);
        });
      }
      p.pos = null;
    });

    // Yazdırılamayan çıkıntıyı koniye çevir (Orca: make overhang printable): üst katmanın, eşik açısına göre
    // küçültülmüş hâli alt katmana eklenir; çıkıntının altı destek gerekmeden basılabilen bir koni olur
    if (S.makeOverhangPrintable) {
      var tanO = Math.tan(Math.max(20, Math.min(80, num(S.makeOverhangAngle, 55))) * Math.PI / 180);
      parts.forEach(function (p) {
        for (var lo = layers.length - 2; lo >= 0; lo--) {
          var upO = p.outline[lo + 1]; if (!upO || !upO.length || !p.outline[lo].length) continue;
          var shr = offset(upO, -layers[lo].h / tanO, false);
          if (shr.length) p.outline[lo] = union(p.outline[lo].concat(shr));
        }
      });
    }

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
    // İlk katmanın katı dolgu açısı: taramanın bir ucu temizleme çizgisinin bittiği yere yakın olsun (dolgu oradan
    // başlar, ilk katmanda tablanın öbür ucuna boşuna gidilmez). Katmanlar yine sırayla 90° dönerek değişir.
    S.solidParity = 0;
    if (U[0] && U[0].length) {
      var pq = Array.isArray(S.purgeEnd) ? S.purgeEnd : [0, 0], bestPar = 0, bestD = Infinity;
      [0, 1].forEach(function (par) {
        var a = (S.solidAngle + (par ? 90 : 0)) * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a), lo = Infinity, hi = -Infinity, plo = null, phi = null;
        U[0].forEach(function (pth) { pth.forEach(function (v) { var x = v.X / SCALE, y = v.Y / SCALE, d = x * nx + y * ny; if (d < lo) { lo = d; plo = [x, y]; } if (d > hi) { hi = d; phi = [x, y]; } }); });
        var dd = Math.min(Math.hypot(plo[0] - pq[0], plo[1] - pq[1]), Math.hypot(phi[0] - pq[0], phi[1] - pq[1]));
        if (dd < bestD - 1) { bestD = dd; bestPar = par; }
      });
      S.solidParity = bestPar;
    }
    // bölgeler: eşzamanlı sürüm burada hesaplar, paralel sürüm (sliceParallel) yardımcı iş parçacıklarına dağıtır
    yield { kind: 'regions', parts: parts, layers: layers, S: S, U: U };
    // katmanlar arası dolgu hesapları (sırayla): yıldırım dalları, uyarlanabilir kübik seviyeleri
    if (S.infillDensity > 0 && !S.spiralVase) {
      if (S.infillPattern === 'lightning') { progress(0.6, 'Yıldırım dolgu dalları'); parts.forEach(function (p) { computeLightning(p, layers, S); }); }
      if (S.infillPattern === 'adaptivecubic') { progress(0.6, 'Uyarlanabilir kübik dolgu'); parts.forEach(function (p) { computeAdaptive(p, layers, S); }); }
    }
    parts.forEach(function (p, i) {
      var bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      p.outline.forEach(function (o) { if (o.length) { var b = bboxOf(o); bb.minX = Math.min(bb.minX, b.minX / SCALE); bb.minY = Math.min(bb.minY, b.minY / SCALE); bb.maxX = Math.max(bb.maxX, b.maxX / SCALE); bb.maxY = Math.max(bb.maxY, b.maxY / SCALE); } });
      p.bbox = bb;
      progress(0.25 + 0.35 * (i + 1) / parts.length, 'Duvarlar ve dolgu (' + p.name + ')');
    });

    progress(0.62, 'Destekler hesaplanıyor');
    var supports = computeSupports(U, layers, S, { x: S.bedX, y: S.bedY }, supPaint);

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
      var maxFlush = S.purgeVolume;
      if (job.flush && S.flushTarget === 'tower') job.flush.forEach(function (row) { (row || []).forEach(function (v) { if (+v > maxFlush) maxFlush = +v; }); });
      var size = Math.max(S.towerWidth, Math.sqrt(maxFlush * 1.2 / S.layerHeight));
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

    var job2 = { seamE: seamE, seamB: seamB, calib: job.calib || null, flush: job.flush || null, S: S, fils: fils, multi: multi, firstSlot: firstSlot, supportSlot: supportSlot, tower: tower, thumbnails: job.thumbnails || (job.thumbnail ? [job.thumbnail] : null),
      U: U, skirt: skirtLoops(S, U[0], supports.sup[0].concat(supports.iface[0]), U) };
    // katman planları: paralel sürüm burada yardımcılara hesaplatır; eşzamanlı sürüm G-code yazılırken hesaplar
    yield { kind: 'plans', parts: parts, layers: layers, S: S, U: U, job: job2 };
    var res = buildGcode(job2, layers, parts, supports, progress);
    res.stats.usedSlots = Object.keys(used).map(Number);
    return res;
  }

  // Etek ve kenarlık halkaları (ilk katman)
  function skirtLoops(S, U0, sup0, Uall) {
    var w = S.W.first;
    var brim = [], rings = [];
    var base = union(U0.concat(sup0));
    if (S.brimWidth > 0 && S.brimType === 'ears') {
      // Fare kulağı kenarlık (Orca: mouse ear brim): yalnızca keskin dış köşelere yuvarlak kenarlık; sökmesi kolay
      var ears = [], maxA = num(S.brimEarAngle, 125) * Math.PI / 180;
      islandsOf(U0).forEach(function (isl) {
        var o = CL.Clipper.CleanPolygon(isl[0], 0.05 * SCALE), n = o.length, ccw = CL.Clipper.Orientation(o);
        for (var i = 0; i < n; i++) {
          var a = o[(i - 1 + n) % n], b = o[i], c = o[(i + 1) % n];
          var v1x = a.X - b.X, v1y = a.Y - b.Y, v2x = c.X - b.X, v2y = c.Y - b.Y, l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
          if (l1 < 0.3 * SCALE || l2 < 0.3 * SCALE) continue;
          var ang = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2))));
          var cross = (b.X - a.X) * (c.Y - b.Y) - (b.Y - a.Y) * (c.X - b.X), convex = ccw ? cross > 0 : cross < 0;
          if (convex && ang < maxA) {
            var pc = [], R = S.brimWidth; for (var k = 0; k < 32; k++) { var t = k / 32 * Math.PI * 2; pc.push({ X: Math.round(b.X + R * SCALE * Math.cos(t)), Y: Math.round(b.Y + R * SCALE * Math.sin(t)) }); }
            ears.push(pc);
          }
        }
      });
      if (ears.length) {
        var earReg = difference(union(ears), offset(U0, S.brimGap, false));
        concentricFill(earReg, w).forEach(function (p) { brim.push(p); });
        base = union(base.concat(offset(earReg, 0, false)));
      }
    } else if (S.brimWidth > 0) {
      var nb = Math.max(1, Math.round(S.brimWidth / w));
      var outers = islandsOf(U0).map(function (isl) { return isl[0]; });
      for (var bi = nb; bi >= 1; bi--) offset(outers, S.brimGap + w * (bi - 0.5), false).forEach(function (p) { brim.push(p); });
      base = offset(base, S.brimGap + S.brimWidth, false);
    }
    // Rüzgar kalkanı (Orca: draft shield): modelin tüm yüksekliği boyunca, kapladığı alanın çevresinde ince bir duvar
    if (S.draftShield && Uall && Uall.length) {
      var allA = base.slice(); for (var li2 = 0; li2 < Uall.length; li2 += 2) allA = allA.concat(Uall[li2]);
      var shield = union(offset(union(allA), Math.max(3, S.skirtDistance), true));
      for (var sj = Math.max(1, S.skirtLoops) - 1; sj >= 0; sj--) offset(shield, w * sj, true).forEach(function (p) { rings.push(p); });
      return { brim: brim, rings: rings, layers: Uall.length };
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

  var api = { slice: slice, sliceParallel: sliceParallel, runTask: runTask, T: T, PV: PV, fmtTime: fmtTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.K1Slicer = api;
})(typeof self !== 'undefined' ? self : this);
