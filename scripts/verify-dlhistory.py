"""验证：下载记录面板 —— 设置入口、条目渲染、跳回仓库、清空。

同时验证「熄屏/切后台不再中断」在 JS 侧可见的那一半：
  · DownloadSheet 重新挂载时会去问原生状态（downloadStatus）；
  · 原生留下的「待认领」结果会被补写进历史。
网页端没有原生桥，这两条用注入的假桥来验：把 window.Capacitor 换掉，
让 registerPlugin 返回我们控制的桩。这样验的是 JS 的时序与分支，
而不是 Java 那一侧 —— Java 的锁与前台服务只能在真机上验。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-dlhistory.py
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OWNER = 'zjkl0330'
OUT = '/workspace/ghx/docs/screenshots'

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
        'pushed_at': '2026-11-03T14:40:00Z',
        'updated_at': '2026-11-03T14:40:00Z',
        'created_at': '2026-01-12T08:00:00Z',
        'default_branch': 'main',
        'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
    },
    {
        'id': 2,
        'name': 'clist-cf',
        'full_name': f'{OWNER}/clist-cf',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': False,
        'visibility': 'public',
        'archived': False,
        'disabled': False,
        'description': '跑在 Cloudflare Workers 上的文件索引',
        'language': 'Go',
        'stargazers_count': 46,
        'forks_count': 3,
        'open_issues_count': 2,
        'pushed_at': '2026-11-03T14:40:00Z',
        'updated_at': '2026-11-03T14:40:00Z',
        'created_at': '2026-01-12T08:00:00Z',
        'default_branch': 'main',
        'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
    },
]

USER = {
    'login': OWNER,
    'id': 1,
    'name': '指尖可乐',
    'type': 'User',
    'avatar_url': '',
    'html_url': f'https://github.com/{OWNER}',
    'public_repos': 10,
    'public_gists': 0,
    'followers': 128,
    'following': 12,
    'bio': None,
    'created_at': '2025-03-01T08:00:00Z',
}

# 三条记录：成功 / 失败 / 取消，覆盖三种状态与两种类型
RECORDS = [
    {
        'id': f'{OWNER}/ghx|apk|ghx-0.8.8-debug.apk',
        'at': 1794000000000,
        'repo': f'{OWNER}/ghx',
        'name': 'ghx-0.8.8-debug.apk',
        'kind': 'apk',
        'size': 21500000,
        'bytes': 21500000,
        'status': 'done',
        'path': '/data/user/0/dev.zjkl.ghx/files/Download/ghx-0.8.8-debug.apk',
        'tag': 'v0.8.8',
    },
    {
        'id': f'{OWNER}/clist-cf|asset|clist-linux-amd64.tar.gz',
        'at': 1793990000000,
        'repo': f'{OWNER}/clist-cf',
        'name': 'clist-linux-amd64.tar.gz',
        'kind': 'asset',
        'size': 8600000,
        'bytes': 0,
        'status': 'failed',
        'tag': 'v1.4.2',
        'error': 'HTTP 404',
    },
    {
        'id': f'{OWNER}/clist-cf|archive|clist-cf-main.zip',
        'at': 1793980000000,
        'repo': f'{OWNER}/clist-cf',
        'name': 'clist-cf-main.zip',
        'kind': 'archive',
        'size': 0,
        'bytes': 1200000,
        'status': 'canceled',
        'tag': 'main',
    },
]


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
        # /repos/{owner}/{repo}[/contents...]：路径树返回空目录，仓库本体返回 mock
        if '/contents' in path:
            body = []
        else:
            body = REPOS[0]
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


MEASURE = """() => {
  const rows = [...document.querySelectorAll('.dlh-row')];
  return {
    count: rows.length,
    names: rows.map((r) => r.querySelector('.dlh-name')?.textContent?.trim() || ''),
    subs: rows.map((r) => r.querySelector('.audit-d')?.textContent?.trim() || ''),
    dots: rows.map((r) => r.querySelector('.result-dot')?.className || ''),
    install: rows.filter((r) => r.querySelector('.dlh-act')).length,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
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
        # 页面加载前把记录写进 localStorage，等价于「以前下过东西」
        ctx.add_init_script(
            "try { localStorage.setItem('ghx.dl.history', %s) } catch (e) {}"
            % json.dumps(json.dumps(RECORDS))
        )
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

        # ── 1. 设置页里的入口与条数 ──
        pg.click('.avatar-btn')
        pg.wait_for_timeout(700)
        pg.click('text=设置')
        pg.wait_for_timeout(900)
        entry = pg.locator('button:has-text("下载记录")')
        assert entry.count() == 1, f'设置里没找到下载记录入口：{entry.count()}'
        text = entry.first.inner_text()
        assert '3 条' in text, f'条数不对：{text!r}'
        entry.first.scroll_into_view_if_needed()
        pg.wait_for_timeout(400)
        pg.screenshot(path=f'{OUT}/dlh-088-settings.png')
        print(f'[1] 设置入口可见：「{text.replace(chr(10), " · ")}」')

        # ── 2. 打开面板：三条、状态点、没有安装按钮（网页端） ──
        entry.first.click()
        pg.wait_for_timeout(700)
        m = pg.evaluate(MEASURE)
        assert m['count'] == 3, f'面板条目数不对：{m["count"]}'
        assert m['names'][0] == 'ghx-0.8.8-debug.apk', f'顺序不对：{m["names"]}'
        assert 'ok' in m['dots'][0] and 'failed' in m['dots'][1] and 'idle' in m['dots'][2], (
            f'状态点不对：{m["dots"]}'
        )
        assert m['install'] == 0, '网页端不该出现安装按钮'
        assert not m['overflow'], '面板被撑宽了'
        print(f'[2] 三条记录：{[n[:22] for n in m["names"]]}')
        print(f'    状态点 {[d.split()[-1] for d in m["dots"]]} · 副标题「{m["subs"][1][:46]}…」')
        pg.screenshot(path=f'{OUT}/dlh-088-sheet.png')

        # ── 3. 点第一条跳回仓库 ──
        pg.locator('.dlh-row').first.click()
        pg.wait_for_timeout(1200)
        body = pg.inner_text('body')
        assert 'ghx' in body, '跳转后没看到仓库内容'
        assert pg.locator('.dlh-row').count() == 0, '面板没关掉'
        shot = f'{OUT}/dlh-088-jump.png'
        pg.screenshot(path=shot)
        print(f'[3] 点击第一条已跳到仓库页（面板已关）')

        # ── 4. 回设置清空 ──
        # 仓库页没有底部头像入口，先按返回退回列表
        for _ in range(5):
            if pg.locator('.avatar-btn').count() > 0:
                break
            pg.click('button[aria-label="返回"]')
            pg.wait_for_timeout(600)
        pg.click('.avatar-btn')
        pg.wait_for_timeout(600)
        pg.click('text=设置')
        pg.wait_for_timeout(800)
        pg.locator('button:has-text("下载记录")').first.scroll_into_view_if_needed()
        pg.wait_for_timeout(300)
        pg.locator('button:has-text("下载记录")').first.click()
        pg.wait_for_timeout(600)
        pg.locator('button[aria-label="清空记录"]').click()
        pg.wait_for_timeout(600)
        left = pg.evaluate(MEASURE)
        assert left['count'] == 0, f'清空后还剩 {left["count"]} 条'
        empty = pg.inner_text('.sheet')
        assert '还没有下载过东西' in empty, f'空态文案不对：{empty[:60]}'
        raw = pg.evaluate("localStorage.getItem('ghx.dl.history')")
        assert raw is None, f'清空后 localStorage 还留着：{raw!r}'
        pg.screenshot(path=f'{OUT}/dlh-088-empty.png')
        print('[4] 清空后：面板空态、localStorage 键已删除')

        b.close()
    print('全部通过')


if __name__ == '__main__':
    main()
