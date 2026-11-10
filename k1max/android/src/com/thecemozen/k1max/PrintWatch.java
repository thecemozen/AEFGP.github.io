package com.thecemozen.k1max;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

/**
 * Baskı takibi: uygulama kapalıyken bile yazıcıyı (Moonraker) aralıklarla sorgular.
 * Baskı sürerken ilerleme bildirimi gösterir; bitince, iptal edilince ya da hata olunca haber verir.
 * Ön plan servisi yerine AlarmManager kullanılır: pil dostudur, telefon uykudayken aralık uzayabilir.
 */
public class PrintWatch extends BroadcastReceiver {
    static final String PREFS = "k1watch";
    static final String CH_PROGRESS = "k1_progress", CH_DONE = "k1_done";
    static final int ID_PROGRESS = 7001, ID_DONE = 7002;
    static final long INTERVAL_MS = 60_000L;

    /** Takibi başlatır (base: http://ip:port). Aynı adres zaten izleniyorsa yalnızca bir sonraki sorguyu planlar. */
    static void start(Context ctx, String base) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, 0);
        p.edit().putString("base", base).putBoolean("on", true).putInt("fails", 0).apply();
        schedule(ctx, 1000);
    }
    static void stop(Context ctx) {
        ctx.getSharedPreferences(PREFS, 0).edit().putBoolean("on", false).apply();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.cancel(alarmIntent(ctx));
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(ID_PROGRESS);
    }
    private static PendingIntent alarmIntent(Context ctx) {
        Intent i = new Intent(ctx, PrintWatch.class).setAction("com.thecemozen.k1max.POLL");
        return PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static void schedule(Context ctx, long delay) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delay, alarmIntent(ctx));
    }

    @Override
    public void onReceive(final Context ctx, Intent intent) {
        final SharedPreferences p = ctx.getSharedPreferences(PREFS, 0);
        if (!p.getBoolean("on", false)) return;
        final PendingResult pr = goAsync();
        new Thread(new Runnable() { @Override public void run() {
            try { poll(ctx.getApplicationContext(), p); }
            catch (Throwable t) { /* bir sonraki sorguda yeniden denenir */ }
            finally { pr.finish(); }
        } }).start();
    }

    private static void poll(Context ctx, SharedPreferences p) {
        String base = p.getString("base", null);
        if (base == null) return;
        JSONObject st;
        try {
            st = new JSONObject(get(base + "/printer/objects/query?print_stats&display_status")).getJSONObject("result").getJSONObject("status");
        } catch (Exception e) {
            int fails = p.getInt("fails", 0) + 1;
            p.edit().putInt("fails", fails).apply();
            if (fails >= 30) { // ~30 dk boyunca ulaşılamadı: takibi bırak
                stop(ctx);
                notify(ctx, CH_DONE, ID_DONE, "Yazıcıya ulaşılamıyor", "Baskı takibi durduruldu. Uygulamayı açıp yeniden bağlanın.", -1, false);
            } else schedule(ctx, INTERVAL_MS);
            return;
        }
        p.edit().putInt("fails", 0).apply();
        JSONObject ps = st.optJSONObject("print_stats");
        String state = ps != null ? ps.optString("state", "") : "";
        String file = ps != null ? ps.optString("filename", "") : "";
        double dur = ps != null ? ps.optDouble("print_duration", 0) : 0;
        JSONObject ds = st.optJSONObject("display_status");
        double prog = ds != null ? ds.optDouble("progress", 0) : 0;
        String last = p.getString("last", "");
        p.edit().putString("last", state).apply();
        String name = file.replaceAll("\\.gcode$", "");

        if ("printing".equals(state) || "paused".equals(state)) {
            String left = "";
            if (prog > 0.02 && dur > 60) left = " · kalan ~" + fmt(dur / prog - dur);
            String layer = "";
            JSONObject info = ps.optJSONObject("info");
            if (info != null && info.optInt("total_layer", 0) > 0)
                layer = " · katman " + info.optInt("current_layer", 0) + "/" + info.optInt("total_layer", 0);
            notify(ctx, CH_PROGRESS, ID_PROGRESS, ("paused".equals(state) ? "Duraklatıldı: " : "Basılıyor: ") + name,
                Math.round(prog * 100) + "%" + layer + left, (int) Math.round(prog * 100), true);
            schedule(ctx, INTERVAL_MS);
            return;
        }
        // baskı bitti / iptal / hata: bir kez haber ver ve takibi bırak
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(ID_PROGRESS);
        if ("printing".equals(last) || "paused".equals(last)) {
            if ("complete".equals(state)) notify(ctx, CH_DONE, ID_DONE, "Baskı tamamlandı ✓", name + " · " + fmt(dur), -1, false);
            else if ("cancelled".equals(state)) notify(ctx, CH_DONE, ID_DONE, "Baskı iptal edildi", name, -1, false);
            else if ("error".equals(state)) notify(ctx, CH_DONE, ID_DONE, "Baskı hatası!", name + " · " + (ps != null ? ps.optString("message", "") : ""), -1, false);
        }
        p.edit().putBoolean("on", false).apply();
    }

    static String fmt(double s) {
        long m = Math.round(s / 60);
        return m >= 60 ? (m / 60) + " sa " + (m % 60) + " dk" : m + " dk";
    }

    private static String get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(5000); c.setReadTimeout(6000);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) bo.write(b, 0, n);
            return new String(bo.toByteArray(), StandardCharsets.UTF_8);
        } finally { c.disconnect(); }
    }

    /** Bildirim kanalı (Android 8+) yansıma ile: derleme API 23'e karşı yapılıyor. */
    private static Notification.Builder builder(Context ctx, String ch) {
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                Class<?> cc = Class.forName("android.app.NotificationChannel");
                boolean prog = CH_PROGRESS.equals(ch);
                Object chan = cc.getConstructor(String.class, CharSequence.class, int.class)
                    .newInstance(ch, prog ? "Baskı ilerlemesi" : "Baskı sonucu", prog ? 2 : 4); // LOW : HIGH
                nm.getClass().getMethod("createNotificationChannel", cc).invoke(nm, chan);
                return (Notification.Builder) Notification.Builder.class.getConstructor(Context.class, String.class).newInstance(ctx, ch);
            } catch (Exception e) { /* eski yol */ }
        }
        return new Notification.Builder(ctx);
    }

    // R sınıfı üretilmediği için kaynak kimliği adla bulunur
    private static int icon(Context ctx) {
        int id = ctx.getResources().getIdentifier("ic_stat_print", "drawable", ctx.getPackageName());
        return id != 0 ? id : android.R.drawable.stat_sys_download_done;
    }

    static void notify(Context ctx, String ch, int id, String title, String text, int progress, boolean ongoing) {
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("k1tab", "device");
        PendingIntent pi = PendingIntent.getActivity(ctx, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = builder(ctx, ch)
            .setSmallIcon(icon(ctx))
            .setContentTitle(title).setContentText(text)
            .setContentIntent(pi).setOngoing(ongoing).setAutoCancel(!ongoing).setOnlyAlertOnce(ongoing)
            .setColor(0xFF2FA36B);
        if (progress >= 0) b.setProgress(100, progress, false);
        if (!ongoing) b.setDefaults(Notification.DEFAULT_ALL).setPriority(Notification.PRIORITY_HIGH);
        try { ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id, b.build()); }
        catch (SecurityException e) { /* bildirim izni yok */ }
    }
}
