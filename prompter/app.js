'use strict';

const $ = (id) => document.getElementById(id);

/* ---------- Kalıcı ayarlar ---------- */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* depolama kapalı olabilir */ }
  },
};

const DEFAULT_TEXT =
  'Merhaba! Bu senin prompter metnin.\n\n' +
  'Alttaki ☰ düğmesine dokunup kendi metnini yaz ya da yapıştır.\n\n' +
  'Kırmızı düğmeye basınca kayıt başlar ve metin kendiliğinden akar. ' +
  'Hızı sağdaki + ve − ile ayarlayabilirsin.\n\n' +
  'Metin kameranın hemen yanında durduğu için gözlerin hep objektife bakar.';

const cfg = Object.assign(
  { speed: 5, font: 28, height: 32, countdown: 3, mirror: false, facing: 'user' },
  store.get('prompter.cfg', {})
);
let text = store.get('prompter.text', DEFAULT_TEXT);
const saveCfg = () => store.set('prompter.cfg', cfg);

const cam = $('cam'), prompter = $('prompter'), script = $('script');
const root = document.documentElement;

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- Metin kaydırma ---------- */
let offset = 0, playing = false, lastT = 0;

const maxOffset = () => Math.max(0, script.offsetHeight - prompter.clientHeight * 0.3);
const pxPerSec = () => cfg.speed * cfg.font * 0.12;

function render() {
  offset = Math.min(Math.max(0, offset), maxOffset());
  script.style.transform = `translateY(${-offset}px)`;
}

function tick(t) {
  if (!playing) return;
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  offset += pxPerSec() * dt;
  if (offset >= maxOffset()) { render(); setPlaying(false); return; }
  render();
  requestAnimationFrame(tick);
}

function setPlaying(on) {
  if (on && offset >= maxOffset()) offset = 0;
  playing = on;
  $('icoPlay').toggleAttribute('hidden', on);
  $('icoPause').toggleAttribute('hidden', !on);
  $('btnPlay').setAttribute('aria-label', on ? 'Metni duraklat' : 'Metni oynat');
  if (on) { lastT = performance.now(); requestAnimationFrame(tick); }
  syncWakeLock();
}

function applyCfg() {
  root.style.setProperty('--font', cfg.font + 'px');
  root.style.setProperty('--ph', cfg.height + 'vh');
  prompter.classList.toggle('mirror', cfg.mirror);
  $('speedOut').value = cfg.speed;
  render();
}

function setSpeed(v) {
  cfg.speed = Math.min(15, Math.max(1, v));
  $('speedOut').value = cfg.speed;
  saveCfg();
}

function setText(v) {
  text = v;
  script.textContent = v.trim();
  store.set('prompter.text', v);
  offset = 0;
  render();
}

/* Dokun: oynat/duraklat — sürükle: ileri/geri */
{
  let startY = 0, startOffset = 0, moved = false, active = false;
  prompter.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#grip')) return;
    active = true; moved = false; startY = e.clientY; startOffset = offset;
    prompter.setPointerCapture(e.pointerId);
  });
  prompter.addEventListener('pointermove', (e) => {
    if (!active) return;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dy) < 8) return;
    moved = true;
    offset = startOffset - dy;
    render();
  });
  const end = (e) => {
    if (!active) return;
    active = false;
    if (!moved && e.type === 'pointerup') setPlaying(!playing);
    else lastT = performance.now();
  };
  prompter.addEventListener('pointerup', end);
  prompter.addEventListener('pointercancel', end);
}

