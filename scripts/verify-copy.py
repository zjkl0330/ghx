"""验证「复制仓库地址」在三种 WebView 环境下的表现。

背景：华为 EMUI 的 WebView 把 `navigator.clipboard` 整个裁掉，
老代码直接调 `.writeText` 会抛 `Cannot read properties of undefined`，
那串英文被弹层的 errline 接到、染红显示 —— 用户看到的就是「一串红字」。

断言口径：
1. 正常内核：点复制 → toast 说已复制、剪贴板内容精确、没有 errline；
2. 模拟华为（navigator.clipboard = undefined）：仍复制成功（走 execCommand），
   剪贴板内容正确、**没有 errline**；
3. 三条通道全挂（clipboard 无 + execCommand 返回 false）：出现可长按的地址兜底，
   toast 是中文，仍然**没有 errline 红字**。

依赖：`npx vite preview --port 4173`，playwright，xvfb。
    xvfb-run -a python3 scripts/verify-copy.py
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OWNER = 'zjkl0330'
OUT = '/workspace/ghx/docs/screenshots'
URL = f'https://github.com/{OWNER}/clist-cf'

REPO = {
    'id': 1,
    'name': 'clist-cf',
    'full_name': f'{OWNER}/clist-cf',
    'owner': {'login': OWNER, 'avatar_url': ''},
    'private': False,
    'visibility': 'public',
    'archived': False,
    'disabled': False,
    'description': '用 Cloudflare Workers 跑的文件索引。',
    'language': 'TypeScript',
    'stargazers_count': 46,
    'forks_count': 3,
    'open_issues_count': 2,
    'pushed_at': '2026-11-03T14:40:00Z',
    'updated_at': '2026-11-03T14:40:00Z',
    'created_at': '2026-01-12T08:00:00Z',
    'default_branch': 'main',
    'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
}

USER = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
    'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
    'public_repos': 10, 'public_gists': 0, 'followers': 128, 'following': 12,
    'bio': None, 'company': None, 'location': None, 'blog': None,
    'created_at': '2025-03-01T08:00:00Z',
}


def handle(route):
    url = route.request.url
    path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]
    if path == '/user':
        body = USER
    elif path == '/user/repos':
        body = [REPO]
    elif path == '/notifications':
        body = []
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}}
    elif path.startswith('/users/'):
        segs = path.strip('/').split('/')
        body = USER if len(segs) == 2 else []
    elif path == f'/repos/{OWNER}/clist-cf':
        body = {k: v for k, v in REPO.items()}
    else:
        body = {}

    route.fulfill(
        status=200,
        content_type='application/json',
        headers={
            'access-control-allow-origin': '*',
            'access-control-expose-headers': (
                'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-oauth-scopes, link'
            ),
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4900',
            'x-ratelimit-reset': '1793800000',
            'x-oauth-scopes': 'repo, read:user, workflow, notifications',
        },
        body=json.dumps(body),
    )


def toast_text(pg):
    n = pg.locator('.toast').count()
    return '' if n == 0 else ' '.join(pg.locator('.toast').all_inner_texts()).strip()


def open_detail(pg):
    pg.locator('.rows .row').first.click(position={'x': 140, 'y': 30})
    pg.wait_for_selector('.sheet .actrow', timeout=8000)


def click_copy(pg):
    pg.locator('.actrow:has-text("复制仓库地址")').first.click()
    pg.wait_for_timeout(600)


def errline_text(pg):
    return ' '.join(pg.locator('.sheet .errline').all_inner_texts()).strip()


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
        pg = ctx.new_page()
        pg.route('**/api.github.com/**', handle)
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())

        pg.goto(BASE)
        pg.wait_for_timeout(700)

        # 导入令牌，进主界面
        pg.click('.who-btn')
        pg.wait_for_timeout(300)
        pg.click('text=添加账号')
        pg.wait_for_timeout(400)
        pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
        pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
        pg.click('text=加密保存')
        pg.wait_for_timeout(3500)
        pg.wait_for_selector('.rows .row', timeout=20000)

        # ── 1. 正常内核 ──
        open_detail(pg)
        pg.evaluate('navigator.clipboard.writeText("__清空__")')
        click_copy(pg)
        t1 = toast_text(pg)
        got1 = pg.evaluate('navigator.clipboard.readText()')
        e1 = errline_text(pg)
        assert got1 == URL, f'剪贴板内容不对：{got1!r}'
        assert '已复制' in t1, f'提示语不对：{t1!r}'
        assert e1 == '', f'正常路径出现了红字：{e1!r}'
        assert pg.locator('.sheet .url-fallback').count() == 0, '正常路径不该出现兜底块'
        pg.screenshot(path=f'{OUT}/copy-085-normal.png')
        print(f'[1] 正常内核：剪贴板 = {got1} · 提示「{t1}」· 红字 0 行')

        # ── 2. 模拟华为：navigator.clipboard 整个不存在 ──
        # 先把 readText 抓出来，后面的断言还要用它读
        pg.evaluate(
            'window.__read = navigator.clipboard.readText.bind(navigator.clipboard);'
            'Object.defineProperty(navigator, "clipboard", {value: undefined, configurable: true});'
        )
        probe = pg.evaluate('String(typeof navigator.clipboard)')
        assert probe == 'undefined', f'模拟没生效：{probe}'
        pg.evaluate('window.__read().then(t => (window.__before = t))')
        pg.wait_for_timeout(200)
        click_copy(pg)
        pg.wait_for_timeout(400)
        t2 = toast_text(pg)
        got2 = pg.evaluate('window.__read()')
        e2 = errline_text(pg)
        assert got2 == URL, f'华为场景没复制出来：{got2!r}'
        assert '已复制' in t2, f'华为场景提示不对：{t2!r}'
        assert e2 == '', f'华为场景仍出现红字：{e2!r}'
        pg.screenshot(path=f'{OUT}/copy-085-no-async-api.png')
        print(f'[2] 模拟华为（clipboard=undefined）：剪贴板 = {got2} · 红字 0 行')

        # ── 3. 三条全挂：连 execCommand 也不给 ──
        pg.evaluate('document.execCommand = () => false')
        click_copy(pg)
        pg.wait_for_timeout(500)
        t3 = toast_text(pg)
        e3 = errline_text(pg)
        fb = pg.locator('.sheet .url-fallback').count()
        fb_text = '' if fb == 0 else pg.locator('.sheet .url-fallback').first.inner_text()
        assert e3 == '', f'全挂时又冒红字：{e3!r}'
        assert fb == 1, f'全挂时没出现长按兜底：{fb}'
        assert URL in fb_text, f'兜底块里没有地址：{fb_text!r}'
        assert '复制失败' in t3, f'全挂时提示不对：{t3!r}'
        # 红字必须是中文可操作提示，不是英文报错
        assert 'Cannot read' not in e3 and 'undefined' not in e3, f'仍泄露英文报错：{e3!r}'
        pg.screenshot(path=f'{OUT}/copy-085-all-failed.png')
        print(f'[3] 三条全挂：出现兜底块「{fb_text.replace(chr(10), " ")}」· 提示「{t3}」· 红字 0 行')

        # ── 4. 根因复现：在同一环境里跑改之前的写法，看它抛什么 ──
        # 现在 navigator.clipboard 仍是 undefined，正好是华为上的样子
        old = pg.evaluate(
            'async () => { try { await navigator.clipboard.writeText("x"); return "（没抛错）" }'
            ' catch (e) { return e.message } }'
        )
        assert 'Cannot read' in old, f'旧写法的报错没复现出来：{old!r}'
        print(f'[4] 旧写法（直连 navigator.clipboard）在同一环境下的报错：{old}')

        b.close()
    print('全部通过')


if __name__ == '__main__':
    main()
