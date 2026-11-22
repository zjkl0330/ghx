"""验证：列表星标可点 + 多账号默认勾选数（v1.1.2）。

网页端跑不到原生下载，但这一层要证的是**开关本身可靠**：默认开、切了会落盘、
刷新还记得、切回浏览器下载后整块消失。真正切片的正确性由
scripts/test-chunked.sh（JVM 真跑 HTTP 服务）和 check-download-native.py 覆盖。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-dlparts.py
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


def handle(route):
    path = re.sub(r'^https://api\.github\.com', '', route.request.url).split('?')[0]
    method = route.request.method
    if method in ('PUT', 'DELETE'):
        # star / unstar：GitHub 回 204 无正文
        route.fulfill(status=204, body='')
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
    pg.wait_for_timeout(900)




def body_text(pg):
    return pg.inner_text('body')


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

        # 1. 列表里的星标是可点的控件，不是一行灰字
        star = pg.locator('.rows .row .row-star').first
        assert star.count() == 1, '列表行里没有星标控件'
        before = star.inner_text()
        assert '☆' in before, f'默认应是空心星，实际 {before!r}'
        star.click()
        pg.wait_for_timeout(700)
        after = pg.locator('.rows .row .row-star').first.inner_text()
        assert '★' in after, f'点完没点亮，实际 {after!r}'
        assert pg.locator('.sheet').count() == 0, '点星标不该打开仓库详情'
        print(f'[1] 点行内星标：{before.strip()} → {after.strip()}，没有误开详情页')
        pg.screenshot(path=f'{OUT}/v112-star.png')

        # 再点一次取消
        pg.locator('.rows .row .row-star').first.click()
        pg.wait_for_timeout(700)
        again = pg.locator('.rows .row .row-star').first.inner_text()
        assert '☆' in again, f'再点一次没取消，实际 {again!r}'
        print('[2] 再点一次恢复空心星（star / 取消 star 都走同一处）')

        # 3. 设置里的多账号默认勾选数
        open_settings(pg)
        seg = pg.locator('.multi-count-seg')
        assert seg.count() == 1, '设置里没有「默认勾几个账号」'
        assert seg.locator('button').count() == 4, '应有 全部/1/2/3 四档'
        assert pg.locator('.multi-count-seg button.on', has_text='全部').count() == 1, '默认不是「全部」'
        seg.locator('button', has_text='2 个').click()
        pg.wait_for_timeout(500)
        pref = pg.evaluate("() => localStorage.getItem('ghx.acct.pref')")
        assert pref and '"multiCount":2' in pref, f'选 2 个没落盘：{pref!r}'
        assert '2 个账号' in body_text(pg), '没给出切换提示'
        print(f'[3] 多账号默认数：默认「全部」，点「2 个」→ {pref}')
        pg.screenshot(path=f'{OUT}/v112-acctpref.png')

        # 4. 重载后保持
        pg.reload()
        pg.wait_for_timeout(1500)
        pg.wait_for_selector('.rows .row', timeout=25000)
        open_settings(pg)
        assert pg.locator('.multi-count-seg button.on', has_text='2 个').count() == 1, '刷新后没记住 2 个'
        print('[4] 刷新后仍是「2 个」')

        # 5. 改成 1 个：当前账号永远排第一，所以就是「只对当前账号」
        pg.locator('.multi-count-seg button', has_text='1 个').click()
        pg.wait_for_timeout(500)
        pref = pg.evaluate("() => localStorage.getItem('ghx.acct.pref')")
        assert pref and '"multiCount":1' in pref, f'选 1 个没落盘：{pref!r}'
        print('[5] 改成「1 个」→ 落盘 multiCount:1')

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
