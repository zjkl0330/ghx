package dev.zjkl.ghx;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
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
 * 启动失败时说人话。
 *
 * 为什么需要这个类：App 打不开时，能拿到的唯一信息是「闪一下就回桌面」——
 * 没有 logcat 就完全抓瞎。这里把三件事同时做掉：
 *
 *  1. 用 Toast 抢在前头显示一行摘要（Toast 不依赖 WebView，也不依赖页面）；
 *  2. 弹一个纯原生对话框，把完整原因摊开，可一键复制；
 *  3. 落到 {@code Android/data/<包名>/files/boot-failure.txt} 与应用私有目录各一份，
 *     免得对话框也被系统拦掉时什么都留不下。
 *
 * 全部调用都包了 try：这个类本身就是「兜底」，它自己再抛异常就没有意义了。
 */
final class BootFailure {

    static final String FILE_NAME = "boot-failure.txt";

    private BootFailure() {}

    /** 致命：主流程挂了，把原因摆到屏幕上 */
    static void show(Activity act, String stage, Throwable t) {
        String text = describe(act, stage, t);
        String brief = "启动失败（" + stage + "）：" + shortReason(t);

        try {
            Toast.makeText(act.getApplicationContext(), brief, Toast.LENGTH_LONG).show();
        } catch (Throwable ignored) {
            // Toast 在没有 Looper 的极端情况下也会失败，继续走落盘
        }

        write(act, text);

        try {
            final String payload = text;
            final Activity host = act;
            AlertDialog dlg = new AlertDialog.Builder(act)
                    .setTitle("ghx 启动失败")
                    .setMessage(text)
                    .setPositiveButton("复制详情", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            copy(host, payload);
                        }
                    })
                    .setNegativeButton("关闭", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            host.finish();
                        }
                    })
                    .setCancelable(false)
                    .create();
            dlg.show();
        } catch (Throwable ignored) {
            // super.onCreate 失败时窗口令牌可能无效，弹窗会 BadTokenException —— 上面已有 Toast 与文件
        }
    }

    /** 非致命：只落盘，不打扰用户（例如插件登记失败，页面还能开） */
    static void note(Activity act, String stage, Throwable t) {
        write(act, describe(act, stage, t));
    }

    /* ---------------- 文本 ---------------- */

    private static String describe(Activity act, String stage, Throwable t) {
        StringBuilder sb = new StringBuilder(1024);
        sb.append("阶段: ").append(stage == null ? "?" : stage).append('\n');
        sb.append("时间: ").append(new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss",
                java.util.Locale.US).format(new java.util.Date())).append('\n');
        sb.append("版本: ").append(versionName(act)).append('\n');
        sb.append(env(act)).append('\n');
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
        // 对话框里放太长会卡在渲染上，留最上面的调用栈就够定位
        if (s.length() > 2400) s = s.substring(0, 2400) + "\n…（已截断）";
        return s;
    }

    /**
     * 环境快照。WebView 那一行是重点：
     * 系统 WebView 被停用、被降级、或版本低于页面要求的语法级别时，
     * 表现就是「打开就退」，而这条信息在设置页里找不到。
     */
    private static String env(Activity act) {
        StringBuilder sb = new StringBuilder(320);
        try {
            sb.append("Android ").append(Build.VERSION.RELEASE)
              .append(" (API ").append(Build.VERSION.SDK_INT).append(')').append('\n');
            sb.append("设备: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n');
            String abi = "?";
            if (Build.SUPPORTED_ABIS != null && Build.SUPPORTED_ABIS.length > 0) {
                abi = Build.SUPPORTED_ABIS[0];
            }
            sb.append("ABI: ").append(abi).append('\n');
            sb.append("WebView: ").append(webViewInfo()).append('\n');
            sb.append("存储: ").append(storage()).append('\n');
        } catch (Throwable e) {
            sb.append("环境读取失败: ").append(e).append('\n');
        }
        return sb.toString();
    }

    static String webViewInfo() {
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

    private static String versionName(Activity act) {
        try {
            PackageInfo p = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
            String n = p.versionName == null ? "?" : p.versionName;
            long code = Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
            return n + " (" + code + ")";
        } catch (Throwable e) {
            return "?";
        }
    }

    /* ---------------- 落盘 ---------------- */

    private static void write(Activity act, String text) {
        try {
            File ext = act.getExternalFilesDir(null);
            writeTo(ext, text);
        } catch (Throwable ignored) {
            // 外部目录没挂载就只留私有目录那份
        }
        try {
            writeTo(act.getFilesDir(), text);
        } catch (Throwable ignored) {
            // 私有目录也写不进去时，屏幕上那份仍然有效
        }
    }

    private static void writeTo(File dir, String text) {
        if (dir == null) return;
        FileOutputStream out = null;
        try {
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, FILE_NAME);
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

    private static void copy(Context ctx, String text) {
        try {
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) return;
            cm.setPrimaryClip(ClipData.newPlainText("ghx boot failure", text));
            Toast.makeText(ctx.getApplicationContext(), "已复制", Toast.LENGTH_SHORT).show();
        } catch (Throwable ignored) {
            // 复制失败不影响用户手动截图
        }
    }
}
