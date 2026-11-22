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
 * 这里返回 true：应用活下来，把「渲染进程崩了」这句话摆到屏幕上，
 * 用户至少能截个图，我们也终于有了方向。
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
                                        + "\n地址 " + url
                                        + "\n\n这个错不会抛 Java 异常，默认行为是连 App 一起被杀，"
                                        + "所以之前只看到「闪退」。"));
            }
        } catch (Throwable ignored) {
            // 兜底代码自己不能成为新的崩溃源
        }
        // true = 已处理。返回 true 系统才不会杀进程。
        return true;
    }
}
