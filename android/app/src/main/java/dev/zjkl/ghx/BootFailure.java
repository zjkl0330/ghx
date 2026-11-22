package dev.zjkl.ghx;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.webkit.WebView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * 启动失败时的记录与提示。
 *
 * <p>只做两件事，**不在界面上加任何调试面板**：
 *
 *  1. 进程级崩溃处理器：把栈落到 {@code files/crash.txt}，方便事后取；
 *  2. 启动真的走不下去时（super.onCreate 抛异常这类），用 Toast + 原生对话框
 *     告诉用户一句人话。
 *
 * <p>排查用的「上次 App 是这么退出的」整屏面板、启动阶段流水账、白屏探针都已删除 ——
 * 那个空指针修掉之后它们没有存在意义，留着只会挡住正常界面。
 */
final class BootFailure {

    static final String FILE_NAME = "boot-failure.txt";
    /** 崩溃栈单独一个文件，免得被普通日志覆盖 */
    static final String CRASH_FILE = "crash.txt";

    private static volatile boolean sinkInstalled;

    private BootFailure() {}

    /**
     * 装上进程级崩溃处理器。
     *
     * <p>在 {@link GhxApplication#attachBaseContext} 里调用：那时 MainActivity
     * 这个类可能还没被加载，装在 Activity 里会漏掉类加载阶段的崩溃。
     */
    static void installCrashSink(Context context) {
        if (sinkInstalled) return;
        sinkInstalled = true;
        final Context app = context.getApplicationContext() == null
                ? context : context.getApplicationContext();
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread t, Throwable e) {
                try {
                    writeNamed(app, CRASH_FILE, describe(app, "uncaught:" + t.getName(), e));
                } catch (Throwable ignored) {
                    // 已经要死了，记不上也没别的办法
                }
                if (prev != null) prev.uncaughtException(t, e);
            }
        });
    }

    /** 非致命：只落盘，不打扰用户（例如插件登记失败，页面还能开） */
    static void note(Activity act, String stage, Throwable t) {
        writeNamed(act, FILE_NAME, describe(act, stage, t));
    }

    /** 致命：主流程挂了，给用户一句能看懂的话 */
    static void show(Activity act, String stage, Throwable t) {
        String brief = "启动失败（" + stage + "）：" + shortReason(t);
        try {
            Toast.makeText(act.getApplicationContext(), brief, Toast.LENGTH_LONG).show();
        } catch (Throwable ignored) {
            // 没有 Looper 的极端情况下 Toast 也会失败
        }
        writeNamed(act, FILE_NAME, describe(act, stage, t));
        try {
            AlertDialog dlg = new AlertDialog.Builder(act)
                    .setTitle("ghx 启动失败")
                    .setMessage(brief + "\n\n详细信息已写入应用目录下的 crash.txt")
                    .setPositiveButton("关闭", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            act.finish();
                        }
                    })
                    .setCancelable(false)
                    .create();
            dlg.show();
        } catch (Throwable ignored) {
            // 窗口令牌失效时弹不出来，Toast 已经说过了
        }
    }

    /* ---------------- 文本 ---------------- */

    private static String describe(Context ctx, String stage, Throwable t) {
        StringBuilder sb = new StringBuilder(1024);
        sb.append("阶段: ").append(stage == null ? "?" : stage).append('\n');
        sb.append("时间: ").append(new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss",
                java.util.Locale.US).format(new java.util.Date())).append('\n');
        sb.append("版本: ").append(versionName(ctx)).append('\n');
        sb.append(env()).append('\n');
        sb.append("---- 异常 ----\n");
        sb.append(stackOf(t));
        return sb.toString();
    }

    private static String shortReason(Throwable t) {
        if (t == null) return "未知";
        String m = t.getMessage();
        String n = t.getClass().getSimpleName();
        if (m == null || m.trim().isEmpty()) return n;
        if (m.length() > 120) m = m.substring(0, 120) + "…";
        return n + ": " + m;
    }

    private static String stackOf(Throwable t) {
        if (t == null) return "(null)";
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        try {
            t.printStackTrace(pw);
            pw.flush();
        } catch (Throwable ignored) {
            return String.valueOf(t);
        }
        String s = sw.toString();
        if (s.length() > 8000) s = s.substring(0, 8000) + "\n…（已截断）";
        return s;
    }

    /** 环境快照，写进日志用：WebView 版本是这类问题的关键线索 */
    private static String env() {
        StringBuilder sb = new StringBuilder(320);
        try {
            sb.append("Android ").append(Build.VERSION.RELEASE)
              .append(" (API ").append(Build.VERSION.SDK_INT).append(')').append('\n');
            sb.append("设备: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n');
            if (Build.SUPPORTED_ABIS != null && Build.SUPPORTED_ABIS.length > 0) {
                sb.append("ABI: ").append(Build.SUPPORTED_ABIS[0]).append('\n');
            }
            sb.append("WebView: ").append(webViewInfo()).append('\n');
            sb.append("存储: ").append(storage()).append('\n');
        } catch (Throwable e) {
            sb.append("环境读取失败: ").append(e).append('\n');
        }
        return sb.toString();
    }

    private static String webViewInfo() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return "API < 26，无法查询";
        }
        try {
            PackageInfo p = WebView.getCurrentWebViewPackage();
            if (p == null) return "** 系统里没有可用的 WebView 实现 **";
            String v = p.versionName == null ? "?" : p.versionName;
            return p.packageName + " " + v;
        } catch (Throwable e) {
            return "读取失败: " + shortReason(e);
        }
    }

    private static String storage() {
        try {
            File data = Environment.getDataDirectory();
            StatFs fs = new StatFs(data.getPath());
            long free = fs.getAvailableBytes();
            long total = fs.getTotalBytes();
            if (total <= 0) return "未知";
            return mb(free) + " 可用 / " + mb(total) + " 总计";
        } catch (Throwable e) {
            return "未知";
        }
    }

    private static String mb(long bytes) {
        return String.format(java.util.Locale.US, "%.0f MB", bytes / 1048576.0);
    }

    private static String versionName(Context ctx) {
        try {
            PackageInfo p = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            String n = p.versionName == null ? "?" : p.versionName;
            long code = Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
            return n + " (" + code + ")";
        } catch (Throwable e) {
            return "?";
        }
    }

    /* ---------------- 落盘 ---------------- */

    private static void writeNamed(Context ctx, String name, String text) {
        try {
            writeTo(ctx.getExternalFilesDir(null), name, text);
        } catch (Throwable ignored) {
            // 外部目录没挂载就只留私有目录那份
        }
        try {
            writeTo(ctx.getFilesDir(), name, text);
        } catch (Throwable ignored) {
            // 私有目录也写不进去就算了
        }
    }

    private static void writeTo(File dir, String name, String text) {
        if (dir == null) return;
        FileOutputStream out = null;
        try {
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, name);
            out = new FileOutputStream(f, false);
            out.write(text.getBytes("UTF-8"));
            out.flush();
        } catch (Throwable ignored) {
            // 兜底路径，失败就失败
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (Throwable ignored) {
                    // 同上
                }
            }
        }
    }
}
