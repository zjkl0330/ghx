"""复现「1.1.0 能开 → 升到新版就黑屏」的升级路径。

思路：同一个 origin（同端口同 host）先跑 v1.1.0 产物，让应用自己建出真实的
旧存档；再把服务指向新产物、重新加载。localStorage 原地保留，等于真机覆盖安装。
"""

import http.server
import os
import socketserver
import sys
import threading
import shutil

from playwright.sync_api import sync_playwright

PORT = 5291
ROOT = {'dir': '/tmp/v110/dist'}
PROFILE = '/tmp/pw-upgrade-profile'


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        rel = path.split('?', 1)[0].split('#', 1)[0].lstrip('/')
        if rel in ('', 'index.html'):
            rel = 'index.html'
        return os.path.join(ROOT['dir'], rel)

    def end_headers(self):
        # 必须禁缓存，否则换产物后浏览器还用旧 index.html，测出来是假的
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def log_message(self, *a):
        pass


def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    srv = socketserver.TCPServer(('127.0.0.1', PORT), Handler)
    srv.allow_reuse_address = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    base = f'http://127.0.0.1:{PORT}/'
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE,
            viewport={'width': 390, 'height': 844},
            device_scale_factor=2,
            locale='zh-CN',
        )
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()

        errs, cons = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: cons.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)

        print('—— 阶段 A：v1.1.0 首次运行，生成真实存档 ——')
        pg.goto(base, wait_until='load')
        pg.wait_for_timeout(4500)
        snap = pg.evaluate("""() => {
            const ls = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                const v = localStorage.getItem(k) || '';
                ls[k] = v.length > 120 ? v.slice(0, 120) + '…(' + v.length + '字)' : v;
            }
            return {
                keys: ls,
                rootNodes: document.getElementById('root')?.childElementCount ?? -1,
                bootThere: !!document.getElementById('boot'),
                text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
            };
        }""")
        print('  localStorage 键:', list(snap['keys'].keys()))
        for k, v in snap['keys'].items():
            print(f'    {k} = {v}')
        print('  #root 子节点:', snap['rootNodes'], ' #boot 还在:', snap['bootThere'])
        print('  屏幕文字:', snap['text'][:120])
        pg.screenshot(path='/workspace/dist-apk/upg-a-110.png')
        v110_ok = snap['rootNodes'] > 0
        print('  v1.1.0 渲染:', '正常' if v110_ok else '空白!!')
        print('  阶段 A 报错:', errs[-3:] if errs else '无')

        print()
        print('—— 阶段 B：原地换成新产物，重新加载（等价覆盖安装）——')
        ROOT['dir'] = '/workspace/ghx/dist'
        errs.clear()
        cons.clear()
        pg.goto(base, wait_until='load')
        pg.wait_for_timeout(6000)
        snap2 = pg.evaluate("""() => {
            const root = document.getElementById('root');
            return {
                rootNodes: root?.childElementCount ?? -1,
                bootThere: !!document.getElementById('boot'),
                title: document.title,
                text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 600),
            };
        }""")
        pg.screenshot(path='/workspace/dist-apk/upg-b-new.png')
        print('  #root 子节点:', snap2['rootNodes'], ' #boot 还在:', snap2['bootThere'])
        print('  title:', snap2['title'][:200])
        print('  屏幕文字:', snap2['text'][:400])
        print('  pageerror:', errs if errs else '无')
        print('  console error/warn:', cons[-6:] if cons else '无')

        verdict = '新版本正常渲染 —— 升级路径没复现出黑屏'
        if snap2['rootNodes'] == 0:
            verdict = '新版本 #root 为空 —— 复现了黑屏'
        print()
        print('结论:', verdict)
        ctx.close()
    srv.shutdown()


if __name__ == '__main__':
    sys.exit(main())
