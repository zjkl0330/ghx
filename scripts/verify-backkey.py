"""验证：返回键区分软键盘（v0.9.8）。

用户反馈：部分地方返回键点一下就能退上一级，我们这里到处都得点两下。
根因：applyBack 见到输入框有焦点就只 blur —— 而键盘收起后焦点经常残留，
于是每次返回都被白白吃掉一下。修复：视口高度差确认键盘真的开着才只收键盘，
焦点残留时收焦点 + 继续返回，一下就是一层。要证：

  · 商店弹层：点进搜索框（焦点落在 input）后按返回，弹层一下就收 ——
    不再被焦点残留吞掉第一次；
  · 模拟软键盘真开着（visualViewport 被压矮）：第一下只收键盘，弹层还在；
    第二下才收弹层；
  · 仓库详情（路由栈）一下退回热门页，原有单按语义无损；
  · 根层（热门页）按返回走退出确认，不误杀页面；
  · console 无返回链路相关报错。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-backkey.py
"""
import json
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OUT = '/workspace/ghx/docs/screenshots'
OWNER = 'zjkl0330'
FEED_URL = re.compile(r'.*komi-store-backend-data.*cached-data/feed/android\.json')


def app(i, full, name):
    owner = full.split('/')[0]
    return {
        'id': 100 + i, 'name': name, 'fullName': full,
        'owner': {'login': owner, 'avatarUrl': ''},
        'description': f'{name} 的简介',
        'defaultBranch': 'main',
        'stargazersCount': 1000 * (i + 1), 'forksCount': 100,
        'openIssuesCount': 5, 'licenseSpdxId': 'MIT', 'language': 'TypeScript',
        'topics': [], 'pushedAt': '2026-11-20 14:36:03+00',
        'latestReleaseTag': f'v1.{i}.0',
        'latestReleaseDate': '2026-11-18 10:00:00+00',
        'downloadCount': 999, 'hasInstallersAndroid': True,
        'platformReleases': {'android': {'tag': f'v1.{i}.0', 'publishedAt': '2026-11-18T10:00:00Z'}},
    }


APPS = [
    app(0, 'localsend/localsend', 'localsend'),
    app(1, 'immich-app/immich', 'immich'),
    app(2, 'topjohnwu/Magisk', 'Magisk'),
    app(3, 'TeamNewPipe/NewPipe', 'NewPipe'),
]
FEED_BODY = json.dumps({'category': 'feed', 'platform': 'android', 'rotation': '2026-11-20', 'repositories': APPS})

REPO = {
    'id': 1, 'name': 'ghx', 'full_name': f'{OWNER}/ghx',
    'owner': {'login': OWNER, 'avatar_url': ''},
    'private': False, 'visibility': 'public', 'archived': False, 'disabled': False,
    'description': '一个 GitHub 客户端', 'language': 'TypeScript',
    'stargazers_count': 42, 'forks_count': 3,
    'pushed_at': '2026-11-18T10:00:00Z', 'updated_at': '2026-11-18T10:00:00Z',
    'created_at': '2025-06-01T08:00:00Z', 'default_branch': 'main',
    'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
}
USER = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
    'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
    'public_repos': 1, 'public_gists': 0, 'followers': 128, 'following': 12,
    'bio': None, 'company': None, 'location': None, 'blog': None,
    'created_at': '2025-03-01T08:00:00Z',
}
# 商店点进来的 localsend 详情（详情页按路径精确返回）
LOCALSEND = {
    'id': 2, 'name': 'localsend', 'full_name': 'localsend/localsend',
    'owner': {'login': 'localsend', 'avatar_url': ''},
    'private': False, 'visibility': 'public', 'archived': False, 'disabled': False,
    'description': '跨设备互传', 'language': 'Dart',
    'stargazers_count': 1000, 'forks_count': 100,
    'pushed_at': '2026-11-18T10:00:00Z', 'updated_at': '2026-11-18T10:00:00Z',
    'created_at': '2025-06-01T08:00:00Z', 'default_branch': 'main',
    'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
}


def handle(route):
    url = route.request.url
    if FEED_URL.search(url):
        route.fulfill(status=200, content_type='application/json', body=FEED_BODY)
        return
    path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]
    if path == '/user':
        body = USER
    elif path in ('/user/repos', '/user/starred'):
        body = [REPO]
    elif path.startswith('/repos/localsend/'):
        body = LOCALSEND
    elif path == '/notifications':
        body = []
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}}
    elif path.startswith('/repos/'):
        body = REPO
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


def state(pg):
    return pg.evaluate("""() => ({
      sheetOpen: !!document.querySelector('.sheet'),
      active: (document.activeElement || {}).tagName || '',
      entry: !!document.querySelector('button[aria-label="APK 商店"]'),
      hotVisible: !!document.querySelector('.tabbar'),
      detail: document.body.innerText.includes('ghx'),
      title: (document.querySelector('.sheet-head h3') || {}).textContent || '',
    })""")


