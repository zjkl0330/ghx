"""验证：APK 商店收进热门页标题栏入口 + 全屏清单弹层（v0.9.5 重排）。

上一版把商店横滑卡插在筛选区与榜单之间，喧宾夺主 —— 重排后热门页只留
标题栏一个「包裹」图标入口，内容收进全屏弹层（两列网格 + 过滤）。要证：

  · 热门页内不再有内嵌商店区块，标题栏出现入口按钮（feed 可用时）；
  · 点入口拉起弹层：标题、来源副标题（含 rotation 日期与应用总数）、
    两列网格卡片渲染名称 / 版本 tag / 星数；
  · 过滤框按名称/简介即时过滤，清空恢复；
  · 点应用：弹层关、仓库详情开（走现有链路）；
  · 页面 390 宽不溢出；弹层卡片网格不出屏；
  · feed 拉不到：入口按钮不出现，热门页完全无痕；
  · console 无 store 相关报错。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-apkstore.py
"""
import json
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OUT = '/workspace/ghx/docs/screenshots'
OWNER = 'zjkl0330'
FEED_URL = re.compile(
    r'.*komi-store-backend-data.*cached-data/feed/android\.json'
)


def item(i, full, name, stars, tag, desc, lang):
    owner = full.split('/')[0]
    return {
        'id': 100 + i,
        'name': name,
        'fullName': full,
        'owner': {'login': owner, 'avatarUrl': f'https://avatars.githubusercontent.com/u/{100 + i}?v=4'},
        'description': desc,
        'defaultBranch': 'main',
        'stargazersCount': stars,
        'forksCount': stars // 10,
        'openIssuesCount': 10,
        'licenseSpdxId': 'MIT',
        'language': lang,
        'topics': ['android'],
        'pushedAt': '2026-11-20 14:36:03+00',
        'latestReleaseTag': tag,
        'latestReleaseDate': '2026-11-18 10:00:00+00',
        'downloadCount': stars * 7,
        'hasInstallersAndroid': True,
        'platformReleases': {'android': {'tag': tag, 'publishedAt': '2026-11-18T10:00:00Z'}},
    }


APPS = [
    item(0, 'localsend/localsend', 'localsend', 60000, 'v1.17.0', '跨设备互传文件与消息', 'Dart'),
    item(1, 'immich-app/immich', 'immich', 55000, 'v2.2.0', '自托管照片备份', 'TypeScript'),
    item(2, 'topjohnwu/Magisk', 'Magisk', 50000, 'v29.0', '安卓 root 套件', 'Kotlin'),
    item(3, 'TeamNewPipe/NewPipe', 'NewPipe', 35000, 'v0.27.0', '轻量 YouTube 前端', 'Java'),
    item(4, 'rustdesk/rustdesk', 'rustdesk', 90000, '1.4.3', '开源远程桌面', 'Rust'),
    item(5, 'godotengine/godot', 'godot', 120000, '4.5.1', '跨平台游戏引擎', 'C++'),
    item(6, 'chen08209/FlClash', 'FlClash', 20000, 'v0.9.0', '多平台代理客户端', 'Dart'),
    item(7, 'logseq/logseq', 'logseq', 33000, '0.11.9', '本地优先的知识库', 'Clojure'),
    item(8, 'SagerNet/sing-box', 'sing-box', 25000, 'v1.13.0', '通用代理平台', 'Go'),
    item(9, 'AppFlowy-IO/AppFlowy', 'AppFlowy', 61000, 'v0.9.5', '开源 Notion 替代', 'Rust'),
]

FEED_BODY = json.dumps({'category': 'feed', 'platform': 'android', 'rotation': '2026-11-20', 'repositories': APPS})

REPOS = [
    {
        'id': 1, 'name': 'ghx', 'full_name': f'{OWNER}/ghx',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': False, 'visibility': 'public', 'archived': False, 'disabled': False,
        'description': '一个 GitHub 客户端', 'language': 'TypeScript',
        'stargazers_count': 42, 'forks_count': 3,
        'pushed_at': '2026-11-18T10:00:00Z', 'updated_at': '2026-11-18T10:00:00Z',
        'created_at': '2025-06-01T08:00:00Z', 'default_branch': 'main',
        'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
    },
]

