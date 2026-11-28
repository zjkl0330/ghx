"""星标文件夹：建组 → 归类 → 筛选 → 改名 → 删除，在真实界面上点一遍。

只断言语义与计数，不比对像素：
- 建完要有 chip、要有「N 个仓库」；
- 归类后行内要出现组名，文件夹筛选后只剩那一条；
- 改名要立刻反映到 chip，删除后仓库回到「未分类」。
"""
import importlib.util
import json
import os
import re

from playwright.sync_api import sync_playwright

OUT = '/workspace/ghx/docs/screenshots'
BASE = 'http://127.0.0.1:4173/'

_here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('va', os.path.join(_here, 'verify-apkstore.py'))
va = importlib.util.module_from_spec(spec)
spec.loader.exec_module(va)


def starred_pair(route):
    """星标接口默认只回 1 个仓库，筛不出「留下 / 移出」的差别，这里补成 2 个。

    其它接口仍交给默认 mock，避免为了这一条把共享夹具改胖，
    让别的脚本的数字跟着漂。
    """
    if '/user/starred' in route.request.url:
        data = [dict(r) for r in va.REPOS]
        extra = dict(data[0])
        extra['id'] = 90001
        extra['name'] = 'ghx-notes'
        extra['full_name'] = 'zjkl0330/ghx-notes'
        extra['description'] = '验证文件夹筛选用的第二个仓库'
        data.append(extra)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))
        return
    va.handle(route)


def sheet_text(pg):
    return pg.inner_text('.sheet')


