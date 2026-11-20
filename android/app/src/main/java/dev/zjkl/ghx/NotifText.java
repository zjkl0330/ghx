package dev.zjkl.ghx;

import java.util.Locale;

/**
 * 通知栏上那几行字。
 *
 * 单独抽出来只为一个原因：这些格式化最容易在小地方出错 —— 速度还是 0 时算剩余时间
 * 会除出无穷、99.6% 被截成 99%、长文件名一截把 .apk 吃掉。它们不依赖 android.*，
 * 于是可以在普通 JVM 上真跑测试，而不用靠肉眼盯着一部手机。
 */
final class NotifText {

    private NotifText() {}

    static String bytes(long b) {
        if (b < 1024) return b + " B";
        if (b < 1024L * 1024) return String.format(Locale.US, "%.1f KB", b / 1024.0);
        if (b < 1024L * 1024 * 1024) return String.format(Locale.US, "%.1f MB", b / 1024.0 / 1024.0);
        return String.format(Locale.US, "%.2f GB", b / 1024.0 / 1024.0 / 1024.0);
    }

    /** kbps 是 KB/s（不是 kb/s） */
    static String speed(double kbps) {
        if (kbps < 1024) return String.format(Locale.US, "%.0f KB/s", kbps);
        return String.format(Locale.US, "%.1f MB/s", kbps / 1024.0);
    }

    /**
     * 剩余秒数。速度还没测出来、或者已经下完，都返回 -1 表示「别显示」。
     *
     * 刚起步那几百毫秒速度可能是 0，若不加判断就会算出 Infinity，再被格式化成一个
     * 荒唐的剩余时间。上限压到 24 小时：链路假死时算出来的动辄几百天，显示它没有意义。
     */
    static long etaSeconds(long done, long total, double kbps) {
        if (kbps <= 0 || total <= 0 || total <= done) return -1;
        double bytesPerSec = kbps * 1024.0;
        long sec = (long) Math.ceil((total - done) / bytesPerSec);
        if (sec < 0) return -1;
        return Math.min(sec, 24 * 3600);
    }

    static String eta(long sec) {
        if (sec < 0) return "";
        if (sec < 60) return sec + " 秒";
        if (sec < 3600) {
            long m = sec / 60;
            long s = sec % 60;
            return s == 0 ? m + " 分钟" : m + " 分 " + s + " 秒";
        }
        long h = sec / 3600;
        long m = (sec % 3600) / 60;
        return m == 0 ? h + " 小时" : h + " 小时 " + m + " 分";
    }

    /** 进度百分比：向下取整，避免 99.6% 显示成 100% 却还在下 */
    static int percent(long done, long total) {
        if (total <= 0) return 0;
        long p = done * 100 / total;
        if (p < 0) return 0;
        return (int) Math.min(100, p);
    }

    /**
     * 截断文件名但留住扩展名。
     *
     * 通知标题只放得下一行，长名字必然被切；直接 substring 会把 .apk 切掉，
     * 用户就看不出这是个安装包。扩展名超过 6 个字符的按「没有扩展名」处理。
     */
    static String shortName(String raw, int max) {
        String s = raw == null ? "" : raw.trim();
        if (s.length() <= max) return s;
        int dot = s.lastIndexOf('.');
        String ext = dot > 0 && s.length() - dot <= 7 ? s.substring(dot) : "";
        int keep = max - ext.length() - 1;
        if (keep <= 0) return s.substring(0, max);
        return s.substring(0, keep) + "…" + ext;
    }

    /** 失败原因压成一行；换行在通知里会被吃掉，先自己抹平 */
    static String oneLine(String raw, int max) {
        String s = raw == null ? "下载失败" : raw.replace('\n', ' ').replace('\r', ' ').trim();
        if (s.isEmpty()) s = "下载失败";
        return s.length() <= max ? s : s.substring(0, Math.max(0, max - 1)) + "…";
    }
}
