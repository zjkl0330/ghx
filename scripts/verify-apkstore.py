"""验证：APK 商店平台归属 + 头像多线路回退（v0.9.7）。

用户反馈：图标全成了首字母（旧代码 ok 初始为 false、img 不渲染就永远
不触发 onLoad，头像从未真正加载过）；且没有平台归属（EXE/macOS/安卓/Linux）。
v0.9.7/v0.9.9 要证：
  · 三个目录源合并去重（feed 10 + 最热门 2 + 新发行 1 = 13 个应用）；
  · 旧 schema 条目（顶层 stars/avatarUrl、tag 走 platformReleases 兜底）正确解析；

  · 卡片头像真的加载出 <img>（原图线路被掐死后，gh-proxy 改写线路接管）；
  · 卡片带平台小标（安卓/Win/macOS/Linux），feed 的 hasInstallers* 解析正确；
  · 弹层有平台筛选 tabs（全部/安卓/Win/macOS/Linux，带计数），点切生效；
  · 热门页内不再有内嵌商店区块，标题栏出现入口按钮（feed 可用时）；
  · 点入口拉起弹层：标题、来源副标题（含 rotation 日期与应用总数）、
    单列清单：卡片占满整行，名称 / 版本 tag / 平台标 / 星数都在一行内；
  · 名称/简介过滤与平台筛选可叠加，清空恢复；
  · 点应用：弹层关、仓库详情开（走现有链路）；
  · 页面 390 宽不溢出；
  · feed 拉不到：入口按钮不出现，热门页完全无痕；
  · console 无 store 相关报错。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-apkstore.py
"""
import base64
import json
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OUT = '/workspace/ghx/docs/screenshots'
OWNER = 'zjkl0330'
FEED_URL = re.compile(
    r'.*komi-store-backend-data.*android\.json'
)
AVATAR_ORIGINAL = re.compile(r'^https://avatars\.githubusercontent\.com/')
AVATAR_PROXY = re.compile(r'^https://gh-proxy\.com/https://avatars\.githubusercontent\.com/')

# 1x1 透明 PNG —— 充当代理线路成功返回的头像
TINY_PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
)


def item(i, full, name, stars, tag, desc, lang, plats):
    owner = full.split('/')[0]
    flags = {f'hasInstallers{p.capitalize()}': (p in plats) for p in ('android', 'windows', 'macos', 'linux')}
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
        'platformReleases': {'android': {'tag': tag, 'publishedAt': '2026-11-18T10:00:00Z'}},
        **flags,
    }


ALL4 = ('android', 'windows', 'macos', 'linux')

def item_old_schema(i, full, name, stars, tag, desc, lang, plats):
    """旧 schema 条目：星数/头像在顶层、无 owner 对象、tag 只在 platformReleases 里"""
    flags = {f'hasInstallers{p.capitalize()}': (p in plats) for p in ('android', 'windows', 'macos', 'linux')}
    return {
        'id': 500 + i, 'name': name, 'fullName': full, 'avatarUrl': f'https://avatars.githubusercontent.com/u/{500 + i}?v=4',
        'description': desc, 'defaultBranch': 'main',
        'stars': stars, 'forksCount': stars // 10,
        'licenseSpdxId': 'MIT', 'language': lang, 'topics': [],
        'pushedAt': '2026-11-19 08:00:00+00',
        'latestReleaseTag': None,
        'platformReleases': {'android': {'tag': tag, 'publishedAt': '2026-11-01T08:00:00Z'}},
        **flags,
    }


# most-popular：2 个与 feed 重复（验证去重）+ 2 个新（其中 openclaw 是旧 schema）
POP_APPS = [
    item(0, 'localsend/localsend', 'localsend', 60000, 'v1.17.0', '跨设备互传文件与消息，详见 https://github.com/localsend/localsend。', 'Dart', ALL4),
    item(5, 'godotengine/godot', 'godot', 120000, '4.5.1', '跨平台游戏引擎', 'C++', ALL4),
    item_old_schema(0, 'openclaw/openclaw', 'openclaw', 394559, 'v2026.8.2', 'The AI that really does things', 'TypeScript', ('android',)),
    item_old_schema(1, 'termux/termux', 'termux', 22000, 'v0.119.0', 'Android terminal emulator', 'Java', ('android', 'windows')),
]
NEW_APPS = [
    item_old_schema(2, 'wailsapp/wails', 'wails', 33000, 'v2.11.2', 'Build desktop apps with Go', 'Go', ('android', 'macos', 'linux')),
]
POP_BODY = json.dumps({'category': 'most-popular', 'platform': 'android', 'repositories': POP_APPS})
NEW_BODY = json.dumps({'category': 'new-releases', 'platform': 'android', 'repositories': NEW_APPS})
# 合并预期：feed 10 + pop 新 2 + new 新 1 = 13；平台：安卓 13 / Win 8 / macOS 7 / Linux 8

