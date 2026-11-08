package dev.zjkl.ghx;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** 上一次注入给页面的内边距（CSS px）。相同就不重复 evaluate，避免每次布局都过一遍 JS 桥。 */
    private int lastTop = -1;
    private int lastBottom = -1;
    private int lastLeft = -1;
    private int lastRight = -1;
    private int lastKeyboard = -1;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自定义插件要在 super 之前登记：BridgeActivity 在 onCreate 里就把 Bridge 建好了。
        registerPlugin(ImmersivePlugin.class);

        // 必须先 super：BridgeActivity 会在这里把主题从启动屏主题切到 AppTheme.NoActionBar，
        // 切换会重新 apply 一遍窗口属性。反过来先设窗口再 super，颜色会被主题覆盖回去。
        super.onCreate(savedInstanceState);

        Window window = getWindow();

        /*
         * 铺满全屏（edge-to-edge）：让内容画到状态栏与导航栏下面，再由 WebView 里的
         * --safe-* 变量把可点区域让开。
         *
         * Android 15（API 35）对 targetSdk 35 是强制 edge-to-edge，但老系统不会自动：
         * 少了这一句，Android 14 及以下仍然把 WebView 夹在两条系统栏中间，
         * 顶部一条底色、底部一条底色，看起来就是「没全屏」。
         *
         * 注意别和 Capacitor 的 adjustMarginsForEdgeToEdge 撞车 —— 那个开关会给
         * WebView 直接加四边 margin（内容被整体推离系统栏，页面里再拿 insets 就是重复让位）。
         * 我们在 capacitor.config.ts 里显式 disable 掉它，改成「WebView 铺满 + CSS 变量」。
         */
        WindowCompat.setDecorFitsSystemWindows(window, false);

        // 系统栏全透明，露出来的就是页面自己的底色；页面滚动时内容会从栏下面穿过。
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10 会给透明的系统栏自动盖一层「对比度遮罩」，深色页面上就是一条灰带
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // 刘海/挖孔区域也允许绘制，否则竖屏顶部与横屏左右会各留一条黑边
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }

        // viewport 里的 user-scalable=no 在部分 WebView 上会被忽略，这里再关一次。
        // 双指放大后整页布局被拉大，悬浮玻璃底栏的模糊采样范围跟着变，
        // 身后的正文就会从底栏里透出来，所以手势缩放必须彻底关掉。
        // 不要动 setTextZoom：那是系统「字体大小」的通道，关掉会伤到无障碍。
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // WebView 自身透明，启动那一瞬与横屏底部不会露出窗口底色
        webView.setBackgroundColor(Color.TRANSPARENT);

        /*
         * 把真实 insets 交给页面。
         *
         * 为什么不直接靠 CSS 的 env(safe-area-inset-*)：Android WebView 对这个函数的
         * 支持并不稳定（多数机型恒为 0），页面于是以为「没有系统栏」，顶部内容被状态栏压住。
         * 这里量一次、写成 --inset-*，CSS 里再和 env() 取 max —— 两边谁给了值就用谁，
         * 也不会出现「重复让位」（max 不是相加）。
         *
         * Capacitor 自己的 CapacitorWebView 只在 adjustMarginsForEdgeToEdge 为 auto/force
         * 时才注册监听；本项目是 disable，这里不会盖掉别人。
         */
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            /*
             * 键盘也得自己让位。
             * decorFitsSystemWindows(false) 之后，adjustResize 不再帮我们缩小窗口，
             * 输入法只会作为 ime insets 报上来。不处理的话搜索框、令牌输入框弹出键盘时
             * 会被整个盖住 —— 这是全屏铺满最容易踩的坑。
             * 判据是 ime.bottom 是否超过系统栏：手势条高度在键盘收起时也非零。
             */
            int keyboard = ime.bottom > bars.bottom ? ime.bottom : 0;
            pushInsets(bars.top, bars.bottom, bars.left, bars.right, keyboard);
            // 不消费：别的监听者（输入法、键盘避让）还要用这份 insets
            return windowInsets;
        });

        // 冷启动兜底：insets 回调可能早于页面脚本执行，那时 evaluateJavascript 落空。
        // 页面加载完不会再有 insets 变化，所以补两次延时注入。
        final WebView wv = webView;
        wv.postDelayed(() -> repush(wv), 400);
        wv.postDelayed(() -> repush(wv), 1600);
    }

    private void repush(WebView webView) {
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
        if (insets == null) return;
        Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        pushInsets(bars.top, bars.bottom, bars.left, bars.right,
                ime.bottom > bars.bottom ? ime.bottom : 0);
    }

    /**
     * 把 insets 换成 CSS px 写到 :root 上。
     * 用 density 而不是 scaledDensity —— 布局单位不跟系统字体缩放走。
     */
    private void pushInsets(int top, int bottom, int left, int right, int keyboard) {
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) density = 1f;
        int t = Math.round(top / density);
        int b = Math.round(bottom / density);
        int l = Math.round(left / density);
        int r = Math.round(right / density);
        int k = Math.round(keyboard / density);

        if (t == lastTop && b == lastBottom && l == lastLeft && r == lastRight && k == lastKeyboard) {
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
        WebView webView = getBridge().getWebView();
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
}
