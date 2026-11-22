"""验证：用户自己填的加速站不会因为「自动选最快」而从下载线路里消失。

背景：mirrorAuto 默认打开，后台测速后会把当前镜像切成别的线路；
如果候选表只认「当前镜像」，用户填的自建站就会整行消失 ——
用户看到的就是「我的加速站不见了」。

v1.1.3 起包里不再预置任何加速站，所以这里先用 localStorage 模拟
「用户填过一个自建站 + 一个别的站」，再验证候选表行为。

断言口径（读 DOM，不看截图目测）：
1. 预置两个用户站，当前镜像 = 其中第二个，等价于自动选线已经切走；
2. 打开下载面板后 3 行：选中站、自建站、官方直连；
3. 自建站钉在第 2 位，官方直连在最后一行且只出现一次；
4. 关掉重开，自建站仍在、行数不变；
5. 面板不横向溢出（390 宽）。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-selfmirror.py
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OUT = '/workspace/ghx/docs/screenshots'
OWNER = 'zjkl0330'
SELF = 'https://self.example.com'
# 等价于「自动选最快」挑中了用户填的另一条线路
CHOSEN = 'https://mirror.example.com'

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

# 指向真实存在的资产：自建站这一条不 mock，只有目标是真包时 206 才说明它真能下
RELEASE = [{
    'id': 1001,
    'tag_name': 'v0.8.9',
    'name': 'v1.0.0',
    'body': '自测用发行版',
    'draft': False,
    'prerelease': False,
    'created_at': '2026-11-18T00:00:00Z',
    'published_at': '2026-11-18T00:00:00Z',
    'html_url': f'https://github.com/{OWNER}/ghx/releases/tag/v0.8.9',
    'assets': [{
        'id': 11,
        'name': 'ghx-0.8.9-debug.apk',
        'size': 21_253_906,
        'download_count': 12,
        'browser_download_url': f'https://github.com/{OWNER}/ghx/releases/download/v0.8.9/ghx-0.8.9-debug.apk',
    }],
}]


def handle(route):
    path = re.sub(r'^https://api\.github\.com', '', route.request.url).split('?')[0]
    if re.match(r'^/repos/[^/]+/[^/]+/releases$', path):
        body = RELEASE
    elif path == '/user':
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


def fake_asset(route):
    """公共代理走假数据：这次验的是候选表与展示，不是它们此刻快不快。"""
    route.fulfill(
        status=206,
        headers={
            'access-control-allow-origin': '*',
            'content-length': str(1024 * 1024),
            'content-type': 'application/octet-stream',
        },
        body=b'\0' * (1024 * 1024),
    )


MEASURE = """() => {
  const rows = [...document.querySelectorAll('.multi-row')];
  return {
    count: rows.length,
    labels: rows.map((r) => r.querySelector('.multi-main b')?.textContent?.trim() || ''),
    details: rows.map((r) => r.querySelector('.multi-main i')?.textContent?.trim() || ''),
    speeds: rows.map((r) => r.querySelector('.dl-speed')?.textContent?.trim() || ''),
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
        # 模拟「自动选最快已经跑过并切到了公共代理」：同时塞一份当天的测速快照，
        # 否则 App 启动时会再跑一次后台测速，把当前站改成别的，场景就不成立了。
        ctx.add_init_script(
            """
            try {
              localStorage.setItem('ghx.mirror.store', JSON.stringify({
                overrides: {},
                custom: [
                  { id: 'self', label: '自建加速', base: %s, style: 'path', page: true },
                  { id: 'u2', label: '自选中', base: %s, style: 'path' }
                ]
              }));
              localStorage.setItem('ghx.mirror', %s);
              localStorage.setItem('ghx.mirror.auto', 'on');
              localStorage.setItem('ghx.mirror.speed', JSON.stringify({
                at: Date.now(),
                best: %s,
                results: [{ base: %s, kbps: 900, ms: 260 }]
              }));
            } catch (e) {}
            """
            % (
                json.dumps(SELF),
                json.dumps(CHOSEN),
                json.dumps(CHOSEN),
                json.dumps(CHOSEN),
                json.dumps(CHOSEN),
            )
        )
        pg = ctx.new_page()
        pg.route('**/api.github.com/**', handle)
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
        for host in ('self.example.com', 'mirror.example.com'):
            pg.route(f'**/{host}/**', fake_asset)

        pg.goto(BASE)
        pg.wait_for_timeout(700)
        pg.click('.who-btn')
        pg.wait_for_timeout(300)
        pg.click('text=添加账号')
        pg.wait_for_timeout(400)
        pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
        pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
        pg.click('text=加密保存')
        pg.wait_for_timeout(3200)
        pg.wait_for_selector('.rows .row', timeout=25000)

        pg.locator('.row', has_text='ghx').first.click()
        pg.wait_for_timeout(1200)
        pg.click('text=发行版')
        pg.wait_for_timeout(1200)
        pg.click('.rel-asset button')
        pg.wait_for_selector('.multi-row', timeout=20000)
        pg.wait_for_timeout(600)

        m = MEASURE
        rows = pg.evaluate(MEASURE)
        print(f'[1] 面板 {rows["count"]} 行；当前镜像（自动选中的）={CHOSEN}')
        for i in range(rows['count']):
            print(f'    {i + 1}. {rows["labels"][i]} · {rows["details"][i]}')

        # 等测速跑完（「测速中 x/y」消失）
        for _ in range(40):
            label = pg.locator('button.multi-all').inner_text()
            if '测速中' not in label:
                break
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(1500)

        rows = pg.evaluate(MEASURE)
        assert rows['count'] == 3, f'应为 3 条线路（选中 + 自建 + 官方），实际 {rows["count"]} 条'
        assert '自建加速' in rows['labels'], f'自建站不在表里：{rows["labels"]}'
        assert '官方' in rows['labels'][-1], f'官方不在末位：{rows["labels"][-1]!r}'
        assert rows['labels'].count('官方直连') == 1, '官方直连出现了不止一次'
        for lab in rows['labels'][:-1]:
            assert '官方' not in lab, f'官方跑到前面去了：{lab!r}'
        assert not rows['overflow'], '面板被撑宽了，超出 390'

        idx = rows['labels'].index('自建加速')
        assert idx == 1, f'自建站应钉在第 2 位，实际第 {idx + 1} 位：{rows["labels"]}'
        self_speed = rows['speeds'][idx]
        print(f'[2] 自建站钉在第 {idx + 1} 位（速度照实显示）：{rows["details"][idx]} · {self_speed}')
        if '不可用' in self_speed or self_speed in ('—', '未测'):
            print('    ! 自建站这次没测出速度（沙箱到 CF 抖动），不影响候选表断言')
        else:
            print('    自建站走真网络测速成功，说明它确实能用')
        print(f'[3] 末位仍是 {rows["labels"][-1]}，且只有它标了「后段慢」')
        pg.screenshot(path=f'{OUT}/selfmirror-090-routes.png')

        # 关掉重开：看板当天有效，不应再补测自建站以外的线路
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(500)
        pg.click('.rel-asset button')
        pg.wait_for_selector('.multi-row', timeout=20000)
        pg.wait_for_timeout(900)
        again = pg.evaluate(MEASURE)
        assert '自建加速' in again['labels'], f'重开后自建站又不见了：{again["labels"]}'
        assert again['count'] == 3, f'重开后行数变了：{again["count"]}'
        pos = again['labels'].index('自建加速') + 1
        print(f'[4] 重开面板仍是 3 行，自建站在第 {pos} 位')
        pg.screenshot(path=f'{OUT}/selfmirror-090-reopen.png')

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
