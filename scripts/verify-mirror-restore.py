#!/usr/bin/env python3
"""验证「升级无损」：老版本用过的加速站能从本机记录里接回来，新装机仍然是零预置。

两种状态各开一个干净的浏览器上下文：

1. 升级：预置 v1.1.0 留下的键（ghx.mirror / ghx.mirror.speed），加载新产物，
   期望站点表里出现那两条地址、选中项不变。
2. 新装：什么都不预置，期望站点表只有官方、一条加速站都没有。

地址用 example.com 占位 —— 真地址不该出现在仓库里。
"""
import http.server
import json
import os
import socketserver
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist')
BASE = 'http://127.0.0.1:5299/index.html'

OLD_SELF = 'https://self.example'
OLD_PUB = 'https://pub.example'


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0].lstrip('/') or 'index.html'
        return os.path.join(ROOT, clean)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


def seed() -> dict:
    return {
        'ghx.mirror': OLD_SELF,
        'ghx.mirror.auto': 'on',
        'ghx.mirror.speed': json.dumps({
            'at': 4102444800000,  # 2099，保证「新鲜」，启动时直接沿用
            'best': OLD_SELF,
            'results': [
                {'base': OLD_SELF, 'kbps': 900, 'ms': 80},
                {'base': OLD_PUB, 'kbps': 500, 'ms': 120},
                {'base': 'https://github.com', 'kbps': 200, 'ms': 300},
            ],
        }),
    }


def read_kv(page) -> dict:
    return page.evaluate(
        """() => {
            const out = {};
            for (let i = 0; i < localStorage.length; i += 1) {
                const k = localStorage.key(i);
                if (k && k.startsWith('ghx.mirror')) out[k] = localStorage.getItem(k);
            }
            return out;
        }"""
    )


class Server(socketserver.TCPServer):
    allow_reuse_address = True


def run() -> None:
    srv = Server(('127.0.0.1', 5299), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            br = p.chromium.launch()

            # ---- 1. 升级路径 ----
            up = br.new_context(viewport={'width': 390, 'height': 844})
            up.add_init_script(
                """((kv) => {
                    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
                })(%s);""" % json.dumps(seed())
            )
            pg = up.new_page()
            pg.goto(BASE, wait_until='load')
            pg.wait_for_timeout(3000)
            kv = read_kv(pg)

            store = json.loads(kv.get('ghx.mirror.store') or '{"overrides":{},"custom":[]}')
            bases = [c['base'] for c in store.get('custom', [])]
            print('升级后站点表：', bases)
            print('升级后选中：', kv.get('ghx.mirror'))
            print('一次性标记：', kv.get('ghx.mirror.restored'))
            assert OLD_SELF in bases, '老的自建站没接回来'
            assert OLD_PUB in bases, '旧的公共站没接回来'
            assert 'github.com' not in ' '.join(bases), '官方直连不该被写进自定义表'
            assert kv.get('ghx.mirror') == OLD_SELF, '选中项被改掉了'
            assert kv.get('ghx.mirror.restored') == '1', '没写一次性标记（删掉会被补回来）'
            self_entry = next(c for c in store['custom'] if c['base'] == OLD_SELF)
            assert self_entry.get('guess') is True, '风格未知标记丢了，候选会只给一种拼法'
            up.close()

            # ---- 2. 新装路径 ----
            fresh = br.new_context(viewport={'width': 390, 'height': 844})
            pg2 = fresh.new_page()
            pg2.goto(BASE, wait_until='load')
            pg2.wait_for_timeout(3000)
            kv2 = read_kv(pg2)
            store2 = json.loads(kv2.get('ghx.mirror.store') or '{"overrides":{},"custom":[]}')
            print('新装后站点表：', [c['base'] for c in store2.get('custom', [])] or '（空）')
            assert not store2.get('custom'), '新装不该有任何加速站'
            assert not store2.get('overrides'), '新装不该有改地址记录'
            print('新装选中：', kv2.get('ghx.mirror') or '（未写，默认官方）')
            fresh.close()
            br.close()
        print('PASS：升级接回旧站，新装零预置')
    finally:
        srv.shutdown()


if __name__ == '__main__':
    run()
