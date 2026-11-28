package dev.zjkl.ghx;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 备份文件的保存与读取。
 *
 * 为什么不加 @capacitor/filesystem + @capacitor/share：
 *
 * - filesystem 只能写 App 自己的目录，用户拿不到，也放不进云盘；
 * - share 面板里「Google 云端硬盘」不一定注册，能不能出现看机型与版本。
 *
 * 这里走 SAF（Storage Access Framework）：
 *
 *   ACTION_CREATE_DOCUMENT → 系统「保存到」面板 → 用户选云端硬盘 / 下载 / OneDrive
 *   ACTION_OPEN_DOCUMENT   → 系统文件选择器 → 读成文本交回网页层
 *
 * 这条路不申请任何存储权限，也不需要 Drive 的 OAuth —— 用户在选择器里点到哪儿就存到哪儿，
 * Android 会把那次授权以 Uri 的形式一次性交给本应用。选 Google 云端硬盘时由 Drive 的
 * DocumentsProvider 负责上传，本应用只管往这个 Uri 里写字节。
 *
 * 写文件用 UTF-8、「wt」模式（truncate）：覆盖同名文件时不会残留上一份的尾巴。
 */
@CapacitorPlugin(name = "Exporter")
public class ExporterPlugin extends Plugin {

    /** 备份文件上限。正常几十 KB，超过这个数的多半是选错了文件 */
    private static final int MAX_BYTES = 2 * 1024 * 1024;

    /**
     * 待写入的内容。
     *
     * 为什么不从回调里的 PluginCall 再读一次：能读，但一旦 Capacitor 在保存调用时
     * 丢掉参数，用户会拿到一个 0 字节的备份文件，而且界面显示「已保存」。
     * 存在插件实例上（每个 Bridge 一个单例）最稳，回调只要取字段。
     */
    private String pendingText = "";

    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = call.getString("fileName", "ghx-backup.json");
        String mime = call.getString("mime", "application/json");
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "ghx-backup.json";
        }
        if (mime == null || mime.trim().isEmpty()) {
            mime = "application/json";
        }
        String text = call.getString("text", "");
        pendingText = text == null ? "" : text;

        final Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        // EXTRA_TITLE 决定系统面板里预填的文件名，也是 Drive 里保存的名字
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        final PluginCall pending = call;
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("当前没有可用的界面");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                startActivityForResult(pending, intent, "saveDone");
            } catch (Throwable t) {
                pending.reject("打不开系统保存面板：" + t.getMessage());
            }
        });
    }

    @ActivityCallback
    private void saveDone(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            // 用户按了返回：这不是错误，交给网页层按「已取消」处理
            JSObject ret = new JSObject();
            ret.put("saved", false);
            call.resolve(ret);
            return;
        }

        Uri uri = result.getData().getData();
        if (uri == null) {
            JSObject ret = new JSObject();
            ret.put("saved", false);
            call.resolve(ret);
            return;
        }

        String text = pendingText;
        if (text == null || text.isEmpty()) {
            // 字段丢了（进程被回收后重建）再从调用参数捞一次，别写空文件
            String again = call.getString("text", "");
            text = again == null ? "" : again;
        }
        if (text.isEmpty()) {
            call.reject("没有可写入的内容");
            return;
        }
        pendingText = "";

        try {
            ContentResolver resolver = getContext().getContentResolver();
            try (OutputStream os = resolver.openOutputStream(uri, "wt")) {
                if (os == null) {
                    call.reject("无法写入所选位置");
                    return;
                }
                os.write(text.getBytes(StandardCharsets.UTF_8));
                os.flush();
            }
            JSObject ret = new JSObject();
            ret.put("saved", true);
            ret.put("name", displayName(uri));
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("写入失败：" + t.getMessage());
        }
    }

    @PluginMethod
    public void pickFile(PluginCall call) {
        String mime = call.getString("mime", "*/*");
        if (mime == null || mime.trim().isEmpty()) {
            mime = "*/*";
        }

        final Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        // 云端硬盘里的文件也能直接选；不写这一行部分设备只列出本地存储
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, false);

        final PluginCall pending = call;
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("当前没有可用的界面");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                startActivityForResult(pending, intent, "pickDone");
            } catch (Throwable t) {
                pending.reject("打不开文件选择器：" + t.getMessage());
            }
        });
    }

    @ActivityCallback
    private void pickDone(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        Uri uri = result.getData().getData();
        if (uri == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        try {
            ContentResolver resolver = getContext().getContentResolver();
            String text;
            try (InputStream is = resolver.openInputStream(uri)) {
                if (is == null) {
                    call.reject("读不到这个文件");
                    return;
                }
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[16 * 1024];
                int n;
                int total = 0;
                while ((n = is.read(chunk)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) {
                        call.reject("文件超过 2 MB，不像是备份文件");
                        return;
                    }
                    buf.write(chunk, 0, n);
                }
                text = new String(buf.toByteArray(), StandardCharsets.UTF_8);
            }
            // 去掉 BOM：某些编辑器保存时会带上，JSON.parse 会直接报错
            if (!text.isEmpty() && text.charAt(0) == '\uFEFF') {
                text = text.substring(1);
            }
            JSObject ret = new JSObject();
            ret.put("name", displayName(uri));
            ret.put("text", text);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("读取失败：" + t.getMessage());
        }
    }

    /** 从 Uri 取显示名；取不到就给个兜底，界面上不能出现空标题 */
    private String displayName(Uri uri) {
        String name = null;
        try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    name = c.getString(idx);
                }
            }
        } catch (Throwable ignored) {
            // 某些 DocumentsProvider 不支持查询，走兜底
        }
        if (name == null || name.trim().isEmpty()) {
            name = uri.getLastPathSegment();
        }
        return name == null ? "backup.json" : name;
    }
}
