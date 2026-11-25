"""Issue 动态（timeline）：真令牌、真仓库、真事件。

验的是「标签怎么变、谁关的、什么时候指派的」这条信息能不能看见 ——
以前详情页只有评论，标签变化完全没有痕迹。

流程：登录 → 我的 → 全局搜索 → 搜 `is:issue is:open label:bug` → 点第一条
→ 详情页出现「动态」区块，且至少一条事件有头像/文案。

跑法：
    pnpm build && npx vite preview --port 4173
    GHX_TOKEN=ghp_… xvfb-run -a python3 scripts/verify-timeline.py
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
TOKEN = os.environ.get('GHX_TOKEN', '').strip()
QUERY = 'repo:microsoft/vscode is:issue is:open label:bug'
PR_QUERY = 'repo:microsoft/vscode is:pr is:open'


def login(pg, token):
    pg.click('.who-btn')
    pg.wait_for_timeout(300)
    pg.click('text=添加账号')
    pg.wait_for_timeout(400)
    pg.fill('input[placeholder="例如 主力令牌"]', '验收令牌')
    pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', token)
    pg.click('text=加密保存')
    pg.wait_for_timeout(3000)


def open_search(pg):
    """从任意位置回到「全局搜索」：连按 Esc 退路由，再从「我的」进去。"""
    for _ in range(6):
        if pg.locator('input[placeholder*="关键词"]').count() > 0:
            return
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(400)
    pg.click('.avatar-btn')
    pg.wait_for_selector('.linkrow', timeout=10000)
    pg.locator('.linkrow', has_text='全局搜索').first.click()
    pg.wait_for_selector('input[placeholder*="关键词"]', timeout=10000)


def search_kind(pg, query, chip):
    open_search(pg)
    pg.fill('input[placeholder*="关键词"]', query)
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(800)
    pg.locator('.chips .chip', has_text=chip).first.click()
    pg.wait_for_function(
        "() => [...document.querySelectorAll('.rows .row')].some(r => /#\\d+/.test(r.innerText))",
        timeout=150000,
    )
    pg.wait_for_timeout(400)


def main():
    if not TOKEN:
        print('缺少 GHX_TOKEN 环境变量', file=sys.stderr)
        return 2

    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False, args=['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb']
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(BASE)
        pg.wait_for_timeout(600)
        login(pg, TOKEN)

        pg.wait_for_selector('.rows .row', timeout=30000)
        pg.click('.avatar-btn')
        pg.wait_for_selector('.linkrow', timeout=10000)
        pg.locator('.linkrow', has_text='全局搜索').first.click()
        pg.wait_for_selector('input[placeholder*="关键词"]', timeout=10000)

        pg.fill('input[placeholder*="关键词"]', QUERY)
        pg.keyboard.press('Enter')
        pg.wait_for_timeout(800)
        # 切到 Issue 类型（搜索结果默认是仓库）
        pg.locator('.chips .chip', has_text='Issue').first.click()
        # 切类型不会清空旧结果：必须等到「行里出现 #编号」才算真的换成 Issue 列表
        # （搜索接口在国内/本沙箱都很慢，30 条带正文可能二三十秒）
        pg.wait_for_function(
            "() => [...document.querySelectorAll('.rows .row')].some(r => /#\\d+/.test(r.innerText))",
            timeout=120000,
        )
        pg.wait_for_timeout(600)

        first = pg.locator('.rows .row').first
        assert first.count() > 0, '搜索没有结果，网络或令牌可能有问题'
        first.click()

        # 详情页 + 动态区块
        pg.wait_for_selector('.detail-title', timeout=20000)
        pg.wait_for_selector('.tl', timeout=30000)
        rows = pg.locator('.tl .tl-row')
        texts = [t.strip() for t in rows.all_inner_texts()]
        print(f'动态条数：{len(texts)}')
        for t in texts[:6]:
            print('  ·', t)

        assert len(texts) >= 1, '动态区块是空的，时间线没渲染出来'
        # 至少要有「加了标签」这类真实事件，而且时间列不是空的
        assert any('标签' in t or '关闭' in t or '指派' in t or '提到' in t for t in texts), texts
        assert any(t.split()[-1] for t in texts), '时间列是空的'

        pg.screenshot(path='/workspace/ghx/docs/screenshots/timeline.png')

        # ── PR 板块：对话区同样要有动态与评论 ──
        search_kind(pg, PR_QUERY, 'PR')
        pg.locator('.rows .row').first.click()
        pg.wait_for_selector('.detail-title', timeout=30000)
        pg.wait_for_timeout(6000)
        pr = pg.evaluate(
            """() => ({
              tl: document.querySelectorAll('.tl .tl-row').length,
              comments: document.querySelectorAll('.comment').length,
              form: !!document.querySelector('.comment-form textarea'),
            })"""
        )
        print(f'PR 对话区：{pr}')
        assert pr['form'], 'PR 对话区没有评论输入框'
        assert pr['tl'] + pr['comments'] >= 1, 'PR 对话区既没有动态也没有评论'
        pg.screenshot(path='/workspace/ghx/docs/screenshots/timeline-pr.png')

        real_errors = [e for e in errors if 'Failed to fetch' not in e]
        assert not real_errors, f'控制台有真错误：{real_errors[:3]}'
        print('[PASS] Issue 与 PR 的动态/评论都渲染了真实数据')
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
