package com.aefgp.prompter;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Prompter web uygulamasını (assets/) güvenli bir https kökeninden sunan WebView kabuğu.
 * Kamera/mikrofon izinlerini Android izinlerine bağlar ve kaydı galeriye yazan bir köprü sağlar.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int REQ_MEDIA = 1;
    private static final int REQ_STORAGE = 2;

    private WebView webView;
    private PermissionRequest pendingRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Sistem çubukları ve klavye için boşluk bırak (Android 15'te kenardan kenara zorunlu).
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        } else {
            root.setFitsSystemWindows(true);
        }

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);

        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");
        webView.setWebViewClient(new AssetClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handlePermissionRequest(request));
            }
        });

        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
        }

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(START_URL);
    }

    /* ---------- Kamera / mikrofon izinleri ---------- */

    private static String androidPermissionFor(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        return null;
    }

    private void handlePermissionRequest(PermissionRequest request) {
        if (!HOST.equals(request.getOrigin().getHost())) { request.deny(); return; }
        List<String> missing = new ArrayList<>();
        for (String r : request.getResources()) {
            String p = androidPermissionFor(r);
            if (p != null && checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        }
        if (missing.isEmpty()) { grantAllowed(request); return; }
        if (pendingRequest != null) pendingRequest.deny();
        pendingRequest = request;
        requestPermissions(missing.toArray(new String[0]), REQ_MEDIA);
    }

    private void grantAllowed(PermissionRequest request) {
        List<String> ok = new ArrayList<>();
        for (String r : request.getResources()) {
            String p = androidPermissionFor(r);
            if (p != null && checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) ok.add(r);
        }
        if (ok.isEmpty()) request.deny();
        else request.grant(ok.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == REQ_MEDIA && pendingRequest != null) {
            PermissionRequest r = pendingRequest;
            pendingRequest = null;
            grantAllowed(r);
        }
    }

    /* ---------- Yaşam döngüsü ---------- */

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        webView.evaluateJavascript("window.onAndroidBack ? window.onAndroidBack() : false", value -> {
            if (!"true".equals(value)) finish();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }

    /* ---------- assets/ klasörünü https://appassets.androidplatform.net/ altında sun ---------- */

    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost())) return null;
            String path = url.getPath();
            if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
            path = path.substring(1);
            if (path.contains("..")) return notFound();
            try {
                InputStream in = getAssets().open(path);
                return new WebResourceResponse(mimeFor(path), mimeFor(path).startsWith("text") ? "utf-8" : null, in);
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Uygulama dışı bağlantılar tarayıcıda açılsın
            if (HOST.equals(request.getUrl().getHost())) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); } catch (Exception ignored) { }
            return true;
        }

        private WebResourceResponse notFound() {
            WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", null);
            r.setStatusCodeAndReasonPhrase(404, "Not Found");
            return r;
        }
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webmanifest") || p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    /* ---------- JavaScript köprüsü ---------- */

    class Bridge {
        private OutputStream out;
        private Uri pendingUri;
        private File legacyFile;

        /** Galeride yeni bir video dosyası açar. */
        @JavascriptInterface
        public synchronized boolean begin(String name, String mime) {
            abort();
            String safeName = name.replaceAll("[^A-Za-z0-9._-]", "_");
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Video.Media.DISPLAY_NAME, safeName);
                    v.put(MediaStore.Video.Media.MIME_TYPE, mime);
                    v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Prompter");
                    v.put(MediaStore.Video.Media.IS_PENDING, 1);
                    ContentResolver cr = getContentResolver();
                    pendingUri = cr.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                    if (pendingUri == null) return false;
                    out = cr.openOutputStream(pendingUri);
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "Prompter");
                    if (!dir.isDirectory() && !dir.mkdirs()) return false;
                    legacyFile = new File(dir, safeName);
                    out = new FileOutputStream(legacyFile);
                }
                return out != null;
            } catch (Exception e) {
                abort();
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean append(String base64) {
            if (out == null) return false;
            try {
                out.write(Base64.decode(base64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** Dosyayı kapatıp galeride görünür yapar; paylaşım için içerik adresini döndürür. */
        @JavascriptInterface
        public synchronized String end() {
            if (out == null) return null;
            try {
                out.close();
                out = null;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Video.Media.IS_PENDING, 0);
                    getContentResolver().update(pendingUri, v, null, null);
                    String result = pendingUri.toString();
                    pendingUri = null;
                    return result;
                }
                final String[] scanned = {null};
                CountDownLatch latch = new CountDownLatch(1);
                MediaScannerConnection.scanFile(MainActivity.this,
                        new String[]{legacyFile.getAbsolutePath()}, null, (p, uri) -> {
                            if (uri != null) scanned[0] = uri.toString();
                            latch.countDown();
                        });
                latch.await(5, TimeUnit.SECONDS);
                legacyFile = null;
                return scanned[0] != null ? scanned[0] : "saved";
            } catch (Exception e) {
                abort();
                return null;
            }
        }

        @JavascriptInterface
        public synchronized void abort() {
            try { if (out != null) out.close(); } catch (IOException ignored) { }
            out = null;
            if (pendingUri != null) {
                try { getContentResolver().delete(pendingUri, null, null); } catch (Exception ignored) { }
                pendingUri = null;
            }
            if (legacyFile != null) {
                //noinspection ResultOfMethodCallIgnored
                legacyFile.delete();
                legacyFile = null;
            }
        }

        @JavascriptInterface
        public void share(String uri) {
            if (uri == null || !uri.startsWith("content://")) return;
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("video/*");
                send.putExtra(Intent.EXTRA_STREAM, Uri.parse(uri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivity(Intent.createChooser(send, "Videoyu paylaş")); } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public String readClipboard() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                ClipData clip = cm.getPrimaryClip();
                if (clip == null || clip.getItemCount() == 0) return "";
                CharSequence t = clip.getItemAt(0).coerceToText(MainActivity.this);
                return t == null ? "" : t.toString();
            } catch (Exception e) {
                return "";
            }
        }
    }
}
