"""下载续航改造的静态检查（源码 + 产物双查）。

背景：v0.8.x 之前下载线程挂在 Plugin 上，熄屏、切后台、WebView 重建都会
顺着 onDestroy 把下载掐断。这次改成了三件套：

    DownloadHub（进程级单例线程）
  + WakeLock / WifiLock（顶住 CPU 与 WiFi 休眠）
  + DownloadService（前台服务，顶住 Android 12+ 的后台进程冻结）

这三样都没法在沙箱里跑起来 —— 需要真机。但「有没有真的接上」是可以静态
证明的：少一条权限、少一次 startForeground、onDestroy 里还在 cancel，
装到手机上依旧是断。所以这里逐条断言，把它当成发版前的闸门。

用法：
    python3 scripts/check-download-native.py
    python3 scripts/check-download-native.py --apk android/app/build/outputs/apk/debug/app-debug.apk
"""
import argparse
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JAVA = os.path.join(ROOT, 'android/app/src/main/java/dev/zjkl/ghx')
MANIFEST = os.path.join(ROOT, 'android/app/src/main/AndroidManifest.xml')

fails = []


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def check(name, ok, detail=''):
    mark = 'PASS' if ok else 'FAIL'
    print(f'[{mark}] {name}{(" · " + detail) if detail else ""}')
    if not ok:
        fails.append(name)


