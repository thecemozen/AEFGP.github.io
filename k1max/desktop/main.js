// K1 Max Dilimleyici - Windows masaüstü kabuğu (Electron).
// Dilimleyicinin tamamı app/index.html içindedir (Android ile aynı tek dosya) ve internetsiz çalışır.
// Masaüstüne özgü: yazıcıya doğrudan bağlantı (tarayıcı CORS kısıtı yok), STL/3MF ile "Birlikte aç",
// kaydetme penceresi, tek pencere.
const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const MODEL_RE = /\.(stl|3mf)$/i;
let win = null;
let pending = []; // pencere hazır olmadan gelen dosyalar
let ready = false;

// Çok büyük modeller (milyonlarca üçgen) için JavaScript bellek sınırını yükselt; ekran kartını kara listeye
// takılsa da kullan ve iki ekran kartlı dizüstülerde güçlü olanı seç
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (_e, argv) => {
    openFiles(filesFrom(argv));
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

function filesFrom(argv) {
  return argv.slice(1).filter(a => MODEL_RE.test(a) && fs.existsSync(a));
}

function openFiles(list) {
  if (!list.length) return;
  if (!ready) { pending.push(...list); return; }
  // Android'deki gibi: dosyayı base64 olarak sayfaya ver (tek seferde bir dosya; ilk dosya plakayı değiştirir)
  for (const f of list.slice(0, 1)) {
    try {
      const b64 = fs.readFileSync(f).toString('base64');
      win.webContents.executeJavaScript(`window.k1LoadBase64 && window.k1LoadBase64(${JSON.stringify(path.basename(f))}, ${JSON.stringify(b64)})`);
    } catch (e) { dialog.showErrorBox('Dosya açılamadı', String(e.message || e)); }
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600, show: false,
    title: 'K1 Max Dilimleyici', backgroundColor: '#1d2125',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      // Yerel ağdaki yazıcıya (Moonraker) doğrudan istek: tarayıcıdaki CORS engeli masaüstünde gereksiz
      webSecurity: false,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    ready = true;
    const list = pending; pending = []; openFiles(list);
  });
  // Bağlantılar varsayılan tarayıcıda açılsın
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  // F12: geliştirici araçları, F5/Ctrl+R: yeniden yükle
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') win.webContents.toggleDevTools();
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) win.webContents.reload();
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  // İndirmeler (G-code, 3MF proje, profil): kaydetme penceresi, varsayılan klasör Belgeler\K1Max
  win.webContents.session.on('will-download', (_e, item) => {
    const dir = path.join(app.getPath('documents'), 'K1Max');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* yok say */ }
    item.setSaveDialogOptions({ title: 'Kaydet', defaultPath: path.join(dir, item.getFilename()) });
  });
  win.on('closed', () => { win = null; });
}

app.setAppUserModelId('com.thecemozen.k1max');
app.whenReady().then(() => {
  pending.push(...filesFrom(process.argv));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
