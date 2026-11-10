/*
 * Proje kaydetme / açma (3MF).
 * Kaydedilen dosya standart bir 3MF'tir: OrcaSlicer, PrusaSlicer, Bambu Studio da açar (parçalar ve
 * renk yuvaları Orca biçiminde, model_settings.config). Ek olarak Metadata/k1max_project.json içinde
 * nesnelerin konumu, dönüşü, ölçeği, parça yuvaları, akış çarpanları ve ayarlar saklanır;
 * bu dilimleyici dosyayı açınca her şeyi aynen geri kurar.
 */
import { unzip, meshOf } from './threemf.js';

// ---------------------------------------------------------------- ZIP yazıcı
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflate(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const out = new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw')));
    return new Uint8Array(await out.arrayBuffer());
  } catch (e) { return null; }
}
export async function zip(files) { // files: [{ name, data: Uint8Array | string }]
  const enc = new TextEncoder(), chunks = [], central = [];
  let off = 0;
  for (const f of files) {
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(raw);
    let data = raw, method = 0;
    if (raw.length > 256) { const d = await deflate(raw); if (d && d.length < raw.length) { data = d; method = 8; } }
    const name = enc.encode(f.name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cSize, true); end.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'model/3mf' });
}

// ---------------------------------------------------------------- yardımcılar
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => { const r = Math.round(v * 1e5) / 1e5; return Object.is(r, -0) ? '0' : String(r); };

// üçgen çorbasından (x,y,z,...) indeksli ağ: aynı köşeleri birleştir
function indexMesh(pos) {
  const map = new Map(), verts = [], tris = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length; i += 3) {
    const k = num(pos[i]) + ' ' + num(pos[i + 1]) + ' ' + num(pos[i + 2]);
    let id = map.get(k);
    if (id === undefined) { id = verts.length; map.set(k, id); verts.push(k); }
    tris[i / 3] = id;
  }
  return { verts, tris };
}
function meshXml(pos) {
  const { verts, tris } = indexMesh(pos);
  const out = ['<mesh><vertices>'];
  for (const v of verts) { const [x, y, z] = v.split(' '); out.push(`<vertex x="${x}" y="${y}" z="${z}"/>`); }
  out.push('</vertices><triangles>');
  for (let i = 0; i < tris.length; i += 3) out.push(`<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`);
  out.push('</triangles></mesh>');
  return out.join('');
}
// nesne dönüşümü (ölçek → Z dönüşü → öteleme) 3MF satır-vektör matrisi olarak
function objTransform(o) {
  const c = Math.cos(o.rotZ), s = Math.sin(o.rotZ);
  return [c * o.sx, s * o.sx, 0, -s * o.sy, c * o.sy, 0, 0, 0, o.sz, o.x, o.y, 0].map(num).join(' ');
}

/**
 * Proje 3MF'sini oluşturur.
 * objects: [{ name, x, y, rotZ, sx, sy, sz, origin }]
 * parts:   [{ name, positions (nesnenin yerel koordinatlarında), slot, flowMul, obj (objects içindeki sıra) }]
 * settings: serbest JSON (ayarlar), app: { name, version }
 */
export async function writeProject({ objects, parts, settings, app }) {
  let id = 0;
  const res = [], build = [], cfg = [], meta = { k1maxProject: 1, app, objects: [], parts: [], settings };
  objects.forEach((o, oi) => {
    const own = parts.map((p, pi) => ({ p, pi })).filter(x => x.p.obj === oi);
    if (!own.length) return;
    const mo = meta.objects.length, comps = [], cfgParts = [];
    own.forEach(({ p, pi }, k) => {
      const mid = ++id;
      res.push(`<object id="${mid}" type="model" name="${esc(p.name)}">${meshXml(p.positions)}</object>`);
      comps.push(`<component objectid="${mid}"/>`);
      cfgParts.push(`<part id="${k + 1}" subtype="normal_part"><metadata key="name" value="${esc(p.name)}"/><metadata key="extruder" value="${(p.slot || 0) + 1}"/></part>`);
      meta.parts.push({ name: p.name, slot: p.slot || 0, flowMul: p.flowMul || 1, obj: mo, meshId: mid });
    });
    const gid = ++id;
    res.push(`<object id="${gid}" type="model" name="${esc(o.name)}"><components>${comps.join('')}</components></object>`);
    build.push(`<item objectid="${gid}" transform="${objTransform(o)}" printable="1"/>`);
    cfg.push(`<object id="${gid}"><metadata key="name" value="${esc(o.name)}"/><metadata key="extruder" value="${(own[0].p.slot || 0) + 1}"/>${cfgParts.join('')}</object>`);
    meta.objects.push({ name: o.name, x: o.x, y: o.y, rotZ: o.rotZ, sx: o.sx, sy: o.sy, sz: o.sz, origin: o.origin, groupId: gid });
  });
  const model = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="tr-TR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    `<metadata name="Application">${esc(app.name + ' ' + app.version)}</metadata><metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>` +
    `<resources>${res.join('')}</resources><build>${build.join('')}</build></model>`;
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/><Default Extension="json" ContentType="application/json"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: model },
    { name: 'Metadata/model_settings.config', data: `<?xml version="1.0" encoding="UTF-8"?>\n<config>${cfg.join('')}</config>` },
    { name: 'Metadata/k1max_project.json', data: JSON.stringify(meta) },
  ]);
}

/** Bu dilimleyicinin proje dosyası ise içeriğini döndürür, değilse null. */
export async function readProject(buffer) {
  const z = await unzip(buffer);
  const txt = await z.text('Metadata/k1max_project.json');
  if (!txt) return null;
  const meta = JSON.parse(txt);
  if (!meta || meta.k1maxProject !== 1) return null;
  const doc = new DOMParser().parseFromString(await z.text('3D/3dmodel.model'), 'application/xml');
  const byId = new Map(Array.from(doc.getElementsByTagNameNS('*', 'object')).map(e => [e.getAttribute('id'), e]));
  const parts = [];
  for (const p of meta.parts) {
    const el = byId.get(String(p.meshId)); const m = el && meshOf(el);
    if (!m) throw new Error('projede parça ağı eksik: ' + p.name);
    const pos = new Float32Array(m.t.length * 3);
    for (let i = 0; i < m.t.length; i++) { const v = m.t[i] * 3; pos[i * 3] = m.v[v]; pos[i * 3 + 1] = m.v[v + 1]; pos[i * 3 + 2] = m.v[v + 2]; }
    parts.push({ name: p.name, positions: pos, slot: p.slot | 0, flowMul: +p.flowMul || 1, obj: p.obj | 0 });
  }
  return { objects: meta.objects, parts, settings: meta.settings || null, app: meta.app };
}