def main():
    apk = None
    args = sys.argv[1:]
    if '--apk' in args:
        apk = args[args.index('--apk') + 1]

    manifest = read(MANIFEST)
    plugin = read(os.path.join(JAVA, 'DownloadPlugin.java'))
    hub = read(os.path.join(JAVA, 'DownloadHub.java'))
    plan = read(os.path.join(JAVA, 'ChunkPlan.java'))
    chunk = read(os.path.join(JAVA, 'ChunkedFetch.java'))
    svc = read(os.path.join(JAVA, 'DownloadService.java'))

    # ── 1. 权限与服务声明：少一条，装到手机上就是白改 ──
    for perm in (
        'WAKE_LOCK',
        'ACCESS_WIFI_STATE',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_DATA_SYNC',
    ):
        check(f'权限 {perm}', f'android.permission.{perm}' in manifest)

    check(
        '前台服务已声明 dataSync 类型',
        bool(re.search(r'android:name="\.DownloadService"[\s\S]{0,200}foregroundServiceType="dataSync"', manifest)),
        'Android 14 起缺类型会在 startForeground 抛异常',
    )

    # ── 2. 销毁不再掐断下载 ──
    destroy = re.search(r'handleOnDestroy\(\)\s*\{([\s\S]*?)\n    \}', plugin)
    body = destroy.group(1) if destroy else ''
    check(
        'onDestroy 只解绑、不取消下载',
        bool(destroy)
        and 'DownloadHub.cancel' not in body
        and 'disconnect' not in body,
        '这是「熄屏断开」的直接成因',
    )

    # ── 3. 两把锁：CPU 与 WiFi 各一把，且都带超时 ──
    check('拿 PARTIAL_WAKE_LOCK', 'PARTIAL_WAKE_LOCK' in hub and 'acquire(WAKE_TIMEOUT_MS)' in hub)
    check('拿 WifiLock', 'createWifiLock' in hub and 'WIFI_MODE_FULL_HIGH_PERF' in hub)
    check('锁有超时上限', re.search(r'WAKE_TIMEOUT_MS\s*=\s*\d+\s*\*\s*60\s*\*\s*1000', hub) is not None,
          '异常路径没走到 release 时也不该把整机 CPU 钉住')
    check('结束时释放', 'releaseLocks()' in hub and 'wake.release()' in hub)

    # ── 4. 前台服务：真的 startForeground，且按版本走类型 ──
    check('调用 startForeground', 'startForeground(NOTIF_ID' in svc)
    check('Android 14 用类型化 startForeground', 'FOREGROUND_SERVICE_TYPE_DATA_SYNC' in svc)
    check('结束会 stopSelf', 'stopSelf()' in svc)
    check(
        '服务不重复下载，只做续航',
        'doDownload' not in svc,
        '下载本体在 Hub，服务只保进程不被冻结',
    )

    # ── 5. 回来能对账 ──
    check('Plugin 提供 status()', '@PluginMethod\n    public void status(' in plugin)
    check('Plugin 提供 takePending()', 'public void takePending(' in plugin)
    check('Hub 落盘待认领结果', 'SP_PENDING' in hub and 'persist(' in hub)

    # ── 6. 分片下载：探针 → 并发定位写 → 失败降级 ──
    check('分片核心不依赖 android（能在普通 JVM 上真跑测试）', 'import android' not in chunk)
    check('并发硬上限 4 路', re.search(r'MAX_PARTS\s*=\s*4\b', plan) is not None,
          '实测 8 路会被 CDN 限流，比单路还慢')
    check('单片下限 1 MiB', re.search(r'MIN_PART\s*=\s*1L\s*<<\s*20', plan) is not None)
    check('发 Range 请求', 'c.setRequestProperty("Range", "bytes=" + start' in chunk)
    check('探针拿到 206 + Content-Range 才切片',
          'o.code == 206 && total > 0' in chunk and 'Content-Range' in chunk)
    check('显式关掉压缩，否则分段偏移会错位', '"Accept-Encoding", "identity"' in chunk)
    check('重定向每一跳都重设 Range', 'openAt(url, null, start, end' in chunk)
    check('并发写用定位写而不是各写各的流', 'ch.write(bb, pos)' in chunk)
    check('支持 Range 才有分片，否则单连接', 'private static Outcome single(' in chunk)
    check('分片失败会删掉半截、改走单连接', 'deleteQuietly(part)' in chunk
          and 'catch (Partial pf)' in chunk)
    check('已经下过大半就不再重下', 'pf.done >= total / 2' in chunk)
    check('单片失败会重试一次', 'PART_ATTEMPTS' in chunk and 'for (int attempt = 1' in chunk)
    check('取消掐断所有在途连接', 'static void abortAll()' in chunk
          and 'ChunkedFetch.abortAll()' in hub)
    check('Hub 走分片能力', 'ChunkedFetch.fetch(' in hub)
    check('结束前校验字节数，短了就算失败', 'if (got != total)' in chunk)
    check('Plugin 把 parts 夹在合法区间', 'Math.min(parts, ChunkPlan.MAX_PARTS)' in plugin)
    check('状态里带实际并发数', 'put("parts", s.parts)' in plugin)

    # ── 6b. 通知栏：用户唯一能看见下载的地方 ──
    recv = read(os.path.join(JAVA, 'DownloadActionReceiver.java'))
    apki = read(os.path.join(JAVA, 'ApkInstaller.java'))
    main_act = read(os.path.join(JAVA, 'MainActivity.java'))

    check('声明 POST_NOTIFICATIONS（targetSdk 33+ 缺了通知会被丢弃）',
          'android.permission.POST_NOTIFICATIONS' in manifest)
    check('下载时主动要一次通知权限',
          'requestPermissions' in plugin and 'POST_NOTIFICATIONS' in plugin)
    check('提供通知状态查询（设置页据此提示）', 'public void notifyState(' in plugin)
    check('提供跳到通知设置页', 'ACTION_APP_NOTIFICATION_SETTINGS' in plugin)
    check('取消按钮走 BroadcastReceiver（当场生效，不用开界面）',
          'DownloadHub.cancel()' in recv and 'ACTION_CANCEL' in recv)
    check('receiver 已在 manifest 注册', '.DownloadActionReceiver' in manifest)
    check('通知里有取消按钮', 'addAction(0, "取消"' in svc)
    check('下载完的 APK 通知里有「安装」', 'addAction(0, "安装"' in svc)
    check('点 APK 完成通知直接进安装',
          'apk ? installIntent(path) : openApp()' in svc)
    check('通知带剩余时间', 'etaSeconds(' in svc and '还剩' in svc)
    check('通知带并发路数', 'DownloadHub.currentParts()' in svc and '路并行' in svc)
    check('失败时把原因写进通知', 'setContentTitle("下载中断")' in svc and 'BigTextStyle' in svc)
    check('完成/失败通知节流外单独走一遍', 'notifyProgress(' in svc and 'finishWith(' in svc)
    check(
        '先脱离前台再发终态通知（否则 REMOVE 会把完成通知一起删掉）',
        svc.index('detachForeground()') < svc.index('nm.notify(NOTIF_ID, b.build())', svc.index('private void finishWith')),
        'STOP_FOREGROUND_REMOVE 与 notify 同 id，顺序反了就等于没发',
    )
    check('脱离前台用 DETACH 保留通知',
          'STOP_FOREGROUND_DETACH' in svc or 'stopForeground(false)' in svc)
    check('Android 12+ 通知立即显示，不被系统压 10 秒',
          'FOREGROUND_SERVICE_IMMEDIATE' in svc)
    check('通知刷新不高于 1 秒（否则进度条看着断续）',
          re.search(r'NOTIFY_INTERVAL_MS\s*=\s*(\d+)', svc) is not None
          and int(re.search(r'NOTIFY_INTERVAL_MS\s*=\s*(\d+)', svc).group(1)) <= 1000)
    check('取消与失败区分开，不显示成「下载失败」', '"已取消"' in hub)
    check('安装逻辑抽成一份，页面与通知共用',
          'ApkInstaller.install(' in plugin and 'ApkInstaller.install(' in main_act)
    check('通知里点安装 → MainActivity 收下路径', 'EXTRA_INSTALL_PATH' in main_act
          and 'EXTRA_INSTALL_PATH' in svc)
    check('已在栈里时走 onNewIntent（否则点了没反应）', 'onNewIntent' in main_act)
    check('授权「安装未知应用」回来后自动续上', 'pendingInstall' in main_act
          and 'ApkInstaller.canInstall(this)' in main_act)

    # ── 7. 产物检查：类真的编进去了、权限真的合进 APK 了 ──
    if apk and os.path.exists(apk):
        with zipfile.ZipFile(apk) as z:
            dex = b''.join(
                z.read(n) for n in z.namelist() if re.match(r'classes\d*\.dex$', n)
            )
        text = dex.decode('latin-1')
        check('APK 内含 DownloadHub', 'DownloadHub' in text)
        check('APK 内含 DownloadService', 'DownloadService' in text)
        check('APK 内含 ChunkedFetch', 'ChunkedFetch' in text)
        check('APK 内含 ChunkPlan', 'ChunkPlan' in text)
        check('APK 内含 DownloadActionReceiver', 'DownloadActionReceiver' in text)
        check('APK 内含 ApkInstaller', 'ApkInstaller' in text)
        check('APK 大小在 4 MB 以上（字体仍在包里）', os.path.getsize(apk) > 4 * 1024 * 1024,
              f'{os.path.getsize(apk) / 1048576:.1f} MB')
    elif apk:
        check(f'APK 存在（{apk}）', False)

    print()
    if fails:
        print(f'{len(fails)} 项未通过：' + '、'.join(fails))
        sys.exit(1)
    print('全部通过')


if __name__ == '__main__':
    main()
