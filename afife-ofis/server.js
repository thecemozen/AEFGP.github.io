#!/usr/bin/env node
// Afife Ofisi — yerel sunucu.
// Ofis arayüzünü 127.0.0.1:4747'de açar, görevleri Genel Müdür üzerinden doğru ajana
// devreder ve her ajanı kendi klasöründe Claude Code (claude -p) ile çalıştırır.
// Bağımlılık yok: Node 18+ yeterli.  Çalıştır:  node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const KOK = __dirname;
const PORT = Number(process.env.PORT || 4747);
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const NTFY = process.env.NTFY_KONU || '';          // ör. afife-ofis-8x2k (telefona bildirim, isteğe bağlı)
const ofisYukle = () => JSON.parse(fs.readFileSync(path.join(KOK, 'ofis.json'), 'utf8'));
let ofis = ofisYukle();
fs.watchFile(path.join(KOK, 'ofis.json'), () => { try { ofis = ofisYukle(); yayinla({ tip: 'ofis' }); } catch {} });

const ajanBul = id => ofis.ajanlar.find(a => a.id === id);
const simdi = () => new Date().toISOString();
fs.mkdirSync(path.join(KOK, 'kayit'), { recursive: true });
const kaydet = o => fs.appendFileSync(path.join(KOK, 'kayit', 'gorevler.jsonl'), JSON.stringify({ t: simdi(), ...o }) + '\n');

// ---------- Canlı olay akışı (SSE) ----------
const dinleyiciler = new Set();
function yayinla(olay) {
  const veri = `data: ${JSON.stringify({ t: simdi(), ...olay })}\n\n`;
  for (const res of dinleyiciler) res.write(veri);
}

// ---------- Claude Code çağrısı ----------
// Görev metni stdin'den gider: Windows'ta (cmd.exe) Türkçe karakter ve tırnaklar argümanda bozulmasın.
const WIN = process.platform === 'win32';
const tirnak = a => (WIN && /[\s&|<>^"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
// Bir ajan kendi klasörü yerine başka bir sistemin klasöründe çalışabilir (ör. Video Editörü →
// ../video-kurgu). O zaman oranın CLAUDE.md ve becerileri yüklenir; ajanın kendi kuralları
// (ve @ ile içe aktardıkları) görev metninin başına eklenir.
const ajanKlasoru = ajan => path.join(KOK, 'ajanlar', ajan.id);
function kuralMetni(ajan) {
  const dosya = path.join(ajanKlasoru(ajan), 'CLAUDE.md');
  if (!fs.existsSync(dosya)) return '';
  return fs.readFileSync(dosya, 'utf8').replace(/^@(\S+)\s*$/gm, (_, y) => {
    try { return fs.readFileSync(path.resolve(ajanKlasoru(ajan), y), 'utf8'); } catch { return ''; }
  });
}

function claudeCalistir(ajan, istem) {
  return new Promise((resolve, reject) => {
    let cwd = ajanKlasoru(ajan);
    if (ajan.calismaKlasoru) {
      cwd = path.resolve(KOK, ajan.calismaKlasoru);
      if (!fs.existsSync(cwd)) return reject(new Error(`${ajan.ad} için çalışma klasörü bulunamadı: ${cwd}`));
      istem = `# Ofis kuralların (Afife Ofisi · ${ajan.ad})\n\n${kuralMetni(ajan)}\n\n---\n\n# Görev\n\n${istem}`;
    }
    const args = ['-p', '--output-format', 'json', '--model', ajan.model || 'sonnet',
      '--permission-mode', 'acceptEdits'];
    if (ajan.araclar) args.push('--allowedTools', ajan.araclar);
    for (const k of ajan.ekKlasorler || []) args.push('--add-dir', path.resolve(KOK, k));
    if (ajan.calismaKlasoru) args.push('--add-dir', ajanKlasoru(ajan));
    const cp = spawn(CLAUDE, WIN ? args.map(tirnak) : args, {
      cwd, env: process.env, shell: WIN, windowsHide: true,
    });
    let out = '', err = '';
    cp.stdout.setEncoding('utf8'); cp.stderr.setEncoding('utf8');
    cp.stdout.on('data', d => (out += d));
    cp.stderr.on('data', d => (err += d));
    cp.on('error', e => reject(new Error(`claude başlatılamadı (${e.message}). Claude Code kurulu mu?`)));
    cp.on('close', kod => {
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error(j.result || 'Claude hata döndü'));
        resolve({ metin: j.result || '', maliyet: j.total_cost_usd });
      } catch {
        if (kod === 0 && out.trim()) return resolve({ metin: out.trim() });
        reject(new Error((err || out || `çıkış kodu ${kod}`).slice(0, 400)));
      }
    });
    cp.stdin.end(istem, 'utf8');
  });
}

