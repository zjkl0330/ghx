#!/usr/bin/env python3
"""备份 / 恢复的端到端验收。

要证明的四件事（都用真令牌、真界面跑）：

1. 设置页 → 备份与恢复 能打开，文件名带账号与时间（`ghx-backup-<login>-<时间>.json`）；
2. 勾「连同密钥」必须填导出密码，导出的文件里**看不到**明文令牌；
3. 文件能被解析出账号 / 设置 / 密钥三类计数；
4. 把刚导出的文件选回去能恢复：密码错要报错，密码对能写回并重载。

用法：
    GHX_TOKEN=ghp_xxx xvfb-run -a python3 scripts/verify-backup.py
"""

import json
import os
import re
import sys
import tempfile

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
TOKEN = os.environ.get('GHX_TOKEN', '')
SHOTS = '/workspace/ghx/docs/screenshots'
PASS = 'verify-pass-2026'


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


def open_settings(pg):
    # .who-btn 在多账号可用时打开账号面板，个人页在左边那个头像按钮上
    pg.click('.avatar-btn')
    pg.wait_for_timeout(400)
    pg.locator('button.linkrow', has_text='设置').first.click()
    pg.wait_for_timeout(500)
    pg.wait_for_selector('text=备份与恢复', timeout=10_000)


def main():
    if not TOKEN:
        print('缺少 GHX_TOKEN')
        return 2

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=['--no-sandbox', '--hide-scrollbars'])
        ctx = browser.new_context(
            viewport={'width': 390, 'height': 844},
            device_scale_factor=2,
            accept_downloads=True,
        )
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)[:300]))

        login(pg)
        open_settings(pg)

        # 先改一个偏好，让备份里真的有设置可带（全新安装时所有键都是默认值，一条都不落盘）
        pg.locator('.seg button', has_text='浅色').first.click()
        pg.wait_for_timeout(400)
        theme = pg.evaluate("localStorage.getItem('ghx.theme')")
        assert theme == 'light', f'主题没写进存储：{theme!r}'
        print('  已切到浅色（ghx.theme=light）✓')

        pg.locator('button.linkrow', has_text='导出 / 恢复').click()
        pg.wait_for_timeout(500)
        assert pg.locator('text=备份与恢复').count() > 0

        # ── 1. 文件名可认 ──
        name = pg.locator('.bk-file b').first.inner_text()
        print(f'  文件名：{name}')
        assert re.match(r'^ghx-backup-[a-z0-9_-]+-\d{8}-\d{4}\.json$', name), name

        # ── 2. 带密钥必须给密码 ──
        pg.locator('.btn.primary.block').first.click()
        pg.wait_for_timeout(400)
        err = pg.locator('.err').first.inner_text() if pg.locator('.err').count() else ''
        assert '至少' in err, f'空密码应当被拦下，实际提示：{err!r}'
        print('  空导出密码被拦下 ✓')

        # ── 3. 导出并检查文件 ──
        pg.fill('#bkpass', PASS)
        pg.screenshot(path=f'{SHOTS}/backup-export.png')
        with pg.expect_download(timeout=30_000) as dl:
            pg.locator('.btn.primary.block').first.click()
        download = dl.value
        tmp = os.path.join(tempfile.mkdtemp(), download.suggested_filename)
        download.save_as(tmp)
        raw = open(tmp, encoding='utf-8').read()
        data = json.loads(raw)
        print(f'  下载：{download.suggested_filename} ({len(raw)} 字节)')

        assert data['app'] == 'ghx' and data['v'] == 1
        assert data['counts']['accounts'] >= 1 and data['counts']['settings'] >= 1
        assert 'sealed' in data and data['sealed']['alg'] == 'AES-256-GCM'
        assert TOKEN not in raw, '备份文件里出现了明文令牌'
        assert 'ghp_' + TOKEN[-6:] not in raw
        print(f"  账号 {data['counts']['accounts']} · 设置 {data['counts']['settings']} · 密钥已加密 ✓")
        pg.wait_for_selector('.bk-done', timeout=10_000)

        # ── 4. 选文件恢复：先错密码，再对密码 ──
        pg.locator('.seg button', has_text='恢复').first.click()
        pg.wait_for_timeout(300)
        with pg.expect_file_chooser() as fc:
            pg.click('text=选择备份文件')
        fc.value.set_files(tmp)
        pg.wait_for_selector('.bk-grid', timeout=15_000)
        grid = pg.locator('.bk-grid b').all_inner_texts()
        print(f'  摘要：{grid}')
        assert grid[0] == str(data['counts']['accounts'])

        pg.fill('#bkres', 'wrong-pass')
        pg.locator('.btn.primary.block').first.click()
        pg.wait_for_timeout(1200)
        err = pg.locator('.err').first.inner_text() if pg.locator('.err').count() else ''
        assert '密码' in err, f'错误密码应被拒绝，实际：{err!r}'
        print('  错误导出密码被拒绝 ✓')

        # 改成本机不同的值，再用「覆盖」恢复，验证备份里的值真被写回去
        pg.evaluate("localStorage.setItem('ghx.theme','dark')")
        pg.locator('.seg button', has_text='覆盖').first.click()

        pg.fill('#bkres', PASS)
        pg.screenshot(path=f'{SHOTS}/backup-restore.png')
        pg.locator('.btn.primary.block').first.click()
        pg.wait_for_selector('.bk-done', timeout=20_000)
        msg = pg.locator('.bk-done').first.inner_text()
        print(f'  恢复结果：{msg.strip()}')
        assert '设置写回' in msg

        # 恢复完会重载，重载后仍要是已登录状态
        pg.wait_for_timeout(2600)
        pg.wait_for_selector('.rows .row', timeout=40_000)
        back = pg.evaluate("localStorage.getItem('ghx.theme')")
        assert back == 'light', f'恢复没有把主题写回去：{back!r}'
        print('  重载后主题已按备份恢复（light）✓')

        assert not errors, f'页面报错：{errors}'
        browser.close()

    print('\n备份 / 恢复验收通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
