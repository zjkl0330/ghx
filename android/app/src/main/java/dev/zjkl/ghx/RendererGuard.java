package dev.zjkl.ghx;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.WebViewListener;

/**
 * WebView 渲染进程的兜底。
 *
 * 为什么需要：网页渲染进程（WebView renderer）被杀时，Capacitor 默认返回 false，
 * Android 会把整个 App 进程一起带走 —— 用户看到的就是「图标一闪就回桌面」，
 * Java 层的 UncaughtExceptionHandler 完全接不到，v1.1.4 的启动失败弹窗也不会出现。
 *
 * 这里做三件事：
 *  1. 返回 true，先把 App 进程保住；
 *  2. 把 didCrash / 崩溃前优先级 / URL 落盘，便于定位；
 *  3. 弹一个原生对话框，让用户选择「重新加载」或「兼容模式重启」。
 *     兼容模式用系统字体并关闭毛玻璃，避开最可能的两处内存/GPU 压力源。
 *
 * 兼容模式通过 {@code ?safe=1} 传给网页；页面在首屏内联脚本里读，React 还没
 * 挂载就已经生效，不会先加载 22 MB 内置字体。
 */
final class RendererGuard extends WebViewListener {

    private static final String PREFS = "ghx.boot";
    private static final String KEY_SAFE = "safe";
    private static final String KEY_NOTICE = "safe-notice";
    /** 渲染进程崩过：下次启动先清 WebView 缓存，排除升级残留/坏缓存这一层 */
    private static final String KEY_CLEAR = "clear-cache";
    /** 上次启动的 versionCode：变了就清一次缓存 */
    private static final String KEY_VERSION = "version";

    private final MainActivity act;

    /**
     * 兼容模式下只改一次地址。
     * onPageStarted 里拿到的 getUrl() 在跳转过程中可能是旧值，不设闸就会来回重载。
     */
    private boolean redirected = false;

    /** 同一次崩溃只弹一个对话框，避免回调重复触发时叠窗 */
    private boolean handlingGone = false;

    RendererGuard(MainActivity act) {
        this.act = act;
    }

    static boolean isSafe(Context ctx) {
        return prefs(ctx).getBoolean(KEY_SAFE, false);
    }

    static void setSafe(Context ctx, boolean safe) {
        prefs(ctx).edit()
                .putBoolean(KEY_SAFE, safe)
                // 每次重新进入兼容模式都再说明一次，退出时把标记一并清掉
                .putBoolean(KEY_NOTICE, false)
                .apply();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 记一笔「下次启动要清缓存」；取走即清，避免每次启动都清一遍。 */
    static void markClear(Context ctx) {
        prefs(ctx).edit().putBoolean(KEY_CLEAR, true).apply();
    }

    static boolean takeClear(Context ctx) {
        SharedPreferences sp = prefs(ctx);
        boolean clear = sp.getBoolean(KEY_CLEAR, false);
        if (clear) sp.edit().putBoolean(KEY_CLEAR, false).apply();
        return clear;
    }

    /**
     * 版本号变了就返回 true。覆盖升级时 WebView 的 HTTP/资源缓存可能还留着
     * 上一个包的东西，个别 ROM 会直接把渲染进程带崩 —— 这里清一次最省事。
     */
    static boolean versionChanged(Context ctx, long code) {
        if (code <= 0) return false;
        SharedPreferences sp = prefs(ctx);
        long last = sp.getLong(KEY_VERSION, 0L);
        if (last == code) return false;
        sp.edit().putLong(KEY_VERSION, code).apply();
        // 首次安装没有「上一版缓存」可清，不需要多一次重载
        return last != 0L;
    }

    /** 把 safe=1 拼到应用地址上；已经带了就不重复。 */
    static String withSafe(String url) {
        if (url == null || url.isEmpty() || url.contains("safe=1")) return url;
        // WebViewAssetLoader 不认「空 path」，https://localhost?x=1 要先补成 /?x=1
        int scheme = url.indexOf("://");
        String afterAuthority = scheme >= 0 ? url.substring(scheme + 3) : url;
        if (afterAuthority.indexOf('/') < 0) {
            int q = url.indexOf('?');
            url = q >= 0 ? url.substring(0, q) + "/" + url.substring(q) : url + "/";
        }
        return url + (url.indexOf('?') >= 0 ? "&" : "?") + "safe=1";
    }

    /**
     * 兼容模式下，第一帧就不要以正常模式跑起来。
     *
     * 监听注册发生在 super.onCreate 之后，首页可能已经开始加载；这里在页面刚开始
     * 时立刻改地址，抢在 CSS/JS 请求之前生效。
     */
    @Override
    public void onPageStarted(WebView view) {
        if (!isSafe(act) || redirected) return;
        final String url = view.getUrl();
        final String base = act.getBridge() == null ? null : act.getBridge().getAppUrl();
        if (url == null || base == null || !url.startsWith(base) || url.contains("safe=1")) return;
        redirected = true;
        view.post(() -> {
            try {
                view.stopLoading();
                view.loadUrl(withSafe(url));
            } catch (Throwable ignored) {
                // 改地址失败也不该变成新的崩溃源
            }
        });
    }

    /** 清完缓存或已知要进兼容模式时，用指定地址重载一次。 */
    void reload(WebView view, String url) {
        redirected = true;
        view.post(() -> {
            try {
                view.stopLoading();
                view.loadUrl(url);
            } catch (Throwable ignored) {
                // onPageStarted 那层已经让路，这里失败只能交给原生兜底
            }
        });
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        if (handlingGone) return true;
        handlingGone = true;
        String reason;
        try {
            reason = "didCrash=" + detail.didCrash();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reason += ", priority=" + detail.rendererPriorityAtExit();
            }
        } catch (Throwable t) {
            reason = String.valueOf(detail);
        }
        String url = "";
        try {
            url = view.getUrl();
        } catch (Throwable ignored) {
            // 渲染进程已经没了，取不到 URL 也不影响提示
        }
        final String summary = reason + ", url=" + url;
        BootFailure.note(act, "render-process-gone", new IllegalStateException(summary));
        markClear(act);
        showRecovery(summary);
        // true = 状态已处理，别让系统把 App 进程一起杀掉
        return true;
    }

