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

    # ── 6. 产物检查：类真的编进去了、权限真的合进 APK 了 ──
    if apk and os.path.exists(apk):
        with zipfile.ZipFile(apk) as z:
            dex = b''.join(
                z.read(n) for n in z.namelist() if re.match(r'classes\d*\.dex$', n)
            )
        text = dex.decode('latin-1')
        check('APK 内含 DownloadHub', 'DownloadHub' in text)
        check('APK 内含 DownloadService', 'DownloadService' in text)
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
