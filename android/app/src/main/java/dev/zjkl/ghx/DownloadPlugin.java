package dev.zjkl.ghx;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * 应用内下载 + 安装的 JS 门面。
 *
 * 下载本体在 {@link DownloadHub}，续航保障在 {@link DownloadService} ——
 * 这个类只负责三件事：把 JS 参数翻成 Java、把事件转发成 notifyListeners、
 * 以及调起安装器。
 *
 * **销毁时不再取消下载。** 以前 handleOnDestroy 会断连接，于是熄屏、切后台、
 * 页面重建都会让下载半路夭折。现在 Plugin 可以随时重建，下载照跑，回来时
 * 用 status() 对账。
 */
@CapacitorPlugin(name = "Downloader")
public class DownloadPlugin extends Plugin {

    private DownloadHub.Listener bridge;

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("缺少下载地址");
            return;
        }
        if (DownloadHub.isRunning()) {
            call.reject("已有下载正在进行");
            return;
        }

        String fileName = call.getString("fileName", "download.bin");
        Long expectBoxed = call.getLong("expectBytes");
        long expect = expectBoxed == null ? 0L : expectBoxed;
        Map<String, String> headers = readHeaders(call.getObject("headers"));
        // 来源信息只用于「界面已销毁时也能补一条下载记录」，缺了不影响下载
        String repo = call.getString("repo", "");
        String kind = call.getString("kind", "");
        String tag = call.getString("tag", "");
        // 分片路数：JS 传 1 表示单线程。夹在 [1, ChunkPlan.MAX_PARTS] 之间，
        // 免得某个手滑的值把手机的连接数打爆。
        Integer partsBoxed = call.getInt("parts");
        int parts = partsBoxed == null ? ChunkPlan.MAX_PARTS : partsBoxed;
        parts = Math.max(1, Math.min(parts, ChunkPlan.MAX_PARTS));

        // 先挂监听再起线程：否则第一帧进度可能早于监听注册
        attachBridge(call);

        boolean ok = DownloadHub.start(
                getContext().getApplicationContext(), url.trim(), fileName, expect, headers,
                repo == null ? "" : repo, kind == null ? "" : kind, tag == null ? "" : tag, parts);
        if (!ok) {
            detachBridge();
            call.reject("已有下载正在进行");
            return;
        }
        startKeepAliveService();
    }

    /**
     * 取走「下载完了但界面没来得及记」的那一条。
     *
     * 页面正常活着时，下载一结束就会来取；页面被销毁重建、或者下载期间
     * 用户退出了 App，就等下次启动再来取。取走即清空，不会重复记。
     */
    @PluginMethod
    public void takePending(PluginCall call) {
        String raw = DownloadHub.takePending(getContext());
        JSObject ret = new JSObject();
        if (raw != null) ret.put("raw", raw);
        call.resolve(ret);
    }

    /**
     * 回来对账。WebView 被回收重建后，页面拿不到原来的 call，
     * 只能靠这个查询「下载是不是还在跑、结果是什么」。
     */
    @PluginMethod
    public void status(PluginCall call) {
        DownloadHub.Snapshot s = DownloadHub.snapshot();
        JSObject ret = new JSObject();
        ret.put("running", s.running);
        ret.put("hasResult", s.hasResult);
        ret.put("bytes", s.bytes);
        ret.put("total", s.total);
        ret.put("kbps", s.kbps);
        ret.put("fileName", s.fileName);
        ret.put("ms", s.ms);
        ret.put("parts", s.parts);
        ret.put("chunked", s.chunked);
        if (s.path != null) ret.put("path", s.path);
        if (s.error != null) ret.put("error", s.error);
        call.resolve(ret);
    }

    /** 历史记录里那些落盘文件还在不在（用户可能清理过 App 存储） */
    @PluginMethod
    public void exists(PluginCall call) {
        com.getcapacitor.JSArray paths = call.getArray("paths");
        JSObject ret = new JSObject();
        JSObject map = new JSObject();
        if (paths != null) {
            for (int i = 0; i < paths.length(); i += 1) {
                String p = paths.optString(i, "");
                if (p == null || p.isEmpty()) continue;
                File f = new File(p);
                map.put(p, f.exists() && f.length() > 0);
            }
        }
        ret.put("exists", map);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        DownloadHub.cancel();
        call.resolve();
    }

    /**
     * 调起系统安装器。
     *
     * Android 8 起安装未知来源应用要用户逐应用授权，没授权就直接 startActivity
     * 会被系统静默丢掉（用户只看到「点了没反应」）。所以先查 canRequestPackageInstalls，
     * 没有就跳到本应用的「安装未知应用」设置页，并告诉页面 needPermission。
     */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("缺少文件路径");
            return;
        }
        File f = new File(path);
        if (!f.exists() || f.length() <= 0) {
            call.reject("安装包不存在或为空");
            return;
        }
        if (!path.toLowerCase().endsWith(".apk")) {
            call.reject("不是 APK 文件");
            return;
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent s = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(s);
                JSObject ret = new JSObject();
                ret.put("opened", false);
                ret.put("needPermission", true);
                call.resolve(ret);
                return;
            }

            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);

            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("无法调起安装器：" + e.getMessage());
        }
    }

    /* ---------------- 内部 ---------------- */

    private void attachBridge(PluginCall call) {
        detachBridge();
        bridge = new DownloadHub.Listener() {
            @Override
            public void onProgress(long bytes, long total, double kbps) {
                JSObject p = new JSObject();
                p.put("bytes", bytes);
                p.put("total", total);
                p.put("kbps", kbps);
                // 界面要显示「4 路并行」，探测完才知道实际几路，所以每帧带上
                p.put("parts", DownloadHub.currentParts());
                try {
                    notifyListeners("progress", p);
                } catch (Exception ignored) {
                    // 页面已销毁就当没人听；下载本身不受影响
                }
            }

            @Override
            public void onDone(String path, long bytes, long ms) {
                JSObject ret = new JSObject();
                ret.put("path", path);
                ret.put("bytes", bytes);
                ret.put("ms", ms);
                try {
                    call.resolve(ret);
                } catch (Exception ignored) {
                    // bridge 已销毁；结果留在 DownloadHub，由 status() 取
                }
                detachBridge();
            }

            @Override
            public void onError(String message) {
                try {
                    call.reject(message);
                } catch (Exception ignored) {
                    // 同上
                }
                detachBridge();
            }
        };
        DownloadHub.addListener(bridge);
    }

    private void detachBridge() {
        if (bridge != null) {
            DownloadHub.removeListener(bridge);
            bridge = null;
        }
    }

    /** 起前台服务。失败不影响下载，只是失去「不被冻结」的保障 */
    private void startKeepAliveService() {
        try {
            Context ctx = getContext().getApplicationContext();
            Intent i = new Intent(ctx, DownloadService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Exception ignored) {
            // 后台启动限制等情况下会被拒；下载已经跑起来了，不因此报错
        }
    }

    /** 请求头从 JS 传过来；CI 产物要带 Authorization，公开资源传空即可 */
    private static Map<String, String> readHeaders(JSObject obj) {
        Map<String, String> out = new HashMap<>();
        if (obj == null) return out;
        Iterator<String> it = obj.keys();
        while (it.hasNext()) {
            String k = it.next();
            Object v = obj.opt(k);
            if (v instanceof String && !((String) v).isEmpty()) out.put(k, (String) v);
        }
        return out;
    }

    @Override
    protected void handleOnDestroy() {
        // 只解绑转发，不动下载 —— 这是这次改动的全部意义
        detachBridge();
        super.handleOnDestroy();
    }
}