    private void showRecovery(String summary) {
        if (act.isFinishing() || act.isDestroyed()) return;
        try {
            new AlertDialog.Builder(act)
                    .setTitle("页面渲染进程已退出")
                    .setMessage("ghx 的网页渲染进程被系统终止了（" + summary + "）。\n\n"
                            + "这通常是内存不足或 WebView 内核异常。可以先重新加载；"
                            + "如果反复出现，用兼容模式重启（系统字体、关闭毛玻璃、精简动效）。")
                    .setPositiveButton("兼容模式重启", (d, w) -> {
                        setSafe(act, true);
                        restart();
                    })
                    .setNeutralButton("重新加载", (d, w) -> restart())
                    .setNegativeButton("退出", (d, w) -> act.finish())
                    .setCancelable(false)
                    .show();
        } catch (Throwable t) {
            BootFailure.show(act, "render-process-gone", new IllegalStateException(summary, t));
        }
    }

    /** 兼容模式第一次启动时说明一次，并给一条退回正常模式的路。 */
    static void explainOnce(MainActivity act) {
        if (!isSafe(act)) return;
        SharedPreferences sp = prefs(act);
        if (sp.getBoolean(KEY_NOTICE, false)) return;
        sp.edit().putBoolean(KEY_NOTICE, true).apply();
        try {
            new AlertDialog.Builder(act)
                    .setTitle("已进入兼容模式")
                    .setMessage("上次启动时网页渲染进程异常退出。兼容模式使用系统字体、关闭毛玻璃并精简动效，"
                            + "用来避开这类崩溃。\n\n正常模式如果已经可用，可以现在退回去。")
                    .setPositiveButton("保持兼容模式", null)
                    .setNegativeButton("恢复正常模式", (d, w) -> {
                        setSafe(act, false);
                        restart();
                    })
                    .setCancelable(true)
                    .show();
        } catch (Throwable ignored) {
            // 弹不出来也不影响兼容模式本身
        }
    }

    /** 重建 Activity 就是重建 WebView 与渲染进程；失败时把原因摆出来，别静默退出。 */
    private void restart() {
        try {
            act.recreate();
        } catch (Throwable t) {
            BootFailure.show(act, "renderer-restart", t);
        }
    }
}
