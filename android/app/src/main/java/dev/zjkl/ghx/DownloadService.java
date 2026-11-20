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

import java.util.Locale;

/**
 * 下载用的前台服务。**它本身不下载**，只做两件事：让进程不被冻结、把进度放到通知栏。
 *
 * Android 12 起，进入 cached 状态（界面全退到后台）的进程十来秒后会被
 * Cached Apps Freezer 冻结 —— CPU 时间直接归零，wake lock 也救不回来。
 * 只有「进程里有前台服务」能把它留在前台优先级。所以下载一开始就起这个服务，
 * 下载结束（成功 / 失败 / 取消）立刻 stopSelf。
 *
 * 通知在前台服务里是硬性代价，但它也是用户唯一能看见下载的地方：熄屏、切到别的
 * 应用、甚至退回桌面，进度都还在。所以这里把通知当正经 UI 做 ——
 * 文件名、已下 / 总量、速度、剩余时间、几路并行、一个当场生效的取消按钮。
 *
 * Android 13+ 没给通知权限时，前台服务照常运行、下载照旧，只是通知不可见。
 * 权限在下载发起时由 DownloadPlugin 顺手要，不在这里纠缠。
 */
public class DownloadService extends Service {

    static final String CHANNEL_ID = "ghx-download";
    static final int NOTIF_ID = 0x6a1;
    /** 通知刷新节流：进度本身 150ms 一帧，通知 600ms 足够看着连贯，还省电 */
    private static final long NOTIFY_INTERVAL_MS = 600;

    private long lastNotifyAt = 0;
    private boolean foreground = false;