// Genel Müdür yönlendirmesi; ayrıştırılamazsa anahtar kelimeye düşer.
function anahtarlaYonlendir(metin) {
  const m = metin.toLocaleLowerCase('tr');
  let en = null, puan = 0;
  for (const a of ofis.ajanlar) {
    const p = (a.anahtar || []).reduce((s, k) => s + (m.includes(k) ? k.length : 0), 0);
    if (p > puan) { puan = p; en = a; }
  }
  return en ? { ajan: en.id, gorev: metin, neden: 'anahtar kelime eşleşmesi' } : null;
}

async function yonlendir(metin) {
  const gm = ajanBul('genel-mudur');
  const liste = ofis.ajanlar.filter(a => a.id !== 'genel-mudur')
    .map(a => `- ${a.id}: ${a.ad} — ${a.aciklama}`).join('\n');
  const istem = `Ofisteki çalışanlar:\n${liste}\n\nCem'den gelen iş:\n"""${metin}"""\n\nBu işi kime devredersin? Sadece JSON.`;
  try {
    const { metin: cevap } = await claudeCalistir(gm, istem);
    const j = JSON.parse((cevap.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    if (j.ajan && ajanBul(j.ajan)) return j;
  } catch (e) { yayinla({ tip: 'not', ajan: 'genel-mudur', mesaj: 'Yönlendirme hatası, anahtar kelimeye geçiyorum: ' + e.message }); }
  return anahtarlaYonlendir(metin) || { ajan: 'strateji-kocu', gorev: metin, neden: 'varsayılan' };
}

function sonCikti(ajanId, once) {
  const dir = path.join(KOK, 'ajanlar', ajanId, 'ciktilar');
  try {
    return fs.readdirSync(dir).filter(f => !f.startsWith('.'))
      .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter(x => x.m >= once).sort((a, b) => b.m - a.m)[0]?.f || null;
  } catch { return null; }
}

function bildir(baslik, mesaj) {
  if (!NTFY) return;
  fetch(`https://ntfy.sh/${encodeURIComponent(NTFY)}`, { method: 'POST', headers: { Title: baslik }, body: mesaj })
    .catch(() => {});
}

// ---------- İş kuyruğu (aynı anda tek iş) ----------
const kuyruk = [];
let calisiyor = false;
function isEkle(is) { kuyruk.push(is); yayinla({ tip: 'kuyruk', id: is.id, sira: kuyruk.length }); isle(); }
async function isle() {
  if (calisiyor || !kuyruk.length) return;
  calisiyor = true;
  const is = kuyruk.shift();
  try { await isYap(is); } catch (e) { yayinla({ tip: 'hata', id: is.id, mesaj: e.message }); kaydet({ id: is.id, hata: e.message }); }
  calisiyor = false;
  isle();
}

async function isYap({ id, metin, kime, kaynak }) {
  kaydet({ id, metin, kime, kaynak });
  let hedef = kime && kime !== 'genel-mudur' ? { ajan: kime, gorev: metin } : null;
  if (!hedef) {
    yayinla({ tip: 'dusunuyor', id, ajan: 'genel-mudur', mesaj: 'Bu iş kime gider, düşünüyorum…' });
    hedef = await yonlendir(metin);
    yayinla({ tip: 'devir', id, kimden: 'genel-mudur', ajan: hedef.ajan, mesaj: hedef.neden || '' });
  }
  const ajan = ajanBul(hedef.ajan);
  yayinla({ tip: 'aldi', id, ajan: ajan.id, mesaj: 'Görevi aldım: ' + kisalt(hedef.gorev, 90) });
  const bas = Date.now() - 1000;
  const bugun = new Date().toISOString().slice(0, 10);
  const ciktiKlasoru = ajan.calismaKlasoru ? path.join(ajanKlasoru(ajan), 'ciktilar') : 'ciktilar/';
  const istem = `${hedef.gorev}\n\n(Bugün: ${bugun}. Raporunu ${ciktiKlasoru} klasörüne ${bugun}-kisa-ad.md olarak yaz.)`;
  yayinla({ tip: 'calisiyor', id, ajan: ajan.id });
  const { metin: sonuc, maliyet } = await claudeCalistir(ajan, istem);
  const dosya = sonCikti(ajan.id, bas);
  kaydet({ id, ajan: ajan.id, dosya, maliyet });
  yayinla({ tip: 'bitti', id, ajan: ajan.id, mesaj: kisalt(sonuc, 160), dosya: dosya ? `/cikti/${ajan.id}/${encodeURIComponent(dosya)}` : null, maliyet });
  bildir(`${ajan.ad}: hazır ✓`, kisalt(sonuc, 300));
  if (hedef.sonraki && ajanBul(hedef.sonraki) && dosya) {
    isEkle({ id: id + '-2', kime: hedef.sonraki, kaynak: 'devir',
      metin: `${ajan.ad} şu raporu hazırladı:\n\n${fs.readFileSync(path.join(ajanKlasoru(ajan), 'ciktilar', dosya), 'utf8').slice(0, 20000)}\n\n---\nŞimdi şu işin senin payına düşen kısmını yap: ${metin}` });
  }
}
const kisalt = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- Zamanlanmış işler ----------
const GUNLER = ['paz', 'pzt', 'sal', 'car', 'per', 'cum', 'cmt'];
const sonCalisma = {};
setInterval(() => {
  const d = new Date();
  const saat = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const yarin = new Date(d); yarin.setDate(d.getDate() + 1);
  for (const a of ofis.ajanlar) {
    const z = a.zamanlama;
    if (!z || z.saat !== saat) continue;
    if (z.gunler && !z.gunler.includes(GUNLER[d.getDay()])) continue;
    if (z.ayinSonGunu && yarin.getDate() !== 1) continue;
    const anahtar = a.id + d.toDateString() + saat;
    if (sonCalisma[a.id] === anahtar) continue;
    sonCalisma[a.id] = anahtar;
    isEkle({ id: 'z' + Date.now(), kime: a.id, metin: z.gorev, kaynak: 'zamanlama' });
  }
}, 20 * 1000);

// ---------- HTTP ----------
const TUR = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
function dosyaGonder(res, p) {
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('yok'); }
    res.writeHead(200, { 'Content-Type': TUR[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

const sunucu = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);

  if (p === '/' || p === '/index.html') return dosyaGonder(res, path.join(KOK, 'index.html'));
  if (p === '/ofis.json') return dosyaGonder(res, path.join(KOK, 'ofis.json'));

  if (p === '/api/durum') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ canli: true, kuyruk: kuyruk.length, calisiyor, ntfy: !!NTFY }));
  }
  if (p === '/api/olaylar') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': merhaba\n\n');
    dinleyiciler.add(res);
    const nabiz = setInterval(() => res.write(': nabiz\n\n'), 25000);
    req.on('close', () => { clearInterval(nabiz); dinleyiciler.delete(res); });
    return;
  }
  if (p === '/api/gorev' && req.method === 'POST') {
    let govde = '';
    req.on('data', d => { govde += d; if (govde.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const { metin, kime } = JSON.parse(govde);
        if (!metin || !metin.trim()) throw new Error('Görev metni boş');
        if (kime && !ajanBul(kime)) throw new Error('Böyle bir çalışan yok: ' + kime);
        const id = 'g' + Date.now();
        isEkle({ id, metin: metin.trim(), kime, kaynak: 'arayuz' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ hata: e.message })); }
    });
    return;
  }
  const m = p.match(/^\/cikti\/([a-z0-9-]+)\/([^/]+)$/);
  if (m && ajanBul(m[1])) {
    const tam = path.join(KOK, 'ajanlar', m[1], 'ciktilar', path.basename(m[2]));
    return dosyaGonder(res, tam);
  }
  if (p.startsWith('/api/ciktilar/')) {
    const id = p.split('/').pop();
    if (!ajanBul(id)) { res.writeHead(404); return res.end('[]'); }
    const dir = path.join(KOK, 'ajanlar', id, 'ciktilar');
    const liste = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => !f.startsWith('.')).sort().reverse().slice(0, 10) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(liste.map(f => ({ ad: f, yol: `/cikti/${id}/${encodeURIComponent(f)}` }))));
  }
  res.writeHead(404); res.end('yok');
});
sunucu.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\n  Ofis zaten açık görünüyor → http://127.0.0.1:${PORT}\n  (Bu pencereyi kapatabilirsiniz.)\n`);
    if (process.argv.includes('--ac')) tarayiciAc();
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  throw e;
});
function tarayiciAc() {
  const url = `http://127.0.0.1:${PORT}`;
  const [k, a] = WIN ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(k, a, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
}
sunucu.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Afife Ofisi açık → http://127.0.0.1:${PORT}\n  ${ofis.ajanlar.length} çalışan · Claude: ${CLAUDE}${NTFY ? ' · bildirim: ntfy/' + NTFY : ''}\n  Kapatmak için bu pencereyi kapatın.\n`);
  if (process.argv.includes('--ac')) tarayiciAc();
});