def fake_keyboard(pg, height):
    """把 visualViewport 压矮到 height，模拟软键盘真的开着"""
    pg.evaluate(f"""() => {{
      const vv = window.visualViewport;
      const shim = Object.create(vv || null);
      Object.defineProperty(shim, 'height', {{ value: {height}, configurable: true }});
      Object.defineProperty(window, 'visualViewport', {{ value: shim, configurable: true }});
    }}""")


def unfake_keyboard(pg):
    """撤掉模拟，恢复正常视口（键盘收起）"""
    pg.evaluate("""() => {
      const real = Object.getPrototypeOf(window.visualViewport);
      delete window.visualViewport;
      if (real) Object.defineProperty(window, 'visualViewport', { value: real, configurable: true });
    }""")


def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.route('**/api.github.com/**', handle)
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
        pg.goto(BASE)
        pg.wait_for_timeout(600)
        login(pg)
        pg.wait_for_timeout(800)

        # ── 1. 商店弹层：焦点残留不再吞返回 ──
        pg.click('.tabbar button:has-text("热门")')
        pg.wait_for_timeout(500)
        pg.wait_for_selector('button[aria-label="APK 商店"]', timeout=15000)
        pg.click('button[aria-label="APK 商店"]')
        pg.wait_for_selector('.shop-card:not(.shop-skel)', timeout=10000)
        assert state(pg)['sheetOpen'], '商店弹层没打开'

        # 点搜索框让焦点落进 input（模拟用户点过搜索框再按返回）
        pg.click('.sheet .search input')
        assert state(pg)['active'] == 'INPUT', '搜索框应持有焦点'
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(300)
        s = state(pg)
        assert not s['sheetOpen'], (
            f'焦点残留时第一下返回就该收弹层（修复后），实际弹层还开着、active={s["active"]}'
        )
        print('[1] 商店弹层：点过搜索框后按返回，一下就收（不再被焦点残留吞掉）')

        # ── 2. 软键盘真开着：第一下只收键盘，第二下才收弹层 ──
        pg.click('button[aria-label="APK 商店"]')
        pg.wait_for_selector('.shop-card:not(.shop-skel)', timeout=10000)
        pg.click('.sheet .search input')
        fake_keyboard(pg, 400)  # 844 → 400，键盘开着的样子
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(300)
        s = state(pg)
        assert s['sheetOpen'], '键盘开着时第一下返回应只收键盘，弹层不该关'
        assert s['active'] != 'INPUT', '这一下应该把焦点（键盘）收掉'
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(300)
        assert not state(pg)['sheetOpen'], '第二下返回应收弹层'
        unfake_keyboard(pg)
        print('[2] 软键盘真开着：第一下只收键盘，第二下才收弹层 —— 安卓直觉语义')
        pg.screenshot(path=f'{OUT}/backkey-098-hot.png')

        # ── 3. 商店详情弹层：一下退回热门；仓库路由栈一下退回热门 ──
        pg.click('button[aria-label="APK 商店"]')
        pg.wait_for_selector('.shop-card:not(.shop-skel)', timeout=10000)
        pg.locator('.shop-card:not(.shop-skel)', has_text='localsend').first.click()
        pg.wait_for_timeout(900)
        s = state(pg)
        assert s['sheetOpen'] and 'localsend/localsend' in pg.evaluate('document.body.innerText'), (
            '点应用应打开仓库详情弹层'
        )
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(600)
        s = state(pg)
        assert s['entry'], '详情弹层按一下返回应回到热门页（入口可见）'
        assert not s['sheetOpen'], '详情弹层应已收起'
        print('[3] 商店详情弹层语义无损：按一下返回热门页')

        # 仓库路由栈：仓库页签点头像进个人页（Route），Esc 一下退回
        pg.click('.tabbar button:has-text("仓库")')
        pg.wait_for_timeout(600)
        pg.click('button[aria-label="打开个人页"]')
        pg.wait_for_selector('.profile-head', timeout=8000)
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(600)
        s = state(pg)
        assert pg.evaluate("!document.querySelector('.profile-head')"), '个人页应已退出'
        assert pg.evaluate("!document.querySelector('.sheet')"), '不应有任何弹层残留'
        print('[4] 仓库路由栈语义无损：按一下返回上一页')

        # ── 5. 热门页根层按返回：按设计回首页页签，不误杀页面 ──
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(600)
        s = state(pg)
        assert s['hotVisible'], '返回后主界面应在'
        # 热门不是首页页签：根层返回应切回首页（仓库）页签，商店入口随之消失
        entry_gone = not pg.evaluate('!!document.querySelector(\'button[aria-label="APK 商店"]\')')
        assert entry_gone, '应已切回首页页签（热门页入口不再可见）'
        assert not store_errors(errors), f'报错：{store_errors(errors)[:5]}'
        print('[5] 热门根层返回切回首页页签（home 语义）；console 无相关报错')

        b.close()
        print('全部断言通过')


def store_errors(errors):
    return [
        e for e in errors
        if 'pageerror' in e or 'back' in e.lower() or 'escape' in e.lower()
    ]


if __name__ == '__main__':
    main()
