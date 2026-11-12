/* Dilimlemeyi arayüzü dondurmadan arka planda çalıştırır.
 * Çok çekirdekli işlemcilerde ağır aşamalar (duvarlar, dolgu, üst/alt yüzeyler) aynı betiği çalıştıran
 * yardımcı iş parçacıklarına dağıtılır. Yardımcı açılamazsa (eski tarayıcı) tek iş parçacığında devam eder. */
if (!self.K1Slicer) importScripts('https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js', 'slicer-core.js');

// Yardımcılarla konuşma kanalları (sayfa tarafından açılıp MessagePort olarak verilir)
function makePool(ports) {
  if (!ports || ports.length < 2) return false;
  var seq = 0, waiting = {}, next = 0;
  ports.forEach(function (port) {
    port.onmessage = function (ev) {
      var m = ev.data, cb = waiting[m.id]; if (!cb) return;
      delete waiting[m.id];
      if (m.error) cb.reject(new Error(m.error)); else cb.resolve(m.res);
    };
  });
  return {
    size: ports.length,
    run: function (tasks) {
      return Promise.all(tasks.map(function (t) {
        return new Promise(function (resolve, reject) {
          var id = ++seq; waiting[id] = { resolve: resolve, reject: reject };
          ports[next++ % ports.length].postMessage({ id: id, task: t });
        });
      }));
    },
    close: function () { ports.forEach(function (p) { try { p.close(); } catch (e) { /* yok */ } }); },
  };
}

self.onmessage = function (ev) {
  var msg = ev.data;
  if (msg.type === 'port') { // yardımcı iş parçacığı: dilimleme iş parçacığından gelen görevleri çöz
    var port = ev.ports[0];
    port.onmessage = function (e2) {
      var m = e2.data;
      try { port.postMessage({ id: m.id, res: self.K1Slicer.runTask(m.task) }); }
      catch (err) { port.postMessage({ id: m.id, error: err && err.message ? err.message : String(err) }); }
    };
    return;
  }
  if (msg.type !== 'slice') return;
  var t0 = Date.now();
  var progress = function (p, text) { self.postMessage({ type: 'progress', p: p, text: text }); };
  var done = function (res) {
    if (p && p.close) p.close();
    res.stats.ms = Date.now() - t0;
    res.stats.threads = p && p.size ? p.size : 1;
    self.postMessage({ type: 'done', result: res }, [res.preview.buffer]);
  };
  var fail = function (e) { self.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) }); };
  var p = msg.parallel === false ? false : makePool(msg.ports);
  try {
    if (p) {
      self.K1Slicer.sliceParallel(msg.job, progress, p).then(done, function (e) {
        // yardımcılarda sorun olursa tek iş parçacığıyla yeniden dene
        try { p = false; done(self.K1Slicer.slice(msg.job, progress)); } catch (e2) { fail(e2); }
      });
    } else done(self.K1Slicer.slice(msg.job, progress));
  } catch (e) { fail(e); }
};
