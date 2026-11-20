"""验证：设置里的「通知栏进度」说明。

通知本身是 Android 系统 UI，网页端测不到 —— 那一层由
scripts/test-chunked.sh 里的 NotifTest（文案真跑）与
check-download-native.py（权限、DETACH 顺序、取消 action）覆盖。

这一层要证的是**页面没被写坏**：
  · 应用内下载下才出现，交给浏览器时整块消失；
  · 说明文字不撑宽（390 宽不横向溢出）；
  · 网页里没有消息栏，所以不该出现「通知被关闭了，去开启」这个按钮。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-notify.py
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


MEASURE = """() => {
  const de = document.documentElement;
  const blocks = [...document.querySelectorAll('.tgl-label')].map((n) => n.textContent.trim());
  const btn = [...document.querySelectorAll('button')]
    .map((b) => b.textContent.trim())
    .filter((t) => t.includes('去开启'));
  return {
    width: de.scrollWidth,
    client: de.clientWidth,
    labels: blocks,
    notifyButtons: btn,
    body: document.body.innerText,
  };
}"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
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

        m = pg.evaluate(MEASURE)
        assert '通知栏进度' in m['labels'], f'设置里没有「通知栏进度」：{m["labels"]}'
        assert '下载时在消息栏实时显示' in m['body'], '没写清楚通知栏会显示什么'
        assert '剩余时间' in m['body'], '说明里没提剩余时间'
        assert m['width'] <= m['client'] + 1, f'页面被撑宽：{m["width"]} > {m["client"]}'

        # 网页端没有消息栏，绝不能劝用户「去开启」
        assert not m['notifyButtons'], f'网页里出现了去开启按钮：{m["notifyButtons"]}'
        print(f'[1] 「通知栏进度」区块在，说明完整，页面宽 {m["width"]}/{m["client"]} 未溢出')
        print('[2] 网页端没有消息栏，所以不出现「去开启」按钮（原生侧才判断）')

        el = pg.locator('.tgl-label', has_text='通知栏进度').first
        el.scroll_into_view_if_needed()
        pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/notify-092-setting.png')

        # 交给浏览器时整块消失
        pg.locator('.seg', has_text='应用内下载').first.locator('button', has_text='交给浏览器').click()
        pg.wait_for_timeout(500)
        m2 = pg.evaluate(MEASURE)
        assert '通知栏进度' not in m2['labels'], '交给浏览器时还显示通知栏进度'
        assert '分片下载' not in m2['labels'], '交给浏览器时还显示分片下载'
        print('[3] 改成「交给浏览器」后，通知栏进度整块消失')

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
