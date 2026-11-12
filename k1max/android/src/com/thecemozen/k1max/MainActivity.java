package com.thecemozen.k1max;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.StrictMode;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * K1 Max Dilimleyici - Android kabuğu.
 * Dilimleyicinin tamamı assets/index.html içindedir ve internet olmadan çalışır.
 * Bu sınıf yalnızca dosya seçme, G-code kaydetme ve paylaşma işlerini Android'e bağlar.
 */
public class MainActivity extends Activity {
    private static final int PICK_FILE = 1;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private boolean pageReady = false;
    private Intent pendingIntent;
    private android.content.SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("k1max", MODE_PRIVATE);
        // Çökme olursa nedenini kaydet: sonraki açılışta kullanıcıya gösterilir
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override public void uncaughtException(Thread t, Throwable e) {
                try {
                    java.io.StringWriter sw = new java.io.StringWriter();
                    e.printStackTrace(new java.io.PrintWriter(sw));
                    String st = sw.toString();
                    prefs.edit().putString("lastCrash", "Uygulama hatası (" + t.getName() + "):\n" + st.substring(0, Math.min(3000, st.length()))).commit();
                } catch (Throwable ignored) { }
                if (prev != null) prev.uncaughtException(t, e);
            }
        });
        // Android 7-9'da paylaşılan dosya için file:// adresine izin ver
        StrictMode.setVmPolicy(new StrictMode.VmPolicy.Builder().build());

        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#1f9d55"));

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setBuiltInZoomControls(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (pendingIntent != null) { handleIntent(pendingIntent); pendingIntent = null; }
            }
            // API 26+: WebView'in çizim süreci (çoğunlukla bellek yetersizliğinden) ölürse uygulama kapanmasın,
            // nedeni kaydedilip etkinlik yeniden açılsın. (API 23'e karşı derlendiği için @Override yok.)
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                prefs.edit().putString("lastCrash", "Önizleme/çizim süreci kapandı (büyük ihtimalle bellek yetersiz kaldı). "
                    + "Daha küçük bir model deneyin ya da diğer uygulamaları kapatın.").commit();
                try { ((android.view.ViewGroup) view.getParent()).removeView(view); view.destroy(); } catch (Throwable ignored) { }
                recreate();
                return true;
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    return true;
                }
                return false;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                // STL'in MIME türü telefonlarda tutarsız, bu yüzden tüm dosyalar gösterilir
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                // "Aç" / "Nesne ekle": birden çok dosya seçilebilsin
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                boolean json = false;
                for (String a : params.getAcceptTypes()) if (a != null && a.contains("json")) json = true;
                try {
                    startActivityForResult(Intent.createChooser(i, json ? "Profil seç" : "Model dosyalarını seç"), PICK_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl("file:///android_asset/index.html");
        pendingIntent = getIntent();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (pageReady) handleIntent(intent); else pendingIntent = intent;
    }

    /** Dosya yöneticisinden gelen STL'i sayfaya aktarır. */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String tab = intent.getStringExtra("k1tab");
        if (tab != null) { web.evaluateJavascript("window.k1OpenTab&&k1OpenTab(" + jsString(tab) + ")", null); return; }
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return;
        try {
            byte[] data = readAll(getContentResolver().openInputStream(uri));
            String name = displayName(uri);
            String b64 = Base64.encodeToString(data, Base64.NO_WRAP);
            web.evaluateJavascript("window.k1LoadBase64(" + jsString(name) + ",'" + b64 + "')", null);
        } catch (Exception e) {
            toastJs("Dosya açılamadı: " + e.getMessage());
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == PICK_FILE && fileCallback != null) {
            Uri[] result = null;
            if (res == RESULT_OK && data != null) {
                android.content.ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    result = new Uri[clip.getItemCount()];
                    for (int k = 0; k < result.length; k++) result[k] = clip.getItemAt(k).getUri();
                } else if (data.getData() != null) result = new Uri[]{ data.getData() };
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        // Önizleme / Ayarlar sekmesindeyken geri tuşu Model sekmesine döner
        web.evaluateJavascript("(function(){var t=document.body.dataset.tab;if(t&&t!=='model'){document.querySelector('.tabs [data-tab=model]').click();return 'handled';}return 'exit';})()",
            new ValueCallback<String>() {
                @Override public void onReceiveValue(String v) {
                    if (v == null || !v.contains("handled")) finish();
                }
            });
    }

    // ------------------------------------------------------------------ JS köprüsü
    private class Bridge {
        // ---- kalıcı ayarlar (WebView'in yerel deposu file:// sayfalarda güvenilir değil)
        @JavascriptInterface public String storeGet(String key) { return prefs.getString("s_" + key, null); }
        @JavascriptInterface public void storeSet(String key, String value) { prefs.edit().putString("s_" + key, value).apply(); }
        @JavascriptInterface public void storeRemove(String key) { prefs.edit().remove("s_" + key).apply(); }
        /** Son çökme kaydını döndürür ve siler (yoksa null). */
        @JavascriptInterface public String lastCrash() {
            String c = prefs.getString("lastCrash", null);
            if (c != null) prefs.edit().remove("lastCrash").apply();
            return c;
        }

        // ---- büyük veri (G-code) parça parça: tek seferde koca bir metin köprüden geçmesin
        @JavascriptInterface public boolean blobBegin(String id) {
            File f = blobFile(id); if (f.exists()) f.delete();
            try { return f.createNewFile(); } catch (Exception e) { return false; }
        }
        @JavascriptInterface public boolean blobAppend(String id, String chunk) {
            try (FileOutputStream os = new FileOutputStream(blobFile(id), true)) { os.write(chunk.getBytes(StandardCharsets.UTF_8)); return true; }
            catch (Exception e) { return false; }
        }
        /** Baskı takibini başlatır/durdurur (uygulama kapalıyken bildirim). base: http://ip:port */
        @JavascriptInterface public void watchPrint(String base, boolean on) {
            if (on && base != null && base.length() > 0) {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != 0)
                    requestPermissions(new String[]{ "android.permission.POST_NOTIFICATIONS" }, 3);
                PrintWatch.start(MainActivity.this, base);
            } else PrintWatch.stop(MainActivity.this);
        }
        /** İkili veri (3MF proje) için: base64 parçasını çözüp geçici dosyaya ekler. */
        @JavascriptInterface public boolean blobAppend64(String id, String b64) {
            try (FileOutputStream os = new FileOutputStream(blobFile(id), true)) { os.write(Base64.decode(b64, Base64.DEFAULT)); return true; }
            catch (Exception e) { return false; }
        }
        @JavascriptInterface public String saveBlob(String name, String id) {
            try {
                Uri uri = writeToDownloads(name, blobFile(id));
                return uri != null ? "İndirilenler klasörüne kaydedildi: " + name : "Kaydedilemedi.";
            } catch (Exception e) { return "Kaydedilemedi: " + e.getMessage(); }
        }
        @JavascriptInterface public void shareBlob(String name, String id) {
            try { shareUri(name, writeToDownloads(name, blobFile(id))); }
            catch (Exception e) { toastJs("Paylaşılamadı: " + e.getMessage()); }
        }

        /** G-code / profil dosyasını İndirilenler klasörüne kaydeder; kullanıcıya gösterilecek mesajı döndürür. */
        @JavascriptInterface
        public String saveFile(String name, String content) {
            try {
                Uri uri = writeToDownloads(name, stringToTemp(content));
                return uri != null ? "İndirilenler klasörüne kaydedildi: " + name : "Kaydedilemedi.";
            } catch (Exception e) {
                return "Kaydedilemedi: " + e.getMessage();
            }
        }

        /** Dosyayı kaydedip Android paylaşım menüsünü açar (Creality Cloud, Drive, WhatsApp...). */
        @JavascriptInterface
        public void shareFile(String name, String content) {
            try {
                shareUri(name, writeToDownloads(name, stringToTemp(content)));
            } catch (Exception e) {
                toastJs("Paylaşılamadı: " + e.getMessage());
            }
        }

        /**
         * Yazıcıya (Moonraker) HTTP isteği. Tarayıcının CORS kısıtı olmadan, arka planda çalışır.
         * meta: { method, url, headers:{}, timeout, upload: { field, filename, fields:{} } | null }
         * Sonuç: window.k1HttpCb(id, status, text)   (status = -1: bağlantı hatası)
         */
        @JavascriptInterface
        public void http(final String id, final String metaJson, final String body) {
            net.execute(new Runnable() { @Override public void run() { doHttp(id, metaJson, body); } });
        }

        /** Aynı Wi-Fi ağında verilen portu açık olan cihazları bulur. Sonuç: window.k1ScanCb(id, '["ip", ...]') */
        @JavascriptInterface
        public void scan(final String id, final int port) {
            net.execute(new Runnable() { @Override public void run() { doScan(id, port); } });
        }
    }

    // ------------------------------------------------------------------ ağ
    private final ExecutorService net = Executors.newFixedThreadPool(3);

    private void jsCall(final String js) {
        runOnUiThread(new Runnable() { @Override public void run() { web.evaluateJavascript(js, null); } });
    }

    private void doHttp(String id, String metaJson, String body) {
        HttpURLConnection c = null;
        try {
            JSONObject meta = new JSONObject(metaJson);
            String method = meta.optString("method", "GET");
            int timeout = meta.optInt("timeout", 8000);
            c = (HttpURLConnection) new URL(meta.getString("url")).openConnection();
            c.setRequestMethod(method);
            c.setConnectTimeout(Math.min(timeout, 8000));
            c.setReadTimeout(timeout);
            JSONObject h = meta.optJSONObject("headers");
            if (h != null) {
                Iterator<String> it = h.keys();
                while (it.hasNext()) { String k = it.next(); c.setRequestProperty(k, h.getString(k)); }
            }
            JSONObject up = meta.optJSONObject("upload");
            if (up != null) {
                String boundary = "----k1max" + System.currentTimeMillis();
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                StringBuilder pre = new StringBuilder();
                JSONObject fields = up.optJSONObject("fields");
                if (fields != null) {
                    Iterator<String> it = fields.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        pre.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"").append(k)
                           .append("\"\r\n\r\n").append(fields.getString(k)).append("\r\n");
                    }
                }
                pre.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"")
                   .append(up.optString("field", "file")).append("\"; filename=\"").append(up.getString("filename").replace("\"", "_"))
                   .append("\"\r\nContent-Type: application/octet-stream\r\n\r\n");
                byte[] head = pre.toString().getBytes(StandardCharsets.UTF_8);
                byte[] tail = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
                // Dosya içeriği: önceden parça parça yazılmış geçici dosyadan (blob) ya da doğrudan metinden
                File src = up.has("blob") ? blobFile(up.getString("blob")) : stringToTemp(body);
                long len = src.length();
                c.setFixedLengthStreamingMode((long) head.length + len + tail.length);
                try (OutputStream os = c.getOutputStream(); InputStream in = new java.io.FileInputStream(src)) {
                    os.write(head);
                    byte[] buf = new byte[256 * 1024]; int n; long sent = 0; int lastPct = -1;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n); sent += n;
                        int pct = (int) (100L * sent / Math.max(1, len));
                        if (pct / 5 != lastPct / 5) { lastPct = pct; jsCall("window.k1HttpProgress&&k1HttpProgress('" + id + "'," + (pct / 100.0) + ")"); }
                    }
                    os.write(tail);
                }
            } else if (body != null && body.length() > 0 && !"GET".equals(method)) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);
            jsCall("window.k1HttpCb('" + id + "'," + status + "," + jsString(text) + ")");
        } catch (Exception e) {
            jsCall("window.k1HttpCb('" + id + "',-1," + jsString(e.getClass().getSimpleName() + ": " + e.getMessage()) + ")");
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void doScan(final String id, final int port) {
        final List<String> found = Collections.synchronizedList(new ArrayList<String>());
        List<String> prefixes = new ArrayList<>();
        String self = null;
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        String ip = a.getHostAddress();
                        String p = ip.substring(0, ip.lastIndexOf('.') + 1);
                        if (!prefixes.contains(p)) prefixes.add(p);
                        self = ip;
                    }
                }
            }
        } catch (Exception ignored) { }
        ExecutorService pool = Executors.newFixedThreadPool(48);
        final int total = prefixes.size() * 254;
        final AtomicInteger done = new AtomicInteger();
        for (final String p : prefixes) {
            for (int i = 1; i <= 254; i++) {
                final String ip = p + i;
                if (ip.equals(self)) { done.incrementAndGet(); continue; }
                pool.execute(new Runnable() {
                    @Override public void run() {
                        try (Socket s = new Socket()) {
                            s.connect(new InetSocketAddress(ip, port), 400);
                            found.add(ip);
                        } catch (Exception ignored) { }
                        int d = done.incrementAndGet();
                        if (d % 25 == 0) jsCall("window.k1ScanProgress&&k1ScanProgress('" + id + "'," + (d / (double) Math.max(1, total)) + ")");
                    }
                });
            }
        }
        pool.shutdown();
        try { pool.awaitTermination(60, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        JSONArray arr = new JSONArray();
        synchronized (found) { for (String ip : found) arr.put(ip); }
        jsCall("window.k1ScanCb('" + id + "'," + jsString(arr.toString()) + ")");
    }

    private File blobFile(String id) { return new File(getCacheDir(), "blob_" + id.replaceAll("[^A-Za-z0-9_]", "_")); }
    private File stringToTemp(String content) throws Exception {
        File f = blobFile("tmp");
        try (FileOutputStream os = new FileOutputStream(f, false)) { os.write(content.getBytes(StandardCharsets.UTF_8)); }
        return f;
    }
    private void shareUri(String name, Uri uri) {
        if (uri == null) { toastJs("Paylaşılamadı."); return; }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/x-gcode");
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.putExtra(Intent.EXTRA_SUBJECT, name);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        final Intent chooser = Intent.createChooser(send, "G-code'u paylaş");
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        runOnUiThread(new Runnable() { @Override public void run() { startActivity(chooser); } });
    }
    private static void copyFile(File src, OutputStream os) throws Exception {
        try (InputStream in = new java.io.FileInputStream(src)) {
            byte[] buf = new byte[256 * 1024]; int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        }
    }

    private Uri writeToDownloads(String name, File src) throws Exception {
        String mime = name.endsWith(".json") ? "application/json" : name.endsWith(".3mf") ? "model/3mf" : "text/x-gcode";
        if (Build.VERSION.SDK_INT >= 29) {
            // MediaStore.Downloads (API 29); derleme API 23'e karşı yapıldığı için yansıma ile
            Uri collection = (Uri) Class.forName("android.provider.MediaStore$Downloads")
                .getField("EXTERNAL_CONTENT_URI").get(null);
            ContentValues v = new ContentValues();
            v.put("_display_name", name);
            v.put("mime_type", mime);
            v.put("relative_path", Environment.DIRECTORY_DOWNLOADS + "/K1Max");
            ContentResolver cr = getContentResolver();
            Uri uri = cr.insert(collection, v);
            if (uri == null) return null;
            try (OutputStream os = cr.openOutputStream(uri)) { copyFile(src, os); }
            return uri;
        } else {
            if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != 0) {
                requestPermissions(new String[]{ android.Manifest.permission.WRITE_EXTERNAL_STORAGE }, 2);
                throw new Exception("depolama izni gerekli, izin verip tekrar deneyin");
            }
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "K1Max");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("klasör oluşturulamadı");
            File f = new File(dir, name);
            try (FileOutputStream os = new FileOutputStream(f)) { copyFile(src, os); }
            return Uri.fromFile(f);
        }
    }

    // ------------------------------------------------------------------ yardımcılar
    private void toastJs(final String msg) {
        runOnUiThread(new Runnable() {
            @Override public void run() { web.evaluateJavascript("(window.k1Toast||alert)(" + jsString(msg) + ")", null); }
        });
    }

    private String displayName(Uri uri) {
        String name = "model.stl";
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) name = c.getString(i);
            }
        } catch (Exception ignored) { }
        return name;
    }

    private static byte[] readAll(InputStream in) throws Exception {
        try (InputStream is = in) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        }
    }

    private static String jsString(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 32 || ch == ' ' || ch == ' ') b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }
}
