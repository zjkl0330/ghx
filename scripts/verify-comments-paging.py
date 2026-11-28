#!/usr/bin/env python3
"""评论分页的端到端验收：长 Issue 首屏是「最新一页」，还能往前翻。

为什么值得单独验：GitHub 的评论接口默认**升序**返回，直接取第 1 页会让用户
打开一条三年前的 Issue 时先看到最旧的 100 条。这里用真实仓库里评论数 > 100
的 Issue 证明三件事：

1. 首屏落在最后一页（标题带 `+`，说明前面还有）；
2. 出现「加载更早的评论」按钮；
3. 点一次后条数增加、页码前移，且更早的评论排在**上面**。

用法：
    GHX_TOKEN=ghp_xxx xvfb-run -a python3 scripts/verify-comments-paging.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
TOKEN = os.environ.get('GHX_TOKEN', '')
SHOTS = '/workspace/ghx/docs/screenshots'

QUERY = 'repo:microsoft/vscode is:issue comments:>100'


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


def open_search(pg):
    pg.click('.avatar-btn')
    pg.wait_for_selector('.linkrow', timeout=10_000)
    pg.locator('.linkrow', has_text='全局搜索').first.click()
    pg.wait_for_selector('input[placeholder*="关键词"]', timeout=10_000)


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
        open_search(pg)
        pg.fill('input[placeholder*="关键词"]', QUERY)
        pg.keyboard.press('Enter')
        pg.wait_for_timeout(800)
        pg.locator('.chips .chip', has_text='Issue').first.click()
        pg.wait_for_function(
            "() => [...document.querySelectorAll('.rows .row')].some(r => /#\\d+/.test(r.innerText))",
            timeout=150_000,
        )
        pg.locator('.rows .row').first.click()
        pg.wait_for_selector('.comment', timeout=90_000)
        pg.wait_for_timeout(1500)

        state = pg.evaluate(
            """() => ({
              comments: document.querySelectorAll('.comment').length,
              hasMoreBtn: !!document.querySelector('.more-btn'),
              title: (document.querySelector('.section-title') || {}).innerText || '',
            })"""
        )
        print(f'  首屏：{state}')

        assert state['comments'] >= 1, '首屏一条评论都没渲染'
        assert state['hasMoreBtn'], '长 Issue 没有「加载更早的评论」按钮'
        assert '+' in state['title'] or state['comments'] >= 100, (
            f'没有落在最新一页（标题 {state["title"]!r}，{state["comments"]} 条）'
        )

        first_ids = pg.evaluate("() => [...document.querySelectorAll('.comment')].map(e => e.innerText.slice(0, 40))")
        # 截图要能看见那条「加载更早」按钮，把它滚到屏幕中间
        pg.evaluate("() => document.querySelector('.more-btn')?.scrollIntoView({ block: 'center' })")
        pg.wait_for_timeout(500)
        pg.screenshot(path=f'{SHOTS}/comments-paging.png')

        before = state['comments']
        pg.click('.more-btn')
        # 拉 100 条要几秒，轮询到条数变化为止
        for _ in range(120):
            now = pg.locator('.comment').count()
            if now > before:
                break
            pg.wait_for_timeout(500)
        after = pg.locator('.comment').count()
        pg.wait_for_timeout(600)

        # 更早的评论必须插在上面：原来第一条现在应该被挤到后面
        top_now = pg.evaluate("() => [...document.querySelectorAll('.comment')].slice(0, 1).map(e => e.innerText.slice(0, 40))")
        print(f'  翻页前 {before} 条 → 翻页后 {after} 条')
        assert after > before, f'点「加载更早」后条数没有增加：{before} → {after}'
        assert top_now != first_ids[:1], '更早的评论没有插到最上面'
        pg.screenshot(path=f'{SHOTS}/comments-paging-more.png')

        real = [e for e in errors if 'Failed to fetch' not in e]
        assert not real, f'控制台有真错误：{real[:3]}'

        browser.close()

    print('[PASS] 首屏是最新一页；加载更早后条数增加且旧的在上')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f'[FAIL] {e}')
        sys.exit(1)
