#!/usr/bin/env python3
"""回到顶部 + 热门榜单条数的端到端验收。

真令牌、真搜索接口。两条链路都要能证明：

1. 热门页三个时间段各拉 30 个（HOT_PAGE_SIZE），不是「首屏骨架 10 行」或
   「某个语言筛完只剩个位数」；
2. 滚过一屏出现回到顶部按钮，点一下真的回到 0，换页签后按钮自己消失。

用法：
    GHX_TOKEN=ghp_xxx xvfb-run -a python3 scripts/verify-backtotop.py
"""

import os
import sys
import urllib.error

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
TOKEN = os.environ.get('GHX_TOKEN', '')
SHOTS = '/workspace/ghx/docs/screenshots'

# 首屏要等搜索接口（国内 + 本沙箱都慢），30 条带完整仓库对象
FIRST_LOAD_MS = 120_000
SWITCH_LOAD_MS = 60_000


def login(pg):
    pg.goto(BASE)
    pg.wait_for_timeout(600)
    pg.click('.who-btn')
    pg.wait_for_timeout(300)
    pg.click('text=添加账号')
    pg.wait_for_timeout(400)
    pg.fill('input[placeholder="例如 主力令牌"]', '验收令牌')
    pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', TOKEN)
    pg.click('text=加密保存')
    pg.wait_for_timeout(3000)
    pg.wait_for_selector('.rows .row', timeout=30_000)


def open_hot(pg):
    pg.locator('.tabbar button', has_text='热门').first.click()
    # 骨架行也带 .hot-row，所以不能只等它；等真数据：排名数字出现即说明列表已换上
    pg.wait_for_selector('.hot-rank', timeout=FIRST_LOAD_MS)
    pg.wait_for_timeout(800)


def count_rows(pg):
    return pg.locator('.rows .row').count()


def wait_rows(pg, want, timeout_ms):
    """等到列表条数达到 want；搜索慢时轮询，比固定 sleep 稳。"""
    grown = 0
    while grown * 500 < timeout_ms:
        if count_rows(pg) >= want:
            return True
        pg.wait_for_timeout(500)
        grown += 1
    return False


def main():
    if not TOKEN:
        print('缺少 GHX_TOKEN')
        return 2

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=['--no-sandbox', '--hide-scrollbars'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)[:200]))

        login(pg)
        open_hot(pg)

        # ── 1. 三个时间段各 30 个 ──
        counts = {}
        for label in ('今日', '本周', '本月'):
            pg.locator('.seg button', has_text=label).first.click()
            ok = wait_rows(pg, 30, SWITCH_LOAD_MS)
            n = count_rows(pg)
            counts[label] = n
            print(f'  {label}: {n} 条 {"（已满 30）" if ok else "（未满，接口返回不足）"}')
        pg.screenshot(path=f'{SHOTS}/hot-30.png')

        assert counts['今日'] >= 30 and counts['本周'] >= 30 and counts['本月'] >= 30, (
            f'榜单没有拉满 30 条：{counts}'
        )

        # 描述两行：找一条长描述，量它的高度是否超过单行
        desc_h = pg.evaluate(
            """() => {
              const els = [...document.querySelectorAll('.hot-row .row-desc')];
              if (!els.length) return null;
              const el = els.map(e => e.getBoundingClientRect().height).sort((a,b) => b-a)[0];
              const lh = parseFloat(getComputedStyle(els[0]).lineHeight) || 16;
              return { tallest: Math.round(el), lineHeight: Math.round(lh) };
            }"""
        )
        print(f'  描述行高：{desc_h}')
        assert desc_h and desc_h['tallest'] > desc_h['lineHeight'] * 1.5, (
            f'热门描述没有放开两行：{desc_h}'
        )

        # ── 2. 回到顶部 ──
        pg.evaluate("() => { const e = document.querySelector('.page'); e.scrollTop = 1600 }")
        pg.wait_for_timeout(500)
        btn = pg.locator('button.backtotop')
        assert btn.count() == 1, '滚动后没有出现回到顶部按钮'
        print('  按钮已出现')
        pg.screenshot(path=f'{SHOTS}/backtotop.png')

        btn.click()
        pg.wait_for_timeout(1200)
        top = pg.evaluate("() => document.querySelector('.page').scrollTop")
        print(f'  点击后 scrollTop={top}')
        assert top < 8, f'点击后没有回到顶部：scrollTop={top}'

        # 按钮消失
        pg.wait_for_timeout(400)
        assert pg.locator('button.backtotop').count() == 0, '回到顶部后按钮没有收起'

        # ── 3. 换页签后按钮不能残留 ──
        pg.evaluate("() => { document.querySelector('.page').scrollTop = 1600 }")
        pg.wait_for_timeout(400)
        assert pg.locator('button.backtotop').count() == 1, '滚动后按钮没出现（第二段）'
        pg.locator('.tabbar button', has_text='仓库').first.click()
        pg.wait_for_timeout(800)
        assert pg.locator('button.backtotop').count() == 0, '换页签后按钮残留在新页面上'
        print('  换页签后按钮已收起')

        real = [e for e in errors if 'Failed to fetch' not in e]
        assert not real, f'控制台有真错误：{real[:3]}'

        browser.close()

    print('[PASS] 三榜各 30 条；回到顶部出现 / 归零 / 收起；换页签不残留')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f'[FAIL] {e}')
        sys.exit(1)