/* Alt çizgiyi sürükleyerek metin alanını boyutlandır */
{
  const grip = $('grip');
  let active = false;
  grip.addEventListener('pointerdown', (e) => { active = true; grip.setPointerCapture(e.pointerId); e.stopPropagation(); });
  grip.addEventListener('pointermove', (e) => {
    if (!active) return;
    cfg.height = Math.round(Math.min(70, Math.max(14, (e.clientY / innerHeight) * 100)));
    root.style.setProperty('--ph', cfg.height + 'vh');
    render();
  });
  const end = () => { if (active) { active = false; saveCfg(); } };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

/* ---------- Kamera ---------- */
let stream = null, starting = false;

function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

async function startCamera() {
  if (starting) return;
  starting = true;
  stopStream();
  const video = { facingMode: cfg.facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  const audio = { echoCancellation: true, noiseSuppression: true };
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('unsupported');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    } catch (err) {
      // Mikrofon yoksa/izin verilmediyse yalnızca görüntüyle dene
      stream = await navigator.mediaDevices.getUserMedia({ video });
      toast('Mikrofona erişilemedi; kayıt sessiz olacak.');
    }
    cam.srcObject = stream;
    const settings = stream.getVideoTracks()[0].getSettings();
    cam.classList.toggle('front', (settings.facingMode || cfg.facing) === 'user');
    $('noCam').hidden = true;
    $('btnRec').disabled = false;
    setupZoom();
  } catch (err) {
    stream = null;
    cam.srcObject = null;
    $('noCam').hidden = false;
    $('btnRec').disabled = true;
    $('noCamMsg').textContent =
      err && err.message === 'unsupported'
        ? 'Bu tarayıcı kamerayı desteklemiyor. Prompter yine de çalışır.'
        : 'Kamera açılamadı. Tarayıcı izinlerinden kameraya ve mikrofona izin ver. Prompter yine de çalışır.';
  } finally {
    starting = false;
  }
}

function setupZoom() {
  const track = stream && stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  const row = $('zoomRow'), s = $('sZoom');
  if (!caps.zoom) { row.hidden = true; return; }
  row.hidden = false;
  s.min = caps.zoom.min; s.max = caps.zoom.max; s.step = caps.zoom.step || 0.1;
  s.value = track.getSettings().zoom || caps.zoom.min;
  $('oZoom').value = Number(s.value).toFixed(1) + '×';
}

$('sZoom').addEventListener('input', (e) => {
  const track = stream && stream.getVideoTracks()[0];
  if (!track) return;
  const zoom = Number(e.target.value);
  $('oZoom').value = zoom.toFixed(1) + '×';
  track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
});

$('flip').addEventListener('click', () => {
  if (recorder) return;
  cfg.facing = cfg.facing === 'user' ? 'environment' : 'user';
  saveCfg();
  startCamera();
});
$('retryCam').addEventListener('click', startCamera);

/* ---------- Kayıt ---------- */
let recorder = null, chunks = [], recStart = 0, recTimer = 0, counting = false, resultUrl = null, resultFile = null;

function pickMime() {
  const types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return types.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

const pad = (n) => String(n).padStart(2, '0');

function runCountdown(seconds) {
  return new Promise((resolve) => {
    const el = $('countdown');
    if (!seconds) return resolve(true);
    counting = true;
    let n = seconds;
    el.textContent = n;
    el.hidden = false;
    const done = (ok) => { clearInterval(iv); el.hidden = true; el.onclick = null; counting = false; resolve(ok); };
    const iv = setInterval(() => { n -= 1; if (n <= 0) done(true); else el.textContent = n; }, 1000);
    el.onclick = () => done(false);   // dokununca iptal
  });
}

async function startRecording() {
  if (!stream || recorder || counting) return;
  if (typeof MediaRecorder === 'undefined') { toast('Bu tarayıcı video kaydını desteklemiyor.'); return; }
  setPlaying(false);
  if (!(await runCountdown(cfg.countdown))) return;
  if (!stream) return;

  const mimeType = pickMime();
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  } catch {
    recorder = new MediaRecorder(stream);
  }
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = finishRecording;
  recorder.start(1000);

  recStart = Date.now();
  $('recTime').textContent = '00:00';
  $('recBadge').hidden = false;
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $('recTime').textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }, 500);
  $('btnRec').classList.add('on');
  $('btnRec').setAttribute('aria-label', 'Kaydı durdur');
  $('flip').disabled = true;
  setPlaying(true);
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

