"""验证「剪贴板直达」：把地址放进剪贴板，触发切回前台，看是否真的跳过去。

依赖：`npx vite preview --port 4173`，playwright，xvfb。
    xvfb-run -a python3 scripts/verify-clip.py

断言口径：
- 跳转看顶栏标题（仓库页是仓库名，Issue 页是 `#编号`），不看列表里的同名文字；
- 去重看「第二次触发后不再出现提示」；
- 令牌内容必须一句不跳；
- 关掉开关后必须不跳。
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

ISSUE = {
    'number': 12,
    'title': '剪贴板直达：从浏览器复制过来就能跳',
    'state': 'open',
    'body': '检验用的一条 Issue。',
    'user': {'login': OWNER, 'avatar_url': ''},
    'labels': [],
    'assignees': [],
    'comments': 0,
    'created_at': '2026-11-10T08:00:00Z',
    'updated_at': '2026-11-10T08:00:00Z',
    'html_url': f'https://github.com/{OWNER}/clist-cf/issues/12',
}


def handle(route):
    url = route.request.url
    path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]
    if path == '/user':
        body = USER
    elif path == '/user/repos':
        body = [REPO]
    elif path == '/notifications':
        body = []
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}}
    elif path == f'/repos/{OWNER}/clist-cf/issues/12':
        body = ISSUE
    elif path == f'/repos/{OWNER}/clist-cf/issues/12/comments':
        body = []
    elif path.startswith('/users/'):
        segs = path.strip('/').split('/')
        body = USER if len(segs) == 2 else []
    elif path == f'/repos/{OWNER}/clist-cf':
        body = {k: v for k, v in REPO.items()}
    elif '/contents' in path or path.endswith('/branches') or path.endswith('/commits'):
        # contents 既可能是 `/contents` 也可能是 `/contents/src/lib`，
        # 真实接口对目录一律返回数组，形状给错会把代码页的渲染打崩
        body = []
    elif path.endswith('/readme'):
        body = {}
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


def titles(pg):
    return [t.strip() for t in pg.locator('.page-title').all_inner_texts() if t.strip()]


def toast_text(pg):
    """当前提示语；没弹层时返回空串"""
    n = pg.locator('.toast, .snack, .tipbar').count()
    if n == 0:
        return ''
    return ' '.join(pg.locator('.toast, .snack, .tipbar').all_inner_texts()).strip()


def put_clip(pg, text):
    pg.evaluate('(t) => navigator.clipboard.writeText(t)', text)


def fire_resume(pg):
    """切回前台：@capacitor/app 的 Web 实现就是监听 visibilitychange。"""
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))")


def back_home(pg):
    """一路返回到主界面：跳转是压栈的，从 Issue 回来要退两层"""
    for _ in range(8):
        if pg.locator('.avatar-btn').count() > 0:
            return
        btn = pg.locator('.topbar .icon-btn[aria-label="返回"]')
        if btn.count() == 0:
            return
        btn.first.click()
        pg.wait_for_timeout(400)
    raise AssertionError('退不回主界面')


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
        pg = ctx.new_page()
        pg.route('**/api.github.com/**', handle)
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())

        pg.goto(BASE)
        pg.wait_for_timeout(700)

        # 首次导入令牌，让保险库自己加密落盘
        pg.click('.who-btn')
        pg.wait_for_timeout(300)
        pg.click('text=添加账号')
        pg.wait_for_timeout(400)
        pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
        pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
        pg.click('text=加密保存')
        pg.wait_for_timeout(3500)
        pg.wait_for_selector('.rows .row', timeout=20000)
        assert 'clist-cf' in pg.inner_text('.rows'), '仓库列表没渲染出来'

        # ── 1. 冷启动路径：清掉提示后用 resume 触发，断言跳转与提示 ──
        put_clip(pg, 'https://github.com/zjkl0330/clist-cf')
        fire_resume(pg)
        pg.wait_for_timeout(900)
        t1 = titles(pg)
        assert 'clist-cf' in t1, f'没有跳到仓库页：{t1}'
        box = toast_text(pg)
        assert '剪贴板打开' in box and 'zjkl0330/clist-cf' in box, f'提示语不对：{box!r}'
        pg.screenshot(path=f'{OUT}/clip-080-jump.png')
        print(f'[1] 跳转成功：{t1} · 提示「{box}」')

        # ── 2. 同一条内容不再跳 ──
        pg.wait_for_timeout(3200)  # 等提示自己消失，避免误读上一条
        before = titles(pg)
        fire_resume(pg)
        pg.wait_for_timeout(900)
        after = titles(pg)
        assert after == before, f'重复触发了跳转：{before} → {after}'
        assert toast_text(pg) == '', f'重复触发仍弹提示：{toast_text(pg)!r}'
        print(f'[2] 同一条去重生效，页面停在 {after}')

        # ── 3. 换成 Issue 链接 ──
        put_clip(pg, '看看这个 https://github.com/zjkl0330/clist-cf/issues/12 挺有用')
        fire_resume(pg)
        pg.wait_for_timeout(1200)
        t3 = titles(pg)
        assert '#12' in t3, f'没有跳到 Issue：{t3}'
        print(f'[3] Issue 链接落到 {t3}')

        # ── 3b. tree 链接落到代码目录 ──
        pg.wait_for_timeout(2600)
        put_clip(pg, 'https://github.com/zjkl0330/clist-cf/tree/main/src/lib')
        fire_resume(pg)
        pg.wait_for_timeout(1400)
        t3b = titles(pg)
        assert any('lib' in x for x in t3b), f'没有跳到代码页：{t3b}'
        print(f'[3b] 代码目录链接落到 {t3b}')

        # ── 3c. 个人主页地址落到用户页 ──
        pg.wait_for_timeout(2600)
        put_clip(pg, 'https://github.com/zjkl0330')
        fire_resume(pg)
        pg.wait_for_timeout(1400)
        t3c = titles(pg)
        assert '@zjkl0330' in t3c, f'没有跳到个人主页：{t3c}'
        print(f'[3c] 个人主页链接落到 {t3c}')

        # ── 4. 令牌内容一句不跳 ──
        pg.wait_for_timeout(2600)
        put_clip(pg, 'ghp_' + 'a' * 36 + ' https://github.com/zjkl0330/esp32-wol')
        fire_resume(pg)
        pg.wait_for_timeout(1000)
        t4 = titles(pg)
        assert t4 == t3c, f'令牌内容被当成链接了：{t3c} → {t4}'
        assert toast_text(pg) == '', f'令牌内容弹了提示：{toast_text(pg)!r}'
        print(f'[4] 令牌内容被忽略，页面仍是 {t4}')

        # ── 5. 关掉开关后不再读 ──
        back_home(pg)
        pg.click('.avatar-btn')
        pg.wait_for_timeout(800)
        pg.click('text=设置')
        pg.wait_for_timeout(700)
        seg = pg.locator('.section-title:has-text("打开方式") + .panel .seg button')
        assert seg.count() == 2, f'没找到剪贴板开关：{seg.count()}'
        assert seg.nth(0).get_attribute('class') == 'on', '默认应当是开启'
        seg.nth(0).scroll_into_view_if_needed()
        pg.wait_for_timeout(400)
        pg.screenshot(path=f'{OUT}/clip-080-settings.png')
        seg.nth(1).click()
        pg.wait_for_timeout(500)
        assert 'on' in (seg.nth(1).get_attribute('class') or ''), '点关闭后状态没变'
        print('[5] 开关已切到关闭')

        # 换一条没跳过的地址，关闭后应当纹丝不动
        back_home(pg)
        before = titles(pg)
        put_clip(pg, 'https://github.com/zjkl0330/esp32-wol')
        fire_resume(pg)
        pg.wait_for_timeout(1200)
        after = titles(pg)
        assert after == before, f'关闭开关后仍然跳了：{before} → {after}'
        print(f'[6] 关闭后不再跳，页面停在 {after}')

        # ── 7. 重新开启 + 冷启动：清掉去重指纹，整页重载后应当自动跳 ──
        pg.click('.avatar-btn')
        pg.wait_for_timeout(800)
        pg.click('text=设置')
        pg.wait_for_timeout(700)
        seg.nth(0).click()
        pg.wait_for_timeout(500)
        assert 'on' in (seg.nth(0).get_attribute('class') or ''), '重新开启失败'
        back_home(pg)

        pg.evaluate(
            "Object.keys(localStorage).filter(k=>k.includes('ghx.clip.seen'))"
            '.forEach(k=>localStorage.removeItem(k))'
        )
        put_clip(pg, 'https://github.com/zjkl0330/esp32-wol')
        pg.reload()
        pg.wait_for_selector('.rows .row', timeout=20000)
        pg.wait_for_timeout(1800)
        t7 = titles(pg)
        assert 'esp32-wol' in t7, f'冷启动没有自动跳：{t7}'
        print(f'[7] 冷启动自动跳转：{t7}')

        b.close()
    print('全部通过')


if __name__ == '__main__':
    main()
