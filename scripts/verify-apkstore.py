"""验证：热门页顶部的「APK 商店」横滑区。

数据源是 komi-store 维护的公开精选目录（komi-store-backend-data 仓库的
raw JSON），不是 GitHub API。这一层要证：

  · 热门模式（非搜索）出现「APK 商店」区块，卡片数与 feed 条数一致；
  · 卡片渲染名称 / 星数 / 最新版本 tag，版本 tag 来自 feed 的
    latestReleaseTag（含 komi-store 的非 ISO 时间格式，顺带证解析）；
  · 点卡片打开的是现有仓库详情链路（不另起炉灶），Esc 能关掉；
  · 输入搜索关键词后区块隐藏，清空后回来 —— 搜索时不占屏；
  · 390 宽下页面不横向溢出，横滑轨道本身可横滚；
  · 网络失败（feed 404）时区块整块隐藏，不出破图或空壳；
  · console 无报错。

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

# 10 条按真实 feed 结构造的条目（字段与 komi-store 上游一致，含非 ISO 时间）
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
  const cards = [...document.querySelectorAll('.store-card:not(.store-card-skel)')].map((n) => ({
    name: (n.querySelector('.store-name') || {}).textContent || '',
    tag: (n.querySelector('.store-tag') || {}).textContent || '',
    meta: (n.querySelector('.store-meta') || {}).textContent || '',
  }));
  const rail = document.querySelector('.store-rail');
  return {
    width: de.scrollWidth,
    client: de.clientWidth,
    hasStore: !!document.querySelector('.store'),
    title: (document.querySelector('.store-title') || {}).textContent || '',
    sub: (document.querySelector('.store-sub') || {}).textContent || '',
    cards,
    railScrollable: rail ? rail.scrollWidth > rail.clientWidth + 1 : false,
    railOverflowHidden: rail ? rail.scrollWidth <= rail.clientWidth + 200 : true,
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

        # ── 1. 区块出现、卡片齐全 ──
        pg, errors = new_page(b)
        pg.wait_for_selector('.store-card:not(.store-card-skel)', timeout=15000)
        m = pg.evaluate(MEASURE)
        assert m['hasStore'], '热门页没有出现 APK 商店区块'
        assert 'APK 商店' in m['title'], f'标题不对：{m["title"]}'
        assert 'komi-store' in m['sub'], f'副标题没写来源：{m["sub"]}'
        assert len(m['cards']) == 10, f'应 10 张卡，实际 {len(m["cards"])}'
        assert m['width'] <= m['client'] + 1, f'页面被撑宽：{m["width"]} > {m["client"]}'
        assert m['railScrollable'], '横滑轨道应当可横滚（10 张卡 390 宽必然放不下）'
        print(f'[1] 区块出现：{m["title"]} · {m["sub"]}；{len(m["cards"])} 张卡，页面未溢出')
        print(f'[2] 前 3 张卡：{[(c["name"], c["tag"], c["meta"]) for c in m["cards"][:3]]}')

        # ── 2. 卡片内容：版本 tag 与星数 ──
        first = m['cards'][0]
        assert first['name'] == 'localsend', f'第一张卡应是 localsend：{first}'
        assert first['tag'] == 'v1.17.0', f'版本 tag 应来自 feed：{first["tag"]}'
        assert '60k' in first['meta'], f'星数应紧凑显示：{first["meta"]}'
        assert any(c['tag'] == '4.5.1' for c in m['cards']), 'godot 的无 v 前缀 tag 应原样显示'
        pg.screenshot(path=f'{OUT}/apkstore-094-rail.png')
        print('[3] 卡片渲染名称 / 版本 tag / 星数正确')

        # ── 3. 点卡片进现有仓库详情链路 ──
        pg.locator('.store-card:not(.store-card-skel)', has_text='localsend').first.click()
        pg.wait_for_timeout(900)
        body = pg.evaluate('() => document.body.innerText')
        assert 'localsend/localsend' in body, '点卡片没有打开仓库详情'
        assert '发行版' in body or 'Releases' in body, '详情里应能看到发行版入口'
        pg.screenshot(path=f'{OUT}/apkstore-094-detail.png')
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(500)
        after = pg.evaluate(MEASURE)
        assert after['hasStore'], '关掉详情后商店区块应还在'
        print('[4] 点卡片打开的是现有仓库详情（含发行版入口），Esc 关闭后区块无损')

        # ── 4. 搜索时隐藏，清空后回来 ──
        pg.fill('.search input', 'flutter')
        pg.wait_for_timeout(700)
        s = pg.evaluate(MEASURE)
        assert not s['hasStore'], '搜索模式下商店区块不该出现'
        print('[5] 搜索模式下区块隐藏')
        pg.fill('.search input', '')
        pg.wait_for_timeout(500)
        s = pg.evaluate(MEASURE)
        assert s['hasStore'] and len(s['cards']) == 10, '清空搜索后区块应恢复'
        print('[6] 清空搜索后区块恢复，无需重新取数')

        assert store_errors(errors) == [], f'store 相关报错：{store_errors(errors)[:5]}'
        print('[7] console 无 store 相关报错')
        pg.context.close()

        # ── 5. feed 拉不到：整块隐藏，不出空壳 ──
        pg2, errors2 = new_page(b, handle_feed=False)
        pg2.wait_for_timeout(4000)
        f = pg2.evaluate(MEASURE)
        assert not f['hasStore'], 'feed 404 时区块应整块隐藏'
        assert '正在装填' not in f['body'], 'feed 404 时不该留下骨架占位'
        assert store_errors(errors2) == [], f'失败路径不该报错：{store_errors(errors2)[:5]}'
        print('[8] feed 拉不到时区块整块隐藏，热门榜单不受影响')
        pg2.context.close()

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
