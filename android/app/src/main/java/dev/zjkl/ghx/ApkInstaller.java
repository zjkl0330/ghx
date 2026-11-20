package dev.zjkl.ghx;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import java.io.File;
import java.util.Locale;

/**
 * 调起系统安装器。
 *
 * 单独抽出来是因为有两个入口：页面里点「安装」（走 Plugin），
 * 和通知栏上点「安装」（走 MainActivity 的 intent）。逻辑重复一遍迟早会漂。
 *
 * Android 8 起安装未知来源应用要逐应用授权，没授权直接 startActivity 会被系统
 * 静默丢掉（用户只看到「点了没反应」）。所以先查 canRequestPackageInstalls，
 * 没有就跳到本应用的「安装未知应用」设置页，并告诉调用方 needPermission。
 */
final class ApkInstaller {

    static final class Result {
        /** 安装器已经起来了 */
        boolean opened;
        /** 缺「安装未知应用」授权，已把用户送到设置页 */
        boolean needPermission;
        String error;
    }

    private ApkInstaller() {}

    static Result install(Activity act, String path) {
        Result r = new Result();
        if (act == null) {
            r.error = "界面已关闭";
            return r;
        }
        if (path == null || path.trim().isEmpty()) {
            r.error = "缺少文件路径";
            return r;
        }
        File f = new File(path);
        if (!f.exists() || f.length() <= 0) {
            r.error = "安装包不存在或为空";
            return r;
        }
        if (!path.toLowerCase(Locale.US).endsWith(".apk")) {
            r.error = "不是 APK 文件";
            return r;
        }

        try {
            if (!canInstall(act)) {
                // 用户授权后会回到本应用，由 MainActivity 在 onResume 里补一次安装
                act.startActivity(new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + act.getPackageName())));
                r.needPermission = true;
                return r;
            }

            Uri uri = FileProvider.getUriForFile(
                    act, act.getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
            r.opened = true;
            return r;
        } catch (Exception e) {
            r.error = "无法调起安装器：" + e.getMessage();
            return r;
        }
    }

    /** 「安装未知应用」是否已放行；Android 8 以下不存在这个开关 */
    static boolean canInstall(Activity act) {
        if (act == null) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return act.getPackageManager().canRequestPackageInstalls();
    }
}
