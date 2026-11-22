"""验证：包里不带任何加速站，要加速必须自己填。

v1.1.3 的要求是「以后的包不准有加速站地址」——自建站被滥用之后，预置表
等于替那台服务器给所有人做分发。这里从空存储启动，逐条验证：

1. 下载面板只有 1 行：官方直连，没有任何第三方域名；
2. 设置 → 加速站面板同样是空表，副标题写明「不再预置」；
3. 添加一个自己的站之后，面板立刻多一行；
4. 回下载面板：自己填的站排第一，官方仍在最后。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-nomirror.py
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OUT = '/workspace/ghx/docs/screenshots'
OWNER = 'zjkl0330'
MINE = 'https://mine.example.com'

REPOS = [
    {
        'id': 1,
        'name': 'ghx',
        'full_name': f'{OWNER}/ghx',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': False,
        'visibility': 'public',
        'archived': False,
        'disabled': False,
        'description': '一个 GitHub 客户端',
        'language': 'TypeScript',
        'stargazers_count': 12,
        'forks_count': 1,
        'open_issues_count': 0,
        'pushed_at': '2026-11-18T10:00:00Z',
        'updated_at': '2026-11-18T10:00:00Z',
        'created_at': '2025-06-01T08:00:00Z',
        'default_branch': 'main',
        'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
    }
]

USER = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
    'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
    'public_repos': 1, 'public_gists': 0, 'followers': 128, 'following': 12,
    'bio': None, 'company': None, 'location': None, 'blog': None,
    'created_at': '2025-03-01T08:00:00Z',
}

RELEASE = [{
    'id': 1001,
    'tag_name': 'v1.1.3',
    'name': 'v1.1.3',
    'body': '自测用发行版',
    'draft': False,
    'prerelease': False,
    'created_at': '2026-11-22T00:00:00Z',
    'published_at': '2026-11-22T00:00:00Z',
    'html_url': f'https://github.com/{OWNER}/ghx/releases/tag/v1.1.3',
    'assets': [{
        'id': 11,
        'name': 'ghx-1.1.3-debug.apk',
        'size': 21_288_154,
        'download_count': 0,
        'browser_download_url': f'https://github.com/{OWNER}/ghx/releases/download/v1.1.3/ghx-1.1.3-debug.apk',
    }],
}]


def handle(route):
    path = re.sub(r'^https://api\.github\.com', '', route.request.url).split('?')[0]
    if re.match(r'^/repos/[^/]+/[^/]+/releases$', path):
        body = RELEASE
    elif path == '/user':
        body = USER
    elif path in ('/user/repos', '/user/starred'):
        body = REPOS
    elif path == '/notifications':
        body = []
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}}
    elif path.startswith('/repos/'):
        body = REPOS[0] if '/contents' not in path else []
    elif path.startswith('/users/'):
        body = USER if len(path.strip('/').split('/')) == 2 else []
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


def fake_asset(route):
    route.fulfill(
        status=206,
        headers={
            'access-control-allow-origin': '*',
            'content-length': str(1024),
            'content-type': 'application/octet-stream',
        },
        body=b'\0' * 1024,
    )


ROUTES = """() => {
  const rows = [...document.querySelectorAll('.multi-row')];
  return {
    count: rows.length,
    labels: rows.map((r) => r.querySelector('.multi-main b')?.textContent?.trim() || ''),
    details: rows.map((r) => r.querySelector('.multi-main i')?.textContent?.trim() || ''),
  };
}"""

STATIONS = """() => {
  const rows = [...document.querySelectorAll('.mrow')];
  return {
    count: rows.length,
    labels: rows.map((r) => r.querySelector('.mrow-main b')?.textContent?.trim() || ''),
    details: rows.map((r) => r.querySelector('.mrow-main i')?.textContent?.trim() || ''),
    sub: document.querySelector('.sheet-sub')?.textContent?.trim() || '',
  };
}"""


def close_sheets(pg):
    """一层层点遮罩边缘关掉弹层：Escape 在焦点落进输入框时不一定生效。"""
    for _ in range(6):
        mask = pg.locator('.mask')
        if mask.count() == 0:
            return
        try:
            mask.last.click(position={'x': 8, 'y': 8}, timeout=3000)
        except Exception:
            pg.keyboard.press('Escape')
        pg.wait_for_timeout(450)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        # 关键：不写 ghx.mirror.store —— 这就是「刚装完、什么都没配」的状态
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.route('**/api.github.com/**', handle)
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
        pg.route('**/mine.example.com/**', fake_asset)

        pg.goto(BASE)
        pg.wait_for_timeout(700)
        pg.click('.who-btn')
        pg.wait_for_timeout(300)
        pg.click('text=添加账号')
        pg.wait_for_timeout(400)
        pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
        pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
        pg.click('text=加密保存')
        pg.wait_for_timeout(3200)
        pg.wait_for_selector('.rows .row', timeout=25000)

        pg.locator('.row', has_text='ghx').first.click()
        pg.wait_for_timeout(1200)
        pg.click('text=发行版')
        pg.wait_for_timeout(1200)
        pg.click('.rel-asset button')
        pg.wait_for_selector('.multi-row', timeout=20000)
        pg.wait_for_timeout(600)

        rows = pg.evaluate(ROUTES)
        print(f'[1] 新装下载面板 {rows["count"]} 行：{rows["labels"]}')
        assert rows['count'] == 1, f'新装应只剩官方一条，实际 {rows["count"]} 条：{rows["labels"]}'
        assert '官方' in rows['labels'][0], f'唯一一行不是官方直连：{rows["labels"][0]!r}'
        assert not any('gh-' in d or 'dpdns' in d for d in rows['details']), (
            f'候选里出现了第三方地址：{rows["details"]}'
        )
        pg.screenshot(path=f'{OUT}/nomirror-113-empty.png')

        # 设置 → 加速站（把下载面板与发行版面板都关掉，否则 mask 会挡住头像）
        close_sheets(pg)
        pg.click('.avatar-btn')
        pg.wait_for_timeout(600)
        pg.click('text=设置')
        pg.wait_for_timeout(900)
        pg.click('.linkrow:has-text("官方直连")')
        pg.wait_for_timeout(800)

        st = pg.evaluate(STATIONS)
        print(f'[2] 加速站面板 {st["count"]} 行：{st["labels"]}')
        assert st['count'] == 1, f'默认不该有第三方站点，实际 {st["count"]} 行：{st["labels"]}'
        assert '不再预置' in st['sub'], f'副标题没说明不再预置：{st["sub"][:60]!r}'

        # 添加自己的站
        pg.click('text=添加自己的站点')
        pg.wait_for_timeout(400)
        pg.fill('#nm-base', MINE)
        pg.fill('#nm-label', '我的加速')
        pg.click('.medit-btns .btn.primary')
        pg.wait_for_timeout(600)

        st2 = pg.evaluate(STATIONS)
        print(f'[3] 添加后 {st2["count"]} 行：{st2["labels"]}')
        assert st2['count'] == 2, f'添加后应为 2 行，实际 {st2["count"]} 行：{st2["labels"]}'
        assert '我的加速' in st2['labels'], f'自定义站没出现在表里：{st2["labels"]}'
        pg.screenshot(path=f'{OUT}/nomirror-113-added.png')

        # 回下载面板：自己填的站排第一，官方仍在最后
        # 关掉所有弹层后重新进一次（顺便验证自定义站已经落盘、重开还在）
        close_sheets(pg)
        pg.goto(BASE)
        pg.wait_for_timeout(1400)
        pg.locator('.row', has_text='ghx').first.click()
        pg.wait_for_timeout(1200)
        pg.click('text=发行版')
        pg.wait_for_timeout(1200)
        pg.click('.rel-asset button')
        pg.wait_for_selector('.multi-row', timeout=20000)
        pg.wait_for_timeout(800)
        rows2 = pg.evaluate(ROUTES)
        print(f'[4] 回下载面板 {rows2["count"]} 行：{rows2["labels"]}')
        assert rows2['count'] == 2, f'应为自定义 + 官方 2 行，实际 {rows2["count"]} 条'
        assert '我的加速' in rows2['labels'][0], f'自己填的站没排第一：{rows2["labels"]}'
        assert '官方' in rows2['labels'][-1], f'官方不在最后：{rows2["labels"]}'

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
