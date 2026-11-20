package dev.zjkl.ghx;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;

import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 下载实体。**故意做成静态单例，不挂在 Plugin 或 Activity 上。**
 *
 * 以前下载线程是 DownloadPlugin 的成员，Plugin 跟随 Activity 销毁 —— 熄屏、
 * 切后台被系统回收、WebView 页面重建，都会顺着 handleOnDestroy 把下载掐断。
 * 现在线程只跟进程走：界面没了下载继续，回来时用 {@link #snapshot()} 对账。
 *
 * 光有独立线程还不够，两个系统策略会继续踩：
 *
 *  1. 熄屏后 CPU 进 suspend，socket 读超时 30 秒就断 —— 靠 PARTIAL_WAKE_LOCK 顶住；
 *  2. 熄屏后 WiFi 射频休眠，包收不到 —— 靠 WifiLock 顶住。
 *
 * 但这两把锁都拦不住 Android 12+ 的「后台进程冻结」（Cached Apps Freezer）：
 * 进程进入 cached 状态十来秒后会被整组冻结，CPU 时间归零，下载线程原地停住。
 * 唯一可靠的办法是让进程始终持有前台服务，见 {@link DownloadService}。
 *
 * 锁都设了超时：万一某条异常路径没走到 release，也不会把手机的 CPU 一直钉住。
 */
final class DownloadHub {

    interface Listener {
        /** 主线程回调。bytes/total 是累计值，total 为 0 表示服务器没给长度 */
        void onProgress(long bytes, long total, double kbps);

        /** 主线程回调。落盘成功 */
        void onDone(String path, long bytes, long ms);

        /** 主线程回调。失败或用户取消 */
        void onError(String message);
    }

    /** 给 JS 的状态快照，字段与 native-download.ts 里的 NativeStatus 对齐 */
    static final class Snapshot {
        boolean running;
        boolean hasResult;
        long bytes;
        long total;
        double kbps;
        String fileName = "";
        String path;
        String error;
        long ms;
        /** 本次实际并发数：1 表示单连接（线路不支持分段，或用户选了单线程） */
        int parts = 1;
        boolean chunked;
    }

    private static final long WAKE_TIMEOUT_MS = 30 * 60 * 1000L;

    private static final Object LOCK = new Object();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final List<Listener> LISTENERS = new CopyOnWriteArrayList<>();

    private static Context app;
    private static Thread worker;
    private static volatile boolean running;
    private static volatile boolean cancelled;
    private static volatile HttpURLConnection conn;

    private static volatile long bytes;
    private static volatile long total;
    private static volatile double kbps;
    private static volatile int parts = 1;
    private static volatile boolean chunked;
    private static volatile String fileName = "";
    /** 来源信息，仅用于「界面已销毁时也能补一条下载记录」 */
    private static volatile String repo = "";
    private static volatile String kind = "";
    private static volatile String tag = "";

    /** 上一次结束的结果，保留到下次开始下载 */
    private static volatile boolean hasResult;
    private static volatile String lastPath;
    private static volatile String lastError;
    private static volatile long lastBytes;
    private static volatile long lastMs;
    /** 本次落盘路径，doDownload 一开始就写；start 时清空 */
    private static volatile String outPath;

    private static PowerManager.WakeLock wake;
    private static WifiManager.WifiLock wifi;

    private DownloadHub() {}

    static boolean isRunning() {
        return running;
    }

    /** 本次下载实际用了几条连接：1 表示单线程，>1 表示在切片 */
    static int currentParts() {
        return parts;
    }

    static synchronized void addListener(Listener l) {
        if (l != null && !LISTENERS.contains(l)) LISTENERS.add(l);
    }

    static synchronized void removeListener(Listener l) {
        LISTENERS.remove(l);
    }

    static Snapshot snapshot() {
        Snapshot s = new Snapshot();
        s.running = running;
        s.bytes = bytes;
        s.total = total;
        s.kbps = kbps;
        s.fileName = fileName;
        s.hasResult = hasResult;
        s.path = lastPath;
        s.error = lastError;
        s.ms = lastMs;
        s.parts = parts;
        s.chunked = chunked;
        return s;
    }

    static boolean isCancelled() {
        return cancelled;
    }

    /**
     * 开始下载。已经有一条在跑时返回 false，调用方应当告诉用户「已有下载在进行」，
     * 而不是悄悄把上一条掐掉 —— 用户可能是从另一个仓库点进来的。
     */
    static boolean start(Context context, String url, String name, long expect, Map<String, String> headers,
                         String repoName, String kindName, String tagName, int wantParts) {
        synchronized (LOCK) {
            if (running) return false;
            app = context.getApplicationContext();
            cancelled = false;
            running = true;
            hasResult = false;
            lastError = null;
            lastPath = null;
            outPath = null;
            bytes = 0;
            total = expect > 0 ? expect : 0;
            kbps = 0;
            parts = 1;
            chunked = false;
            fileName = name;
            repo = repoName == null ? "" : repoName;
            kind = kindName == null ? "" : kindName;
            tag = tagName == null ? "" : tagName;
            acquireLocks();
        }

        final String fUrl = url;
        final String fName = name;
        final long fExpect = expect;
        final Map<String, String> fHeaders = headers;
        final int fParts = wantParts;

        worker = new Thread(() -> {
            try {
                long ms = doDownload(fUrl, fName, fExpect, fHeaders, fParts);
                lastPath = outPath;
                lastBytes = bytes;
                lastMs = ms;
                hasResult = true;
                finish();
                persist(true, null);
                emitDone(lastPath, lastBytes, lastMs);
            } catch (Exception e) {
                String msg = e.getMessage() == null ? "下载失败" : e.getMessage();
                lastError = msg;
                hasResult = true;
                finish();
                // 用户主动取消不留记录：那是他按的，不需要事后解释
                if (!cancelled) persist(false, msg);
                emitError(msg);
            }
        }, "ghx-download");
        worker.start();
        return true;
    }

    static void cancel() {
        cancelled = true;
        // 分片模式下可能同时有四条连接在跑，逐个断才停得干净
        ChunkedFetch.abortAll();
        HttpURLConnection c = conn;
        if (c != null) {
            try {
                c.disconnect();
            } catch (Exception ignored) {
                // 断开失败无所谓，下载循环下一轮靠 cancelled 退出
            }
        }
    }

    /** 线程收尾：释放锁、复位状态。结果字段不动，留给 snapshot */
    private static void finish() {
        running = false;
        conn = null;
        releaseLocks();
    }

    /* ---------------- 待认领的记录 ---------------- */

    private static final String SP = "ghx_dl";
    private static final String SP_PENDING = "pending";

    /**
     * 把「刚结束的这一条」写到 SharedPreferences，等界面来认领。
     *
     * 为什么需要：下载记录是 JS 写的，但用户可能在下完之后先退了 App、
     * 或者 WebView 被系统回收重建 —— 那一刻没有 JS 在跑，记录就丢了。
     * 原生先落一份「待认领」，页面下次起来时取走并写进历史，只认领一次。
     */
    private static void persist(boolean ok, String error) {
        if (app == null) return;
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("repo", repo);
            o.put("kind", kind);
            o.put("tag", tag);
            o.put("name", fileName);
            o.put("ok", ok);
            o.put("bytes", ok ? lastBytes : bytes);
            o.put("ms", lastMs);
            o.put("at", System.currentTimeMillis());
            o.put("path", lastPath == null ? "" : lastPath);
            if (error != null) o.put("error", error);
            android.content.SharedPreferences sp =
                    app.getSharedPreferences(SP, Context.MODE_PRIVATE);
            sp.edit().putString(SP_PENDING, o.toString()).apply();
        } catch (Exception ignored) {
            // 记不上不影响下载本身
        }
    }

    /** 取走待认领的记录（取走即清空），返回原始 JSON 交给 JS 解析 */
    static String takePending(Context ctx) {
        try {
            android.content.SharedPreferences sp =
                    ctx.getSharedPreferences(SP, Context.MODE_PRIVATE);
            String raw = sp.getString(SP_PENDING, null);
            if (raw != null) sp.edit().remove(SP_PENDING).apply();
            return raw;
        } catch (Exception e) {
            return null;
        }
    }

    /* ---------------- 锁 ---------------- */

    private static void acquireLocks() {
        try {
            PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ghx:download");
                wake.setReferenceCounted(false);
                wake.acquire(WAKE_TIMEOUT_MS);
            }
        } catch (Exception ignored) {
            // 拿不到锁就退化成「能下多少下多少」，不要让下载直接失败
        }
        try {
            WifiManager wm = (WifiManager) app.getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "ghx:download");
                wifi.setReferenceCounted(false);
                wifi.acquire();
            }
        } catch (Exception ignored) {
            // 同上
        }
    }

    private static void releaseLocks() {
        try {
            if (wake != null && wake.isHeld()) wake.release();
        } catch (Exception ignored) {
            // 收尾失败不覆盖主异常
        }
        wake = null;
        try {
            if (wifi != null && wifi.isHeld()) wifi.release();
        } catch (Exception ignored) {
            // 同上
        }
        wifi = null;
    }

    /* ---------------- 事件 ---------------- */

    private static void emitProgress(long b, long t, double speed) {
        if (LISTENERS.isEmpty()) return;
        MAIN.post(() -> {
            for (Listener l : LISTENERS) {
                try {
                    l.onProgress(b, t, speed);
                } catch (Exception ignored) {
                    // 某个监听者出错不该影响其它监听者（服务与页面各一份）
                }
            }
        });
    }

    private static void emitDone(String path, long size, long ms) {
        if (LISTENERS.isEmpty()) return;
        MAIN.post(() -> {
            for (Listener l : LISTENERS) {
                try {
                    l.onDone(path, size, ms);
                } catch (Exception ignored) {
                    // 同上
                }
            }
        });
    }

    private static void emitError(String msg) {
        if (LISTENERS.isEmpty()) return;
        MAIN.post(() -> {
            for (Listener l : LISTENERS) {
                try {
                    l.onError(msg);
                } catch (Exception ignored) {
                    // 同上
                }
            }
        });
    }

    /* ---------------- 下载本体 ---------------- */

    private static File downloadDir() {
        File dir = app.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = new File(app.getFilesDir(), "Download");
        if (!dir.exists() && !dir.mkdirs()) return null;
        return dir;
    }

    private static String versionName() {
        try {
            return app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0.0.0";
        }
    }

    private static String safeName(String raw) {
        String s = raw == null ? "" : raw.trim();
        s = s.replaceAll("[\\\\/:*?\"<>|]", "_").replaceAll("[\\u0000-\\u001f]", "");
        while (s.startsWith(".")) s = s.substring(1);
        return s.isEmpty() ? "download.bin" : s;
    }

    private static long doDownload(String url, String rawName, long expect, Map<String, String> headers,
                                   int wantParts) throws IOException {
        File dir = downloadDir();
        if (dir == null) throw new IOException("无法创建下载目录");
        String fileName = safeName(rawName);

        File out = new File(dir, fileName);
        File part = new File(dir, fileName + ".part");
        // 同名旧包先清掉；清不掉（被安装器占着）就换一个带时间戳的名字，
        // 不要因为「上一版还没装完」就整个下载失败。
        if (part.exists() && !part.delete()) throw new IOException("无法清理临时文件");
        if (out.exists() && !out.delete()) {
            out = new File(dir, System.currentTimeMillis() + "-" + fileName);
        }
        outPath = out.getAbsolutePath();

        long started = System.currentTimeMillis();
        try {
            ChunkedFetch.Outcome r = ChunkedFetch.fetch(
                    url, headers, part, expect, "ghx-android/" + versionName(), wantParts,
                    new ChunkedFetch.Progress() {
                        @Override
                        public void onBytes(long done, long len, double speed, int n) {
                            bytes = done;
                            total = len;
                            kbps = speed;
                            parts = n;
                            chunked = n > 1;
                            emitProgress(done, len, speed);
                        }
                    },
                    new ChunkedFetch.Cancel() {
                        @Override
                        public boolean cancelled() {
                            return DownloadHub.cancelled;
                        }
                    });
            bytes = r.bytes;
            total = r.bytes;
            chunked = r.chunked;
            parts = r.parts;
            if (!part.renameTo(out)) throw new IOException("无法保存文件");
            return System.currentTimeMillis() - started;
        } finally {
            // 中途失败或取消：删掉半截文件，别占着空间
            if (part.exists() && !out.exists()) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
            }
        }
    }
}
