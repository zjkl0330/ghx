"""验证：更新通道（正式版 / 测试版 / 关掉）。

口径（都对 DOM 与请求计数做断言，不看截图目测）：
1. 正式通道（无 prerelease）比当前版本新 → 列表顶部出现「新版本 v9.9.9 可用」，
   点「查看」能看到「发现新版本」并带安装包；
2. 设置里切到「关掉」→ 横幅立刻消失，刷新后启动不再请求任何 release 接口；
3. 手动检查时，接口返回的 prerelease 或 404（还没正式版）都只显示
   「已是最新版本」，不出现错误红字、也不出现更新横幅；
4. 切到「测试版」→ 改读 /releases 列表，预发布 v9.9.9-beta.2 会被提示，
   面板与设置都标「测试版」。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-update.py
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OUT = '/workspace/ghx/docs/screenshots'
OWNER = 'zjkl0330'

STATE = {'latest': 0, 'list': 0, 'mode': 'formal'}

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


def release_body(prerelease: bool, tag: str = 'v9.9.9') -> dict:
    return {
        'id': 9001,
        'tag_name': tag,
        'name': f'ghx {tag.lstrip("v")}',
        'body': '正式版发版说明：修了一堆小问题。',
        'published_at': '2026-11-19T10:00:00Z',
        'draft': False,
        'prerelease': prerelease,
        'assets': [{
            'name': 'ghx-9.9.9-debug.apk',
            'size': 21_000_000,
            'browser_download_url': f'https://github.com/{OWNER}/ghx/releases/download/v9.9.9/ghx-9.9.9-debug.apk',
        }],
    }


def handle(route):
    path = re.sub(r'^https://api\.github\.com', '', route.request.url).split('?')[0]

    if path.endswith('/releases'):
        # 测试通道：稳定版 9.9.8 + 预发布 9.9.9-beta.2，按版本应选后者
        STATE['list'] += 1
        route.fulfill(
            status=200,
            content_type='application/json',
            headers={'access-control-allow-origin': '*'},
            json=[release_body(False, 'v9.9.8'), release_body(True, 'v9.9.9-beta.2')],
        )
        return

    if path.endswith('/releases/latest'):
        STATE['latest'] += 1
        if STATE['mode'] == 'none':
            route.fulfill(status=404, content_type='application/json', json={'message': 'Not Found'})
            return
        route.fulfill(
            status=200,
            content_type='application/json',
            headers={'access-control-allow-origin': '*'},
            json=release_body(STATE['mode'] == 'pre'),
        )
        return

    if path == '/user':
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


def login(pg):
    pg.click('.who-btn')
    pg.wait_for_timeout(300)
    pg.click('text=添加账号')
    pg.wait_for_timeout(400)
    pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
    pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
    pg.click('text=加密保存')
    pg.wait_for_timeout(3000)
    pg.wait_for_selector('.rows .row', timeout=25000)


def open_settings(pg):
    pg.click('.avatar-btn')
    pg.wait_for_timeout(600)
    pg.click('text=设置')
    pg.wait_for_timeout(800)


def back_to_list(pg):
    for _ in range(6):
        if pg.locator('.rows .row').count() > 0 and pg.locator('.avatar-btn').count() > 0:
            return
        pg.click('button[aria-label="返回"]')
        pg.wait_for_timeout(500)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.route('**/api.github.com/**', handle)
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())

        pg.goto(BASE)
        pg.wait_for_timeout(600)
        login(pg)

        # ── 1. 正式版 → 顶部提示 ──
        pg.wait_for_selector('.updatebar', timeout=20000)
        bar = pg.inner_text('.updatebar').replace('\n', ' ')
        assert 'v9.9.9' in bar, f'横幅文案不对：{bar!r}'
        assert STATE['latest'] == 1, f'启动应只查一次，实际 {STATE["latest"]} 次'
        print(f'[1] 正式版提示：{bar}（启动静默查询 {STATE["latest"]} 次）')
        pg.screenshot(path=f'{OUT}/update-090-bar.png')

        pg.click('.updatebar button')
        pg.wait_for_timeout(1200)
        sheet = pg.inner_text('.sheet')
        assert '发现新版本' in sheet and '9.9.9' in sheet, f'更新面板不对：{sheet[:80]!r}'
        assert '下载并安装' in sheet or '用浏览器下载' in sheet, '面板没给下载按钮'
        print('[2] 点「查看」→ 面板显示「发现新版本 v9.9.9」且有安装包')
        pg.screenshot(path=f'{OUT}/update-090-sheet.png')
        pg.click('.mask')
        pg.wait_for_timeout(500)

        # ── 2. 设置里关掉 → 横幅消失、刷新后不再查 ──
        open_settings(pg)
        seg = pg.locator('.seg', has_text='测试版')
        assert seg.count() >= 1, '设置里没找到「更新通道」三档开关'
        seg.first.scroll_into_view_if_needed()
        pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/update-090-setting.png')
        seg.first.locator('button', has_text='关掉').click()
        pg.wait_for_timeout(500)
        back_to_list(pg)
        assert pg.locator('.updatebar').count() == 0, '关掉开关后横幅还在'
        print(f'[3] 关掉「更新提示」→ 横幅消失（此时请求数 {STATE["latest"]}）')

        before = STATE['latest']
        pg.reload()
        pg.wait_for_timeout(1200)
        pg.wait_for_selector('.rows .row', timeout=25000)
        pg.wait_for_timeout(1800)
        assert STATE['latest'] == before, f'关掉后刷新仍在查更新：{before} → {STATE["latest"]}'
        assert pg.locator('.updatebar').count() == 0, '刷新后横幅又冒出来了'
        print(f'[4] 刷新后不再请求 /releases/latest（仍为 {STATE["latest"]} 次），无横幅')

        # ── 3. 手动检查：预发布 / 没有正式版 都不报错、不提示 ──
        open_settings(pg)
        STATE['mode'] = 'pre'
        pg.click('button:has-text("检查更新")')
        pg.wait_for_timeout(1500)
        body = pg.inner_text('.sheet')
        assert '已是最新版本' in body, f'预发布却提示了更新：{body[:80]!r}'
        assert 'errline' not in pg.locator('.sheet').inner_html(), '预发布被当成错误弹出来了'
        print('[5] 接口给 prerelease：显示「已是最新版本」，无错误无横幅')
        pg.screenshot(path=f'{OUT}/update-090-prerelease.png')
        pg.click('.mask')
        pg.wait_for_timeout(400)

        STATE['mode'] = 'none'
        pg.click('button:has-text("检查更新")')
        pg.wait_for_timeout(1500)
        body = pg.inner_text('.sheet')
        assert '已是最新版本' in body, f'404 却被当成错误：{body[:80]!r}'
        assert 'errline' not in pg.locator('.sheet').inner_html(), '404 被当成错误弹出来了'
        print('[6] 接口 404（只有预览版）：同样显示「已是最新版本」，不报错')
        pg.click('.mask')
        pg.wait_for_timeout(300)

        # ── 4. 切到测试版：读列表接口，预发布也提示 ──
        seg = pg.locator('.seg', has_text='测试版').first
        seg.scroll_into_view_if_needed()
        seg.locator('button', has_text='测试版').click()
        pg.wait_for_timeout(1800)
        assert STATE['list'] >= 1, '切到测试版后没有请求 /releases 列表'
        back_to_list(pg)
        pg.wait_for_selector('.updatebar', timeout=15000)
        bar = pg.inner_text('.updatebar').replace('\n', ' ')
        assert '9.9.9' in bar, f'测试版横幅没出现 v9.9.9：{bar!r}'
        print(f'[7] 切到测试版：{bar}（列表接口 {STATE["list"]} 次）')

        pg.click('.updatebar button')
        pg.wait_for_timeout(1200)
        sheet = pg.inner_text('.sheet')
        assert '发现新版本 v9.9.9' in sheet, f'测试版面板标题不对：{sheet[:60]!r}'
        assert '测试版' in sheet, '面板没标出这是测试版'
        assert '切回正式版' in sheet, '测试版面板缺少回正式版的说明'
        print('[8] 测试版面板标注「测试版」并说明怎么回正式版')
        pg.screenshot(path=f'{OUT}/update-110-beta.png')
        pg.click('.mask')
        pg.wait_for_timeout(300)

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
