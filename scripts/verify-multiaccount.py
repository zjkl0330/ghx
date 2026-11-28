#!/usr/bin/env python3
"""多账号数据隔离的端到端验收。

背景：v1.2.x 切账号时，星标页与热门页的本地状态不跟着换 ——
列表、搜索词、点过的星标都还是上一个账号的，顶部账号名却已经变了。

做法：第二个账号故意用一枚**无效令牌**（格式合法、GitHub 返 401）。
切过去之后：

- 星标页必须是「空的 + 明确的错误」，不能还挂着上一个账号那几百个仓库；
- 热门页同理，不能把上一个账号的榜单留在屏幕上；
- 切回第一个账号，数据要能重新回来。

这样只要出现串号就一定会被抓到：坏令牌不可能拉到和好令牌一样的数据。

用法：
    GHX_TOKEN=ghp_xxx xvfb-run -a python3 scripts/verify-multiaccount.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
TOKEN = os.environ.get('GHX_TOKEN', '')
SHOTS = '/workspace/ghx/docs/screenshots'
# 格式合法但必然 401：用来区分「这个账号自己的数据」和「上一个账号残留」
BAD = 'ghp_' + 'z' * 36


def login(pg):
    pg.goto(BASE)
    pg.wait_for_timeout(600)
    pg.click('.who-btn')
    pg.wait_for_timeout(300)
    pg.click('text=添加账号')
    pg.wait_for_timeout(400)
    pg.fill('input[placeholder="例如 主力令牌"]', '主账号')
    pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', TOKEN)
    pg.click('text=加密保存')
    pg.wait_for_timeout(2500)
    pg.wait_for_selector('.rows .row', timeout=40_000)


def add_second(pg):
    pg.click('.who-btn')
    pg.wait_for_timeout(300)
    pg.click('text=添加账号')
    pg.wait_for_timeout(400)
    pg.fill('input[placeholder="例如 主力令牌"]', '副账号')
    pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', BAD)
    pg.click('text=加密保存')
    pg.wait_for_timeout(2500)
    # 面板里有两条记录才算真的加上了
    pg.click('.who-btn')
    pg.wait_for_timeout(500)
    rows = pg.locator('.acct-row').count()
    assert rows == 2, f'账号数应为 2，实际 {rows}'
    # 关掉面板再继续：遮罩会挡住底栏
    pg.locator('.sheet button[aria-label="关闭"]').first.click()
    pg.wait_for_timeout(400)


def switch_to(pg, label):
    # 账号入口只在「仓库」页与个人页上；星标 / 热门页没有头像按钮
    pg.locator('.tabbar button', has_text='仓库').first.click()
    pg.wait_for_timeout(500)
    pg.click('.who-btn')
    pg.wait_for_timeout(400)
    pg.locator('.acct-row', has_text=label).first.click()
    pg.wait_for_timeout(300)


def open_stars(pg):
    pg.locator('.tabbar button', has_text='星标').first.click()


def open_hot(pg):
    pg.locator('.tabbar button', has_text='热门').first.click()


def main():
    if not TOKEN:
        print('缺少 GHX_TOKEN')
        return 2

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=['--no-sandbox', '--hide-scrollbars'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)[:300]))

        login(pg)
        add_second(pg)

        # ── 1. 主账号：仓库与星标都要有数据 ──
        good = pg.locator('.rows .row').count()
        print(f'  主账号仓库：{good} 条')
        assert good > 0
        open_stars(pg)
        pg.wait_for_selector('.rows .row', timeout=60_000)
        stars = pg.locator('.rows .row').count()
        print(f'  主账号星标：{stars} 条')
        assert stars > 0

        # ── 2. 切到坏令牌账号：仓库页必须空 + 明确报错 ──
        switch_to(pg, '副账号')
        pg.wait_for_timeout(1200)
        assert pg.locator('.rows .row').count() == 0, '副账号页面出现了主账号的仓库'
        pg.wait_for_selector('.warnbox', timeout=30_000)
        warn = pg.locator('.warnbox').first.inner_text()
        print(f'  副账号错误提示：{warn.strip()}')
        assert '令牌' in warn or '限流' in warn, warn
        print('  切到副账号后仓库列表已清空 ✓')

        # ── 3. 星标页：不能挂着主账号的星标 ──
        open_stars(pg)
        pg.wait_for_timeout(2000)
        assert pg.locator('.rows .row').count() == 0, '副账号的星标页出现了主账号的数据'
        print('  星标页没有串号 ✓')
        pg.screenshot(path=f'{SHOTS}/multiaccount-stars.png')

        # ── 4. 热门页：不能留下主账号的榜单 ──
        open_hot(pg)
        pg.wait_for_timeout(2500)
        hot_left = pg.locator('.hot-row .row-name').all_inner_texts()
        assert not hot_left, f'热门页残留了上一个账号的榜单：{hot_left[:5]}'
        print('  热门页没有残留上一个账号的榜单 ✓')

        # ── 5. 切回主账号，数据要回来 ──
        switch_to(pg, '主账号')
        pg.wait_for_selector('.rows .row', timeout=60_000)
        back = pg.locator('.rows .row').count()
        print(f'  切回主账号：{back} 条仓库')
        assert back > 0
        open_stars(pg)
        pg.wait_for_selector('.rows .row', timeout=60_000)
        print(f'  切回后星标：{pg.locator(".rows .row").count()} 条')

        assert not errors, f'页面报错：{errors}'
        browser.close()

    print('\n多账号隔离验收通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