APPS = [
    item(0, 'localsend/localsend', 'localsend', 60000, 'v1.17.0', '跨设备互传文件与消息，详见 https://github.com/localsend/localsend。', 'Dart', ALL4),
    item(1, 'immich-app/immich', 'immich', 55000, 'v2.2.0', '自托管照片备份', 'TypeScript', ('android', 'linux')),
    item(2, 'topjohnwu/Magisk', 'Magisk', 50000, 'v29.0', '安卓 root 套件', 'Kotlin', ('android',)),
    item(3, 'TeamNewPipe/NewPipe', 'NewPipe', 35000, 'v0.27.0', '轻量 YouTube 前端', 'Java', ('android',)),
    item(4, 'rustdesk/rustdesk', 'rustdesk', 90000, '1.4.3', '开源远程桌面', 'Rust', ALL4),
    item(5, 'godotengine/godot', 'godot', 120000, '4.5.1', '跨平台游戏引擎', 'C++', ALL4),
    item(6, 'chen08209/FlClash', 'FlClash', 20000, 'v0.9.0', '多平台代理客户端', 'Dart', ALL4),
    item(7, 'logseq/logseq', 'logseq', 33000, '0.11.9', '本地优先的知识库', 'Clojure', ('android', 'windows')),
    item(8, 'SagerNet/sing-box', 'sing-box', 25000, 'v1.13.0', '通用代理平台', 'Go', ALL4),
    item(9, 'AppFlowy-IO/AppFlowy', 'AppFlowy', 61000, 'v0.9.5', '开源 Notion 替代', 'Rust', ALL4),
]
# 平台计数（断言 tabs 用）：android 10 / windows 7 / macos 6 / linux 7

FEED_BODY = json.dumps({'category': 'feed', 'platform': 'android', 'rotation': '2026-11-20', 'repositories': APPS})

