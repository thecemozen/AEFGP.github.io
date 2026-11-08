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
import java.nio.charset.StandardCharsets;

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

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
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
                boolean json = false;
                for (String a : params.getAcceptTypes()) if (a != null && a.contains("json")) json = true;
                try {
                    startActivityForResult(Intent.createChooser(i, json ? "Profil seç" : "STL dosyası seç"), PICK_FILE);
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
            if (res == RESULT_OK && data != null && data.getData() != null) result = new Uri[]{ data.getData() };
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
        /** G-code / profil dosyasını İndirilenler klasörüne kaydeder; kullanıcıya gösterilecek mesajı döndürür. */
        @JavascriptInterface
        public String saveFile(String name, String content) {
            try {
                Uri uri = writeToDownloads(name, content);
                return uri != null ? "İndirilenler klasörüne kaydedildi: " + name : "Kaydedilemedi.";
            } catch (Exception e) {
                return "Kaydedilemedi: " + e.getMessage();
            }
        }

        /** Dosyayı kaydedip Android paylaşım menüsünü açar (Creality Cloud, Drive, WhatsApp...). */
        @JavascriptInterface
        public void shareFile(String name, String content) {
            try {
                Uri uri = writeToDownloads(name, content);
                if (uri == null) { toastJs("Paylaşılamadı."); return; }
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/x-gcode");
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.putExtra(Intent.EXTRA_SUBJECT, name);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                final Intent chooser = Intent.createChooser(send, "G-code'u paylaş");
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(new Runnable() { @Override public void run() { startActivity(chooser); } });
            } catch (Exception e) {
                toastJs("Paylaşılamadı: " + e.getMessage());
            }
        }
    }

    private Uri writeToDownloads(String name, String content) throws Exception {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        String mime = name.endsWith(".json") ? "application/json" : "text/x-gcode";
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
            try (OutputStream os = cr.openOutputStream(uri)) { os.write(bytes); }
            return uri;
        } else {
            if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != 0) {
                requestPermissions(new String[]{ android.Manifest.permission.WRITE_EXTERNAL_STORAGE }, 2);
                throw new Exception("depolama izni gerekli, izin verip tekrar deneyin");
            }
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "K1Max");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("klasör oluşturulamadı");
            File f = new File(dir, name);
            try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
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
