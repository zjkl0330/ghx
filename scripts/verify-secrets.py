#!/usr/bin/env python3
"""主 / 副密钥面板的端到端验收。

要证明：
1. 一个账号能配副密钥，配完在面板里**直接显示明文**（不需要任何密码）；
2. 主密钥在解锁前不出现，点「查看」要先设查看密码，设完才显示；
3. 关掉面板再进来，主密钥重新遮住；密码错要拒绝，密码对才显示。

用法：
    GHX_TOKEN=ghp_xxx xvfb-run -a python3 scripts/verify-secrets.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
TOKEN = os.environ.get('GHX_TOKEN', '')
SHOTS = '/workspace/ghx/docs/screenshots'
SUB = 'ghp_' + 'subtokenverify0123456789abcdefgh'
VIEW_PASS = 'view-pass-9'


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
    pg.wait_for_timeout(2500)
    pg.wait_for_selector('.rows .row', timeout=40_000)


def open_vault(pg):
    pg.click('.avatar-btn')
    pg.wait_for_timeout(400)
    pg.locator('button.linkrow', has_text='令牌保险库').first.click()
    pg.wait_for_timeout(500)
    pg.wait_for_selector('.tk-keys', timeout=10_000)


def sec_values(pg):
    return pg.locator('.sec-value').all_inner_texts()


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
        open_vault(pg)
        pg.locator('.tk-keys').first.click()
        pg.wait_for_timeout(600)

        # ── 1. 副密钥：添加后直接可见 ──
        main_seen_before = any(TOKEN in v for v in sec_values(pg))
        assert not main_seen_before, '主密钥在未解锁时就已经显示出来了'
        print('  主密钥默认不可见 ✓')

        pg.locator('text=添加副密钥').click()
        pg.wait_for_timeout(300)
        pg.fill('#secsub', SUB)
        pg.locator('.sec-acts .btn.primary').click()
        pg.wait_for_timeout(800)
        vals = sec_values(pg)
        assert any(SUB in v for v in vals), f'副密钥没有直接展示：{vals}'
        print('  副密钥保存后直接显示明文 ✓')
        pg.screenshot(path=f'{SHOTS}/secret-secondary.png')

        # ── 2. 主密钥：先设查看密码，再展示 ──
        pg.locator('text=输入并设置查看密码').click()
        pg.wait_for_timeout(300)
        # 只截「要求输密码」这一步：解锁后屏幕上就是真令牌，不该留在仓库里
        pg.screenshot(path=f'{SHOTS}/secret-gate.png')
        pg.fill('#secpass', VIEW_PASS)
        pg.fill('#secpass2', VIEW_PASS)
        pg.locator('.sec-acts .btn.primary').click()
        pg.wait_for_timeout(1500)
        vals = sec_values(pg)
        assert any(TOKEN in v for v in vals), f'解锁后仍看不到主密钥：{vals}'
        print('  设置查看密码后展示主密钥 ✓')

        # ── 3. 关掉再进来：主密钥重新遮住，密码错被拒 ──
        pg.locator('.sheet .icon-btn').first.click()
        pg.wait_for_timeout(500)
        assert not pg.locator('.sec-sheet').count(), '面板没关掉'
        pg.locator('.tk-keys').first.click()
        pg.wait_for_timeout(600)
        assert not any(TOKEN in v for v in sec_values(pg)), '重新打开后主密钥不该还在'
        print('  重新打开后主密钥已重新遮住 ✓')

        pg.locator('text=输入查看密码查看').click()
        pg.wait_for_timeout(300)
        pg.fill('#secpass', 'wrong-pass')
        pg.locator('.sec-acts .btn.primary').click()
        pg.wait_for_timeout(1200)
        err = pg.locator('.err').first.inner_text() if pg.locator('.err').count() else ''
        assert '不正确' in err, f'错误查看密码没有被拒绝：{err!r}'
        print('  错误查看密码被拒绝 ✓')

        pg.fill('#secpass', VIEW_PASS)
        pg.locator('.sec-acts .btn.primary').click()
        pg.wait_for_timeout(1500)
        assert any(TOKEN in v for v in sec_values(pg)), '正确密码仍看不到主密钥'
        print('  正确查看密码后重新显示 ✓')

        assert not errors, f'页面报错：{errors}'
        browser.close()

    print('\n主 / 副密钥验收通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
