"""下载面板：线路再多，下载按钮也得留在屏幕里。

做法是往真实的线路表里塞 14 条模拟线路（DOM 层注入，不改业务数据），
然后量三件事：
- 底部按钮整块在视口内，且中心点没有被列表盖住（elementFromPoint 命中自己）；
- 体部自己滚、按钮不动；
- 线路表限高，超出部分在它内部滚，不把按钮顶出去。
"""
import importlib.util
import os
import re

from playwright.sync_api import sync_playwright

OUT = '/workspace/ghx/docs/screenshots'
BASE = 'http://127.0.0.1:4173/'

_here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('va', os.path.join(_here, 'verify-apkstore.py'))
va = importlib.util.module_from_spec(spec)
spec.loader.exec_module(va)

INJECT = """() => {
  const list = document.querySelector('.multi-list.dl-routes');
  const proto = list.querySelector('.multi-row');
  for (let i = 0; i < 14; i += 1) {
    const n = proto.cloneNode(true);
    n.querySelector('b').textContent = '模拟线路 ' + (i + 1);
    list.appendChild(n);
  }
  return list.querySelectorAll('.multi-row').length;
}"""

MEASURE = """() => {
  const foot = document.querySelector('.dl-foot');
  const body = document.querySelector('.dl-body');
  const list = document.querySelector('.dl-routes');
  const btn = foot.querySelector('.btn.primary');
  const r = btn.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const fb = foot.getBoundingClientRect();
  return {
    vh: innerHeight,
    footTop: Math.round(fb.top),
    footBottom: Math.round(fb.bottom),
    btnTop: Math.round(r.top),
    btnBottom: Math.round(r.bottom),
    btnHits: !!hit && (hit === btn || btn.contains(hit)),
    bodyClient: body.clientHeight,
    bodyScroll: body.scrollHeight,
    listClient: list.clientHeight,
    listScroll: list.scrollHeight,
    rows: list.querySelectorAll('.multi-row').length,
  };
}"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False, args=['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb']
        )
        pg, errors = va.new_page(b)
        # 自述会在后台拉 raw，mock 环境必被 CORS 挡；提前掐掉，console 断言才只反映本次改动
        pg.route(re.compile(r'https://github\.com/.*/raw/.*'), lambda r: r.abort())
        pg.click('.tabbar button:has-text("仓库")')
        pg.wait_for_selector('.rows .row', timeout=15000)
        pg.wait_for_timeout(400)
        pg.locator('.rows .row').first.click()
        pg.wait_for_selector('.sheet .acts', timeout=10000)
        pg.wait_for_timeout(400)

        pg.click('.actrow:has-text("下载源码 ZIP")')
        pg.wait_for_selector('.sheet.dl-sheet', timeout=10000)
        pg.wait_for_timeout(800)

        assert pg.locator('.dl-foot').count() == 1, '下载面板应有独立的底部按钮区'
        assert pg.locator('.multi-list.dl-routes').count() == 1, '线路表应带限高标记'
        print('[0] 下载面板：体部 / 底部 / 线路表三段就位')

        m0 = pg.evaluate(MEASURE)
        assert m0['btnHits'], f'按钮被别的东西盖住了：{m0}'
        assert m0['footBottom'] <= m0['vh'] + 1, f'底部按钮超出视口：{m0}'
        print(f'[1] 默认线路 {m0["rows"]} 条，按钮在视口内（bottom {m0["footBottom"]} <= {m0["vh"]}）')

        # ── 塞 14 条模拟线路 ──
        rows = pg.evaluate(INJECT)
        pg.wait_for_timeout(500)
        m = pg.evaluate(MEASURE)
        assert rows >= 16, f'注入失败，只有 {rows} 条'
        assert m['listScroll'] > m['listClient'], f'线路表没有内部滚动：{m}'
        assert m['listClient'] <= 302, f'线路表限高失效：{m["listClient"]}px'
        assert m['footBottom'] <= m['vh'] + 1, f'线路变多后按钮被顶出屏幕：{m}'
        assert m['btnHits'], f'线路变多后按钮被盖住：{m}'
        print(f'[2] {rows} 条线路：表内滚 {m["listClient"]}/{m["listScroll"]}，按钮仍在 {m["btnTop"]}–{m["btnBottom"]}')

        # 体部可滚（线路表限高后未必需要滚），滚它 / 滚线路表都不许带动底部
        ov = pg.evaluate("() => getComputedStyle(document.querySelector('.dl-body')).overflowY")
        assert ov in ('auto', 'scroll'), f'.dl-body 不是滚动容器：{ov}'
        pg.evaluate("() => { document.querySelector('.dl-routes').scrollTop = 99999 }")
        pg.wait_for_timeout(250)
        m2 = pg.evaluate(MEASURE)
        assert m2['footTop'] == m['footTop'], '滚线路表时底部按钮跟着动了'
        assert m2['btnHits'], f'滚到底后按钮被盖住：{m2}'
        if m['bodyScroll'] > m['bodyClient']:
            pg.evaluate("() => { document.querySelector('.dl-body').scrollTop = 99999 }")
            pg.wait_for_timeout(250)
            m3 = pg.evaluate(MEASURE)
            assert m3['footTop'] == m['footTop'], '滚体部时底部按钮跟着动了'
            print('[3] 体部与线路表各自滚动，底部按钮固定不动')
        else:
            print(f'[3] 线路表限高生效（{m["listClient"]}/{m["listScroll"]}），体部无需滚动；底部固定')

        pg.screenshot(path=f'{OUT}/download-sheet.png')

        # 打开面板时后台会去拉自述与 codeload，mock 环境里被 CORS 挡是环境噪声，
        # 不是应用错误；只对剩下的报错较真
        noise = ('CORS', 'ERR_FAILED', 'codeload', 'README')
        real = [e for e in errors if not any(k in e for k in noise)]
        assert not real, f'console 有报错：{real[:3]}'
        print(f'全部断言通过（忽略 {len(errors) - len(real)} 条跨域噪声）')


if __name__ == '__main__':
    main()
