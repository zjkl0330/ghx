package dev.zjkl.ghx;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * 应用内下载 + 安装。
 *
 * 为什么必须在原生侧做：
 *  - WebView 的 fetch 下不了安装包：加速站基本不给 ACAO，跨域就断了；
 *  - 就算拿到字节，WebView 也没有写文件的通道，更调不起 PackageInstaller。
 *
 * 所以这里用 HttpURLConnection 边下边写，写到 App 自己的外部下载目录
 * （/Android/data/dev.zjkl.ghx/files/Download），再用 FileProvider 授权、
 * ACTION_VIEW 拉起系统安装器。文件落在私有目录而不是公共 Download：
 * 不需要任何存储权限，覆盖安装后旧包也不会留成垃圾。
 *
 * 进度靠 notifyListeners 每 200ms 推一帧 —— 不用 CapacitorHttp 整包返回，
 * 4 MB 的包一次性进内存既慢又容易被系统回收。
 */
@CapacitorPlugin(name = "Downloader")
public class DownloadPlugin extends Plugin {

    private volatile boolean cancelled = false;
    private volatile HttpURLConnection conn = null;
    private volatile Thread worker = null;

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("缺少下载地址");
            return;
        }
        if (worker != null && worker.isAlive()) {
            call.reject("已有下载正在进行");
            return;
        }

        final String fileName = safeName(call.getString("fileName", "download.bin"));
        Long expectBoxed = call.getLong("expectBytes");
        final long expect = expectBoxed == null ? 0L : expectBoxed;
        final Map<String, String> headers = readHeaders(call.getObject("headers"));
        cancelled = false;

        worker = new Thread(() -> {
            try {
                JSObject ret = doDownload(url.trim(), fileName, expect, headers);
                runOnUi(() -> call.resolve(ret));
            } catch (Exception e) {
                String msg = e.getMessage() == null ? "下载失败" : e.getMessage();
                runOnUi(() -> call.reject(msg));
            }
        }, "ghx-download");
        worker.start();
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

    private HttpURLConnection open(String url, Map<String, String> headers) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        // 手动跟重定向：GitHub 的产物与附件会 302 到签名地址，
        // 自动跟随时 Authorization 会被一并带到那个域上去，没必要。
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "ghx-android/" + versionName());
        c.setRequestProperty("Accept", "*/*");
        if (headers != null) {
            for (Map.Entry<String, String> e : headers.entrySet()) {
                c.setRequestProperty(e.getKey(), e.getValue());
            }
        }
        return c;
    }

    private static boolean isRedirect(int code) {
        return code == 301 || code == 302 || code == 303 || code == 307 || code == 308;
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        HttpURLConnection c = conn;
        if (c != null) {
            try {
                c.disconnect();
            } catch (Exception ignored) {
                // 断开失败无所谓，下一轮循环靠 cancelled 退出
            }
        }
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

    /** 下载目录：优先外部私有目录（用户能在文件管理器里通过 Android/data 找到） */
    private File downloadDir() {
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = new File(getContext().getFilesDir(), "Download");
        if (!dir.exists() && !dir.mkdirs()) return null;
        return dir;
    }

    private JSObject doDownload(String url, String fileName, long expect, Map<String, String> headers)
            throws IOException {
        File dir = downloadDir();
        if (dir == null) throw new IOException("无法创建下载目录");

        File out = new File(dir, fileName);
        File part = new File(dir, fileName + ".part");
        // 同名旧包先清掉；清不掉（被安装器占着）就换一个带时间戳的名字，
        // 不要因为「上一版还没装完」就整个下载失败。
        if (part.exists() && !part.delete()) throw new IOException("无法清理临时文件");
        if (out.exists() && !out.delete()) {
            out = new File(dir, System.currentTimeMillis() + "-" + fileName);
        }

        long start = System.currentTimeMillis();
        long done = 0;
        long total = expect;
        long lastEmit = 0;
        long lastBytes = 0;
        long lastTime = start;

        HttpURLConnection c = null;
        InputStream in = null;
        FileOutputStream fos = null;
        try {
            c = open(url, headers);
            conn = c;
            int code = c.getResponseCode();

            // 产物下载：api.github.com 返回 302 到 pipelines 的签名地址。
            // 跟随之后只带 UA，不带鉴权头 —— 签名地址本身不需要，也不该收到令牌。
            int hops = 0;
            while (isRedirect(code) && hops < 5) {
                String loc = c.getHeaderField("Location");
                if (loc == null || loc.trim().isEmpty()) break;
                URL next = new URL(new URL(url), loc);
                c.disconnect();
                url = next.toString();
                c = open(url, null);
                conn = c;
                code = c.getResponseCode();
                hops += 1;
            }

            if (code != HttpURLConnection.HTTP_OK && code != 206) {
                throw new IOException("HTTP " + code);
            }
            long len = parseContentLength(c.getHeaderField("Content-Length"));
            if (len > 0) total = len;

            in = new BufferedInputStream(c.getInputStream(), 64 * 1024);
            fos = new FileOutputStream(part);
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                if (cancelled) throw new IOException("已取消");
                fos.write(buf, 0, n);
                done += n;

                long now = System.currentTimeMillis();
                if (now - lastEmit >= 200) {
                    long dt = Math.max(1, now - lastTime);
                    double kbps = ((done - lastBytes) / 1024.0) / (dt / 1000.0);
                    JSObject p = new JSObject();
                    p.put("bytes", done);
                    p.put("total", total);
                    p.put("kbps", Math.round(kbps * 10) / 10.0);
                    emitProgress(p);
                    lastEmit = now;
                    lastBytes = done;
                    lastTime = now;
                }
            }
            fos.flush();
            fos.close();
            fos = null;
            in.close();
            in = null;

            if (done <= 0) throw new IOException("下载到 0 字节");
            if (!part.renameTo(out)) throw new IOException("无法保存文件");

            JSObject ret = new JSObject();
            ret.put("path", out.getAbsolutePath());
            ret.put("bytes", done);
            ret.put("ms", System.currentTimeMillis() - start);
            return ret;
        } finally {
            if (fos != null) {
                try {
                    fos.close();
                } catch (IOException ignored) {
                    // 收尾失败不覆盖主异常
                }
            }
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignored) {
                    // 同上
                }
            }
            if (c != null) {
                c.disconnect();
                conn = null;
            }
            // 中途失败或取消：删掉半截文件，别占着空间
            if (part.exists() && !out.exists()) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
            }
        }
    }

    private void emitProgress(JSObject payload) {
        runOnUi(() -> {
            try {
                notifyListeners("progress", payload);
            } catch (Exception ignored) {
                // 页面已销毁就当没人听
            }
        });
    }

    private void runOnUi(Runnable r) {
        try {
            getActivity().runOnUiThread(r);
        } catch (Exception e) {
            r.run();
        }
    }

    private String versionName() {
        try {
            return getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0.0.0";
        }
    }

    /** 文件名安全化：去掉路径分隔符，防止写到下载目录之外 */
    private static String safeName(String raw) {
        String s = raw == null ? "" : raw.trim();
        s = s.replaceAll("[\\\\/:*?\"<>|]", "_").replaceAll("[\\u0000-\\u001f]", "");
        while (s.startsWith(".")) s = s.substring(1);
        return s.isEmpty() ? "download.bin" : s;
    }

    /**
     * 手动解析 Content-Length。
     * 不用 HttpURLConnection.getContentLengthLong()：那是 API 24，本项目 minSdk 23。
     */
    private static long parseContentLength(String raw) {
        if (raw == null) return -1L;
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException e) {
            return -1L;
        }
    }

    @Override
    protected void handleOnDestroy() {
        cancelled = true;
        HttpURLConnection c = conn;
        if (c != null) {
            try {
                c.disconnect();
            } catch (Exception ignored) {
                // 销毁阶段尽力而为
            }
        }
        super.handleOnDestroy();
    }
}