REPOS = [
    {
        'id': 1, 'name': 'ghx', 'full_name': f'{OWNER}/ghx',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': False, 'visibility': 'public', 'archived': False, 'disabled': False,
        'description': '一个 GitHub 客户端，主页见 https://github.com/zjkl0330/ghx。', 'language': 'TypeScript',
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


AVATAR_SELF = re.compile(r'^https://avatars-githubusercontent-com-')

def avatar_routes(pg):
    """头像线路编排：原图与自建头像域名一律掐死（模拟直连不通），
    gh-proxy 改写线路返回 1x1 PNG（模拟代理成功）。后注册的规则优先。"""
    pg.route(AVATAR_ORIGINAL, lambda r: r.abort())
    pg.route(AVATAR_SELF, lambda r: r.abort())
    pg.route(AVATAR_PROXY, lambda r: r.fulfill(status=200, content_type='image/png', body=TINY_PNG))


def feed_routes(pg, ok=True):
    """三个目录源按 URL 分发；ok=False 时全部 404"""
    def route(r):
        if not ok:
            r.fulfill(status=404, content_type='text/plain', body='not found')
            return
        u = r.request.url
        if 'most-popular/android.json' in u:
            r.fulfill(status=200, content_type='application/json', body=POP_BODY)
        elif 'new-releases/android.json' in u:
            r.fulfill(status=200, content_type='application/json', body=NEW_BODY)
        else:
            r.fulfill(status=200, content_type='application/json', body=FEED_BODY)
    pg.route(FEED_URL, route)


MEASURE = """() => {
  const de = document.documentElement;
  const cards = [...document.querySelectorAll('.shop-card:not(.shop-skel)')].map((n) => ({
    name: (n.querySelector('.shop-name') || {}).textContent || '',
    tag: (n.querySelector('.shop-tag') || {}).textContent || '',
    meta: (n.querySelector('.shop-meta') || {}).textContent || '',
    plats: [...n.querySelectorAll('.shop-plat')].map((x) => x.textContent),
    imgSrc: (n.querySelector('img.shop-avatar') || {}).src || '',
    letter: !!n.querySelector('.shop-letter'),
  }));
  const grid = document.querySelector('.shop-grid');
  const first = document.querySelector('.shop-card:not(.shop-skel)');
  return {
    width: de.scrollWidth,
    client: de.clientWidth,
    shopEntry: !!document.querySelector('button[aria-label="APK 商店"]'),
    inlineStore: !!document.querySelector('.store, .store-rail, .store-card'),
    sheetOpen: !!document.querySelector('.sheet'),
    title: (document.querySelector('.sheet-head h3') || {}).textContent || '',
    sub: (document.querySelector('.sheet-sub') || {}).textContent || '',
    hasFilter: !!document.querySelector('.sheet .search input'),
    tabs: [...document.querySelectorAll('.shop-tab')].map((x) => ({
      text: x.textContent,
      on: x.classList.contains('on'),
    })),
    activeTab: (document.querySelector('.shop-tab.on') || {}).textContent || '',
    cards,
    // v1.1.1 起是单列清单：grid 改成 flex 列，卡片应占满整行
    gridCols: grid ? (getComputedStyle(grid).display === 'flex' ? 1 : getComputedStyle(grid).gridTemplateColumns.split(' ').length) : 0,
    rowWide: grid && first ? first.getBoundingClientRect().width >= grid.getBoundingClientRect().width - 2 : false,
    hasBody: !!document.querySelector('.shop-card .shop-body'),
    hasGo: !!document.querySelector('.shop-card .shop-go'),
    gridOverflow: grid ? grid.getBoundingClientRect().right <= window.innerWidth + 1 : true,
    body: document.body.innerText,
  };
}"""


def new_page(b, handle_feed=True):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    # 包里不再预置加速站：先模拟「用户自己填了一个 url 型代理」，
    # 头像改写与目录候选才会走它（否则只剩官方 raw，回退链无从验证）。
    ctx.add_init_script(
        "try{localStorage.setItem('ghx.mirror.store',"
        "JSON.stringify({overrides:{},custom:["
        "{id:'u1',label:'gh-proxy.com',base:'https://gh-proxy.com',style:'url'}]}));}catch(e){}"
    )
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.route('**/api.github.com/**', handle)
    feed_routes(pg, ok=handle_feed)
    pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
    avatar_routes(pg)
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
        assert '13 个应用' in m['sub'], f'副标题应含总数（三源合并）：{m["sub"]}'
        assert len(m['cards']) == 13, f'三源合并去重后应 13 张卡，实际 {len(m["cards"])}'
        assert m['gridCols'] == 1, f'清单应为单列，实际 {m["gridCols"]}'
        assert m['rowWide'], '卡片没有占满整行'
        assert m['hasBody'] and m['hasGo'], '卡片缺少内容列或右侧箭头'
        assert m['gridOverflow'], '网格卡片溢出屏幕'
        assert m['width'] <= m['client'] + 1, f'弹层把页面撑宽：{m["width"]}'
        first = m['cards'][0]
        assert first['name'] == 'localsend', f'第一张卡应是 localsend：{first}'
        assert first['tag'] == 'v1.17.0', f'版本 tag 应来自 feed：{first["tag"]}'
        assert '60k' in first['meta'], f'星数应紧凑显示：{first["meta"]}'
        # 平台小标：localsend 是 ALL4，恒安卓在前
        assert first['plats'] == ['安卓', 'Win', 'macOS', 'Linux'], f'平台小标不对：{first["plats"]}'
        magisk = next(c for c in m['cards'] if c['name'] == 'Magisk')
        assert magisk['plats'] == ['安卓'], f'Magisk 应只有安卓：{magisk["plats"]}'
        # 旧 schema 条目：星数认顶层 stars、tag 从 platformReleases 兜底
        claw = next(c for c in m['cards'] if c['name'] == 'openclaw')
        assert '395k' in claw['meta'], f'旧 schema 星数应解析：{claw["meta"]}'
        assert claw['tag'] == 'v2026.8.2', f'tag 应从 platformReleases 兜底：{claw["tag"]}'
        assert claw['plats'] == ['安卓'], f'openclaw 应只有安卓：{claw["plats"]}'
        # 平台筛选 tabs：全部 10 / 安卓 10 / Win 8 / macOS 7 / Linux 8
        tab_texts = [t['text'] for t in m['tabs']]
        expect_tabs = ['全部13', '安卓13', 'Win8', 'macOS7', 'Linux8']
        assert tab_texts == expect_tabs, f'tabs 应为 {expect_tabs}：{tab_texts}'
        assert m['activeTab'].startswith('全部'), f'默认应选中「全部」：{m["activeTab"]}'
        pg.screenshot(path=f'{OUT}/apkstore-097-sheet.png')
        print(f'[2] 弹层：{m["title"]} · {m["sub"]}；单列 10 行，卡片占满整行，平台小标/tabs 就位')
        print(f'[3] 前 3 张卡：{[(c["name"], c["plats"]) for c in m["cards"][:3]]}')

        # ── 3. 头像多线路：原图被掐死，gh-proxy 改写线路接管 ──
        pg.wait_for_timeout(1500)
        m = pg.evaluate(MEASURE)
        imgs = [c for c in m['cards'] if c['imgSrc']]
        assert len(imgs) == 13, f'13 张卡都该出 <img> 头像（走代理线路），实际 {len(imgs)}'
        assert all(c['imgSrc'].startswith('https://gh-proxy.com/') for c in imgs), (
            f'头像应走 gh-proxy 改写线路：{[c["imgSrc"] for c in imgs[:3]]}'
        )
        assert not any(c['letter'] for c in m['cards']), '代理线路可用时不应出现首字母兜底'
        pg.screenshot(path=f'{OUT}/apkstore-097-avatars.png')
        print('[4] 头像回退链生效：原图线路失败 → gh-proxy 改写线路全部接管，无首字母兜底')

        # ── 4. 平台筛选与名称过滤叠加 ──
        pg.click('.shop-tab:has-text("Win")')
        pg.wait_for_timeout(400)
        m = pg.evaluate(MEASURE)
        names = [c['name'] for c in m['cards']]
        assert len(names) == 8, f'Win 筛选应剩 8 个，实际 {len(names)}：{names}'
        assert 'Magisk' not in names and 'NewPipe' not in names and 'immich' not in names and 'openclaw' not in names, f'非 Win 应用该滤掉：{names}'
        assert m['activeTab'].startswith('Win'), 'Win tab 应高亮'
        pg.fill('.sheet .search input', 'godot')
        pg.wait_for_timeout(400)
        m = pg.evaluate(MEASURE)
        assert [c['name'] for c in m['cards']] == ['godot'], f'平台+关键词应叠加：{[c["name"] for c in m["cards"]]}'
        pg.fill('.sheet .search input', '')
        pg.click('.shop-tab:has-text("macOS")')
        pg.wait_for_timeout(400)
        m = pg.evaluate(MEASURE)
        assert len(m['cards']) == 7, f'macOS 筛选应剩 7 个，实际 {len(m["cards"])}'
        pg.click('.shop-tab:has-text("Linux")')
        pg.wait_for_timeout(400)
        m = pg.evaluate(MEASURE)
        assert len(m['cards']) == 8, f'Linux 筛选应剩 8 个，实际 {len(m["cards"])}'
        assert next(c for c in m['cards'] if c['name'] == 'immich')['plats'] == ['安卓', 'Linux'], (
            'immich 应标注 安卓+Linux'
        )
        pg.click('.shop-tab:has-text("全部")')
        pg.wait_for_timeout(400)
        m = pg.evaluate(MEASURE)
        assert len(m['cards']) == 13, '回「全部」应恢复全量'
        print('[5] 平台筛选：Win 8 / macOS 7 / Linux 8 各自生效，与名称过滤可叠加，全部恢复')

        # ── 5. 点应用 → 弹层收、详情开 ──
        pg.locator('.shop-card:not(.shop-skel)', has_text='localsend').first.click()
        pg.wait_for_timeout(900)
        d = pg.evaluate(MEASURE)
        assert 'localsend/localsend' in d['body'], '点应用没有打开仓库详情'
        assert '发行版' in d['body'] or 'Releases' in d['body'], '详情里应能看到发行版入口'
        # 简介里的 URL 应该是可点链接（linkify），不再是死文字
        n_links = pg.evaluate("document.querySelectorAll('.det-desc .md-link').length")
        assert n_links >= 1, f'详情简介里的 URL 应渲染成链接，实际 {n_links} 个'
        pg.screenshot(path=f'{OUT}/apkstore-097-detail.png')
        print('[6] 点应用收商店弹层、开仓库详情（现有链路）')
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(500)
        after = pg.evaluate(MEASURE)
        assert after['shopEntry'], '回到热门页后入口还在'
        print('[7] Esc 关详情后回到热门页，入口无损')

        assert store_errors(errors) == [], f'store 相关报错：{store_errors(errors)[:5]}'
        print('[8] console 无 store 相关报错')
        pg.context.close()

        # ── 6. feed 拉不到：入口不出现 ──
        pg2, errors2 = new_page(b, handle_feed=False)
        pg2.wait_for_timeout(4000)
        f = pg2.evaluate(MEASURE)
        assert not f['inlineStore'], 'feed 404 时更不该有内嵌区块'
        assert not f['shopEntry'], 'feed 404 时入口按钮不该出现'
        assert 'APK 商店' not in f['body'], '热门页不应出现商店字样'
        assert not store_errors(errors2), f'失败路径不该报错：{store_errors(errors2)[:5]}'
        print('[9] feed 拉不到时入口隐藏，热门页完全无痕')

        # ── 7. 弹层开着按 Esc（返回键）直接收弹层 ──
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
        print('[10] 返回键语义正确：商店弹层一按就收，回热门榜单')
        pg3.context.close()

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
