package dev.zjkl.ghx;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 沉浸式全屏开关。
 *
 * 为什么不用 @capacitor/status-bar 的 hide()：
 * 它只藏状态栏（Type.statusBars()），不碰导航栏，也没有设置 systemBarsBehavior ——
 * 藏起来之后「边缘滑入临时唤出」的行为由系统默认决定，不同机型不一致。
 * 这里用 WindowInsetsControllerCompat 一次藏掉 statusBars | navigationBars，
 * 并显式声明 BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE，退出时再一起显示。
 *
 * 藏起来之后系统栏 insets 会变成 0，MainActivity 的监听会把 --inset-* 推到 0，
 * 页面自然顶到屏幕最上沿，不需要额外通知 WebView 改布局。
 */
@CapacitorPlugin(name = "Immersive")
public class ImmersivePlugin extends Plugin {

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean flag = call.getBoolean("enabled", false);
        boolean on = Boolean.TRUE.equals(flag);
        getActivity().runOnUiThread(() -> {
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                    getActivity().getWindow(), getActivity().getWindow().getDecorView());
            if (on) {
                controller.setSystemBarsBehavior(
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars());
            }
            JSObject ret = new JSObject();
            ret.put("enabled", on);
            call.resolve(ret);
        });
    }

    /**
     * 让页面主动要一次 insets。
     *
     * 为什么需要它：启动阶段原生推过四次，但页面可能在第四次之后才真正挂载完成
     * （保险库解密慢、低端机、或者从后台被系统杀掉后重建）。这时变量是空的，
     * 顶栏又会钻到状态栏底下。由 JS 在自己认为「已经就绪」的时刻再要一次，
     * 比在原生侧继续拉长轮询时间可靠。
     *
     * 顺带把当前值回给调用方，方便排查：页面上拿到的什么，这里就能对上。
     */
    @PluginMethod
    public void syncInsets(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            InsetsBridge.sync(getActivity(), true);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        });
    }
}
