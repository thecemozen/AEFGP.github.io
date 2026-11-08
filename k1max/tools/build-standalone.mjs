// Tek dosyalık, internetsiz çalışan K1 Max Dilimleyici üretir.
// Çıktı: dist/K1MaxDilimleyici.html (bilgisayar) ve ../android/app/assets/index.html (APK)
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const nm = path.join(here, 'node_modules');
const read = (p) => fs.readFileSync(p, 'utf8');

const bundle = await build({
  entryPoints: [path.join(app, 'app.js')],
  bundle: true, minify: true, format: 'iife', target: 'es2018', write: false,
  alias: { three: path.join(nm, 'three/build/three.module.js') },
  plugins: [{
    name: 'three-addons',
    setup(b) {
      b.onResolve({ filter: /^three\/addons\// }, a => ({ path: path.join(nm, 'three/examples/jsm', a.path.slice('three/addons/'.length)) }));
    },
  }],
});
const appJs = bundle.outputFiles[0].text;

const clipper = read(path.join(nm, 'clipper-lib/clipper.js'));
const core = read(path.join(app, 'slicer-core.js'));
const workerJs = read(path.join(app, 'slicer-worker.js'));
const workerSrc = clipper + '\n' + core + '\n' + workerJs;
const css = read(path.join(app, 'style.css'));
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(app, 'icons/icon-192.png')).toString('base64');

let html = read(path.join(app, 'index.html'));
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
html = html
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="(icon|apple-touch-icon)" href="[^"]*">/g, `<link rel="$1" href="${icon}">`)
  .replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="app.js"></script>', () =>
    `<script>window.K1_STANDALONE=true;window.K1_WORKER_SRC=${JSON.stringify(workerSrc).replace(/<\/script/gi, '<\\/script')};</script>\n` +
    `<script>${safe(clipper)}</script>\n<script>${safe(core)}</script>\n<script>${safe(appJs)}</script>`);

const outs = [path.join(app, 'dist/K1MaxDilimleyici.html'), path.join(app, 'android/app/assets/index.html')];
for (const o of outs) { fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, html); }
console.log('yazıldı:', outs.map(o => path.relative(process.cwd(), o)).join(', '), (html.length / 1024).toFixed(0) + ' KB');
