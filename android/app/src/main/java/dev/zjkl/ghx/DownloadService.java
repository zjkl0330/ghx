package dev.zjkl.ghx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * 下载用的前台服务。**它本身不下载**，只做一件事：让进程不被冻结。
 *
 * Android 12 起，进入 cached 状态（界面全退到后台）的进程十来秒后会被
 * Cached Apps Freezer 冻结 —— CPU 时间直接归零，wake lock 也救不回来。
 * 只有「进程里有前台服务」能把它留在前台优先级。所以下载一开始就起这个服务，
 * 下载结束（成功 / 失败 / 取消）立刻 stopSelf。
 *
 * 通知是前台服务的硬性代价，但顺带解决了另一个问题：用户切走后仍能看到
 * 进度，而不是回来才发现「怎么又断了」。
 *
 * Android 13+ 没给通知权限时，前台服务照常运行，只是通知不可见 ——
 * 下载不受影响，所以这里不去打扰用户要权限。
 */
public class DownloadService extends Service {

    static final String CHANNEL_ID = "ghx-download";
    static final int NOTIF_ID = 0x6a1;
    /** 通知刷新节流：200ms 一帧太费电，1 秒足够看清进度 */
    private static final long NOTIFY_INTERVAL_MS = 900;

    private long lastNotifyAt = 0;
    private boolean foreground = false;

    private final DownloadHub.Listener listener = new DownloadHub.Listener() {
        @Override
        public void onProgress(long bytes, long total, double kbps) {
            long now = System.currentTimeMillis();
            if (now - lastNotifyAt < NOTIFY_INTERVAL_MS) return;
            lastNotifyAt = now;
            notifyProgress(bytes, total, kbps);
        }

        @Override
        public void onDone(String path, long bytes, long ms) {
            finishWith("下载完成", bytes, bytes > 0 ? bytes : 0);
        }

        @Override
        public void onError(String message) {
            finishWith("下载已停止", 0, 0);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        DownloadHub.addListener(listener);

        String name = DownloadHub.snapshot().fileName;
        startForegroundCompat(buildNotification("正在下载", name, 0, 0, 0));

        // 服务可能在下载刚结束的一瞬才起来（点下载 → 立刻退到后台的极端时序），
        // 那种情况下没有工作了，别留一条常驻通知。
        if (!DownloadHub.isRunning()) {
            stopSelfSafe();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        DownloadHub.removeListener(listener);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ---------------- 通知 ---------------- */

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "下载", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("应用内下载的进度");
        // 下载进度不需要角标与提示音，静默就好
        ch.setShowBadge(false);
        ch.setSound(null, null);
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification(String title, String fileName, long bytes, long total, double kbps) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false);

        if (fileName != null && !fileName.isEmpty()) {
            b.setContentText(fileName);
        }

        if (total > 0) {
            int pct = (int) Math.min(100, bytes * 100 / total);
            b.setProgress(100, pct, false);
            b.setSubText(pct + "%" + (kbps > 0 ? " · " + fmtSpeed(kbps) : ""));
        } else if (bytes > 0) {
            b.setProgress(0, 0, true);
            b.setSubText(fmtBytes(bytes) + (kbps > 0 ? " · " + fmtSpeed(kbps) : ""));
        } else {
            b.setProgress(0, 0, true);
        }
        return b.build();
    }

    private void notifyProgress(long bytes, long total, double kbps) {
        if (!foreground) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            String name = DownloadHub.snapshot().fileName;
            if (nm != null) {
                nm.notify(NOTIF_ID, buildNotification("正在下载", name, bytes, total, kbps));
            }
        } catch (Exception ignored) {
            // 通知更新失败不影响下载
        }
    }

    private void finishWith(String title, long bytes, long total) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.stat_sys_download_done)
                        .setContentTitle(title)
                        .setContentText(DownloadHub.snapshot().fileName)
                        .setAutoCancel(true)
                        .setOnlyAlertOnce(true)
                        .setShowWhen(false);
                if (total > 0) b.setProgress(0, 0, false);
                nm.notify(NOTIF_ID, b.build());
            }
        } catch (Exception ignored) {
            // 同上
        }
        stopSelfSafe();
    }

    private void startForegroundCompat(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIF_ID, n);
            }
            foreground = true;
        } catch (Exception e) {
            // 前台服务被系统拒绝（极少见，多半是后台启动限制）时不要崩：
            // 下载仍然继续，只是失去「不被冻结」的保障。
            foreground = false;
        }
    }

    private void stopSelfSafe() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {
            // 已经不在前台就无所谓
        }
        foreground = false;
        stopSelf();
    }

    private static String fmtBytes(long b) {
        if (b < 1024) return b + " B";
        if (b < 1024 * 1024) return String.format(java.util.Locale.US, "%.1f KB", b / 1024.0);
        return String.format(java.util.Locale.US, "%.1f MB", b / 1024.0 / 1024.0);
    }

    private static String fmtSpeed(double kbps) {
        if (kbps < 1024) return String.format(java.util.Locale.US, "%.0f KB/s", kbps);
        return String.format(java.util.Locale.US, "%.1f MB/s", kbps / 1024.0);
    }
}
