"""验证：归档仓库在列表里找得到。

以前 `App.tsx` 把 `includeArchived` 写死成 false，界面上也没有第四档 ——
归档一个仓库就等于把它弄丢了，想取消归档只能去 GitHub 网页。这一层要证：

  · 有归档仓库时，分段控件多出「归档 N」一档，N 与实际条数一致；
  · 「全部」不含归档，且 公开 + 私有 = 全部（数字必须自洽）；
  · 切到归档档后，列表里只剩归档仓库，每行带 Archived 徽章；
  · 一个归档都没有时，第四档根本不出现（不占地方、不误导）；
  · 390 宽下四段不溢出。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-archived.py
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OUT = '/workspace/ghx/docs/screenshots'
OWNER = 'zjkl0330'


def mk(repo_id, name, private, archived, desc='示例仓库'):
    return {
        'id': repo_id,
        'name': name,
        'full_name': f'{OWNER}/{name}',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': private,
        'visibility': 'private' if private else 'public',
        'archived': archived,
        'disabled': False,
        'description': desc,
        'language': 'TypeScript',
        'stargazers_count': repo_id,
        'forks_count': 0,
        'open_issues_count': 0,
        'pushed_at': '2026-11-18T10:00:00Z',
        'updated_at': '2026-11-18T10:00:00Z',
        'created_at': '2025-06-01T08:00:00Z',
        'default_branch': 'main',
        'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
    }


# 4 个在用 + 2 个归档（1 公开 1 私有）
REPOS = [
    mk(1, 'ghx', False, False, '一个 GitHub 客户端'),
    mk(2, 'niuma', False, False, '自动化工具'),
    mk(3, 'vault', True, False, '令牌保险库'),
    mk(4, 'dsh', True, False, '工作台'),
    mk(5, 'old-blog', False, True, '早就停更的博客'),
    mk(6, 'legacy-api', True, True, '归档的旧接口'),
]

NO_ARCHIVE = [r for r in REPOS if not r['archived']]

USER = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
    'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
    'public_repos': 4, 'public_gists': 0, 'followers': 128, 'following': 12,
    'bio': None, 'company': None, 'location': None, 'blog': None,
    'created_at': '2025-03-01T08:00:00Z',
}

STATE = {'repos': REPOS}


def handle(route):
    path = re.sub(r'^https://api\.github\.com', '', route.request.url).split('?')[0]
    method = route.request.method

    # PATCH /repos/{owner}/{repo} 改归档状态：让 mock 真的记住，
    # 否则「归档完能在归档档里找到」这条根本测不了
    if method == 'PATCH' and path.startswith('/repos/'):
        body_json = json.loads(route.request.post_data or '{}')
        name = path.strip('/').split('/')[2]
        for r in STATE['repos']:
            if r['name'] == name:
                if 'archived' in body_json:
                    r['archived'] = bool(body_json['archived'])
                if 'private' in body_json:
                    r['private'] = bool(body_json['private'])
                    r['visibility'] = 'private' if r['private'] else 'public'
                target = r
                break
        else:
            target = {}
        route.fulfill(
            status=200,
            content_type='application/json',
            headers={'access-control-allow-origin': '*'},
            body=json.dumps(target),
        )
        return

    if path == '/user':
        body = USER
    elif path in ('/user/repos', '/user/starred'):
        body = STATE['repos']
    elif path == '/notifications':
        body = []
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}}
    elif path.startswith('/repos/'):
        body = STATE['repos'][0] if '/contents' not in path else []
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
    pg.wait_for_selector('.rows .row', timeout=25000)


MEASURE = """() => {
  const de = document.documentElement;
  const seg = [...document.querySelectorAll('.segrow .seg button')].map((b) => b.textContent.trim());
  const rows = [...document.querySelectorAll('.rows .row')].map((n) => ({
    name: (n.querySelector('.row-name') || {}).textContent || '',
    badges: [...n.querySelectorAll('.badge')].map((b) => b.textContent.trim()),
  }));
  return {
    width: de.scrollWidth,
    client: de.clientWidth,
    seg,
    rows,
    body: document.body.innerText,
  };
}"""


def num(text):
    """从「公开 2」里取出 2"""
    m = re.search(r'(\d+)$', text.strip())
    return int(m.group(1)) if m else -1


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
        pg.wait_for_timeout(600)
        login(pg)
        pg.wait_for_timeout(500)

        m = pg.evaluate(MEASURE)
        assert m['width'] <= m['client'] + 1, f'页面被撑宽：{m["width"]} > {m["client"]}'

        # ── 1. 四档齐全，数字自洽 ──
        labels = m['seg']
        assert len(labels) == 4, f'应为 4 档，实际 {labels}'
        assert labels[0].startswith('全部'), f'第一档不是全部：{labels}'
        assert labels[3].startswith('归档'), f'第四档不是归档：{labels}'
        assert num(labels[0]) == 4, f'全部应不含归档，实际 {labels[0]}'
        assert num(labels[3]) == 2, f'归档数应为 2，实际 {labels[3]}'
        assert num(labels[1]) + num(labels[2]) == num(labels[0]), (
            f'公开 + 私有 ≠ 全部：{labels}'
        )
        # 默认档里不该出现归档仓库
        assert len(m['rows']) == 4, f'全部档行数应为 4，实际 {len(m["rows"])}'
        assert not any('Archived' in r['badges'] for r in m['rows']), '全部档里混进了归档仓库'
        print(f'[1] 四档：{" / ".join(labels)}；公开+私有={num(labels[1]) + num(labels[2])}=全部')
        print(f'[2] 默认「全部」{len(m["rows"])} 行，没有 Archived 徽章')

        # ── 2. 切到归档档 ──
        pg.locator('.segrow .seg button', has_text='归档').first.click()
        pg.wait_for_timeout(500)
        a = pg.evaluate(MEASURE)
        assert a['width'] <= a['client'] + 1, f'归档档把页面撑宽：{a["width"]} > {a["client"]}'
        assert len(a['rows']) == 2, f'归档档应 2 行，实际 {len(a["rows"])}：{[r["name"] for r in a["rows"]]}'
        assert all('Archived' in r['badges'] for r in a['rows']), (
            f'归档档里有行缺 Archived 徽章：{[(r["name"], r["badges"]) for r in a["rows"]]}'
        )
        names = [r['name'] for r in a['rows']]
        assert any('old-blog' in n for n in names), f'公开的归档仓库没出现：{names}'
        assert any('legacy-api' in n for n in names), f'私有的归档仓库没出现：{names}'
        print(f'[3] 归档档 2 行、全带 Archived：{names}')
        pg.screenshot(path=f'{OUT}/archived-093-list.png')

        # ── 3. 归档档里搜索还能用 ──
        pg.fill('input[placeholder="搜索仓库名或描述"]', 'legacy')
        pg.wait_for_timeout(400)
        s = pg.evaluate(MEASURE)
        assert len(s['rows']) == 1, f'归档档搜索应剩 1 行，实际 {len(s["rows"])}'
        assert 'legacy-api' in s['rows'][0]['name'], f'搜错了：{s["rows"][0]["name"]}'
        pg.fill('input[placeholder="搜索仓库名或描述"]', '')
        pg.wait_for_timeout(300)
        print('[4] 归档档内搜索正常')

        # ── 4. 回列表顶部，留一张「切档前后」的对照 ──
        pg.locator('.segrow .seg button', has_text='全部').first.click()
        pg.wait_for_timeout(400)
        back = pg.evaluate(MEASURE)
        assert len(back['rows']) == 4, f'切回全部应恢复 4 行，实际 {len(back["rows"])}'
        print('[5] 切回「全部」后 4 行回来了，档位切换是无损的')

        # ── 5. 一个归档都没有：第四档不该出现 ──
        # 换一个干净的 context，避免快照 / 工作区把上一轮的 6 个仓库带回来
        STATE['repos'] = NO_ARCHIVE
        ctx2 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg2 = ctx2.new_page()
        pg2.route('**/api.github.com/**', handle)
        pg2.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
        pg2.goto(BASE)
        pg2.wait_for_timeout(600)
        login(pg2)
        pg2.wait_for_timeout(500)
        n = pg2.evaluate(MEASURE)
        assert len(n['seg']) == 3, f'没有归档时不该有第四档，实际 {n["seg"]}'
        assert num(n['seg'][0]) == 4, f'没有归档时「全部」应等于总数 4，实际 {n["seg"][0]}'
        assert len(n['rows']) == 4, f'应 4 行，实际 {len(n["rows"])}'
        print(f'[6] 无归档时只剩三档：{" / ".join(n["seg"])}，第四档没有占位置')

        # ── 6. 闭环：在详情里归档 → 列表里消失 → 归档档里找得到 ──
        STATE['repos'] = list(REPOS)
        ctx3 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg3 = ctx3.new_page()
        pg3.route('**/api.github.com/**', handle)
        pg3.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
        pg3.goto(BASE)
        pg3.wait_for_timeout(600)
        login(pg3)
        pg3.wait_for_timeout(400)

        before = pg3.evaluate(MEASURE)
        assert len(before['rows']) == 4, f'归档前应 4 行，实际 {len(before["rows"])}'

        pg3.locator('.rows .row', has_text='ghx').first.click()
        pg3.wait_for_timeout(700)
        pg3.locator('text=归档仓库').first.click()
        pg3.wait_for_timeout(1200)
        pg3.keyboard.press('Escape')
        pg3.wait_for_timeout(600)

        after = pg3.evaluate(MEASURE)
        assert len(after['rows']) == 3, (
            f'归档后「全部」应剩 3 行，实际 {len(after["rows"])}：{[r["name"] for r in after["rows"]]}'
        )
        assert not any('ghx' in r['name'] for r in after['rows']), '归档了却还留在「全部」里'
        arch_label = [l for l in after['seg'] if l.startswith('归档')]
        assert arch_label and num(arch_label[0]) == 3, f'归档数没涨到 3：{after["seg"]}'
        print(f'[7] 在详情里归档后，「全部」4 → {len(after["rows"])}，归档档涨到 {num(arch_label[0])}')

        pg3.locator('.segrow .seg button', has_text='归档').first.click()
        pg3.wait_for_timeout(500)
        found = pg3.evaluate(MEASURE)
        assert any('ghx' in r['name'] for r in found['rows']), (
            f'刚归档的仓库在归档档里找不到：{[r["name"] for r in found["rows"]]}'
        )
        print(f'[8] 切到归档档，刚归档的 ghx 就在里面（{len(found["rows"])} 行）')

        # 再点进去，入口应该已经变成「取消归档」
        pg3.locator('.rows .row', has_text='ghx').first.click()
        pg3.wait_for_timeout(700)
        body = pg3.evaluate("() => document.body.innerText")
        assert '取消归档' in body, '归档后的详情页没有「取消归档」入口'
        assert '恢复后可继续提交' in body, (
            '已归档时副标题还写着「归档后仓库只读」—— 那句话是归档前才该说的'
        )
        assert '归档后变为只读' not in body, '已归档却仍在说「归档后变为只读」'
        pg3.screenshot(path=f'{OUT}/archived-093-detail.png')
        print('[9] 详情页入口已变成「取消归档」，不用去网页也能撤销')

        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()
