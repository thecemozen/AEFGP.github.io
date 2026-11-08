/* Dilimlemeyi arayüzü dondurmadan arka planda çalıştırır. */
if (!self.K1Slicer) importScripts('https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js', 'slicer-core.js');

self.onmessage = function (ev) {
  var msg = ev.data;
  if (msg.type !== 'slice') return;
  try {
    var t0 = Date.now();
    var res = self.K1Slicer.slice(msg.job, function (p, text) {
      self.postMessage({ type: 'progress', p: p, text: text });
    });
    res.stats.ms = Date.now() - t0;
    self.postMessage({ type: 'done', result: res }, [res.preview.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) });
  }
};