    private final DownloadHub.Listener listener = new DownloadHub.Listener() {
        @Override
        public void onProgress(long bytes, long total, double kbps) {
            long now = System.currentTimeMillis();
            if (lastNotifyAt != 0 && now - lastNotifyAt < NOTIFY_INTERVAL_MS) return;
            lastNotifyAt = now;
            notifyProgress(bytes, total, kbps);
        }

        @Override
        public void onDone(String path, long bytes, long ms) {
            finishWith("下载完成", path, bytes, ms, null);
        }

        @Override
        public void onError(String message) {
            finishWith(null, null, 0, 0, message);
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

        DownloadHub.Snapshot s = DownloadHub.snapshot();
        startForegroundCompat(buildProgress(s.fileName, s.bytes, s.total, s.kbps));

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
        // 下载进度不需要角标与提示音，静默就好；重要性 LOW 保证它不出横幅、不响
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.setVibrationPattern(new long[]{0});
        nm.createNotificationChannel(ch);
    }

    /** 点通知打开 App */
    private PendingIntent openApp() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 0, open, flags);
    }

    /** 点通知里的「安装」→ 直接把待安装路径交给 MainActivity */
    private PendingIntent installIntent(String path) {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra(MainActivity.EXTRA_INSTALL_PATH, path);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 1, i, flags);
    }

    /** 点通知里的「取消」→ 直接掐下载，不经过界面 */
    private PendingIntent cancelIntent() {
        Intent i = new Intent(this, DownloadActionReceiver.class);
        i.setAction(DownloadActionReceiver.ACTION_CANCEL);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(this, 2, i, flags);
    }

    private NotificationCompat.Builder base(String title, String text) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentIntent(openApp())
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setPriority(NotificationCompat.PRIORITY_LOW);
        if (text != null && !text.isEmpty()) b.setContentText(text);
        /*
         * Android 12 起，前台服务的通知默认「先压 10 秒再露头」，用来防通知轰炸。
         * 下载是用户刚点过的事，等十秒才出现等于没有，所以要求立刻显示。
         */
        if (Build.VERSION.SDK_INT >= 31) {
            b.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return b;
    }

    private Notification buildProgress(String fileName, long bytes, long total, double kbps) {
        String name = NotifText.shortName(fileName, 32);
        NotificationCompat.Builder b = base(name.isEmpty() ? "正在下载" : name, null);

        int parts = DownloadHub.currentParts();
        String sub;

        if (total > 0) {
            int pct = NotifText.percent(bytes, total);
            b.setProgress(100, pct, false);
            b.setContentText(NotifText.bytes(bytes) + " / " + NotifText.bytes(total)
                    + (kbps > 0 ? " · " + NotifText.speed(kbps) : ""));

            long eta = NotifText.etaSeconds(bytes, total, kbps);
            sub = pct + "%";
            if (parts > 1) sub += " · " + parts + " 路并行";
            if (eta >= 0) sub += " · 还剩 " + NotifText.eta(eta);
        } else {
            // 服务器没给长度（少见，个别线路的 chunked 响应）：只能转圈 + 报已下量
            b.setProgress(0, 0, true);
            b.setContentText(NotifText.bytes(bytes) + (kbps > 0 ? " · " + NotifText.speed(kbps) : ""));
            sub = "正在下载";
            if (parts > 1) sub += " · " + parts + " 路并行";
        }
        b.setSubText(sub);
        b.addAction(0, "取消", cancelIntent());
        return b.build();
    }

    private void notifyProgress(long bytes, long total, double kbps) {
        String name = DownloadHub.snapshot().fileName;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            Notification n = buildProgress(name, bytes, total, kbps);
            /*
             * 前台服务还活着时，同 id 的 notify 会直接替换那条前台通知；
             * 前台被系统拒过（foreground=false）时这里退化成普通通知 ——
             * 至少还能看见进度，而不是完全没有反馈。
             */
            nm.notify(NOTIF_ID, n);
        } catch (Exception ignored) {
            // 通知更新失败不影响下载
        }
    }

    /**
     * 收尾。title 为 null 表示失败。
     *
     * 顺序很关键：**先脱离前台，再发终态通知**。
     * stopForeground(STOP_FOREGROUND_REMOVE) 会按同一个 NOTIF_ID 把通知一并删掉，
     * 所以「先 notify 完成通知、再 stopForeground」等于自己把刚发的通知抹了 ——
     * 用户下完一个包，通知栏什么都没有，正是这个原因。
     */
    private void finishWith(String title, String path, long bytes, long ms, String error) {
        boolean cancelled = DownloadHub.isCancelled();
        detachForeground();

        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                if (cancelled) {
                    // 用户自己按的取消，通知留着只会碍眼
                    nm.cancel(NOTIF_ID);
                } else if (error != null) {
                    NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                            .setSmallIcon(android.R.drawable.stat_notify_error)
                            .setContentTitle("下载中断")
                            .setContentText(NotifText.oneLine(error, 120))
                            .setStyle(new NotificationCompat.BigTextStyle().bigText(NotifText.oneLine(error, 120)))
                            .setAutoCancel(true)
                            .setOnlyAlertOnce(true)
                            .setShowWhen(true)
                            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                            .setContentIntent(openApp());
                    nm.notify(NOTIF_ID, b.build());
                } else {
                    String name = DownloadHub.snapshot().fileName;
                    String text = NotifText.bytes(bytes);
                    if (ms > 0) text += " · 用时 " + NotifText.eta(Math.max(1, ms / 1000));
                    boolean apk = path != null && path.toLowerCase(Locale.US).endsWith(".apk");

                    NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                            .setSmallIcon(android.R.drawable.stat_sys_download_done)
                            .setContentTitle(title == null ? "下载完成" : title)
                            .setContentText(name)
                            .setSubText(text)
                            .setAutoCancel(true)
                            .setOnlyAlertOnce(true)
                            .setShowWhen(true)
                            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                            // APK 点通知就是安装，其它类型进 App 看记录
                            .setContentIntent(apk ? installIntent(path) : openApp());
                    if (apk) b.addAction(0, "安装", installIntent(path));
                    nm.notify(NOTIF_ID, b.build());
                }
            }
        } catch (Exception ignored) {
            // 同上
        }
        stopSelf();
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

    /** 脱离前台但把通知留在状态栏，让随后的终态通知能正常显示 */
    private void detachForeground() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_DETACH);
            } else {
                stopForeground(false);
            }
        } catch (Exception ignored) {
            // 已经不在前台就无所谓
        }
        foreground = false;
    }

    private void stopSelfSafe() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {
            // 同上
        }
        foreground = false;
        stopSelf();
    }

}
