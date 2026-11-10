/*
 * 3MF okuyucu: Orca/Bambu (model_settings.config) ve PrusaSlicer (Slic3r_PE_model.config) dosyalarındaki
 * parça başına ekstrüder atamalarını da okur. Boyama (paint) ile renklendirilmiş üçgenler desteklenmez.
 * Döndürür: { parts: [{ name, positions: Float32Array, slot }], warnings: [] }
 */

// ---------------------------------------------------------------- ZIP
export async function unzip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('3MF (zip) yapısı okunamadı');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), comLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const lName = dv.getUint16(local + 26, true), lExtra = dv.getUint16(local + 28, true);
    const start = local + 30 + lName + lExtra;
    files[name.replace(/^\//, '')] = { method, data: u8.subarray(start, start + csize) };
    p += 46 + nameLen + extraLen + comLen;
  }
  return {
    names: Object.keys(files),
    async text(name) {
      const f = files[name.replace(/^\//, '')] || files[Object.keys(files).find(k => k.toLowerCase() === name.replace(/^\//, '').toLowerCase())];
      if (!f) return null;
      if (f.method === 0) return dec.decode(f.data);
      if (f.method !== 8) throw new Error('Desteklenmeyen sıkıştırma: ' + f.method);
      if (typeof DecompressionStream === 'undefined') throw new Error('Bu tarayıcı 3MF açamıyor (DecompressionStream yok). Chrome/WebView güncelleyin.');
      const ds = new DecompressionStream('deflate-raw');
      const out = new Response(new Blob([f.data]).stream().pipeThrough(ds));
      return dec.decode(await out.arrayBuffer());
    },
  };
}

// ---------------------------------------------------------------- yardımcılar
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function parseTf(s) {
  if (!s) return IDENT.slice();
  const a = s.trim().split(/\s+/).map(Number);
  return a.length === 12 && a.every(isFinite) ? a : IDENT.slice();
}
// 3MF matrisi satır vektörü ile çarpılır: p' = p · M
function mul(a, b) { // önce a, sonra b
  const r = new Array(12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  for (let j = 0; j < 3; j++) r[9 + j] = a[9] * b[j] + a[10] * b[3 + j] + a[11] * b[6 + j] + b[9 + j];
  return r;
}
const els = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
const attr = (el, name) => el.getAttribute(name) ?? el.getAttributeNS('http://schemas.microsoft.com/3dmanufacturing/production/2015/06', name.replace(/^p:/, ''));

export function meshOf(objEl) {
  const meshEl = els(objEl, 'mesh')[0];
  if (!meshEl) return null;
  const vs = els(meshEl, 'vertex');
  const v = new Float64Array(vs.length * 3);
  vs.forEach((e, i) => { v[i * 3] = +e.getAttribute('x'); v[i * 3 + 1] = +e.getAttribute('y'); v[i * 3 + 2] = +e.getAttribute('z'); });
  const ts = els(meshEl, 'triangle');
  const t = new Uint32Array(ts.length * 3);
  let painted = false;
  ts.forEach((e, i) => {
    t[i * 3] = +e.getAttribute('v1'); t[i * 3 + 1] = +e.getAttribute('v2'); t[i * 3 + 2] = +e.getAttribute('v3');
    if (!painted && (e.getAttribute('paint_color') || e.getAttribute('slic3rpe:mmu_segmentation'))) painted = true;
  });
  return { v, t, painted };
}

function toPositions(mesh, tf, scale, triFrom = 0, triTo = mesh.t.length / 3 - 1) {
  const n = triTo - triFrom + 1;
  const out = new Float32Array(n * 9);
  let o = 0;
  for (let i = triFrom; i <= triTo; i++) {
    for (let k = 0; k < 3; k++) {
      const vi = mesh.t[i * 3 + k] * 3;
      const x = mesh.v[vi], y = mesh.v[vi + 1], z = mesh.v[vi + 2];
      out[o++] = (x * tf[0] + y * tf[3] + z * tf[6] + tf[9]) * scale;
      out[o++] = (x * tf[1] + y * tf[4] + z * tf[7] + tf[10]) * scale;
      out[o++] = (x * tf[2] + y * tf[5] + z * tf[8] + tf[11]) * scale;
    }
  }
  return out;
}

const UNITS = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

// ---------------------------------------------------------------- ana fonksiyon
export async function load3MF(buffer) {
  const zip = await unzip(buffer);
  const warnings = [];
  const parser = new DOMParser();
  const docs = {};
  async function doc(path) {
    path = (path || '3D/3dmodel.model').replace(/^\//, '');
    if (!docs[path]) {
      const txt = await zip.text(path);
      if (txt == null) throw new Error('3MF içinde bulunamadı: ' + path);
      docs[path] = parser.parseFromString(txt, 'application/xml');
    }
    return docs[path];
  }
  let mainPath = '3D/3dmodel.model';
  const rels = await zip.text('_rels/.rels');
  if (rels) {
    const m = rels.match(/Target="([^"]+\.model)"/i);
    if (m) mainPath = m[1].replace(/^\//, '');
  }
  const main = await doc(mainPath);
  const modelEl = els(main, 'model')[0];
  const scale = UNITS[(modelEl && modelEl.getAttribute('unit')) || 'millimeter'] || 1;

  // Ekstrüder atamaları
  const orca = {}; // objectId -> { ext, name, parts: { partId: { ext, name } } }
  const orcaTxt = await zip.text('Metadata/model_settings.config');
  if (orcaTxt) {
    const d = parser.parseFromString(orcaTxt, 'application/xml');
    els(d, 'object').forEach(o => {
      const meta = (el, key) => { const m = Array.from(el.children).find(c => c.localName === 'metadata' && c.getAttribute('key') === key); return m ? m.getAttribute('value') : null; };
      const rec = { ext: +meta(o, 'extruder') || 0, name: meta(o, 'name'), parts: {} };
      Array.from(o.children).filter(c => c.localName === 'part').forEach(pe => {
        rec.parts[pe.getAttribute('id')] = { ext: +meta(pe, 'extruder') || 0, name: meta(pe, 'name'), subtype: pe.getAttribute('subtype') };
      });
      orca[o.getAttribute('id')] = rec;
    });
  }
  const prusa = {}; // objectId -> [{ first, last, ext, name }]
  const prusaTxt = await zip.text('Metadata/Slic3r_PE_model.config');
  if (prusaTxt) {
    const d = parser.parseFromString(prusaTxt, 'application/xml');
    els(d, 'object').forEach(o => {
      const vols = [];
      let objExt = 0;
      Array.from(o.children).forEach(c => {
        if (c.localName === 'metadata' && c.getAttribute('key') === 'extruder') objExt = +c.getAttribute('value') || 0;
        if (c.localName === 'volume') {
          const md = {};
          Array.from(c.children).forEach(m => { if (m.localName === 'metadata') md[m.getAttribute('key')] = m.getAttribute('value'); });
          vols.push({ first: +c.getAttribute('firstid'), last: +c.getAttribute('lastid'), ext: +md.extruder || objExt, name: md.name, modifier: md.modifier === '1' });
        }
      });
      prusa[o.getAttribute('id')] = vols;
    });
  }

  const parts = [];
  let painted = false;
  async function objectById(path, id) {
    const d = await doc(path);
    return els(d, 'object').find(o => o.getAttribute('id') === String(id)) || null;
  }
  // nesneyi (alt bileşenleriyle) parçalara aç
  async function expand(path, id, tf, ctx, depth) {
    if (depth > 8) return;
    const obj = await objectById(path, id);
    if (!obj) { warnings.push('Nesne bulunamadı: ' + id); return; }
    const mesh = meshOf(obj);
    if (mesh && mesh.t.length) {
      if (mesh.painted) painted = true;
      const vols = ctx.top && prusa[ctx.top];
      if (vols && vols.length && path === mainPath) {
        vols.forEach(vo => {
          if (vo.modifier) return;
          parts.push({ name: vo.name || ctx.name, positions: toPositions(mesh, tf, scale, vo.first, vo.last), ext: vo.ext || ctx.ext });
        });
      } else {
        parts.push({ name: ctx.partName || obj.getAttribute('name') || ctx.name, positions: toPositions(mesh, tf, scale), ext: ctx.partExt || ctx.ext });
      }
      return;
    }
    const comps = els(obj, 'component');
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      const cPath = attr(c, 'p:path') || c.getAttribute('p:path') || path;
      const pinfo = ctx.depth0 ? (orca[ctx.top] && orca[ctx.top].parts[String(i + 1)]) : null;
      if (pinfo && pinfo.subtype && pinfo.subtype !== 'normal_part') continue; // değiştirici / negatif hacim
      await expand(cPath, c.getAttribute('objectid'), mul(parseTf(c.getAttribute('transform')), tf),
        Object.assign({}, ctx, { depth0: false, partName: pinfo && pinfo.name, partExt: pinfo && pinfo.ext }), depth + 1);
    }
  }
  const items = els(main, 'item');
  for (const it of items) {
    const id = it.getAttribute('objectid');
    if (it.getAttribute('printable') === '0') continue;
    const o = orca[id] || {};
    const objEl = await objectById(mainPath, id);
    await expand(mainPath, id, parseTf(it.getAttribute('transform')),
      { top: id, ext: o.ext || 0, name: o.name || (objEl && objEl.getAttribute('name')) || ('nesne ' + id), depth0: true }, 0);
  }
  if (!parts.length) throw new Error('3MF içinde basılabilir model bulunamadı');
  if (painted) warnings.push('Bu 3MF boyama ile renklendirilmiş; boyamalar desteklenmiyor, parçalar tek renk yüklendi.');
  return { parts: parts.map(p => ({ name: p.name, positions: p.positions, slot: Math.max(0, Math.min(3, (p.ext || 1) - 1)) })), warnings };
}
