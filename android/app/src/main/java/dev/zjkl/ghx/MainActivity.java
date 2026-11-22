package dev.zjkl.ghx;

import android.content.Intent;
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

    /** 通知栏「安装」按钮带过来的安装包路径 */
    static final String EXTRA_INSTALL_PATH = "dev.zjkl.ghx.INSTALL_PATH";

    /** 待安装的包：授权「安装未知应用」会离开本页，回来时要接着装 */
    private String pendingInstall;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /*
         * 第一件事：给整个进程装一个兜底处理器。
         *
         * 打不开的 App 只能给出「闪一下回桌面」这一条线索，没有 adb 就完全没法定位。
         * 这里在任何东西之前登记，之后无论崩在主线程还是下载线程，都会先把栈写进
         * Android/data/<包名>/files/boot-failure.txt，再把异常交回系统原本的处理器
         * （不吞异常，否则系统会当成没崩，卡住不弹「已停止」）。
         */
        installCrashSink();

        // 自定义插件要在 super 之前登记：BridgeActivity 在 onCreate 里就把 Bridge 建好了。
        // 登记失败不该拖垮整个启动 —— 网页层发现插件缺失会自己降级成「浏览器下载」。
        try {
            registerPlugin(ImmersivePlugin.class);
            registerPlugin(DownloadPlugin.class);
        } catch (Throwable t) {
            BootFailure.note(this, "registerPlugin", t);
        }

        // 必须先 super：BridgeActivity 会在这里把主题从启动屏主题切到 AppTheme.NoActionBar，
        // 切换会重新 apply 一遍窗口属性。反过来先设窗口再 super，颜色会被主题覆盖回去。
        try {
            super.onCreate(savedInstanceState);
        } catch (Throwable t) {
            // WebView 初始化失败、主题资源缺失、Bridge 装配异常都落在这里
            BootFailure.show(this, "super.onCreate", t);
            return;
        }

        try {
            setupWindow();
        } catch (Throwable t) {
            // 已经进了页面就还能用，全屏/insets 出问题只影响观感
            BootFailure.note(this, "setupWindow", t);
        }

        // 从通知栏的「安装」进来的
        try {
            handleInstallIntent(getIntent());
        } catch (Throwable t) {
            BootFailure.note(this, "handleInstallIntent", t);
        }
    }

    /**
     * 进程级兜底：先落盘，再交回系统。
     *
     * 只在 Activity 存在期间有意义 —— 进程被杀之后重新启动，onCreate 会再装一次，
     * 所以不需要考虑「上一次的处理器还挂着」。
     */
    private void installCrashSink() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        final MainActivity host = this;
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread t, Throwable e) {
                try {
                    BootFailure.note(host, "uncaught:" + t.getName(), e);
                } catch (Throwable ignored) {
                    // 已经要死了，记不上也没别的办法
                }
                if (prev != null) prev.uncaughtException(t, e);
            }
        });
    }

    /**
     * 窗口与 insets 的初始化。从原来的 onCreate 主体原样搬出来，
     * 外面套一层 try —— 这一段依赖 Bridge 已经装好，是最容易 NPE 的地方。
     */
    private void setupWindow() {
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
            InsetsBridge.apply(this, webView, bars.top, bars.bottom, bars.left, bars.right, keyboard, false);
            // 不消费：别的监听者（输入法、键盘避让）还要用这份 insets
            return windowInsets;
        });

        /*
         * 启动兜底：必须 force。
         *
         * insets 回调大多发生在页面开始加载之前，那一次 evaluateJavascript 跑在 about:blank 上，
         * 变量随着导航到 https://localhost/ 一起消失。而「值没变就不推」的去重会让后面的补推
         * 直接 return —— v0.6.7 之前顶栏被状态栏压住就是这个原因。
         *
         * 四次覆盖前 5 秒：本地资源一般 1 秒内加载完，慢机型也不会超过 5 秒。
         * 之后由 onResume 与 JS 主动调用 Immersive.syncInsets 兜后续场景。
         */
        webView.postDelayed(() -> InsetsBridge.sync(this, true), 300);
        webView.postDelayed(() -> InsetsBridge.sync(this, true), 900);
        webView.postDelayed(() -> InsetsBridge.sync(this, true), 2000);
        webView.postDelayed(() -> InsetsBridge.sync(this, true), 4000);

        /*
         * 白屏自检。
         *
         * 有一种坏法不会抛异常，也没有崩溃栈：进程好好的，WebView 就是一点进度都没有，
         * 用户看到黑屏，以为是「闪退」。本地资源正常情况下一两秒就加载完，
         * 8 秒还是 0 基本可以断定页面没跑起来（WebView 内核异常、资源没进包、
         * 或者脚本一上来就语法错误）。这时候把原因摊出来，比让用户对着黑屏猜强。
         */
        webView.postDelayed(() -> {
            try {
                if (webView.getProgress() <= 0) {
                    BootFailure.show(this, "webview-load",
                            new IllegalStateException(
                                    "WebView 8 秒内没有任何加载进度，url=" + webView.getUrl()));
                }
            } catch (Throwable ignored) {
                // 自检本身失败就安静放弃，不要变成新的崩溃源
            }
        }, 8000);
    }

    /**
     * 通知栏点「安装」时，Activity 已经在栈里，走的是 onNewIntent 而不是 onCreate。
     * 不处理这一条，用户点了安装会「什么都没发生」。
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        try {
            handleInstallIntent(intent);
        } catch (Throwable t) {
            BootFailure.note(this, "onNewIntent", t);
        }
    }

    private void handleInstallIntent(Intent intent) {
        if (intent == null) return;
        String path = intent.getStringExtra(EXTRA_INSTALL_PATH);
        if (path == null || path.isEmpty()) return;
        // 消费掉：旋转屏幕、再次进前台都会重新派发 intent，不摘掉会反复弹安装器
        intent.removeExtra(EXTRA_INSTALL_PATH);
        pendingInstall = path;
        tryInstallPending();
    }

    private void tryInstallPending() {
        if (pendingInstall == null) return;
        ApkInstaller.Result r = ApkInstaller.install(this, pendingInstall);
        if (r.opened) {
            pendingInstall = null;
        } else if (r.needPermission) {
            // 用户被送到「安装未知应用」设置页，回来在 onResume 里重试
        } else {
            pendingInstall = null;
            if (r.error != null) {
                android.widget.Toast.makeText(this, r.error, android.widget.Toast.LENGTH_SHORT).show();
            }
        }
    }

    /**
     * 切回前台时补一次。
     * 用户可能在别的应用里改了系统栏样式（手势导航、隐藏状态栏、旋转锁定），
     * 回来时窗口不会重新派发 insets，页面里的变量就停在旧值上。
     */
    @Override
    public void onResume() {
        super.onResume();
        /*
         * 窗口标志再写一遍。
         * 主题切换、系统改手势导航、从分屏恢复，都可能让 decorFitsSystemWindows 回到默认值 ——
         * 一旦回到 true，insets 在派发到 WebView 之前就被 decor 消费掉，
         * 页面拿到的永远是 0。这一步是幂等的，代价只有一次属性赋值。
         *
         * 整段包 try：onCreate 走到一半崩过的话 Bridge 可能是 null，
         * 那时回到前台会在这里再崩一次，用户看到的就是「一打开就退」反复循环。
         */
        try {
            Window window = getWindow();
            WindowCompat.setDecorFitsSystemWindows(window, false);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            InsetsBridge.sync(this, true);
        } catch (Throwable t) {
            BootFailure.note(this, "onResume", t);
        }

        // 刚从「安装未知应用」设置页回来：放行了就接着装，不用用户再点一次
        try {
            if (pendingInstall != null && ApkInstaller.canInstall(this)) {
                tryInstallPending();
            }
        } catch (Throwable t) {
            BootFailure.note(this, "tryInstallPending", t);
        }
    }
}