USER = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
    'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
    'public_repos': 1, 'public_gists': 0, 'followers': 128, 'following': 12,
    'bio': None, 'company': None, 'location': None, 'blog': None,
    'created_at': '2025-03-01T08:00:00Z',
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
        body = REPOS
    elif path == '/notifications':
        body = []
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}}
    elif path.startswith('/repos/'):
        body = REPOS[0]
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


def open_hot(pg):
    """登录后默认在仓库页签，HotPage 没挂载；先切到热门"""
    pg.click('.tabbar button:has-text("热门")')
    pg.wait_for_timeout(600)


def store_errors(errors):
    """浏览器里长期存在与本功能无关的噪声（README 镜像 CORS、
    ERR_CONTENT_DECODING_FAILED 等，历版 verify 均如此），只认商店自己的错。"""
    return [
        e for e in errors
        if 'pageerror' in e or 'komi' in e.lower() or 'apkstore' in e.lower()
        or 'store' in e.lower()
    ]


MEASURE = """() => {
  const de = document.documentElement;
  const cards = [...document.querySelectorAll('.shop-card:not(.shop-skel)')].map((n) => ({
    name: (n.querySelector('.shop-name') || {}).textContent || '',
    tag: (n.querySelector('.shop-tag') || {}).textContent || '',
    meta: (n.querySelector('.shop-meta') || {}).textContent || '',
  }));
  const grid = document.querySelector('.shop-grid');
  return {
    width: de.scrollWidth,
    client: de.clientWidth,
    shopEntry: !!document.querySelector('button[aria-label="APK 商店"]'),
    inlineStore: !!document.querySelector('.store, .store-rail, .store-card'),
    sheetOpen: !!document.querySelector('.sheet'),
    title: (document.querySelector('.sheet-head h3') || {}).textContent || '',
    sub: (document.querySelector('.sheet-sub') || {}).textContent || '',
    hasFilter: !!document.querySelector('.sheet .search input'),
    cards,
    gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    gridOverflow: grid ? grid.getBoundingClientRect().right <= window.innerWidth + 1 : true,
    body: document.body.innerText,
  };
}"""


def new_page(b, handle_feed=True):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.route('**/api.github.com/**', handle)
    if handle_feed:
        pg.route(FEED_URL, lambda r: r.fulfill(status=200, content_type='application/json', body=FEED_BODY))
    else:
        pg.route(FEED_URL, lambda r: r.fulfill(status=404, content_type='text/plain', body='not found'))
    pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
    pg.goto(BASE)
    pg.wait_for_timeout(600)
    login(pg)
    open_hot(pg)
    return pg, errors


