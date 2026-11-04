package dev.zjkl.ghx;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // viewport 里的 user-scalable=no 在部分 WebView 上会被忽略，这里再关一次。
        // 双指放大后整页布局被拉大，悬浮玻璃底栏的模糊采样范围跟着变，
        // 身后的正文就会从底栏里透出来，所以手势缩放必须彻底关掉。
        // 不要动 setTextZoom：那是系统「字体大小」的通道，关掉会伤到无障碍。
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
    }
}
