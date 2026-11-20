"""验证「界面字体」开关：默认 OPPO Sans，可切系统字体，且能持久化。

关注三件事：
1. 字体真的加载了（不是回退到系统字体还显示「已生效」）；
2. 切换后整页字形真的变了 —— 用 canvas 量同一段文字的宽度做客观对比；
3. 刷新后选择还在（存 localStorage，首屏内联脚本同步打 data-font）。

用法：
    npx vite build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-font.py
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OWNER = 'zjkl0330'
OUT = '/workspace/ghx/docs/screenshots'

REPO = {
    'id': 1,
    'name': 'clist-cf',
    'full_name': f'{OWNER}/clist-cf',
    'owner': {'login': OWNER, 'avatar_url': ''},
    'private': False,
    'visibility': 'public',
    'archived': False,
    'disabled': False,
    'description': '用 Cloudflare Workers 跑的文件索引。',
    'language': 'TypeScript',
    'stargazers_count': 46,
    'forks_count': 3,
    'open_issues_count': 2,
    'pushed_at': '2026-11-03T14:40:00Z',
    'updated_at': '2026-11-03T14:40:00Z',
    'created_at': '2026-01-12T08:00:00Z',
    'default_branch': 'main',
    'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
}

USER = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
    'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
    'public_repos': 10, 'public_gists': 0, 'followers': 128, 'following': 12,
    'bio': None, 'company': None, 'location': None, 'blog': None,
    'created_at': '2025-03-01T08:00:00Z',
}


def handle(route):
    path = re.sub(r'^https://api\.github\.com', '', route.request.url).split('?')[0]
    if path == '/user':
        body = USER
    elif path in ('/user/repos', '/user/starred'):
        body = [REPO]
    elif path == '/notifications':
        body = []
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}}
    elif path.startswith('/users/'):
        segs = path.strip('/').split('/')
        body = USER if len(segs) == 2 else []
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


# 同一个字符串在两种字体下的宽度，是「字形真的换了」最直接的证据。
# 用真实 DOM 布局而不是 canvas：canvas 的 font 简写解析在无头环境里
# 有时会静默回退到默认字体，量出来两边一模一样，看起来像「字体没换」。
MEASURE_TEXT = """(font) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;' +
    'white-space:nowrap;font:400 32px ' + font;
  d.textContent = '设置字体仓库提交 Issue';
  document.body.appendChild(d);
  const w = d.getBoundingClientRect().width;
  d.remove();
  return Math.round(w * 100) / 100;
}"""


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
        pg.wait_for_timeout(700)
        pg.click('.who-btn')
        pg.wait_for_timeout(300)
        pg.click('text=添加账号')
        pg.wait_for_timeout(400)
        pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
        pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
        pg.click('text=加密保存')
        pg.wait_for_timeout(3500)
        pg.wait_for_selector('.rows .row', timeout=25000)

        # ── 1. 默认必须是 OPPO Sans，且字体文件真的下来了 ──
        font = pg.evaluate("""async () => {
          const t0 = performance.now()
          await document.fonts.load('400 14px "OPPO Sans"', '设置字体')
          const cost = Math.round(performance.now() - t0)
          const hit = performance.getEntriesByType('resource')
            .filter((e) => e.name.endsWith('.ttf'))
            .map((e) => ({ name: e.name.split('/').pop(),
                           size: Math.round(e.transferSize / 1048576 * 10) / 10,
                           ms: Math.round(e.duration) }))
          return { cost, hit, ok: document.fonts.check('400 14px "OPPO Sans"') }
        }""")
        assert font['ok'], 'OPPO Sans 没加载成功'
        assert font['hit'], f'没有发出字体请求：{font}'
        print(f'[1] 字体已加载：{font["hit"][0]["name"]} · '
              f'{font["hit"][0]["size"]} MB · 首次就绪 {font["cost"]} ms · '
              f'请求耗时 {font["hit"][0]["ms"]} ms')

        w_sans = pg.evaluate(MEASURE_TEXT, '"OPPO Sans", sans-serif')
        w_sys = pg.evaluate(MEASURE_TEXT, 'system-ui, sans-serif')
        faces = pg.evaluate("""() => [...document.fonts].map((f) =>
          `${f.family}/${f.weight}/${f.status}`)""")
        print(f'[2] 同一串字宽度：OPPO Sans {w_sans}px / 系统字体 {w_sys}px · 已注册 {faces}')
        assert abs(w_sans - w_sys) > 0.5, f'两种字体宽度一样，可能没真换：{w_sans} vs {w_sys}'
        pg.screenshot(path=f'{OUT}/font-086-sans.png')

        # ── 3. 去设置里切到系统字体 ──
        pg.click('.avatar-btn')
        pg.wait_for_timeout(800)
        pg.click('text=设置')
        pg.wait_for_timeout(900)
        seg = pg.locator('.section-title:has-text("外观") + .panel .seg').last
        btn_sys = pg.locator('button:has-text("系统字体")')
        btn_sans = pg.locator('button:has-text("OPPO Sans")')
        assert btn_sys.count() == 1, f'没找到系统字体按钮：{btn_sys.count()}'
        btn_sys.first.scroll_into_view_if_needed()
        pg.wait_for_timeout(500)
        pg.screenshot(path=f'{OUT}/font-086-settings.png')
        btn_sys.first.click()
        pg.wait_for_timeout(700)

        cur = pg.evaluate("document.documentElement.dataset.font")
        assert cur == 'system', f'切了但 data-font 是 {cur}'
        fam = pg.evaluate("getComputedStyle(document.body).fontFamily")
        assert 'OPPO Sans' not in fam, f'切了系统字体，body 字体族还带着 OPPO Sans：{fam}'
        print(f'[3] 已切系统字体：data-font={cur} · body 字体族={fam[:46]}…')

        # ── 4. 刷新后仍然是系统字体（首屏内联脚本读的就是它） ──
        pg.reload()
        pg.wait_for_timeout(1200)
        after = pg.evaluate("document.documentElement.dataset.font")
        assert after == 'system', f'刷新后字体偏好丢了：{after}'
        pg.wait_for_selector('.rows .row', timeout=20000)
        pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/font-086-system.png')
        print(f'[4] 刷新后仍是 {after}，列表页已截图用于对照')

        # ── 5. 切回 OPPO Sans ──
        pg.click('.avatar-btn')
        pg.wait_for_timeout(700)
        pg.click('text=设置')
        pg.wait_for_timeout(900)
        pg.locator('button:has-text("OPPO Sans")').first.scroll_into_view_if_needed()
        pg.wait_for_timeout(400)
        pg.click('button:has-text("OPPO Sans")')
        pg.wait_for_timeout(700)
        back = pg.evaluate("document.documentElement.dataset.font")
        fam2 = pg.evaluate("getComputedStyle(document.body).fontFamily")
        assert back == 'sans', f'切回失败：{back}'
        assert 'OPPO Sans' in fam2, f'切回后字体族里没有 OPPO Sans：{fam2}'
        print(f'[5] 已切回：data-font={back} · body 字体族={fam2[:40]}…')
        pg.screenshot(path=f'{OUT}/font-086-settings-sans.png')

        b.close()
    print('全部通过')


if __name__ == '__main__':
    main()