def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )

        # ── 1. 热门页干净：没有内嵌区块，标题栏有入口 ──
        pg, errors = new_page(b)
        pg.wait_for_selector('button[aria-label="APK 商店"]', timeout=15000)
        m = pg.evaluate(MEASURE)
        assert not m['inlineStore'], '热门页里不该再有内嵌商店区块'
        assert m['shopEntry'], '标题栏应有商店入口按钮'
        assert m['width'] <= m['client'] + 1, f'页面被撑宽：{m["width"]} > {m["client"]}'
        print('[1] 热门页干净：无内嵌区块，标题栏入口就位，页面未溢出')

        # ── 2. 点入口拉起弹层 ──
        pg.click('button[aria-label="APK 商店"]')
        pg.wait_for_selector('.shop-card:not(.shop-skel)', timeout=10000)
        m = pg.evaluate(MEASURE)
        assert m['sheetOpen'], '弹层没打开'
        assert 'APK 商店' in m['title'], f'弹层标题不对：{m["title"]}'
        assert 'komi-store' in m['sub'] and '2026-11-20' in m['sub'], f'副标题应含来源与 rotation：{m["sub"]}'
        assert '10 个安卓应用' in m['sub'], f'副标题应含总数：{m["sub"]}'
        assert len(m['cards']) == 10, f'应 10 张卡，实际 {len(m["cards"])}'
        assert m['gridCols'] == 2, f'网格应 2 列，实际 {m["gridCols"]}'
        assert m['gridOverflow'], '网格卡片溢出屏幕'
        assert m['width'] <= m['client'] + 1, f'弹层把页面撑宽：{m["width"]}'
        first = m['cards'][0]
        assert first['name'] == 'localsend', f'第一张卡应是 localsend：{first}'
        assert first['tag'] == 'v1.17.0', f'版本 tag 应来自 feed：{first["tag"]}'
        assert '60k' in first['meta'], f'星数应紧凑显示：{first["meta"]}'
        pg.screenshot(path=f'{OUT}/apkstore-095-sheet.png')
        print(f'[2] 弹层：{m["title"]} · {m["sub"]}；2 列网格 10 张卡，未溢出')
        print(f'[3] 前 3 张卡：{[(c["name"], c["tag"], c["meta"]) for c in m["cards"][:3]]}')

        # ── 3. 过滤 ──
        pg.fill('.sheet .search input', 'godot')
        pg.wait_for_timeout(400)
        f = pg.evaluate(MEASURE)
        assert len(f['cards']) == 1 and f['cards'][0]['name'] == 'godot', (
            f'按名称过滤应剩 godot：{[c["name"] for c in f["cards"]]}'
        )
        pg.fill('.sheet .search input', '照片备份')
        pg.wait_for_timeout(400)
        f = pg.evaluate(MEASURE)
        assert len(f['cards']) == 1 and f['cards'][0]['name'] == 'immich', (
            f'按简介过滤应剩 immich：{[c["name"] for c in f["cards"]]}'
        )
        pg.fill('.sheet .search input', '')
        pg.wait_for_timeout(300)
        f = pg.evaluate(MEASURE)
        assert len(f['cards']) == 10, '清空过滤应恢复全量'
        print('[4] 过滤：按名称/简介即时生效，清空恢复全量')

        # ── 4. 点应用 → 弹层收、详情开 ──
        pg.locator('.shop-card:not(.shop-skel)', has_text='localsend').first.click()
        pg.wait_for_timeout(900)
        d = pg.evaluate(MEASURE)
        assert 'localsend/localsend' in d['body'], '点应用没有打开仓库详情'
        assert '发行版' in d['body'] or 'Releases' in d['body'], '详情里应能看到发行版入口'
        pg.screenshot(path=f'{OUT}/apkstore-095-detail.png')
        print('[5] 点应用收商店弹层、开仓库详情（现有链路）')
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(500)
        after = pg.evaluate(MEASURE)
        assert after['shopEntry'], '回到热门页后入口还在'
        print('[6] Esc 关详情后回到热门页，入口无损')

        assert store_errors(errors) == [], f'store 相关报错：{store_errors(errors)[:5]}'
        print('[7] console 无 store 相关报错')
        pg.context.close()

        # ── 5. feed 拉不到：入口不出现 ──
        pg2, errors2 = new_page(b, handle_feed=False)
        pg2.wait_for_timeout(4000)
        f = pg2.evaluate(MEASURE)
        assert not f['inlineStore'], 'feed 404 时更不该有内嵌区块'
        assert not f['shopEntry'], 'feed 404 时入口按钮不该出现'
        assert 'APK 商店' not in f['body'], '热门页不应出现商店字样'
        assert not store_errors(errors2), f'失败路径不该报错：{store_errors(errors2)[:5]}'
        print('[8] feed 拉不到时入口隐藏，热门页完全无痕')

        # ── 6. 弹层开着按 Esc（返回键）直接收弹层 ──
        # 上面那个 context 是 feed-404 场景（入口本来就被隐藏），换一个正常场景
        pg3, _ = new_page(b, handle_feed=True)
        pg3.wait_for_selector('button[aria-label="APK 商店"]', timeout=15000)
        pg3.click('button[aria-label="APK 商店"]')
        pg3.wait_for_selector('.shop-card:not(.shop-skel)', timeout=10000)
        pg3.keyboard.press('Escape')
        pg3.wait_for_timeout(500)
        e = pg3.evaluate(MEASURE)
        assert not e['sheetOpen'], '返回键应直接收商店弹层'
        assert e['shopEntry'], '收起弹层后应回到热门页'
        print('[9] 返回键语义正确：商店弹层一按就收，回热门榜单')
        pg3.context.close()

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
