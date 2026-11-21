"""验证两件事：下载线路的数量与「官方垫底」，以及仓库行的 APK/EXE 标记。

依赖：`npx vite preview --port 4173`，playwright，xvfb。
    xvfb-run -a python3 scripts/verify-dl.py

断言口径（读 DOM 与 computed style，不靠截图目测）：
1. 线路表 ≥5 条，官方直连是最后一条，且副标题写明「长时段偏慢」；
2. 测速跑完后官方仍然不是第一条（不依赖测速是否成功：失败的线路沉底）；
3. 点选线路只做高亮不重排（列表顺序不变，选中行有且只有一个 on）；
4. 有安装包的仓库行出现 APK / EXE 徽标，没包的仓库行不出现。
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
        'id': i,
        'name': f'repo-{i:02d}',
        'full_name': f'{OWNER}/repo-{i:02d}',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': False,
        'visibility': 'public',
        'archived': False,
        'disabled': False,
        'description': '一行足够长的简介，用来验证列表排版是否还稳。' * 2,
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


def asset(i, name, size):
    return {
        'id': i, 'name': name, 'size': size, 'download_count': 12,
        'browser_download_url': f'https://github.com/{OWNER}/repo-01/releases/download/v1/{name}',
    }


def release_for(repo_name):
    """按仓库决定它的发行版里有什么包：前三个 APK，四五两个 EXE，其余纯源码。"""
    n = int(repo_name.split('-')[1])
    if n <= 3:
        assets = [asset(n, f'{repo_name}-v1.apk', 4_392_600)]
    elif n <= 5:
        assets = [asset(n, f'{repo_name}-setup.exe', 12_000_000)]
    else:
        assets = [asset(n, f'{repo_name}-v1-src.tar.gz', 900_000)]
    return [{
        'id': 1000 + n,
        'tag_name': 'v1.0.0',
        'name': 'v1.0.0',
        'body': '自测用发行版',
        'draft': False,
        'prerelease': False,
        'created_at': '2026-11-01T00:00:00Z',
        'published_at': '2026-11-01T00:00:00Z',
        'html_url': f'https://github.com/{OWNER}/{repo_name}/releases/tag/v1.0.0',
        'assets': assets,
    }]


COUNTER = {'releases': 0}


def handle(route):
    url = route.request.url
    path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]

    m = re.match(r'^/repos/[^/]+/([^/]+)/releases$', path)
    if m:
        COUNTER['releases'] += 1
        body = release_for(m.group(1))
    elif path == '/user':
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
        body=json.dumps(body),
    )


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

        pg.click('.who-btn')
        pg.wait_for_timeout(300)
        pg.click('text=添加账号')
        pg.wait_for_timeout(400)
        pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
        pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
        pg.click('text=加密保存')
        pg.wait_for_timeout(3200)
        pg.wait_for_selector('.rows .row', timeout=20000)

        # ── 1. APK / EXE 徽标 ──
        pg.wait_for_selector('.badge.pkg', timeout=30000)
        pg.wait_for_timeout(1500)
        apk = pg.locator('.row:has(.badge.pkg.apk)')
        exe = pg.locator('.row:has(.badge.pkg.exe)')
        n_apk, n_exe = apk.count(), exe.count()
        print(f'APK 徽标 {n_apk} 行，EXE 徽标 {n_exe} 行，请求了 {COUNTER["releases"]} 次 /releases')
        assert 3 <= n_apk <= 4, f'有 APK 的仓库应为 3 个，实际 {n_apk}'
        assert n_exe == 2, f'有 EXE 的仓库应为 2 个，实际 {n_exe}'

        first_apk_text = apk.first.inner_text()
        assert 'APK' in first_apk_text, f'徽标文本不对：{first_apk_text!r}'
        # 没有安装包的仓库（repo-10）不该出现徽标
        plain = pg.locator('.row', has_text='repo-10')
        assert plain.locator('.badge.pkg').count() == 0, 'repo-10 没有安装包，却出现了徽标'
        # 徽标必须紧跟在 Public 后面，不能跑到行尾
        order = pg.evaluate("""() => {
          const row = document.querySelector('.row:has(.badge.pkg.apk)');
          const kids = [...row.querySelectorAll('.row-l1 > *')].map(el => el.className);
          return kids;
        }""")
        print('行首标记顺序：', order)
        assert order.index('badge pkg apk') == 2, f'APK 徽标应在 Public 之后，实际顺序 {order}'
        pg.screenshot(path=f'{OUT}/badge-pkg-083.png')

        # ── 2. 下载线路与官方垫底 ──
        pg.locator('.row', has_text='repo-01').first.click()
        pg.wait_for_timeout(1200)
        pg.click('text=发行版')
        pg.wait_for_timeout(1200)
        pg.click('.rel-asset button')
        pg.wait_for_selector('.multi-row', timeout=20000)
        pg.wait_for_timeout(800)

        rows = pg.locator('.multi-row')
        n = rows.count()
        texts = [rows.nth(i).inner_text().replace('\n', ' ') for i in range(n)]
        print('线路表：')
        for i, t in enumerate(texts):
            print(f'  {i + 1}. {t}')
        assert n >= 5, f'线路只有 {n} 条'
        last = texts[-1]
        assert '官方' in last, f'最后一条不是官方直连：{last!r}'
        assert '后段慢' in last, f'官方线路没有写明慢在哪：{last!r}'
        for t in texts[:-1]:
            assert '官方' not in t, f'官方直连跑到前面去了：{t!r}'

        # 等测速跑完：按钮从「测速中 x/y」变回「重新测速」。最多等 90s ——
        # 这几条线路在沙箱里可能全 404（mock 的仓库并不存在），失败也算测完。
        for _ in range(90):
            label = pg.locator('button.multi-all').inner_text()
            if '测速中' not in label:
                break
            pg.wait_for_timeout(1000)
        pg.wait_for_timeout(2000)
        after = [pg.locator('.multi-row').nth(i).inner_text().replace('\n', ' ')
                 for i in range(pg.locator('.multi-row').count())]
        print('测速后第一行：', after[0])
        assert '官方' not in after[0], f'测速后官方被选成第一条：{after[0]!r}'
        pg.screenshot(path=f'{OUT}/dl-routes-083.png')

        # ── 3. 点选线路不重排：只高亮，不跳动 ──
        before_click = [pg.locator('.multi-row').nth(i).locator('b').inner_text()
                        for i in range(pg.locator('.multi-row').count())]
        # 点倒数第二行（肯定不是第一行），看列表有没有把它挪到顶部
        target_idx = len(before_click) - 2
        target_label = before_click[target_idx]
        pg.locator('.multi-row').nth(target_idx).click()
        pg.wait_for_timeout(400)
        after_click = [pg.locator('.multi-row').nth(i).locator('b').inner_text()
                       for i in range(pg.locator('.multi-row').count())]
        assert after_click == before_click, (
            f'点选后列表被重排了：前 {before_click[:3]}… 后 {after_click[:3]}…'
        )
        on_rows = pg.locator('.multi-row.on')
        assert on_rows.count() == 1, f'应有且只有一行高亮，实际 {on_rows.count()} 行'
        assert target_label in on_rows.first.inner_text(), (
            f'高亮的应是刚点的那条（{target_label}），实际：{on_rows.first.inner_text()!r}'
        )
        print(f'点选第 {target_idx + 1} 行（{target_label}）：列表顺序不变，仅该行高亮')
        pg.screenshot(path=f'{OUT}/dl-picked-0910.png')

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
