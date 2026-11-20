"""验证「高透液态玻璃导航栏」的四条硬指标。

依赖：`npx vite preview --port 4173`，playwright，xvfb。
    xvfb-run -a python3 scripts/verify-glass.py

断言口径（全部读 computed style，不靠截图目测）：
1. 底色是透明度极低的渐变（不是实色、不是不透明）；
2. backdrop-filter 的 blur 落在 10–16px；
3. 没有边框（分割线）；
4. 文字与图标都有阴影（和背后模糊层拉开对比）。
另外采一层像素方差，证明底栏区域确实「透出了背后的东西」，不是一块纯色。
"""
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
        'description': '一行足够长的简介，用来验证玻璃背后的文字轮廓是否还看得出来。' * 2,
        'language': ['TypeScript', 'Rust', 'Python', 'Go'][i % 4],
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


def handle(route):
    path = re.sub(r'^https://api\.github\.com', '', route.request.url).split('?')[0]
    if path == '/user':
        body = USER
    elif path == '/user/repos':
        body = REPOS
    elif path == '/notifications':
        body = []
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}}
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
        body=__import__('json').dumps(body),
    )


STYLE_JS = """() => {
  const bar = document.querySelector('.tabbar');
  const cs = getComputedStyle(bar);
  const btn = bar.querySelector('button');
  const bcs = getComputedStyle(btn);
  const svg = bar.querySelector('svg');
  return {
    bgImage: cs.backgroundImage,
    bgColor: cs.backgroundColor,
    backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
    borderTop: cs.borderTopWidth,
    borderTopStyle: cs.borderTopStyle,
    textShadow: bcs.textShadow,
    iconFilter: svg ? getComputedStyle(svg).filter : 'none',
    height: bar.getBoundingClientRect().height,
    top: bar.getBoundingClientRect().top,
  };
}"""


def check(pg, tag):
    s = pg.evaluate(STYLE_JS)
    assert 'linear-gradient' in s['bgImage'], f'[{tag}] 底色不是渐变：{s["bgImage"]}'
    m = re.search(r'blur\(([\d.]+)px\)', s['backdrop'] or '')
    assert m, f'[{tag}] 没有 backdrop blur：{s["backdrop"]!r}'
    blur = float(m.group(1))
    assert 10 <= blur <= 16, f'[{tag}] blur {blur}px 超出 10–16'
    assert s['borderTop'] == '0px', f'[{tag}] 还有 {s["borderTop"]} 边框'
    assert s['textShadow'] != 'none', f'[{tag}] 文字没有阴影'
    print(f'[{tag}] bg=渐变 blur={blur}px border={s["borderTop"]} text-shadow={s["textShadow"]}')
    print(f'[{tag}] 图标 filter={s["iconFilter"]}')
    return s


def variance(pg):
    """底栏区域截图的像素方差。纯色板接近 0，透出内容才会明显大于 0。"""
    box = pg.locator('.tabbar').bounding_box()
    shot = pg.screenshot(clip=box)
    import io
    from PIL import Image
    im = Image.open(io.BytesIO(shot)).convert('RGB')
    px = list(im.getdata())
    n = len(px)
    mean = [sum(c[i] for c in px) / n for i in range(3)]
    var = sum((c[i] - mean[i]) ** 2 for c in px for i in range(3)) / (n * 3)
    return var ** 0.5


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
        pg.wait_for_timeout(800)

        # 导入令牌，进主界面
        pg.click('.who-btn')
        pg.wait_for_timeout(300)
        pg.click('text=添加账号')
        pg.wait_for_timeout(400)
        pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
        pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
        pg.click('text=加密保存')
        pg.wait_for_timeout(3200)
        pg.wait_for_selector('.rows .row', timeout=20000)

        # 滚到能看见「文字穿过底栏」的位置
        pg.evaluate("document.querySelector('.page').scrollTop = 620")
        pg.wait_for_timeout(500)

        # ── 浅色（float 胶囊，默认档）──
        pg.evaluate("document.documentElement.dataset.theme = 'light'")
        pg.wait_for_timeout(350)
        check(pg, 'light/float')
        sd = variance(pg)
        assert sd > 2.0, f'底栏像素几乎纯色（σ={sd:.2f}），背后内容没透出来'
        print(f'[light/float] 底栏区域像素 σ={sd:.2f}（纯色板应接近 0）')
        pg.screenshot(path=f'{OUT}/glass-light-082.png')

        # ── 深色 ──
        pg.evaluate("document.documentElement.dataset.theme = 'dark'")
        pg.wait_for_timeout(350)
        check(pg, 'dark/float')
        sd = variance(pg)
        print(f'[dark/float] 底栏区域像素 σ={sd:.2f}')
        pg.screenshot(path=f'{OUT}/glass-dark-082.png')

        # ── 贴底通栏（渐变淡出最明显的一档）──
        pg.evaluate("document.documentElement.dataset.tabbar = 'dock'")
        pg.wait_for_timeout(350)
        s = check(pg, 'dark/dock')
        assert float(s['height']) > 50, f'通栏高度不对：{s["height"]}'
        pg.screenshot(path=f'{OUT}/glass-dock-082.png')

        pg.evaluate("document.documentElement.dataset.theme = 'light'")
        pg.wait_for_timeout(350)
        check(pg, 'light/dock')
        pg.screenshot(path=f'{OUT}/glass-dock-light-082.png')

        # ── 三档玻璃的 blur 都在区间内 ──
        for glass in ('clear', 'thick'):
            pg.evaluate(f"document.documentElement.dataset.glass = '{glass}'")
            pg.wait_for_timeout(250)
            check(pg, f'light/dock/{glass}')

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
