package dev.zjkl.ghx;

import android.app.Activity;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 把 WindowInsets 写成 CSS 变量（--inset-*），页面靠它们让开状态栏、导航栏与键盘。
 *
 * 为什么单独抽一个类：现在有三个入口会推同一份数据 —— 窗口的 insets 监听、
 * 启动后的几次补推、以及 JS 主动调用的 Immersive.syncInsets。
 * 同一个换算各写一遍，迟早有一处算错。
 *
 * 这个类修的是 v0.6.7 的一个真实 bug：
 * 原来 {@code pushInsets} 先按「值没变就不推」去重，再 post 到 WebView 执行 JS。
 * 冷启动时 insets 回调往往早于页面开始加载，那次 evaluateJavascript 落在 about:blank 上，
 * 变量随着导航一起丢了；等 400ms / 1600ms 的补推再来，值跟缓存里记的一样，
 * 被去重直接 return —— 于是 --inset-top 永久为空，顶栏被状态栏压住。
 * 所以补推必须能把「值没变」这种情况也重新写一遍，见 {@code force}。
 */
final class InsetsBridge {

    /** 上一次真正推进页面的值（CSS px）。-1 表示还没推过。 */
    private static int lastTop = -1;
    private static int lastBottom = -1;
    private static int lastLeft = -1;
    private static int lastRight = -1;
    private static int lastKeyboard = -1;

    private InsetsBridge() {}

    /**
     * 读取当前窗口 insets 并推送。
     *
     * @param force true 时忽略缓存值，无条件重写一遍变量 —— 页面导航之后必须这么做
     */
    static void sync(Activity activity, boolean force) {
        if (!(activity instanceof BridgeActivity)) return;
        WebView webView = ((BridgeActivity) activity).getBridge().getWebView();
        if (webView == null) return;

        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
        if (insets == null) return;

        Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        /*
         * 键盘的高度只在它确实盖住内容时才让位：手势条在键盘收起时也有几像素，
         * 直接拿 ime.bottom 会让页面长期多出一小条空白。
         */
        int keyboard = ime.bottom > bars.bottom ? ime.bottom : 0;
        apply(activity, webView, bars.top, bars.bottom, bars.left, bars.right, keyboard, force);
    }

    /**
     * 把像素值换成 CSS px 写到 :root 上。
     * 用 density 而不是 scaledDensity —— 布局单位不跟系统字体缩放走。
     */
    static void apply(Activity activity, WebView webView, int top, int bottom, int left, int right,
                      int keyboard, boolean force) {
        if (activity == null || webView == null) return;

        float density = activity.getResources().getDisplayMetrics().density;
        if (density <= 0f) density = 1f;
        int t = Math.round(top / density);
        int b = Math.round(bottom / density);
        int l = Math.round(left / density);
        int r = Math.round(right / density);
        int k = Math.round(keyboard / density);

        if (!force && t == lastTop && b == lastBottom && l == lastLeft && r == lastRight && k == lastKeyboard) {
            return;
        }
        lastTop = t;
        lastBottom = b;
        lastLeft = l;
        lastRight = r;
        lastKeyboard = k;

        String js = "(function(){var d=document.documentElement,s=d.style;"
                + "s.setProperty('--inset-top','" + t + "px');"
                + "s.setProperty('--inset-bottom','" + b + "px');"
                + "s.setProperty('--inset-left','" + l + "px');"
                + "s.setProperty('--inset-right','" + r + "px');"
                + "s.setProperty('--inset-ime','" + k + "px');"
                + "if(" + k + ">0){d.setAttribute('data-ime','1');}else{d.removeAttribute('data-ime');}"
                + "})();";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
}
