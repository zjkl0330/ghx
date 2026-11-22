package dev.zjkl.ghx;

import android.app.Activity;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * 渲染进程死掉时，别让系统顺手杀掉整个 App。
 *
 * 背景：WebView 的页面跑在独立沙箱进程里。它一死，Android 会回调
 * {@link WebViewClient#onRenderProcessGone}；**如果实现返回 false（或不实现），
 * 系统就认为应用没有能力处理，直接把宿主进程一并杀掉** —— 连异常栈都没有一条。
 * Capacitor 自带的 BridgeWebViewClient 正是返回 false，所以现象就是
 * 「开屏动画放完，App 瞬间消失」，logcat 里干干净净。
 *
 * 这一版有两条兜底：RenderGuard（注册在 Bridge 的 WebViewListener 上，会记日志、
 * 清缓存、给「重新加载 / 兼容模式」两个选项）与这里的返回值。**先走前者**：
 * 它才是产品化的恢复路径；没人处理时才把这句「渲染进程崩了」摆到屏幕上，
 * 至少让用户能截图。两条路都返回 true —— 进程必须活下来。
 */
final class GhxWebViewClient extends BridgeWebViewClient {

    private final Bridge bridge;

    GhxWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    @android.annotation.TargetApi(26)
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        // 交给 Bridge 的监听器链（RendererGuard 在里面）。它返回 true 就说明已经接管了，
        // 用户会看到「重新加载 / 兼容模式重启」，这里不要再叠一个面板。
        boolean handled = false;
        try {
            handled = super.onRenderProcessGone(view, detail);
        } catch (Throwable ignored) {
            // 监听器自己抛错也不能让进程死掉，落到下面那句提示
        }
        if (!handled) {
            try {
                boolean crash = detail != null && detail.didCrash();
                Activity act = bridge == null ? null : bridge.getActivity();
                if (act != null && !act.isFinishing()) {
                    String url = "?";
                    try {
                        url = String.valueOf(view == null ? null : view.getUrl());
                    } catch (Throwable ignored) {
                        // WebView 已经不可用，取 URL 也可能抛
                    }
                    BootFailure.show(act, "渲染进程已终止",
                            new IllegalStateException(
                                    (crash
                                            ? "页面渲染进程崩溃（多半是内存不足或 WebView 内核问题）"
                                            : "页面渲染进程被系统回收（内存紧张）")
                                            + "\n地址 " + url));
                }
            } catch (Throwable ignored) {
                // 兜底代码自己不能成为新的崩溃源
            }
        }
        // true = 已处理。返回 true 系统才不会杀进程。
        return true;
    }
}
