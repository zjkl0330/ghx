"""验证：设置里的「分片下载」开关。

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


def parts(store):
    return store.get('ghx.download.parts')


def on_button(pg, text):
    """某一档是不是高亮（.seg 里的 button.on）"""
    return pg.locator('.seg button.on', has_text=text).count() == 1


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        # 预置成「应用内下载」：分片开关只在这种模式下出现
        ctx.add_init_script(
            "try { localStorage.setItem('ghx.download.mode', 'inner'); } catch (e) {}"
        )
        pg = ctx.new_page()
        pg.route('**/api.github.com/**', handle)
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())

        pg.goto(BASE)
        pg.wait_for_timeout(600)
        login(pg)
        open_settings(pg)

        seg = pg.locator('.seg', has_text='4 路并行')
        assert seg.count() == 1, '设置里没找到「分片下载」开关'
        assert on_button(pg, '4 路并行'), '默认不是 4 路并行'
        assert not on_button(pg, '单线程'), '默认高亮了单线程'
        assert parts(pg.evaluate('() => Object.assign({}, localStorage)')) in (None, 'multi'), \
            '没点过就不该写存储'
        seg.first.scroll_into_view_if_needed()
        pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/dlparts-091-setting.png')
        print('[1] 设置里出现「分片下载」，默认高亮「4 路并行」，未点过不写存储')

        pg.locator('.seg', has_text='4 路并行').first.locator('button', has_text='单线程').click()
        pg.wait_for_timeout(500)
        store = pg.evaluate('() => Object.assign({}, localStorage)')
        assert parts(store) == 'single', f'切单线程后存储不对：{parts(store)!r}'
        assert on_button(pg, '单线程'), '切了单线程但没高亮'
        toast = pg.inner_text('body')
        assert '单线程' in toast, '没给出切换提示'
        print('[2] 点「单线程」→ 高亮切换、localStorage 写入 single')
        pg.screenshot(path=f'{OUT}/dlparts-091-single.png')

        # 刷新后应当记住
        pg.reload()
        pg.wait_for_timeout(1200)
        pg.wait_for_selector('.rows .row', timeout=25000)
        open_settings(pg)
        assert on_button(pg, '单线程'), '刷新后没记住单线程'
        print('[3] 刷新后仍是「单线程」')

        pg.locator('.seg', has_text='4 路并行').first.locator('button', has_text='4 路并行').click()
        pg.wait_for_timeout(500)
        store = pg.evaluate('() => Object.assign({}, localStorage)')
        assert parts(store) == 'multi', f'切回并行后存储不对：{parts(store)!r}'
        print('[4] 切回「4 路并行」→ localStorage 写回 multi')

        # 交给浏览器时这块不该出现（应用内才需要切片）
        pg.locator('.seg', has_text='应用内下载').first.locator('button', has_text='交给浏览器').click()
        pg.wait_for_timeout(500)
        assert pg.locator('.seg', has_text='4 路并行').count() == 0, '交给浏览器时还显示分片开关'
        print('[5] 改成「交给浏览器」后，分片开关整块消失')

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