def close_sheet(pg):
    pg.click('.sheet .icon-btn[aria-label="关闭"]')
    pg.wait_for_timeout(350)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False, args=['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb']
        )
        pg, errors = va.new_page(b)
        # 详情/自述会在后台拉 raw，mock 环境里必被 CORS 挡，提前掐掉免得污染 console 断言
        pg.route(re.compile(r'https://github\.com/.*/raw/.*'), lambda r: r.abort())
        pg.unroute('**/api.github.com/**')
        pg.route('**/api.github.com/**', starred_pair)
        pg.click('.tabbar button:has-text("星标")')
        # 热门页也有 .rows .row，等星标页自己的文件夹条出现才算切过去
        pg.wait_for_selector('.folder-row', timeout=20000)
        pg.wait_for_function("() => document.querySelectorAll('.rows .row').length > 1", timeout=20000)
        pg.wait_for_timeout(500)

        total = pg.locator('.rows .row').count()
        assert total > 1, '星标列表至少要有两条才试得出筛选'
        print(f'[0] 星标列表 {total} 条，文件夹条已就位：{pg.inner_text(".folder-row").strip()[:40]}')

        # ── 1. 新建文件夹 ──
        pg.click('.folder-row .folder-add')
        pg.wait_for_selector('.sheet', timeout=8000)
        assert '文件夹' in pg.inner_text('.sheet h3'), sheet_text(pg)
        pg.click('.sheet .btn.primary:has-text("新建文件夹")')
        pg.wait_for_selector('#folder-name', timeout=5000)
        pg.fill('#folder-name', '测试分组')
        pg.click('.sheet .btn.primary')
        pg.wait_for_timeout(600)
        assert '测试分组' in sheet_text(pg), '建完应回到管理列表并看到新组'
        close_sheet(pg)

        chips = pg.inner_text('.folder-row')
        assert '测试分组' in chips, f'文件夹条里没有新组：{chips}'
        print('[1] 新建文件夹：chip 出现')

        # ── 1b. 返回键先收面板，不跳页签 ──
        pg.click('.folder-row .folder-add')
        pg.wait_for_selector('.sheet', timeout=8000)
        pg.keyboard.press('Escape')
        pg.wait_for_selector('.sheet', state='detached', timeout=5000)
        assert pg.locator('.folder-row').count() == 1, '关面板时不该把页面也跳走'
        print('[1b] 返回键只收面板，页面留在星标')

        # ── 2. 归类第一条 ──
        first = pg.locator('.star-row').first
        # 行文本里 owner 与 name 是分开的两行，取 .row-name 才拿得到仓库名
        first_name = first.locator('.row-name').inner_text().strip()
        first.locator('.icon-btn[aria-label*="归类"]').click()
        pg.wait_for_selector('.sheet .multi-row', timeout=8000)
        assert '未分类' in sheet_text(pg), '归类面板应有「未分类」选项'
        pg.locator('.sheet .multi-row', has_text='测试分组').click()
        pg.wait_for_timeout(700)
        assert '测试分组' in first.inner_text(), f'行内应有组名标记：{first.inner_text()[:80]}'
        print(f'[2] 归类：{first_name} 已带上组名标记')

        # ── 3. 按文件夹筛选 ──
        pg.locator('.folder-row .chip', has_text='测试分组').click()
        pg.wait_for_timeout(500)
        n = pg.locator('.rows .row').count()
        names = [t.strip() for t in pg.locator('.rows .row .row-name').all_inner_texts()]
        assert n == 1, f'文件夹里应只有 1 条，实际 {n}'
        assert names == [first_name], f'筛出来的应是刚归类的那条，实际 {names}'

        pg.locator('.folder-row .chip', has_text='未分类').click()
        pg.wait_for_timeout(500)
        n2 = pg.locator('.rows .row').count()
        names2 = [t.strip() for t in pg.locator('.rows .row .row-name').all_inner_texts()]
        assert n2 == total - 1, f'未分类应有 {total - 1} 条，实际 {n2}'
        assert first_name not in names2, f'已归类的仓库不该出现在未分类里：{names2}'
        print(f'[3] 筛选：组内 1 条 / 未分类 {n2} 条，互不串台')

        # ── 4. 改名 ──
        pg.click('.folder-row .chip:has-text("全部")')
        pg.wait_for_timeout(300)
        pg.click('.folder-row .folder-add')
        pg.wait_for_selector('.sheet .multi-row', timeout=8000)
        pg.locator('.sheet .multi-row', has_text='测试分组').click()
        pg.wait_for_selector('#folder-name', timeout=5000)
        pg.fill('#folder-name', '改名后')
        pg.click('.sheet .btn.primary')
        pg.wait_for_timeout(600)
        assert '改名后' in sheet_text(pg)
        close_sheet(pg)
        assert '改名后' in pg.inner_text('.folder-row'), 'chip 上的名字没跟着改'
        print('[4] 改名：chip 同步')

        # 截图留档（归类标记 + 组 chip 同屏）
        pg.locator('.folder-row .chip', has_text='改名后').click()
        pg.wait_for_timeout(400)
        pg.screenshot(path=f'{OUT}/stars-folders.png')

        # ── 5. 删除：仓库回到未分类，star 不受影响 ──
        pg.locator('.folder-row .chip:has-text("全部")').click()
        pg.wait_for_timeout(300)
        pg.click('.folder-row .folder-add')
        pg.wait_for_selector('.sheet .multi-row', timeout=8000)
        pg.locator('.sheet .multi-row', has_text='改名后').click()
        pg.wait_for_selector('#folder-name', timeout=5000)
        pg.click('.sheet .linkbtn:has-text("删除这个文件夹")')
        pg.wait_for_timeout(300)
        pg.click('.sheet .btn.danger:has-text("确认删除")')
        pg.wait_for_timeout(600)
        assert '改名后' not in sheet_text(pg), '删完管理列表里不该还有它'
        close_sheet(pg)
        assert '改名后' not in pg.inner_text('.folder-row'), 'chip 没删掉'
        assert pg.locator('.rows .row').count() == total, '删文件夹不该减少仓库数量'
        print('[5] 删除：组消失，仓库数量不变')

        # 自述/热门会在后台拉 raw，mock 环境里被 CORS 挡是环境噪声；
        # 只对剩下的报错较真
        noise = ('CORS', 'ERR_FAILED', 'README', 'codeload')
        real = [e for e in errors if not any(k in e for k in noise)]
        assert not real, f'console 有报错：{real[:3]}'
        print(f'全部断言通过（忽略 {len(errors) - len(real)} 条跨域噪声）')


if __name__ == '__main__':
    main()