function finishRecording() {
  const type = (recorder.mimeType || 'video/webm').split(';')[0];
  recorder = null;
  clearInterval(recTimer);
  $('recBadge').hidden = true;
  $('btnRec').classList.remove('on');
  $('btnRec').setAttribute('aria-label', 'Kaydı başlat');
  $('flip').disabled = false;
  setPlaying(false);

  const blob = new Blob(chunks, { type });
  chunks = [];
  if (!blob.size) { toast('Kayıt boş çıktı, tekrar dene.'); return; }

  const d = new Date();
  const name = `prompter-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
  resultFile = new File([blob], name, { type });
  resultUrl = URL.createObjectURL(blob);
  $('resVideo').src = resultUrl;
  savedUri = null;
  if (bridge) {
    $('resSave').removeAttribute('href');
    $('resSave').textContent = 'Galeriye kaydet';
    $('resShare').hidden = false;
  } else {
    $('resSave').href = resultUrl;
    $('resSave').download = name;
    $('resShare').hidden = !(navigator.canShare && navigator.canShare({ files: [resultFile] }));
  }
  $('result').hidden = false;
}

/* Android uygulaması içinde: videoyu parça parça yerel tarafa aktarıp galeriye yaz */
const bridge = window.AndroidBridge || null;
let savedUri = null, saving = false;

function readChunkBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function saveToGallery() {
  if (savedUri) return savedUri;
  if (saving || !resultFile) return null;
  saving = true;
  const file = resultFile, CH = 3 * 512 * 1024;
  try {
    if (!bridge.begin(file.name, file.type)) throw new Error('begin');
    for (let i = 0; i < file.size; i += CH) {
      if (!bridge.append(await readChunkBase64(file.slice(i, i + CH)))) throw new Error('append');
      toast(`Kaydediliyor… %${Math.min(100, Math.round(((i + CH) / file.size) * 100))}`, 60000);
    }
    savedUri = bridge.end() || null;
    if (!savedUri) throw new Error('end');
    toast('Galeriye kaydedildi (Filmler › Prompter).');
    $('resSave').textContent = 'Kaydedildi ✓';
    return savedUri;
  } catch {
    try { bridge.abort(); } catch { /* yok say */ }
    toast('Kaydedilemedi. Depolama iznini ve boş alanı kontrol et.');
    return null;
  } finally {
    saving = false;
  }
}

function closeResult() {
  $('result').hidden = true;
  $('resVideo').pause();
  $('resVideo').removeAttribute('src');
  $('resVideo').load();
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null; resultFile = null; savedUri = null;
}

function discardResult() {
  if (savedUri || confirm('Bu kayıt silinsin mi? Kaydetmediysen geri getirilemez.')) closeResult();
}

$('btnRec').addEventListener('click', () => (recorder ? stopRecording() : startRecording()));
$('resSave').addEventListener('click', (e) => {
  if (bridge) { e.preventDefault(); saveToGallery(); }
  else toast('İndirilenler klasörüne kaydediliyor…');
});
$('resShare').addEventListener('click', async () => {
  if (bridge) {
    const uri = await saveToGallery();
    if (uri) bridge.share(uri);
    return;
  }
  try { await navigator.share({ files: [resultFile] }); } catch { /* kullanıcı vazgeçti */ }
});
$('resDiscard').addEventListener('click', () => {
  if (savedUri) { closeResult(); return; }
  discardResult();
});

/* ---------- Alt çubuk ---------- */
$('btnPlay').addEventListener('click', () => setPlaying(!playing));
$('btnRewind').addEventListener('click', () => { offset = 0; render(); });
$('faster').addEventListener('click', () => setSpeed(cfg.speed + 1));
$('slower').addEventListener('click', () => setSpeed(cfg.speed - 1));

/* ---------- Metin düzenleyici ---------- */
const edText = $('edText');
const updateCount = () => {
  const words = edText.value.trim() ? edText.value.trim().split(/\s+/).length : 0;
  $('edCount').textContent = words ? `${words} kelime · ~${Math.max(1, Math.round(words / 130))} dk` : '';
};
$('btnEdit').addEventListener('click', () => {
  setPlaying(false);
  edText.value = text;
  updateCount();
  $('editor').hidden = false;
});
edText.addEventListener('input', updateCount);
$('edDone').addEventListener('click', () => { setText(edText.value); $('editor').hidden = true; });
$('edClear').addEventListener('click', () => {
  if (!edText.value || confirm('Metnin tamamı silinsin mi?')) { edText.value = ''; updateCount(); edText.focus(); }
});
$('edPaste').addEventListener('click', async () => {
  try {
    const clip = bridge ? bridge.readClipboard() : await navigator.clipboard.readText();
    if (!clip) { toast('Pano boş.'); return; }
    edText.setRangeText(clip, edText.selectionStart, edText.selectionEnd, 'end');
    updateCount();
  } catch {
    toast('Panoya erişilemedi. Metin kutusuna uzun basıp “Yapıştır”ı seç.');
  }
});

/* ---------- Ayarlar ---------- */
function openSettings() {
  $('sSpeed').value = cfg.speed;   $('oSpeed').value = cfg.speed;
  $('sFont').value = cfg.font;     $('oFont').value = cfg.font + ' px';
  $('sCount').value = String(cfg.countdown);
  $('sMirror').checked = cfg.mirror;
  $('settings').hidden = false;
}
$('btnSettings').addEventListener('click', openSettings);
$('setDone').addEventListener('click', () => { $('settings').hidden = true; });
$('sSpeed').addEventListener('input', (e) => { setSpeed(Number(e.target.value)); $('oSpeed').value = cfg.speed; });
$('sFont').addEventListener('input', (e) => {
  // Yazı boyutu değişince okunan yer kaymasın
  const ratio = script.offsetHeight ? offset / script.offsetHeight : 0;
  cfg.font = Number(e.target.value);
  $('oFont').value = cfg.font + ' px';
  root.style.setProperty('--font', cfg.font + 'px');
  offset = ratio * script.offsetHeight;
  render(); saveCfg();
});
$('sCount').addEventListener('change', (e) => { cfg.countdown = Number(e.target.value); saveCfg(); });
$('sMirror').addEventListener('change', (e) => { cfg.mirror = e.target.checked; applyCfg(); saveCfg(); });

/* ---------- Klavye / Bluetooth kumanda ---------- */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('textarea, input, select')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setSpeed(cfg.speed + 1);
  else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setSpeed(cfg.speed - 1);
  else if (e.key === 'Home') { offset = 0; render(); }
});

/* ---------- Ekranı açık tut ---------- */
let wakeLock = null;
async function syncWakeLock() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    if (!wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* pil tasarrufu modunda reddedilebilir */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  syncWakeLock();
  const dead = !stream || stream.getVideoTracks().every((t) => t.readyState === 'ended');
  if (dead && !recorder) startCamera();
});
addEventListener('resize', render);

/* ---------- Başlat ---------- */
script.textContent = text.trim();
applyCfg();
startCamera();
syncWakeLock();

/* Android geri tuşu: açık paneli kapat; kapatacak bir şey yoksa false döner ve uygulama kapanır */
window.onAndroidBack = () => {
  if (!$('countdown').hidden) { $('countdown').click(); return true; }
  if (!$('editor').hidden) { $('edDone').click(); return true; }
  if (!$('settings').hidden) { $('settings').hidden = true; return true; }
  if (!$('result').hidden) { discardResult(); return true; }
  if (recorder) { stopRecording(); return true; }
  return false;
};

if (!bridge && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
