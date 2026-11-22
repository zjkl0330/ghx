#!/usr/bin/env python3
"""下载中枢的 Context 空值红线。

背景：v1.1.2 起「打开就闪退」，查到最后是 DownloadHub 里的静态 Context 只在
start() 里赋值，而冷启动时页面一定会调一次 status() → snapshot() → partOf()
→ downloadDir()，那里直接 app.getExternalFilesDir(...)，app 是 null，NPE 抛在
Capacitor 的插件线程上，进程当场被杀（系统账本记为 REASON_CRASH=4）。

这个脚本只做一件事：把「Context 必须先装上、用到它的地方必须判空」这两条
写成可执行断言，防止哪天重构时又把手写回去。
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HUB = ROOT / "android/app/src/main/java/dev/zjkl/ghx/DownloadHub.java"
PLUGIN = ROOT / "android/app/src/main/java/dev/zjkl/ghx/DownloadPlugin.java"
APP = ROOT / "android/app/src/main/java/dev/zjkl/ghx/GhxApplication.java"

fails = []


def check(cond, msg):
    if cond:
        print(f"  PASS  {msg}")
    else:
        print(f"  FAIL  {msg}")
        fails.append(msg)


def main():
    hub = HUB.read_text(encoding="utf-8")
    plugin = PLUGIN.read_text(encoding="utf-8")
    app = APP.read_text(encoding="utf-8")
    print("DownloadHub / DownloadPlugin 的 Context 红线：")

    check("static void install(Context" in hub, "DownloadHub 提供 install(Context) 入口")
    check("install(this)" in app, "Application.onCreate 里先装 Context")

    # downloadDir 必须先取本地变量再判空，不能直接用静态 app
    seg = hub.split("private static File downloadDir()", 1)
    check(len(seg) == 2, "存在 downloadDir()")
    body = seg[1].split("\n    }", 1)[0] if len(seg) == 2 else ""
    check("Context ctx = app;" in body, "downloadDir() 取本地 ctx")
    check("if (ctx == null) return null;" in body, "downloadDir() 判空后返回 null")
    check("app.getExternalFilesDir" not in body, "downloadDir() 不再直接调用静态 app")

    # snapshot 必须容忍断点查询失败
    seg2 = hub.split("static Snapshot snapshot()", 1)
    sbody = seg2[1].split("\n    }", 1)[0] if len(seg2) == 2 else ""
    check("catch (Throwable ignored)" in sbody, "snapshot() 里断点查询有兜底")

    # 插件侧：load 时安装 Context；status 不外抛
    check("DownloadHub.install(getContext())" in plugin, "DownloadPlugin.load() 安装 Context")
    seg3 = plugin.split("public void status(PluginCall call)", 1)
    pbody = seg3[1].split("\n    }", 1)[0] if len(seg3) == 2 else ""
    check("catch (Throwable t)" in pbody, "status() 兜住异常，不外抛到插件线程")

    if fails:
        print(f"\n{len(fails)} 项未通过")
        return 1
    print("\n全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
