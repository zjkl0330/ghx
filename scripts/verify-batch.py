"""验证「仓库徽标只发一次批量请求」。

依赖：`npx vite preview --port 4173`，playwright，xvfb。
    xvfb-run -a python3 scripts/verify-batch.py

两轮：
A. GraphQL 正常 —— 24 个仓库必须只打 1 次 /graphql、0 次 /releases；
B. GraphQL 回 500 —— 必须回落到逐条 /releases，徽标仍然出现（降级不能变成没有）。

计数口径是拦到的真实请求数（`route.request.url`），不是代码里推断出来的。
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OUT = '/workspace/ghx/docs/screenshots'
OWNER = 'zjkl0330'

REPOS = [
    {
        'id': i,
        'name': f'repo-{i:02d}',
        'full_name': f'{OWNER}/repo-{i:02d}',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': False,
        'visibility': 'public',
        'archived': False,
        'disabled': False,
        'description': '一行足够长的简介，用来看列表排版。' * 2,
        'language': 'TypeScript',
        'stargazers_count': 1200 - i * 7,
        'forks_count': 30 + i,
        'open_issues_count': i % 5,
        'pushed_at': '2026-11-18T10:00:00Z',
        'updated_at': '2026-11-18T10:00:00Z',
        'created_at': '2025-06-01T08:00:00Z',
        'default_branch': 'main',
        'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
    }
    for i in range(1, 25)
]

USER = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
    'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
    'public_repos': 24, 'public_gists': 0, 'followers': 128, 'following': 12,
    'bio': None, 'company': None, 'location': None, 'blog': None,
    'created_at': '2025-03-01T08:00:00Z',
}


def asset_names(repo_name):
    """前三个仓库有 APK，四五两个有 EXE，其余只有源码包。"""
    n = int(repo_name.split('-')[1])
    if n <= 3:
        return [f'{repo_name}-v1.apk']
    if n <= 5:
        return [f'{repo_name}-setup.exe']
    return [f'{repo_name}-v1-src.tar.gz']


def releases_of(repo_name):
    return [{'draft': False, 'assets': asset_names(repo_name)}]


COUNTER = {'graphql': 0, 'releases': 0}


def common_headers():
    return {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': (
            'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-oauth-scopes, link'
        ),
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '4900',
        'x-ratelimit-reset': '1793800000',
        'x-oauth-scopes': 'repo, read:user, workflow, notifications',
    }


def fullfill(route, body, status=200):
    route.fulfill(
        status=status,
        content_type='application/json',
        headers=common_headers(),
        body=json.dumps(body),
    )


def make_handler(gql_ok):
    def handle(route):
        url = route.request.url
        path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]

        if path == '/graphql':
            COUNTER['graphql'] += 1
            if not gql_ok:
                fullfill(route, {'message': 'boom'}, 500)
                return
            raw = route.request.post_data or '{}'
            query = (json.loads(raw) or {}).get('query', '')
            # 别名顺序就是 query 里 name 出现的顺序，回填时按同一顺序编号
            names = re.findall(r'name: "([^"]+)"', query)
            data = {}
            for i, name in enumerate(names):
                data[f'r{i}'] = {
                    'releases': {
                        'nodes': [
                            {
                                'isDraft': r['draft'],
                                'releaseAssets': {'nodes': [{'name': a} for a in r['assets']]},
                            }
                            for r in releases_of(name)
                        ]
                    }
                }
            fullfill(route, {'data': data, 'errors': []})
            return

        m = re.match(r'^/repos/[^/]+/([^/]+)/releases$', path)
        if m:
            COUNTER['releases'] += 1
            n = int(m.group(1).split('-')[1])
            fullfill(route, [{
                'id': 1000 + n, 'tag_name': 'v1.0.0', 'name': 'v1.0.0', 'body': '自测用',
                'draft': False, 'prerelease': False,
                'created_at': '2026-11-01T00:00:00Z', 'published_at': '2026-11-01T00:00:00Z',
                'html_url': f'https://github.com/{OWNER}/{m.group(1)}/releases/tag/v1.0.0',
                'assets': [
                    {'id': 1, 'name': a, 'size': 4_392_600, 'download_count': 3,
                     'browser_download_url': f'https://github.com/{OWNER}/{m.group(1)}/releases/download/v1/{a}'}
                    for a in asset_names(m.group(1))
                ],
            }])
            return

        if path == '/user':
            fullfill(route, USER)
        elif path == '/user/repos':
            fullfill(route, REPOS)
        elif path == '/notifications':
            fullfill(route, [])
        elif path == '/rate_limit':
            fullfill(route, {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}})
        else:
            fullfill(route, {})

    return handle


def run(pg, gql_ok, shot):
    COUNTER['graphql'] = 0
    COUNTER['releases'] = 0
    pg.mouse.wheel(0, 0)
    pg.goto(BASE)
    pg.wait_for_timeout(800)
    pg.click('.who-btn')
    pg.wait_for_timeout(300)
    pg.click('text=添加账号')
    pg.wait_for_timeout(400)
    pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
    pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
    pg.click('text=加密保存')
    pg.wait_for_timeout(3200)
    pg.wait_for_selector('.rows .row', timeout=20000)

    if gql_ok:
        pg.wait_for_selector('.badge.pkg', timeout=30000)
    else:
        pg.wait_for_selector('.badge.pkg', timeout=40000)
    pg.wait_for_timeout(2500)

    n_apk = pg.locator('.row:has(.badge.pkg.apk)').count()
    n_exe = pg.locator('.row:has(.badge.pkg.exe)').count()
    g, r = COUNTER['graphql'], COUNTER['releases']
    print(f'{shot}: APK {n_apk} 行 / EXE {n_exe} 行 · /graphql {g} 次 · /releases {r} 次')
    pg.screenshot(path=f'{OUT}/{shot}.png')
    return n_apk, n_exe, g, r


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )

        # A：批量生效
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.route('**/api.github.com/**', make_handler(True))
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
        n_apk, n_exe, g, r = run(pg, True, 'badge-batch-084')
        assert (n_apk, n_exe) == (3, 2), f'徽标数量不对：APK {n_apk} / EXE {n_exe}'
        assert g == 1, f'24 个仓库应该只发 1 次 /graphql，实际 {g}'
        assert r == 0, f'批量成功时不该再逐条查 /releases，实际 {r}'
        ctx.close()

        # B：GraphQL 挂了必须回落，徽标不能跟着没了
        ctx2 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg2 = ctx2.new_page()
        pg2.route('**/api.github.com/**', make_handler(False))
        pg2.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
        n_apk2, n_exe2, g2, r2 = run(pg2, False, 'badge-fallback-084')
        assert (n_apk2, n_exe2) == (3, 2), f'回落后徽标丢了：APK {n_apk2} / EXE {n_exe2}'
        assert g2 == 1, f'降级只该试一次批量，实际 {g2}'
        assert r2 >= 20, f'回落后应逐条查（24 次上下），实际 {r2}'
        ctx2.close()

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
